// Cloudflare Worker — order gateway. Secrets must be configured with Wrangler:
// wrangler secret put TURNSTILE_SECRET
// wrangler secret put APPS_SCRIPT_SECRET
// APPS_SCRIPT_URL is configured in wrangler.toml; RL is a KV binding.
const LIMIT = 2;
const WINDOW_MS = 5 * 60 * 1000;
const ALLOWED_ORIGIN = "https://moh14amino-ui.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
async function verifyTurnstile(secret, token, ip) {
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = await res.json();
    return !!data.success && data.hostname === "moh14amino-ui.github.io";
  } catch (e) { return false; }
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (origin !== ALLOWED_ORIGIN) return jsonResp({ ok: false, error: "origin_not_allowed" }, 403);
    if (request.method !== "POST") return jsonResp({ ok: false, error: "method_not_allowed" }, 405);
    if (!env.TURNSTILE_SECRET || !env.APPS_SCRIPT_SECRET || !env.APPS_SCRIPT_URL || !env.RL) {
      return jsonResp({ ok: false, error: "service_not_configured" }, 503);
    }
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 16384) return jsonResp({ ok: false, error: "payload_too_large" }, 413);
    let payload;
    try { payload = await request.json(); } catch (e) { return jsonResp({ ok: false, error: "bad_json" }, 400); }
    if (!payload || payload.action !== "addOrder") return jsonResp({ ok: false, error: "unsupported_action" }, 400);
    const ip = request.headers.get("CF-Connecting-IP") || "";
    if (!await verifyTurnstile(env.TURNSTILE_SECRET, payload.turnstileToken, ip)) {
      return jsonResp({ ok: false, error: "turnstile_failed" }, 403);
    }
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
};
