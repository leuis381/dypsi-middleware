/**
 * api/kommo.js
 *
 * 🚀 LA MEJOR IA DE RESTAURANTES DEL MUNDO v4.0 ULTRA+ 🚀
 * 
 * Sistema Ultra Inteligente para WhatsApp via Kommo
 * - IA con sentido común extremo + NLP avanzado
 * - Respuestas humanizadas infinitas + Corrección de errores
 * - Sin dependencia de APIs externas (excepto OCR)
 * - Envío automático de pedidos al agente
 * - Escalación inteligente a agentes humanos
 * - 100% optimizado para Vercel
 * 
 * VERSION: 4.0 ULTRA+
 * Compatible con: Firebase, OCR.Space, Kommo, NLP Avanzado
 */

import axios from "axios";
import admin from "firebase-admin";
import parseOrderText from "../lib/parse-order.js";
import { readImage, readImageBuffer, extractMostLikelyTotal, validateReceiptAgainstOrder } from "../lib/ocr.js";
import sessionStore from "../lib/session-store.js";
import aiEngineModule from "../lib/ai-engine.js";
import smartOcrModule from "../lib/smart-ocr.js";
import userProfileModule from "../lib/user-profile.js";
import ultraHumanizer from "../lib/ultra-humanizer.js";
import smartDelivery from "../lib/smart-delivery.js";
import detectAddressModule from "../lib/detect-address.js";
import { calculateRoute } from "../lib/route-price.js";
import kommoSender from "../lib/kommo-sender.js";
import smartInterpreter from "../lib/smart-interpreter.js";
import advancedNLP from "../lib/advanced-nlp.js";
import fuzzyMatcher from "../lib/fuzzy-matcher.js";
import pricing from "../lib/zona-precios.js";
import { 
  logger,
  AppError,
  ValidationError,
  RateLimitError,
  validatePhone,
  sanitizeInput,
  RateLimiter,
  MetricsCollector,
  sendSuccess,
  sendError,
  sendReply,
  formatMoney as utilFormatMoney,
  parseJSON
} from "../lib/utils.js";
import { CONFIG } from "../lib/config.js";

const { detectIntention, validateOrder, INTENTIONS, generateSmartResponse } = aiEngineModule;
const ConversationContext = aiEngineModule.ConversationContext;
const { smartOCRAnalysis } = smartOcrModule;
const UserProfile = userProfileModule.UserProfile;
const { 
  generateHumanizedResponse, 
  getDayTimeGreeting, 
  detectSpecialOccasion,
  generateContextAwareResponse,
  generateTypoCorrectionResponse,
  generateProximityResponse,
  generateNotUnderstoodResponse
} = ultraHumanizer;
const { 
  calculateDeliveryFromLocation, 
  validateDeliveryHours, 
  geocodeAddressSimple,
  isCustomerVeryClose,
  getProximityZone
} = smartDelivery;
const detectAddress = detectAddressModule.isAddress;
const { sendOrderToAgent, formatOrderForAgent } = kommoSender;
const { smartProcess, generateContextAwareResponse: neoResponse } = smartInterpreter;
import fs from "fs";

// Lazy load menu and synonyms (don't load during module init in serverless)
let menu = null;
let synonyms = null;

const loadMenuData = () => {
  if (!menu) {
    try {
      const menuPath = new URL("../data/menu.json", import.meta.url);
      menu = JSON.parse(fs.readFileSync(menuPath, "utf8"));
      logger.debug('Menu loaded', { itemsCount: menu?.categorias?.length || 0 });
    } catch (error) {
      logger.warn('Failed to load menu', { error: error.message });
      menu = { categorias: [] };
    }
  }
  
  if (!synonyms) {
    try {
      const synonymsPath = new URL("../data/sinonimos.json", import.meta.url);
      synonyms = JSON.parse(fs.readFileSync(synonymsPath, "utf8"));
      logger.debug('Synonyms loaded', { count: Object.keys(synonyms || {}).length });
    } catch (error) {
      logger.warn('Failed to load synonyms', { error: error.message });
      synonyms = {};
    }
  }
  
  return { menu, synonyms };
};

/* ---------- RATE LIMITING & METRICS ---------- */
const rateLimiter = new RateLimiter(CONFIG.RATE_LIMIT_MAX_REQUESTS || 60, 60 * 1000);
const metrics = new MetricsCollector();

// Cleanup interval for rate limiter - DISABLED in serverless
// setInterval(() => {
//   rateLimiter.cleanup();
//   logger.debug('RATE_LIMITER_CLEANUP');
// }, 5 * 60 * 1000);

/* ---------- ENVIRONMENT VALIDATION ---------- */
const validateEnvironment = () => {
  const requiredVars = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    logger.warn('MISSING_ENV_VARS', { missing });
    // Don't throw in production - allow endpoint to work with limited functionality
    return false;
  }
  
  logger.info('ENV_VALIDATED', { 
    env: CONFIG.ENV, 
    firebase: !!CONFIG.FIREBASE_PROJECT_ID,
    ocr: !!CONFIG.OCR_API_KEY,
    ia: CONFIG.IA_ENABLED
  });
  return true;
};

// Validate environment on startup
let envValid = false;
try {
  envValid = validateEnvironment();
} catch (error) {
  logger.error('Environment validation failed:', error);
}

/* ---------- FIREBASE INIT ---------- */
let firebaseInitialized = false;
if (!admin.apps.length && CONFIG.FIREBASE_PROJECT_ID && envValid) {
  try {
    logger.info('Initializing Firebase with credentials...', {
      projectId: CONFIG.FIREBASE_PROJECT_ID,
      clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL?.substring(0, 20) + '...',
      hasPrivateKey: !!CONFIG.FIREBASE_PRIVATE_KEY
    });
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: CONFIG.FIREBASE_PROJECT_ID,
        clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
        privateKey: CONFIG.FIREBASE_PRIVATE_KEY,
      }),
    });
    
    firebaseInitialized = true;
    logger.info('Firebase initialized successfully');
    metrics.record('firebase_init', 1, { status: 'success' });
  } catch (err) {
    logger.error('Firebase init failed, falling back to in-memory sessions:', {
      error: err?.message || String(err),
      stack: err?.stack
    });
    metrics.record('firebase_init', 1, { status: 'failed', error: err?.message });
    // Continue without Firebase - will use in-memory sessions
  }
} else {
  logger.info('Firebase not initialized', {
    hasApps: admin.apps.length > 0,
    hasProjectId: !!CONFIG.FIREBASE_PROJECT_ID,
    envValid
  });
}

// Session store compatibility wrappers
sessionStore.saveAddressForPhone = sessionStore.saveAddressForPhone || (async (phone, address, components) => {
  const data = { address: { address, components } };
  await sessionStore.saveSession(phone, data);
  return data;
});

sessionStore.saveOrderDraft = sessionStore.saveOrderDraft || (async (phone, draft) => {
  const data = { pedido_borrador: draft, estado: "pedido_borrador" };
  await sessionStore.saveSession(phone, data);
  return data;
});

/* ---------- AI Context Management ---------- */

/**
 * Cargar o crear contexto conversacional del usuario
 * @param {string} telefono - Número de teléfono del usuario
 * @param {string} nombre - Nombre del usuario
 * @returns {Promise<ConversationContext>} Contexto conversacional
 */
const getOrCreateContext = async (telefono, nombre) => {
  try {
    const session = await sessionStore.getSession(telefono);
    let context = session?.context;
    
    if (!context) {
      context = new ConversationContext({ userId: telefono, name: nombre });
      logger.debug('Created new conversation context', { telefono, nombre });
    } else {
      // Restaurar contexto desde sesión
      context = Object.assign(new ConversationContext({ userId: telefono, name: nombre }), context);
      logger.debug('Restored conversation context', { telefono, messagesCount: context.recentMessages?.length || 0 });
    }
    
    return context;
  } catch (error) {
    logger.error('Error in getOrCreateContext:', { telefono, error: error.message });
    throw new AppError('Failed to load conversation context', 500, 'CONTEXT_LOAD_ERROR');
  }
};

/**
 * Cargar o crear perfil del usuario
 * @param {string} telefono - Número de teléfono del usuario
 * @param {string} nombre - Nombre del usuario
 * @returns {Promise<UserProfile>} Perfil del usuario
 */
const getOrCreateUserProfile = async (telefono, nombre) => {
  try {
    const session = await sessionStore.getSession(telefono);
    let profileData = session?.userProfile;
    
    let profile = new UserProfile(telefono, { name: nombre });
    
    if (profileData) {
      // Restaurar perfil desde sesión
      profile.orders = profileData.orders || [];
      profile.preferences = profileData.preferences || {};
      profile.stats = profileData.stats || {};
      if (profileData.name) profile.name = profileData.name;
      logger.debug('Restored user profile', { telefono, ordersCount: profile.orders.length, isVIP: profile.isVIP() });
    } else {
      logger.debug('Created new user profile', { telefono, nombre });
    }
    
    return profile;
  } catch (error) {
    logger.error('Error in getOrCreateUserProfile:', { telefono, error: error.message });
    throw new AppError('Failed to load user profile', 500, 'PROFILE_LOAD_ERROR');
  }
};

/**
 * Guardar contexto en sesión
 * @param {string} telefono - Número de teléfono del usuario
 * @param {ConversationContext} context - Contexto conversacional
 * @param {UserProfile} profile - Perfil del usuario
 * @returns {Promise<void>}
 */
const saveContextToSession = async (telefono, context, profile) => {
  try {
    const session = await sessionStore.getSession(telefono) || {};
    session.context = {
      userId: context.userId,
      userName: context.userName,
      recentMessages: context.recentMessages,
      currentIntention: context.currentIntention,
      previousIntentions: context.previousIntentions,
      preferences: context.preferences,
    };
    session.userProfile = {
      name: profile.name,
      phone: profile.phone,
      orders: profile.orders,
      preferences: profile.preferences,
      stats: profile.stats,
    };
    await sessionStore.saveSession(telefono, session);
    logger.debug('Saved context to session', { telefono, contextSize: context.recentMessages?.length || 0 });
  } catch (error) {
    logger.error('Error saving context to session:', { telefono, error: error.message });
    throw new AppError('Failed to save session', 500, 'SESSION_SAVE_ERROR');
  }
};

/* ---------- Internal Helpers ---------- */

/**
 * Format money value with currency symbol
 * @param {number|null} v - Value to format
 * @returns {string} Formatted money string
 */
const formatMoney = (v) => (v == null ? "—" : `S/${Number(v).toFixed(2)}`);

/**
 * Build order summary text for display
 * @param {Object} orderDraft - Order draft with items
 * @param {Object} pricingResult - Pricing calculation result
 * @returns {string} Formatted order summary
 */
const buildOrderSummaryText = (orderDraft, pricingResult) => {
  const lines = ["🧾 Resumen del pedido:"];
  for (const it of orderDraft.items) {
    const qty = it.quantity || 1;
    const name = it.name || it.id;
    const variant = it.variant ? ` (${it.variant})` : "";
    const unit = it.unitPrice != null ? formatMoney(it.unitPrice) : "precio a confirmar";
    const lineTotal = it.price != null ? formatMoney(it.price) : "—";
    lines.push(`• ${qty} x ${name}${variant} — ${unit} — ${lineTotal}`);
  }
  lines.push("");
  lines.push(`Subtotal: ${formatMoney(pricingResult.subtotal)}`);
  if (pricingResult.discounts && pricingResult.discounts > 0) lines.push(`Descuentos: -${formatMoney(pricingResult.discounts)}`);
  if (pricingResult.tax && pricingResult.tax > 0) lines.push(`Impuestos: ${formatMoney(pricingResult.tax)}`);
  if (pricingResult.deliveryFee && pricingResult.deliveryFee > 0) lines.push(`Delivery: ${formatMoney(pricingResult.deliveryFee)}`);
  lines.push(`Total a cobrar: *${formatMoney(pricingResult.total)}*`);
  return lines.join("\n");
};

/**
 * Safe JSON parsing with fallback - uses parseJSON from utils.js
 * @deprecated Use parseJSON from utils.js directly
 * @param {string} s - JSON string to parse
 * @param {*} fallback - Fallback value if parsing fails
 * @returns {*} Parsed object or fallback
 */
const safeParseJSON = (s, fallback = null) => parseJSON(s, fallback);

/**
 * Notify external agent via webhook
 * @param {Object} payload - Notification payload
 * @returns {Promise<void>}
 */
const notifyAgent = async (payload) => {
  const url = CONFIG.AGENT_WEBHOOK;
  if (!url) {
    logger.debug('Agent webhook not configured, skipping notification');
    return;
  }
  try {
    const startTime = Date.now();
    await axios.post(url, payload, { 
      headers: { "Content-Type": "application/json" },
      timeout: CONFIG.API_TIMEOUT_MS
    });
    const duration = Date.now() - startTime;
    logger.info('Agent notified successfully', { event: payload.event, duration });
    metrics.record('agent_notification', 1, { event: payload.event, status: 'success' });
  } catch (err) {
    logger.error('Agent notification failed:', { event: payload.event, error: err?.message || err });
    metrics.record('agent_notification', 1, { event: payload.event, status: 'failed' });
  }
};

/**
 * Audit trail logger for critical operations
 * @param {string} operation - Operation name
 * @param {string} telefono - User phone
 * @param {Object} data - Operation data
 */
const auditLog = (operation, telefono, data = {}) => {
  logger.info('[AUDIT]', {
    operation,
    telefono,
    timestamp: new Date().toISOString(),
    ...data
  });
  metrics.record('audit_trail', 1, { operation });
};

/* ---------- Order State & Transitions ---------- */
/*
  Main states:
  - inicio
  - pedido_borrador
  - direccion
  - pedido_confirmado (total calculado)
  - pago_verificacion (comprobante recibido)
  - pagado
  - preparacion
  - en_reparto
  - entregado
  - cancelado
*/

/* ---------- Delivery & Total Calculation Utilities ---------- */

/**
 * Calculate delivery fee and total for an order
 * @param {Array} items - Order items
 * @param {Object} addressComponents - Address components with zone info
 * @param {Object} options - Calculation options (taxRate, delivery)
 * @returns {Object} Breakdown with subtotal, discounts, delivery, tax, total
 */
const calculateDeliveryAndTotal = (items, addressComponents = {}, options = {}) => {
  try {
    const { menu: menuData } = loadMenuData(); // Load menu data here
    const rules = menuData?.reglas || [];
    const calc = pricing.calculateOrderTotal(
      items, 
      menuData, 
      rules, 
      { 
        taxRate: options.taxRate || 0, 
        rounding: 0.01, 
        delivery: options.delivery || null 
      }
    );
    
    logger.debug('Calculated delivery and total', {
      itemsCount: items.length,
      subtotal: calc.subtotal,
      total: calc.total,
      zone: calc.zone
    });
    
    return {
      breakdown: {
        subtotal: calc.subtotal,
        discounts: calc.discounts,
        delivery: calc.deliveryFee,
        tax: calc.tax
      },
      total: calc.total,
      details: calc.itemsDetailed,
      appliedRules: calc.appliedRules,
      zone: calc.zone || null
    };
  } catch (error) {
    logger.error('Error calculating delivery and total:', error);
    throw new AppError('Failed to calculate order total', 500, 'CALCULATION_ERROR');
  }
};

/**
 * Calculate route distance and delivery fee
 * @param {Object} storeCoords - Store coordinates {lat, lon}
 * @param {Object} destCoords - Destination coordinates {lat, lon}
 * @param {Object} options - Calculation options (base, perKm)
 * @returns {Object} Route info with distanceKm and price
 */
const calculateRouteAndFee = (storeCoords, destCoords, options = {}) => {
  try {
    if (typeof pricing.calculateRoutePrice === "function") {
      const result = pricing.calculateRoutePrice(storeCoords, destCoords, options);
      logger.debug('Calculated route using pricing module', result);
      return result;
    }
  } catch (err) {
    logger.warn('pricing.calculateRoutePrice failed, using fallback:', err?.message || err);
  }

  // fallback: haversine
  const R = 6371;
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(destCoords.lat - storeCoords.lat);
  const dLon = toRad(destCoords.lon - storeCoords.lon);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(storeCoords.lat))*Math.cos(toRad(destCoords.lat))*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const km = R * c;
  const base = Number(options.base ?? CONFIG.DELIVERY_BASE_FEE);
  const perKm = Number(options.perKm ?? CONFIG.DELIVERY_PER_KM);
  const price = Math.max(base, Math.round((base + perKm * km) * 100) / 100);
  
  logger.debug('Calculated route using haversine', { distanceKm: km.toFixed(2), price });
  
  return { distanceKm: Number(km.toFixed(2)), price };
};

/* ---------- Input Validation ---------- */

/**
 * Validate incoming request body
 * @param {Object} body - Request body
 * @returns {Object} Validated and sanitized data
 * @throws {ValidationError} If validation fails
 */
const validateRequestBody = (body) => {
  const errors = [];
  
  // Validate telefono (required)
  if (!body.telefono) {
    errors.push({ field: 'telefono', message: 'Phone number is required' });
  } else {
    try {
      validatePhone(body.telefono);
    } catch (err) {
      errors.push({ field: 'telefono', message: err.message });
    }
  }
  
  // Validate tipo
  const validTipos = ['text', 'image', 'image_buffer', 'location'];
  const tipo = body.tipo || 'text';
  if (!validTipos.includes(tipo)) {
    errors.push({ field: 'tipo', message: `Type must be one of: ${validTipos.join(', ')}` });
  }
  
  // Validate mensaje
  let mensaje = '';
  if (body.mensaje) {
    // Ensure mensaje is string
    if (typeof body.mensaje !== 'string') {
      errors.push({ field: 'mensaje', message: 'Message must be a string' });
    } else {
      mensaje = sanitizeInput(body.mensaje.toString(), 2000);
      // Check if ONLY whitespace (más de 500 caracteres) o vacío
      if (mensaje.trim().length === 0 && tipo === 'text') {
        errors.push({ field: 'mensaje', message: 'Message cannot be empty or only whitespace for text type' });
      }
      // Check length límite
      if (mensaje.length > 2000) {
        errors.push({ field: 'mensaje', message: 'Message cannot exceed 2000 characters' });
      }
    }
  } else if (tipo === 'text') {
    // mensaje is required for text type
    errors.push({ field: 'mensaje', message: 'Message is required for text type' });
  }
  
  // Validate imagen URL if provided
  if (tipo === 'image' && body.imagen) {
    try {
      new URL(body.imagen);
    } catch {
      errors.push({ field: 'imagen', message: 'Invalid image URL' });
    }
  }
  
  // Validate imageBase64 if provided
  if (tipo === 'image_buffer' && body.imageBase64) {
    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length === 0) {
      errors.push({ field: 'imageBase64', message: 'Invalid base64 image data' });
    }
  }
  
  // Validate ubicacion if provided
  if (body.ubicacion) {
    // Si es string (como coordenadas separadas por coma)
    if (typeof body.ubicacion === 'string') {
      const coords = body.ubicacion.split(',').map(c => parseFloat(c.trim()));
      if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
        const [lat, lon] = coords;
        // Validar ranges razonables (aunque sean números locos)
        if (lat < -90 || lat > 90) {
          // No es un error - simplemente no es una lat válida, pero lo aceptamos
          logger.warn('Location latitude out of range but accepted', { lat, lon });
        }
        if (lon < -180 || lon > 180) {
          logger.warn('Location longitude out of range but accepted', { lat, lon });
        }
        // No rechazar - el usuario puede enviar lo que quiera
      }
    }
    // Si es objeto
    else if (typeof body.ubicacion === 'object' && body.ubicacion !== null) {
      const lat = parseFloat(body.ubicacion.lat);
      const lon = parseFloat(body.ubicacion.lon);
      // Igual, aceptar aunque sean números locos
      if (!isNaN(lat) && !isNaN(lon)) {
        logger.debug('Location received with coordinates', { lat, lon });
      }
    }
  }
  
  if (errors.length > 0) {
    throw new ValidationError('Request validation failed', { errors });
  }
  
  return {
    telefono: body.telefono,
    nombre: sanitizeInput(body.nombre || 'Cliente', 100),
    mensaje,
    tipo,
    imagen: body.imagen || null,
    imageBase64: body.imageBase64 || null,
    ubicacion: body.ubicacion || null,
    debug: !!body.debug
  };
};

/**
 * Add security headers to response
 * @param {Object} res - Express response object
 */
const addSecurityHeaders = (res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (CONFIG.ENABLE_CORS) {
    res.setHeader('Access-Control-Allow-Origin', CONFIG.CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
};

/* ---------- Core handler ---------- */

/**
 * Main Kommo API handler with comprehensive error handling, validation, and metrics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Response with reply or error
 */
export default async function handler(req, res) {
  const startTime = Date.now();
  const getDebugMode = () => {
    try {
      const url = new URL(req.url, `https://${req.headers?.host || 'localhost'}`);
      const queryDebug = url.searchParams.get('debug');
      const headerDebug = req.headers?.['x-debug'] || req.headers?.['x-debug-mode'];
      return queryDebug === 'true' || queryDebug === '1' || headerDebug === '1' || headerDebug === 'true';
    } catch {
      return false;
    }
  };
  
  // Add security headers
  addSecurityHeaders(res);
  
  // Handle OPTIONS for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle GET - Health check
  if (req.method === "GET") {
    metrics.record('api_request', 1, { method: 'GET', endpoint: 'health' });
    return sendSuccess(res, { 
      service: "KOMMO IA", 
      status: "running", 
      version: "2.0-ultra-inteligente",
      features: ["ai-engine", "smart-ocr", "user-profiles", "semantic-analysis", "context-awareness", "rate-limiting", "metrics"],
      env: { 
        firebase: !!CONFIG.FIREBASE_PROJECT_ID,
        aiEngine: CONFIG.FEATURE_AI_ENGINE,
        smartOcr: CONFIG.FEATURE_SMART_OCR
      }
    });
  }
  
  // Only POST allowed beyond this point
  if (req.method !== "POST") {
    metrics.record('api_request', 1, { method: req.method, status: 'method_not_allowed' });
    return sendError(res, new AppError('Method Not Allowed', 405, 'METHOD_NOT_ALLOWED'));
  }

  let telefono;
  let debugMode = false;
  try {
    logger.info('KOMMO_REQUEST_START', { method: req.method, hasBody: !!req.body });
    
    // Load menu data if not already loaded
    try {
      const menuData = loadMenuData();
      logger.info('Menu data loaded', { 
        hasMenu: !!menuData.menu, 
        hasSynonyms: !!menuData.synonyms,
        categoriesCount: menuData.menu?.categorias?.length || 0 
      });
    } catch (menuError) {
      logger.error('Failed to load menu data', { error: menuError.message, stack: menuError.stack });
      throw new AppError('Failed to initialize menu data', 500, 'MENU_LOAD_ERROR');
    }
    
    // Check for debug mode
    debugMode = getDebugMode() || !!req.body?.debug;
    
    // Validate request body
    let validatedData;
    try {
      validatedData = validateRequestBody(req.body);
      telefono = validatedData.telefono;
      logger.debug('Request validated', { telefono, tipo: validatedData.tipo });
    } catch (validationError) {
      logger.error('Validation failed', { error: validationError.message });
      throw validationError;
    }
    
    const { nombre, mensaje, tipo, imagen, imageBase64, ubicacion, debug } = validatedData;
    
    metrics.record('api_request', 1, { method: 'POST', tipo });
    
    // Check rate limit
    try {
      const rateLimitInfo = rateLimiter.checkLimit(telefono);
      logger.debug('Rate limit check passed', { telefono, remaining: rateLimitInfo.remaining });
      res.setHeader('X-RateLimit-Limit', rateLimitInfo.limit);
      res.setHeader('X-RateLimit-Remaining', rateLimitInfo.remaining);
      res.setHeader('X-RateLimit-Reset', rateLimitInfo.resetAt.toISOString());
    } catch (error) {
      if (error instanceof RateLimitError) {
        logger.warn('Rate limit exceeded', { telefono });
        metrics.record('rate_limit_exceeded', 1, { telefono });
        res.setHeader('Retry-After', error.retryAfter);
        return sendError(res, error);
      }
      throw error;
    }
    
    logger.info('Incoming message', { 
      telefono, 
      tipo, 
      messageLength: mensaje.length,
      hasImage: !!imagen || !!imageBase64,
      hasLocation: !!ubicacion
    });

    // Load session with timeout
    let session;
    try {
      logger.info('Loading session', { telefono });
      session = await sessionStore.getSession(telefono);
      logger.info('Session loaded', { telefono, hasSession: !!session });
    } catch (sessionError) {
      logger.error('Session load failed', { telefono, error: sessionError.message });
      // Continue without session
      session = null;
    }
    
    // Load AI context y user profile
    logger.info('Loading AI context', { telefono, nombre });
    let context;
    try {
      context = await getOrCreateContext(telefono, nombre);
      logger.info('Context loaded', { telefono, messagesCount: context.recentMessages?.length || 0 });
    } catch (contextError) {
      logger.error('Context load failed', { telefono, error: contextError.message, stack: contextError.stack });
      throw new AppError('Failed to load context', 500, 'CONTEXT_ERROR');
    }
    
    logger.info('Loading user profile', { telefono, nombre });
    let userProfile;
    try {
      userProfile = await getOrCreateUserProfile(telefono, nombre);
      logger.info('Profile loaded', { telefono, ordersCount: userProfile.orders?.length || 0 });
    } catch (profileError) {
      logger.error('Profile load failed', { telefono, error: profileError.message, stack: profileError.stack });
      throw new AppError('Failed to load profile', 500, 'PROFILE_ERROR');
    }

    /**
     * Helper to persist and return reply
     * @param {Object} newSessionData - Session data to save
     * @param {Object} replyObj - Reply object to send
     * @returns {Promise<Object>} Response
     */
    const persistAndReply = async (newSessionData, replyObj) => {
      try {
        // Guardar contexto y perfil actualizado
        await saveContextToSession(telefono, context, userProfile);
        // Guardar sesión con datos adicionales
        newSessionData = newSessionData || {};
        newSessionData.context = context;
        newSessionData.userProfile = { 
          name: userProfile.name, 
          orders: userProfile.orders, 
          preferences: userProfile.preferences, 
          stats: userProfile.stats 
        };
        await sessionStore.saveSession(telefono, newSessionData);
        
        const duration = Date.now() - startTime;
        metrics.record('response_time', duration, { tipo });
        
        logger.info('Request completed', { telefono, tipo, duration, replyLength: replyObj.reply?.length || 0 });
        
        return sendReply(res, replyObj.reply, { ...replyObj, ok: true });
      } catch (error) {
        logger.error('Error in persistAndReply:', { telefono, error: error.message });
        throw error;
      }
    };

    /* ---------- IMAGE (URL) - Smart OCR ---------- */
    if (tipo === "image" && imagen) {
      try {
        metrics.record('image_processing', 1, { source: 'url' });
        logger.debug('Processing image from URL', { telefono, imageUrl: imagen });
        
        const ocrResult = await readImage(imagen, { debug });
        const smartAnalysis = await smartOCRAnalysis(ocrResult, { userProfile, menu, debug });
        
        logger.info('Smart OCR analysis completed', { 
          telefono,
          imageType: smartAnalysis.imageType, 
          confidence: smartAnalysis.confidence 
        });
        metrics.record('ocr_analysis', 1, { imageType: smartAnalysis.imageType });
        
        // Actualizar contexto
        context.addMessage("user", "[imagen]", { type: smartAnalysis.imageType });
        context.currentIntention = "PAYMENT"; // Por defecto, imágenes son comprobantes
        
        if (smartAnalysis.imageType === "RECEIPT" || smartAnalysis.imageType === "SCREENSHOT") {
          const detected = smartAnalysis.data?.amount;
          if (!detected) {
            logger.warn('No amount detected in receipt image', { telefono });
            metrics.record('ocr_no_amount', 1);
            const reply = generateSmartResponse("help_image_quality", context);
            return persistAndReply({ estado: "pago_verificacion" }, { reply });
          }
          
          const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
          const draft = pedido || pedido_borrador || null;

          if (draft?.items?.length) {
            const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
            const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01 });
            const validation = validateReceiptAgainstOrder(ocrResult, { items: draft.items, expectedTotal: calc.total }, menu, { tolerance: Number(CONFIG.PAYMENT_TOLERANCE), debug });

            if (validation.ok) {
              // Actualizar perfil con orden pagada
              userProfile.addOrder({
                items: draft.items,
                total: validation.detectedTotal,
                date: new Date(),
                method: "receipt",
                verified: true
              });
              
              // Audit log
              auditLog('payment_confirmed', telefono, {
                amount: validation.detectedTotal,
                items: draft.items.length,
                method: 'receipt_ocr'
              });
              
              metrics.record('payment_confirmed', 1, { method: 'receipt' });
              metrics.record('order_value', validation.detectedTotal);
              
              context.currentIntention = "ORDER_REPEAT";
              const reply = generateSmartResponse("payment_confirmed", context, { amount: validation.detectedTotal });
              
              await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "comprobante", amount: validation.detectedTotal, ocr: ocrResult } });
              await notifyAgent({ event: "order_paid", telefono, pedido: draft, amount: validation.detectedTotal });
              
              logger.info('Payment confirmed via OCR', { telefono, amount: validation.detectedTotal });
              return persistAndReply({}, { reply });
            } else {
              logger.warn('Payment validation failed', { 
                telefono, 
                detected: detected, 
                expected: calc.total,
                difference: Math.abs(detected - calc.total)
              });
              metrics.record('payment_mismatch', 1);
              const reply = generateSmartResponse("payment_mismatch", context, { detected: detected, expected: calc.total });
              return persistAndReply({ estado: "pago_verificacion", comprobante: { detected: detected, ocr: ocrResult, validation } }, { reply });
            }
          } else {
            logger.warn('Receipt received but no order found', { telefono, amount: detected });
            metrics.record('receipt_no_order', 1);
            const reply = generateSmartResponse("receipt_no_order", context, { amount: detected });
            return persistAndReply({ estado: "pago_verificacion", comprobante: { detected: detected, ocr: ocrResult } }, { reply });
          }
        } else if (smartAnalysis.imageType === "MENU" || smartAnalysis.imageType === "CATALOG_ITEM") {
          const extractedItems = smartAnalysis.data?.items || [];
          logger.info('Menu/catalog detected in image', { telefono, itemsCount: extractedItems.length });
          metrics.record('image_menu_detected', 1);
          
          if (extractedItems.length > 0) {
            const reply = `📸 Detecté un ${smartAnalysis.imageType === "MENU" ? "menú" : "producto"} en la imagen.\n` +
                         extractedItems.slice(0, 3).map(it => `• ${it.name} - ${it.price ? `S/${it.price}` : "precio no especificado"}`).join("\n") +
                         "\n¿Quieres agregar alguno al pedido?";
            return persistAndReply({}, { reply });
          }
        }
        
        // Fallback
        logger.debug('Image processed with fallback handler', { telefono });
        const detected = extractMostLikelyTotal(ocrResult);
        await sessionStore.saveSession(telefono, { lastOCR: ocrResult, estado: "pago_verificacion" });
        const reply = generateSmartResponse("image_received", context, { amount: detected });
        return persistAndReply({}, { reply });
        
      } catch (err) {
        logger.error('OCR image error:', { telefono, error: err?.message || err, stack: err?.stack });
        metrics.record('ocr_error', 1, { source: 'url' });
        const reply = generateSmartResponse("help_image_quality", context);
        return persistAndReply({}, { reply });
      }
    }

    /* ---------- IMAGE BUFFER (base64) ---------- */
    if (tipo === "image_buffer" && imageBase64) {
      try {
        metrics.record('image_processing', 1, { source: 'buffer' });
        logger.debug('Processing image from base64 buffer', { telefono });
        
        const buffer = Buffer.from(imageBase64, "base64");
        const ocrResult = await readImageBuffer(buffer, "upload.jpg", { debug });
        const detected = extractMostLikelyTotal(ocrResult);
        await sessionStore.saveSession(telefono, { lastOCR: ocrResult, estado: "pago_verificacion" });
        
        if (!detected) {
          logger.warn('No amount detected in buffer image', { telefono });
          metrics.record('ocr_no_amount', 1);
          return persistAndReply({}, { reply: "📸 Imagen recibida, pero no pude leer el monto. ¿Puedes enviarla más clara?" });
        }
        
        logger.info('Amount detected in buffer image', { telefono, detected });
        metrics.record('ocr_analysis', 1, { imageType: 'buffer' });
        return persistAndReply({}, { reply: `✅ Comprobante detectado por ${formatMoney(detected)}. ¿Deseas que lo valide con tu pedido?` });
      } catch (err) {
        logger.error('OCR buffer error:', { telefono, error: err?.message || err });
        metrics.record('ocr_error', 1, { source: 'buffer' });
        return persistAndReply({}, { reply: "📸 No pude procesar la imagen. Intenta enviar una foto más clara o escribe el monto manualmente." });
      }
    }

    /* ---------- LOCATION (lat/lon) ---------- */
    if (tipo === "location" && ubicacion?.lat && ubicacion?.lon) {
      try {
        metrics.record('location_received', 1);
        logger.info('Processing location', { telefono, lat: ubicacion.lat, lon: ubicacion.lon });
        
        const storeCoords = { lat: CONFIG.STORE_LAT, lon: CONFIG.STORE_LON };
        const destCoords = { lat: Number(ubicacion.lat), lon: Number(ubicacion.lon) };
        const route = calculateRouteAndFee(storeCoords, destCoords, { 
          base: CONFIG.DELIVERY_BASE_FEE, 
          perKm: CONFIG.DELIVERY_PER_KM 
        });
        const address = `Coordenadas ${destCoords.lat}, ${destCoords.lon}`;
        const components = { lat: destCoords.lat, lon: destCoords.lon };

        await sessionStore.saveSession(telefono, { estado: "direccion", address: { address, components }, delivery: route.price });

        const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
        const draft = pedido || pedido_borrador || null;

        if (draft?.items?.length) {
          const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
          const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01, delivery: { base: route.price } });
          await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: draft.items, pricing: calc }, address: { address, components } });
          
          logger.info('Order confirmed with location', { telefono, total: calc.total, deliveryFee: route.price });
          metrics.record('order_confirmed', 1);
          
          return persistAndReply({}, { reply: `📍 Delivery calculado: ${formatMoney(route.price)} (distancia ${route.distanceKm} km).\nTotal a cobrar: ${formatMoney(calc.total)}. ¿Deseas confirmar el pedido y pagar ahora?` });
        }
        
        logger.debug('Location saved without order', { telefono, deliveryFee: route.price });
        return persistAndReply({}, { reply: `📍 Delivery estimado: ${formatMoney(route.price)} (distancia ${route.distanceKm} km). ¿Deseas que calcule el total si me envías tu pedido?` });
      } catch (err) {
        logger.error('Location handling error:', { telefono, error: err?.message || err });
        metrics.record('location_error', 1);
        return persistAndReply({}, { reply: "No pude calcular la ruta. ¿Puedes enviar la dirección en texto?" });
      }
    }

    /* ---------- TEXT: Intelligent Processing with AI Engine ---------- */
    
    // Agregar mensaje al contexto
    context.addMessage("user", mensaje);
    
    // Detectar intención con el motor de IA
    const intentionResult = detectIntention(mensaje, context);
    let intention = intentionResult.intention;
    const helpHint = /(menu|menú|carta|precio|cuánto cuesta|cuanto cuesta|promoc|promo|catálogo|catalogo|lista)/i;
    const orderHint = /(quiero|pedido|orden|ordenar|dame|env[ií]a|manda|trae|ponme)/i;
    if (orderHint.test(mensaje)) intention = INTENTIONS.ORDER_NEW;
    else if (helpHint.test(mensaje) && intention !== INTENTIONS.ORDER_NEW && intention !== INTENTIONS.ORDER_REPEAT) {
      intention = INTENTIONS.HELP;
    }
    context.currentIntention = intention;
    
    if (debugMode) {
      res.setHeader('X-Detected-Intention', intention || 'none');
      res.setHeader('X-Intent-Order-New', INTENTIONS?.ORDER_NEW || 'none');
    }
    logger.info('Detected intention', { 
      telefono,
      intention, 
      confidence: intentionResult.confidence, 
      userId: context.userId 
    });
    metrics.record('intention_detected', 1, { intention });

    // Manejar diferentes intenciones
    if (intention === INTENTIONS.GREETING || intention === INTENTIONS.SMALLTALK) {
      metrics.record('interaction', 1, { type: 'greeting' });
      const reply = generateSmartResponse("greeting", context);
      return persistAndReply({}, { reply });
    }

    if (intention === INTENTIONS.HELP) {
      if (debugMode) {
        res.setHeader('X-Help-Block', '1');
      }
      metrics.record('interaction', 1, { type: 'help' });
      const topCats = (menu.categorias || []).slice(0, 4).map(c => `• ${c.nombre} (${(c.productos||[]).length} items)`).join("\n");
      const reply = generateSmartResponse("menu_available", context, { categories: topCats });
      return persistAndReply({}, { reply });
    }

    // Detectar dirección en el mensaje
    const addrDetection = detectAddress(mensaje);
    logger.debug('Address detection result', { 
      hasResult: !!addrDetection, 
      isAddress: addrDetection?.isAddress,
      hasAddress: !!addrDetection?.address,
      address: addrDetection?.address?.substring(0, 30)
    });
    
    if (addrDetection && addrDetection.isAddress && addrDetection.address) {
      // Si detectamos dirección, procesarla independiente de la intención
      context.currentIntention = INTENTIONS.HELP;
      metrics.record('address_detected', 1);
      logger.info('Address detected in message', { telefono, address: addrDetection.address });
      
      // Geocodificar dirección y calcular delivery usando calculateRoute
      let deliveryFee = 0;
      let distanceKm = 0;
      let routeInfo = null;
      
      try {
        const storeAddress = `${CONFIG.STORE_LAT},${CONFIG.STORE_LON}`;
        logger.debug('Calculating route for address', { from: storeAddress, to: addrDetection.address });
        
        const routeResult = await calculateRoute(
          { lat: CONFIG.STORE_LAT, lon: CONFIG.STORE_LON },
          addrDetection.address
        );
        
        if (routeResult.ok) {
          deliveryFee = routeResult.price || 0;
          distanceKm = routeResult.distance_km || 0;
          routeInfo = {
            distance_km: distanceKm,
            duration_min: routeResult.duration_min,
            provider: routeResult.provider
          };
          
          // Actualizar componentes con coordenadas geocodificadas
          if (routeResult.destination_coords) {
            addrDetection.components = {
              ...addrDetection.components,
              lat: routeResult.destination_coords.lat,
              lon: routeResult.destination_coords.lon
            };
          }
          
          logger.info('Route calculated successfully', { 
            telefono, 
            deliveryFee, 
            distanceKm,
            provider: routeResult.provider 
          });
        } else {
          logger.warn('Route calculation failed, using default delivery fee', { 
            telefono, 
            error: routeResult.error 
          });
          deliveryFee = CONFIG.DELIVERY_BASE_FEE || 5;
        }
      } catch (routeError) {
        logger.error('Route calculation error', { 
          telefono, 
          error: routeError.message 
        });
        deliveryFee = CONFIG.DELIVERY_BASE_FEE || 5;
      }
      
      await sessionStore.saveAddressForPhone(telefono, addrDetection.address, addrDetection.components);

      const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
      const draft = pedido || pedido_borrador || null;

      if (draft?.items?.length) {
        const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
        const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { 
          taxRate: 0, 
          rounding: 0.01, 
          delivery: { base: deliveryFee, addressComponents: addrDetection.components } 
        });
        
        await sessionStore.saveSession(telefono, { 
          estado: "pedido_confirmado", 
          pedido: { items: draft.items, pricing: calc }, 
          address: { address: addrDetection.address, components: addrDetection.components },
          route: routeInfo
        });
        
        logger.info('Order confirmed with address and delivery', { 
          telefono, 
          total: calc.total, 
          deliveryFee,
          itemsCount: draft.items.length 
        });
        metrics.record('order_confirmed', 1);
        auditLog('order_confirmed', telefono, { total: calc.total, deliveryFee, itemsCount: draft.items.length });
        
        const suggestions = generateSuggestions(draft.items, userProfile, menu);
        const reply = `📍 Dirección detectada: ${addrDetection.address}\n` +
                     `🚚 Delivery: ${formatMoney(deliveryFee)}${distanceKm > 0 ? ` (${distanceKm.toFixed(1)} km)` : ''}\n` +
                     `💰 Total a cobrar: ${formatMoney(calc.total)}\n\n` +
                     `${buildOrderSummaryText(draft, calc)}\n` +
                     (suggestions.length > 0 ? `\n💡 Te sugiero: ${suggestions.slice(0, 2).map(s => s.name).join(", ")}\n` : "") +
                     `¿Confirmas y deseas pagar ahora?`;
        return persistAndReply({ estado: "pedido_confirmado" }, { reply });
      }
      
      const reply = `📍 Dirección detectada: ${addrDetection.address}\n` +
                   `🚚 Delivery estimado: ${formatMoney(deliveryFee)}${distanceKm > 0 ? ` (${distanceKm.toFixed(1)} km)` : ''}\n` +
                   `¿En qué puedo ayudarte?`;
      return persistAndReply({ 
        address: { address: addrDetection.address, components: addrDetection.components },
        delivery: deliveryFee,
        route: routeInfo
      }, { reply });
    }

    // Intentar parsear orden del mensaje
    if (intention === INTENTIONS.ORDER_NEW || intention === INTENTIONS.ORDER_REPEAT) {
      if (debugMode) {
        res.setHeader('X-Order-Block', '1');
      }
      try {
        metrics.record('interaction', 1, { type: 'order' });
        let parsed;
        
        // Si es ORDER_REPEAT y hay orden previa, usar esa
        if (intention === INTENTIONS.ORDER_REPEAT && userProfile.orders.length > 0) {
          const lastOrder = userProfile.getLastOrder();
          if (lastOrder?.items) {
            parsed = { items: lastOrder.items };
            logger.info('Using last order for repeat', { telefono, itemsCount: lastOrder.items.length });
            metrics.record('order_repeat', 1);
          }
        }
        
        // Si no, intentar parsear el mensaje
        if (!parsed) {
          parsed = parseOrderText(mensaje, menu, { synonyms, debug });
          logger.debug('Order parsed from text', { telefono, itemsCount: parsed?.items?.length || 0 });
        }

        if (parsed?.items?.length) {
          // Aplicar preferencias del usuario
          userProfile.applyPreferences(parsed.items);
          
          await sessionStore.saveOrderDraft(telefono, parsed);
          metrics.record('order_draft_created', 1, { itemsCount: parsed.items.length });

          const { address } = await sessionStore.getSession(telefono) || {};
          const itemsForCalc = parsed.items.map(it => {
            const prod = findProductInMenu(menu, it.id);
            const unitPrice = prod ? pricing.applyVariantPrice(prod, it.variant) ?? prod.precio ?? null : it.price ?? it.priceHint ?? null;
            return { id: it.id, name: it.name, quantity: it.quantity, variant: it.variant, unitPrice, extras: it.extras || [] };
          });

          // Validar orden
          const validation = validateOrder(parsed);
          if (validation.errors.length > 0) {
            logger.warn('Order validation failed', { telefono, errors: validation.errors });
            metrics.record('order_validation_failed', 1);
            const reply = generateSmartResponse("order_incomplete", context, { errors: validation.errors });
            return persistAndReply({ pedido_borrador: parsed }, { reply });
          }

          if (address?.components) {
            const calc = calculateDeliveryAndTotal(itemsForCalc, address.components, { taxRate: 0 });
            
            logger.info('Order confirmed with delivery', { telefono, total: calc.total, deliveryFee: calc.breakdown.delivery });
            metrics.record('order_confirmed', 1);
            auditLog('order_confirmed', telefono, { total: calc.total, itemsCount: itemsForCalc.length });
            
            const suggestions = generateSuggestions(itemsForCalc, userProfile, menu);
            let reply = `✅ Pedido recibido y total calculado.\n${buildOrderSummaryText({ items: itemsForCalc }, calc)}`;
            if (suggestions.length > 0) {
              reply += `\n\n💡 Para completar: ${suggestions.slice(0, 2).map(s => s.name).join(", ")}?`;
            }
            reply += `\n¿Confirmas y deseas pagar ahora?`;
            
            await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: itemsForCalc, pricing: calc }, address });
            return persistAndReply({ estado: "pedido_confirmado" }, { reply });
          } else {
            logger.debug('Order draft saved, waiting for address', { telefono, itemsCount: parsed.items.length });
            let reply = `✅ Pedido recibido: ${parsed.items.map(i => `${i.quantity}x ${i.name}`).join(", ")}.\n📍 ¿Delivery o recojo? Si es delivery, envía tu dirección o ubicación.`;
            
            const suggestions = generateSuggestions(itemsForCalc, userProfile, menu);
            if (suggestions.length > 0) {
              reply += `\n\n💡 También pedimos: ${suggestions.slice(0, 2).map(s => s.name).join(", ")}?`;
            }
            
            return persistAndReply({ pedido_borrador: parsed }, { reply });
          }
        } else {
          metrics.record('order_parse_empty', 1);
          const reply = generateSmartResponse("order_incomplete", context, { errors: ["No detecté items en tu pedido"] });
          return persistAndReply({}, { reply });
        }
      } catch (err) {
        logger.error('parseOrderText error:', { telefono, error: err?.message || err });
        metrics.record('order_parse_error', 1);
        const reply = generateSmartResponse("order_incomplete", context, { errors: [err?.message || 'No se pudo interpretar el pedido'] });
        return persistAndReply({}, { reply });
      }
    }

    // Manejo de pagos
    if (intention === INTENTIONS.PAYMENT) {
      metrics.record('interaction', 1, { type: 'payment' });
      const lower = mensaje.toLowerCase();
      const amountMatch = mensaje.match(/([0-9]+(?:[.,][0-9]{1,2})?)/);
      const amount = amountMatch ? Number(String(amountMatch[1]).replace(",", ".")) : null;

      const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
      const draft = pedido || pedido_borrador || null;

      if (draft?.items?.length) {
        const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
        const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01 });

        if (amount != null) {
          const diff = Math.abs(calc.total - amount);
          const tol = CONFIG.PAYMENT_TOLERANCE;
          if (diff <= calc.total * tol) {
            // Actualizar perfil con orden pagada
            userProfile.addOrder({
              items: draft.items,
              total: amount,
              date: new Date(),
              method: "manual",
              verified: true
            });
            
            logger.info('Payment confirmed manually', { telefono, amount, expectedTotal: calc.total });
            metrics.record('payment_confirmed', 1, { method: 'manual' });
            metrics.record('order_value', amount);
            auditLog('payment_confirmed', telefono, { amount, method: 'manual', itemsCount: draft.items.length });
            
            const reply = generateSmartResponse("payment_confirmed", context, { amount });
            await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "manual", amount } });
            await notifyAgent({ event: "order_paid_manual", telefono, amount, pedido: draft });
            
            return persistAndReply({ estado: "pagado" }, { reply });
          } else {
            logger.warn('Payment amount mismatch', { 
              telefono, 
              detected: amount, 
              expected: calc.total,
              difference: diff
            });
            metrics.record('payment_mismatch', 1);
            const reply = generateSmartResponse("payment_mismatch", context, { detected: amount, expected: calc.total });
            return persistAndReply({ estado: "pago_verificacion" }, { reply });
          }
        }
      } else {
        logger.warn('Payment attempted without order', { telefono });
        metrics.record('payment_no_order', 1);
        const reply = generateSmartResponse("no_order_found", context);
        return persistAndReply({}, { reply });
      }
    }

    // Status de pedido
    if (intention === INTENTIONS.STATUS) {
      metrics.record('interaction', 1, { type: 'status' });
      const current = await sessionStore.getSession(telefono);
      if (!current?.pedido) {
        logger.debug('Status check without order', { telefono });
        const reply = generateSmartResponse("no_order_found", context);
        return persistAndReply({}, { reply });
      }
      
      const st = current.estado || "inicio";
      logger.info('Status check', { telefono, estado: st });
      metrics.record('status_check', 1, { estado: st });
      
      const replyMap = {
        inicio: { key: "no_active_order", data: {} },
        pedido_borrador: { key: "order_draft", data: {} },
        pedido_confirmado: { key: "order_confirmed", data: { total: current.pedido.pricing?.total } },
        pagado: { key: "payment_received", data: {} },
        preparacion: { key: "order_preparing", data: {} },
        en_reparto: { key: "order_dispatched", data: { driver: current.repartidor?.nombre, phone: current.repartidor?.telefono } },
        entregado: { key: "order_delivered", data: {} },
        cancelado: { key: "order_cancelled", data: {} }
      };
      
      const replyConfig = replyMap[st] || { key: "unknown_status", data: { status: st } };
      const reply = generateSmartResponse(replyConfig.key, context, replyConfig.data);
      return persistAndReply({}, { reply });
    }

    // Cancelación
    if (intention === INTENTIONS.CANCEL) {
      metrics.record('interaction', 1, { type: 'cancel' });
      const current = await sessionStore.getSession(telefono);
      if (current?.pedido && current.estado !== "entregado" && current.estado !== "cancelado") {
        logger.info('Order cancelled', { telefono, estado: current.estado });
        metrics.record('order_cancelled', 1);
        auditLog('order_cancelled', telefono, { estado: current.estado });
        
        const reply = generateSmartResponse("order_cancelled", context);
        await sessionStore.saveSession(telefono, { estado: "cancelado", cancelado: new Date() });
        
        // Notify agent (non-blocking - errors handled internally)
        notifyAgent({ event: "order_cancelled", telefono, estado: current.estado }).catch(err => {
          logger.warn('Agent notification failed for cancellation', { telefono, error: err.message });
        });
        
        return persistAndReply({ estado: "cancelado" }, { reply });
      } else {
        logger.debug('Cancel attempted but not allowed', { telefono, estado: current?.estado });
        const reply = generateSmartResponse("cannot_cancel", context);
        return persistAndReply({}, { reply });
      }
    }

    // Queja o feedback
    if (intention === INTENTIONS.COMPLAINT || intention === INTENTIONS.FEEDBACK) {
      metrics.record('interaction', 1, { type: intention === INTENTIONS.COMPLAINT ? 'complaint' : 'feedback' });
      logger.info('User feedback received', { telefono, type: intention });
      auditLog('user_feedback', telefono, { type: intention, isVIP: userProfile.isVIP() });
      
      const reply = generateSmartResponse(intention === INTENTIONS.COMPLAINT ? "complaint_received" : "feedback_received", context);
      await notifyAgent({ event: "user_feedback", telefono, type: intention, message: mensaje, userProfile: { name: userProfile.name, vipStatus: userProfile.isVIP() } });
      return persistAndReply({}, { reply });
    }

    // Fallback amigable
    logger.debug('Fallback response triggered', { telefono, intention });
    metrics.record('interaction', 1, { type: 'fallback' });
    const reply = generateSmartResponse("fallback", context);
    return persistAndReply({}, { reply });

  } catch (err) {
    const errorInfo = { 
      telefono, 
      error: err?.message || String(err), 
      stack: err?.stack,
      code: err?.code,
      name: err?.name
    };
    
    logger.error('KOMMO handler error', errorInfo);
    metrics.record('api_error', 1, { 
      code: err?.code || 'UNKNOWN',
      statusCode: err?.statusCode || 500,
      name: err?.name
    });
    
    // Send error response
    if (err instanceof ValidationError) {
      if (debugMode) {
        err.exposeDetails = true;
      }
      return sendError(res, err);
    }
    
    if (err instanceof RateLimitError) {
      if (debugMode) {
        err.exposeDetails = true;
      }
      return sendError(res, err);
    }
    
    if (err instanceof AppError) {
      if (debugMode) {
        err.exposeDetails = true;
        err.details = err.details || { message: err.message, code: err.code, name: err.name };
      }
      return sendError(res, err);
    }
    
    // Generic error with debug info
    const genericError = new AppError(
      'Internal server error',
      500,
      'INTERNAL_ERROR'
    );
    
    // In debug mode or non-production, include error details
    if (debugMode || CONFIG.ENV !== 'production') {
      genericError.details = {
        message: err?.message,
        name: err?.name,
        code: err?.code,
        stack: debugMode ? err?.stack : undefined
      };
      genericError.exposeDetails = true;
    }
    
    return sendError(res, genericError);
  }
}

/**
 * Get collected metrics
 * @returns {Object} Metrics statistics
 */
export function getMetrics() {
  return {
    apiRequests: metrics.getStats('api_request'),
    intentions: metrics.getStats('intention_detected'),
    interactions: metrics.getStats('interaction'),
    orders: metrics.getStats('order'),
    payments: metrics.getStats('payment'),
    images: metrics.getStats('image'),
    ocr: metrics.getStats('ocr'),
    errors: metrics.getStats('api_error'),
    responseTimes: metrics.getStats('response_time'),
    auditTrail: metrics.getStats('audit_trail')
  };
}

/**
 * Reset collected metrics
 */
export function resetMetrics() {
  metrics.reset();
  logger.info('Metrics reset');
}
