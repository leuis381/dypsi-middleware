import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { parseOrderText } from "./parse-order.js";
import { calculateRoute } from "./route-price.js";
import { readImage } from "./ocr.js";
import {
  logger,
  AppError,
  ValidationError,
  NotFoundError,
  validateAmount,
  sanitizeInput,
  retryAsync,
  MetricsCollector,
  RateLimiter,
  isEmpty
} from "./utils.js";

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
 * @module order-full
 * 
 * Expected req.body:
 * @typedef {Object} OrderRequest
 * @property {string} [message] - Order text (e.g., "Quiero 1 pizza barbecue mediana y 2 alitas 6und")
 * @property {Object|string} [origin] - Origin location as {lat, lon} or address string
 * @property {Object|string} [destination] - Destination location as {lat, lon} or address string
 * @property {string} [imageUrl] - Optional image URL for OCR processing
 * @property {boolean} [forceLocalCatalog] - Force use of local menu.json
 * 
 * @example
 * POST /api/order-full
 * {
 *   "message": "Quiero 1 pizza barbecue mediana y 2 alitas 6und",
 *   "origin": { "lat": -12.0, "lon": -77.0 },
 *   "destination": { "lat": -12.1, "lon": -77.1 }
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

/* ---------- Rate Limiter for WhatsApp API ---------- */
const whatsappRateLimiter = new RateLimiter(50, 60 * 1000); // 50 requests per minute

/* ---------- Metrics Collector ---------- */
const metrics = new MetricsCollector();

/* ---------- Helpers ---------- */
/**
 * Get current timestamp in ISO format
 * @returns {string} ISO timestamp
 */
function now() {
  return new Date().toISOString();
}

/**
 * Safely convert value to number, returning 0 if invalid
 * @param {*} n - Value to convert
 * @returns {number} Safe number
 */
function safeNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Validate location object or string
 * @param {Object|string} location - Location as {lat, lon} or address string
 * @param {string} fieldName - Field name for error messages
 * @throws {ValidationError} If location is invalid
 */
function validateLocation(location, fieldName) {
  if (!location) return;
  
  if (typeof location === 'string') {
    if (location.trim().length === 0) {
      throw new ValidationError(`${fieldName} address cannot be empty`, { field: fieldName });
    }
    return;
  }
  
  if (typeof location === 'object') {
    if (location.lat === undefined || location.lon === undefined) {
      throw new ValidationError(`${fieldName} must have lat and lon properties`, { field: fieldName });
    }
    
    const lat = parseFloat(location.lat);
    const lon = parseFloat(location.lon);
    
    if (isNaN(lat) || lat < -90 || lat > 90) {
      throw new ValidationError(`${fieldName} latitude must be between -90 and 90`, { 
        field: `${fieldName}.lat`, 
        value: location.lat 
      });
    }
    
    if (isNaN(lon) || lon < -180 || lon > 180) {
      throw new ValidationError(`${fieldName} longitude must be between -180 and 180`, { 
        field: `${fieldName}.lon`, 
        value: location.lon 
      });
    }
    return;
  }
  
  throw new ValidationError(`${fieldName} must be an object with lat/lon or a string address`, { 
    field: fieldName 
  });
}

/**
 * Fetch WhatsApp Business catalog with retry logic
 * @returns {Promise<Object>} Catalog object with source and products
 * @throws {AppError} If fetch fails after retries
 */

async function fetchWhatsAppCatalog() {
  logger.debug('Attempting to fetch WhatsApp catalog');
  
  if (!process.env.WHATSAPP_BUSINESS_ID || !process.env.WHATSAPP_TOKEN) {
    logger.warn('WhatsApp credentials not configured');
    throw new AppError("WhatsApp credentials not configured", 500, 'WHATSAPP_CONFIG_MISSING');
  }

  const businessId = process.env.WHATSAPP_BUSINESS_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const url = `https://graph.facebook.com/v18.0/${businessId}/products`;

  // Check rate limit
  try {
    const rateLimitInfo = whatsappRateLimiter.checkLimit('whatsapp_api');
    logger.debug('WhatsApp API rate limit check:', rateLimitInfo);
  } catch (error) {
    logger.warn('WhatsApp API rate limit exceeded');
    metrics.record('catalog_fetch', 1, { source: 'whatsapp', result: 'rate_limited' });
    throw error;
  }

  const axiosInstance = axios.create({
    timeout: WHATSAPP_API_TIMEOUT,
    headers: { Authorization: `Bearer ${token}` }
  });

  // Use retryAsync instead of manual retry loop
  try {
    const result = await retryAsync(
      async () => {
        logger.debug('Fetching WhatsApp catalog from:', url);
        const r = await axiosInstance.get(url);
        
        // Validate response structure
        if (!r.data) {
          throw new AppError('WhatsApp API returned empty response', 500, 'WHATSAPP_EMPTY_RESPONSE');
        }
        
        const data = r?.data?.data || [];
        logger.info(`WhatsApp catalog fetched successfully: ${data.length} products`);
        
        // Normalize minimal fields
        const products = data.map((p) => ({
          id: p.id || p.product_id || null,
          name: p.name || p.title || null,
          description: p.description || null,
          raw: p
        }));
        
        metrics.record('catalog_fetch', 1, { source: 'whatsapp', result: 'success' });
        return { source: "whatsapp", products, raw: data };
      },
      {
        maxRetries: WHATSAPP_MAX_RETRIES,
        initialDelayMs: 200,
        maxDelayMs: 2000,
        shouldRetry: (err) => {
          // Only retry on network errors, not on validation or auth errors
          const retryableCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'];
          const isNetworkError = retryableCodes.includes(err.code);
          const isServerError = err.response?.status >= 500;
          return isNetworkError || isServerError;
        }
      }
    );
    
    return result;
  } catch (err) {
    logger.error('WhatsApp catalog fetch failed after retries:', err.message);
    metrics.record('catalog_fetch', 1, { source: 'whatsapp', result: 'failed' });
    throw new AppError(`WhatsApp catalog fetch failed: ${err.message || err}`, 500, 'WHATSAPP_FETCH_FAILED');
  }
}

/**
 * Read local menu.json file with retry logic
 * @returns {Promise<Object>} Menu object with source and products
 * @throws {AppError} If local menu read fails
 */
async function readLocalMenu() {
  logger.debug('Reading local menu from:', LOCAL_MENU_PATH);
  
  try {
    const result = await retryAsync(
      async () => {
        const content = await fs.readFile(LOCAL_MENU_PATH, "utf8");
        
        if (!content || content.trim().length === 0) {
          throw new AppError('Local menu file is empty', 500, 'MENU_EMPTY');
        }
        
        const parsed = JSON.parse(content);
        
        // Validate parsed structure
        if (!parsed) {
          throw new AppError('Local menu file has invalid JSON', 500, 'MENU_INVALID');
        }
        
        logger.info('Local menu loaded successfully');
        
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
          metrics.record('catalog_fetch', 1, { source: 'local', result: 'success' });
          return { source: "local", products, raw: parsed };
        }
        // If parsed is array of products
        if (Array.isArray(parsed)) {
          metrics.record('catalog_fetch', 1, { source: 'local', result: 'success' });
          return { source: "local", products: parsed, raw: parsed };
        }
        // Otherwise wrap object
        metrics.record('catalog_fetch', 1, { source: 'local', result: 'success' });
        return { source: "local", products: [parsed], raw: parsed };
      },
      {
        maxRetries: 2,
        initialDelayMs: 100,
        maxDelayMs: 500,
        shouldRetry: (err) => {
          // Retry on file system errors but not on JSON parse errors
          return err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EMFILE';
        }
      }
    );
    
    return result;
  } catch (err) {
    logger.error('Local menu read failed:', err.message);
    metrics.record('catalog_fetch', 1, { source: 'local', result: 'failed' });
    throw new AppError(`Local menu read error: ${err.message || err}`, 500, 'MENU_READ_FAILED');
  }
}

/**
 * Apply promotional rules and calculate pricing
 * @param {Array} items - Parsed order items
 * @param {Object} [rules] - Optional promo rules
 * @returns {Object} Result with items, discounts, subtotal, total
 */
function applyPromosAndCalculate(items, rules = {}) {
  // items: [{ id, name, price, quantity, variant, extras }]
  // rules: optional rules object (not required here)
  logger.debug('Applying promo rules to', items.length, 'items');
  
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
        logger.info(`Applied combo_burger_pepsi: ${combos} combos, discount: ${totalDiscount.toFixed(2)}`);
        metrics.record('promos_applied', 1, { promo: 'combo_burger_pepsi', combos });
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
    logger.info('Detected mostro/mostrito promo item');
    metrics.record('promos_applied', 1, { promo: 'mostro' });
    result.discounts.push({
      id: "mostro_promo_note",
      description: "Mostro/Mostrito promo applied (fixed price S/11 if matched)",
      amount: 0
    });
  }

  // Track total discounts
  const totalDiscountAmount = result.discounts.reduce((sum, d) => sum + (d.amount || 0), 0);
  if (totalDiscountAmount > 0) {
    metrics.record('discounts_applied', totalDiscountAmount);
  }

  // Final total (subtotal already adjusted)
  result.total = Number(result.subtotal.toFixed(2));
  
  logger.debug('Promo calculation complete:', {
    subtotal: result.subtotal,
    discounts: result.discounts.length,
    total: result.total
  });
  
  return result;
}

/**
 * Validate and normalize parsed items against catalog
 * @param {Array} parsedItems - Items from parseOrderText
 * @param {Array} [catalogProducts] - Catalog products
 * @returns {Object} Object with normalized items and warnings
 */
function normalizeParsedItems(parsedItems, catalogProducts = []) {
  // parsedItems expected from parseOrderText: [{ name, quantity, variant, extras }]
  // catalogProducts: array with product definitions (may include price or variants)
  logger.debug('Normalizing', parsedItems?.length || 0, 'parsed items');
  
  const normalized = [];
  const warnings = [];

  // Validate input
  if (!Array.isArray(parsedItems)) {
    logger.warn('parsedItems is not an array, converting to array');
    parsedItems = parsedItems ? [parsedItems] : [];
  }

  for (const p of parsedItems || []) {
    try {
      const name = (p.name || "").toString().trim();
      
      if (!name) {
        warnings.push('Item without name found, skipping');
        continue;
      }
      
      const qty = Math.max(1, parseInt(p.quantity || 1, 10));
      
      // Validate quantity is reasonable
      if (qty > 100) {
        warnings.push(`Unusually large quantity (${qty}) for "${name}", capping at 100`);
      }
      
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
      
      // Validate price is non-negative
      if (price < 0) {
        logger.warn(`Negative price detected for "${name}", setting to 0`);
        price = 0;
      }

      normalized.push({
        id: catalogMatch?.id ?? p.id ?? name,
        name: catalogMatch?.name ?? name,
        quantity: Math.min(qty, 100), // Cap at 100
        variant: p.variant || null,
        extras: p.extras || [],
        price: Number(price || 0),
        raw_parsed: p
      });
      
    } catch (err) {
      logger.error('Error normalizing item:', err);
      warnings.push(`Error processing item: ${err.message}`);
    }
  }
  
  metrics.record('items_parsed', normalized.length);
  logger.info(`Normalized ${normalized.length} items with ${warnings.length} warnings`);

  return { items: normalized, warnings };
}

/**
 * Main order processing handler
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body
 * @param {string} [req.body.message] - Order message text
 * @param {Object|string} [req.body.origin] - Origin location
 * @param {Object|string} [req.body.destination] - Destination location
 * @param {string} [req.body.imageUrl] - Optional image URL for OCR
 * @param {boolean} [req.body.forceLocalCatalog] - Force local catalog usage
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} JSON response with order details
 * @throws {AppError} On processing errors
 * 
 * @example
 * // Request
 * POST /api/order-full
 * {
 *   "message": "1 pizza mediana y 2 alitas",
 *   "origin": { "lat": -12.0, "lon": -77.0 },
 *   "destination": { "lat": -12.1, "lon": -77.1 }
 * }
 * 
 * // Response
 * {
 *   "ok": true,
 *   "items": [...],
 *   "subtotal": 45.50,
 *   "delivery": {...},
 *   "total": 55.50,
 *   "currency": "PEN"
 * }
 */
/* ---------- Main handler ---------- */
export default async function handler(req, res) {
  const startTs = Date.now();
  
  if (req.method !== "POST") {
    logger.warn('Invalid HTTP method:', req.method);
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use POST." });
  }

  const body = req.body || {};
  const { message, origin, destination, imageUrl, forceLocalCatalog } = body;
  
  logger.info('Order processing started:', {
    hasMessage: !!message,
    messageLength: message?.length || 0,
    hasOrigin: !!origin,
    hasDestination: !!destination,
    hasImageUrl: !!imageUrl,
    forceLocalCatalog: !!forceLocalCatalog
  });

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
    // Validate request body
    if (!message && !imageUrl) {
      throw new ValidationError('Either message or imageUrl must be provided', {
        message: 'missing',
        imageUrl: 'missing'
      });
    }
    
    // Validate locations if provided
    try {
      if (origin) validateLocation(origin, 'origin');
      if (destination) validateLocation(destination, 'destination');
    } catch (err) {
      logger.error('Location validation failed:', err);
      metrics.record('order_processing', 1, { result: 'validation_error', error: 'location' });
      throw err;
    }

    // 1) Load catalog (WhatsApp -> local)
    let catalog = { source: "local", products: [] };
    if (!forceLocalCatalog) {
      try {
        logger.info('Attempting to fetch WhatsApp catalog');
        catalog = await fetchWhatsAppCatalog();
        logger.info(`WhatsApp catalog loaded: ${catalog.products.length} products`);
      } catch (err) {
        // fallback to local
        logger.warn(`WhatsApp catalog fetch failed: ${err.message}. Falling back to local menu.json.`);
        responsePayload.warnings.push(`WhatsApp catalog fetch failed: ${err.message}. Falling back to local menu.json.`);
        metrics.record('error_types', 1, { type: 'catalog_error', source: 'whatsapp' });
        
        try {
          catalog = await readLocalMenu();
          logger.info(`Local catalog loaded: ${catalog.products.length} products`);
        } catch (localErr) {
          // If local also fails, throw
          logger.error('Both WhatsApp and local catalog failed:', localErr);
          metrics.record('order_processing', 1, { result: 'catalog_error' });
          throw new AppError(`Both WhatsApp and local catalog failed: ${localErr.message}`, 500, 'CATALOG_UNAVAILABLE');
        }
      }
    } else {
      // forced local
      logger.info('Using forced local catalog');
      catalog = await readLocalMenu();
      logger.info(`Local catalog loaded: ${catalog.products.length} products`);
    }
    responsePayload.source_catalog = catalog.source;

    // 2) Obtain text: prefer explicit message; if empty and imageUrl provided, OCR
    let finalText = message ? sanitizeInput(message, 2000) : "";
    let ocrResult = null;
    
    if (!finalText && imageUrl) {
      logger.info('No message provided, attempting OCR on image:', imageUrl);
      metrics.record('ocr_used', 1);
      
      try {
        // Validate imageUrl
        if (typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
          throw new ValidationError('Invalid imageUrl', { field: 'imageUrl' });
        }
        
        ocrResult = await readImage(imageUrl);
        // readImage returns structured object or string depending on implementation; handle both
        if (typeof ocrResult === "string") {
          finalText = sanitizeInput(ocrResult, 2000);
        } else if (ocrResult && ocrResult.text) {
          finalText = sanitizeInput(ocrResult.text, 2000);
        }
        
        responsePayload.raw.ocr = ocrResult;
        logger.info('OCR completed, extracted text length:', finalText?.length || 0);
      } catch (err) {
        logger.error('OCR processing failed:', err);
        responsePayload.warnings.push(`OCR failed: ${err.message}`);
        metrics.record('error_types', 1, { type: 'ocr_error' });
      }
    }

    if (!finalText) {
      logger.warn('No message text or OCR result available');
      responsePayload.warnings.push("No message text or OCR result available to parse order.");
      // Return helpful response but not an error
      responsePayload.ok = true;
      responsePayload.duration_ms = Date.now() - startTs;
      metrics.record('order_processing', 1, { result: 'no_text' });
      return res.status(200).json(responsePayload);
    }

    // 3) Parse order text into items using parseOrderText (user-provided)
    let parsedItems = [];
    logger.info('Parsing order text, length:', finalText.length);
    
    try {
      // parseOrderText should return array of { name, quantity, variant, extras, id? }
      parsedItems = await parseOrderText(finalText, catalog.products || []);
      
      // Validate parseOrderText response
      if (!Array.isArray(parsedItems)) {
        // If parser returns object with items property
        if (parsedItems && typeof parsedItems === 'object' && parsedItems.items) {
          parsedItems = parsedItems.items;
        } else {
          logger.warn('parseOrderText returned non-array, converting:', typeof parsedItems);
          parsedItems = parsedItems ? [parsedItems] : [];
        }
      }
      
      logger.info(`Order parsed: ${parsedItems.length} items found`);
    } catch (err) {
      // If parser fails, attempt a minimal fallback: try to extract simple patterns (not implemented here)
      logger.error('Order parser error:', err);
      responsePayload.warnings.push(`Order parser error: ${err.message}.`);
      metrics.record('error_types', 1, { type: 'parsing_error' });
      parsedItems = [];
    }

    // 4) Normalize parsed items against catalog
    const { items: normalizedItems, warnings: normWarnings } = normalizeParsedItems(parsedItems, catalog.products || []);
    responsePayload.warnings.push(...normWarnings);
    responsePayload.items = normalizedItems;
    
    if (normalizedItems.length === 0) {
      logger.warn('No items were successfully parsed');
      responsePayload.warnings.push('No items could be parsed from the message');
    }

    // 5) Calculate delivery route/price if origin & destination provided (or if origin provided and we compute to store)
    let delivery = null;
    logger.debug('Calculating delivery route');
    
    try {
      // calculateRoute should accept origin,destination and return { distance_km, duration_min, price, route }
      if (origin && destination) {
        logger.info('Calculating route from origin to destination');
        delivery = await calculateRoute(origin, destination);
      } else if (origin && !destination) {
        // If only origin provided, attempt to compute to known store location (route-price.js may handle)
        logger.info('Calculating route from origin (destination will use default)');
        delivery = await calculateRoute(origin, null);
      } else if (!origin && destination) {
        logger.info('Calculating route to destination (origin will use default)');
        delivery = await calculateRoute(null, destination);
      }
      
      // Validate delivery response
      if (delivery) {
        // Ensure numeric price
        if (delivery.price !== undefined && typeof delivery.price !== "number") {
          delivery.price = safeNumber(delivery.price);
        }
        
        // Validate delivery price is reasonable
        if (delivery.price && delivery.price < 0) {
          logger.warn('Negative delivery price detected, setting to 0');
          delivery.price = 0;
        }
        
        if (delivery.price !== undefined) {
          try {
            validateAmount(delivery.price);
          } catch (err) {
            logger.warn('Invalid delivery price, setting to 0:', err.message);
            delivery.price = 0;
          }
        }
        
        logger.info('Delivery calculated:', {
          distance: delivery.distance_km,
          duration: delivery.duration_min,
          price: delivery.price
        });
        metrics.record('delivery_calculated', 1);
      }
    } catch (err) {
      logger.error('Route calculation failed:', err);
      responsePayload.warnings.push(`Route calculation failed: ${err.message}`);
      metrics.record('error_types', 1, { type: 'route_error' });
      delivery = null;
    }
    responsePayload.delivery = delivery;

    // 6) Compute subtotal and apply promos
    const subtotalRaw = normalizedItems.reduce((s, it) => s + safeNumber(it.price) * safeNumber(it.quantity), 0);
    logger.debug('Raw subtotal before promos:', subtotalRaw);
    
    // Apply promos (function returns adjusted subtotal and discounts)
    const promoResult = applyPromosAndCalculate(normalizedItems);
    // If promoResult.subtotal differs, use it; else fallback to computed subtotal
    const subtotal = promoResult.subtotal != null ? promoResult.subtotal : subtotalRaw;
    const discounts = promoResult.discounts || [];

    // Validate subtotal
    try {
      if (subtotal > 0) {
        validateAmount(subtotal);
      }
    } catch (err) {
      logger.error('Invalid subtotal:', err);
      throw new ValidationError(`Invalid subtotal calculated: ${err.message}`, { subtotal });
    }

    // 7) Compute total (subtotal + delivery price)
    const deliveryPrice = delivery?.price ? safeNumber(delivery.price) : 0;
    const total = Number((subtotal + deliveryPrice).toFixed(2));
    
    // Validate total
    if (total < 0) {
      logger.error('Negative total calculated:', total);
      throw new ValidationError('Invalid total: must be greater than 0', { total });
    }
    
    logger.info('Order calculation complete:', {
      subtotal,
      deliveryPrice,
      discounts: discounts.length,
      total,
      items: normalizedItems.length
    });

    // 8) Fill response
    responsePayload.ok = true;
    responsePayload.items = normalizedItems;
    responsePayload.subtotal = Number(subtotal.toFixed(2));
    responsePayload.discounts = discounts;
    responsePayload.total = total;
    responsePayload.currency = "PEN";
    responsePayload.duration_ms = Date.now() - startTs;
    
    metrics.record('order_processing', 1, { result: 'success' });
    metrics.record('processing_duration', responsePayload.duration_ms);
    
    logger.info(`Order processing completed successfully in ${responsePayload.duration_ms}ms`);

    // 9) Return structured response
    return res.status(200).json(responsePayload);
  } catch (err) {
    // Log error server-side and return structured fallback
    logger.error('order-full error:', err);
    
    responsePayload.ok = false;
    responsePayload.duration_ms = Date.now() - startTs;
    
    // Handle different error types
    if (err instanceof ValidationError) {
      responsePayload.error = err.message;
      responsePayload.error_code = err.code;
      responsePayload.error_details = err.details;
      metrics.record('order_processing', 1, { result: 'validation_error' });
      return res.status(err.statusCode).json(responsePayload);
    } else if (err instanceof AppError) {
      responsePayload.error = err.message;
      responsePayload.error_code = err.code;
      metrics.record('order_processing', 1, { result: 'error', code: err.code });
      return res.status(err.statusCode).json(responsePayload);
    } else {
      responsePayload.error = err.message || String(err);
      responsePayload.error_code = 'INTERNAL_ERROR';
      metrics.record('order_processing', 1, { result: 'error', type: 'unknown' });
      return res.status(500).json(responsePayload);
    }
  }
}