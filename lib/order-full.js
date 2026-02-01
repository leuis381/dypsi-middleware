import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { parseOrderText } from "./parse-order.js";
import { calculateRoute } from "./route-price.js";
import { readImage } from "./ocr.js";

/**
 * order-full.js
 *
 * Robust order parsing and pricing endpoint for Vercel middleware (DYPSI).
 * - Tries to fetch WhatsApp Business catalog (Graph API) with retries and timeout.
 * - Falls back to local menu.json if WhatsApp fails or is not configured.
 * - Accepts text message or imageUrl (OCR) to extract order text.
 * - Parses order items using parseOrderText (user-provided parser).
 * - Calculates route/delivery price using calculateRoute (user-provided).
 * - Applies basic promo/combo rules and returns detailed breakdown.
 * - Returns structured JSON with items, delivery, subtotal, discounts, total, currency and warnings.
 *
 * Expected req.body:
 * {
 *   message: "Quiero 1 pizza barbecue mediana y 2 alitas 6und",
 *   origin: { lat: -12.0, lon: -77.0 } OR "address string",
 *   destination: { lat: -12.1, lon: -77.1 } OR "address string",
 *   imageUrl: "https://..." // optional, used for OCR if message empty
 * }
 *
 * Environment:
 * - WHATSAPP_BUSINESS_ID (optional)
 * - WHATSAPP_TOKEN (optional)
 *
 * Deploy notes:
 * - Place menu.json at project root for local fallback.
 * - parse-order.js and route-price.js must export the expected functions.
 */

/* ---------- Config ---------- */
const WHATSAPP_API_TIMEOUT = 8000;
const WHATSAPP_MAX_RETRIES = 2;
const LOCAL_MENU_PATH = path.resolve(process.cwd(), "menu.json");
const AXIOS_TIMEOUT = 8000;

/* ---------- Helpers ---------- */
function now() {
  return new Date().toISOString();
}

function safeNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

async function fetchWhatsAppCatalog() {
  if (!process.env.WHATSAPP_BUSINESS_ID || !process.env.WHATSAPP_TOKEN) {
    throw new Error("WhatsApp credentials not configured");
  }

  const businessId = process.env.WHATSAPP_BUSINESS_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const url = `https://graph.facebook.com/v18.0/${businessId}/products`;

  const axiosInstance = axios.create({
    timeout: WHATSAPP_API_TIMEOUT,
    headers: { Authorization: `Bearer ${token}` }
  });

  let attempt = 0;
  while (attempt <= WHATSAPP_MAX_RETRIES) {
    try {
      const r = await axiosInstance.get(url);
      const data = r?.data?.data || [];
      // Normalize minimal fields
      const products = data.map((p) => ({
        id: p.id || p.product_id || null,
        name: p.name || p.title || null,
        description: p.description || null,
        raw: p
      }));
      return { source: "whatsapp", products, raw: data };
    } catch (err) {
      attempt++;
      if (attempt > WHATSAPP_MAX_RETRIES) {
        throw new Error(`WhatsApp catalog fetch failed: ${err.message || err}`);
      }
      // small backoff
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  throw new Error("WhatsApp fetch unreachable");
}

async function readLocalMenu() {
  try {
    const content = await fs.readFile(LOCAL_MENU_PATH, "utf8");
    const parsed = JSON.parse(content);
    // If menu.json uses categorias -> flatten to products
    if (parsed && Array.isArray(parsed.categorias)) {
      const products = [];
      for (const cat of parsed.categorias) {
        if (Array.isArray(cat.productos)) {
          for (const p of cat.productos) {
            products.push({ ...p, categoria: cat.id || cat.nombre || null });
          }
        }
      }
      return { source: "local", products, raw: parsed };
    }
    // If parsed is array of products
    if (Array.isArray(parsed)) return { source: "local", products: parsed, raw: parsed };
    // Otherwise wrap object
    return { source: "local", products: [parsed], raw: parsed };
  } catch (err) {
    throw new Error(`Local menu read error: ${err.message || err}`);
  }
}

/* Apply simple promo rules (extendable). Returns { items, discounts, subtotal, total } */
function applyPromosAndCalculate(items, rules = {}) {
  // items: [{ id, name, price, quantity, variant, extras }]
  // rules: optional rules object (not required here)
  const result = {
    items: JSON.parse(JSON.stringify(items)),
    discounts: [],
    subtotal: 0,
    total: 0
  };

  // compute subtotal
  result.subtotal = result.items.reduce((s, it) => s + safeNumber(it.price) * safeNumber(it.quantity), 0);

  // Example promo rules implemented from menu:
  // - combo_burger_pepsi: if burger_clasica + pepsi_355 present, set combo price 11 for both
  // - promo_2_pizzas_clasicas_jueves handled elsewhere (requires date)
  // - mostro/mostrito combos handled if item id matches
  // We'll implement combo_burger_pepsi and mostro detection heuristics.

  // Helper find by id or name fuzzy
  const findItem = (predicate) => result.items.find(predicate);

  // Combo: burger_clasica + pepsi_355 => total 11
  const burger = findItem((i) => i.id === "burger_clasica" || /burger_clasica|hamburguesa clásica|hamburguesa clasica/i.test(String(i.id || i.name || "")));
  const pepsi = findItem((i) => i.id === "pepsi_355" || /pepsi_355|pepsi 355|pepsi 355ml/i.test(String(i.id || i.name || "")));
  if (burger && pepsi) {
    // Determine how many combos can be formed
    const combos = Math.min(burger.quantity || 0, pepsi.quantity || 0);
    if (combos > 0) {
      // Calculate original price for those combos
      const original = (burger.price || 0) + (pepsi.price || 0);
      const comboPrice = 11.0;
      const discountPerCombo = original - comboPrice;
      const totalDiscount = discountPerCombo * combos;
      if (totalDiscount > 0) {
        result.discounts.push({
          id: "combo_burger_pepsi",
          description: `Combo Burger Clásica + Pepsi 355ml (${combos}x)`,
          amount: Number(totalDiscount.toFixed(2))
        });
      }
      // Adjust subtotal by subtracting discount
      result.subtotal = Number((result.subtotal - totalDiscount).toFixed(2));
    }
  }

  // Mostro / Mostrito detection: if item name includes 'mostro' or explicit combo item id
  const mostroItem = findItem((i) => /mostro|mostrito/i.test(String(i.id || i.name || "")));
  if (mostroItem) {
    // If price differs from expected, we don't override; just note promo tag
    result.discounts.push({
      id: "mostro_promo_note",
      description: "Mostro/Mostrito promo applied (fixed price S/11 if matched)",
      amount: 0
    });
  }

  // Final total (subtotal already adjusted)
  result.total = Number(result.subtotal.toFixed(2));
  return result;
}

/* Validate and normalize parsed items to ensure price and quantity exist */
function normalizeParsedItems(parsedItems, catalogProducts = []) {
  // parsedItems expected from parseOrderText: [{ name, quantity, variant, extras }]
  // catalogProducts: array with product definitions (may include price or variants)
  const normalized = [];
  const warnings = [];

  for (const p of parsedItems || []) {
    const name = (p.name || "").toString().trim();
    const qty = Math.max(1, parseInt(p.quantity || 1, 10));
    // Try to find product in catalog by id or name (case-insensitive)
    let catalogMatch = null;
    if (p.id) {
      catalogMatch = catalogProducts.find((c) => String(c.id) === String(p.id));
    }
    if (!catalogMatch) {
      const lower = name.toLowerCase();
      catalogMatch = catalogProducts.find((c) => (c.name || "").toLowerCase() === lower || (String(c.id || "")).toLowerCase() === lower);
    }
    // If still not found, try fuzzy by includes
    if (!catalogMatch) {
      const lower = name.toLowerCase();
      catalogMatch = catalogProducts.find((c) => (c.name || "").toLowerCase().includes(lower) || lower.includes((c.name || "").toLowerCase()));
    }

    // Determine price
    let price = 0;
    if (catalogMatch) {
      // If variant provided, try to use variant price
      if (p.variant && catalogMatch.variantes && typeof catalogMatch.variantes === "object") {
        const variantKey = p.variant.toString().toLowerCase();
        // match keys like 'pequena','mediana','familiar' or 'personal'
        const variantPrice = catalogMatch.variantes[variantKey] ?? catalogMatch.variantes[p.variant] ?? null;
        if (variantPrice != null) price = safeNumber(variantPrice);
        else {
          // try common keys mapping
          const map = { small: "pequena", medium: "mediana", large: "familiar", personal: "personal" };
          const mapped = map[variantKey];
          if (mapped && catalogMatch.variantes[mapped] != null) price = safeNumber(catalogMatch.variantes[mapped]);
        }
      }
      // fallback to product.price or first variant
      if (!price && catalogMatch.precio != null) price = safeNumber(catalogMatch.precio);
      if (!price && catalogMatch.price != null) price = safeNumber(catalogMatch.price);
      if (!price && catalogMatch.variantes && typeof catalogMatch.variantes === "object") {
        // pick mediana if exists, else first numeric variant
        price = Object.values(catalogMatch.variantes).find((v) => typeof v === "number") ?? 0;
      }
    } else {
      warnings.push(`Producto no encontrado en catálogo: "${name}"`);
    }

    normalized.push({
      id: catalogMatch?.id ?? p.id ?? name,
      name: catalogMatch?.name ?? name,
      quantity: qty,
      variant: p.variant || null,
      extras: p.extras || [],
      price: Number(price || 0),
      raw_parsed: p
    });
  }

  return { items: normalized, warnings };
}

/* ---------- Main handler ---------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use POST." });
  }

  const startTs = Date.now();
  const body = req.body || {};
  const { message, origin, destination, imageUrl, forceLocalCatalog } = body;

  const responsePayload = {
    ok: false,
    timestamp: now(),
    source_catalog: null,
    items: [],
    delivery: null,
    subtotal: 0,
    discounts: [],
    total: 0,
    currency: "PEN",
    warnings: [],
    raw: {
      message,
      imageUrl,
      origin,
      destination
    },
    duration_ms: 0
  };

  try {
    // 1) Load catalog (WhatsApp -> local)
    let catalog = { source: "local", products: [] };
    if (!forceLocalCatalog) {
      try {
        catalog = await fetchWhatsAppCatalog();
      } catch (err) {
        // fallback to local
        responsePayload.warnings.push(`WhatsApp catalog fetch failed: ${err.message}. Falling back to local menu.json.`);
        try {
          catalog = await readLocalMenu();
        } catch (localErr) {
          // If local also fails, throw
          throw new Error(`Both WhatsApp and local catalog failed: ${localErr.message}`);
        }
      }
    } else {
      // forced local
      catalog = await readLocalMenu();
    }
    responsePayload.source_catalog = catalog.source;

    // 2) Obtain text: prefer explicit message; if empty and imageUrl provided, OCR
    let finalText = (message || "").toString().trim();
    let ocrResult = null;
    if (!finalText && imageUrl) {
      try {
        ocrResult = await readImage(imageUrl);
        // readImage returns structured object or string depending on implementation; handle both
        if (typeof ocrResult === "string") finalText = ocrResult;
        else if (ocrResult && ocrResult.text) finalText = ocrResult.text;
        responsePayload.raw.ocr = ocrResult;
      } catch (err) {
        responsePayload.warnings.push(`OCR failed: ${err.message}`);
      }
    }

    if (!finalText) {
      responsePayload.warnings.push("No message text or OCR result available to parse order.");
      // Return helpful response but not an error
      responsePayload.ok = true;
      responsePayload.duration_ms = Date.now() - startTs;
      return res.status(200).json(responsePayload);
    }

    // 3) Parse order text into items using parseOrderText (user-provided)
    let parsedItems = [];
    try {
      // parseOrderText should return array of { name, quantity, variant, extras, id? }
      parsedItems = await parseOrderText(finalText, catalog.products || []);
      if (!Array.isArray(parsedItems)) {
        // If parser returns object with items property
        parsedItems = parsedItems?.items || [];
      }
    } catch (err) {
      // If parser fails, attempt a minimal fallback: try to extract simple patterns (not implemented here)
      responsePayload.warnings.push(`Order parser error: ${err.message}.`);
      parsedItems = [];
    }

    // 4) Normalize parsed items against catalog
    const { items: normalizedItems, warnings: normWarnings } = normalizeParsedItems(parsedItems, catalog.products || []);
    responsePayload.warnings.push(...normWarnings);
    responsePayload.items = normalizedItems;

    // 5) Calculate delivery route/price if origin & destination provided (or if origin provided and we compute to store)
    let delivery = null;
    try {
      // calculateRoute should accept origin,destination and return { distance_km, duration_min, price, route }
      if (origin && destination) {
        delivery = await calculateRoute(origin, destination);
      } else if (origin && !destination) {
        // If only origin provided, attempt to compute to known store location (route-price.js may handle)
        delivery = await calculateRoute(origin, null);
      } else if (!origin && destination) {
        delivery = await calculateRoute(null, destination);
      }
      // Ensure numeric price
      if (delivery && typeof delivery.price !== "number") {
        delivery.price = safeNumber(delivery.price);
      }
    } catch (err) {
      responsePayload.warnings.push(`Route calculation failed: ${err.message}`);
      delivery = null;
    }
    responsePayload.delivery = delivery;

    // 6) Compute subtotal and apply promos
    const subtotalRaw = normalizedItems.reduce((s, it) => s + safeNumber(it.price) * safeNumber(it.quantity), 0);
    // Apply promos (function returns adjusted subtotal and discounts)
    const promoResult = applyPromosAndCalculate(normalizedItems);
    // If promoResult.subtotal differs, use it; else fallback to computed subtotal
    const subtotal = promoResult.subtotal != null ? promoResult.subtotal : subtotalRaw;
    const discounts = promoResult.discounts || [];

    // 7) Compute total (subtotal + delivery price)
    const deliveryPrice = delivery?.price ? safeNumber(delivery.price) : 0;
    const total = Number((subtotal + deliveryPrice).toFixed(2));

    // 8) Fill response
    responsePayload.ok = true;
    responsePayload.items = normalizedItems;
    responsePayload.subtotal = Number(subtotal.toFixed(2));
    responsePayload.discounts = discounts;
    responsePayload.total = total;
    responsePayload.currency = "PEN";
    responsePayload.duration_ms = Date.now() - startTs;

    // 9) Return structured response
    return res.status(200).json(responsePayload);
  } catch (err) {
    // Log error server-side and return structured fallback
    console.error("order-full error:", err);
    responsePayload.ok = false;
    responsePayload.error = err.message || String(err);
    responsePayload.duration_ms = Date.now() - startTs;
    return res.status(500).json(responsePayload);
  }
}