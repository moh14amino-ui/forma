/* ===== Backend config =====
   LOCAL:  uses the local python server (/api/*) — works on your PC / LAN.
   PRODUCTION (GitHub Pages): set SHEET_ENABLED=true and SHEET_ENDPOINT to your
   Google Apps Script Web App URL (ends in /exec). The script lives in
   google-apps-script.gs — paste it into your Sheet, deploy, then paste the URL.
*/
const BACKEND = {
  SHEET_ENABLED: false,
  SHEET_ENDPOINT: "",
  SHEET_TOKEN: "forma-admin-2026",   // must match SCRIPT_TOKEN in the Apps Script
  LOCAL_ORDERS: "/api/orders",
  LOCAL_PRODUCTS: "/api/products"
};
window.BACKEND = BACKEND;

function _isSheet() { return !!(BACKEND.SHEET_ENABLED && BACKEND.SHEET_ENDPOINT); }

// ---------- helpers used by products.js and admin.html ----------
async function backendLoadProducts() {
  // 1. Google Sheet
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
  // 2. Local server
  try {
    const res = await fetch(BACKEND.LOCAL_PRODUCTS, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    }
  } catch (e) { /* fall back */ }
  return null; // caller falls back to products.json / localStorage
}

async function backendSaveProducts(products) {
  // 1. Google Sheet
  if (_isSheet()) {
    try {
      await fetch(BACKEND.SHEET_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "saveProducts", token: BACKEND.SHEET_TOKEN, products })
      });
    } catch (e) { console.warn("Sheet saveProducts failed", e); }
  }
  // 2. Local server
  try {
    await fetch(BACKEND.LOCAL_PRODUCTS, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(products)
    });
  } catch (e) { /* ignore if no local server */ }
}

async function backendLoadOrders() {
  if (_isSheet()) {
    try {
      const url = BACKEND.SHEET_ENDPOINT + "?action=orders";
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

async function submitOrder(order) {
  order.status = order.status || "Under review";
  order.stockDeducted = !!order.stockDeducted;
  // local copy for admin on this browser
  try {
    const list = JSON.parse(localStorage.getItem("forma_orders") || "[]");
    list.unshift(Object.assign({ createdAt: new Date().toISOString() }, order));
    localStorage.setItem("forma_orders", JSON.stringify(list));
  } catch (e) { /* ignore */ }

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
        body: JSON.stringify(Object.assign({ action: "updateOrder", token: BACKEND.SHEET_TOKEN, id: orderId }, patch))
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