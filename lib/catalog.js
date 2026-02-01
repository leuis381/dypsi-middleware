import axios from "axios";
import fs from "fs/promises";
import path from "path";

/**
 * Vercel API handler: robust WhatsApp Business catalog proxy with local fallback.
 * - Tries WhatsApp Business Graph API first (if enabled and env vars present)
 * - Supports pagination, retries with exponential backoff, timeout
 * - In-memory cache with TTL to reduce external calls
 * - Fallback to local menu.json when WhatsApp fails or when requested via query param
 * - Normalizes response shape and returns metadata for middleware/consumers
 *
 * Usage:
 *  GET /api/catalog?source=whatsapp|local|auto
 *  Default: source=auto (try WhatsApp, fallback to local)
 *
 * Environment variables required for WhatsApp:
 *  - WHATSAPP_BUSINESS_ID
 *  - WHATSAPP_TOKEN
 *
 * Deploy notes:
 *  - Place a synchronized menu.json at the project root or adjust LOCAL_MENU_PATH
 *  - This file is safe to run on Vercel (Node 18+). Keep tokens in Vercel env.
 */

/* ---------- Configuration ---------- */
const LOCAL_MENU_PATH = path.resolve(process.cwd(), "menu.json");
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes
const AXIOS_TIMEOUT_MS = 10_000; // 10s
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300; // exponential backoff base

/* ---------- In-memory cache ---------- */
let cache = {
  data: null,
  source: null,
  expiresAt: 0
};

/* ---------- Helpers ---------- */
const now = () => Date.now();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnvWhatsAppReady() {
  return Boolean(process.env.WHATSAPP_BUSINESS_ID && process.env.WHATSAPP_TOKEN);
}

function normalizeWhatsAppProduct(raw) {
  // Normalize the Graph API product object into our internal schema.
  // Graph product fields vary; we map common ones and keep metadata.
  return {
    id: raw.id || null,
    name: raw.name || raw.title || null,
    description: raw.description || null,
    price: raw.price || null,
    currency: raw.currency || null,
    images: Array.isArray(raw.images) ? raw.images : raw.image ? [raw.image] : [],
    metadata: raw, // keep raw object for debugging/inspection
  };
}

async function readLocalMenu() {
  try {
    const content = await fs.readFile(LOCAL_MENU_PATH, "utf8");
    const parsed = JSON.parse(content);
    // If menu.json follows the "categorias" structure, flatten to products array for consumers
    if (parsed && Array.isArray(parsed.categorias)) {
      const products = [];
      for (const cat of parsed.categorias) {
        if (Array.isArray(cat.productos)) {
          for (const p of cat.productos) {
            products.push({
              ...p,
              categoria: cat.id || cat.nombre || null
            });
          }
        }
      }
      return { source: "local", products, raw: parsed };
    }
    // Otherwise return parsed as products if it's an array or object
    if (Array.isArray(parsed)) return { source: "local", products: parsed, raw: parsed };
    return { source: "local", products: [parsed], raw: parsed };
  } catch (err) {
    throw new Error(`Failed to read local menu.json: ${err.message}`);
  }
}

async function fetchWhatsAppProducts({ limit = 100, fields = null } = {}) {
  if (!isEnvWhatsAppReady()) {
    throw new Error("WhatsApp environment variables not configured");
  }

  const businessId = process.env.WHATSAPP_BUSINESS_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const baseUrl = `https://graph.facebook.com/v18.0/${businessId}/products`;

  const axiosInstance = axios.create({
    timeout: AXIOS_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  let allProducts = [];
  let url = baseUrl;
  let params = {};
  if (limit) params.limit = limit;
  if (fields) params.fields = fields;

  // Pagination loop with retries per request
  while (url) {
    let attempt = 0;
    let success = false;
    let response = null;

    while (attempt < MAX_RETRIES && !success) {
      try {
        response = await axiosInstance.get(url, { params });
        success = true;
      } catch (err) {
        attempt++;
        const isLast = attempt >= MAX_RETRIES;
        const status = err?.response?.status;
        // If 4xx (client) error, don't retry
        if (status && status >= 400 && status < 500) {
          throw new Error(`WhatsApp API returned ${status}: ${err?.response?.data?.error?.message || err.message}`);
        }
        // Exponential backoff
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
        if (isLast) {
          throw new Error(`WhatsApp API request failed after ${MAX_RETRIES} attempts: ${err.message}`);
        }
      }
    }

    const data = response?.data;
    if (!data) break;

    // Graph API typically returns data array and paging.next
    const items = Array.isArray(data.data) ? data.data : [];
    allProducts.push(...items);

    // Determine next page URL
    const nextUrl = data?.paging?.next || null;
    if (nextUrl) {
      url = nextUrl;
      // Clear params for nextUrl (it already contains query)
      params = {};
    } else {
      url = null;
    }
  }

  // Normalize
  const normalized = allProducts.map(normalizeWhatsAppProduct);
  return { source: "whatsapp", products: normalized, raw: allProducts };
}

/* ---------- Main handler ---------- */
export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use GET." });
  }

  // Query params: source=whatsapp|local|auto, forceRefresh=true
  const sourceParam = (req.query.source || "auto").toString().toLowerCase();
  const forceRefresh = req.query.forceRefresh === "true" || req.query.refresh === "true";

  // Validate cache
  if (!forceRefresh && cache.data && cache.expiresAt > now()) {
    // If client requested a specific source and cache source doesn't match, continue to fetch
    if (sourceParam === "auto" || sourceParam === cache.source) {
      return res.status(200).json({
        ok: true,
        source: cache.source,
        cached: true,
        products: cache.data,
        meta: { ttl_ms: cache.expiresAt - now() }
      });
    }
  }

  // Decide source order
  const tryWhatsAppFirst = sourceParam === "whatsapp" || sourceParam === "auto";
  const tryLocalFirst = sourceParam === "local";

  // Helper to set cache
  function setCache(source, products) {
    cache = {
      data: products,
      source,
      expiresAt: now() + CACHE_TTL_MS
    };
  }

  // Attempt fetching
  let result = { ok: false, source: null, products: [], error: null, cached: false };

  // If explicitly local, return local menu
  if (tryLocalFirst) {
    try {
      const local = await readLocalMenu();
      setCache(local.source, local.products);
      result = { ok: true, source: local.source, products: local.products, cached: false };
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: `Local menu read error: ${err.message}` });
    }
  }

  // Try WhatsApp first (auto or whatsapp)
  if (tryWhatsAppFirst) {
    if (isEnvWhatsAppReady()) {
      try {
        const wa = await fetchWhatsAppProducts({ limit: 100, fields: "id,name,description,images" });
        setCache(wa.source, wa.products);
        result = { ok: true, source: wa.source, products: wa.products, cached: false };
        return res.status(200).json(result);
      } catch (err) {
        // Log and fallback to local
        console.error("WhatsApp fetch error:", err.message || err);
        // continue to fallback
      }
    } else {
      console.warn("WhatsApp env not configured; falling back to local menu.");
    }
  }

  // Fallback to local menu.json
  try {
    const local = await readLocalMenu();
    setCache(local.source, local.products);
    result = { ok: true, source: local.source, products: local.products, cached: false };
    return res.status(200).json(result);
  } catch (err) {
    // If local also fails, return error
    console.error("Local menu read error:", err.message || err);
    return res.status(500).json({
      ok: false,
      error: `Failed to fetch catalog from WhatsApp and local fallback failed: ${err.message}`,
      products: []
    });
  }
}