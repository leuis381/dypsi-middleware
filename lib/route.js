import axios from "axios";

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

/* Default tramos (km -> price in PEN) */
const DEFAULT_TRAMOS = [
  { upto_km: 0.9, price: 3 },
  { upto_km: 2.0, price: 4 },
  { upto_km: 3.0, price: 5 },
  { upto_km: 4.0, price: 6 },
  { upto_km: 5.0, price: 7 },
  { upto_km: 9999, price: 8 }
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTramosFromEnv() {
  try {
    if (process.env.DELIVERY_TRAMOS) {
      const parsed = JSON.parse(process.env.DELIVERY_TRAMOS);
      if (Array.isArray(parsed) && parsed.length) {
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

function priceFromTramos(tramos, distance_km) {
  for (const t of tramos) {
    if (distance_km <= Number(t.upto_km)) {
      return { price: Number(t.price), tramo: t };
    }
  }
  const last = tramos[tramos.length - 1];
  return { price: Number(last.price), tramo: last };
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeCoords(obj) {
  if (!obj || typeof obj !== "object") return null;
  const lat = toNumber(obj.lat ?? obj.latitude ?? obj.latitud);
  const lon = toNumber(obj.lon ?? obj.longitude ?? obj.long ?? obj.lng ?? obj.lon);
  if (lat === null || lon === null) return null;
  return { lat, lon };
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

/* Geocode address string using Nominatim */
async function geocodeAddress(address) {
  if (!address || typeof address !== "string") return null;
  const fn = async () => {
    const r = await axios.get(NOMINATIM_URL, {
      params: { q: address, format: "json", limit: 1, addressdetails: 0 },
      headers: { "User-Agent": "delivery-middleware" },
      timeout: AXIOS_TIMEOUT
    });
    const data = r.data;
    if (!Array.isArray(data) || data.length === 0) throw new Error("no_results");
    const first = data[0];
    const lat = toNumber(first.lat);
    const lon = toNumber(first.lon);
    if (lat === null || lon === null) throw new Error("invalid_coords");
    return { lat, lon, provider: "nominatim", raw: first };
  };
  try {
    return await retryRequest(fn);
  } catch {
    return null;
  }
}

/* Mapbox routing */
async function routeWithMapbox(from, to) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN_NOT_CONFIGURED");
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
    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) throw new Error("no_route");
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

/* OSRM routing */
async function routeWithOSRM(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM_URL}/${coords}`;
  const params = { overview: "false", alternatives: false, steps: false };
  const fn = async () => {
    const r = await axios.get(url, { params, timeout: AXIOS_TIMEOUT });
    const data = r.data;
    if (!data || !Array.isArray(data.routes) || data.routes.length === 0) throw new Error("no_route");
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

/* Haversine fallback */
function haversineDistanceMeters(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
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

/* Main handler */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use POST." });
  }

  const start = Date.now();
  try {
    const body = req.body || {};
    const { origin, destination, include_price = true } = body;

    if (!origin || !destination) {
      return res.status(400).json({ ok: false, error: "origin and destination are required" });
    }

    // Normalize coordinates if provided
    let fromCoords = normalizeCoords(origin);
    let toCoords = normalizeCoords(destination);

    // If not coords, attempt geocoding
    if (!fromCoords) {
      fromCoords = await geocodeAddress(origin);
    }
    if (!toCoords) {
      toCoords = await geocodeAddress(destination);
    }

    if (!fromCoords || !toCoords) {
      return res.status(200).json({
        ok: false,
        error: "location_not_found",
        details: { from: !!fromCoords, to: !!toCoords }
      });
    }

    // Try routing providers: Mapbox -> OSRM -> Haversine
    let route = null;
    let provider = null;
    let raw = null;
    let note = null;

    if (process.env.MAPBOX_TOKEN) {
      try {
        const r = await routeWithMapbox(fromCoords, toCoords);
        route = r;
        provider = r.provider;
        raw = r.raw;
      } catch (err) {
        console.warn("Mapbox routing failed:", err.message || err);
        note = `Mapbox routing failed: ${err.message || "error"}.`;
      }
    }

    if (!route) {
      try {
        const r = await routeWithOSRM(fromCoords, toCoords);
        route = r;
        provider = r.provider;
        raw = r.raw;
      } catch (err) {
        console.warn("OSRM routing failed:", err.message || err);
        note = (note ? note + " " : "") + `OSRM routing failed: ${err.message || "error"}.`;
      }
    }

    let distance_m, duration_min;
    if (route && typeof route.distance_m === "number") {
      distance_m = route.distance_m;
      duration_min = Math.max(1, Math.round((route.duration_s || 0) / 60));
    } else {
      // Haversine fallback
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
        processing_ms: Date.now() - start
      }
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Route handler error:", err && err.message ? err.message : err);
    return res.status(500).json({
      ok: false,
      error: "route_calculation_failed",
      details: err?.message || String(err)
    });
  }
}