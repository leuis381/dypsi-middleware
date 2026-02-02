/**
 * lib/zona-precios.js
 *
 * Gestión de zonas de precio y cálculo de delivery
 * - findZoneByDistrict(district) - Encontrar zona por distrito
 * - calculateRoutePrice(storeCoords, destCoords) - Calcular precio de ruta
 * - calculateOrderTotal(items, addressComponents, options) - Calcular total de orden
 */

import { logger, ValidationError, AppError } from './utils.js';
import CONFIG from './config.js';

const DEFAULT_TAX_RATE = CONFIG.TAX_RATE || 0.18;
const DEFAULT_DELIVERY_FEE = CONFIG.DELIVERY_BASE_FEE || 3.5;
const DELIVERY_PER_KM = CONFIG.DELIVERY_PER_KM || 1.2;
const ROUNDING = 0.01;

/**
 * Definiciones de zonas de entrega con precios
 * @type {Array<Object>}
 * @private
 */
const ZONE_RULES = [
  { zone: 'A', districts: ['miraflores', 'san isidro', 'jesus maria'], delivery: 5.0, description: 'Centro Premium' },
  { zone: 'B', districts: ['magdalena', 'san borja', 'surco'], delivery: 7.0, description: 'Centro Medio' },
  { zone: 'C', districts: ['lince', 'barranco', 'san miguel'], delivery: 9.0, description: 'Periferia Cercana' },
  { zone: 'D', districts: [], delivery: 12.0, description: 'Zona Lejana' }
];

/**
 * Encuentra la zona según el distrito
 * @param {string} district - Nombre del distrito
 * @returns {Object} { zone, districts, delivery, description }
 * @throws {ValidationError} Si el distrito es inválido
 */
export function findZoneByDistrict(district) {
  if (!district || typeof district !== 'string') {
    logger.warn('ZONE_INVALID_DISTRICT', { district });
    return ZONE_RULES.find(z => z.zone === 'D');
  }

  const normalizedDistrict = district.toString().trim().toLowerCase();

  logger.debug('ZONE_LOOKUP_START', { district: normalizedDistrict });

  for (const zone of ZONE_RULES) {
    if (zone.districts.includes(normalizedDistrict)) {
      logger.debug('ZONE_FOUND', { district: normalizedDistrict, zone: zone.zone });
      return zone;
    }
  }

  logger.debug('ZONE_NOT_FOUND_USING_DEFAULT', { district: normalizedDistrict });
  return ZONE_RULES.find(z => z.zone === 'D');
}

/**
 * Calcula la distancia usando la fórmula Haversine
 * @param {Object} coords1 - { lat, lon } - Coordenadas iniciales
 * @param {Object} coords2 - { lat, lon } - Coordenadas finales
 * @returns {number} Distancia en kilómetros
 * @throws {ValidationError} Si las coordenadas son inválidas
 * @private
 */
function calculateHaversineDistance(coords1, coords2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const R = 6371; // Radio de la Tierra en km

  const lat1 = parseFloat(coords1?.lat);
  const lon1 = parseFloat(coords1?.lon);
  const lat2 = parseFloat(coords2?.lat);
  const lon2 = parseFloat(coords2?.lon);

  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
    logger.warn('INVALID_COORDINATES', { coords1, coords2 });
    throw new ValidationError('INVALID_COORDINATES', 'Las coordenadas deben ser números válidos');
  }

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Number(distance.toFixed(2));
}

/**
 * Calcula el precio de una ruta basado en distancia
 * @param {Object} storeCoords - { lat, lon } - Coordenadas de la tienda
 * @param {Object} destCoords - { lat, lon } - Coordenadas de destino
 * @returns {Object} { distanceKm, durationMin, price }
 * @throws {ValidationError} Si las coordenadas son inválidas
 */
export function calculateRoutePrice(storeCoords = {}, destCoords = {}) {
  try {
    logger.debug('ROUTE_PRICE_CALCULATION_START', { storeCoords, destCoords });

    if (!storeCoords || !destCoords) {
      throw new ValidationError('COORDINATES_REQUIRED', 'Las coordenadas de tienda y destino son requeridas');
    }

    // Calcular distancia
    const distanceKm = calculateHaversineDistance(storeCoords, destCoords);

    // Estimar duración: 20 km/h promedio en zona urbana
    const durationMin = Math.max(5, Math.round((distanceKm / 20) * 60));

    // Calcular precio: base + por km
    const basePrice = DEFAULT_DELIVERY_FEE;
    const variablePrice = distanceKm * DELIVERY_PER_KM;
    const price = Number((basePrice + variablePrice).toFixed(2));

    logger.info('ROUTE_PRICE_CALCULATED', { distanceKm, durationMin, price });

    return { distanceKm, durationMin, price };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('ROUTE_PRICE_CALCULATION_FAILED', { error: error.message });
    throw new AppError('ROUTE_CALCULATION_FAILED', 'Error calculando precio de ruta', { cause: error });
  }
}

/**
 * Calcula el total de una orden incluyendo impuestos y delivery
 * @param {Object} params - Parámetros
 * @param {Array} params.items - Items de la orden
 * @param {Object} params.addressComponents - { district, lat, lon }
 * @param {Object} params.options - { taxRate, deliveryPrice }
 * @returns {Object} { breakdown, total, zone, warnings }
 * @throws {ValidationError} Si los parámetros son inválidos
 */
export function calculateOrderTotal({ items = [], addressComponents = {}, options = {} } = {}) {
  try {
    logger.debug('ORDER_TOTAL_CALCULATION_START', { itemCount: items.length, district: addressComponents?.district });

    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('ITEMS_REQUIRED', 'La orden debe contener al menos 1 item');
    }

    const taxRate = options.taxRate ?? DEFAULT_TAX_RATE;

    if (isNaN(taxRate) || taxRate < 0 || taxRate > 1) {
      throw new ValidationError('INVALID_TAX_RATE', 'La tasa de impuesto debe ser entre 0 y 1');
    }

    let subtotal = 0;
    const warnings = [];

    // Calcular subtotal validando cada item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item || typeof item !== 'object') {
        throw new ValidationError('ITEM_INVALID', `Item ${i}: debe ser un objeto válido`);
      }

      const unitPrice = Number(item.price ?? item.priceHint ?? 0);
      if (isNaN(unitPrice) || unitPrice < 0) {
        throw new ValidationError('ITEM_PRICE_INVALID', `Item ${i}: precio inválido (${item.price})`);
      }

      const quantity = Number(item.quantity ?? 1);
      if (isNaN(quantity) || quantity < 1) {
        throw new ValidationError('ITEM_QUANTITY_INVALID', `Item ${i}: cantidad debe ser >= 1`);
      }

      const extrasPrice = Number(item.extrasPrice ?? 0);
      if (isNaN(extrasPrice) || extrasPrice < 0) {
        throw new ValidationError('ITEM_EXTRAS_INVALID', `Item ${i}: extras inválidos`);
      }

      if (unitPrice === 0) {
        warnings.push(`Item ${i} (${item.id || 'unknown'}): precio es 0`);
      }

      subtotal += (unitPrice + extrasPrice) * quantity;
    }

    // Obtener zona y delivery
    const zone = findZoneByDistrict(addressComponents?.district);
    let deliveryPrice = zone?.delivery ?? 0;

    // Permitir override de delivery price
    if (typeof options.deliveryPrice === 'number') {
      deliveryPrice = Math.max(0, options.deliveryPrice);
    }

    // Calcular impuestos y total
    const tax = subtotal * taxRate;
    const rawTotal = subtotal + tax + deliveryPrice;
    const total = Math.round((rawTotal + Number.EPSILON) / ROUNDING) * ROUNDING;

    logger.info('ORDER_TOTAL_CALCULATED', {
      subtotal: Number(subtotal.toFixed(2)),
      tax: Number(tax.toFixed(2)),
      delivery: Number(deliveryPrice.toFixed(2)),
      total: Number(total.toFixed(2)),
      zone: zone.zone
    });

    return {
      breakdown: {
        subtotal: Number(subtotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        delivery: Number(deliveryPrice.toFixed(2))
      },
      total: Number(total.toFixed(2)),
      zone: zone.zone,
      zoneDescription: zone.description,
      warnings
    };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('ORDER_TOTAL_CALCULATION_FAILED', { error: error.message });
    throw new AppError('ORDER_TOTAL_FAILED', 'Error calculando total de orden', { cause: error });
  }
}

export default {
  findZoneByDistrict,
  calculateRoutePrice,
  calculateOrderTotal
};
