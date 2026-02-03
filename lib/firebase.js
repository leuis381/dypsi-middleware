import admin from 'firebase-admin';
import { logger, AppError, MetricsCollector } from './utils.js';
import CONFIG from './config.js';

const metrics = new MetricsCollector();

/**
 * Obtiene y valida la clave privada de Firebase
 * @returns {string} Clave privada validada
 * @throws {AppError} Si la clave privada es inválida o no está configurada
 * @private
 */
function getPrivateKey() {
  let key = process.env.FIREBASE_PRIVATE_KEY;

  if (!key) {
    logger.error('FIREBASE_CONFIG_ERROR', { missing: 'FIREBASE_PRIVATE_KEY' });
    metrics.record('firebase.config_error', 1);
    throw new AppError(
      'FIREBASE_PRIVATE_KEY no está definida en las variables de entorno',
      500,
      'FIREBASE_CONFIG_ERROR'
    );
  }

  key = key.trim();

  // Normalizar saltos de línea para aceptar cualquier formato
  // - Saltos reales (\n / \r\n)
  // - Escapados (\\n)
  // - Mixtos
  key = key.replace(/\r\n/g, '\n');
  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }

  if (!key.startsWith('-----BEGIN PRIVATE KEY-----')) {
    logger.error('FIREBASE_INVALID_KEY_FORMAT', { issue: 'missing_begin' });
    metrics.record('firebase.invalid_key_format', 1);
    throw new AppError(
      'La clave privada no tiene el encabezado correcto',
      500,
      'FIREBASE_INVALID_KEY_FORMAT'
    );
  }

  if (!key.endsWith('-----END PRIVATE KEY-----')) {
    logger.error('FIREBASE_INVALID_KEY_FORMAT', { issue: 'missing_end' });
    metrics.record('firebase.invalid_key_format', 1);
    throw new AppError(
      'La clave privada no tiene el pie correcto',
      500,
      'FIREBASE_INVALID_KEY_FORMAT'
    );
  }

  return key;
}

/**
 * Inicializa Firebase Admin SDK
 * @private
 */
function initializeFirebase() {
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    logger.error('FIREBASE_MISSING_CONFIG', { missing });
    metrics.record('firebase.missing_config', 1);
    throw new AppError(
      `Configuración incompleta de Firebase: ${missing.join(', ')}`,
      500,
      'FIREBASE_CONFIG_INCOMPLETE'
    );
  }

  if (admin.apps.length === 0) {
    try {
      const startTime = Date.now();
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: CONFIG.FIREBASE_PROJECT_ID,
          clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
          privateKey: getPrivateKey(),
        }),
      });
      const duration = Date.now() - startTime;
      logger.info('FIREBASE_INITIALIZED', { projectId: CONFIG.FIREBASE_PROJECT_ID, duration_ms: duration });
      metrics.record('firebase.initialized', 1);
      metrics.record('firebase.init_duration_ms', duration);
    } catch (error) {
      logger.error('FIREBASE_INIT_FAILED', { error: error.message });
      metrics.record('firebase.init_failed', 1);
      throw new AppError(
        'No se pudo inicializar Firebase Admin SDK',
        500,
        'FIREBASE_INITIALIZATION_FAILED'
      );
    }
  }
}

if (!admin.apps.length) {
  try {
    initializeFirebase();
  } catch (error) {
    logger.fatal('FIREBASE_STARTUP_FAILED', { error: error.message });
    process.exit(1);
  }
}

const db = admin.firestore();

db.settings({
  ignoreUndefinedProperties: true,
});

logger.debug('FIREBASE_DB_READY', { hasDb: !!db });

export default db;
export { admin };
