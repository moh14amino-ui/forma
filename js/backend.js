/* ===== Forma — Google Apps Script backend =====
   Setup (one time):
   1. Create a Google Sheet. Add tabs: "Products", "Orders", "Settings", "RateLimits".
   2. Extensions -> Apps Script -> delete default code -> paste this whole file -> Save.
   3. In the script's Project Settings / Script Properties, add:
      - SCRIPT_TOKEN = a long random secret
      - APPS_SCRIPT_SECRET = another long random secret
   4. Run function `seedProducts` once (authorizes the script). It fills the Products tab.
   5. Run function `seedSettings` once to fill default shipping fees.
   6. Deploy -> New deployment -> Web app:
          Execute as: Me
          Who has access: Anyone
        -> Deploy -> copy the /exec URL.
   7. Paste that URL into the worker config and set your Cloudflare secrets.

   Security notes:
   - Secrets are read from Script Properties, not hardcoded in the repository.
   - Orders (GET) requires SCRIPT_TOKEN in the query string.
   - addOrder requires the worker's shared secret in `formaKey`.
   - Shipping fees come from the Settings tab; totals are recomputed server-side.
 */

function _getSecret(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || "").trim();
}

const SCRIPT_TOKEN = _getSecret("SCRIPT_TOKEN");
const APPS_SCRIPT_SECRET = _getSecret("APPS_SCRIPT_SECRET");

const INITIAL_PRODUCTS = [{"id": 2, "name": "Chemise en Lin Bleu Ciel", "category": "Shirts & Tops", "price": 49.99, "description": "Chemise légère en lin idéale pour les journées chaudes.", "image_url": "img/products/1.jpg", "stock": 17, "sizes": ["S", "M", "L", "XL"]}, {"id": 4, "name": "Pantalon Beige", "category": "Bottoms", "price": 59.99, "description": "Coupe droite et confortable.", "image_url": "img/products/2.jpg", "stock": 12, "sizes": ["S", "M", "L", "XL"]}];

function _sheet(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName("Products")) ss.insertSheet("Products");
  if (!ss.getSheetByName("Orders")) ss.insertSheet("Orders");
  if (!ss.getSheetByName("Settings")) ss.insertSheet("Settings");
  if (!ss.getSheetByName("RateLimits")) ss.insertSheet("RateLimits");

  const o = ss.getSheetByName("Orders");
  if (o.getLastRow() === 0) {
    o.appendRow(["Timestamp","Full Name","Wilaya","Phone","Delivery","Items","Total","Status","StockDeducted","Fingerprint"]);
  }
  const p = ss.getSheetByName("Products");
  if (p.getLastRow() === 0) {
    p.appendRow(["id","name","category","price","description","image_url","stock","sizes"]);
  }
  const s = ss.getSheetByName("Settings");
  if (s.getLastRow() === 0) {
    s.appendRow(["key","value"]);
  }
  const r = ss.getSheetByName("RateLimits");
  if (r.getLastRow() === 0) {
    r.appendRow(["key","timestamps"]);
  }
}

function seedProducts() {
  setup();
  const sh = _sheet("Products");
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  INITIAL_PRODUCTS.forEach(p => {
    sh.appendRow([
      p.id, p.name, p.category, p.price, p.description || "", p.image_url || "",
      p.stock, (Array.isArray(p.sizes) ? p.sizes.join(", ") : (p.sizes || ""))
    ]);
  });
}

function seedSettings() {
  setup();
  const sh = _sheet("Settings");
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  sh.appendRow(["desk", 400]);
  sh.appendRow(["home", 600]);
}

function _readProducts() {
  const sh = _sheet("Products");
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i]; });
    if (o.sizes && typeof o.sizes === "string") o.sizes = o.sizes.split(",").map(s => s.trim()).filter(Boolean);
    if (o.id !== "" && o.id !== null) o.id = Number(o.id);
    if (o.price !== "" && o.price !== null) o.price = Number(o.price);
    if (o.stock !== "" && o.stock !== null && o.stock !== undefined) o.stock = Number(o.stock);
    return o;
  });
}

function _readOrders() {
  const sh = _sheet("Orders");
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i]; });
    const out = {
      fullName: o["Full Name"] || o.fullName || "",
      wilaya: o["Wilaya"] || o.wilaya || "",
      phone: o["Phone"] || o.phone || "",
      delivery: o["Delivery"] || o.delivery || "",
      total: Number(o["Total"] || o.total || 0),
      status: o["Status"] || o.status || "Under review",
      stockDeducted: String(o["StockDeducted"] || o.stockDeducted || "").toLowerCase() === "true",
      createdAt: o["Timestamp"] ? new Date(o["Timestamp"]).toISOString() : (o.createdAt || "")
    };
    if (o["Items"] && typeof o["Items"] === "string") {
      out.items = o["Items"].split(";").map(s => {
        const m = s.trim().match(/^(.+?) \(size (.+?)\) x(\d+)$/);
        return m ? { name: m[1].trim(), size: m[2].trim(), qty: Number(m[3]) } : { name: s.trim(), size: "", qty: 1 };
      });
    } else {
      out.items = [];
    }
    return out;
  });
}

function _readSettings() {
  const sh = _sheet("Settings");
  const out = { desk: 400, home: 600 };
  if (!sh || sh.getLastRow() < 2) return out;
  const rows = sh.getDataRange().getValues();
  rows.slice(1).forEach(r => {
    const key = String(r[0] || "").toLowerCase();
    const val = Number(r[1]);
    if (key && !isNaN(val)) out[key] = val;
  });
  return out;
}

function _checkPhoneRateLimit(phone, fingerprint) {
  const key = (phone || "") + "|" + (fingerprint || "");
  if (!key.trim() || key === "|") return { allowed: true };
  const sh = _sheet("RateLimits");
  if (!sh) return { allowed: true };
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const limit = 2;
  let rowIdx = -1;
  let stamps = [];
  if (sh.getLastRow() >= 2) {
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === key) {
        rowIdx = i + 1;
        try { stamps = JSON.parse(rows[i][1] || "[]"); } catch (e) { stamps = []; }
        break;
      }
    }
  }
  stamps = stamps.filter(t => now - t < windowMs);
  if (stamps.length >= limit) {
    const oldest = stamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter: retryAfter };
  }
  stamps.push(now);
  if (rowIdx > 0) {
    sh.getRange(rowIdx, 2).setValue(JSON.stringify(stamps));
  } else {
    sh.appendRow([key, JSON.stringify(stamps)]);
  }
  return { allowed: true };
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";
  const token = (e && e.parameter && e.parameter.token) || "";

  if (action === "settings") {
    return ContentService.createTextOutput(JSON.stringify(_readSettings())).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "canOrder") {
    const phone = (e && e.parameter && e.parameter.phone) || "";
    const fp = (e && e.parameter && e.parameter.fp) || "";
    const rl = _checkPhoneRateLimit(phone, fp);
    return ContentService.createTextOutput(JSON.stringify(rl)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "orders") {
    if (token !== SCRIPT_TOKEN || !SCRIPT_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" })).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify(_readOrders())).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify(_readProducts())).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const action = data.action || "addOrder";

    if (action === "canOrder") {
      const phone = data.phone || "";
      const fp = data.fingerprint || "";
      const key = (phone || "") + "|" + (fp || "");
      const sh = _sheet("RateLimits");
      let stamps = [];
      if (sh && sh.getLastRow() >= 2) {
        const rows = sh.getDataRange().getValues();
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][0]) === key) {
            try { stamps = JSON.parse(rows[i][1] || "[]"); } catch (ex) { stamps = []; }
            break;
          }
        }
      }
      const now = Date.now();
      const windowMs = 5 * 60 * 1000;
      stamps = stamps.filter(t => now - t < windowMs);
      if (stamps.length >= 2) {
        const retryAfter = Math.ceil((stamps[0] + windowMs - now) / 1000);
        return ContentService.createTextOutput(JSON.stringify({ allowed: false, retryAfter: retryAfter })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ allowed: true })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "addOrder" || action === "submitOrder") {
      const hasKey = !!APPS_SCRIPT_SECRET && data.formaKey && data.formaKey === APPS_SCRIPT_SECRET;
      if (!hasKey) {
        const rl = _checkPhoneRateLimit(data.phone || "", data.fingerprint || "");
        if (!rl.allowed) {
          return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "rate_limited", retryAfter: rl.retryAfter })).setMimeType(ContentService.MimeType.JSON);
        }
      }

      const products = _readProducts();
      const pmap = {};
      products.forEach(p => { pmap[p.id] = p; });
      const settings = _readSettings();
      let subtotal = 0;
      const safeItems = (data.items || []).map(i => {
        const p = pmap[i.id];
        const price = p ? Number(p.price) : Number(i.price || 0);
        const qty = Math.max(1, parseInt(i.qty, 10) || 1);
        subtotal += price * qty;
        return { id: i.id, name: p ? p.name : (i.name || "Item"), size: i.size || "", qty: qty, price: price };
      });
      const delivery = String(data.delivery || "");
      const isHome = /home/i.test(delivery);
      const shipping = isHome ? (settings.home || 600) : (settings.desk || 400);
      const total = subtotal + shipping;
      const sh = _sheet("Orders");
      const items = safeItems.map(i => `${i.name} (size ${i.size}) x${i.qty}`).join("; ");
      sh.appendRow([
        new Date(),
        String(data.fullName || "").slice(0, 120),
        String(data.wilaya || "").slice(0, 80),
        String(data.phone || "").slice(0, 30),
        delivery.slice(0, 40),
        items,
        total,
        "Under review",
        false,
        String(data.fingerprint || "").slice(0, 128)
      ]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, total: total })).setMimeType(ContentService.MimeType.JSON);
    }

    if (!SCRIPT_TOKEN || data.token !== SCRIPT_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "updateOrder") {
      const sh = _sheet("Orders");
      const rows = sh.getDataRange().getValues();
      const headers = rows[0];
      const idCol = headers.indexOf("Timestamp");
      const statusCol = headers.indexOf("Status");
      const stockCol = headers.indexOf("StockDeducted");
      const key = String(data.id || data.createdAt || "");
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][idCol]) === key || (rows[i][idCol] && new Date(rows[i][idCol]).toISOString() === key)) {
          if (statusCol >= 0 && data.status) sh.getRange(i + 1, statusCol + 1).setValue(data.status);
          if (stockCol >= 0 && data.stockDeducted !== undefined) sh.getRange(i + 1, stockCol + 1).setValue(!!data.stockDeducted);
          return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "not found" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "saveProducts") {
      const sh = _sheet("Products");
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      (data.products || []).forEach(p => {
        sh.appendRow([
          p.id, p.name, p.category, p.price, p.description || "", p.image_url || "",
          p.stock, Array.isArray(p.sizes) ? p.sizes.join(", ") : (p.sizes || "")
        ]);
      });
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "saveSettings") {
      const sh = _sheet("Settings");
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      if (data.desk !== undefined) sh.appendRow(["desk", Number(data.desk)]);
      if (data.home !== undefined) sh.appendRow(["home", Number(data.home)]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unknown action" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

