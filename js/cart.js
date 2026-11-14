/* ===== Cart logic (localStorage) ===== */
const CART_KEY = "forma_cart_v1";

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch (e) { return []; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
  window.dispatchEvent(new CustomEvent("cart:changed"));
}
function addToCart(productId, size, qty) {
  qty = Math.max(1, parseInt(qty, 10) || 1);
  const cart = getCart();
  const existing = cart.find(i => i.id === productId && i.size === size);
  if (existing) existing.qty += qty;
  else cart.push({ id: productId, size: size, qty: qty });
  saveCart(cart);
  bumpBadge();
}
function updateQty(productId, size, qty) {
  qty = parseInt(qty, 10);
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter(i => !(i.id === productId && i.size === size));
  } else {
    const it = cart.find(i => i.id === productId && i.size === size);
    if (it) it.qty = qty;
  }
  saveCart(cart);
}
function removeFromCart(productId, size) {
  const cart = getCart().filter(i => !(i.id === productId && i.size === size));
  saveCart(cart);
}
function clearCart() { localStorage.removeItem(CART_KEY); saveCart([]); }

// ---------- shipping fees (editable by admin, stored in the Sheet) ----------
const SHIPPING_KEY = "forma_shipping_v1";
const SHIPPING_DEFAULTS = { desk: 400, home: 600 };
function getShippingFees() {
  try {
    const raw = localStorage.getItem(SHIPPING_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return { desk: Number(o.desk) || SHIPPING_DEFAULTS.desk, home: Number(o.home) || SHIPPING_DEFAULTS.home };
    }
  } catch (e) {}
  return { ...SHIPPING_DEFAULTS };
}
function setShippingFees(desk, home) {
  localStorage.setItem(SHIPPING_KEY, JSON.stringify({ desk: Number(desk), home: Number(home) }));
}
function shippingFeeFor(delivery) {
  const f = getShippingFees();
  if (/home/i.test(delivery)) return f.home;
  return f.desk;
}
// Load fees from the Sheet (source of truth); fall back to localStorage.
async function loadShippingFees() {
  try {
    if (typeof backendLoadSettings === "function") {
      const s = await backendLoadSettings();
      if (s) { setShippingFees(s.desk, s.home); window.dispatchEvent(new CustomEvent("shipping:changed")); }
    }
  } catch (e) { /* keep cached */ }
}
function cartCount() { return getCart().reduce((s, i) => s + i.qty, 0); }
function cartTotal(products) {
  const map = new Map(products.map(p => [p.id, p]));
  return getCart().reduce((s, i) => {
    const p = map.get(i.id);
    return s + (p ? p.price * i.qty : 0);
  }, 0);
}

function updateCartBadge() {
  const badge = document.getElementById("cartCount");
  if (!badge) return;
  const n = cartCount();
  badge.textContent = n;
  badge.classList.toggle("zero", n === 0);
}
function bumpBadge() {
  const badge = document.getElementById("cartCount");
  if (!badge) return;
  badge.classList.remove("bump");
  void badge.offsetWidth;
  badge.classList.add("bump");
  setTimeout(() => badge.classList.remove("bump"), 300);
}

// render cart items into a container (used by cart page)
function renderCart(products) {
  const container = document.getElementById("cartContainer");
  if (!container) return;
  const cart = getCart();
  const map = new Map(products.map(p => [p.id, p]));
  if (!cart.length) {
    container.innerHTML = `
      <div class="cart-empty">
        <h2>${t("cart.empty")}</h2>
        <p>${t("cart.emptyLead")}</p>
        <a class="btn btn-primary" href="shop.html">${t("cart.viewCollection")}</a>
      </div>`;
    updateCartSummary(products);
    return;
  }
  const rows = cart.map(i => {
    const p = map.get(i.id);
    if (!p) return "";
    return `
      <div class="cart-row">
        <img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" decoding="async">
        <div class="cart-row-info">
          <div class="cart-row-top">
            <span class="cart-item-name">${esc(p.name)}</span>
            <span class="cart-remove" data-remove data-id="${p.id}" data-size="${esc(i.size)}">Remove</span>
          </div>
          <span class="cart-item-meta">Size ${esc(i.size)} · ${priceLabel(p.price)} each</span>
          <div class="cart-row-bottom">
            <div class="qty-control">
              <button data-action="dec" data-id="${p.id}" data-size="${esc(i.size)}">−</button>
              <input type="number" min="1" value="${i.qty}" data-id="${p.id}" data-size="${esc(i.size)}">
              <button data-action="inc" data-id="${p.id}" data-size="${esc(i.size)}">+</button>
            </div>
            <span class="cart-item-price">${priceLabel(p.price * i.qty)}</span>
          </div>
        </div>
      </div>`;
  }).join("");
  container.innerHTML = `<div class="cart-list">${rows}</div>`;
  // bind controls
  container.querySelectorAll("[data-action=dec]").forEach(b => b.addEventListener("click", () => {
    const id = +b.dataset.id; const size = b.dataset.size;
    const it = getCart().find(x => x.id === id && x.size === size);
    if (it) updateQty(id, size, it.qty - 1);
    renderCart(products);
  }));
  container.querySelectorAll("[data-action=inc]").forEach(b => b.addEventListener("click", () => {
    const id = +b.dataset.id; const size = b.dataset.size;
    const it = getCart().find(x => x.id === id && x.size === size);
    if (it) updateQty(id, size, it.qty + 1);
    renderCart(products);
  }));
  container.querySelectorAll("input[type=number]").forEach(inp => inp.addEventListener("change", () => {
    updateQty(+inp.dataset.id, inp.dataset.size, inp.value);
    renderCart(products);
  }));
  container.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => {
    removeFromCart(+b.dataset.id, b.dataset.size);
    renderCart(products);
  }));
  updateCartSummary(products);
}

function updateCartSummary(products) {
  const el = document.getElementById("cartSummary");
  if (!el) return;
  const total = cartTotal(products);
  const count = cartCount();
  // determine selected delivery (if the checkout form exists)
  let delivery = "Desk (bureau)";
  const checked = document.querySelector('input[name="delivery"]:checked');
  if (checked) delivery = checked.value;
  const fee = cartCount() > 0 ? shippingFeeFor(delivery) : 0;
  const grand = total + fee;
  el.innerHTML = `
    <div class="cart-summary">
      <div class="cart-summary-row"><span>${t("cart.items")}</span><span>${count}</span></div>
      <div class="cart-summary-row"><span>${t("cart.subtotal")}</span><span>${priceLabel(total)}</span></div>
      <div class="cart-summary-row"><span>${t("cart.shipping")} (${delivery.includes("Home") ? t("cart.home") : t("cart.desk")})</span><span>${priceLabel(fee)}</span></div>
      <div class="cart-summary-row total"><span>${t("cart.total")}</span><span>${priceLabel(grand)}</span></div>
    </div>`;
}

function buildOrderMessage(products) {
  const map = new Map(products.map(p => [p.id, p]));
  const lines = getCart().map(i => {
    const p = map.get(i.id);
    if (!p) return "";
    return `- ${p.name} (size ${i.size}) x${i.qty} — ${priceLabel(p.price * i.qty)}`;
  }).filter(Boolean);
  const total = cartTotal(products);
  return "Hi, I'd like to place an order:\n\n" + lines.join("\n") + "\n\nTotal: " + priceLabel(total) + "\n\nPlease confirm availability and shipping.";
}

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function priceLabel(p){ return Number(p).toFixed(2) + " DA"; }