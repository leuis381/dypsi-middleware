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
import { logger, ValidationError, AppError } from './utils.js';

const db = admin.apps.length ? admin.firestore() : null;
const SESSIONS_COLLECTION = 'sessions';
const SESSION_TTL_HOURS = 24;

/**
 * Valida que la base de datos esté inicializada
 * @throws {AppError} Si Firestore no está inicializado
 * @private
 */
function validateDb() {
  if (!db) {
    logger.error('FIRESTORE_NOT_INITIALIZED', {});
    throw new AppError('FIRESTORE_NOT_INITIALIZED', 'Firestore no está inicializado');
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
    throw new ValidationError('PHONE_REQUIRED', 'El teléfono es requerido');
  }

  const phoneStr = String(phone).trim();
  if (phoneStr.length < 7 || phoneStr.length > 15) {
    throw new ValidationError('PHONE_INVALID_LENGTH', 'El teléfono debe tener entre 7 y 15 caracteres');
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
      logger.info('SESSION_CREATED', { phone: phoneStr });
      return initial;
    }

    logger.debug('SESSION_RETRIEVED', { phone: phoneStr, estado: snap.data().estado });
    return snap.data();

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('SESSION_GET_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('SESSION_GET_FAILED', 'Error al obtener sesión', { cause: error });
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
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    if (!data || typeof data !== 'object') {
      throw new ValidationError('DATA_INVALID', 'Los datos deben ser un objeto válido');
    }

    logger.debug('SESSION_SAVE_START', { phone: phoneStr, keys: Object.keys(data) });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    await ref.set({
      ...data,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    logger.info('SESSION_SAVED', { phone: phoneStr });
    return true;

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('SESSION_SAVE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('SESSION_SAVE_FAILED', 'Error al guardar sesión', { cause: error });
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
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    if (!address || typeof address !== 'string') {
      throw new ValidationError('ADDRESS_REQUIRED', 'La dirección es requerida y debe ser un string');
    }

    logger.debug('ADDRESS_SAVE_START', { phone: phoneStr, addressLength: address.length });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    const payload = {
      address: { address, components },
      estado: 'address_received',
      updatedAt: new Date().toISOString()
    };

    await ref.set(payload, { merge: true });

    logger.info('ADDRESS_SAVED', { phone: phoneStr });
    return payload;

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('ADDRESS_SAVE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('ADDRESS_SAVE_FAILED', 'Error al guardar dirección', { cause: error });
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
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    if (!parsedOrder || typeof parsedOrder !== 'object') {
      throw new ValidationError('ORDER_REQUIRED', 'La orden es requerida y debe ser un objeto');
    }

    logger.debug('ORDER_DRAFT_SAVE_START', { phone: phoneStr, orderItems: parsedOrder.items?.length || 0 });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    const payload = {
      pedido: parsedOrder,
      estado: 'pedido',
      updatedAt: new Date().toISOString()
    };

    await ref.set(payload, { merge: true });

    logger.info('ORDER_DRAFT_SAVED', { phone: phoneStr });
    return payload;

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('ORDER_DRAFT_SAVE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('ORDER_DRAFT_SAVE_FAILED', 'Error al guardar borrador de orden', { cause: error });
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
  try {
    validateDb();
    const phoneStr = validatePhone(phone);

    logger.debug('SESSION_DELETE_START', { phone: phoneStr });

    const ref = db.collection(SESSIONS_COLLECTION).doc(phoneStr);
    await ref.delete();

    logger.info('SESSION_DELETED', { phone: phoneStr });
    return true;

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('SESSION_DELETE_FAILED', { phone: String(phone), error: error.message });
    throw new AppError('SESSION_DELETE_FAILED', 'Error al eliminar sesión', { cause: error });
  }
}

export default {
  getSession,
  saveSession,
  saveAddressForPhone,
  saveOrderDraft,
  deleteSession
};
