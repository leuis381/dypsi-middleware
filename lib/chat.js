import axios from 'axios';
import { logger, ValidationError, AppError, asyncHandler, sendSuccess, sendError, retryAsync } from './utils.js';

const OPENAI_API_TIMEOUT_MS = 30000;
const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_TEMPERATURE = 0.2;

/**
 * Handler para procesamiento de chat con OpenAI
 * @param {Object} req - Request con mensajes
 * @param {Object} res - Response del servidor
 * @throws {ValidationError} Si no hay mensajes en el request
 * @throws {AppError} Si falla la API de OpenAI
 */
export default asyncHandler(async (req, res) => {
  logger.info('CHAT_REQUEST_START', { ip: req.ip });

  // Validar body
  if (!req.body) {
    logger.warn('CHAT_EMPTY_BODY', { ip: req.ip });
    return sendError(res, new ValidationError('CHAT_BODY_REQUIRED', 'El cuerpo del request es requerido'), 400);
  }

  const { messages } = req.body;

  // Validar messages
  if (!messages) {
    logger.warn('CHAT_MISSING_MESSAGES', { ip: req.ip });
    return sendError(res, new ValidationError('MESSAGES_REQUIRED', 'El campo messages es requerido'), 400);
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    logger.warn('CHAT_INVALID_MESSAGES', { type: typeof messages, length: Array.isArray(messages) ? messages.length : 0 });
    return sendError(res, new ValidationError('MESSAGES_INVALID', 'messages debe ser un array no vacío'), 400);
  }

  // Validar API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('OPENAI_API_KEY_MISSING', {});
    return sendError(res, new AppError('CONFIG_ERROR', 'OpenAI API key no configurada'), 500);
  }

  try {
    logger.debug('CHAT_CALLING_OPENAI', { messageCount: messages.length });

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
      { maxAttempts: 3, initialDelayMs: 500 }
    );

    logger.info('CHAT_OPENAI_SUCCESS', { messageCount: messages.length, tokensUsed: response.data.usage?.total_tokens });
    return sendSuccess(res, response.data, 200);

  } catch (error) {
    logger.error('CHAT_OPENAI_FAILED', { errorMessage: error.message, errorCode: error.code });

    if (error.response?.status === 401) {
      return sendError(res, new AppError('OPENAI_AUTH_FAILED', 'Autenticación con OpenAI falló'), 401);
    }
    if (error.response?.status === 429) {
      return sendError(res, new AppError('OPENAI_RATE_LIMIT', 'Límite de rate en OpenAI excedido'), 429);
    }
    if (error.code === 'ECONNABORTED') {
      return sendError(res, new AppError('OPENAI_TIMEOUT', 'Timeout llamando a OpenAI'), 504);
    }

    return sendError(res, new AppError('CHAT_FAILED', 'Error procesando chat', { cause: error }), 500);
  }
});