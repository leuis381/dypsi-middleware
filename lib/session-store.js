/**
 * lib/session-store.js
 *
 * Manejo de sesiones de usuario en Firestore
 * - getSession(phone) - Obtener sesión del usuario
 * - saveSession(phone, data) - Guardar datos de sesión
 * - saveAddressForPhone(phone, address) - Guardar dirección
 * - saveOrderDraft(phone, parsedOrder) - Guardar borrador de orden
 * - deleteSession(phone) - Eliminar sesión
 */

import admin from 'firebase-admin';
import { logger, ValidationError, AppError, MetricsCollector, validatePhone as utilValidatePhone, sanitizeInput } from './utils.js';

const db = admin.apps.length ? admin.firestore() : null;
const SESSIONS_COLLECTION = 'sessions';
const SESSION_TTL_HOURS = 24;

const metrics = new MetricsCollector();

/**
 * Valida que la base de datos esté inicializada
 * @throws {AppError} Si Firestore no está inicializado
 * @private
 */
function validateDb() {
  if (!db) {
    logger.error('FIRESTORE_NOT_INITIALIZED', {});
    metrics.record('session.db_not_initialized', 1);
    throw new AppError('Firestore no está inicializado', 500, 'FIRESTORE_NOT_INITIALIZED');
  }
}

/**
 * Valida un número de teléfono
 * @param {string} phone - Número de teléfono
 * @returns {string} Teléfono normalizado
 * @throws {ValidationError} Si el teléfono es inválido
 * @private
 */
function validatePhone(phone) {
  if (!phone) {
    throw new ValidationError('El teléfono es requerido');
  }

  const phoneStr = sanitizeInput(String(phone), 20);
  if (phoneStr.length < 7 || phoneStr.length > 15) {
    throw new ValidationError('El teléfono debe tener entre 7 y 15 caracteres');
  }

  return phoneStr;
}

/**
 * Obtiene la sesión actual de un usuario
 * @param {string} phone - Número de teléfono del usuario
 * @returns {Object} Datos de la sesión
 * @throws {ValidationError} Si el teléfono es inválido
 * @throws {AppError} Si falla la consulta a Firestore
 */
export async function getSession(phone) {
  const startTime = Date.now();
  metrics.record('session.get.call', 1);
  
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    logger.debug('SESSION_GET_START', { phone: phoneStr });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    const snap = await ref.get();

    if (!snap.exists) {
      logger.debug('SESSION_NOT_FOUND_CREATING', { phone: phoneStr });
      const initial = {
        estado: 'inicio',
        pedido: null,
        address: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await ref.set(initial);
      const duration = Date.now() - startTime;
      logger.info('SESSION_CREATED', { phone: phoneStr, duration_ms: duration });
      metrics.record('session.get.created', 1);
      metrics.record('session.get.duration_ms', duration);
      return initial;
    }

    const duration = Date.now() - startTime;
    logger.debug('SESSION_RETRIEVED', { phone: phoneStr, estado: snap.data().estado, duration_ms: duration });
    metrics.record('session.get.success', 1);
    metrics.record('session.get.duration_ms', duration);
    return snap.data();

  } catch (error) {
    metrics.record('session.get.error', 1);
    if (error instanceof ValidationError) throw error;
    logger.error('SESSION_GET_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('Error al obtener sesión', 500, 'SESSION_GET_FAILED');
  }
}

/**
 * Guarda datos en la sesión de un usuario
 * @param {string} phone - Número de teléfono
 * @param {Object} data - Datos a guardar
 * @returns {boolean} true si se guardó exitosamente
 * @throws {ValidationError} Si el teléfono o datos son inválidos
 * @throws {AppError} Si falla la operación en Firestore
 */
export async function saveSession(phone, data) {
  const startTime = Date.now();
  metrics.record('session.save.call', 1);
  
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    if (!data || typeof data !== 'object') {
      throw new ValidationError('Los datos deben ser un objeto válido');
    }

    logger.debug('SESSION_SAVE_START', { phone: phoneStr, keys: Object.keys(data) });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    await ref.set({
      ...data,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    const duration = Date.now() - startTime;
    logger.info('SESSION_SAVED', { phone: phoneStr, duration_ms: duration });
    metrics.record('session.save.success', 1);
    metrics.record('session.save.duration_ms', duration);
    return true;

  } catch (error) {
    metrics.record('session.save.error', 1);
    if (error instanceof ValidationError) throw error;
    logger.error('SESSION_SAVE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('Error al guardar sesión', 500, 'SESSION_SAVE_FAILED');
  }
}

/**
 * Guarda la dirección de entrega del usuario
 * @param {string} phone - Número de teléfono
 * @param {string} address - Dirección completa
 * @param {Object} components - Componentes de la dirección (opcional)
 * @returns {Object} Datos guardados
 * @throws {ValidationError} Si los parámetros son inválidos
 * @throws {AppError} Si falla la operación en Firestore
 */
export async function saveAddressForPhone(phone, address, components = {}) {
  const startTime = Date.now();
  metrics.record('session.save_address.call', 1);
  
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    if (!address || typeof address !== 'string') {
      throw new ValidationError('La dirección es requerida y debe ser un string');
    }

    logger.debug('ADDRESS_SAVE_START', { phone: phoneStr, addressLength: address.length });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    const payload = {
      address: { address, components },
      estado: 'address_received',
      updatedAt: new Date().toISOString()
    };

    await ref.set(payload, { merge: true });

    const duration = Date.now() - startTime;
    logger.info('ADDRESS_SAVED', { phone: phoneStr, duration_ms: duration });
    metrics.record('session.save_address.success', 1);
    metrics.record('session.save_address.duration_ms', duration);
    return payload;

  } catch (error) {
    metrics.record('session.save_address.error', 1);
    if (error instanceof ValidationError) throw error;
    logger.error('ADDRESS_SAVE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('Error al guardar dirección', 500, 'ADDRESS_SAVE_FAILED');
  }
}

/**
 * Guarda un borrador de orden en la sesión
 * @param {string} phone - Número de teléfono
 * @param {Object} parsedOrder - Orden parseada
 * @returns {Object} Datos guardados
 * @throws {ValidationError} Si los parámetros son inválidos
 * @throws {AppError} Si falla la operación en Firestore
 */
export async function saveOrderDraft(phone, parsedOrder) {
  const startTime = Date.now();
  metrics.record('session.save_order.call', 1);
  
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    if (!parsedOrder || typeof parsedOrder !== 'object') {
      throw new ValidationError('La orden es requerida y debe ser un objeto');
    }

    logger.debug('ORDER_DRAFT_SAVE_START', { phone: phoneStr, orderItems: parsedOrder.items?.length || 0 });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    const payload = {
      pedido: parsedOrder,
      estado: 'pedido',
      updatedAt: new Date().toISOString()
    };

    await ref.set(payload, { merge: true });

    const duration = Date.now() - startTime;
    logger.info('ORDER_DRAFT_SAVED', { phone: phoneStr, duration_ms: duration });
    metrics.record('session.save_order.success', 1);
    metrics.record('session.save_order.duration_ms', duration);
    return payload;

  } catch (error) {
    metrics.record('session.save_order.error', 1);
    if (error instanceof ValidationError) throw error;
    logger.error('ORDER_DRAFT_SAVE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('Error al guardar borrador de orden', 500, 'ORDER_DRAFT_SAVE_FAILED');
  }
}

/**
 * Elimina una sesión de usuario
 * @param {string} phone - Número de teléfono
 * @returns {boolean} true si se eliminó exitosamente
 * @throws {ValidationError} Si el teléfono es inválido
 * @throws {AppError} Si falla la operación en Firestore
 */
export async function deleteSession(phone) {
  const startTime = Date.now();
  metrics.record('session.delete.call', 1);
  
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    logger.debug('SESSION_DELETE_START', { phone: phoneStr });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    await ref.delete();

    const duration = Date.now() - startTime;
    logger.info('SESSION_DELETED', { phone: phoneStr, duration_ms: duration });
    metrics.record('session.delete.success', 1);
    metrics.record('session.delete.duration_ms', duration);
    return true;

  } catch (error) {
    metrics.record('session.delete.error', 1);
    if (error instanceof ValidationError) throw error;
    logger.error('SESSION_DELETE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('Error al eliminar sesión', 500, 'SESSION_DELETE_FAILED');
  }
}

export default {
  getSession,
  saveSession,
  saveAddressForPhone,
  saveOrderDraft,
  deleteSession
};
