// Cloudflare Worker — order gateway for Forma
// Deploy with:  npx wrangler deploy  (run from worker/)
// Secrets (set via `wrangler secret put`, never in code):
//   TURNSTILE_SECRET   — Turnstile secret key
//   APPS_SCRIPT_SECRET — shared secret sent as X-Forma-Key to Apps Script
// Vars (wrangler.toml):
//   APPS_SCRIPT_URL — https://script.google.com/macros/s/.../exec
// KV binding:
//   RL — namespace "forma-ratelimit"

const LIMIT = 2;
const WINDOW_MS = 5 * 60 * 1000;
const ALLOWED_ORIGIN = "https://moh14amino-ui.github.io";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function jsonResp(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin))
  });
}

async function verifyTurnstile(secret, token, ip) {
  const body = new URLSearchParams();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: body
  });
  const data = await res.json();
  return !!data.success;
}

async function checkIpRateLimit(kv, ip) {
  const key = "ip:" + ip;
  const now = Date.now();
  const raw = await kv.get(key);
  let stamps = [];
  try { stamps = raw ? JSON.parse(raw) : []; } catch (e) { stamps = []; }
  stamps = stamps.filter(t => now - t < WINDOW_MS);
  if (stamps.length >= LIMIT) {
    const oldest = stamps[0];
    const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: retryAfter };
  }
  stamps.push(now);
  await kv.put(key, JSON.stringify(stamps), { expirationTtl: 300 });
  return { allowed: true };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return jsonResp({ ok: false, error: "method_not_allowed" }, 405, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return jsonResp({ ok: false, error: "bad_json" }, 400, origin);
    }

    if (payload.action !== "addOrder") {
      return jsonResp({ ok: false, error: "unsupported_action" }, 400, origin);
    }

    // 1. Turnstile
    const token = payload.turnstileToken;
    if (!token) {
      return jsonResp({ ok: false, error: "missing_turnstile_token" }, 400, origin);
    }
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const tsOk = await verifyTurnstile(env.TURNSTILE_SECRET, token, ip);
    if (!tsOk) {
      return jsonResp({ ok: false, error: "turnstile_failed" }, 403, origin);
    }

    // 2. IP rate limit
    const rl = await checkIpRateLimit(env.RL, ip);
    if (!rl.allowed) {
      return jsonResp({ ok: false, error: "rate_limited", retryAfter: rl.retryAfter }, 429, origin);
    }

    // 3. Sanitize
    const safe = {
      action: "addOrder",
      fullName: String(payload.fullName || "").slice(0, 120),
      wilaya: String(payload.wilaya || "").slice(0, 80),
      phone: String(payload.phone || "").slice(0, 30),
      delivery: String(payload.delivery || "").slice(0, 40),
      items: (payload.items || []).map(i => ({
        id: i.id,
        name: String(i.name || "").slice(0, 120),
        size: String(i.size || "").slice(0, 40),
        qty: Math.max(1, parseInt(i.qty, 10) || 1),
        price: Number(i.price) || 0
      })),
      total: Number(payload.total) || 0,
      shippingFee: Number(payload.shippingFee) || 0,
      fingerprint: String(payload.fingerprint || "").slice(0, 128)
    };

    // 4. Forward to Apps Script with the shared secret (in body, since Apps Script can't read headers)
    const url = env.APPS_SCRIPT_URL;
    const forwardBody = Object.assign({}, safe, { formaKey: env.APPS_SCRIPT_SECRET });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwardBody)
    });

    let data;
    try { data = await res.json(); } catch (e) { data = { ok: res.ok }; }
    return jsonResp(data, res.status || 200, origin);
  }
};
