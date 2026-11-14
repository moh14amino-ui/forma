/* ===== Backend config =====
   LOCAL:  uses the local python server (/api/*) — works on your PC / LAN.
   PRODUCTION (GitHub Pages): orders go through the Cloudflare Worker (worker/orders.js)
   which adds Turnstile + IP rate limiting + the shared secret, then forwards to
   the Google Apps Script Web App (/exec). Products and settings are read directly
   from the Sheet.
*/
const ADMIN_SHEET_TOKEN = (typeof window !== "undefined" && window.ADMIN_SHEET_TOKEN) ? window.ADMIN_SHEET_TOKEN : "";
const BACKEND = {
  SHEET_ENABLED: true,
  SHEET_ENDPOINT: "https://script.google.com/macros/s/AKfycbynOXk9lUPDfyh4CiuLrHKZVIEp1ZOk2y5uNuO2oyUYByUnDUp72qUnBZWy3R121s86Bw/exec",
  SHEET_TOKEN: "",   // admin token is injected only on admin.html (see below)
  // Cloudflare Worker order gateway (set after `wrangler deploy`)
  ORDER_ENDPOINT: "https://forma-orders.PASTE_SUBDOMAIN.workers.dev",
  LOCAL_ORDERS: "/api/orders",
  LOCAL_PRODUCTS: "/api/products"
};
window.BACKEND = BACKEND;

function _isSheet() { return !!(BACKEND.SHEET_ENABLED && BACKEND.SHEET_ENDPOINT); }

// ---------- helpers ----------
async function backendLoadProducts() {
  if (_isSheet()) {
    try {
      const url = BACKEND.SHEET_ENDPOINT + "?action=products";
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) return data;
      }
    } catch (e) { console.warn("Sheet loadProducts failed", e); }
  }
  try {
    const res = await fetch(BACKEND.LOCAL_PRODUCTS, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    }
  } catch (e) { /* fall back */ }
  return null;
}

async function backendLoadSettings() {
  const fallback = { desk: 400, home: 600 };
  if (_isSheet()) {
    try {
      const url = BACKEND.SHEET_ENDPOINT + "?action=settings";
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          return { desk: Number(data.desk) || fallback.desk, home: Number(data.home) || fallback.home };
        }
      }
    } catch (e) { console.warn("Sheet loadSettings failed", e); }
  }
  return fallback;
}

async function backendSaveProducts(products) {
  if (_isSheet()) {
    try {
      await fetch(BACKEND.SHEET_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "saveProducts", token: ADMIN_SHEET_TOKEN, products })
      });
    } catch (e) { console.warn("Sheet saveProducts failed", e); }
  }
  try {
    await fetch(BACKEND.LOCAL_PRODUCTS, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(products)
    });
  } catch (e) { /* ignore if no local server */ }
}

async function backendSaveSettings(desk, home) {
  if (_isSheet()) {
    try {
      await fetch(BACKEND.SHEET_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "saveSettings", token: ADMIN_SHEET_TOKEN, desk: desk, home: home })
      });
    } catch (e) { console.warn("Sheet saveSettings failed", e); }
  }
}

async function backendLoadOrders() {
  if (_isSheet()) {
    try {
      const url = BACKEND.SHEET_ENDPOINT + "?action=orders&token=" + encodeURIComponent(ADMIN_SHEET_TOKEN);
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch (e) { console.warn("Sheet loadOrders failed", e); }
  }
  try {
    const res = await fetch(BACKEND.LOCAL_ORDERS, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    }
  } catch (e) { /* fall back */ }
  return null;
}

// Check whether this phone/fingerprint may place an order (2 per 5 min).
async function canOrder(phone, fingerprint) {
  if (_isSheet()) {
    try {
      const url = BACKEND.SHEET_ENDPOINT + "?action=canOrder&phone=" + encodeURIComponent(phone) + "&fp=" + encodeURIComponent(fingerprint);
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (e) { console.warn("canOrder (sheet) failed", e); }
  }
  // local fallback — no limit
  return { allowed: true };
}

// Compute a lightweight device fingerprint (canvas + UA + screen + tz).
async function getDeviceFingerprint() {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("forma-fp", 2, 2);
    const cdata = canvas.toDataURL();
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      cdata.slice(-80)
    ].join("||");
    // simple hash
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h + raw.charCodeAt(i)) | 0; }
    return "fp_" + (h >>> 0).toString(16);
  } catch (e) {
    return "fp_unknown";
  }
}

async function submitOrder(order) {
  order.status = order.status || "Under review";
  order.stockDeducted = !!order.stockDeducted;
  // local copy for admin on this browser
  try {
    const list = JSON.parse(localStorage.getItem("forma_orders") || "[]");
    list.unshift(Object.assign({ createdAt: new Date().toISOString() }, order));
    localStorage.setItem("forma_orders", JSON.stringify(list));
  } catch (e) { /* ignore */ }

  // Prefer the Cloudflare Worker (Turnstile + IP rate limit + secret)
  const workerUrl = BACKEND.ORDER_ENDPOINT;
  if (workerUrl && !workerUrl.includes("PASTE_SUBDOMAIN")) {
    try {
      const res = await fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action: "addOrder" }, order))
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) {
        return { ok: true, via: "worker", message: buildOrderMessage(order), total: data.total };
      }
      if (data.error === "rate_limited") {
        return { ok: false, via: "worker", rateLimited: true, retryAfter: data.retryAfter };
      }
      if (data.error === "turnstile_failed") {
        return { ok: false, via: "worker", error: "Security check failed. Please refresh and try again." };
      }
    } catch (e) {
      console.warn("Worker submit failed, falling back.", e);
    }
  }

  // Fallback: direct to Sheet (no Turnstile, phone rate limit applies server-side)
  if (_isSheet()) {
    try {
      await fetch(BACKEND.SHEET_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(Object.assign({ action: "addOrder" }, order))
      });
      return { ok: true, via: "sheet", message: buildOrderMessage(order) };
    } catch (e) {
      console.warn("Sheet submit failed, falling back.", e);
    }
  }

  // local server
  try {
    const res = await fetch(BACKEND.LOCAL_ORDERS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order)
    });
    if (res.ok) return { ok: true, via: "local", message: buildOrderMessage(order) };
  } catch (e) { /* no local server */ }

  const msg = buildOrderMessage(order);
  return { ok: true, via: "local", message: msg };
}

async function updateOrder(orderId, patch) {
  try {
    const list = JSON.parse(localStorage.getItem("forma_orders") || "[]");
    const o = list.find(x => x.id === orderId || x.createdAt === orderId);
    if (o) Object.assign(o, patch);
    localStorage.setItem("forma_orders", JSON.stringify(list));
  } catch (e) { /* ignore */ }

  if (_isSheet()) {
    try {
      await fetch(BACKEND.SHEET_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(Object.assign({ action: "updateOrder", token: ADMIN_SHEET_TOKEN, id: orderId }, patch))
      });
    } catch (e) { console.warn("updateOrder (sheet) failed", e); }
    return { ok: true };
  }

  try {
    await fetch(BACKEND.LOCAL_ORDERS, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ id: orderId }, patch))
    });
  } catch (e) { console.warn("updateOrder (local) failed", e); }
  return { ok: true };
}

function buildOrderMessage(order) {
  const lines = (order.items || []).map(i => `- ${i.name} (size ${i.size}) x${i.qty} — ${Number(i.price).toFixed(2)} DA`).join("\n");
  return [
    "New order — Forma",
    "",
    "Name: " + order.fullName,
    "Wilaya: " + order.wilaya,
    "Phone: " + order.phone,
    "Delivery: " + order.delivery,
    "",
    "Items:",
    lines,
    "",
    "Total: " + Number(order.total).toFixed(2) + " DA"
  ].join("\n");
}
