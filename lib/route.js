import axios from "axios";
import { 
  logger, 
  AppError, 
  ValidationError,
  MetricsCollector, 
  Cache, 
  RateLimiter,
  retryAsync,
  sanitizeInput,
  parseJSON
} from './utils.js';

/**
 * /api/route
 * Robust route calculation endpoint for Vercel middleware (DYPSI).
 *
 * - Accepts POST with origin and destination as either:
 *    - address strings, or
 *    - objects { lat, lon } or { latitude, longitude }
 * - Uses Mapbox Directions API if MAPBOX_TOKEN is configured (preferred).
 * - Falls back to OSRM public router if Mapbox not configured or fails.
 * - Uses Nominatim (OpenStreetMap) for geocoding address strings.
 * - Retries network calls with exponential backoff on transient errors.
 * - Returns structured JSON with distance (m & km), duration (min), provider, price estimate (optional),
 *   and raw provider response for debugging.
 *
 * Request:
 *   POST /api/route
 *   {
 *     "origin": "Av. Example 123, Lima" | { "lat": -12.0, "lon": -77.0 },
 *     "destination": "Av. Other 456, Lima" | { "lat": -12.1, "lon": -77.1 }
 *   }
 *
 * Response (success):
 *   {
 *     ok: true,
 *     provider: "mapbox|osrm|haversine",
 *     distance_m: 1234,
 *     distance_km: 1.234,
 *     duration_min: 8,
 *     price_estimate: 4.0,            // optional, based on tramos
 *     tarifa_tramo: { upto_km: 2, price: 4 },
 *     raw: { ...provider_raw_response... },
 *     note: null
 *   }
 *
 * Response (error):
 *   { ok: false, error: "message", details: {...} }
 */

const AXIOS_TIMEOUT = 8000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 250;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving";

// Metrics, cache, rate limiting
const metrics = new MetricsCollector();
const geocodeCache = new Cache(600000); // 10 min cache for geocoding
const rateLimiter = new RateLimiter(100, 60000); // 100 requests per minute

/* Default tramos (km -> price in PEN) */
const DEFAULT_TRAMOS = [
  { upto_km: 0.9, price: 3 },
  { upto_km: 2.0, price: 4 },
  { upto_km: 3.0, price: 5 },
  { upto_km: 4.0, price: 6 },
  { upto_km: 5.0, price: 7 },
  { upto_km: 9999, price: 8 }
];

/**
 * Parsea los tramos de entrega desde variables de entorno
 * @returns {Array} Array de tramos ordenados por distancia
 * @private
 */

function parseTramosFromEnv() {
  try {
    if (process.env.DELIVERY_TRAMOS) {
      const parsed = parseJSON(process.env.DELIVERY_TRAMOS);
      if (Array.isArray(parsed) && parsed.length) {
        parsed.sort((a, b) => a.upto_km - b.upto_km);
        logger.debug('TRAMOS_PARSED_FROM_ENV', { count: parsed.length });
        return parsed;
      }
    }
  } catch (e) {
    logger.warn('TRAMOS_PARSE_FAILED', { error: e.message });
  }
  logger.debug('TRAMOS_USING_DEFAULTS', { count: DEFAULT_TRAMOS.length });
  return DEFAULT_TRAMOS;
}

/**
 * Calcula el precio basado en distancia y tramos
 * @param {Array} tramos - Array de tramos
 * @param {number} distance_km - Distancia en kilómetros
 * @returns {Object} { price, tramo }
 * @private
 */

function priceFromTramos(tramos, distance_km) {
  if (!Array.isArray(tramos) || tramos.length === 0) {
    logger.warn('TRAMOS_INVALID', { type: typeof tramos });
    throw new ValidationError('Invalid tramos configuration');
  }
  
  if (typeof distance_km !== 'number' || distance_km < 0) {
    logger.warn('DISTANCE_INVALID', { distance_km });
    throw new ValidationError('Invalid distance_km value');
  }

  for (const t of tramos) {
    if (distance_km <= Number(t.upto_km)) {
      logger.debug('TRAMO_MATCHED', { distance_km, tramo: t.upto_km, price: t.price });
      return { price: Number(t.price), tramo: t };
    }
  }
  const last = tramos[tramos.length - 1];
  logger.debug('TRAMO_MAX_USED', { distance_km, price: last.price });
  return { price: Number(last.price), tramo: last };
}

/**
 * Convierte valor a número de forma segura
 * @param {any} v - Valor a convertir
 * @returns {number|null} Número o null si inválido
 * @private
 */

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza objeto de coordenadas a formato estándar { lat, lon }
 * @param {Object} obj - Objeto con coordenadas
 * @returns {Object|null} { lat, lon } o null si inválido
 * @private
 */

function normalizeCoords(obj) {
  if (!obj || typeof obj !== "object") return null;
  const lat = toNumber(obj.lat ?? obj.latitude ?? obj.latitud);
  const lon = toNumber(obj.lon ?? obj.longitude ?? obj.long ?? obj.lng);
  if (lat === null || lon === null) return null;
  
  // Validate reasonable coordinates for Peru
  if (lat < -20 || lat > 0 || lon < -82 || lon > -68) {
    logger.warn('COORDS_OUT_OF_RANGE', { lat, lon });
    return null;
  }
  
  return { lat, lon };
}

/**
 * Reintenta una operación con backoff exponencial
 * @param {Function} fn - Función a ejecutar
 * @param {number} maxRetries - Número máximo de reintentos
 * @returns {Promise<any>} Resultado de la función
 * @throws {Error} Si todos los reintentos fallan
 * @private
 */

async function retryRequest(fn, maxRetries = MAX_RETRIES) {
  return await retryAsync(fn, {
    maxRetries,
    initialDelayMs: RETRY_BASE_DELAY_MS,
    shouldRetry: (err) => {
      // Retry on network errors and 5xx server errors
      return err.code === 'ECONNREFUSED' || 
             err.code === 'ETIMEDOUT' || 
             (err.response?.status >= 500 && err.response?.status < 600);
    }
  });
}

/**
 * Geocodifica una dirección usando Nominatim (OpenStreetMap)
 * @param {string} address - Dirección a geocodificar
 * @returns {Promise<Object|null>} { lat, lon, provider, raw } o null si falla
 * @private
 */
async function geocodeAddress(address) {
  if (!address || typeof address !== "string") {
    logger.warn('GEOCODE_INVALID_INPUT', { type: typeof address });
    return null;
  }

  const sanitized = sanitizeInput(address, 500);
  if (!sanitized) {
    logger.warn('GEOCODE_EMPTY_AFTER_SANITIZE');
    return null;
  }

  // Check cache
  const cacheKey = `geocode:${sanitized}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) {
    logger.debug('GEOCODE_CACHE_HIT', { address: sanitized.substring(0, 30) });
    metrics.record('geocode.cache_hit', 1);
    return cached;
  }

  const fn = async () => {
    logger.debug('GEOCODE_REQUEST', { address: sanitized.substring(0, 30) });
    metrics.record('geocode.request', 1);
    
    const r = await axios.get(NOMINATIM_URL, {
      params: { q: sanitized, format: "json", limit: 1, addressdetails: 0 },
      headers: { "User-Agent": "delivery-middleware" },
      timeout: AXIOS_TIMEOUT
    });
    
    const data = r.data;
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn('GEOCODE_NO_RESULTS', { address: sanitized.substring(0, 30) });
      throw new AppError("no_results", 404);
    }
    
    const first = data[0];
    const lat = toNumber(first.lat);
    const lon = toNumber(first.lon);
    
    if (lat === null || lon === null) {
      logger.warn('GEOCODE_INVALID_COORDS', { lat: first.lat, lon: first.lon });
      throw new AppError("invalid_coords", 400);
    }
    
    const result = { lat, lon, provider: "nominatim", raw: first };
    geocodeCache.set(cacheKey, result);
    logger.info('GEOCODE_SUCCESS', { address: sanitized.substring(0, 30), lat, lon });
    metrics.record('geocode.success', 1);
    return result;
  };
  
  try {
    return await retryRequest(fn);
  } catch (error) {
    logger.error('GEOCODE_FAILED', { address: sanitized.substring(0, 30), error: error.message });
    metrics.record('geocode.failure', 1);
    return null;
  }
}

/**
 * Calcula ruta usando Mapbox Directions API
 * @param {Object} from - { lat, lon } origen
 * @param {Object} to - { lat, lon } destino
 * @returns {Promise<Object>} { provider, distance_m, duration_s, raw }
 * @throws {Error} Si falla la API o no hay token configurado
 * @private
 */
async function routeWithMapbox(from, to) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    logger.warn('MAPBOX_TOKEN_NOT_CONFIGURED - Mapbox feature disabled');
    throw new AppError("Mapbox Token not configured. This feature is optional.", 501, 'FEATURE_DISABLED');
  }
  
  logger.debug('MAPBOX_ROUTE_REQUEST', { from, to });
  metrics.record('route.mapbox.request', 1);
  
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${MAPBOX_DIRECTIONS_URL}/${coords}`;
  const params = {
    alternatives: false,
    geometries: "geojson",
    overview: "simplified",
    steps: false,
    access_token: token
  };
  
  const fn = async () => {
    const startTime = Date.now();
    const r = await axios.get(url, { params, timeout: AXIOS_TIMEOUT });
    const duration = Date.now() - startTime;
    
    const data = r.data;
    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
      logger.warn('MAPBOX_NO_ROUTE', { from, to });
      throw new AppError("no_route", 404);
    }
    
    const route = data.routes[0];
    logger.info('MAPBOX_ROUTE_SUCCESS', { distance_m: route.distance, duration_ms: duration });
    metrics.record('route.mapbox.success', 1);
    metrics.record('route.mapbox.duration_ms', duration);
    
    return {
      provider: "mapbox",
      distance_m: Math.round(route.distance),
      duration_s: Math.round(route.duration),
      raw: data
    };
  };
  
  try {
    return await retryRequest(fn);
  } catch (error) {
    logger.error('MAPBOX_ROUTE_FAILED', { error: error.message });
    metrics.record('route.mapbox.failure', 1);
    throw error;
  }
}

/**
 * Calcula ruta usando OSRM (Open Source Routing Machine)
 * @param {Object} from - { lat, lon } origen
 * @param {Object} to - { lat, lon } destino
 * @returns {Promise<Object>} { provider, distance_m, duration_s, raw }
 * @throws {Error} Si falla la API
 * @private
 */
async function routeWithOSRM(from, to) {
  logger.debug('OSRM_ROUTE_REQUEST', { from, to });
  metrics.record('route.osrm.request', 1);
  
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM_URL}/${coords}`;
  const params = { overview: "false", alternatives: false, steps: false };
  
  const fn = async () => {
    const startTime = Date.now();
    const r = await axios.get(url, { params, timeout: AXIOS_TIMEOUT });
    const duration = Date.now() - startTime;
    
    const data = r.data;
    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
      logger.warn('OSRM_NO_ROUTE', { from, to });
      throw new AppError("no_route", 404);
    }
    
    const route = data.routes[0];
    logger.info('OSRM_ROUTE_SUCCESS', { distance_m: route.distance, duration_ms: duration });
    metrics.record('route.osrm.success', 1);
    metrics.record('route.osrm.duration_ms', duration);
    
    return {
      provider: "osrm",
      distance_m: Math.round(route.distance),
      duration_s: Math.round(route.duration),
      raw: data
    };
  };
  
  try {
    return await retryRequest(fn);
  } catch (error) {
    logger.error('OSRM_ROUTE_FAILED', { error: error.message });
    metrics.record('route.osrm.failure', 1);
    throw error;
  }
}

/**
 * Calcula distancia usando fórmula Haversine (fallback)
 * @param {Object} a - { lat, lon } punto A
 * @param {Object} b - { lat, lon } punto B
 * @returns {number} Distancia en metros
 * @private
 */
function haversineDistanceMeters(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof a.lon !== 'number' || 
      typeof b.lat !== 'number' || typeof b.lon !== 'number') {
    logger.warn('HAVERSINE_INVALID_COORDS', { a, b });
    throw new ValidationError('Invalid coordinates for haversine calculation');
  }
  
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aHarv = sinDLat * sinDLat + sinDLon * sinDLon * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aHarv), Math.sqrt(1 - aHarv));
  const distance = R * c;
  
  logger.debug('HAVERSINE_CALCULATED', { distance_m: Math.round(distance) });
  return distance;
}

/**
 * Main route calculation handler
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
  const requestId = `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info('ROUTE_REQUEST_START', { method: req.method, requestId, ip: req.ip });
  metrics.record('route.request', 1);

  if (req.method !== "POST") {
    logger.warn('ROUTE_INVALID_METHOD', { method: req.method, requestId });
    res.setHeader("Allow", "POST");
    metrics.record('route.invalid_method', 1);
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use POST." });
  }

  // Rate limiting (by IP)
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  try {
    rateLimiter.checkLimit(clientIp);
  } catch (error) {
    logger.warn('ROUTE_RATE_LIMITED', { ip: clientIp, requestId });
    metrics.record('route.rate_limited', 1);
    return res.status(429).json({ 
      ok: false, 
      error: "Rate limit exceeded",
      retryAfter: error.retryAfter 
    });
  }

  const start = Date.now();
  try {
    const body = req.body || {};
    const { origin, destination, include_price = true } = body;

    if (!origin || !destination) {
      logger.warn('ROUTE_MISSING_PARAMS', { hasOrigin: !!origin, hasDestination: !!destination, requestId });
      metrics.record('route.validation_error', 1);
      return res.status(400).json({ ok: false, error: "origin and destination are required" });
    }

    logger.debug('ROUTE_NORMALIZING_COORDS', { requestId });
    
    // Normalize coordinates if provided
    let fromCoords = normalizeCoords(origin);
    let toCoords = normalizeCoords(destination);

    // If not coords, attempt geocoding
    if (!fromCoords) {
      logger.debug('ROUTE_GEOCODING_ORIGIN', { requestId });
      fromCoords = await geocodeAddress(origin);
    }
    if (!toCoords) {
      logger.debug('ROUTE_GEOCODING_DESTINATION', { requestId });
      toCoords = await geocodeAddress(destination);
    }

    if (!fromCoords || !toCoords) {
      logger.warn('ROUTE_LOCATION_NOT_FOUND', { 
        hasFrom: !!fromCoords, 
        hasTo: !!toCoords, 
        requestId 
      });
      metrics.record('route.location_not_found', 1);
      return res.status(200).json({
        ok: false,
        error: "location_not_found",
        details: { from: !!fromCoords, to: !!toCoords }
      });
    }
    
    logger.debug('ROUTE_COORDS_READY', { fromCoords, toCoords, requestId });

    // Try routing providers: Mapbox -> OSRM -> Haversine
    let route = null;
    let provider = null;
    let raw = null;
    let note = null;

    if (process.env.MAPBOX_TOKEN) {
      try {
        logger.debug('ROUTE_TRYING_MAPBOX', { requestId });
        const r = await routeWithMapbox(fromCoords, toCoords);
        route = r;
        provider = r.provider;
        raw = r.raw;
      } catch (err) {
        logger.warn('ROUTE_MAPBOX_FAILED', { error: err.message, requestId });
        note = `Mapbox routing failed: ${err.message || "error"}.`;
      }
    } else {
      logger.debug('ROUTE_MAPBOX_NOT_CONFIGURED', { requestId });
    }

    if (!route) {
      try {
        logger.debug('ROUTE_TRYING_OSRM', { requestId });
        const r = await routeWithOSRM(fromCoords, toCoords);
        route = r;
        provider = r.provider;
        raw = r.raw;
      } catch (err) {
        logger.warn('ROUTE_OSRM_FAILED', { error: err.message, requestId });
        note = (note ? note + " " : "") + `OSRM routing failed: ${err.message || "error"}.`;
      }
    }

    let distance_m, duration_min;
    if (route && typeof route.distance_m === "number") {
      distance_m = route.distance_m;
      duration_min = Math.max(1, Math.round((route.duration_s || 0) / 60));
    } else {
      // Haversine fallback
      logger.debug('ROUTE_USING_HAVERSINE_FALLBACK', { requestId });
      metrics.record('route.haversine_fallback', 1);
      const meters = Math.round(haversineDistanceMeters(fromCoords, toCoords));
      distance_m = meters;
      const distance_km = distance_m / 1000;
      duration_min = Math.max(5, Math.round((distance_km / 25) * 60)); // conservative ETA
      provider = provider || "haversine";
      raw = raw || { note: "haversine_fallback" };
      note = (note ? note + " " : "") + "Used haversine fallback for distance and ETA.";
    }

    const distance_km = Number((distance_m / 1000).toFixed(3));
    const tramos = parseTramosFromEnv();
    const { price, tramo } = include_price ? priceFromTramos(tramos, distance_km) : { price: null, tramo: null };

    const processingMs = Date.now() - start;
    
    const payload = {
      ok: true,
      provider,
      distance_m: Math.round(distance_m),
      distance_km,
      duration_min,
      price_estimate: price != null ? Number(price) : null,
      tarifa_tramo: tramo || null,
      raw,
      note: note || null,
      meta: {
        request_received_at: new Date().toISOString(),
        processing_ms: processingMs
      }
    };

    logger.info('ROUTE_SUCCESS', { 
      provider, 
      distance_km, 
      duration_min, 
      price_estimate: price,
      processing_ms: processingMs,
      requestId 
    });
    metrics.record('route.success', 1);
    metrics.record('route.duration_ms', processingMs);

    return res.status(200).json(payload);
  } catch (err) {
    const processingMs = Date.now() - start;
    logger.error('ROUTE_HANDLER_ERROR', { 
      error: err.message, 
      code: err.code,
      processing_ms: processingMs,
      requestId
    });
    metrics.record('route.error', 1);
    
    const statusCode = err instanceof ValidationError ? 400 : 500;
    
    return res.status(statusCode).json({
      ok: false,
      error: "route_calculation_failed",
      details: err?.message || String(err),
      meta: {
        processing_ms: processingMs
      }
    });
  }
}