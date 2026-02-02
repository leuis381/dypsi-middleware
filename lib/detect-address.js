/**
 * lib/detect-address.js
 *
 * Detector de direcciones robusto para Perú
 * - Detecta calles, números, referencias y distritos
 * - Normaliza texto
 * - Extrae coordenadas GPS
 * - isAddress(rawText) - Detecta si es una dirección
 * - normalizeAddress(address) - Normaliza una dirección
 * - extractAddressComponents(rawText) - Extrae componentes de dirección
 */

import { logger, ValidationError, MetricsCollector, sanitizeInput } from './utils.js';

const metrics = new MetricsCollector();

// Lista actualizada de distritos de Lima
const DISTRICTS = [
  'miraflores', 'jesus maria', 'san isidro', 'surco', 'san borja', 'lince', 'magdalena',
  'barranco', 'san miguel', 'rimac', 'callao', 'los olivos', 'san juan de lurigancho',
  'santiago de surco', 'san martin de porres', 'ate', 'independencia', 'puente piedra',
  'chorrillos', 'villa maria del triunfo', 'carabayllo', 'comas', 'san juan de miraflores',
  'villa el salvador', 'lurgancho', 'chaclacayo', 'ancón', 'santa rosa', 'punta hermosa'
];

/**
 * Normaliza texto removiendo acentos y caracteres especiales
 * @param {string} s - Texto a normalizar
 * @returns {string} Texto normalizado
 * @private
 */
function normalizeText(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\.,#\-º°]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extrae coordenadas geográficas del texto
 * @param {string} rawText - Texto a procesar
 * @returns {Object|null} { lat, lon } o null si no encuentra
 * @private
 */
function extractCoordinates(rawText) {
  if (!rawText) return null;
  
  // Patron: -12.345, -77.123 o -12.345 -77.123
  const coordMatch = rawText.match(/(-?\d{1,3}\.\d{2,})[,;\s]+(-?\d{1,3}\.\d{2,})/);
  if (!coordMatch) return null;

  const lat = parseFloat(coordMatch[1]);
  const lon = parseFloat(coordMatch[2]);

  // Validar que sean coordenadas válidas para Perú aprox.
  if (lat < -20 || lat > 0 || lon < -82 || lon > -68) {
    logger.warn('ADDRESS_INVALID_COORDINATES', { lat, lon });
    metrics.record('address.invalid_coordinates', 1);
    return null;
  }

  metrics.record('address.coordinates_extracted', 1);
  return { lat, lon };
}

/**
 * Extrae la calle del texto
 * @param {string} text - Texto normalizado
 * @returns {string|null} Nombre de la calle o null
 * @private
 */
function extractStreet(text) {
  // Patrones para calles: Av, Jr, Calle, Psje, Mz, Lt, etc
  const streetRegex = /\b(av|av\.|avenida|jiron|jr|jr\.|jirón|calle|psje|pasaje|psje\.|pje|pje\.|manzana|mz|lote|lt)\b\s*\.?\s*([a-z0-9\s\-º°#]+?)(?:,|\b|#|\d{1,4}|\s(?:nro|n°|numero|num|#))/i;
  const match = text.match(streetRegex);
  
  if (!match) return null;
  
  return match[0].trim();
}

/**
 * Extrae el número de la dirección
 * @param {string} text - Texto normalizado
 * @returns {string|null} Número de dirección o null
 * @private
 */
function extractNumber(text) {
  // Buscar patrones: nro, n°, número, num, # o simplemente números
  const numberRegex = /\b(?:nro|n°|numero|num|#)\s*[:\-]?\s*(\d{1,6})\b/i;
  let match = text.match(numberRegex);
  
  if (match) return match[1];

  // Buscar secuencias de números de 1-4 dígitos
  match = text.match(/\b(\d{1,4})\b/);
  
  return match ? match[1] : null;
}

/**
 * Detecta el distrito en el texto
 * @param {string} text - Texto normalizado
 * @returns {string|null} Nombre del distrito o null
 * @private
 */
function detectDistrict(text) {
  const foundDistrict = DISTRICTS.find(district => text.includes(district));
  return foundDistrict || null;
}

/**
 * Extrae referencias de ubicación (frente a, cerca de, etc)
 * @param {string} rawText - Texto original sin normalizar
 * @returns {string|null} Referencia o null
 * @private
 */
function extractReference(rawText) {
  if (!rawText) return null;

  const refRegex = /\b(cerca de|frente a|altura de|altura|esq|esquina de|detras de|detrás de|junto a|al lado de)\s+([a-z0-9\s\-\.,#]+)/i;
  const match = rawText.match(refRegex);
  
  return match ? match[0].trim() : null;
}

/**
 * Detecta si un texto es una dirección
 * @param {string} rawText - Texto a analizar
 * @returns {Object} { isAddress, address, components }
 * @throws {ValidationError} Si rawText no es válido
 */
export function isAddress(rawText) {
  metrics.record('address.is_address.call', 1);
  
  if (!rawText || typeof rawText !== 'string') {
    logger.warn('ADDRESS_INVALID_INPUT', { type: typeof rawText });
    metrics.record('address.is_address.invalid_input', 1);
    return { isAddress: false, address: null, components: {} };
  }

  const raw = sanitizeInput(rawText, 500);
  if (!raw) {
    logger.warn('ADDRESS_EMPTY_AFTER_SANITIZE');
    return { isAddress: false, address: null, components: {} };
  }
  
  const text = normalizeText(raw);

  logger.debug('ADDRESS_DETECTION_START', { textLength: text.length });

  // Detectar coordenadas
  const coords = extractCoordinates(raw);
  if (coords) {
    logger.info('ADDRESS_COORDINATES_DETECTED', coords);
    metrics.record('address.coordinates_detected', 1);
    return {
      isAddress: true,
      address: `Coordenadas ${coords.lat}, ${coords.lon}`,
      components: { street: null, number: null, reference: null, district: null, ...coords, raw }
    };
  }

  // Extraer componentes
  const street = extractStreet(text);
  const number = extractNumber(text);
  const district = detectDistrict(text);
  const reference = extractReference(raw);

  // Determinar si es probable que sea dirección
  const isLikelyAddress = !!(street || district || (number && raw.length > 10));

  if (!isLikelyAddress) {
    logger.debug('ADDRESS_NOT_DETECTED', { hasStreet: !!street, hasDistrict: !!district, hasNumber: !!number });
    metrics.record('address.not_detected', 1);
    return { isAddress: false, address: null, components: {} };
  }

  // Construir dirección normalizada
  const addressParts = [];
  if (street) addressParts.push(street);
  if (number) addressParts.push(`Nro. ${number}`);
  if (district) addressParts.push(district);
  if (reference) addressParts.push(`(${reference})`);

  const address = addressParts.join(', ') || text;

  logger.info('ADDRESS_DETECTED', { address, hasStreet: !!street, hasNumber: !!number, hasDistrict: !!district });
  metrics.record('address.detected', 1);
  if (street) metrics.record('address.component.street', 1);
  if (number) metrics.record('address.component.number', 1);
  if (district) metrics.record('address.component.district', 1);
  if (reference) metrics.record('address.component.reference', 1);

  return {
    isAddress: true,
    address,
    components: { street, number, reference, district, raw }
  };
}

/**
 * Normaliza una dirección conocida
 * @param {string} address - Dirección a normalizar
 * @returns {string} Dirección normalizada
 * @throws {ValidationError} Si address no es válido
 */
export function normalizeAddress(address) {
  metrics.record('address.normalize.call', 1);
  
  if (!address || typeof address !== 'string') {
    logger.warn('ADDRESS_NORMALIZE_INVALID_INPUT', { type: typeof address });
    throw new ValidationError('La dirección debe ser un string válido');
  }

  logger.debug('ADDRESS_NORMALIZE_START', { addressLength: address.length });

  const normalized = address
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/avda\b/gi, 'Av.')
    .replace(/avenida\b/gi, 'Av.')
    .replace(/jr\.\b/gi, 'Jr.')
    .replace(/jiron\b/gi, 'Jr.')
    .replace(/calle\b/gi, 'Calle')
    .replace(/psje\b/gi, 'Psje.')
    .replace(/pasaje\b/gi, 'Psje.')
    .replace(/mz\b/gi, 'Mz.')
    .replace(/lt\b/gi, 'Lt.')
    .replace(/nro\b/gi, 'Nro.')
    .replace(/n°\b/gi, 'Nro.')
    .replace(/#\s*/g, 'Nro. ');

  logger.debug('ADDRESS_NORMALIZED', { original: address.substring(0, 50), normalized: normalized.substring(0, 50) });
  metrics.record('address.normalize.success', 1);

  return normalized;
}

/**
 * Extrae y devuelve todos los componentes de una dirección
 * @param {string} rawText - Texto crudo a analizar
 * @returns {Object} Objeto con todos los componentes extraídos
 * @throws {ValidationError} Si el texto no es válido
 */
export function extractAddressComponents(rawText) {
  metrics.record('address.extract_components.call', 1);
  
  if (!rawText || typeof rawText !== 'string') {
    logger.warn('ADDRESS_EXTRACT_INVALID_INPUT', { type: typeof rawText });
    throw new ValidationError('El texto es requerido');
  }

  logger.debug('COMPONENTS_EXTRACTION_START', { textLength: rawText.length });

  const result = isAddress(rawText);

  if (!result.isAddress) {
    logger.warn('NO_ADDRESS_COMPONENTS_FOUND', { textLength: rawText.length });
    metrics.record('address.extract_components.not_found', 1);
    return { street: null, number: null, reference: null, district: null, lat: null, lon: null };
  }

  metrics.record('address.extract_components.success', 1);
  return result.components;
}

export default {
  isAddress,
  normalizeAddress,
  extractAddressComponents
};
