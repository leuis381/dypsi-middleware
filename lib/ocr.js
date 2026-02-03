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
import crypto from "crypto";
import {
  logger,
  AppError,
  ValidationError,
  RateLimitError,
  validateUrl,
  sanitizeInput,
  retryAsync,
  RateLimiter,
  MetricsCollector,
  Cache
} from "./utils.js";

/* ---------- Configuración ---------- */
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 200;
const OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image";
const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

/* ---------- Instancias globales de utilities ---------- */
const ocrCache = new Cache(5 * 60 * 1000); // Cache por 5 minutos
const metricsCollector = new MetricsCollector();
const googleVisionRateLimiter = new RateLimiter(100, 60 * 1000); // 100 requests/min
const ocrSpaceRateLimiter = new RateLimiter(50, 60 * 1000); // 50 requests/min

/* ---------- Utilidades ---------- */
function safeNumberParse(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(s) {
  if (!s) return "";
  return sanitizeInput(s.toString().replace(/\r/g, " ").replace(/\t/g, " ").replace(/\u00A0/g, " ").trim(), 10000);
}

function normalizeForSearch(s) {
  if (!s) return "";
  return sanitizeInput(s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim().toLowerCase(), 5000);
}

function roundTo(value, step = 0.01) {
  const factor = 1 / step;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Genera un hash para cachear resultados basado en contenido
 * @param {string|Buffer} content - URL o buffer
 * @returns {string} Hash MD5
 */
function generateCacheKey(content) {
  if (Buffer.isBuffer(content)) {
    return crypto.createHash('md5').update(content).digest('hex');
  }
  return crypto.createHash('md5').update(String(content)).digest('hex');
}

/* ---------- Extracción de montos y números ---------- */

/**
 * extractAmountsFromTextWithPositions
 * Detecta montos en distintos formatos: "S/ 24.00", "24.00", "24", "PEN 24.00", "$ 12.50"
 * @param {string} text - Texto a analizar
 * @returns {Array<{raw: string, value: number, currencyHint: string|null, index: number}>} Array de montos detectados
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
/**
 * extractNumbersFromText
 * Extrae números de operaciones y cuentas bancarias del texto
 * @param {string} text - Texto a analizar
 * @returns {{operations: string[], accounts: string[]}} Números de operaciones y cuentas detectados
 */
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
 * Dado un monto detectado y el contexto, devuelve score de confianza 0-1
 * @param {object} amountObj - Objeto de monto con value, currencyHint
 * @param {string} surroundingText - Texto circundante para análisis contextual
 * @returns {number} Score de confianza 0-1
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

/**
 * ocrSpaceRequest
 * Realiza petición OCR usando OCR.Space API con retry automático
 * @param {object} params - Parámetros de la petición
 * @param {string} params.imageUrl - URL de la imagen
 * @param {Buffer} params.buffer - Buffer de la imagen
 * @param {string} params.filename - Nombre del archivo
 * @param {string} params.language - Código de idioma (spa, eng, etc)
 * @param {boolean} params.debug - Modo debug
 * @returns {Promise<{text: string, raw: object, confidence: number|null, provider: string, overlay: object|null}>}
 * @throws {AppError} Si la API no está configurada
 * @throws {RateLimitError} Si se excede el rate limit
 */
async function ocrSpaceRequest({ imageUrl = null, buffer = null, filename = "upload.jpg", language = "spa", debug = false }) {
  const startTime = Date.now();
  
  if (!process.env.OCR_API_KEY) {
    logger.error("OCR.Space API key not configured");
    throw new AppError("OCR_SPACE_API_KEY_NOT_CONFIGURED", 500, "OCR_CONFIG_ERROR");
  }

  // Validar inputs
  if (!imageUrl && !buffer) {
    throw new ValidationError("No image provided to ocrSpaceRequest", { imageUrl, buffer });
  }
  
  if (imageUrl) {
    validateUrl(imageUrl);
  }
  
  if (buffer && !Buffer.isBuffer(buffer)) {
    throw new ValidationError("Invalid buffer provided", { bufferType: typeof buffer });
  }

  // Rate limiting
  try {
    ocrSpaceRateLimiter.checkLimit('ocr.space');
    logger.debug("OCR.Space rate limit check passed");
  } catch (err) {
    logger.warn("OCR.Space rate limit exceeded");
    metricsCollector.record('ocr_space_rate_limit_exceeded', 1);
    throw err;
  }

  const form = new FormData();
  form.append("apikey", process.env.OCR_API_KEY);
  form.append("language", sanitizeInput(language, 10));
  form.append("isOverlayRequired", "true");
  form.append("OCREngine", "2");
  form.append("detectOrientation", "true");

  if (imageUrl) {
    form.append("url", imageUrl);
    logger.info("OCR.Space request for URL:", imageUrl.substring(0, 100));
  } else if (buffer) {
    form.append("file", buffer, { filename: sanitizeInput(filename, 100) });
    logger.info("OCR.Space request for buffer:", filename);
  }

  const headers = { ...form.getHeaders() };
  const axiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS });

  try {
    const result = await retryAsync(
      async () => {
        const r = await axiosInstance.post(OCR_SPACE_ENDPOINT, form, { headers });
        const data = r.data;
        const parsedText = data?.ParsedResults?.map(p => p.ParsedText).join("\n") || "";
        const overlay = data?.ParsedResults?.[0]?.TextOverlay || null;
        const exitCode = data?.OCRExitCode;
        const success = exitCode === 1 || exitCode === 2 || exitCode === 3;
        
        if (!success) {
          const errMsg = data?.ErrorMessage || JSON.stringify(data);
          logger.error("OCR.Space API error:", errMsg);
          throw new AppError(`OCR.Space error: ${errMsg}`, 500, "OCR_SPACE_ERROR");
        }
        
        return { text: parsedText, raw: data, confidence: null, provider: "ocr.space", overlay };
      },
      {
        maxRetries: MAX_RETRIES,
        initialDelayMs: RETRY_BASE_DELAY_MS,
        backoffMultiplier: 2,
        shouldRetry: (err) => {
          return err.statusCode >= 500 || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT';
        }
      }
    );

    const duration = Date.now() - startTime;
    metricsCollector.record('ocr_space_success', duration, { type: imageUrl ? 'url' : 'buffer' });
    logger.info(`OCR.Space request successful in ${duration}ms`);
    
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    metricsCollector.record('ocr_space_failure', duration, { error: err.message });
    logger.error(`OCR.Space request failed after ${duration}ms:`, err.message);
    throw err;
  }
}

/* ---------- OCR Provider: Google Vision REST ---------- */

/**
 * googleVisionRequest
 * Realiza petición OCR usando Google Vision API con retry automático
 * @param {object} params - Parámetros de la petición
 * @param {string} params.imageUrl - URL de la imagen
 * @param {Buffer} params.buffer - Buffer de la imagen
 * @param {string} params.filename - Nombre del archivo
 * @param {string[]} params.languageHints - Códigos de idioma sugeridos
 * @param {boolean} params.debug - Modo debug
 * @returns {Promise<{text: string, raw: object, confidence: number|null, provider: string, annotation: object}>}
 * @throws {AppError} Si la API no está configurada
 * @throws {RateLimitError} Si se excede el rate limit
 */
async function googleVisionRequest({ imageUrl = null, buffer = null, filename = "upload.jpg", languageHints = ["es"], debug = false }) {
  const startTime = Date.now();
  
  if (!process.env.GOOGLE_API_KEY) {
    logger.warn("Google Vision API key not configured - Feature disabled");
    return null; // Feature es opcional
  }

  // Validar inputs
  if (!imageUrl && !buffer) {
    throw new ValidationError("No image provided to googleVisionRequest", { imageUrl, buffer });
  }
  
  if (imageUrl) {
    validateUrl(imageUrl);
  }
  
  if (buffer && !Buffer.isBuffer(buffer)) {
    throw new ValidationError("Invalid buffer provided", { bufferType: typeof buffer });
  }

  // Rate limiting
  try {
    googleVisionRateLimiter.checkLimit('google_vision');
    logger.debug("Google Vision rate limit check passed");
  } catch (err) {
    logger.warn("Google Vision rate limit exceeded");
    metricsCollector.record('google_vision_rate_limit_exceeded', 1);
    throw err;
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
    logger.info("Google Vision request for URL:", imageUrl.substring(0, 100));
  } else if (buffer) {
    requestBody.requests[0].image.content = buffer.toString("base64");
    logger.info("Google Vision request for buffer:", filename);
  }

  if (languageHints && Array.isArray(languageHints) && languageHints.length) {
    requestBody.requests[0].imageContext.languageHints = languageHints.map(h => sanitizeInput(h, 10));
  }

  const axiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS });

  try {
    const result = await retryAsync(
      async () => {
        const r = await axiosInstance.post(url, requestBody, {
          headers: { "Content-Type": "application/json" }
        });
        const data = r.data;
        const annotation = data?.responses?.[0]?.fullTextAnnotation || data?.responses?.[0]?.textAnnotations?.[0];
        const text = annotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || "";
        const confidence = null;
        
        return { text, raw: data, confidence, provider: "google_vision", annotation };
      },
      {
        maxRetries: MAX_RETRIES,
        initialDelayMs: RETRY_BASE_DELAY_MS,
        backoffMultiplier: 2,
        shouldRetry: (err) => {
          return err.statusCode >= 500 || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT';
        }
      }
    );

    const duration = Date.now() - startTime;
    metricsCollector.record('google_vision_success', duration, { type: imageUrl ? 'url' : 'buffer' });
    logger.info(`Google Vision request successful in ${duration}ms`);
    
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    metricsCollector.record('google_vision_failure', duration, { error: err.message });
    logger.error(`Google Vision request failed after ${duration}ms:`, err.message);
    throw err;
  }
}

/* ---------- Public API: readImage / readImageBuffer ---------- */

/**
 * readImage
 * Lee texto de una imagen mediante OCR utilizando múltiples providers con fallback
 * @param {string} imageUrl - URL de la imagen a procesar
 * @param {object} options - Opciones de configuración
 * @param {string[]} options.languageHints - Códigos de idioma sugeridos (default: ["es"])
 * @param {string[]} options.providersOrder - Orden de providers a intentar
 * @param {string} options.language - Código de idioma para OCR.Space (default: "spa")
 * @param {boolean} options.debug - Modo debug con información detallada
 * @returns {Promise<object>} Resultado del OCR con estructura normalizada
 * @throws {ValidationError} Si la URL es inválida
 * @throws {AppError} Si ningún provider funciona
 * @example
 * const result = await readImage('https://example.com/receipt.jpg', { 
 *   languageHints: ['es'],
 *   debug: true 
 * });
 * console.log(result.mostLikelyTotal.value);
 */
export async function readImage(imageUrl, options = {}) {
  const startTime = Date.now();
  const debug = !!options.debug;
  
  // Validación de entrada
  if (!imageUrl || typeof imageUrl !== "string") {
    throw new ValidationError("Invalid imageUrl provided to readImage", { imageUrl });
  }
  
  try {
    validateUrl(imageUrl);
  } catch (err) {
    logger.error("Invalid URL provided to readImage:", imageUrl);
    throw err;
  }

  logger.info("Starting OCR readImage for URL:", imageUrl.substring(0, 100));

  // Verificar cache
  const cacheKey = `url:${generateCacheKey(imageUrl)}`;
  const cached = ocrCache.get(cacheKey);
  if (cached) {
    logger.info("Returning cached OCR result for URL");
    metricsCollector.record('read_image_cache_hit', 1);
    return cached;
  }

  // Validar opciones
  if (options.languageHints && !Array.isArray(options.languageHints)) {
    throw new ValidationError("languageHints must be an array", { languageHints: options.languageHints });
  }

  const providersOrder = options.providersOrder || (process.env.GOOGLE_API_KEY ? ["google_vision", "ocr.space"] : ["ocr.space", "google_vision"]);
  const diagnostics = { providersTried: [], attempts: [] };

  logger.debug("Providers order:", providersOrder.join(", "));

  for (const provider of providersOrder) {
    try {
      diagnostics.providersTried.push(provider);
      logger.info(`Trying OCR provider: ${provider}`);
      
      if (provider === "google_vision" && process.env.GOOGLE_API_KEY) {
        const res = await googleVisionRequest({ imageUrl, languageHints: options.languageHints || ["es"], debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerAnnotation: res.annotation, providerOverlay: res.overlay || null, providersOrder };
        
        // Cachear resultado exitoso
        ocrCache.set(cacheKey, built);
        
        const duration = Date.now() - startTime;
        metricsCollector.record('read_image_success', duration, { provider });
        logger.info(`OCR readImage successful with ${provider} in ${duration}ms`);
        
        return built;
      }
      
      if (provider === "ocr.space" && process.env.OCR_API_KEY) {
        const res = await ocrSpaceRequest({ imageUrl, language: options.language || "spa", debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerOverlay: res.overlay || null, providersOrder };
        
        // Cachear resultado exitoso
        ocrCache.set(cacheKey, built);
        
        const duration = Date.now() - startTime;
        metricsCollector.record('read_image_success', duration, { provider });
        logger.info(`OCR readImage successful with ${provider} in ${duration}ms`);
        
        return built;
      }
      
      logger.warn(`Provider ${provider} not configured or unavailable`);
    } catch (err) {
      diagnostics.attempts.push({ provider, error: err.message || String(err) });
      logger.warn(`Provider ${provider} failed:`, err.message || err);
      metricsCollector.record('read_image_provider_failure', 1, { provider, error: err.code || 'unknown' });
    }
  }

  const duration = Date.now() - startTime;
  metricsCollector.record('read_image_failure', duration);
  logger.error(`OCR readImage failed after trying all providers in ${duration}ms`);
  
  const error = new AppError(
    `No OCR provider succeeded. Providers tried: ${providersOrder.join(", ")}`,
    500,
    "OCR_ALL_PROVIDERS_FAILED"
  );
  error.details = { diagnostics };
  throw error;
}

/**
 * readImageBuffer
 * Lee texto de un buffer de imagen mediante OCR utilizando múltiples providers con fallback
 * @param {Buffer} buffer - Buffer de la imagen a procesar
 * @param {string} filename - Nombre del archivo (default: "upload.jpg")
 * @param {object} options - Opciones de configuración
 * @param {string[]} options.languageHints - Códigos de idioma sugeridos (default: ["es"])
 * @param {string[]} options.providersOrder - Orden de providers a intentar
 * @param {string} options.language - Código de idioma para OCR.Space (default: "spa")
 * @param {boolean} options.debug - Modo debug con información detallada
 * @returns {Promise<object>} Resultado del OCR con estructura normalizada
 * @throws {ValidationError} Si el buffer es inválido
 * @throws {AppError} Si ningún provider funciona
 * @example
 * const buffer = fs.readFileSync('receipt.jpg');
 * const result = await readImageBuffer(buffer, 'receipt.jpg', { 
 *   languageHints: ['es'] 
 * });
 * console.log(result.text);
 */
export async function readImageBuffer(buffer, filename = "upload.jpg", options = {}) {
  const startTime = Date.now();
  const debug = !!options.debug;
  
  // Validación de entrada
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new ValidationError("Invalid buffer provided to readImageBuffer", { 
      bufferProvided: !!buffer,
      isBuffer: Buffer.isBuffer(buffer) 
    });
  }

  if (buffer.length === 0) {
    throw new ValidationError("Empty buffer provided to readImageBuffer");
  }

  if (typeof filename !== 'string' || filename.length === 0) {
    throw new ValidationError("Invalid filename provided", { filename });
  }

  logger.info(`Starting OCR readImageBuffer for file: ${filename} (${buffer.length} bytes)`);

  // Verificar cache
  const cacheKey = `buffer:${generateCacheKey(buffer)}`;
  const cached = ocrCache.get(cacheKey);
  if (cached) {
    logger.info("Returning cached OCR result for buffer");
    metricsCollector.record('read_image_buffer_cache_hit', 1);
    return cached;
  }

  // Validar opciones
  if (options.languageHints && !Array.isArray(options.languageHints)) {
    throw new ValidationError("languageHints must be an array", { languageHints: options.languageHints });
  }

  const providersOrder = options.providersOrder || (process.env.GOOGLE_API_KEY ? ["google_vision", "ocr.space"] : ["ocr.space", "google_vision"]);
  const diagnostics = { providersTried: [], attempts: [] };

  logger.debug("Providers order:", providersOrder.join(", "));

  for (const provider of providersOrder) {
    try {
      diagnostics.providersTried.push(provider);
      logger.info(`Trying OCR provider: ${provider}`);
      
      if (provider === "google_vision" && process.env.GOOGLE_API_KEY) {
        const res = await googleVisionRequest({ buffer, filename, languageHints: options.languageHints || ["es"], debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerAnnotation: res.annotation, providersOrder };
        
        // Cachear resultado exitoso
        ocrCache.set(cacheKey, built);
        
        const duration = Date.now() - startTime;
        metricsCollector.record('read_image_buffer_success', duration, { provider });
        logger.info(`OCR readImageBuffer successful with ${provider} in ${duration}ms`);
        
        return built;
      }
      
      if (provider === "ocr.space" && process.env.OCR_API_KEY) {
        const res = await ocrSpaceRequest({ buffer, filename, language: options.language || "spa", debug });
        const built = buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence, debug });
        built.diagnostics = { providerOverlay: res.overlay || null, providersOrder };
        
        // Cachear resultado exitoso
        ocrCache.set(cacheKey, built);
        
        const duration = Date.now() - startTime;
        metricsCollector.record('read_image_buffer_success', duration, { provider });
        logger.info(`OCR readImageBuffer successful with ${provider} in ${duration}ms`);
        
        return built;
      }
      
      logger.warn(`Provider ${provider} not configured or unavailable`);
    } catch (err) {
      diagnostics.attempts.push({ provider, error: err.message || String(err) });
      logger.warn(`Provider ${provider} failed:`, err.message || err);
      metricsCollector.record('read_image_buffer_provider_failure', 1, { provider, error: err.code || 'unknown' });
    }
  }

  const duration = Date.now() - startTime;
  metricsCollector.record('read_image_buffer_failure', duration);
  logger.error(`OCR readImageBuffer failed after trying all providers in ${duration}ms`);
  
  const error = new AppError(
    `No OCR provider succeeded for buffer. Providers tried: ${providersOrder.join(", ")}`,
    500,
    "OCR_ALL_PROVIDERS_FAILED"
  );
  error.details = { diagnostics };
  throw error;
}

/* ---------- Resultado normalizado ---------- */

/**
 * buildResultObject
 * Normaliza texto OCR, extrae montos y números, devuelve estructura consistente
 * @param {object} params - Parámetros
 * @param {string} params.provider - Nombre del provider OCR
 * @param {string} params.rawText - Texto crudo del OCR
 * @param {object} params.rawResponse - Respuesta completa de la API
 * @param {number|null} params.confidence - Score de confianza
 * @param {boolean} params.debug - Incluir información de debug
 * @returns {object} Objeto resultado normalizado
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

/**
 * detectYapeAccountInText
 * Detecta números de cuenta Yape en texto OCR y los compara con cuentas conocidas
 * @param {string} text - Texto donde buscar números de cuenta
 * @param {string[]} knownAccounts - Array de números de cuenta conocidos para validar
 * @returns {{matches: string[], matchedKnown: string[]}} Cuentas detectadas y validadas
 * @example
 * const result = detectYapeAccountInText(ocrText, ['987654321', '912345678']);
 * console.log(result.matchedKnown); // Cuentas que coinciden con las conocidas
 */
export function detectYapeAccountInText(text, knownAccounts = []) {
  logger.debug("Detecting Yape accounts in text");
  
  if (!text || typeof text !== 'string') {
    logger.warn("Invalid text provided to detectYapeAccountInText");
    return { matches: [], matchedKnown: [] };
  }

  if (!Array.isArray(knownAccounts)) {
    logger.warn("knownAccounts must be an array");
    knownAccounts = [];
  }

  const { operations, accounts } = extractNumbersFromText(text);
  const matches = accounts || [];
  const matchedKnown = matches.filter((n) => knownAccounts.includes(n));
  
  logger.info(`Detected ${matches.length} account numbers, ${matchedKnown.length} matched with known accounts`);
  metricsCollector.record('yape_account_detection', 1, { 
    detected: matches.length, 
    matched: matchedKnown.length 
  });
  
  return { matches, matchedKnown };
}

/* ---------- Validate receipt against order & catalog ---------- */

/**
 * validateReceiptAgainstOrder
 * Valida que el monto detectado en un comprobante OCR coincida con el total esperado del pedido
 * @param {object} ocrResult - Resultado de readImage/readImageBuffer
 * @param {object} order - Pedido con items y expectedTotal opcional
 * @param {object} order.items - Array de items del pedido
 * @param {number} order.expectedTotal - Total esperado del pedido
 * @param {object} menu - Menú JSON para resolver precios si es necesario
 * @param {object} options - Opciones de validación
 * @param {number} options.tolerance - Tolerancia relativa (default: 0.06 = 6%)
 * @param {boolean} options.requireExactMatch - Requerir coincidencia exacta (default: false)
 * @param {boolean} options.debug - Modo debug
 * @returns {{ok: boolean, detectedTotal: number|null, expectedTotal: number|null, difference: number|null, differencePct: number|null, verdict: string, notes: string[], diagnostics: object}}
 * @throws {ValidationError} Si los parámetros son inválidos
 * @example
 * const validation = validateReceiptAgainstOrder(
 *   ocrResult,
 *   { items: [...], expectedTotal: 45.50 },
 *   menu,
 *   { tolerance: 0.05, debug: true }
 * );
 * if (validation.ok) {
 *   console.log('Receipt validated successfully');
 * }
 */
export function validateReceiptAgainstOrder(ocrResult, order = {}, menu = null, options = {}) {
  const startTime = Date.now();
  logger.info("Starting receipt validation against order");
  
  const debug = !!options.debug;
  const tolerance = typeof options.tolerance === "number" ? options.tolerance : 0.06;
  const requireExactMatch = !!options.requireExactMatch;

  // Validación de entrada
  if (!ocrResult || typeof ocrResult !== 'object') {
    throw new ValidationError("Invalid ocrResult provided", { ocrResult });
  }

  if (order && typeof order !== 'object') {
    throw new ValidationError("Invalid order provided", { order });
  }

  if (tolerance < 0 || tolerance > 1) {
    throw new ValidationError("Tolerance must be between 0 and 1", { tolerance });
  }

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

  const duration = Date.now() - startTime;
  metricsCollector.record('validate_receipt', duration, { verdict, ok });
  logger.info(`Receipt validation completed in ${duration}ms: verdict=${verdict}, ok=${ok}`);

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
 * findProductInMenu
 * Busca un producto en el menú por ID o SKU
 * @param {object} menu - Menú JSON con categorías y productos
 * @param {string|number} id - ID o SKU del producto
 * @returns {object|null} Producto encontrado o null
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
 * applyVariantPrice
 * Resuelve el precio de un producto según su variante
 * @param {object} product - Producto del menú
 * @param {string} variant - Nombre de la variante (mediana, grande, etc)
 * @returns {number|null} Precio de la variante o null
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
 * parseWhatsAppCatalogSnippet
 * Intenta mapear fragmento de texto (copiado del catálogo de WhatsApp) a productos del menú
 * usando matching fuzzy y análisis de tokens
 * @param {string} text - Texto del catálogo de WhatsApp
 * @param {object} menu - Menú JSON con categorías y productos
 * @returns {Array<{id: string, name: string, price: number|null, matchScore: number}>} Productos coincidentes ordenados por score
 * @example
 * const matches = parseWhatsAppCatalogSnippet(
 *   'Pizza Hawaiana Mediana S/35',
 *   menu
 * );
 * console.log(matches[0].name); // Mejor coincidencia
 */
export function parseWhatsAppCatalogSnippet(text, menu) {
  logger.debug("Parsing WhatsApp catalog snippet");
  
  if (!text || typeof text !== 'string') {
    logger.warn("Invalid text provided to parseWhatsAppCatalogSnippet");
    return [];
  }

  if (!menu || typeof menu !== 'object') {
    logger.warn("Invalid menu provided to parseWhatsAppCatalogSnippet");
    return [];
  }

  const sanitizedText = sanitizeInput(text, 1000);
  const normalized = normalizeForSearch(sanitizedText);
  const tokens = normalized.split(" ").filter(Boolean);
  const results = [];
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
  
  logger.info(`WhatsApp catalog parsing found ${results.length} matches`);
  metricsCollector.record('whatsapp_catalog_parse', 1, { matches: results.length });
  
  return results;
}

/* ---------- Levenshtein (reutilizable) ---------- */
/**
 * levenshtein
 * Calcula la distancia de Levenshtein entre dos strings (edits mínimos)
 * @param {string} a - Primer string
 * @param {string} b - Segundo string
 * @returns {number} Distancia de edición
 */
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

/**
 * extractMostLikelyTotal
 * Extrae el monto total más probable de un resultado OCR
 * @param {object} ocrResult - Resultado de readImage/readImageBuffer
 * @returns {number|null} Monto total más probable o null si no se encuentra
 * @example
 * const result = await readImage(imageUrl);
 * const total = extractMostLikelyTotal(result);
 * console.log(`Total: S/${total}`);
 */
export function extractMostLikelyTotal(ocrResult) {
  if (!ocrResult || typeof ocrResult !== 'object') {
    logger.warn("Invalid ocrResult provided to extractMostLikelyTotal");
    return null;
  }
  
  if (ocrResult.mostLikelyTotal && typeof ocrResult.mostLikelyTotal.value === "number") {
    logger.debug("Extracted most likely total:", ocrResult.mostLikelyTotal.value);
    return ocrResult.mostLikelyTotal.value;
  }
  
  if (Array.isArray(ocrResult.amounts) && ocrResult.amounts.length) {
    const total = ocrResult.amounts[0].value ?? null;
    logger.debug("Extracted total from amounts array:", total);
    return total;
  }
  
  logger.warn("No total amount found in ocrResult");
  return null;
}

/* ---------- Public API para métricas y cache ---------- */

/**
 * getMetrics
 * Obtiene estadísticas de uso y rendimiento del módulo OCR
 * @returns {object} Métricas recolectadas
 * @example
 * const metrics = getMetrics();
 * console.log(metrics.read_image_success);
 */
export function getMetrics() {
  return {
    read_image: metricsCollector.getStats('read_image_success'),
    read_image_buffer: metricsCollector.getStats('read_image_buffer_success'),
    google_vision: metricsCollector.getStats('google_vision_success'),
    ocr_space: metricsCollector.getStats('ocr_space_success'),
    validate_receipt: metricsCollector.getStats('validate_receipt'),
    cache_hits: metricsCollector.getStats('read_image_cache_hit').concat(
      metricsCollector.getStats('read_image_buffer_cache_hit')
    )
  };
}

/**
 * resetMetrics
 * Reinicia todas las métricas recolectadas
 */
export function resetMetrics() {
  logger.info("Resetting OCR metrics");
  metricsCollector.reset();
}

/**
 * clearCache
 * Limpia el cache de resultados OCR
 */
export function clearCache() {
  logger.info("Clearing OCR cache");
  ocrCache.clear();
}

/**
 * getCacheStats
 * Obtiene estadísticas del cache
 * @returns {{size: number, ttlMs: number}}
 */
export function getCacheStats() {
  return {
    size: ocrCache.size(),
    ttlMs: ocrCache.ttlMs
  };
}

/* ---------- Export por defecto ---------- */

export default {
  readImage,
  readImageBuffer,
  extractMostLikelyTotal,
  detectYapeAccountInText,
  validateReceiptAgainstOrder,
  parseWhatsAppCatalogSnippet,
  getMetrics,
  resetMetrics,
  clearCache,
  getCacheStats,
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
    applyVariantPrice,
    generateCacheKey
  }
};
