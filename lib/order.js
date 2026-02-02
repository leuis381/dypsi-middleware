import { logger, ValidationError, asyncHandler, sendSuccess, sendError } from './utils.js';

/**
 * Handler para recibir órdenes
 * @param {Object} req - Request del cliente
 * @param {Object} res - Response del servidor
 * @returns {void}
 */
export default asyncHandler(async (req, res) => {
  logger.info('ORDER_RECEIVED', { body: req.body });

  // Validar que exista el cuerpo de la petición
  if (!req.body) {
    logger.warn('ORDER_EMPTY_BODY', { ip: req.ip });
    return sendError(res, new ValidationError('ORDER_BODY_REQUIRED', 'El cuerpo de la orden es requerido'), 400);
  }

  const { order } = req.body;

  // Validar que la orden no esté vacía
  if (!order) {
    logger.warn('ORDER_MISSING_FIELD', { field: 'order' });
    return sendError(res, new ValidationError('ORDER_FIELD_REQUIRED', 'El campo order es requerido'), 400);
  }

  // Validar estructura básica de la orden
  if (typeof order !== 'object') {
    logger.warn('ORDER_INVALID_TYPE', { type: typeof order });
    return sendError(res, new ValidationError('ORDER_INVALID_TYPE', 'La orden debe ser un objeto'), 400);
  }

  logger.info('ORDER_ACCEPTED', { orderId: order.id || 'unknown' });
  return sendSuccess(res, { status: 'Orden recibida', order }, 200);
});
