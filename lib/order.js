import { logger, ValidationError, asyncHandler, sendSuccess, sendError, MetricsCollector } from './utils.js';

const metrics = new MetricsCollector();

/**
 * Handler para recibir órdenes
 * @param {Object} req - Request del cliente
 * @param {Object} res - Response del servidor
 * @returns {void}
 */
export default asyncHandler(async (req, res) => {
  const requestId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info('ORDER_RECEIVED', { body: req.body, requestId });
  metrics.record('order.request', 1);

  // Validar que exista el cuerpo de la petición
  if (!req.body) {
    logger.warn('ORDER_EMPTY_BODY', { ip: req.ip, requestId });
    metrics.record('order.empty_body', 1);
    return sendError(res, new ValidationError('El cuerpo de la orden es requerido'), 400);
  }

  const { order } = req.body;

  // Validar que la orden no esté vacía
  if (!order) {
    logger.warn('ORDER_MISSING_FIELD', { field: 'order', requestId });
    metrics.record('order.missing_field', 1);
    return sendError(res, new ValidationError('El campo order es requerido'), 400);
  }

  // Validar estructura básica de la orden
  if (typeof order !== 'object') {
    logger.warn('ORDER_INVALID_TYPE', { type: typeof order, requestId });
    metrics.record('order.invalid_type', 1);
    return sendError(res, new ValidationError('La orden debe ser un objeto'), 400);
  }

  logger.info('ORDER_ACCEPTED', { orderId: order.id || 'unknown', requestId });
  metrics.record('order.success', 1);
  return sendSuccess(res, { status: 'Orden recibida', order }, 200);
});
