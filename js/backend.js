/* Public storefront backend.
 * Public product/settings reads may use Apps Script. Customer orders must go
 * through the Cloudflare Worker; never ship admin credentials to this page.
 */
const BACKEND = {
  SHEET_ENDPOINT: "https://script.google.com/macros/s/AKfycbynOXk9lUPDfyh4CiuLrHKZVIEp1ZOk2y5uNuO2oyUYByUnDUp72qUnBZWy3R121s86Bw/exec",
  ORDER_ENDPOINT: "https://forma-orders.PASTE_SUBDOMAIN.workers.dev",
  LOCAL_PRODUCTS: "/api/products"
};
if (typeof window !== "undefined") window.BACKEND = BACKEND;

function _isSheet() { return !!BACKEND.SHEET_ENDPOINT; }

async function backendLoadProducts() {
  if (_isSheet()) {
    try {
      const res = await fetch(BACKEND.SHEET_ENDPOINT + "?action=products", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) return data;
      }
    } catch (e) { console.warn("Product service unavailable", e); }
  }
  try {
    const res = await fetch(BACKEND.LOCAL_PRODUCTS, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    }
  } catch (e) { /* static products.json is the fallback */ }
  return null;
}

async function backendLoadSettings() {
  const fallback = { desk: 400, home: 600 };
  if (_isSheet()) {
    try {
      const res = await fetch(BACKEND.SHEET_ENDPOINT + "?action=settings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          return { desk: Number(data.desk) || fallback.desk, home: Number(data.home) || fallback.home };
        }
      }
    } catch (e) { console.warn("Shipping settings unavailable", e); }
  }
  return fallback;
}

// Admin writes/reads are intentionally unavailable from this public client.
async function backendSaveProducts() { return { ok: false, error: "admin_unavailable" }; }
async function backendSaveSettings() { return { ok: false, error: "admin_unavailable" }; }
async function backendLoadOrders() { return null; }
async function updateOrder() { return { ok: false, error: "admin_unavailable" }; }

async function getDeviceFingerprint() {
  try {
    const raw = [navigator.userAgent, navigator.language, screen.width + "x" + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone].join("||");
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
    return "fp_" + (h >>> 0).toString(16);
  } catch (e) { return "fp_unknown"; }
}

// Informational only: server-side order controls must enforce all limits.
async function canOrder() { return { allowed: true }; }

async function submitOrder(order) {
  const workerUrl = BACKEND.ORDER_ENDPOINT;
  if (!workerUrl || workerUrl.includes("PASTE_SUBDOMAIN")) {
    return { ok: false, error: "Online ordering is not configured yet. Please contact the store directly." };
  }
  // Turnstile removed; server-side rate limits still apply.
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: "addOrder" }, order))
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.ok === true) {
      return { ok: true, via: "worker", message: buildOrderMessage(order), total: data.total };
    }
    if (data.error === "rate_limited") return { ok: false, rateLimited: true, retryAfter: data.retryAfter };
    if (data.error === "turnstile_failed" || data.error === "missing_turnstile_token") {
      return { ok: false, error: "Security check failed. Please refresh and try again." };
    }
    return { ok: false, error: "We could not submit your order. Please try again or contact the store." };
  } catch (e) {
    console.error("Order service unavailable", e);
    return { ok: false, error: "Online ordering is temporarily unavailable. Please contact the store." };
  }
}

function buildOrderMessage(order) {
  const lines = (order.items || []).map(i => `- ${i.name} (size ${i.size}) x${i.qty} — ${Number(i.price).toFixed(2)} DA`).join("\n");
  return ["New order — Forma", "", "Name: " + order.fullName, "Wilaya: " + order.wilaya,
    "Phone: " + order.phone, "Delivery: " + order.delivery, "", "Items:", lines, "",
    "Total: " + Number(order.total).toFixed(2) + " DA"].join("\n");
}
