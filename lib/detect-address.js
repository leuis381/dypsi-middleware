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

import { logger, ValidationError } from './utils.js';

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
    logger.warn('INVALID_COORDINATES', { lat, lon });
    return null;
  }

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
  if (!rawText || typeof rawText !== 'string') {
    logger.warn('ADDRESS_INVALID_INPUT', { type: typeof rawText });
    return { isAddress: false, address: null, components: {} };
  }

  const raw = rawText.toString().trim();
  const text = normalizeText(raw);

  logger.debug('ADDRESS_DETECTION_START', { textLength: text.length });

  // Detectar coordenadas
  const coords = extractCoordinates(raw);
  if (coords) {
    logger.info('ADDRESS_COORDINATES_DETECTED', coords);
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
  if (!address || typeof address !== 'string') {
    throw new ValidationError('ADDRESS_REQUIRED', 'La dirección debe ser un string válido');
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

  logger.debug('ADDRESS_NORMALIZED', { original: address, normalized });

  return normalized;
}

/**
 * Extrae y devuelve todos los componentes de una dirección
 * @param {string} rawText - Texto crudo a analizar
 * @returns {Object} Objeto con todos los componentes extraídos
 */
export function extractAddressComponents(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new ValidationError('TEXT_REQUIRED', 'El texto es requerido');
  }

  logger.debug('COMPONENTS_EXTRACTION_START', { textLength: rawText.length });

  const result = isAddress(rawText);

  if (!result.isAddress) {
    logger.warn('NO_ADDRESS_COMPONENTS_FOUND', { textLength: rawText.length });
    return { street: null, number: null, reference: null, district: null, lat: null, lon: null };
  }

  return result.components;
}

export default {
  isAddress,
  normalizeAddress,
  extractAddressComponents
};
