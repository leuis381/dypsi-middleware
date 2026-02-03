/**
 * lib/smart-delivery.js
 * 
 * Sistema Inteligente de Cálculo de Delivery SIN Google Maps
 * Usa coordenadas, zonas predefinidas y heurísticas inteligentes
 * Ultra optimizado para funcionar 100% offline
 * 
 * MEJORADO: Incluye detección de proximidad a tienda para escalación a agente
 */

import { logger, ValidationError, AppError, MetricsCollector } from './utils.js';
import { CONFIG } from './config.js';

const metrics = new MetricsCollector();

// Constantes de proximidad
const PROXIMITY_THRESHOLDS = {
  VERY_CLOSE: 0.3,      // 300 metros - probablemente en la tienda
  CLOSE: 0.5,            // 500 metros - zona peatonal cercana
  NEARBY: 1.0,           // 1 km - mismo barrio
  SAME_AREA: 2.0,        // 2 km - área cercana
};

/**
 * Calcula distancia entre dos puntos usando fórmula de Haversine
 * Precisión excelente sin necesidad de APIs externas
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distancia en kilómetros
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  try {
    // Validar inputs
    if (typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
        typeof lat2 !== 'number' || typeof lon2 !== 'number') {
      throw new ValidationError('INVALID_COORDINATES', 'Las coordenadas deben ser números');
    }
    
    // Validar rangos
    if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
      throw new ValidationError('INVALID_LATITUDE', 'Latitud debe estar entre -90 y 90');
    }
    
    if (lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) {
      throw new ValidationError('INVALID_LONGITUDE', 'Longitud debe estar entre -180 y 180');
    }
    
    const R = 6371; // Radio de la Tierra en km
    
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    logger.debug('DISTANCE_CALCULATED', { 
      from: { lat: lat1, lon: lon1 },
      to: { lat: lat2, lon: lon2 },
      distance: distance.toFixed(2) + ' km'
    });
    
    metrics.record('distance_calculated', 1, { method: 'haversine' });
    
    return Number(distance.toFixed(2));
    
  } catch (error) {
    logger.error('DISTANCE_CALCULATION_ERROR', error);
    throw error;
  }
}

/**
 * Calcula el costo de delivery basado en distancia
 * @param {number} distanceKm - Distancia en kilómetros
 * @returns {Object} { cost, distance, zone, estimatedTime }
 */
export function calculateDeliveryCost(distanceKm) {
  try {
    // Validar distancia
    if (typeof distanceKm !== 'number' || distanceKm < 0) {
      throw new ValidationError('INVALID_DISTANCE', 'Distancia debe ser un número positivo');
    }
    
    // Verificar límite máximo
    if (distanceKm > CONFIG.DELIVERY_MAX_DISTANCE_KM) {
      logger.warn('DISTANCE_EXCEEDS_LIMIT', { 
        distance: distanceKm, 
        limit: CONFIG.DELIVERY_MAX_DISTANCE_KM 
      });
      
      return {
        cost: 0,
        distance: distanceKm,
        zone: 'fuera_de_rango',
        estimatedTime: null,
        available: false,
        message: `Lo sentimos, solo hacemos delivery hasta ${CONFIG.DELIVERY_MAX_DISTANCE_KM} km`
      };
    }
    
    // Calcular costo por tramos
    let cost = CONFIG.DELIVERY_BASE_FEE;
    let zone = 'cerca';
    let estimatedTime = CONFIG.DELIVERY_TIME_ESTIMATE_MINS;
    
    if (distanceKm <= 3) {
      // Zona cercana (0-3km)
      zone = 'muy_cerca';
      cost = CONFIG.DELIVERY_BASE_FEE;
      estimatedTime = 20;
    } else if (distanceKm <= 6) {
      // Zona media (3-6km)
      zone = 'cerca';
      cost = CONFIG.DELIVERY_BASE_FEE + (distanceKm - 3) * CONFIG.DELIVERY_PER_KM;
      estimatedTime = 30;
    } else if (distanceKm <= 10) {
      // Zona media-lejos (6-10km)
      zone = 'media';
      cost = CONFIG.DELIVERY_BASE_FEE + (distanceKm - 3) * CONFIG.DELIVERY_PER_KM;
      estimatedTime = 40;
    } else {
      // Zona lejos (10-15km)
      zone = 'lejos';
      cost = CONFIG.DELIVERY_BASE_FEE + (distanceKm - 3) * (CONFIG.DELIVERY_PER_KM * 1.2);
      estimatedTime = 50;
    }
    
    const result = {
      cost: Number(cost.toFixed(2)),
      distance: distanceKm,
      zone,
      estimatedTime,
      available: true,
      breakdown: {
        baseFee: CONFIG.DELIVERY_BASE_FEE,
        perKm: CONFIG.DELIVERY_PER_KM,
        calculation: `Base S/${CONFIG.DELIVERY_BASE_FEE} + ${distanceKm.toFixed(1)}km × S/${CONFIG.DELIVERY_PER_KM}`
      }
    };
    
    logger.info('DELIVERY_COST_CALCULATED', result);
    metrics.record('delivery_cost_calculated', 1, { zone, available: true });
    
    return result;
    
  } catch (error) {
    logger.error('DELIVERY_COST_ERROR', error);
    throw error;
  }
}

/**
 * Extrae coordenadas de diferentes formatos de dirección/ubicación
 * @param {Object|string} location - Ubicación en cualquier formato
 * @returns {Object|null} { lat, lon } o null si no se puede extraer
 */
export function extractCoordinates(location) {
  try {
    if (!location) {
      return null;
    }
    
    // Si ya es un objeto con lat/lon
    if (typeof location === 'object') {
      if (location.lat !== undefined && location.lon !== undefined) {
        return {
          lat: parseFloat(location.lat),
          lon: parseFloat(location.lon)
        };
      }
      
      if (location.latitude !== undefined && location.longitude !== undefined) {
        return {
          lat: parseFloat(location.latitude),
          lon: parseFloat(location.longitude)
        };
      }
      
      if (location.lat !== undefined && location.lng !== undefined) {
        return {
          lat: parseFloat(location.lat),
          lon: parseFloat(location.lng)
        };
      }
    }
    
    // Si es string, intentar extraer coordenadas
    if (typeof location === 'string') {
      // Formato: "-12.046374,-77.042793"
      const coordMatch = location.match(/-?\d+\.\d+/g);
      if (coordMatch && coordMatch.length >= 2) {
        return {
          lat: parseFloat(coordMatch[0]),
          lon: parseFloat(coordMatch[1])
        };
      }
    }
    
    logger.warn('COORDINATES_NOT_EXTRACTED', { location });
    return null;
    
  } catch (error) {
    logger.error('EXTRACT_COORDINATES_ERROR', error);
    return null;
  }
}

/**
 * Calcula delivery completo desde dirección/ubicación del cliente
 * @param {Object|string} clientLocation - Ubicación del cliente
 * @returns {Promise<Object>} Información completa de delivery
 */
export async function calculateDeliveryFromLocation(clientLocation) {
  const startTime = Date.now();
  
  try {
    logger.info('CALCULATING_DELIVERY', { location: clientLocation });
    
    // Extraer coordenadas
    const coords = extractCoordinates(clientLocation);
    
    if (!coords) {
      return {
        ok: false,
        error: 'No se pudieron extraer las coordenadas',
        message: 'Por favor comparte tu ubicación o escribe una dirección más específica',
        cost: 0,
        available: false
      };
    }
    
    // Calcular distancia desde la tienda
    const distance = calculateDistance(
      CONFIG.STORE_LAT,
      CONFIG.STORE_LON,
      coords.lat,
      coords.lon
    );
    
    // Calcular costo
    const deliveryInfo = calculateDeliveryCost(distance);
    
    const duration = Date.now() - startTime;
    
    logger.info('DELIVERY_CALCULATED_SUCCESS', { 
      distance,
      cost: deliveryInfo.cost,
      zone: deliveryInfo.zone,
      duration
    });
    
    metrics.record('delivery_calculated', 1, { 
      success: true, 
      zone: deliveryInfo.zone,
      duration
    });
    
    return {
      ok: true,
      ...deliveryInfo,
      coordinates: coords,
      storeCoordinates: {
        lat: CONFIG.STORE_LAT,
        lon: CONFIG.STORE_LON
      },
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('DELIVERY_CALCULATION_ERROR', error, { duration });
    
    metrics.record('delivery_calculated', 1, { 
      success: false, 
      error: error.message,
      duration
    });
    
    return {
      ok: false,
      error: error.message,
      message: 'Hubo un problema calculando el delivery. Envíanos tu dirección y te cotizamos.',
      cost: CONFIG.DELIVERY_BASE_FEE, // Fallback al costo base
      available: true,
      fallback: true
    };
  }
}

/**
 * Geocodifica una dirección de texto a coordenadas (versión simplificada sin APIs)
 * Usa heurísticas y zonas conocidas de Lima
 * @param {string} address - Dirección en texto
 * @returns {Object} { lat, lon, confidence, zone }
 */
export function geocodeAddressSimple(address) {
  try {
    if (!address || typeof address !== 'string') {
      throw new ValidationError('INVALID_ADDRESS', 'Dirección inválida');
    }
    
    const addressLower = address.toLowerCase();
    
    // Zonas conocidas de Lima con coordenadas aproximadas
    const knownZones = {
      'miraflores': { lat: -12.1198, lon: -77.0350, zone: 'miraflores' },
      'san isidro': { lat: -12.0964, lon: -77.0364, zone: 'san_isidro' },
      'surco': { lat: -12.1391, lon: -76.9936, zone: 'surco' },
      'la molina': { lat: -12.0792, lon: -76.9428, zone: 'la_molina' },
      'san borja': { lat: -12.0928, lon: -77.0011, zone: 'san_borja' },
      'barranco': { lat: -12.1465, lon: -77.0209, zone: 'barranco' },
      'chorrillos': { lat: -12.1718, lon: -77.0123, zone: 'chorrillos' },
      'san miguel': { lat: -12.0814, lon: -77.0875, zone: 'san_miguel' },
      'pueblo libre': { lat: -12.0780, lon: -77.0654, zone: 'pueblo_libre' },
      'jesus maria': { lat: -12.0729, lon: -77.0429, zone: 'jesus_maria' },
      'lince': { lat: -12.0820, lon: -77.0326, zone: 'lince' },
      'magdalena': { lat: -12.0908, lon: -77.0748, zone: 'magdalena' },
      'cercado': { lat: -12.0464, lon: -77.0428, zone: 'cercado' },
      'rimac': { lat: -12.0247, lon: -77.0374, zone: 'rimac' },
      'breña': { lat: -12.0587, lon: -77.0505, zone: 'brena' }
    };
    
    // Buscar zona conocida en la dirección
    for (const [zoneName, coords] of Object.entries(knownZones)) {
      if (addressLower.includes(zoneName)) {
        logger.info('ZONE_MATCHED', { zone: zoneName, address });
        
        return {
          lat: coords.lat,
          lon: coords.lon,
          confidence: 0.7,
          zone: coords.zone,
          method: 'zone_matching',
          message: `Ubicación aproximada en ${zoneName}`
        };
      }
    }
    
    // Si no se encuentra zona, usar ubicación de la tienda con offset random pequeño
    logger.warn('ZONE_NOT_FOUND', { address });
    
    // Agregar random offset para simular diferentes ubicaciones en Lima
    const offsetLat = (Math.random() - 0.5) * 0.05; // ±2.5km aprox
    const offsetLon = (Math.random() - 0.5) * 0.05;
    
    return {
      lat: CONFIG.STORE_LAT + offsetLat,
      lon: CONFIG.STORE_LON + offsetLon,
      confidence: 0.3,
      zone: 'desconocida',
      method: 'fallback',
      message: 'Ubicación aproximada. Por favor comparte tu ubicación exacta para mejor precisión.'
    };
    
  } catch (error) {
    logger.error('GEOCODE_ERROR', error);
    
    // Fallback ultra seguro
    return {
      lat: CONFIG.STORE_LAT,
      lon: CONFIG.STORE_LON,
      confidence: 0.1,
      zone: 'desconocida',
      method: 'store_location',
      error: error.message
    };
  }
}

/**
 * Valida horario de delivery
 * @returns {Object} { available, message, currentTime, opensAt, closesAt }
 */
export function validateDeliveryHours() {
  try {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    const [openHour, openMin] = CONFIG.DELIVERY_HOURS_START.split(':').map(Number);
    const [closeHour, closeMin] = CONFIG.DELIVERY_HOURS_END.split(':').map(Number);
    
    const currentMinutes = hours * 60 + minutes;
    const openMinutes = openHour * 60 + openMin;
    const closeMinutes = closeHour * 60 + closeMin;
    
    const isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
    
    const result = {
      available: isOpen,
      currentTime,
      opensAt: CONFIG.DELIVERY_HOURS_START,
      closesAt: CONFIG.DELIVERY_HOURS_END,
      message: isOpen 
        ? '¡Estamos abiertos para delivery!'
        : `Horario de delivery: ${CONFIG.DELIVERY_HOURS_START} - ${CONFIG.DELIVERY_HOURS_END}`
    };
    
    logger.debug('DELIVERY_HOURS_VALIDATED', result);
    
    return result;
    
  } catch (error) {
    logger.error('VALIDATE_HOURS_ERROR', error);
    
    // En caso de error, asumir que está abierto
    return {
      available: true,
      message: 'Consultar horarios de entrega',
      error: error.message
    };
  }
}

/**
 * Detecta proximidad del cliente a la tienda
 * Retorna BOOL si debe escalarse a agente
 */
export function isCustomerVeryClose(clientLat, clientLon) {
  try {
    if (!clientLat || !clientLon) return false;

    const distance = calculateDistance(
      clientLat, 
      clientLon,
      parseFloat(CONFIG.STORE_LAT || '-12.046374'),
      parseFloat(CONFIG.STORE_LON || '-77.042793')
    );

    return {
      distance,
      veryClose: distance < PROXIMITY_THRESHOLDS.VERY_CLOSE,
      close: distance < PROXIMITY_THRESHOLDS.CLOSE,
      nearby: distance < PROXIMITY_THRESHOLDS.NEARBY,
      shouldEscalate: distance < PROXIMITY_THRESHOLDS.VERY_CLOSE, // Menos de 300m
      message: distance < 0.3 ? 'Cliente muy cercano, posiblemente en la tienda' :
               distance < 0.5 ? 'Cliente en zona peatonal cercana' :
               distance < 1.0 ? 'Cliente en el mismo barrio' : 'Cliente en área cercana'
    };
  } catch (error) {
    logger.error('PROXIMITY_DETECTION_ERROR', error);
    return {
      distance: null,
      veryClose: false,
      close: false,
      nearby: false,
      shouldEscalate: false,
      error: error.message
    };
  }
}

/**
 * Calcula zona de proximidad del cliente
 */
export function getProximityZone(clientLat, clientLon) {
  try {
    const distance = calculateDistance(
      clientLat,
      clientLon,
      parseFloat(CONFIG.STORE_LAT || '-12.046374'),
      parseFloat(CONFIG.STORE_LON || '-77.042793')
    );

    let zone = 'LEJANO';
    let urgency = 'normal';
    let recommendation = 'delivery normal';

    if (distance < 0.3) {
      zone = 'EN_TIENDA';
      urgency = 'inmediato';
      recommendation = 'Cliente puede pasar a recoger o asistencia en tienda';
    } else if (distance < 0.5) {
      zone = 'MUY_CERCANO';
      urgency = 'urgente';
      recommendation = 'Considerar entrega en mano rápida';
    } else if (distance < 1.0) {
      zone = 'CERCANO';
      urgency = 'normal';
      recommendation = 'Delivery rápido (10-15 min)';
    } else if (distance < 3.0) {
      zone = 'MEDIO';
      urgency = 'normal';
      recommendation = 'Delivery normal (20-30 min)';
    } else if (distance < 6.0) {
      zone = 'LEJANO';
      urgency = 'normal';
      recommendation = 'Delivery estándar (30-45 min)';
    } else {
      zone = 'MUY_LEJANO';
      urgency = 'lento';
      recommendation = 'Delivery extendido (45+ min)';
    }

    return {
      zone,
      distance: parseFloat(distance.toFixed(2)),
      urgency,
      recommendation,
      shouldAskForConfirmation: distance < 0.3
    };
  } catch (error) {
    logger.error('PROXIMITY_ZONE_ERROR', error);
    return {
      zone: 'DESCONOCIDO',
      distance: null,
      urgency: 'normal',
      recommendation: 'Confirmar ubicación',
      error: error.message
    };
  }
}

export default {
  calculateDistance,
  calculateDeliveryCost,
  calculateDeliveryFromLocation,
  extractCoordinates,
  geocodeAddressSimple,
  validateDeliveryHours,
  isCustomerVeryClose,
  getProximityZone
};
