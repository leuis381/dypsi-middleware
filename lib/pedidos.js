/**
 * lib/pedidos.js
 *
 * Manejo de almacenamiento de pedidos en Firebase
 * - guardarPedidoFirebase(pedidoData) - Guarda un pedido en Firestore
 * - obtenerPedidos(filtros) - Obtiene pedidos con filtros
 * - actualizarEstadoPedido(pedidoId, nuevoEstado) - Actualiza estado de pedido
 */

import admin from 'firebase-admin';
import { logger, ValidationError, AppError, asyncHandler, sendSuccess, sendError, MetricsCollector, validatePhone, sanitizeInput } from './utils.js';

const db = admin.firestore();
const PEDIDOS_COLLECTION = 'pedidos';

const metrics = new MetricsCollector();

/**
 * Valida estructura de un pedido
 * @param {Object} pedido - Datos del pedido
 * @throws {ValidationError} Si el pedido es inválido
 * @private
 */
function validarPedido(pedido) {
  if (!pedido || typeof pedido !== 'object') {
    throw new ValidationError('PEDIDO_INVALID', 'El pedido debe ser un objeto válido');
  }

  if (!pedido.telefono_cliente || String(pedido.telefono_cliente).trim().length === 0) {
    throw new ValidationError('PHONE_REQUIRED', 'El teléfono del cliente es requerido');
  }

  if (!pedido.pedido || !Array.isArray(pedido.pedido) || pedido.pedido.length === 0) {
    throw new ValidationError('PEDIDO_ITEMS_REQUIRED', 'El pedido debe contener al menos 1 item');
  }

  // Validar items del pedido
  for (let i = 0; i < pedido.pedido.length; i++) {
    const item = pedido.pedido[i];
    if (!item.precio || isNaN(item.precio) || item.precio < 0) {
      throw new ValidationError('ITEM_PRICE_INVALID', `Item ${i}: precio inválido`);
    }
    if (!item.cantidad || isNaN(item.cantidad) || item.cantidad < 1) {
      throw new ValidationError('ITEM_QUANTITY_INVALID', `Item ${i}: cantidad inválida`);
    }
  }

  if (typeof pedido.total !== 'number' || pedido.total < 0) {
    throw new ValidationError('TOTAL_INVALID', 'El total debe ser un número válido');
  }
}

/**
 * Guarda un pedido en Firestore
 * @param {Object} pedidoData - Datos del pedido
 * @param {string} pedidoData.nombre_cliente - Nombre del cliente
 * @param {string} pedidoData.telefono_cliente - Teléfono del cliente
 * @param {string} pedidoData.direccion - Dirección de entrega
 * @param {string} pedidoData.tipo_entrega - 'delivery' o 'recojo'
 * @param {string} pedidoData.pago - Método de pago
 * @param {Array} pedidoData.pedido - Items del pedido
 * @param {number} pedidoData.total - Total del pedido
 * @returns {Object} { id, pedido: { ...datos guardados } }
 * @throws {ValidationError} Si los datos son inválidos
 * @throws {AppError} Si falla la operación en Firestore
 */
export async function guardarPedidoFirebase({
  nombre_cliente = 'Cliente WhatsApp',
  telefono_cliente = '',
  direccion = '',
  tipo_entrega = 'delivery',
  pago = '',
  pedido = [],
  total = 0
}) {
  const startTime = Date.now();
  metrics.record('pedidos.guardar.call', 1);
  
  try {
    logger.debug('PEDIDO_SAVE_START', { telefono: telefono_cliente, items: pedido.length });

    // Validar datos
    const pedidoData = {
      nombre_cliente: sanitizeInput(String(nombre_cliente), 100) || 'Cliente WhatsApp',
      telefono_cliente: sanitizeInput(String(telefono_cliente), 20),
      direccion: sanitizeInput(String(direccion), 500),
      tipo_entrega,
      pago,
      pedido,
      total: parseFloat(total) || 0
    };

    validarPedido(pedidoData);

    // Calcular total como validación adicional
    const calculatedTotal = pedido.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    if (Math.abs(calculatedTotal - pedidoData.total) > 0.01) {
      logger.warn('PEDIDO_TOTAL_MISMATCH', { expected: calculatedTotal, received: pedidoData.total });
    }

    // Crear documento
    const pedidoDoc = {
      ...pedidoData,
      estado: 'pendiente',
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    const ref = await db.collection(PEDIDOS_COLLECTION).add(pedidoDoc);

    const duration = Date.now() - startTime;
    logger.info('PEDIDO_SAVED', {
      pedidoId: ref.id,
      telefono: telefono_cliente,
      total: pedidoData.total,
      items: pedido.length,
      duration_ms: duration
    });
    metrics.record('pedidos.guardar.success', 1);
    metrics.record('pedidos.guardar.duration_ms', duration);
    metrics.record('pedidos.guardar.items', pedido.length);

    return {
      id: ref.id,
      pedido: pedidoDoc
    };

  } catch (error) {
    metrics.record('pedidos.guardar.error', 1);
    if (error instanceof ValidationError) {
      logger.warn('PEDIDO_VALIDATION_FAILED', { error: error.message });
      throw error;
    }
    logger.error('PEDIDO_SAVE_FAILED', { error: error.message, telefono: telefono_cliente });
    throw new AppError('Error al guardar pedido', 500, 'PEDIDO_SAVE_FAILED');
  }
}

/**
 * Obtiene pedidos con filtros opcionales
 * @param {Object} filtros - Filtros (telefono, estado, etc)
 * @returns {Array} Array de pedidos
 * @throws {AppError} Si falla la consulta en Firestore
 */
export async function obtenerPedidos(filtros = {}) {
  const startTime = Date.now();
  metrics.record('pedidos.obtener.call', 1);
  
  try {
    logger.debug('PEDIDOS_FETCH_START', { filtros });

    let query = db.collection(PEDIDOS_COLLECTION);

    if (filtros.telefono) {
      query = query.where('telefono_cliente', '==', String(filtros.telefono));
    }

    if (filtros.estado) {
      query = query.where('estado', '==', filtros.estado);
    }

    const snap = await query.limit(100).get();

    const pedidos = [];
    snap.forEach(doc => {
      pedidos.push({
        id: doc.id,
        ...doc.data()
      });
    });

    const duration = Date.now() - startTime;
    logger.info('PEDIDOS_FETCHED', { count: pedidos.length, filtros, duration_ms: duration });
    metrics.record('pedidos.obtener.success', 1);
    metrics.record('pedidos.obtener.duration_ms', duration);
    metrics.record('pedidos.obtener.count', pedidos.length);
    return pedidos;

  } catch (error) {
    metrics.record('pedidos.obtener.error', 1);
    logger.error('PEDIDOS_FETCH_FAILED', { error: error.message });
    throw new AppError('Error al obtener pedidos', 500, 'PEDIDOS_FETCH_FAILED');
  }
}

/**
 * Actualiza el estado de un pedido
 * @param {string} pedidoId - ID del pedido
 * @param {string} nuevoEstado - Nuevo estado
 * @returns {boolean} true si se actualizó
 * @throws {ValidationError} Si los parámetros son inválidos
 * @throws {AppError} Si falla la operación
 */
export async function actualizarEstadoPedido(pedidoId, nuevoEstado) {
  const startTime = Date.now();
  metrics.record('pedidos.actualizar.call', 1);
  
  try {
    if (!pedidoId || typeof pedidoId !== 'string') {
      throw new ValidationError('El ID del pedido es requerido');
    }

    if (!nuevoEstado || typeof nuevoEstado !== 'string') {
      throw new ValidationError('El nuevo estado es requerido');
    }

    logger.debug('PEDIDO_UPDATE_START', { pedidoId, nuevoEstado });

    await db.collection(PEDIDOS_COLLECTION).doc(pedidoId).update({
      estado: nuevoEstado,
      updatedAt: admin.firestore.Timestamp.now()
    });

    const duration = Date.now() - startTime;
    logger.info('PEDIDO_UPDATED', { pedidoId, nuevoEstado, duration_ms: duration });
    metrics.record('pedidos.actualizar.success', 1);
    metrics.record('pedidos.actualizar.duration_ms', duration);
    return true;

  } catch (error) {
    metrics.record('pedidos.actualizar.error', 1);
    if (error instanceof ValidationError) throw error;
    logger.error('PEDIDO_UPDATE_FAILED', { pedidoId, error: error.message });
    throw new AppError('Error al actualizar pedido', 500, 'PEDIDO_UPDATE_FAILED');
  }
}

/**
 * Handler API para guardar pedidos
 * POST /api/pedidos
 * Body: { nombre_cliente, telefono_cliente, direccion, tipo_entrega, pago, pedido, total }
 */
export default asyncHandler(async (req, res) => {
  const requestId = `pedidos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info('PEDIDOS_API_REQUEST', { method: req.method, ip: req.ip, requestId });
  metrics.record('pedidos.api.request', 1);

  if (req.method !== 'POST') {
    logger.warn('PEDIDOS_INVALID_METHOD', { method: req.method, requestId });
    metrics.record('pedidos.api.invalid_method', 1);
    return sendError(res, new ValidationError(`Método ${req.method} no permitido`), 405);
  }

  if (!req.body) {
    logger.warn('PEDIDOS_EMPTY_BODY', { ip: req.ip, requestId });
    metrics.record('pedidos.api.empty_body', 1);
    return sendError(res, new ValidationError('El cuerpo del request es requerido'), 400);
  }

  try {
    const result = await guardarPedidoFirebase(req.body);
    logger.info('PEDIDOS_API_SUCCESS', { pedidoId: result.id, requestId });
    metrics.record('pedidos.api.success', 1);
    return sendSuccess(res, { ok: true, ...result }, 200);

  } catch (error) {
    metrics.record('pedidos.api.error', 1);
    if (error instanceof ValidationError) {
      return sendError(res, error, 400);
    }
    logger.error('PEDIDOS_API_FAILED', { error: error.message, requestId });
    return sendError(res, new AppError('Error al guardar pedido', 500, 'PEDIDOS_FAILED'), 500);
  }
});
