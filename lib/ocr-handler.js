import { readImage } from './ocr.js';
import { logger, ValidationError, AppError, asyncHandler, sendSuccess, sendError, MetricsCollector, validateUrl } from './utils.js';

const metrics = new MetricsCollector();
const MAX_URL_LENGTH = 2048;

/**
 * Handler para procesamiento de OCR desde imágenes
 * POST /api/ocr
 * Body: { imageUrl: string }
 * @returns {Object} { ok: boolean, result: OCRResult }
 * @throws {ValidationError} Si imageUrl es inválido
 * @throws {AppError} Si OCR falla
 */
export default asyncHandler(async (req, res) => {
  const requestId = `ocr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info('OCR_REQUEST_START', { method: req.method, ip: req.ip, requestId });
  metrics.record('ocr.request', 1);

  if (req.method !== 'POST') {
    logger.warn('OCR_INVALID_METHOD', { method: req.method, requestId });
    metrics.record('ocr.invalid_method', 1);
    return sendError(res, new ValidationError(`Método ${req.method} no permitido. Use POST`), 405);
  }

  if (!req.body) {
    logger.warn('OCR_EMPTY_BODY', { ip: req.ip, requestId });
    metrics.record('ocr.empty_body', 1);
    return sendError(res, new ValidationError('El cuerpo del request es requerido'), 400);
  }

  const { imageUrl } = req.body;

  if (!imageUrl) {
    logger.warn('OCR_MISSING_IMAGE_URL', { ip: req.ip, requestId });
    metrics.record('ocr.missing_url', 1);
    return sendError(res, new ValidationError('El parámetro imageUrl es requerido'), 400);
  }

  if (typeof imageUrl !== 'string') {
    logger.warn('OCR_INVALID_IMAGE_URL_TYPE', { type: typeof imageUrl, requestId });
    metrics.record('ocr.invalid_url_type', 1);
    return sendError(res, new ValidationError('imageUrl debe ser un string'), 400);
  }

  try {
    validateUrl(imageUrl);
  } catch (err) {
    logger.warn('OCR_INVALID_URL_FORMAT', { url: imageUrl.substring(0, 50), requestId });
    metrics.record('ocr.invalid_url_format', 1);
    return sendError(res, new ValidationError('imageUrl debe ser una URL válida'), 400);
  }

  if (imageUrl.length > MAX_URL_LENGTH) {
    logger.warn('OCR_URL_TOO_LONG', { length: imageUrl.length, requestId });
    metrics.record('ocr.url_too_long', 1);
    return sendError(res, new ValidationError(`URL muy larga (máximo ${MAX_URL_LENGTH} caracteres)`), 400);
  }

  try {
    logger.debug('OCR_PROCESSING_START', { url: imageUrl.substring(0, 50) + '...', requestId });

    const startTime = Date.now();
    const result = await readImage(imageUrl);
    const processingTimeMs = Date.now() - startTime;

    logger.info('OCR_SUCCESS', { 
      processingTimeMs,
      provider: result.provider,
      textLength: result.text?.length || 0,
      confidence: result.confidence,
      requestId
    });
    metrics.record('ocr.success', 1);
    metrics.record('ocr.duration_ms', processingTimeMs);
    if (result.text?.length) {
      metrics.record('ocr.text_length', result.text.length);
    }

    return sendSuccess(res, { ok: true, result }, 200);

  } catch (error) {
    logger.error('OCR_PROCESSING_FAILED', { 
      errorMessage: error.message,
      errorCode: error.code,
      url: imageUrl.substring(0, 50) + '...',
      requestId
    });
    metrics.record('ocr.error', 1);

    if (error.message?.includes('timeout') || error.code === 'ECONNABORTED') {
      metrics.record('ocr.timeout', 1);
      return sendError(res, new AppError('Timeout procesando OCR', 504, 'OCR_TIMEOUT'), 504);
    }
    if (error.message?.includes('404') || error.code === 'ENOTFOUND') {
      metrics.record('ocr.not_found', 1);
      return sendError(res, new ValidationError('La URL de la imagen no es accesible'), 404);
    }
    if (error.message?.includes('rate')) {
      metrics.record('ocr.rate_limit', 1);
      return sendError(res, new AppError('Límite de rate en OCR excedido', 429, 'OCR_RATE_LIMIT'), 429);
    }

    return sendError(res, new AppError('Error procesando OCR', 500, 'OCR_FAILED'), 500);
  }
});
