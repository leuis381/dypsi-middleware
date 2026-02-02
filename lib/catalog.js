import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { 
  logger, 
  ValidationError, 
  AppError, 
  asyncHandler, 
  sendSuccess, 
  sendError, 
  retryAsync, 
  Cache,
  MetricsCollector,
  sanitizeInput,
  parseJSON
} from './utils.js';
import CONFIG from './config.js';

/**
 * lib/catalog.js
 *
 * Proxy robusto para catálogo de WhatsApp Business con fallback local
 * - Intenta obtener catálogo de WhatsApp Graph API
 * - Soporta paginación, reintentos con backoff exponencial, timeout
 * - Cache en memoria con TTL
 * - Fallback a menu.json local si WhatsApp falla
 * - GET /api/catalog?source=whatsapp|local|auto
 */

// Configuración
const LOCAL_MENU_PATH = process.env.MENU_DATA_PATH || path.resolve(process.cwd(), 'data', 'menu.json');
const WHATSAPP_GRAPH_ENDPOINT = 'https://graph.facebook.com/v18.0';
const AXIOS_TIMEOUT_MS = CONFIG.API_TIMEOUT_MS || 15000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;
const CACHE_TTL_MS = CONFIG.CACHE_TTL_MS || 300000; // 5 min

// Cache en memoria y métricas
const catalogCache = new Cache(CACHE_TTL_MS);
const metrics = new MetricsCollector();

/**
 * Verifica si WhatsApp está configurado
 * @returns {boolean} true si están todos los env vars necesarios
 * @private
 */
function isWhatsAppConfigured() {
  return !!(CONFIG.WHATSAPP_BUSINESS_ID && CONFIG.WHATSAPP_TOKEN);
}

/**
 * Normaliza un producto de WhatsApp Graph API a formato interno
 * @param {Object} raw - Producto raw de WhatsApp
 * @returns {Object} Producto normalizado
 * @private
 */
function normalizeWhatsAppProduct(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: null,
      name: 'Unknown',
      description: null,
      price: null,
      currency: null,
      images: [],
      metadata: {}
    };
  }

  return {
    id: raw.id || null,
    name: raw.name || raw.title || 'Sin nombre',
    description: raw.description || null,
    price: raw.price ? Number(raw.price) : null,
    currency: raw.currency || 'PEN',
    images: Array.isArray(raw.images) ? raw.images : (raw.image ? [raw.image] : []),
    availability: raw.availability || true,
    sku: raw.sku || null,
    metadata: raw
  };
}

/**
 * Lee el catálogo local desde menu.json
 * @returns {Object} { source, products, raw }
 * @throws {AppError} Si falla leer o parsear el archivo
 * @private
 */
async function readLocalMenu() {
  const startTime = Date.now();
  try {
    logger.debug('CATALOG_LOCAL_READ_START', { path: LOCAL_MENU_PATH });
    metrics.record('catalog.local.read', 1);

    const content = await fs.readFile(LOCAL_MENU_PATH, 'utf8');

    if (!content) {
      throw new ValidationError('El archivo menu.json está vacío');
    }

    let parsed;
    try {
      parsed = parseJSON(content);
      if (!parsed) {
        throw new Error('JSON parse returned null');
      }
    } catch (jsonErr) {
      logger.error('CATALOG_INVALID_JSON', { error: jsonErr.message });
      metrics.record('catalog.local.invalid_json', 1);
      throw new AppError('El archivo menu.json contiene JSON inválido', 400, 'INVALID_MENU_JSON');
    }

    // Procesar estructura con categorías
    if (Array.isArray(parsed.categorias)) {
      logger.debug('CATALOG_LOCAL_PROCESSING_CATEGORIES', { count: parsed.categorias.length });
      const products = [];

      for (const cat of parsed.categorias) {
        if (!cat || typeof cat !== 'object') continue;

        if (Array.isArray(cat.productos)) {
          for (const p of cat.productos) {
            if (p && typeof p === 'object') {
              products.push({
                ...p,
                categoria: cat.id || cat.nombre || null
              });
            }
          }
        }
      }

      const duration = Date.now() - startTime;
      logger.info('CATALOG_LOCAL_LOADED', { source: 'local', products: products.length, duration_ms: duration });
      metrics.record('catalog.local.success', 1);
      metrics.record('catalog.local.duration_ms', duration);
      return { source: 'local', products, raw: parsed };
    }

    // Si es array directo
    if (Array.isArray(parsed)) {
      const duration = Date.now() - startTime;
      logger.info('CATALOG_LOCAL_LOADED', { source: 'local', products: parsed.length, duration_ms: duration });
      metrics.record('catalog.local.success', 1);
      metrics.record('catalog.local.duration_ms', duration);
      return { source: 'local', products: parsed, raw: parsed };
    }

    // Si es objeto single
    const duration = Date.now() - startTime;
    logger.info('CATALOG_LOCAL_LOADED', { source: 'local', products: 1, duration_ms: duration });
    metrics.record('catalog.local.success', 1);
    metrics.record('catalog.local.duration_ms', duration);
    return { source: 'local', products: [parsed], raw: parsed };

  } catch (error) {
    metrics.record('catalog.local.error', 1);
    if (error instanceof ValidationError || error instanceof AppError) throw error;
    logger.error('CATALOG_LOCAL_READ_FAILED', { error: error.message, path: LOCAL_MENU_PATH });
    throw new AppError(`Error leyendo menu.json: ${error.message}`, 500, 'LOCAL_MENU_READ_FAILED');
  }
}

/**
 * Obtiene productos del catálogo de WhatsApp Business Graph API
 * @param {Object} options - { limit, fields }
 * @returns {Object} { source, products, raw }
 * @throws {AppError} Si falla la conexión a WhatsApp
 * @private
 */
async function fetchWhatsAppProducts({ limit = 100, fields = null } = {}) {
  const startTime = Date.now();
  try {
    if (!isWhatsAppConfigured()) {
      throw new AppError('Las variables de entorno de WhatsApp no están configuradas', 503, 'WHATSAPP_NOT_CONFIGURED');
    }

    logger.debug('CATALOG_WHATSAPP_FETCH_START', { limit, fields });
    metrics.record('catalog.whatsapp.fetch', 1);

    const businessId = CONFIG.WHATSAPP_BUSINESS_ID;
    const token = CONFIG.WHATSAPP_TOKEN;
    const baseUrl = `${WHATSAPP_GRAPH_ENDPOINT}/${businessId}/products`;

    const axiosInstance = axios.create({
      timeout: AXIOS_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    let allProducts = [];
    let url = baseUrl;
    let params = {
      limit: limit || 100
    };

    if (fields && typeof fields === 'string') {
      params.fields = fields;
    }

    const pageLimit = 10; // Max 10 páginas para evitar loops infinitos
    let pageCount = 0;

    // Loop de paginación con reintentos
    while (url && pageCount < pageLimit) {
      pageCount++;
      logger.debug('CATALOG_WHATSAPP_PAGINATING', { page: pageCount, url: url.substring(0, 50) });

      let response;
      try {
        response = await retryAsync(
          () => axiosInstance.get(url, { params }),
          { maxRetries: MAX_RETRIES, initialDelayMs: RETRY_BASE_DELAY_MS }
        );
      } catch (error) {
        logger.error('CATALOG_WHATSAPP_PAGE_FAILED', { page: pageCount, error: error.message });
        
        // Si es error de autenticación, fail rápido
        if (error.response?.status === 401 || error.response?.status === 403) {
          metrics.record('catalog.whatsapp.auth_failed', 1);
          throw new AppError('Autenticación fallida con WhatsApp API', 401, 'WHATSAPP_AUTH_FAILED');
        }

        // Si es error temporal (5xx o timeout), re-throw para que falle
        if (error.response?.status >= 500 || error.code === 'ECONNABORTED') {
          throw error;
        }

        // Si es error de cliente (4xx), continuar
        if (error.response?.status >= 400 && error.response?.status < 500) {
          logger.warn('CATALOG_WHATSAPP_CLIENT_ERROR', { status: error.response?.status });
          break;
        }

        throw error;
      }

      const data = response?.data;
      if (!data) break;

      // Procesar items
      const items = Array.isArray(data.data) ? data.data : [];
      if (items.length > 0) {
        allProducts.push(...items);
        logger.debug('CATALOG_WHATSAPP_PRODUCTS_FETCHED', { page: pageCount, count: items.length, total: allProducts.length });
      }

      // Obtener siguiente página
      url = data?.paging?.next || null;
      params = {}; // Clear params para nextUrl
    }

    if (pageCount >= pageLimit) {
      logger.warn('CATALOG_WHATSAPP_PAGE_LIMIT_REACHED', { limit: pageLimit });
    }

    // Normalizar productos
    const normalized = allProducts.map(normalizeWhatsAppProduct).filter(p => p && p.id);

    const duration = Date.now() - startTime;
    logger.info('CATALOG_WHATSAPP_FETCHED', { products: normalized.length, pages: pageCount, duration_ms: duration });
    metrics.record('catalog.whatsapp.success', 1);
    metrics.record('catalog.whatsapp.duration_ms', duration);
    metrics.record('catalog.whatsapp.products', normalized.length);

    return { source: 'whatsapp', products: normalized, raw: allProducts };

  } catch (error) {
    metrics.record('catalog.whatsapp.error', 1);
    if (error instanceof AppError) throw error;
    logger.error('CATALOG_WHATSAPP_FETCH_FAILED', { error: error.message });
    throw new AppError('Error obteniendo catálogo de WhatsApp', 500, 'WHATSAPP_FETCH_FAILED');
  }
}

/**
 * Handler API para obtener catálogo
 * GET /api/catalog?source=whatsapp|local|auto&forceRefresh=true
 * - source: 'whatsapp' (solo WhatsApp), 'local' (solo local), 'auto' (probar WhatsApp primero)
 * - forceRefresh: true para forzar refresh de cache
 */
export default asyncHandler(async (req, res) => {
  const requestId = `catalog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info('CATALOG_REQUEST_START', { method: req.method, query: req.query, requestId });
  metrics.record('catalog.request', 1);

  // Solo permitir GET
  if (req.method !== 'GET') {
    logger.warn('CATALOG_INVALID_METHOD', { method: req.method, requestId });
    res.setHeader('Allow', 'GET');
    metrics.record('catalog.invalid_method', 1);
    return sendError(res, new ValidationError("Use GET method"), 405);
  }

  // Parsear parámetros
  const sourceParam = sanitizeInput(req.query?.source || 'auto', 20).toLowerCase();
  const forceRefresh = req.query?.forceRefresh === 'true' || req.query?.refresh === 'true';

  // Validar source param
  if (!['whatsapp', 'local', 'auto'].includes(sourceParam)) {
    logger.warn('CATALOG_INVALID_SOURCE', { source: sourceParam, requestId });
    metrics.record('catalog.invalid_source', 1);
    return sendError(res, new ValidationError("source debe ser 'whatsapp', 'local' o 'auto'"), 400);
  }

  logger.debug('CATALOG_PARAMETERS', { source: sourceParam, forceRefresh, requestId });

  // Verificar cache válido
  if (!forceRefresh) {
    const cached = catalogCache.get('catalog');
    if (cached) {
      logger.info('CATALOG_CACHE_HIT', { source: cached.source, products: cached.products.length, requestId });
      metrics.record('catalog.cache_hit', 1);
      return sendSuccess(res, {
        ok: true,
        source: cached.source,
        cached: true,
        products: cached.products,
        count: cached.products.length,
        timestamp: new Date().toISOString()
      }, 200);
    }
  } else {
    logger.debug('CATALOG_CACHE_BYPASSED', { requestId });
    metrics.record('catalog.cache_bypass', 1);
  }

  try {
    let result = null;

    // Si especifican local explícitamente
    if (sourceParam === 'local') {
      logger.debug('CATALOG_FETCHING_LOCAL', { requestId });
      result = await readLocalMenu();
      catalogCache.set('catalog', result);
      logger.info('CATALOG_LOCAL_SUCCESS', { products: result.products.length, requestId });
      metrics.record('catalog.source_local', 1);
      return sendSuccess(res, {
        ok: true,
        source: result.source,
        cached: false,
        products: result.products,
        count: result.products.length,
        timestamp: new Date().toISOString()
      }, 200);
    }

    // Si especifican whatsapp o auto, intentar WhatsApp primero
    if (sourceParam === 'whatsapp' || sourceParam === 'auto') {
      if (isWhatsAppConfigured()) {
        try {
          logger.debug('CATALOG_FETCHING_WHATSAPP', { requestId });
          result = await fetchWhatsAppProducts({ limit: 100, fields: 'id,name,description,price,currency,images' });
          catalogCache.set('catalog', result);
          logger.info('CATALOG_WHATSAPP_SUCCESS', { products: result.products.length, requestId });
          metrics.record('catalog.source_whatsapp', 1);
          return sendSuccess(res, {
            ok: true,
            source: result.source,
            cached: false,
            products: result.products,
            count: result.products.length,
            timestamp: new Date().toISOString()
          }, 200);

        } catch (whatsappError) {
          if (sourceParam === 'whatsapp') {
            // Si pidieron específicamente WhatsApp, fallar
            logger.error('CATALOG_WHATSAPP_REQUESTED_BUT_FAILED', { error: whatsappError.message, requestId });
            metrics.record('catalog.whatsapp_only_failed', 1);
            return sendError(res, whatsappError, 500);
          }

          // Si es auto, continuar a local fallback
          logger.warn('CATALOG_WHATSAPP_FALLBACK_TO_LOCAL', { error: whatsappError.message, requestId });
          metrics.record('catalog.whatsapp_fallback', 1);
        }
      } else {
        if (sourceParam === 'whatsapp') {
          logger.warn('CATALOG_WHATSAPP_NOT_CONFIGURED', { requestId });
          metrics.record('catalog.whatsapp_not_configured', 1);
          return sendError(res, new AppError('WhatsApp no está configurado', 503, 'WHATSAPP_NOT_CONFIGURED'), 503);
        }

        logger.debug('CATALOG_WHATSAPP_NOT_CONFIGURED_USING_LOCAL', { requestId });
      }
    }

    // Fallback a local (auto mode o fallback desde whatsapp)
    logger.debug('CATALOG_FETCHING_LOCAL_FALLBACK', { requestId });
    result = await readLocalMenu();
    catalogCache.set('catalog', result);
    logger.info('CATALOG_LOCAL_FALLBACK_SUCCESS', { products: result.products.length, requestId });
    metrics.record('catalog.fallback_local', 1);

    return sendSuccess(res, {
      ok: true,
      source: result.source,
      cached: false,
      products: result.products,
      count: result.products.length,
      fallback: sourceParam !== 'local',
      timestamp: new Date().toISOString()
    }, 200);

  } catch (error) {
    logger.error('CATALOG_FETCH_ALL_FAILED', { error: error.message, requestId });
    metrics.record('catalog.error', 1);

    if (error instanceof ValidationError) {
      return sendError(res, error, 400);
    }

    if (error instanceof AppError) {
      return sendError(res, error, error.message.includes('TIMEOUT') ? 504 : 500);
    }

    return sendError(res, new AppError('Error obteniendo catálogo', 500, 'CATALOG_FAILED'), 500);
  }
});