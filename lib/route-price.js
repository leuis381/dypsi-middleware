import axios from "axios";

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
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 250;
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

/* Simple in-memory cache to avoid repeated geocoding in short time */
const geoCache = new Map(); // key -> { lat, lon, expiresAt }
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTramosFromEnv() {
  try {
    if (process.env.DELIVERY_TRAMOS) {
      const parsed = JSON.parse(process.env.DELIVERY_TRAMOS);
      if (Array.isArray(parsed) && parsed.length) {
        // ensure sorted ascending by upto_km
        parsed.sort((a, b) => a.upto_km - b.upto_km);
        return parsed;
      }
    }
  } catch (e) {
    // ignore and use defaults
    console.warn("Invalid DELIVERY_TRAMOS env var, using defaults.");
  }
  return DEFAULT_TRAMOS;
}

function haversineDistanceMeters(a, b) {
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
  return R * c;
}

async function retryRequest(fn, maxRetries = MAX_RETRIES) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isLast = attempt >= maxRetries;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      if (isLast) throw err;
      await sleep(delay);
    }
  }
}

/* Normalize place input to { lat, lon } or return null if not resolvable */
async function geocodePlace(place) {
  // If already coordinates object
  if (!place) return null;
  if (typeof place === "object") {
    const lat = Number(place.lat ?? place.latitude ?? place.latitud ?? place.lat);
    const lon = Number(place.lon ?? place.longitude ?? place.long ?? place.lng ?? place.lon);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      return { lat, lon, source: "input_coords" };
    }
    // If object has 'address' field, fall through to geocode string
    if (place.address) place = place.address;
  }

  // If it's already a valid URL-like or string address
  const address = String(place).trim();
  if (!address) return null;

  // Check cache
  const cacheKey = `geo:${address.toLowerCase()}`;
  const cached = geoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { lat: cached.lat, lon: cached.lon, source: "cache" };
  }

  // Use Nominatim (OpenStreetMap) for geocoding
  const fn = async () => {
    const r = await axios.get(NOMINATIM_URL, {
      params: { q: address, format: "json", limit: 1, addressdetails: 0 },
      headers: { "User-Agent": "delivery-middleware" },
      timeout: AXIOS_TIMEOUT
    });
    const data = r.data;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Geocoding no results");
    }
    const first = data[0];
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) throw new Error("Invalid geocode coordinates");
    // cache
    geoCache.set(cacheKey, { lat, lon, expiresAt: Date.now() + CACHE_TTL_MS });
    return { lat, lon, source: "nominatim" };
  };

  try {
    return await retryRequest(fn);
  } catch (err) {
    // geocoding failed
    return null;
  }
}

/* Use Mapbox Directions API if token present */
async function routeWithMapbox(from, to) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN not configured");

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
    const r = await axios.get(url, { params, timeout: AXIOS_TIMEOUT });
    const data = r.data;
    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error("Mapbox no route");
    }
    const route = data.routes[0];
    return {
      provider: "mapbox",
      distance_m: Math.round(route.distance),
      duration_s: Math.round(route.duration),
      raw: data
    };
  };

  return await retryRequest(fn);
}

/* Use OSRM public router */
async function routeWithOSRM(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM_URL}/${coords}`;
  const params = { overview: "false", alternatives: false, steps: false };

  const fn = async () => {
    const r = await axios.get(url, { params, timeout: AXIOS_TIMEOUT });
    const data = r.data;
    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error("OSRM no route");
    }
    const route = data.routes[0];
    return {
      provider: "osrm",
      distance_m: Math.round(route.distance),
      duration_s: Math.round(route.duration),
      raw: data
    };
  };

  return await retryRequest(fn);
}

/* Select price based on tramos array and distance_km */
function priceFromTramos(tramos, distance_km) {
  for (const t of tramos) {
    if (distance_km <= Number(t.upto_km)) {
      return { price: Number(t.price), tramo: t };
    }
  }
  // fallback to last tramo
  const last = tramos[tramos.length - 1];
  return { price: Number(last.price), tramo: last };
}

/**
 * calculateRoute(origin, destination)
 * - origin/destination: address string OR { lat, lon } object
 * - returns null on fatal failure or an object:
 *   {
 *     distance_m,
 *     distance_km,
 *     duration_min,
 *     price,
 *     tarifa_tramo,
 *     provider,
 *     raw,
 *     note
 *   }
 */
export async function calculateRoute(origin, destination) {
  if (!origin || !destination) {
    throw new Error("Both origin and destination are required");
  }

  const tramos = parseTramosFromEnv();

  // 1) Resolve coordinates
  const [fromCoords, toCoords] = await Promise.all([geocodePlace(origin), geocodePlace(destination)]);
  if (!fromCoords || !toCoords) {
    // cannot geocode one of the points
    return {
      ok: false,
      error: "geocoding_failed",
      message: "No se pudo localizar la dirección de origen o destino",
      provider: null
    };
  }

  // 2) Try routing provider(s)
  let routeResult = null;
  let providerUsed = null;
  let raw = null;
  let note = null;

  // Prefer Mapbox if token present
  if (process.env.MAPBOX_TOKEN) {
    try {
      const r = await routeWithMapbox(fromCoords, toCoords);
      routeResult = r;
      providerUsed = r.provider;
      raw = r.raw;
    } catch (err) {
      // log and fallback
      console.warn("Mapbox routing failed:", err.message || err);
      note = `Mapbox routing failed: ${err.message || "error"}. Falling back to OSRM/Haversine.`;
    }
  }

  if (!routeResult) {
    try {
      const r = await routeWithOSRM(fromCoords, toCoords);
      routeResult = r;
      providerUsed = r.provider;
      raw = r.raw;
    } catch (err) {
      console.warn("OSRM routing failed:", err.message || err);
      note = (note ? note + " " : "") + `OSRM routing failed: ${err.message || "error"}. Falling back to Haversine estimate.`;
    }
  }

  // 3) If routing failed, fallback to haversine estimate
  let distance_m = null;
  let duration_min = null;
  if (routeResult && typeof routeResult.distance_m === "number") {
    distance_m = routeResult.distance_m;
    duration_min = Math.max(1, Math.round((routeResult.duration_s || 0) / 60));
  } else {
    // Haversine fallback
    const meters = Math.round(haversineDistanceMeters(fromCoords, toCoords));
    distance_m = meters;
    // Conservative ETA: assume average speed 25 km/h in urban (6.94 m/s) -> minutes = meters / (25000/3600) / 60
    // Simpler: minutes = distance_km / 25 * 60
    const distance_km = distance_m / 1000;
    duration_min = Math.max(5, Math.round((distance_km / 25) * 60)); // at least 5 minutes
    providerUsed = providerUsed || "haversine_estimate";
    raw = raw || { note: "haversine_fallback" };
    note = (note ? note + " " : "") + "Used haversine fallback for distance and ETA.";
  }

  const distance_km = Number((distance_m / 1000).toFixed(3));
  const { price, tramo } = priceFromTramos(tramos, distance_km);

  return {
    ok: true,
    provider: providerUsed || "unknown",
    distance_m: Math.round(distance_m),
    distance_km,
    duration_min,
    price: Number(price),
    tarifa_tramo: tramo,
    raw,
    note: note || null
  };
}

/* Default export for convenience */
export default { calculateRoute };