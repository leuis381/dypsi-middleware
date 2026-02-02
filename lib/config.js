/**
 * lib/config.js
 * 
 * Configuración centralizada del proyecto
 * Variables de ambiente, constantes y ajustes
 */

import { logger, ValidationError, AppError } from './utils.js';

export const CONFIG = {
  // Node environment
  ENV: process.env.NODE_ENV || 'development',
  DEBUG: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',
  
  // Server
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  
  // Firebase
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  
  // Google Cloud
  GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  
  // WhatsApp
  WHATSAPP_BUSINESS_ID: process.env.WHATSAPP_BUSINESS_ID,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION || 'v18.0',
  
  // Store Location
  STORE_LAT: parseFloat(process.env.STORE_LAT || '-12.068'),
  STORE_LON: parseFloat(process.env.STORE_LON || '-77.036'),
  STORE_NAME: process.env.STORE_NAME || 'Dypsi Pizzería',
  STORE_PHONE: process.env.STORE_PHONE || '+51999999999',
  
  // Delivery
  DELIVERY_BASE_FEE: parseFloat(process.env.DELIVERY_BASE_FEE || '3.5'),
  DELIVERY_PER_KM: parseFloat(process.env.DELIVERY_PER_KM || '1.2'),
  DELIVERY_HOURS_START: process.env.DELIVERY_HOURS_START || '11:00',
  DELIVERY_HOURS_END: process.env.DELIVERY_HOURS_END || '23:00',
  DELIVERY_TIME_ESTIMATE_MINS: parseInt(process.env.DELIVERY_TIME_ESTIMATE_MINS || '30', 10),
  
  // Pricing
  TAX_RATE: parseFloat(process.env.TAX_RATE || '0.18'),
  PAYMENT_TOLERANCE: parseFloat(process.env.PAYMENT_TOLERANCE || '0.06'), // 6% tolerance
  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || 'PEN',
  
  // AI/ML
  AI_INTENTION_THRESHOLD: parseFloat(process.env.AI_INTENTION_THRESHOLD || '0.6'),
  AI_CONTEXT_MEMORY_SIZE: parseInt(process.env.AI_CONTEXT_MEMORY_SIZE || '10', 10),
  AI_VIP_THRESHOLD_ORDERS: parseInt(process.env.AI_VIP_THRESHOLD_ORDERS || '10', 10),
  AI_VIP_THRESHOLD_SPENT: parseFloat(process.env.AI_VIP_THRESHOLD_SPENT || '500'),
  
  // OCR
  OCR_CONFIDENCE_MINIMUM: parseFloat(process.env.OCR_CONFIDENCE_MINIMUM || '0.7'),
  OCR_LANGUAGES: (process.env.OCR_LANGUAGES || 'es,en').split(','),
  OCR_TIMEOUT_MS: parseInt(process.env.OCR_TIMEOUT_MS || '30000', 10),
  
  // API Integration
  AGENT_WEBHOOK: process.env.AGENT_WEBHOOK,
  KOMMO_API_KEY: process.env.KOMMO_API_KEY,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  
  // Rates & Limits
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  API_TIMEOUT_MS: parseInt(process.env.API_TIMEOUT_MS || '10000', 10),
  
  // Cache
  CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS || '300000', 10), // 5 min
  CACHE_MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
  
  // Session
  SESSION_TTL_MS: parseInt(process.env.SESSION_TTL_MS || '86400000', 10), // 24h
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_FORMAT: process.env.LOG_FORMAT || 'json',
  
  // Feature Flags
  FEATURE_AI_ENGINE: process.env.FEATURE_AI_ENGINE !== 'false',
  FEATURE_SMART_OCR: process.env.FEATURE_SMART_OCR !== 'false',
  FEATURE_USER_PROFILES: process.env.FEATURE_USER_PROFILES !== 'false',
  FEATURE_WHATSAPP_CATALOG: process.env.FEATURE_WHATSAPP_CATALOG !== 'false',
  FEATURE_RECOMMENDATIONS: process.env.FEATURE_RECOMMENDATIONS !== 'false',
  FEATURE_VIP_DETECTION: process.env.FEATURE_VIP_DETECTION !== 'false',
  
  // Security
  ENABLE_HTTPS: process.env.ENABLE_HTTPS === 'true',
  ENABLE_CORS: process.env.ENABLE_CORS !== 'false',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  
  // File Paths
  MENU_DATA_PATH: process.env.MENU_DATA_PATH || './data/menu.json',
  SYNONYMS_DATA_PATH: process.env.SYNONYMS_DATA_PATH || './data/sinonimos.json',
  RULES_DATA_PATH: process.env.RULES_DATA_PATH || './data/reglas.json',
  RESPONSES_DATA_PATH: process.env.RESPONSES_DATA_PATH || './data/respuestas.json',
  ZONES_DATA_PATH: process.env.ZONES_DATA_PATH || './data/zonas-precio.json',
};

/**
 * Valida que un valor numérico esté en un rango específico
 * @param {string} name - Nombre de la configuración
 * @param {number} value - Valor a validar
 * @param {number} min - Valor mínimo permitido
 * @param {number} max - Valor máximo permitido
 * @throws {ValidationError} Si el valor está fuera de rango
 * @private
 */
function validateRange(name, value, min, max) {
  if (typeof value !== 'number' || isNaN(value)) {
    logger.warn('CONFIG_INVALID_NUMBER', { name, value });
    throw new ValidationError(`${name} debe ser un número válido`, { name, value });
  }
  if (value < min || value > max) {
    logger.warn('CONFIG_OUT_OF_RANGE', { name, value, min, max });
    throw new ValidationError(`${name} debe estar entre ${min} y ${max}`, { name, value, min, max });
  }
}

/**
 * Valida configuración crítica del sistema
 * @returns {boolean} true si la configuración es válida
 * @throws {AppError} En producción si faltan variables críticas
 */
export function validateConfig() {
  logger.debug('CONFIG_VALIDATION_START');
  
  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY'
  ];

  const missing = required.filter(key => !CONFIG[key]);
  
  if (missing.length > 0) {
    logger.warn('CONFIG_MISSING_VARS', { missing });
    if (CONFIG.ENV === 'production') {
      throw new AppError(`Missing required environment variables: ${missing.join(', ')}`, 500, 'CONFIG_INCOMPLETE');
    }
  }

  // Validar rangos de valores numéricos
  try {
    validateRange('TAX_RATE', CONFIG.TAX_RATE, 0, 1);
    validateRange('PAYMENT_TOLERANCE', CONFIG.PAYMENT_TOLERANCE, 0, 1);
    validateRange('DELIVERY_BASE_FEE', CONFIG.DELIVERY_BASE_FEE, 0, 100);
    validateRange('DELIVERY_PER_KM', CONFIG.DELIVERY_PER_KM, 0, 50);
    validateRange('AI_INTENTION_THRESHOLD', CONFIG.AI_INTENTION_THRESHOLD, 0, 1);
    validateRange('OCR_CONFIDENCE_MINIMUM', CONFIG.OCR_CONFIDENCE_MINIMUM, 0, 1);
  } catch (error) {
    if (CONFIG.ENV === 'production') {
      throw error;
    }
    logger.warn('CONFIG_VALIDATION_WARNING', { error: error.message });
  }

  logger.info('CONFIG_VALIDATED', { 
    env: CONFIG.ENV, 
    missingCount: missing.length,
    featuresEnabled: {
      ai: CONFIG.FEATURE_AI_ENGINE,
      ocr: CONFIG.FEATURE_SMART_OCR,
      whatsapp: CONFIG.FEATURE_WHATSAPP_CATALOG
    }
  });

  return true;
}

/**
 * Función helper para obtener config con fallback
 * @param {string} key - Clave de configuración
 * @param {any} fallback - Valor por defecto si la clave no existe
 * @returns {any} Valor de configuración o fallback
 */
export function getConfig(key, fallback = null) {
  const value = CONFIG[key];
  if (value === undefined || value === null) {
    logger.debug('CONFIG_USING_FALLBACK', { key, fallback });
    return fallback;
  }
  return value;
}

/**
 * Verifica si una feature flag está habilitada
 * @param {string} featureName - Nombre de la feature (sin prefijo FEATURE_)
 * @returns {boolean} true si la feature está habilitada
 */
export function isFeatureEnabled(featureName) {
  const key = `FEATURE_${featureName.toUpperCase()}`;
  const enabled = CONFIG[key] !== false;
  logger.debug('CONFIG_FEATURE_CHECK', { feature: featureName, enabled });
  return enabled;
}

// Exportar toda la configuración
export default CONFIG;
