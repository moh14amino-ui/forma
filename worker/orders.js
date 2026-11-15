// Cloudflare Worker — order gateway + admin API.
// Secrets (set via `wrangler secret put`):
//   APPS_SCRIPT_SECRET — shared secret sent to Apps Script (formaKey)
//   ADMIN_PASSWORD     — admin login password
// Vars (wrangler.toml):
//   APPS_SCRIPT_URL — https://script.google.com/macros/s/.../exec
// KV binding:
//   RL — namespace "forma_rate" (IP rate limits + admin sessions)

const LIMIT = 2;
const WINDOW_MS = 5 * 60 * 1000;
const ALLOWED_ORIGIN = "https://moh14amino-ui.github.io";
const ADMIN_TOKEN_TTL = 3600; // 1 hour in seconds

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders())
  });
}

async function checkIpRateLimit(kv, ip) {
  if (!kv || !ip) return { allowed: false };
  const key = "ip:" + ip;
  const now = Date.now();
  let stamps = [];
  try { const raw = await kv.get(key); stamps = raw ? JSON.parse(raw) : []; } catch (e) { stamps = []; }
  stamps = Array.isArray(stamps) ? stamps.filter(t => now - t < WINDOW_MS) : [];
  if (stamps.length >= LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((stamps[0] + WINDOW_MS - now) / 1000) };
  }
  stamps.push(now);
  await kv.put(key, JSON.stringify(stamps), { expirationTtl: 300 });
  return { allowed: true };
}

async function verifyAdminToken(kv, token) {
  if (!token || !kv) return false;
  const val = await kv.get("admin:" + token);
  return val === "1";
}

async function callAppsScript(env, action, body) {
  const url = env.APPS_SCRIPT_URL;
  const payload = Object.assign({ action: action }, body || {});
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok && data && data.ok !== false, data: data, status: res.status };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (origin !== ALLOWED_ORIGIN) return jsonResp({ ok: false, error: "origin_not_allowed" }, 403);
    if (request.method !== "POST") return jsonResp({ ok: false, error: "method_not_allowed" }, 405);
    if (!env.APPS_SCRIPT_SECRET || !env.APPS_SCRIPT_URL || !env.RL) {
      return jsonResp({ ok: false, error: "service_not_configured" }, 503);
    }
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 1048576) return jsonResp({ ok: false, error: "payload_too_large" }, 413);

    let payload;
    try { payload = await request.json(); } catch (e) { return jsonResp({ ok: false, error: "bad_json" }, 400); }
    if (!payload || !payload.action) return jsonResp({ ok: false, error: "missing_action" }, 400);

    const action = payload.action;

    // ---- Public: addOrder (IP rate limited) ----
    if (action === "addOrder") {
      const ip = request.headers.get("CF-Connecting-IP") || "";
      let rl;
      try { rl = await checkIpRateLimit(env.RL, ip); } catch (e) { return jsonResp({ ok: false, error: "rate_limit_unavailable" }, 503); }
      if (!rl.allowed) return jsonResp({ ok: false, error: "rate_limited", retryAfter: rl.retryAfter }, 429);

      if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 30) {
        return jsonResp({ ok: false, error: "invalid_items" }, 400);
      }
      const safe = {
        action: "addOrder",
        fullName: String(payload.fullName || "").trim().slice(0, 120),
        wilaya: String(payload.wilaya || "").trim().slice(0, 80),
        phone: String(payload.phone || "").trim().slice(0, 30),
        delivery: String(payload.delivery || "").trim().slice(0, 40),
        items: payload.items.map(i => ({ id: i && i.id, name: String((i && i.name) || "").slice(0, 120),
          size: String((i && i.size) || "").slice(0, 40), qty: Math.min(20, Math.max(1, parseInt(i && i.qty, 10) || 1)) })),
        fingerprint: String(payload.fingerprint || "").slice(0, 128),
        formaKey: env.APPS_SCRIPT_SECRET
      };
      if (!safe.fullName || !safe.wilaya || !/^0[567]\d{8}$/.test(safe.phone) || !safe.delivery) {
        return jsonResp({ ok: false, error: "invalid_order" }, 400);
      }
      try {
        const res = await fetch(env.APPS_SCRIPT_URL, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(safe)
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok !== true) return jsonResp({ ok: false, error: "order_storage_failed" }, 502);
        return jsonResp(data, 200);
      } catch (e) { return jsonResp({ ok: false, error: "order_service_unavailable" }, 502); }
    }

    // ---- Admin: login ----
    if (action === "adminLogin") {
      if (!env.ADMIN_PASSWORD) return jsonResp({ ok: false, error: "admin_not_configured" }, 503);
      if (payload.password !== env.ADMIN_PASSWORD) {
        return jsonResp({ ok: false, error: "wrong_password" }, 401);
      }
      // Generate random token
      const tokenBytes = new Uint8Array(32);
      crypto.getRandomValues(tokenBytes);
      const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
      await env.RL.put("admin:" + token, "1", { expirationTtl: ADMIN_TOKEN_TTL });
      return jsonResp({ ok: true, token: token, expiresIn: ADMIN_TOKEN_TTL });
    }

    // ---- Admin: verify token for all other admin actions ----
    const adminToken = payload.token || request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!await verifyAdminToken(env.RL, adminToken)) {
      return jsonResp({ ok: false, error: "unauthorized" }, 401);
    }

    // ---- Admin: get products ----
    if (action === "adminProducts") {
      const r = await callAppsScript(env, "getProducts", {});
      // Apps Script doesn't have a getProducts action that requires token; use products endpoint
      const res = await fetch(env.APPS_SCRIPT_URL + "?action=products", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      return jsonResp({ ok: true, products: Array.isArray(data) ? data : [] });
    }

    // ---- Admin: save products ----
    if (action === "adminSaveProducts") {
      const r = await callAppsScript(env, "saveProducts", { token: env.APPS_SCRIPT_SECRET ? undefined : undefined, products: payload.products });
      // Need to send SCRIPT_TOKEN; but Worker doesn't have it. Use formaKey approach.
      // Actually, saveProducts requires SCRIPT_TOKEN. We'll pass it via the body.
      // Since Worker doesn't have SCRIPT_TOKEN, we store it as a secret.
      if (!env.SCRIPT_TOKEN) return jsonResp({ ok: false, error: "script_token_not_configured" }, 503);
      const res = await fetch(env.APPS_SCRIPT_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveProducts", token: env.SCRIPT_TOKEN, products: payload.products })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) return jsonResp({ ok: false, error: "save_failed" }, 502);
      return jsonResp({ ok: true });
    }

    // ---- Admin: get orders ----
    if (action === "adminOrders") {
      if (!env.SCRIPT_TOKEN) return jsonResp({ ok: false, error: "script_token_not_configured" }, 503);
      const res = await fetch(env.APPS_SCRIPT_URL + "?action=orders&token=" + encodeURIComponent(env.SCRIPT_TOKEN), { cache: "no-store" });
      const data = await res.json().catch(() => null);
      return jsonResp({ ok: true, orders: Array.isArray(data) ? data : [] });
    }

    // ---- Admin: update order ----
    if (action === "adminUpdateOrder") {
      if (!env.SCRIPT_TOKEN) return jsonResp({ ok: false, error: "script_token_not_configured" }, 503);
      const res = await fetch(env.APPS_SCRIPT_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateOrder", token: env.SCRIPT_TOKEN, id: payload.id, status: payload.status, stockDeducted: payload.stockDeducted })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) return jsonResp({ ok: false, error: "update_failed" }, 502);
      return jsonResp({ ok: true });
    }

    // ---- Admin: get settings ----
    if (action === "adminSettings") {
      const res = await fetch(env.APPS_SCRIPT_URL + "?action=settings", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      return jsonResp({ ok: true, settings: data || { desk: 400, home: 600 } });
    }

    // ---- Admin: save settings ----
    if (action === "adminSaveSettings") {
      if (!env.SCRIPT_TOKEN) return jsonResp({ ok: false, error: "script_token_not_configured" }, 503);
      const res = await fetch(env.APPS_SCRIPT_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSettings", token: env.SCRIPT_TOKEN, desk: payload.desk, home: payload.home })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) return jsonResp({ ok: false, error: "save_failed" }, 502);
      return jsonResp({ ok: true });
    }

    // ---- Admin: logout ----
    if (action === "adminLogout") {
      await env.RL.delete("admin:" + adminToken);
      return jsonResp({ ok: true });
    }

    return jsonResp({ ok: false, error: "unknown_action" }, 400);
  }
};
