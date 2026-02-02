import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { logger, ValidationError, AppError, asyncHandler, sendSuccess, sendError, retryAsync, Cache } from './utils.js';
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

// Cache en memoria
const catalogCache = new Cache({ maxSize: 1, ttlMs: CACHE_TTL_MS });

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
  try {
    logger.debug('CATALOG_LOCAL_READ_START', { path: LOCAL_MENU_PATH });

    const content = await fs.readFile(LOCAL_MENU_PATH, 'utf8');

    if (!content) {
      throw new ValidationError('MENU_EMPTY', 'El archivo menu.json está vacío');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (jsonErr) {
      logger.error('CATALOG_INVALID_JSON', { error: jsonErr.message });
      throw new AppError('INVALID_MENU_JSON', 'El archivo menu.json contiene JSON inválido', { cause: jsonErr });
    }

    if (!parsed) {
      throw new ValidationError('MENU_INVALID', 'El contenido de menu.json es inválido');
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

      logger.info('CATALOG_LOCAL_LOADED', { source: 'local', products: products.length });
      return { source: 'local', products, raw: parsed };
    }

    // Si es array directo
    if (Array.isArray(parsed)) {
      logger.info('CATALOG_LOCAL_LOADED', { source: 'local', products: parsed.length });
      return { source: 'local', products: parsed, raw: parsed };
    }

    // Si es objeto single
    logger.info('CATALOG_LOCAL_LOADED', { source: 'local', products: 1 });
    return { source: 'local', products: [parsed], raw: parsed };

  } catch (error) {
    if (error instanceof ValidationError || error instanceof AppError) throw error;
    logger.error('CATALOG_LOCAL_READ_FAILED', { error: error.message, path: LOCAL_MENU_PATH });
    throw new AppError('LOCAL_MENU_READ_FAILED', `Error leyendo menu.json: ${error.message}`, { cause: error });
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
  try {
    if (!isWhatsAppConfigured()) {
      throw new AppError('WHATSAPP_NOT_CONFIGURED', 'Las variables de entorno de WhatsApp no están configuradas');
    }

    logger.debug('CATALOG_WHATSAPP_FETCH_START', { limit, fields });

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
          { maxAttempts: MAX_RETRIES, initialDelayMs: RETRY_BASE_DELAY_MS }
        );
      } catch (error) {
        logger.error('CATALOG_WHATSAPP_PAGE_FAILED', { page: pageCount, error: error.message });
        
        // Si es error de autenticación, fail rápido
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new AppError('WHATSAPP_AUTH_FAILED', 'Autenticación fallida con WhatsApp API', { cause: error });
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

    logger.info('CATALOG_WHATSAPP_FETCHED', { products: normalized.length, pages: pageCount });

    return { source: 'whatsapp', products: normalized, raw: allProducts };

  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error('CATALOG_WHATSAPP_FETCH_FAILED', { error: error.message });
    throw new AppError('WHATSAPP_FETCH_FAILED', 'Error obteniendo catálogo de WhatsApp', { cause: error });
  }
}

/**
 * Handler API para obtener catálogo
 * GET /api/catalog?source=whatsapp|local|auto&forceRefresh=true
 * - source: 'whatsapp' (solo WhatsApp), 'local' (solo local), 'auto' (probar WhatsApp primero)
 * - forceRefresh: true para forzar refresh de cache
 */
export default asyncHandler(async (req, res) => {
  logger.info('CATALOG_REQUEST_START', { method: req.method, query: req.query });

  // Solo permitir GET
  if (req.method !== 'GET') {
    logger.warn('CATALOG_INVALID_METHOD', { method: req.method });
    res.setHeader('Allow', 'GET');
    return sendError(res, new ValidationError('METHOD_NOT_ALLOWED', 'Use GET method'), 405);
  }

  // Parsear parámetros
  const sourceParam = (req.query?.source || 'auto').toString().toLowerCase();
  const forceRefresh = req.query?.forceRefresh === 'true' || req.query?.refresh === 'true';

  // Validar source param
  if (!['whatsapp', 'local', 'auto'].includes(sourceParam)) {
    logger.warn('CATALOG_INVALID_SOURCE', { source: sourceParam });
    return sendError(res, new ValidationError('INVALID_SOURCE', "source debe ser 'whatsapp', 'local' o 'auto'"), 400);
  }

  logger.debug('CATALOG_PARAMETERS', { source: sourceParam, forceRefresh });

  // Verificar cache válido
  if (!forceRefresh) {
    const cached = catalogCache.get('catalog');
    if (cached) {
      logger.info('CATALOG_CACHE_HIT', { source: cached.source, products: cached.products.length });
      return sendSuccess(res, {
        ok: true,
        source: cached.source,
        cached: true,
        products: cached.products,
        count: cached.products.length,
        timestamp: new Date().toISOString()
      }, 200);
    }
  }

  try {
    let result = null;

    // Si especifican local explícitamente
    if (sourceParam === 'local') {
      logger.debug('CATALOG_FETCHING_LOCAL');
      result = await readLocalMenu();
      catalogCache.set('catalog', result);
      logger.info('CATALOG_LOCAL_SUCCESS', { products: result.products.length });
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
          logger.debug('CATALOG_FETCHING_WHATSAPP');
          result = await fetchWhatsAppProducts({ limit: 100, fields: 'id,name,description,price,currency,images' });
          catalogCache.set('catalog', result);
          logger.info('CATALOG_WHATSAPP_SUCCESS', { products: result.products.length });
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
            logger.error('CATALOG_WHATSAPP_REQUESTED_BUT_FAILED', { error: whatsappError.message });
            return sendError(res, whatsappError, 500);
          }

          // Si es auto, continuar a local fallback
          logger.warn('CATALOG_WHATSAPP_FALLBACK_TO_LOCAL', { error: whatsappError.message });
        }
      } else {
        if (sourceParam === 'whatsapp') {
          logger.warn('CATALOG_WHATSAPP_NOT_CONFIGURED');
          return sendError(res, new AppError('WHATSAPP_NOT_CONFIGURED', 'WhatsApp no está configurado'), 503);
        }

        logger.debug('CATALOG_WHATSAPP_NOT_CONFIGURED_USING_LOCAL');
      }
    }

    // Fallback a local (auto mode o fallback desde whatsapp)
    logger.debug('CATALOG_FETCHING_LOCAL_FALLBACK');
    result = await readLocalMenu();
    catalogCache.set('catalog', result);
    logger.info('CATALOG_LOCAL_FALLBACK_SUCCESS', { products: result.products.length });

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
    logger.error('CATALOG_FETCH_ALL_FAILED', { error: error.message });

    if (error instanceof ValidationError) {
      return sendError(res, error, 400);
    }

    if (error instanceof AppError) {
      return sendError(res, error, error.message.includes('TIMEOUT') ? 504 : 500);
    }

    return sendError(res, new AppError('CATALOG_FAILED', 'Error obteniendo catálogo', { cause: error }), 500);
  }
});