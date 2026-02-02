import axios from 'axios';
import { logger, ValidationError, AppError, asyncHandler, sendSuccess, sendError, retryAsync, MetricsCollector } from './utils.js';

const OPENAI_API_TIMEOUT_MS = 30000;
const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_TEMPERATURE = 0.2;

const metrics = new MetricsCollector();

/**
 * Handler para procesamiento de chat con OpenAI
 * @param {Object} req - Request con mensajes
 * @param {Object} res - Response del servidor
 * @throws {ValidationError} Si no hay mensajes en el request
 * @throws {AppError} Si falla la API de OpenAI
 */
export default asyncHandler(async (req, res) => {
  const requestId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info('CHAT_REQUEST_START', { ip: req.ip, requestId });
  metrics.record('chat.request', 1);

  // Validar body
  if (!req.body) {
    logger.warn('CHAT_EMPTY_BODY', { ip: req.ip, requestId });
    metrics.record('chat.empty_body', 1);
    return sendError(res, new ValidationError('El cuerpo del request es requerido'), 400);
  }

  const { messages } = req.body;

  // Validar messages
  if (!messages) {
    logger.warn('CHAT_MISSING_MESSAGES', { ip: req.ip, requestId });
    metrics.record('chat.missing_messages', 1);
    return sendError(res, new ValidationError('El campo messages es requerido'), 400);
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    logger.warn('CHAT_INVALID_MESSAGES', { type: typeof messages, length: Array.isArray(messages) ? messages.length : 0, requestId });
    metrics.record('chat.invalid_messages', 1);
    return sendError(res, new ValidationError('messages debe ser un array no vacío'), 400);
  }

  // Validar API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('OPENAI_API_KEY_MISSING', { requestId });
    metrics.record('chat.api_key_missing', 1);
    return sendError(res, new AppError('OpenAI API key no configurada', 500, 'CONFIG_ERROR'), 500);
  }

  try {
    logger.debug('CHAT_CALLING_OPENAI', { messageCount: messages.length, requestId });
    const startTime = Date.now();

    const response = await retryAsync(
      () => axios.post(
        OPENAI_API_ENDPOINT,
        {
          model: OPENAI_MODEL,
          messages,
          temperature: OPENAI_TEMPERATURE
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: OPENAI_API_TIMEOUT_MS
        }
      ),
      { maxRetries: 3, initialDelayMs: 500 }
    );

    const duration = Date.now() - startTime;
    const tokensUsed = response.data.usage?.total_tokens || 0;
    
    logger.info('CHAT_OPENAI_SUCCESS', { messageCount: messages.length, tokensUsed, duration_ms: duration, requestId });
    metrics.record('chat.success', 1);
    metrics.record('chat.duration_ms', duration);
    metrics.record('chat.tokens_used', tokensUsed);
    
    return sendSuccess(res, response.data, 200);

  } catch (error) {
    logger.error('CHAT_OPENAI_FAILED', { errorMessage: error.message, errorCode: error.code, requestId });
    metrics.record('chat.error', 1);

    if (error.response?.status === 401) {
      metrics.record('chat.auth_failed', 1);
      return sendError(res, new AppError('Autenticación con OpenAI falló', 401, 'OPENAI_AUTH_FAILED'), 401);
    }
    if (error.response?.status === 429) {
      metrics.record('chat.rate_limit', 1);
      return sendError(res, new AppError('Límite de rate en OpenAI excedido', 429, 'OPENAI_RATE_LIMIT'), 429);
    }
    if (error.code === 'ECONNABORTED') {
      metrics.record('chat.timeout', 1);
      return sendError(res, new AppError('Timeout llamando a OpenAI', 504, 'OPENAI_TIMEOUT'), 504);
    }

    return sendError(res, new AppError('Error procesando chat', 500, 'CHAT_FAILED'), 500);
  }
});