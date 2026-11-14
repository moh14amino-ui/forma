/* ===== Forma — Google Apps Script backend =====
   Setup (one time):
   1. Create a Google Sheet. Add two tabs: "Products" and "Orders".
   2. Extensions -> Apps Script -> delete default code -> paste this whole file -> Save.
   3. Run function `seedProducts` once (authorizes the script). It fills the Products tab.
   4. Deploy -> New deployment -> Web app:
        Execute as: Me
        Who has access: Anyone
      -> Deploy -> copy the /exec URL.
   5. Paste that URL into js/backend.js (BACKEND.SHEET_ENDPOINT) and set
      SHEET_ENABLED = true.

   Security: SCRIPT_TOKEN must match BACKEND.SHEET_TOKEN in js/backend.js.
   Only saveProducts / updateOrder require the token. addOrder is public (customers).
*/
const SCRIPT_TOKEN = "forma-admin-2026";

const INITIAL_PRODUCTS = [{"id": 2, "name": "Chemise en Lin Bleu Ciel", "category": "Shirts & Tops", "price": 49.99, "description": "Chemise légère en lin idéale pour les journées chaudes. Style décontracté chic avec col officier.", "image_url": "img/products/2.jpg", "stock": 28, "sizes": "M, L, XL"}, {"id": 3, "name": "Polo Sport Noir", "category": "Shirts & Tops", "price": 34.99, "description": "Polo technique respirant avec technologie de séchage rapide. Parfait pour le golf ou le quotidien.", "image_url": "img/products/3.jpg", "stock": 60, "sizes": "S, M, L, XL, XXL"}, {"id": 4, "name": "Chemise Flanelle à Carreaux", "category": "Shirts & Tops", "price": 39.99, "description": "Chemise en flanelle de coton douce et chaude. Motif à carreaux intemporel pour un look bûcheron décontracté.", "image_url": "img/products/4.jpg", "stock": 15, "sizes": "S, M, L"}, {"id": 5, "name": "Débardeur Côte Blanc", "category": "Shirts & Tops", "price": 19.99, "description": "Débardeur ajusté en maille côtelée. Confort optimal, parfait en superposition ou porté seul.", "image_url": "img/products/5.jpg", "stock": 50, "sizes": "S, M, L"}, {"id": 6, "name": "Hoodie Oversize Gris Chiné", "category": "Hoodies & Sweaters", "price": 54.99, "description": "Sweat à capuche coupe oversize en coton lourd. Poche kangourou et intérieur brossé ultra-doux.", "image_url": "img/products/6.jpg", "stock": 33, "sizes": "S, M, L, XL"}, {"id": 7, "name": "Sweat Col Rond Vert Forêt", "category": "Hoodies & Sweaters", "price": 44.99, "description": "Sweat-shirt classique à col rond. Bord-côte élastique aux poignets et à la taille. Couleur tendance.", "image_url": "img/products/7.jpg", "stock": 40, "sizes": "S, M, L, XL"}, {"id": 9, "name": "Cardigan en Maille Boutonné", "category": "Hoodies & Sweaters", "price": 64.99, "description": "Cardigan à col en V avec fermeture à boutons en corne. Style rétro moderne et texture douce.", "image_url": "img/products/9.jpg", "stock": 18, "sizes": "S, M, L"}, {"id": 11, "name": "Jean Droit Bleu Délavé", "category": "Pants & Denim", "price": 59.99, "description": "Jean coupe droite intemporel en denim épais de 12.5oz. Effet délavé naturel aux cuisses.", "image_url": "img/products/11.jpg", "stock": 30, "sizes": "30, 32, 34, 36"}, {"id": 12, "name": "Pantalon Chino Beige", "category": "Pants & Denim", "price": 49.99, "description": "Pantalon chino en sergé de coton extensible. Coupe ajustée, idéal pour le bureau ou les sorties.", "image_url": "img/products/12.jpg", "stock": 22, "sizes": "30, 32, 34, 36"}, {"id": 13, "name": "Jean Slim Noir", "category": "Pants & Denim", "price": 59.99, "description": "Jean coupe slim stretch noir profond. Ne se décolore pas facilement au lavage, silhouette épurée.", "image_url": "img/products/13.jpg", "stock": 35, "sizes": "28, 30, 32, 34"}, {"id": 15, "name": "Short en Jean Décontracté", "category": "Pants & Denim", "price": 34.99, "description": "Short en denim bleu clair avec ourlet brut retroussé. Parfait pour la saison estivale.", "image_url": "img/products/15.jpg", "stock": 40, "sizes": "30, 32, 34"}, {"id": 16, "name": "Veste en Denim Classique", "category": "Jackets & Outerwear", "price": 69.99, "description": "Veste en jean bleu brut avec boutons métalliques gravés. Deux poches poitrine pratiques.", "image_url": "img/products/16.jpg", "stock": 14, "sizes": "S, M, L, XL"}, {"id": 17, "name": "Blouson Bomber Noir", "category": "Jackets & Outerwear", "price": 74.99, "description": "Veste style bomber aviateur avec doublure orange contrastée. Tissu extérieur déperlant.", "image_url": "img/products/17.jpg", "stock": 20, "sizes": "M, L, XL"}, {"id": 19, "name": "Veste Coupe-Vent Technique", "category": "Jackets & Outerwear", "price": 84.99, "description": "Veste technique imperméable et coupe-vent. Capuche ajustable et fermetures éclair étanches.", "image_url": "img/products/19.jpg", "stock": 25, "sizes": "S, M, L, XL"}];

function _sheet(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

function setup() {
  // ensures tabs exist
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName("Products")) ss.insertSheet("Products");
  if (!ss.getSheetByName("Orders")) ss.insertSheet("Orders");
  const o = ss.getSheetByName("Orders");
  if (o.getLastRow() === 0) {
    o.appendRow(["Timestamp","Full Name","Wilaya","Phone","Delivery","Items","Total","Status","StockDeducted"]);
  }
  const p = ss.getSheetByName("Products");
  if (p.getLastRow() === 0) {
    p.appendRow(["id","name","category","price","description","image_url","stock","sizes"]);
  }
}

function seedProducts() {
  setup();
  const sh = _sheet("Products");
  // clear data rows
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  INITIAL_PRODUCTS.forEach(p => {
    sh.appendRow([
      p.id, p.name, p.category, p.price, p.description || "", p.image_url || "",
      p.stock, (Array.isArray(p.sizes) ? p.sizes.join(", ") : (p.sizes || ""))
    ]);
  });
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

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";
  if (action === "orders") {
    return ContentService.createTextOutput(JSON.stringify(_readOrders()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // default + action=products -> products
  return ContentService.createTextOutput(JSON.stringify(_readProducts()))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const action = data.action || "addOrder";

    // ---- add order (public) ----
    if (action === "addOrder" || action === "submitOrder") {
      const sh = _sheet("Orders");
      const items = (data.items || []).map(i => `${i.name} (size ${i.size}) x${i.qty}`).join("; ");
      sh.appendRow([
        new Date(),
        data.fullName || "",
        data.wilaya || "",
        data.phone || "",
        data.delivery || "",
        items,
        Number(data.total || 0),
        data.status || "Under review",
        !!data.stockDeducted
      ]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ---- token-gated actions ----
    if (data.token !== SCRIPT_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
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
          return ContentService.createTextOutput(JSON.stringify({ ok: true }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "saveProducts") {
      const sh = _sheet("Products");
      // clear data rows
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      (data.products || []).forEach(p => {
        sh.appendRow([
          p.id, p.name, p.category, p.price, p.description || "", p.image_url || "",
          p.stock, Array.isArray(p.sizes) ? p.sizes.join(", ") : (p.sizes || "")
        ]);
      });
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unknown action" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
