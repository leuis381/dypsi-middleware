/**
 * lib/ocr.js
 *
 * Versión ultrarobusta del OCR helper para DYPSI middleware.
 * - Soporta Google Vision REST y OCR.Space (fallback).
 * - readImage(imageUrl, options)
 * - readImageBuffer(buffer, filename, options)
 * - extractMostLikelyTotal(ocrResult)
 * - detectYapeAccountInText(text, knownAccounts)
 * - validateReceiptAgainstOrder(ocrResult, order, menu, options)
 * - parseWhatsAppCatalogSnippet(text, menu) -> intenta mapear texto de catálogo de WhatsApp a productos
 *
 * ENV:
 *  - GOOGLE_API_KEY
 *  - OCR_API_KEY
 *
 * Opciones comunes:
 *  - languageHints: ["es"]
 *  - debug: true
 *  - providersOrder: ["google_vision","ocr.space"]
 *
 * Notas:
 *  - Diseñado para integrarse con parse-order.js y zoma-precios.js
 *  - Devuelve objetos con campos: { provider, text, amounts, operationNumbers, accountNumbers, confidence, raw, diagnostics }
 */

import axios from "axios";
import FormData from "form-data";

/* ---------- Configuración ---------- */
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 200;
const OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image";
const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

/* ---------- Utilidades ---------- */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidUrl(s) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function safeNumberParse(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(s) {
  if (!s) return "";
  return s.toString().replace(/\r/g, " ").replace(/\t/g, " ").replace(/\u00A0/g, " ").trim();
}

function normalizeForSearch(s) {
  if (!s) return "";
  return s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function roundTo(value, step = 0.01) {
  const factor = 1 / step;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/* ---------- Extracción de montos y números ---------- */

/**
 * extractAmountsFromText
 * - Detecta montos en distintos formatos: "S/ 24.00", "24.00", "24", "PEN 24.00", "$ 12.50"
 * - Devuelve array de objetos { raw, value, currencyHint, index }
 */
function extractAmountsFromTextWithPositions(text) {
  if (!text) return [];
  const results = [];
  const patterns = [
    // S/ 24.00, S/.24, s/24
    { re: /(?:S\/|S\.\/|s\/|s\.\/)\s*([0-9]{1,3}(?:[.,][0-9]{2})?)/g, currency: "PEN" },
    // PEN 24.00
    { re: /\b(PEN|PEN\.)\s*([0-9]{1,3}(?:[.,][0-9]{2})?)/gi, currency: "PEN", group: 2 },
    // $ 12.50 or USD 12.50
    { re: /(?:\$|USD|usd)\s*([0-9]{1,3}(?:[.,][0-9]{2})?)/g, currency: "USD" },
    // generic decimal with currency word after or before
    { re: /([0-9]{1,3}(?:[.,][0-9]{2}))\s*(?:soles|S\/|s\/|PEN|USD|\$)?/gi, currency: null },
    // integers (careful)
    { re: /([0-9]{1,6})\s*(?:soles|S\/|s\/|PEN|USD|\$)?/gi, currency: null }
  ];

  for (const pat of patterns) {
    let m;
    while ((m = pat.re.exec(text)) !== null) {
      const groupIndex = pat.group || 1;
      const raw = m[groupIndex];
      const parsed = safeNumberParse(raw);
      if (parsed !== null) {
        results.push({
          raw: raw,
          value: parsed,
          currencyHint: pat.currency || null,
          index: m.index
        });
      }
    }
  }

  // deduplicate by value+index
  const uniq = [];
  const seen = new Set();
  for (const r of results) {
    const key = `${r.value}@${r.index}`;
    if (!seen.has(key)) {
      uniq.push(r);
      seen.add(key);
    }
  }

  // sort descending by value (heurística: total suele ser mayor)
  uniq.sort((a, b) => b.value - a.value);
  return uniq;
}

/* ---------- Extracción de números largos (operaciones / cuentas) ---------- */
function extractNumbersFromText(text) {
  if (!text) return { operations: [], accounts: [] };
  const operations = new Set();
  const accounts = new Set();
  const regex = /([0-9]{6,20})/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const num = m[1];
    if (num.length >= 9 && num.length <= 11) accounts.add(num);
    else if (num.length >= 6 && num.length <= 20) operations.add(num);
  }
  return {
    operations: Array.from(operations),
    accounts: Array.from(accounts)
  };
}

/* ---------- Heurísticas de confianza y validación ---------- */

/**
 * scoreAmountConfidence
 * - Dado un monto detectado y el contexto (línea, surrounding text), devuelve score 0-1
 */
function scoreAmountConfidence(amountObj, surroundingText = "") {
  let score = 0.5;
  if (!amountObj) return 0;
  // mayor valor -> más probable que sea total (heurística)
  if (amountObj.value > 50) score += 0.2;
  if (amountObj.currencyHint) score += 0.15;
  // si aparece la palabra "total" cerca del índice, subir confianza
  const ctx = surroundingText.toLowerCase();
  if (ctx.includes("total") || ctx.includes("importe") || ctx.includes("monto") || ctx.includes("pagado") || ctx.includes("saldo")) score += 0.25;
  // si aparece "subtotal" cerca, bajar un poco (podría no ser total)
  if (ctx.includes("subtotal")) score -= 0.15;
  // clamp
  if (score > 1) score = 1;
  if (score < 0) score = 0;
  return Number(score.toFixed(2));
}

/* ---------- OCR Provider: OCR.Space ---------- */

async function ocrSpaceRequest({ imageUrl = null, buffer = null, filename = "upload.jpg", language = "spa", debug = false }) {
  if (!process.env.OCR_API_KEY) {
    throw new Error("OCR_SPACE_API_KEY_NOT_CONFIGURED");
  }

  const form = new FormData();
  form.append("apikey", process.env.OCR_API_KEY);
  form.append("language", language);
  form.append("isOverlayRequired", "true"); // overlay gives positional info
  form.append("OCREngine", "2");
  form.append("detectOrientation", "true");

  if (imageUrl) {
    form.append("url", imageUrl);
  } else if (buffer) {
    form.append("file", buffer, { filename });
  } else {
    throw new Error("No image provided to ocrSpaceRequest");
  }

  const headers = { ...form.getHeaders() };
  const axiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const r = await axiosInstance.post(OCR_SPACE_ENDPOINT, form, { headers });
      const data = r.data;
      const parsedText = data?.ParsedResults?.map(p => p.ParsedText).join("\n") || "";
      const overlay = data?.ParsedResults?.[0]?.TextOverlay || null;
      const exitCode = data?.OCRExitCode;
      const success = exitCode === 1 || exitCode === 2 || exitCode === 3;
      if (!success) {
        const errMsg = data?.ErrorMessage || JSON.stringify(data);
        throw new Error(`OCR.Space error: ${errMsg}`);
      }
      return { text: parsedText, raw: data, confidence: null, provider: "ocr.space", overlay };
    } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES) throw err;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      if (debug) console.warn(`ocrSpaceRequest attempt ${attempt} failed:`, err.message || err);
      await sleep(delay);
    }
  }
}

/* ---------- OCR Provider: Google Vision REST ---------- */

async function googleVisionRequest({ imageUrl = null, buffer = null, filename = "upload.jpg", languageHints = ["es"], debug = false }) {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY_NOT_CONFIGURED");
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `${GOOGLE_VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    requests: [
      {
        image: {},
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: {}
      }
    ]
  };

  if (imageUrl) {
    requestBody.requests[0].image.source = { imageUri: imageUrl };
  } else if (buffer) {
    requestBody.requests[0].image.content = buffer.toString("base64");
  } else {
    throw new Error("No image provided to googleVisionRequest");
  }

  if (languageHints && languageHints.length) {
    requestBody.requests[0].imageContext.languageHints = languageHints;
  }

  const axiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const r = await axiosInstance.post(url, requestBody, {
        headers: { "Content-Type": "application/json" }
      });
      const data = r.data;
      const annotation = data?.responses?.[0]?.fullTextAnnotation || data?.responses?.[0]?.textAnnotations?.[0];
      const text = annotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || "";
      // Google provides page/block/paragraph/word bounding boxes in fullTextAnnotation
      const confidence = null; // Google doesn't always provide a single confidence for fullTextAnnotation
      return { text, raw: data, confidence, provider: "google_vision", annotation };
    } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES) throw err;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      if (debug) console.warn(`googleVisionRequest attempt ${attempt} failed:`, err.message || err);
      await sleep(delay);
    }
  }
}

/* ---------- Public API: readImage / readImageBuffer ---------- */

/**
 * readImage(imageUrl, options)
 * - options: { languageHints, providersOrder, debug }
 */
export async function readImage(imageUrl, options = {}) {
  const debug = !!options.debug;
  if (!imageUrl || typeof imageUrl !== "string" || !isValidUrl(imageUrl)) {
    throw new Error("Invalid imageUrl provided to readImage");
  }

  const providersOrder = options.providersOrder || (process.env.GOOGLE_API_KEY ? ["google_vision", "ocr.space"] : ["ocr.space", "google_vision"]);
  const diagnostics = { providersTried: [], attempts: [] };

  for (const provider of providersOrder) {
    try {
      diagnostics.providersTried.push(provider);
      if (provider === "google_vision" && process.env.GOOGLE_API_KEY) {
        const res = await googleVisionRequest({ imageUrl, languageHints: options.languageHints || ["es"], debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerAnnotation: res.annotation, providerOverlay: res.overlay || null, providersOrder };
        return built;
      }
      if (provider === "ocr.space" && process.env.OCR_API_KEY) {
        const res = await ocrSpaceRequest({ imageUrl, language: options.language || "spa", debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerOverlay: res.overlay || null, providersOrder };
        return built;
      }
    } catch (err) {
      diagnostics.attempts.push({ provider, error: err.message || String(err) });
      if (debug) console.warn(`Provider ${provider} failed:`, err.message || err);
      // continue to next provider
    }
  }

  throw new Error(`No OCR provider succeeded. Providers tried: ${providersOrder.join(", ")}`);
}

/**
 * readImageBuffer(buffer, filename, options)
 */
export async function readImageBuffer(buffer, filename = "upload.jpg", options = {}) {
  const debug = !!options.debug;
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Invalid buffer provided to readImageBuffer");
  }

  const providersOrder = options.providersOrder || (process.env.GOOGLE_API_KEY ? ["google_vision", "ocr.space"] : ["ocr.space", "google_vision"]);
  const diagnostics = { providersTried: [], attempts: [] };

  for (const provider of providersOrder) {
    try {
      diagnostics.providersTried.push(provider);
      if (provider === "google_vision" && process.env.GOOGLE_API_KEY) {
        const res = await googleVisionRequest({ buffer, filename, languageHints: options.languageHints || ["es"], debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerAnnotation: res.annotation, providersOrder };
        return built;
      }
      if (provider === "ocr.space" && process.env.OCR_API_KEY) {
        const res = await ocrSpaceRequest({ buffer, filename, language: options.language || "spa", debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerOverlay: res.overlay || null, providersOrder };
        return built;
      }
    } catch (err) {
      diagnostics.attempts.push({ provider, error: err.message || String(err) });
      if (debug) console.warn(`Provider ${provider} failed:`, err.message || err);
    }
  }

  throw new Error(`No OCR provider succeeded for buffer. Providers tried: ${providersOrder.join(", ")}`);
}

/* ---------- Resultado normalizado ---------- */

/**
 * buildResultObject({ provider, rawText, rawResponse, confidence })
 * - Normaliza texto, extrae montos y números, y devuelve estructura consistente.
 */
function buildResultObject({ provider, rawText, rawResponse, confidence = null, debug = false }) {
  const text = normalizeText(rawText || "");
  const amountsWithPos = extractAmountsFromTextWithPositions(text);
  const amounts = amountsWithPos.map(a => a.value);
  const { operations, accounts } = extractNumbersFromText(text);

  // compute amount confidences
  const amountsDetailed = amountsWithPos.map(a => {
    const surrounding = text.slice(Math.max(0, a.index - 40), Math.min(text.length, a.index + 40));
    const score = scoreAmountConfidence(a, surrounding);
    return { raw: a.raw, value: a.value, currencyHint: a.currencyHint, index: a.index, confidence: score, surrounding };
  });

  // heurística para total: preferir mayor valor con palabra total cerca
  let mostLikely = null;
  if (amountsDetailed.length) {
    // if any amount has "total" in surrounding, pick highest-scored among them
    const withTotal = amountsDetailed.filter(a => /total|importe|pagado|monto|saldo/i.test(a.surrounding));
    if (withTotal.length) {
      withTotal.sort((x, y) => (y.confidence + y.value / 1000) - (x.confidence + x.value / 1000));
      mostLikely = withTotal[0];
    } else {
      // otherwise pick largest value but consider confidence
      amountsDetailed.sort((x, y) => (y.value * (y.confidence + 0.5)) - (x.value * (x.confidence + 0.5)));
      mostLikely = amountsDetailed[0];
    }
  }

  const result = {
    provider,
    text,
    amounts: amountsDetailed,
    mostLikelyTotal: mostLikely ? { value: mostLikely.value, currencyHint: mostLikely.currencyHint, confidence: mostLikely.confidence } : null,
    operationNumbers: operations,
    accountNumbers: accounts,
    confidence,
    raw: rawResponse || null,
    timestamp: new Date().toISOString()
  };

  if (debug) {
    result.diagnostics = {
      amountsWithPos,
      amountsDetailed,
      heuristics: {
        chosenMostLikely: mostLikely ? mostLikely.raw : null
      }
    };
  }

  return result;
}

/* ---------- Utilities: detectYapeAccountInText ---------- */

export function detectYapeAccountInText(text, knownAccounts = []) {
  const { operations, accounts } = extractNumbersFromText(text || "");
  const matches = accounts || [];
  const matchedKnown = matches.filter((n) => knownAccounts.includes(n));
  return { matches, matchedKnown };
}

/* ---------- Validate receipt against order & catalog ---------- */

/**
 * validateReceiptAgainstOrder(ocrResult, order, menu, options)
 *
 * - ocrResult: output of readImage/readImageBuffer
 * - order: { items: [{ id, quantity, variant, unitPrice?, price? }], expectedTotal? }
 * - menu: menu JSON (data/menu.json) to resolve prices if needed
 * - options:
 *    - tolerance: relative tolerance (e.g., 0.05 = 5%)
 *    - requireExactMatch: boolean (if true, require amounts to match)
 *    - debug: boolean
 *
 * Returns:
 *  {
 *    ok: boolean,
 *    detectedTotal: number|null,
 *    expectedTotal: number|null,
 *    difference: number|null,
 *    differencePct: number|null,
 *    verdict: "match"|"close"|"mismatch"|"no_amount_detected",
 *    notes: [],
 *    diagnostics: {}
 *  }
 */
export function validateReceiptAgainstOrder(ocrResult, order = {}, menu = null, options = {}) {
  const debug = !!options.debug;
  const tolerance = typeof options.tolerance === "number" ? options.tolerance : 0.06; // 6% default
  const requireExactMatch = !!options.requireExactMatch;

  const diagnostics = { steps: [] };

  // compute expected total from order if not provided
  let expectedTotal = null;
  if (order && typeof order.expectedTotal === "number") {
    expectedTotal = Number(order.expectedTotal);
    diagnostics.steps.push("expectedTotal provided in order");
  } else if (order && Array.isArray(order.items) && menu) {
    // try to compute using menu prices
    let subtotal = 0;
    for (const it of order.items) {
      const prod = findProductInMenu(menu, it.id);
      let unit = it.unitPrice != null ? Number(it.unitPrice) : null;
      if (unit == null && prod) {
        unit = applyVariantPrice(prod, it.variant);
      }
      if (unit == null) {
        diagnostics.steps.push(`unitPrice missing for ${it.id}`);
      } else {
        subtotal += unit * (Number(it.quantity) || 1);
      }
    }
    expectedTotal = roundTo(subtotal, 0.01);
    diagnostics.steps.push(`expectedTotal computed from menu: ${expectedTotal}`);
  } else if (order && Array.isArray(order.items)) {
    // fallback: sum item.price if present
    let subtotal = 0;
    let anyPrice = false;
    for (const it of order.items) {
      if (typeof it.price === "number") {
        subtotal += it.price;
        anyPrice = true;
      } else if (typeof it.unitPrice === "number") {
        subtotal += it.unitPrice * (Number(it.quantity) || 1);
        anyPrice = true;
      }
    }
    if (anyPrice) {
      expectedTotal = roundTo(subtotal, 0.01);
      diagnostics.steps.push(`expectedTotal computed from order item prices: ${expectedTotal}`);
    } else {
      diagnostics.steps.push("no price info available in order");
    }
  } else {
    diagnostics.steps.push("no order items provided");
  }

  // detected total from OCR
  const detected = ocrResult?.mostLikelyTotal?.value ?? null;
  const detectedConfidence = ocrResult?.mostLikelyTotal?.confidence ?? null;

  if (!detected) {
    return {
      ok: false,
      detectedTotal: null,
      expectedTotal,
      difference: null,
      differencePct: null,
      verdict: "no_amount_detected",
      notes: ["No se detectó monto en el comprobante OCR."],
      diagnostics
    };
  }

  const difference = expectedTotal != null ? roundTo(detected - expectedTotal, 0.01) : null;
  const differencePct = expectedTotal != null && expectedTotal !== 0 ? Math.abs(difference / expectedTotal) : null;

  let verdict = "mismatch";
  const notes = [];

  if (expectedTotal == null) {
    // no expected total to compare
    verdict = detectedConfidence >= 0.7 ? "detected_only" : "low_confidence_detected";
    notes.push("No hay total esperado para comparar; se devuelve monto detectado.");
  } else {
    if (difference === 0) {
      verdict = "match";
      notes.push("Monto exacto coincide.");
    } else if (differencePct != null && differencePct <= tolerance) {
      verdict = "close";
      notes.push(`Monto cercano dentro de tolerancia ${tolerance * 100}%.`);
    } else {
      verdict = "mismatch";
      notes.push(`Diferencia de S/${difference} (${(differencePct * 100).toFixed(2)}%).`);
    }
  }

  // if requireExactMatch, only accept exact
  if (requireExactMatch && verdict !== "match") {
    notes.push("Se requiere coincidencia exacta por configuración.");
    return {
      ok: false,
      detectedTotal: detected,
      expectedTotal,
      difference,
      differencePct,
      verdict: "mismatch",
      notes,
      diagnostics
    };
  }

  const ok = verdict === "match" || verdict === "close" || verdict === "detected_only";

  return {
    ok,
    detectedTotal: detected,
    expectedTotal,
    difference,
    differencePct,
    verdict,
    notes,
    diagnostics
  };
}

/* ---------- Helpers para catálogo (WhatsApp catalog recognition) ---------- */

/**
 * findProductInMenu(menu, id)
 * - menu: menu JSON (categorias -> productos)
 */
function findProductInMenu(menu, id) {
  if (!menu) return null;
  for (const cat of (menu.categorias || [])) {
    for (const p of (cat.productos || [])) {
      if (String(p.id) === String(id) || String(p.sku || "") === String(id)) return p;
    }
  }
  return null;
}

/**
 * applyVariantPrice(product, variant)
 * - intenta resolver precio por variante
 */
function applyVariantPrice(product, variant) {
  if (!product) return null;
  if (!variant) {
    if (product.precio != null) return Number(product.precio);
    if (product.variantes) {
      if (product.variantes.mediana != null) return Number(product.variantes.mediana);
      const keys = Object.keys(product.variantes);
      if (keys.length) return Number(product.variantes[keys[0]]);
    }
    return null;
  }
  if (product.variantes && product.variantes[variant] != null) return Number(product.variantes[variant]);
  // try normalized keys
  const vkeys = Object.keys(product.variantes || {});
  for (const k of vkeys) {
    if (k.includes(variant) || variant.includes(k)) return Number(product.variantes[k]);
  }
  return null;
}

/**
 * parseWhatsAppCatalogSnippet(text, menu)
 * - Intenta mapear un fragmento de texto (copiado del catálogo de WhatsApp) a productos del menú.
 * - Devuelve array de coincidencias { id, name, price, matchScore }
 */
export function parseWhatsAppCatalogSnippet(text, menu) {
  const normalized = normalizeForSearch(text);
  const tokens = normalized.split(" ").filter(Boolean);
  const results = [];
  if (!menu) return results;
  const catalog = [];
  for (const cat of (menu.categorias || [])) {
    for (const p of (cat.productos || [])) {
      catalog.push({
        id: p.id,
        name: p.nombre || p.name,
        normName: normalizeForSearch(p.nombre || p.name || ""),
        price: p.precio ?? null,
        variantes: p.variantes || null
      });
    }
  }
  for (const prod of catalog) {
    const prodTokens = prod.normName.split(" ").filter(Boolean);
    let common = 0;
    for (const t of tokens) if (prodTokens.includes(t)) common++;
    const overlap = prodTokens.length ? common / prodTokens.length : 0;
    // levenshtein fallback
    const lev = levenshtein(normalized, prod.normName);
    const levScore = Math.max(0, 1 - lev / Math.max(normalized.length, prod.normName.length, 1));
    const score = Math.max(overlap, levScore * 0.9);
    if (score > 0.35) {
      results.push({ id: prod.id, name: prod.name, price: prod.price, matchScore: Number(score.toFixed(2)) });
    }
  }
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}

/* ---------- Levenshtein (reutilizable) ---------- */
function levenshtein(a = "", b = "") {
  a = a || ""; b = b || "";
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const v0 = new Array(bl + 1).fill(0);
  const v1 = new Array(bl + 1).fill(0);
  for (let i = 0; i <= bl; i++) v0[i] = i;
  for (let i = 0; i < al; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bl; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let k = 0; k <= bl; k++) v0[k] = v1[k];
  }
  return v1[bl];
}

/* ---------- extractMostLikelyTotal (conveniencia) ---------- */

export function extractMostLikelyTotal(ocrResult) {
  if (!ocrResult) return null;
  if (ocrResult.mostLikelyTotal && typeof ocrResult.mostLikelyTotal.value === "number") {
    return ocrResult.mostLikelyTotal.value;
  }
  if (Array.isArray(ocrResult.amounts) && ocrResult.amounts.length) {
    // amounts are sorted descending in buildResultObject
    return ocrResult.amounts[0].value ?? null;
  }
  return null;
}

/* ---------- Export por defecto ---------- */

export default {
  readImage,
  readImageBuffer,
  extractMostLikelyTotal,
  detectYapeAccountInText,
  validateReceiptAgainstOrder,
  parseWhatsAppCatalogSnippet,
  // helpers (exposed para tests)
  _internal: {
    extractAmountsFromTextWithPositions,
    extractNumbersFromText,
    buildResultObject,
    scoreAmountConfidence,
    levenshtein,
    normalizeForSearch,
    roundTo,
    findProductInMenu,
    applyVariantPrice
  }
};
