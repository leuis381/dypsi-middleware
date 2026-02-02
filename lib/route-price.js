import axios from "axios";
import crypto from "crypto";
import {
  logger,
  AppError,
  ValidationError,
  RateLimitError,
  validateAmount,
  sanitizeInput,
  retryAsync,
  Cache,
  RateLimiter,
  MetricsCollector,
  sleep,
  parseJSON
} from "./utils.js";

/**
 * route-price.js
 *
 * Robust route and delivery price calculator for Vercel middleware (DYPSI).
 *
 * Features
 * - Accepts origin/destination as address strings or { lat, lon } / { latitude, longitude } objects.
 * - Uses Mapbox Directions API if MAPBOX_TOKEN is configured (preferred).
 * - Falls back to OSRM public router if Mapbox not configured.
 * - Falls back to Haversine distance when routing fails, with conservative ETA estimate.
 * - Retries network calls with exponential backoff on transient errors.
 * - Configurable tramos (distance brackets) via env var DELIVERY_TRAMOS (JSON string) or sensible defaults.
 * - Short timeouts and safe error handling for serverless environments.
 * - Returns structured result: distance_m, distance_km, duration_min, price, tarifa_tramo, provider, raw.
 * - Comprehensive logging, caching, rate limiting, and metrics collection.
 *
 * Environment variables (optional)
 * - MAPBOX_TOKEN         -> use Mapbox Directions API (recommended)
 * - DELIVERY_TRAMOS      -> JSON string array of { upto_km, price } ordered ascending
 *
 * Example DELIVERY_TRAMOS:
 *   '[{"upto_km":0.9,"price":3},{"upto_km":2,"price":4},{"upto_km":3,"price":5},{"upto_km":4,"price":6},{"upto_km":5,"price":7},{"upto_km":9999,"price":8}]'
 *
 * Usage:
 *   const r = await calculateRoute(origin, destination);
 *   // origin/destination can be "Av. Example 123, Lima" or { lat: -12.0, lon: -77.0 }
 */

const AXIOS_TIMEOUT = 8000;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving";

/* Default tramos (km -> price in PEN) */
const DEFAULT_TRAMOS = [
  { upto_km: 0.9, price: 3 },
  { upto_km: 2.0, price: 4 },
  { upto_km: 3.0, price: 5 },
  { upto_km: 4.0, price: 6 },
  { upto_km: 5.0, price: 7 },
  { upto_km: 9999, price: 8 }
];

/* Cache instances with appropriate TTLs */
const geoCache = new Cache(10 * 60 * 1000); // 10 minutes for geocoding
const routeCache = new Cache(15 * 60 * 1000); // 15 minutes for routes

/* Rate limiter: 50 requests per minute for external APIs */
const apiRateLimiter = new RateLimiter(50, 60 * 1000);

/* Metrics collector for observability */
const metrics = new MetricsCollector();

/**
 * Parse distance tramos (price brackets) from environment variable
 * @returns {Array<{upto_km: number, price: number}>} Sorted array of price brackets
 */
function parseTramosFromEnv() {
  try {
    if (process.env.DELIVERY_TRAMOS) {
      const parsed = parseJSON(process.env.DELIVERY_TRAMOS, null);
      if (Array.isArray(parsed) && parsed.length) {
        // Validate structure
        for (const tramo of parsed) {
          if (typeof tramo.upto_km !== 'number' || typeof tramo.price !== 'number') {
            logger.warn('Invalid tramo structure in DELIVERY_TRAMOS, using defaults');
            return DEFAULT_TRAMOS;
          }
          if (tramo.price < 0) {
            logger.warn('Negative price in DELIVERY_TRAMOS, using defaults');
            return DEFAULT_TRAMOS;
          }
        }
        // ensure sorted ascending by upto_km
        parsed.sort((a, b) => a.upto_km - b.upto_km);
        logger.debug('Loaded custom tramos from env:', parsed.length, 'brackets');
        return parsed;
      }
    }
  } catch (e) {
    logger.warn('Failed to parse DELIVERY_TRAMOS env var, using defaults:', e.message);
  }
  return DEFAULT_TRAMOS;
}

/**
 * Validate latitude/longitude coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @throws {ValidationError} If coordinates are invalid
 */
function validateCoordinates(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    throw new ValidationError('Coordinates must be numbers', { lat, lon });
  }
  if (isNaN(lat) || isNaN(lon)) {
    throw new ValidationError('Coordinates cannot be NaN', { lat, lon });
  }
  if (lat < -90 || lat > 90) {
    throw new ValidationError('Latitude must be between -90 and 90', { lat });
  }
  if (lon < -180 || lon > 180) {
    throw new ValidationError('Longitude must be between -180 and 180', { lon });
  }
}

/**
 * Calculate straight-line distance between two points using Haversine formula
 * @param {{lat: number, lon: number}} a - Origin coordinates
 * @param {{lat: number, lon: number}} b - Destination coordinates
 * @returns {number} Distance in meters
 */
function haversineDistanceMeters(a, b) {
  validateCoordinates(a.lat, a.lon);
  validateCoordinates(b.lat, b.lon);
  
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aHarv = sinDLat * sinDLat + sinDLon * sinDLon * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aHarv), Math.sqrt(1 - aHarv));
  
  const distance = R * c;
  logger.debug('Haversine distance calculated:', distance.toFixed(2), 'meters');
  return distance;
}

/**
 * Generate cache key from coordinates
 * Using MD5 for deterministic, compact keys (cache only, not security-critical)
 * @param {{lat: number, lon: number}} from - Origin
 * @param {{lat: number, lon: number}} to - Destination
 * @returns {string} Cache key
 */
function generateCacheKey(from, to) {
  const normalized = `${from.lat.toFixed(6)},${from.lon.toFixed(6)}-${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
  // MD5 used for compact cache keys (not security-critical)
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Normalize place input to { lat, lon } with geocoding if needed
 * @param {string|Object} place - Address string or coordinates object
 * @returns {Promise<{lat: number, lon: number, source: string}|null>} Normalized coordinates or null
 * @throws {ValidationError} If place format is invalid
 */
async function geocodePlace(place) {
  const startTime = Date.now();
  
  // Validate input
  if (!place) {
    throw new ValidationError('Place is required', { place });
  }
  
  // If already coordinates object
  if (typeof place === "object") {
    const lat = Number(place.lat ?? place.latitude ?? place.latitud ?? NaN);
    const lon = Number(place.lon ?? place.longitude ?? place.long ?? place.lng ?? NaN);
    
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      validateCoordinates(lat, lon);
      logger.debug('Using provided coordinates:', { lat, lon });
      return { lat, lon, source: "input_coords" };
    }
    
    // If object has 'address' field, fall through to geocode string
    if (place.address) {
      place = place.address;
    } else {
      throw new ValidationError('Invalid coordinate object', { place });
    }
  }

  // If it's a string address
  const address = sanitizeInput(String(place).trim(), 500);
  if (!address) {
    throw new ValidationError('Address cannot be empty', { place });
  }

  // Check cache
  const cacheKey = `geo:${address.toLowerCase()}`;
  const cached = geoCache.get(cacheKey);
  if (cached) {
    logger.debug('Geocoding cache hit for:', address.substring(0, 50));
    metrics.record('geocode_cache_hit', 1);
    return { lat: cached.lat, lon: cached.lon, source: "cache" };
  }

  metrics.record('geocode_cache_miss', 1);
  logger.debug('Geocoding address:', address.substring(0, 50));

  // Check rate limit
  try {
    apiRateLimiter.checkLimit('nominatim');
  } catch (error) {
    logger.error('Nominatim rate limit exceeded');
    metrics.record('geocode_rate_limit', 1);
    throw error;
  }

  // Use Nominatim (OpenStreetMap) for geocoding with retry
  try {
    const result = await retryAsync(
      async () => {
        const r = await axios.get(NOMINATIM_URL, {
          params: { q: address, format: "json", limit: 1, addressdetails: 0 },
          headers: { "User-Agent": "delivery-middleware" },
          timeout: AXIOS_TIMEOUT
        });
        
        const data = r.data;
        if (!Array.isArray(data) || data.length === 0) {
          throw new AppError("No geocoding results found", 404, 'GEOCODING_NO_RESULTS');
        }
        
        const first = data[0];
        const lat = Number(first.lat);
        const lon = Number(first.lon);
        
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
          throw new AppError("Invalid geocode coordinates in response", 500, 'GEOCODING_INVALID_RESPONSE');
        }
        
        validateCoordinates(lat, lon);
        
        const duration = Date.now() - startTime;
        logger.info('Geocoded address successfully:', { address: address.substring(0, 50), lat, lon, duration: `${duration}ms` });
        metrics.record('geocode_duration', duration, { provider: 'nominatim' });
        metrics.record('geocode_success', 1, { provider: 'nominatim' });
        
        // cache
        geoCache.set(cacheKey, { lat, lon });
        return { lat, lon, source: "nominatim" };
      },
      {
        maxRetries: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        shouldRetry: (err) => {
          // Only retry on network errors, not on ZERO_RESULTS
          return err.code === 'ECONNREFUSED' || 
                 err.code === 'ETIMEDOUT' || 
                 err.code === 'ENOTFOUND' ||
                 (err.response && err.response.status >= 500);
        }
      }
    );
    
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error('Geocoding failed:', { address: address.substring(0, 50), error: err.message, duration: `${duration}ms` });
    metrics.record('geocode_failure', 1, { provider: 'nominatim', error: err.code || 'UNKNOWN' });
    
    // Return null instead of throwing to allow fallback handling
    return null;
  }
}

/**
 * Use Mapbox Directions API to calculate route
 * @param {{lat: number, lon: number}} from - Origin coordinates
 * @param {{lat: number, lon: number}} to - Destination coordinates
 * @returns {Promise<{provider: string, distance_m: number, duration_s: number, raw: Object}>} Route result
 * @throws {AppError} If Mapbox token not configured or API fails
 */
async function routeWithMapbox(from, to) {
  const startTime = Date.now();
  const token = process.env.MAPBOX_TOKEN;
  
  if (!token) {
    throw new AppError("MAPBOX_TOKEN not configured", 500, 'MAPBOX_NOT_CONFIGURED');
  }

  validateCoordinates(from.lat, from.lon);
  validateCoordinates(to.lat, to.lon);

  logger.debug('Requesting Mapbox route:', { from, to });

  // Check rate limit
  try {
    apiRateLimiter.checkLimit('mapbox');
  } catch (error) {
    logger.error('Mapbox rate limit exceeded');
    metrics.record('mapbox_rate_limit', 1);
    throw error;
  }

  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${MAPBOX_DIRECTIONS_URL}/${coords}`;
  const params = {
    alternatives: false,
    geometries: "geojson",
    overview: "simplified",
    steps: false,
    access_token: token
  };

  try {
    const result = await retryAsync(
      async () => {
        const r = await axios.get(url, { params, timeout: AXIOS_TIMEOUT });
        const data = r.data;
        
        // Validate response structure
        if (!data || typeof data !== 'object') {
          throw new AppError("Invalid Mapbox response structure", 500, 'MAPBOX_INVALID_RESPONSE');
        }
        
        if (!Array.isArray(data.routes) || data.routes.length === 0) {
          throw new AppError("Mapbox returned no routes", 404, 'MAPBOX_NO_ROUTE');
        }
        
        const route = data.routes[0];
        
        if (typeof route.distance !== 'number' || typeof route.duration !== 'number') {
          throw new AppError("Invalid route data from Mapbox", 500, 'MAPBOX_INVALID_DATA');
        }
        
        if (route.distance <= 0 || route.duration <= 0) {
          throw new AppError("Invalid distance/duration from Mapbox", 500, 'MAPBOX_INVALID_VALUES');
        }
        
        const duration = Date.now() - startTime;
        logger.info('Mapbox route calculated:', { 
          distance: `${route.distance.toFixed(0)}m`, 
          duration: `${route.duration.toFixed(0)}s`,
          apiDuration: `${duration}ms`
        });
        
        metrics.record('mapbox_api_duration', duration);
        metrics.record('mapbox_success', 1);
        
        return {
          provider: "mapbox",
          distance_m: Math.round(route.distance),
          duration_s: Math.round(route.duration),
          raw: data
        };
      },
      {
        maxRetries: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        shouldRetry: (err) => {
          // Don't retry on 4xx errors (invalid request)
          if (err.response && err.response.status >= 400 && err.response.status < 500) {
            return false;
          }
          // Retry on network errors and 5xx
          return err.code === 'ECONNREFUSED' || 
                 err.code === 'ETIMEDOUT' || 
                 err.code === 'ENOTFOUND' ||
                 (err.response && err.response.status >= 500);
        }
      }
    );
    
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error('Mapbox routing failed:', { 
      error: err.message, 
      code: err.code,
      duration: `${duration}ms`
    });
    metrics.record('mapbox_failure', 1, { error: err.code || 'UNKNOWN' });
    throw err;
  }
}

/**
 * Use OSRM public router to calculate route
 * @param {{lat: number, lon: number}} from - Origin coordinates
 * @param {{lat: number, lon: number}} to - Destination coordinates
 * @returns {Promise<{provider: string, distance_m: number, duration_s: number, raw: Object}>} Route result
 * @throws {AppError} If OSRM API fails
 */
async function routeWithOSRM(from, to) {
  const startTime = Date.now();
  
  validateCoordinates(from.lat, from.lon);
  validateCoordinates(to.lat, to.lon);

  logger.debug('Requesting OSRM route:', { from, to });

  // Check rate limit
  try {
    apiRateLimiter.checkLimit('osrm');
  } catch (error) {
    logger.error('OSRM rate limit exceeded');
    metrics.record('osrm_rate_limit', 1);
    throw error;
  }

  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM_URL}/${coords}`;
  const params = { overview: "false", alternatives: false, steps: false };

  try {
    const result = await retryAsync(
      async () => {
        const r = await axios.get(url, { params, timeout: AXIOS_TIMEOUT });
        const data = r.data;
        
        // Validate response structure
        if (!data || typeof data !== 'object') {
          throw new AppError("Invalid OSRM response structure", 500, 'OSRM_INVALID_RESPONSE');
        }
        
        if (data.code !== 'Ok') {
          throw new AppError(`OSRM returned error: ${data.code}`, 404, 'OSRM_ERROR');
        }
        
        if (!Array.isArray(data.routes) || data.routes.length === 0) {
          throw new AppError("OSRM returned no routes", 404, 'OSRM_NO_ROUTE');
        }
        
        const route = data.routes[0];
        
        if (typeof route.distance !== 'number' || typeof route.duration !== 'number') {
          throw new AppError("Invalid route data from OSRM", 500, 'OSRM_INVALID_DATA');
        }
        
        if (route.distance <= 0 || route.duration <= 0) {
          throw new AppError("Invalid distance/duration from OSRM", 500, 'OSRM_INVALID_VALUES');
        }
        
        const duration = Date.now() - startTime;
        logger.info('OSRM route calculated:', { 
          distance: `${route.distance.toFixed(0)}m`, 
          duration: `${route.duration.toFixed(0)}s`,
          apiDuration: `${duration}ms`
        });
        
        metrics.record('osrm_api_duration', duration);
        metrics.record('osrm_success', 1);
        
        return {
          provider: "osrm",
          distance_m: Math.round(route.distance),
          duration_s: Math.round(route.duration),
          raw: data
        };
      },
      {
        maxRetries: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        shouldRetry: (err) => {
          // Don't retry on 4xx errors (invalid request)
          if (err.response && err.response.status >= 400 && err.response.status < 500) {
            return false;
          }
          // Retry on network errors and 5xx
          return err.code === 'ECONNREFUSED' || 
                 err.code === 'ETIMEDOUT' || 
                 err.code === 'ENOTFOUND' ||
                 (err.response && err.response.status >= 500);
        }
      }
    );
    
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error('OSRM routing failed:', { 
      error: err.message, 
      code: err.code,
      duration: `${duration}ms`
    });
    metrics.record('osrm_failure', 1, { error: err.code || 'UNKNOWN' });
    throw err;
  }
}

/**
 * Select price based on tramos array and distance
 * @param {Array<{upto_km: number, price: number}>} tramos - Price brackets
 * @param {number} distance_km - Distance in kilometers
 * @returns {{price: number, tramo: Object}} Price and matching tramo
 */
function priceFromTramos(tramos, distance_km) {
  if (!Array.isArray(tramos) || tramos.length === 0) {
    logger.warn('Invalid tramos array, using default pricing');
    return { price: 8, tramo: { upto_km: 9999, price: 8 } };
  }
  
  if (typeof distance_km !== 'number' || distance_km < 0) {
    logger.warn('Invalid distance_km:', distance_km);
    distance_km = 0;
  }
  
  logger.debug('Calculating price for distance:', distance_km, 'km');
  
  for (const t of tramos) {
    if (distance_km <= Number(t.upto_km)) {
      const price = Number(t.price);
      validateAmount(price); // Ensure price is valid
      logger.debug('Price selected from tramo:', { distance_km, tramo: t, price });
      metrics.record('price_calculated', price, { tramo: `${t.upto_km}km` });
      return { price: Math.round(price * 100) / 100, tramo: t };
    }
  }
  
  // fallback to last tramo
  const last = tramos[tramos.length - 1];
  const price = Number(last.price);
  logger.debug('Price fallback to last tramo:', { distance_km, tramo: last, price });
  metrics.record('price_calculated', price, { tramo: 'fallback' });
  return { price: Math.round(price * 100) / 100, tramo: last };
}

/**
 * Calculate route and delivery price
 * 
 * @param {string|Object} origin - Origin address string or coordinates {lat, lon}
 * @param {string|Object} destination - Destination address string or coordinates {lat, lon}
 * @param {Object} [options] - Optional configuration
 * @param {Array} [options.tramos] - Custom price brackets
 * @returns {Promise<Object>} Route result with distance, duration, price, and metadata
 * 
 * @throws {ValidationError} If origin/destination are invalid
 * @throws {RateLimitError} If API rate limit is exceeded
 * @throws {AppError} If routing fails completely
 * 
 * @example
 * // With coordinates
 * const result = await calculateRoute(
 *   { lat: -12.0464, lon: -77.0428 },
 *   { lat: -12.0897, lon: -77.0444 }
 * );
 * // result: { ok: true, distance_m: 5420, distance_km: 5.42, duration_min: 15, price: 7, ... }
 * 
 * @example
 * // With address strings
 * const result = await calculateRoute(
 *   "Av. Javier Prado Este 2465, Lima",
 *   "Av. La Marina 2000, San Miguel"
 * );
 */
export async function calculateRoute(origin, destination, options = {}) {
  const calcStartTime = Date.now();
  
  logger.info('Route calculation started:', { 
    origin: typeof origin === 'string' ? origin.substring(0, 50) : origin,
    destination: typeof destination === 'string' ? destination.substring(0, 50) : destination
  });

  // Validate inputs
  if (!origin || !destination) {
    logger.error('Missing origin or destination');
    metrics.record('route_calculation_failure', 1, { error: 'missing_params' });
    throw new ValidationError('Both origin and destination are required', { origin, destination });
  }

  const tramos = options.tramos || parseTramosFromEnv();
  
  // Validate tramos structure
  if (!Array.isArray(tramos) || tramos.length === 0) {
    logger.error('Invalid tramos configuration');
    throw new ValidationError('Invalid tramos configuration', { tramos });
  }

  // 1) Resolve coordinates with geocoding
  logger.debug('Resolving coordinates...');
  let fromCoords, toCoords;
  
  try {
    [fromCoords, toCoords] = await Promise.all([
      geocodePlace(origin), 
      geocodePlace(destination)
    ]);
  } catch (err) {
    logger.error('Geocoding error:', err.message);
    metrics.record('route_calculation_failure', 1, { error: 'geocoding_error' });
    throw err;
  }
  
  if (!fromCoords || !toCoords) {
    const calcDuration = Date.now() - calcStartTime;
    logger.error('Geocoding failed for origin or destination', { calcDuration: `${calcDuration}ms` });
    metrics.record('route_calculation_failure', 1, { error: 'geocoding_failed' });
    
    return {
      ok: false,
      error: "geocoding_failed",
      message: "No se pudo localizar la dirección de origen o destino",
      provider: null
    };
  }

  logger.info('Coordinates resolved:', { 
    from: fromCoords, 
    to: toCoords,
    fromSource: fromCoords.source,
    toSource: toCoords.source
  });

  // 2) Check route cache
  const cacheKey = generateCacheKey(fromCoords, toCoords);
  const cachedRoute = routeCache.get(cacheKey);
  
  if (cachedRoute) {
    const calcDuration = Date.now() - calcStartTime;
    logger.info('Route cache hit:', { cacheKey: cacheKey.substring(0, 16), calcDuration: `${calcDuration}ms` });
    metrics.record('route_cache_hit', 1);
    metrics.record('route_calculation_success', 1, { source: 'cache' });
    metrics.record('route_calculation_duration', calcDuration, { source: 'cache' });
    return { ...cachedRoute, cached: true };
  }
  
  metrics.record('route_cache_miss', 1);
  logger.debug('Route cache miss, calculating...');

  // 3) Try routing provider(s)
  let routeResult = null;
  let providerUsed = null;
  let raw = null;
  let note = null;

  // Prefer Mapbox if token present
  if (process.env.MAPBOX_TOKEN) {
    try {
      logger.debug('Attempting Mapbox routing...');
      const r = await routeWithMapbox(fromCoords, toCoords);
      routeResult = r;
      providerUsed = r.provider;
      raw = r.raw;
      logger.info('Mapbox routing succeeded');
    } catch (err) {
      logger.warn('Mapbox routing failed, will try fallback:', err.message);
      note = `Mapbox routing failed: ${err.message}. Falling back to OSRM/Haversine.`;
      metrics.record('routing_fallback', 1, { from: 'mapbox', reason: err.code || 'error' });
    }
  } else {
    logger.debug('MAPBOX_TOKEN not configured, skipping Mapbox');
  }

  if (!routeResult) {
    try {
      logger.debug('Attempting OSRM routing...');
      const r = await routeWithOSRM(fromCoords, toCoords);
      routeResult = r;
      providerUsed = r.provider;
      raw = r.raw;
      logger.info('OSRM routing succeeded');
    } catch (err) {
      logger.warn('OSRM routing failed, will use Haversine fallback:', err.message);
      note = (note ? note + " " : "") + `OSRM routing failed: ${err.message}. Falling back to Haversine estimate.`;
      metrics.record('routing_fallback', 1, { from: 'osrm', reason: err.code || 'error' });
    }
  }

  // 4) If routing failed, fallback to haversine estimate
  let distance_m = null;
  let duration_min = null;
  
  if (routeResult && typeof routeResult.distance_m === "number") {
    distance_m = routeResult.distance_m;
    duration_min = Math.max(1, Math.round((routeResult.duration_s || 0) / 60));
    logger.debug('Using routing result:', { distance_m, duration_min });
  } else {
    // Haversine fallback
    logger.warn('Using Haversine fallback for distance estimation');
    metrics.record('haversine_fallback', 1);
    
    const meters = Math.round(haversineDistanceMeters(fromCoords, toCoords));
    distance_m = meters;
    
    // Conservative ETA: assume average speed 25 km/h in urban
    const distance_km = distance_m / 1000;
    duration_min = Math.max(5, Math.round((distance_km / 25) * 60)); // at least 5 minutes
    
    providerUsed = providerUsed || "haversine_estimate";
    raw = raw || { note: "haversine_fallback" };
    note = (note ? note + " " : "") + "Used haversine fallback for distance and ETA.";
    
    logger.info('Haversine estimate:', { distance_m, duration_min, distance_km });
  }

  // Validate calculated values
  if (distance_m <= 0) {
    logger.error('Invalid distance calculated:', distance_m);
    metrics.record('route_calculation_failure', 1, { error: 'invalid_distance' });
    throw new AppError('Invalid distance calculated', 500, 'INVALID_DISTANCE');
  }

  const distance_km = Number((distance_m / 1000).toFixed(3));
  metrics.record('distance_calculated', distance_km);

  // 5) Calculate price from tramos
  logger.debug('Calculating price...');
  const { price, tramo } = priceFromTramos(tramos, distance_km);

  const calcDuration = Date.now() - calcStartTime;
  
  const result = {
    ok: true,
    provider: providerUsed || "unknown",
    distance_m: Math.round(distance_m),
    distance_km,
    duration_min,
    price: Number(price),
    tarifa_tramo: tramo,
    raw,
    note: note || null,
    calculation_time_ms: calcDuration
  };

  // Cache the result
  routeCache.set(cacheKey, result);
  
  logger.info('Route calculation completed:', {
    provider: result.provider,
    distance: `${result.distance_km}km`,
    duration: `${result.duration_min}min`,
    price: `S/${result.price}`,
    calcDuration: `${calcDuration}ms`
  });
  
  metrics.record('route_calculation_success', 1, { provider: result.provider });
  metrics.record('route_calculation_duration', calcDuration, { provider: result.provider });

  return result;
}

/**
 * Get current metrics for monitoring and debugging
 * @returns {Object} Metrics statistics
 * @example
 * const stats = getMetrics();
 * console.log('Cache hit rate:', stats.cacheHitRate);
 */
export function getMetrics() {
  return {
    routeCalculations: metrics.getStats('route_calculation_success'),
    routeFailures: metrics.getStats('route_calculation_failure'),
    cacheStats: {
      hits: metrics.getStats('route_cache_hit'),
      misses: metrics.getStats('route_cache_miss'),
      geocodeHits: metrics.getStats('geocode_cache_hit'),
      geocodeMisses: metrics.getStats('geocode_cache_miss'),
      routeCacheSize: routeCache.size(),
      geoCacheSize: geoCache.size()
    },
    apiCalls: {
      mapbox: metrics.getStats('mapbox_success'),
      osrm: metrics.getStats('osrm_success'),
      geocode: metrics.getStats('geocode_success')
    },
    fallbacks: metrics.getStats('routing_fallback'),
    rateLimits: {
      mapbox: metrics.getStats('mapbox_rate_limit'),
      osrm: metrics.getStats('osrm_rate_limit'),
      geocode: metrics.getStats('geocode_rate_limit')
    }
  };
}

/**
 * Clear all caches (useful for testing or cache invalidation)
 * @example
 * clearCaches();
 */
export function clearCaches() {
  routeCache.clear();
  geoCache.clear();
  logger.info('All caches cleared');
}

/**
 * Reset all metrics (useful for testing)
 * @example
 * resetMetrics();
 */
export function resetMetrics() {
  metrics.reset();
  logger.info('All metrics reset');
}

/* Default export for convenience */
export default { 
  calculateRoute, 
  getMetrics, 
  clearCaches, 
  resetMetrics 
};