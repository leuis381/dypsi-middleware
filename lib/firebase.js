import admin from 'firebase-admin';
import { logger, AppError } from './utils.js';
import CONFIG from './config.js';

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
    throw new AppError(
      'FIREBASE_CONFIG_ERROR',
      'FIREBASE_PRIVATE_KEY no está definida en las variables de entorno'
    );
  }

  key = key.trim();

  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }

  if (!key.startsWith('-----BEGIN PRIVATE KEY-----')) {
    logger.error('FIREBASE_INVALID_KEY_FORMAT', { issue: 'missing_begin' });
    throw new AppError(
      'FIREBASE_INVALID_KEY_FORMAT',
      'La clave privada no tiene el encabezado correcto'
    );
  }

  if (!key.endsWith('-----END PRIVATE KEY-----')) {
    logger.error('FIREBASE_INVALID_KEY_FORMAT', { issue: 'missing_end' });
    throw new AppError(
      'FIREBASE_INVALID_KEY_FORMAT',
      'La clave privada no tiene el pie correcto'
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
    throw new AppError(
      'FIREBASE_CONFIG_INCOMPLETE',
      `Configuración incompleta de Firebase: ${missing.join(', ')}`
    );
  }

  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: CONFIG.FIREBASE_PROJECT_ID,
          clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
          privateKey: getPrivateKey(),
        }),
      });
      logger.info('FIREBASE_INITIALIZED', { projectId: CONFIG.FIREBASE_PROJECT_ID });
    } catch (error) {
      logger.error('FIREBASE_INIT_FAILED', { error: error.message });
      throw new AppError(
        'FIREBASE_INITIALIZATION_FAILED',
        'No se pudo inicializar Firebase Admin SDK',
        { cause: error }
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
