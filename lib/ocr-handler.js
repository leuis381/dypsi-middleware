import { readImage } from './ocr.js';
import { logger, ValidationError, AppError, asyncHandler, sendSuccess, sendError } from './utils.js';

/**
 * Handler para procesamiento de OCR desde imágenes
 * POST /api/ocr
 * Body: { imageUrl: string }
 * @returns {Object} { ok: boolean, result: OCRResult }
 * @throws {ValidationError} Si imageUrl es inválido
 * @throws {AppError} Si OCR falla
 */
export default asyncHandler(async (req, res) => {
  logger.info('OCR_REQUEST_START', { method: req.method, ip: req.ip });

  if (req.method !== 'POST') {
    logger.warn('OCR_INVALID_METHOD', { method: req.method });
    return sendError(res, new ValidationError('METHOD_NOT_ALLOWED', `Método ${req.method} no permitido. Use POST`), 405);
  }

  if (!req.body) {
    logger.warn('OCR_EMPTY_BODY', { ip: req.ip });
    return sendError(res, new ValidationError('BODY_REQUIRED', 'El cuerpo del request es requerido'), 400);
  }

  const { imageUrl } = req.body;

  if (!imageUrl) {
    logger.warn('OCR_MISSING_IMAGE_URL', { ip: req.ip });
    return sendError(res, new ValidationError('IMAGE_URL_REQUIRED', 'El parámetro imageUrl es requerido'), 400);
  }

  if (typeof imageUrl !== 'string') {
    logger.warn('OCR_INVALID_IMAGE_URL_TYPE', { type: typeof imageUrl });
    return sendError(res, new ValidationError('IMAGE_URL_INVALID_TYPE', 'imageUrl debe ser un string'), 400);
  }

  try {
    new URL(imageUrl);
  } catch (err) {
    logger.warn('OCR_INVALID_URL_FORMAT', { url: imageUrl.substring(0, 50) });
    return sendError(res, new ValidationError('IMAGE_URL_INVALID_FORMAT', 'imageUrl debe ser una URL válida'), 400);
  }

  if (imageUrl.length > 2048) {
    logger.warn('OCR_URL_TOO_LONG', { length: imageUrl.length });
    return sendError(res, new ValidationError('IMAGE_URL_TOO_LONG', 'URL muy larga (máximo 2048 caracteres)'), 400);
  }

  try {
    logger.debug('OCR_PROCESSING_START', { url: imageUrl.substring(0, 50) + '...' });

    const startTime = Date.now();
    const result = await readImage(imageUrl);
    const processingTimeMs = Date.now() - startTime;

    logger.info('OCR_SUCCESS', { 
      processingTimeMs,
      provider: result.provider,
      textLength: result.text?.length || 0,
      confidence: result.confidence
    });

    return sendSuccess(res, { ok: true, result }, 200);

  } catch (error) {
    logger.error('OCR_PROCESSING_FAILED', { 
      errorMessage: error.message,
      errorCode: error.code,
      url: imageUrl.substring(0, 50) + '...'
    });

    if (error.message?.includes('timeout') || error.code === 'ECONNABORTED') {
      return sendError(res, new AppError('OCR_TIMEOUT', 'Timeout procesando OCR', { cause: error }), 504);
    }
    if (error.message?.includes('404') || error.code === 'ENOTFOUND') {
      return sendError(res, new ValidationError('IMAGE_NOT_FOUND', 'La URL de la imagen no es accesible'), 404);
    }
    if (error.message?.includes('rate')) {
      return sendError(res, new AppError('OCR_RATE_LIMIT', 'Límite de rate en OCR excedido', { cause: error }), 429);
    }

    return sendError(res, new AppError('OCR_FAILED', 'Error procesando OCR', { cause: error }), 500);
  }
});
