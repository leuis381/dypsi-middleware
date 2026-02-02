/**
 * zona-precios.js
 *
 * Reemplaza pricing.js: reglas de zona y cálculo de delivery.
 * - findZoneByDistrict(district) -> { zone, delivery, note }
 * - calculateRoutePrice(storeCoords, destCoords) -> { distanceKm, durationMin, price }
 * - calculateOrderTotal(items, addressComponents, options) -> breakdown + total
 *
 * Nota: si quieres geocoding/route real, integra Mapbox/Google Maps en calculateRoutePrice.
 */

const DEFAULT_TAX = 0.18;
const ROUNDING = 0.01;

const ZONE_RULES = [
  { zone: "A", districts: ["miraflores","san isidro","jesus maria"], delivery: 5.0 },
  { zone: "B", districts: ["magdalena","san borja","surco"], delivery: 7.0 },
  { zone: "C", districts: ["lince","barranco","san miguel"], delivery: 9.0 },
  { zone: "D", districts: [], delivery: 12.0 } // default
];

export function findZoneByDistrict(district) {
  if (!district) return ZONE_RULES.find(z => z.zone === "D");
  const d = district.toString().toLowerCase();
  for (const z of ZONE_RULES) {
    if (z.districts.includes(d)) return z;
  }
  return ZONE_RULES.find(z => z.zone === "D");
}

/**
 * calculateRoutePrice
 * - storeCoords: { lat, lon }
 * - destCoords: { lat, lon }
 * - simple Haversine distance -> price scaling
 */
export function calculateRoutePrice(storeCoords = {}, destCoords = {}) {
  function toRad(v) { return v * Math.PI / 180; }
  const R = 6371; // km
  const lat1 = Number(storeCoords.lat || 0);
  const lon1 = Number(storeCoords.lon || 0);
  const lat2 = Number(destCoords.lat || 0);
  const lon2 = Number(destCoords.lon || 0);
  if (!lat1 || !lon1 || !lat2 || !lon2) return { distanceKm: null, durationMin: null, price: null };

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distanceKm = R * c;
  // duration estimate: 20 km/h urban average -> minutes
  const durationMin = Math.max(5, Math.round((distanceKm / 20) * 60));
  // price: base + per km
  const base = 3.0;
  const perKm = 1.0;
  const price = Number((base + perKm * distanceKm).toFixed(2));
  return { distanceKm: Number(distanceKm.toFixed(2)), durationMin, price };
}

/**
 * calculateOrderTotal
 * - items: [{ id, quantity, price, extrasPrice }]
 * - addressComponents: { district }
 * - options: { taxRate }
 */
export function calculateOrderTotal({ items = [], addressComponents = {}, options = {} } = {}) {
  const taxRate = options.taxRate ?? DEFAULT_TAX;
  let subtotal = 0;
  const warnings = [];

  for (const it of items) {
    const unit = Number(it.price ?? it.priceHint ?? 0);
    if (!unit || isNaN(unit)) warnings.push(`Precio faltante para ${it.id}`);
    const extrasPrice = Number(it.extrasPrice ?? 0);
    const qty = Number(it.quantity ?? 1);
    subtotal += (unit + extrasPrice) * qty;
  }

  const zone = findZoneByDistrict(addressComponents?.district);
  const delivery = zone?.delivery ?? ZONE_RULES.find(z => z.zone === "D").delivery;
  const tax = subtotal * taxRate;
  const rawTotal = subtotal + tax + delivery;
  const total = Math.round(rawTotal / ROUNDING) * ROUNDING;

  return {
    breakdown: {
      subtotal: Number(subtotal.toFixed(2)),
      tax: Number(tax.toFixed(2)),
      delivery: Number(delivery.toFixed(2))
    },
    total: Number(total.toFixed(2)),
    zone: zone.zone,
    warnings
  };
}

export default { findZoneByDistrict, calculateRoutePrice, calculateOrderTotal };
