/**
 * lib/ai-engine.js
 * 
 * Motor de IA mejorado con:
 * - Detección avanzada de intenciones con confianza
 * - Contexto conversacional real y multi-layer analysis
 * - Sentido común extremo con validación exhaustiva
 * - Análisis semántico avanzado con similitud coseno
 * - Gestión de perfil de usuario completa
 * - Sugerencias inteligentes y personalizadas
 * - Logging centralizado en todos los puntos críticos
 * - Validación de entrada exhaustiva
 * - Manejo robusto de errores
 */

import { logger, ValidationError, AppError, MetricsCollector } from './utils.js';

/** Instancia de métricas */
const metrics = new MetricsCollector();

/**
 * Sistema de Intenciones
 */
const INTENTIONS = {
  ORDER_NEW: 'order_new',              // "quiero 2 pizzas"
  ORDER_MODIFY: 'order_modify',        // "agrega uno más", "sin cebolla"
  ORDER_REPEAT: 'order_repeat',        // "lo mismo", "igual que antes"
  ORDER_CONTINUE: 'order_continue',    // "y también...", "agrega..."
  PAYMENT: 'payment',                  // "ya pagué", "yape"
  STATUS: 'status',                    // "¿dónde está?", "estado"
  CANCEL: 'cancel',                    // "cancela", "no quiero"
  FEEDBACK: 'feedback',                // "falta sal", "muy caro"
  HELP: 'help',                        // "ayuda", "¿cómo funciona?"
  GREETING: 'greeting',                // "hola", "buenos días"
  SMALLTALK: 'smalltalk',              // charla casual
  COMPLAINT: 'complaint',              // "no me gustó"
  LOYALTY: 'loyalty'                   // "soy cliente frecuente"
};

/**
 * Patrones de Intención
 */
const INTENTION_PATTERNS = {
  [INTENTIONS.ORDER_NEW]: [
    /quiero|dame|p[oe]ng[ao]|trae|envía|manda|prepare|hace|cocina|vend[eo]|voy a pedir|pedido|orden/i,
    /\d+\s*x\s*|\d+\s*(pizza|burger|ala|tequeno|crispy)/i
  ],
  [INTENTIONS.ORDER_MODIFY]: [
    /agrega|añade|suma|uno más|2 más|tres más|sin |con |quitale|extra|mas de|cambio|modifico|reemplazo|cambiar|menos/i
  ],
  [INTENTIONS.ORDER_REPEAT]: [
    /lo mismo|igual|igual que|antes|anterior|otra vez|repite|mismo de ayer|típico|mi orden usual|mi favorito/i
  ],
  [INTENTIONS.ORDER_CONTINUE]: [
    /\sy\s|también|además|y quiero|y dame|agrégale|y trae|más|aparte/i
  ],
  [INTENTIONS.PAYMENT]: [
    /pagu|pagado|yape|plin|transfer|banco|efectivo|efectivo|crédito|débito|comprobante|comprobé|envío|mandé/i,
    /\d+[\.,]\d+|S\/|soles/i
  ],
  [INTENTIONS.STATUS]: [
    /dónde|estado|seguimiento|track|cuándo|llega|sale|salió|preparando|enviando|entrega/i
  ],
  [INTENTIONS.CANCEL]: [
    /cancelar|cancela|no quiero|olvida|olvídalo|no|borra|elimina|descarta/i
  ],
  [INTENTIONS.FEEDBACK]: [
    /falta|sobra|mucho|poco|sal|picante|dulce|frío|caliente|quemado|crudo|caro|barato|gustó/i
  ],
  [INTENTIONS.HELP]: [
    /ayuda|cómo|como|funciona|pasos|instrucciones|qué hago|no entiendo|duda|pregunta|menu|menú|carta|lista|catálogo|catalogo|promo|promoción|promociones|precio|cuánto cuesta|cuanto cuesta/i
  ],
  [INTENTIONS.GREETING]: [
    /hola|buenos|buenas|qué tal|saludos|hi|hey|oye/i
  ],
  [INTENTIONS.COMPLAINT]: [
    /no me gustó|disgustado|enojado|molesto|decepcionado|no sirve|basura|terrible/i
  ]
};

/**
 * Contexto Conversacional
 * Gestiona el estado y contexto de una conversación individual
 */
class ConversationContext {
  /**
   * Crear nuevo contexto de conversación
   * @param {Object} userData - Datos del usuario { userId, name, previousOrders, preferences }
   * @throws {ValidationError} Si userData no es válido
   */
  constructor(userData = {}) {
    logger.debug('CONTEXT_CREATE', { userId: userData.userId });

    // Validar input
    if (userData && typeof userData !== 'object') {
      throw new ValidationError('INVALID_INPUT', 'userData debe ser un objeto');
    }

    this.userId = userData.userId || `user_${Date.now()}`;
    this.name = userData.name || 'Cliente';
    this.messages = [];           // Últimos N mensajes
    this.currentOrder = null;     // Pedido actual
    this.previousOrders = Array.isArray(userData.previousOrders) ? userData.previousOrders : [];
    this.preferences = userData.preferences && typeof userData.preferences === 'object' ? userData.preferences : {};
    this.lastMentioned = {};      // último item mencionado
    this.conversationState = 'active';
    this.sessionStart = Date.now();
    
    metrics.recordMetric('context_created', { userId: this.userId });
  }

  /**
   * Agregar mensaje a contexto
   * @param {string} role - 'user' | 'bot'
   * @param {string} content - Contenido del mensaje
   * @param {Object} meta - Metadata { intent, confidence, entities }
   * @throws {ValidationError} Si los parámetros son inválidos
   */
  addMessage(role, content, meta = {}) {
    // Validar parámetros
    if (!role || typeof role !== 'string') {
      throw new ValidationError('INVALID_ROLE', 'role debe ser una cadena no vacía');
    }
    if (!content || typeof content !== 'string') {
      throw new ValidationError('INVALID_CONTENT', 'content debe ser una cadena no vacía');
    }
    if (meta && typeof meta !== 'object') {
      throw new ValidationError('INVALID_META', 'meta debe ser un objeto');
    }

    const message = {
      role: role.toLowerCase(),
      content: content.trim(),
      timestamp: Date.now(),
      intent: meta.intent || null,
      confidence: meta.confidence || 0,
      entities: Array.isArray(meta.entities) ? meta.entities : []
    };

    this.messages.push(message);
    
    // Mantener últimos 10 mensajes para eficiencia
    if (this.messages.length > 10) {
      this.messages.shift();
    }

    logger.debug('MESSAGE_ADDED', { role, length: content.length, intent: meta.intent });
  }

  /**
   * Obtener contexto actual
   * @returns {Object} Contexto con últimos mensajes, orden, preferencias
   */
  getContext() {
    const lastOrder = this.previousOrders[0];
    const daysSinceLastOrder = lastOrder 
      ? Math.floor((Date.now() - (lastOrder.date || 0)) / 86400000)
      : null;

    return {
      recentMessages: this.messages.slice(-3),
      currentOrder: this.currentOrder,
      lastOrder: lastOrder,
      preferences: this.preferences,
      isRepeat: this.previousOrders.length > 0,
      daysSinceLastOrder: daysSinceLastOrder,
      sessionDurationMs: Date.now() - this.sessionStart
    };
  }

  /**
   * Actualizar orden actual
   * @param {Object} order - Pedido con items, total, etc
   */
  updateCurrentOrder(order) {
    if (order && typeof order === 'object') {
      this.currentOrder = order;
      logger.debug('ORDER_UPDATED', { items: order.items?.length || 0 });
    }
  }

  /**
   * Finalizar sesión
   * @returns {Object} Resumen de sesión
   */
  endSession() {
    const duration = Date.now() - this.sessionStart;
    logger.info('SESSION_END', { 
      userId: this.userId, 
      durationMs: duration,
      messageCount: this.messages.length 
    });
    
    this.conversationState = 'closed';
    
    return {
      userId: this.userId,
      sessionDurationMs: duration,
      messageCount: this.messages.length,
      finalOrder: this.currentOrder
    };
  }
}

/**
 * Detección de Intención Multi-Layered
 * Utiliza 3 capas de análisis: regex, contexto y palabras clave
 * 
 * @param {string} message - Mensaje del usuario
 * @param {Object} context - Contexto de conversación
 * @returns {Object} { intention, confidence, allScores, tokens, details }
 * @throws {ValidationError} Si el mensaje no es válido
 */
function detectIntention(message, context = {}) {
  // Validar input
  if (typeof message !== 'string') {
    throw new ValidationError('INVALID_MESSAGE', 'message debe ser una cadena');
  }

  if (!message.trim()) {
    logger.warn('EMPTY_MESSAGE', { context: context.userId });
    return { intention: null, confidence: 0, allScores: {}, tokens: [], details: { empty: true } };
  }

  const lower = message.toLowerCase().trim();
  const tokens = lower.split(/\s+/).filter(t => t.length > 0);
  
  const scores = {};

  try {
    // Layer 1: Regex Pattern Matching
    for (const [intention, patterns] of Object.entries(INTENTION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(lower)) {
          scores[intention] = (scores[intention] || 0) + 1;
        }
      }
    }

    // Layer 2: Contexto (heurística inteligente)
    if (context.currentOrder && (lower.includes('si') || lower.includes('sí'))) {
      scores[INTENTIONS.PAYMENT] = (scores[INTENTIONS.PAYMENT] || 0) + 0.5;
    }

    if (context.previousOrders?.length > 0 && (
      lower.includes('igual') || lower.includes('lo mismo') || lower.includes('otra vez')
    )) {
      scores[INTENTIONS.ORDER_REPEAT] = (scores[INTENTIONS.ORDER_REPEAT] || 0) + 2;
    }

    // Layer 3: Keywords específicos y numéricos
    if (lower.match(/\d+\s*x\s*|x\d+|dos|tres|uno|cuatro|cinco/i)) {
      scores[INTENTIONS.ORDER_NEW] = (scores[INTENTIONS.ORDER_NEW] || 0) + 0.3;
    }

    // Normalizar scores y encontrar ganador
    const maxScore = Math.max(...Object.values(scores), 0);
    const sortedScores = Object.entries(scores).sort(([, a], [, b]) => b - a);
    const winnerIntention = sortedScores.length > 0 ? sortedScores[0][0] : null;

    const confidence = maxScore > 0 ? Math.min(maxScore / 3, 1) : 0;

    const result = {
      intention: winnerIntention,
      confidence: Number(confidence.toFixed(3)),
      allScores: scores,
      tokens: tokens,
      details: {
        messageLength: message.length,
        tokenCount: tokens.length,
        topAlternatives: sortedScores.slice(0, 3)
      }
    };

    logger.debug('INTENTION_DETECTED', { 
      intention: result.intention, 
      confidence: result.confidence,
      messageLength: message.length 
    });

    metrics.recordMetric('intention_detected', { intention: result.intention });

    return result;
  } catch (error) {
    logger.error('INTENTION_DETECTION_ERROR', { error: error.message, message: message.substring(0, 100) });
    throw new AppError('INTENTION_ERROR', 'Error detectando intención', { cause: error });
  }
}

/**
 * Análisis Semántico con Similitud Coseno
 * Calcula similitud entre dos conjuntos de tokens
 * 
 * @param {Array<string>} a - Primer conjunto de tokens
 * @param {Array<string>} b - Segundo conjunto de tokens
 * @returns {number} Similitud entre 0 y 1
 */
function cosineSimilarity(a = [], b = []) {
  // Validar inputs
  if (!Array.isArray(a) || !Array.isArray(b)) {
    logger.warn('INVALID_SIMILARITY_INPUT', { aType: typeof a, bType: typeof b });
    return 0;
  }

  if (a.length === 0 || b.length === 0) return 0;
  
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  
  const union = new Set([...setA, ...setB]);
  const similarity = union.size > 0 ? intersection.size / union.size : 0;

  return Number(similarity.toFixed(4));
}

/**
 * Encontrar mensaje más similar en un pool
 * Útil para detectar si el usuario repite algo similar
 * 
 * @param {string} message - Mensaje a buscar
 * @param {Array<string>} messagePool - Pool de mensajes para buscar
 * @returns {Object|null} { message, similarity } o null
 */
function findMostSimilarMessage(message, messagePool = []) {
  // Validar inputs
  if (typeof message !== 'string' || !Array.isArray(messagePool)) {
    throw new ValidationError('INVALID_ARGS', 'message debe ser string, messagePool debe ser array');
  }

  if (messagePool.length === 0) {
    logger.debug('EMPTY_POOL', { message: message.substring(0, 50) });
    return null;
  }
  
  const messageTokens = message.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  
  let mostSimilar = null;
  let maxSimilarity = 0;

  for (const candidate of messagePool) {
    if (typeof candidate !== 'string') continue;

    const candidateTokens = candidate.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const similarity = cosineSimilarity(messageTokens, candidateTokens);
    
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      mostSimilar = candidate;
    }
  }

  const result = mostSimilar ? { message: mostSimilar, similarity: maxSimilarity } : null;
  
  logger.debug('SIMILARITY_SEARCH', { 
    messageLength: message.length,
    poolSize: messagePool.length,
    found: !!result,
    maxSimilarity: maxSimilarity 
  });

  return result;
}

/**
 * Detección de Números en Texto
 * Extrae cantidades del texto del usuario
 * 
 * @param {string} text - Texto a procesar
 * @returns {number|null} Número encontrado o null
 */
function extractNumbers(text) {
  // Validar input
  if (typeof text !== 'string') {
    throw new ValidationError('INVALID_TEXT', 'text debe ser una cadena');
  }

  const patterns = [
    /(\d+)\s*x\s*(?:de\s+)?/i,           // "2 x pizza" o "2x"
    /(\d+)\s*(?:más|mas|adicionales)/i,  // "2 más"
    /cantidad\s*[:=]?\s*(\d+)/i,         // "cantidad: 2"
    /(\d+)(?:\s+(?:pizza|burger|ala|crispy|tequeno))/i  // "2 pizzas"
  ];

  const matches = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      matches.push(parseInt(match[1], 10));
    }
  }

  const result = matches.length > 0 ? Math.max(...matches) : null;
  
  logger.debug('EXTRACT_NUMBERS', { text: text.substring(0, 50), result });

  return result;
}

/**
 * Extracción de Modificadores/Preferencias
 * Detecta preferencias del usuario como "sin cebolla", "con extra queso"
 * 
 * @param {string} text - Texto a analizar
 * @returns {Object} { without, with, notes }
 */
function extractModifiers(text) {
  // Validar input
  if (typeof text !== 'string') {
    throw new ValidationError('INVALID_TEXT', 'text debe ser una cadena');
  }

  const modifiers = {
    without: [],  // sin, sin queso
    with: [],     // con, con extra queso
    notes: []     // notas especiales
  };

  try {
    const sinMatch = text.match(/sin\s+([a-záéíóúñ\s]+?)(?:,|\.|$)/gi) || [];
    if (sinMatch.length > 0) {
      modifiers.without = sinMatch.map(m => m.replace(/sin\s+/i, '').trim()).filter(Boolean);
    }

    const conMatch = text.match(/con\s+([a-záéíóúñ\s]+?)(?:,|\.|$)/gi) || [];
    if (conMatch.length > 0) {
      modifiers.with = conMatch.map(m => m.replace(/con\s+/i, '').trim()).filter(Boolean);
    }

    logger.debug('MODIFIERS_EXTRACTED', { 
      withoutCount: modifiers.without.length,
      withCount: modifiers.with.length 
    });
  } catch (error) {
    logger.error('MODIFIER_EXTRACTION_ERROR', { error: error.message });
  }

  return modifiers;
}

/**
 * Detección de Referencia Anafórica
 * Detecta cuando el usuario usa pronombres como "eso", "lo mismo", etc
 * 
 * @param {string} text - Texto a analizar
 * @param {Object} context - Contexto de conversación
 * @returns {Object} { isAnaphora, referentType, confidence }
 */
function detectAnaphora(text, context = {}) {
  // Validar inputs
  if (typeof text !== 'string') {
    throw new ValidationError('INVALID_TEXT', 'text debe ser una cadena');
  }
  
  const pronouns = ['eso', 'esa', 'ese', 'esto', 'esta', 'este', 'lo mismo', 'igual', 'otra vez'];
  const lower = text.toLowerCase();
  
  const isAnaphora = pronouns.some(p => lower.includes(p));

  const result = {
    isAnaphora: isAnaphora,
    referentType: isAnaphora ? 'previousOrder' : null,
    confidence: isAnaphora ? 0.8 : 0,
    pronounsFound: isAnaphora ? pronouns.filter(p => lower.includes(p)) : []
  };

  logger.debug('ANAPHORA_DETECTION', { 
    isAnaphora,
    pronounsCount: result.pronounsFound.length 
  });

  return result;
}

/**
 * Generador de Respuesta Inteligente
 * Crea respuestas naturales y contextuales basadas en intención
 * 
 * @param {string} intention - Intención detectada
 * @param {Object} context - Contexto de conversación
 * @param {Object} data - Datos para personalizar respuesta { summary, lastOrder, status, eta }
 * @returns {string} Respuesta generada
 * @throws {ValidationError} Si los parámetros son inválidos
 */
function generateSmartResponse(intention, context = {}, data = {}) {
  // Validar inputs
  if (typeof intention !== 'string') {
    throw new ValidationError('INVALID_INTENTION', 'intention debe ser una cadena');
  }
  if (context && typeof context !== 'object') {
    throw new ValidationError('INVALID_CONTEXT', 'context debe ser un objeto');
  }

  const templates = {
    [INTENTIONS.ORDER_NEW]: [
      `Perfecto, entendí que quieres ${data.summary || 'tu pedido'}. ¿Algo más para agregar?`,
      `Listo, anoté ${data.summary || 'eso'}. ¿Te falta algo?`,
      `Excelente, ${data.summary || 'anotado'} ✓. ¿Delivery o recojo?`,
      `Dale, ${data.summary || 'tu orden'} está confirmada. ¿Qué más?`
    ],
    [INTENTIONS.ORDER_REPEAT]: [
      `Claro, igual que la vez pasada: ${data.lastOrder || 'tu orden de siempre'}. ¿Listo así?`,
      `Perfecto, repito tu pedido favorito. ¿Confirmamos?`,
      `Tu orden usual viene en camino. ¿Todo igual?`,
      `Excelente, ${data.lastOrder || 'lo mismo'} como siempre. ¿Vamos?`
    ],
    [INTENTIONS.PAYMENT]: [
      `Gracias por el pago ✓. Tu pedido está en preparación.`,
      `Pago recibido ✅. Te aviso cuando salga a entrega.`,
      `¡Listo! Ya confirmamos tu pago. Preparando tu orden...`,
      `Perfecto, pago confirmado. ¡En camino en breve!`
    ],
    [INTENTIONS.STATUS]: [
      `Tu pedido está ${data.status || 'en preparación'}. ${data.eta ? `Llega en ${data.eta}.` : 'Te avisamos cuando esté listo.'}`,
      `Te cuento, tu orden ${data.status || 'sigue en cocina'}. ¡Casi lista!`,
      `Aquí va el estado: ${data.status || 'en preparación'}}. ${data.eta || ''}`,
      `Está ${data.status || 'en la cocina'}} ahorita. ${data.eta ? `ETA: ${data.eta}` : ''}`
    ],
    [INTENTIONS.GREETING]: [
      `¡Hola! ¿Qué deseas hoy?`,
      `¡Hola ${context.name || 'amig@'}! ¿En qué te ayudo?`,
      `¡Saludos! ¿Tienes hambre hoy?`,
      `¡Bienvenid@ de vuelta! ¿Qué te preparamos?`
    ],
    [INTENTIONS.HELP]: [
      `¡Claro! ¿Qué necesitas saber?`,
      `Aquí estoy para ayudarte. ¿Qué pregunta tienes?`,
      `Sin problema, dime qué necesitas. 😊`
    ],
    [INTENTIONS.COMPLAINT]: [
      `Lamento mucho eso 😞. ¿Qué pasó? Queremos solucionarlo.`,
      `Disculpa, cuéntame qué salió mal. Nos importa tu opinión.`,
      `Sentimos no haber cumplido. ¿Cómo podemos arreglarlo?`
    ]
  };

  const customTemplates = {
    menu_available: [
      data.categories
        ? `Aquí tienes la carta:\n${data.categories}`
        : `Aquí tienes la carta. ¿Qué te gustaría pedir?`
    ],
    address_received: [
      `Dirección recibida: ${data.address || 'ok'}. ¿Confirmas tu pedido?`
    ],
    order_incomplete: [
      data.errors?.length
        ? `Necesito completar tu pedido: ${data.errors.join(', ')}.`
        : `Necesito más detalles para completar tu pedido.`
    ],
    payment_confirmed: [
      data.amount
        ? `Pago confirmado por S/${data.amount}. ¡Gracias!`
        : `Pago confirmado ✅. ¡Gracias!`
    ],
    payment_mismatch: [
      `El monto no coincide. Detectado: ${data.detected ?? 'N/D'}, esperado: ${data.expected ?? 'N/D'}.`
    ],
    receipt_no_order: [
      `Recibí el comprobante, pero no tengo un pedido activo. ¿Deseas hacer un pedido?`
    ],
    image_received: [
      `Imagen recibida ✅. Estoy validando el comprobante.`
    ],
    help_image_quality: [
      `No pude leer el comprobante. ¿Puedes enviar una imagen más clara?`
    ],
    no_order_found: [
      `No tengo un pedido activo. ¿Deseas hacer uno ahora?`
    ],
    no_active_order: [
      `No hay un pedido en curso. ¿Te gustaría ordenar algo?`
    ],
    order_confirmed: [
      `Pedido confirmado ✅. ¿Deseas pagar ahora?`
    ],
    order_preparing: [
      `Tu pedido ya está en preparación.`
    ],
    order_dispatched: [
      `Tu pedido salió a reparto. ¡Ya llega!`
    ],
    order_delivered: [
      `Tu pedido fue entregado. ¡Gracias por tu compra!`
    ],
    order_cancelled: [
      `Tu pedido fue cancelado. Si necesitas algo más, aquí estoy.`
    ],
    cannot_cancel: [
      `No es posible cancelar en este estado. ¿Deseas ayuda?`
    ],
    complaint_received: [
      `Lamento el inconveniente. Un agente te contactará pronto.`
    ],
    feedback_received: [
      `Gracias por tu comentario. Lo tomamos en cuenta.`
    ],
    fallback: [
      `No entendí del todo. ¿Puedes reformular tu mensaje?`
    ]
  };

  const responses = templates[intention]
    || customTemplates[intention]
    || templates[INTENTIONS.GREETING]
    || [];
  
  if (responses.length === 0) {
    logger.warn('NO_TEMPLATES', { intention });
    return "¿En qué te ayudo?";
  }

  const response = responses[Math.floor(Math.random() * responses.length)];
  
  logger.debug('RESPONSE_GENERATED', { intention, templateCount: responses.length });
  metrics.recordMetric('response_generated', { intention });

  return response;
}

/**
 * Sugerencias Inteligentes
 * Genera sugerencias personalizadas basadas en perfil y contexto
 * 
 * @param {Object} context - Contexto de conversación
 * @param {Object} menu - Menú disponible
 * @returns {Array<Object>} Array de sugerencias { type, message, products, discount }
 */
function generateSuggestions(context = {}, menu = null) {
  // Validar inputs
  if (!context || typeof context !== 'object') {
    throw new ValidationError('INVALID_CONTEXT', 'context debe ser un objeto');
  }

  const suggestions = [];

  try {
    // Si tiene órdenes previas, sugerir complementos
    if (context.previousOrders && context.previousOrders.length > 0) {
      const lastItems = context.previousOrders[0].items || [];
      
      // Sugerir bebida si no la tiene
      if (!lastItems.some(i => i.category === 'bebidas')) {
        suggestions.push({
          type: 'upsell',
          message: '¿Agregamos una bebida para ir acompañando?',
          products: ['coca-grande', 'sprite', 'agua'],
          confidence: 0.8
        });
      }

      // Sugerir postre
      if (!lastItems.some(i => i.category === 'postres')) {
        suggestions.push({
          type: 'upsell',
          message: '¿Cerramos con un postre?',
          products: ['helado', 'brownie', 'flan'],
          confidence: 0.7
        });
      }

      // Sugerir cantidad extra
      const totalQty = lastItems.reduce((sum, i) => sum + (i.quantity || 0), 0);
      if (totalQty >= 2 && totalQty <= 5) {
        suggestions.push({
          type: 'quantity',
          message: `Vimos que pides en cantidad. ¿Hay combo para 4-5 personas hoy?`,
          confidence: 0.6
        });
      }
    }

    // Sugerir combo si tiene 2+ items
    if (context.currentOrder?.items && context.currentOrder.items.length >= 2) {
      suggestions.push({
        type: 'combo',
        message: 'Hay un combo que te sale más barato con eso...',
        discount: '5%',
        confidence: 0.75
      });
    }

    logger.debug('SUGGESTIONS_GENERATED', { count: suggestions.length });
    metrics.recordMetric('suggestions_generated', { count: suggestions.length });

    return suggestions;
  } catch (error) {
    logger.error('SUGGESTION_GENERATION_ERROR', { error: error.message });
    return [];
  }
}

/**
 * Validación Inteligente de Orden
 * Valida que la orden sea completa y consistente
 * 
 * @param {Array<Object>} items - Items del pedido
 * @param {Object} menu - Menú para validar contra
 * @returns {Object} { isValid, errors, warnings, itemsCount }
 */
function validateOrder(items, menu = null) {
  // Validar inputs
  if (!Array.isArray(items)) {
    throw new ValidationError('INVALID_ITEMS', 'items debe ser un array');
  }

  const errors = [];
  const warnings = [];

  try {
    if (items.length === 0) {
      errors.push('No hay items en la orden');
      return { isValid: false, errors, warnings, itemsCount: 0 };
    }

    // Validar cada item
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        errors.push('Item inválido en orden');
        continue;
      }

      // Validar campos requeridos
      if (!item.name || typeof item.name !== 'string') {
        errors.push('Item sin nombre válido');
        continue;
      }

      // Validar cantidad
      const qty = Number(item.quantity || 0);
      if (!Number.isInteger(qty) || qty <= 0) {
        errors.push(`Cantidad inválida para ${item.name}: debe ser un número entero > 0`);
      }

      // Validar precio
      const price = Number(item.price || 0);
      if (price < 0) {
        errors.push(`Precio negativo para ${item.name}`);
      }

      // Validar contra menú si está disponible
      if (menu) {
        const product = findProductInMenu(menu, item.id);
        if (!product) {
          warnings.push(`No encontré "${item.name}" en el menú actual`);
        }
      }
    }

    // Validar totales
    let subtotal = 0;
    for (const item of items) {
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      subtotal += (qty * price);
    }

    if (subtotal === 0) {
      errors.push('El total del pedido es cero. Revisa precios y cantidades.');
    }

    const result = {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      itemsCount: items.length,
      subtotal: subtotal
    };

    logger.info('ORDER_VALIDATED', { 
      isValid: result.isValid,
      errorCount: errors.length,
      warningCount: warnings.length,
      itemsCount: items.length 
    });

    return result;
  } catch (error) {
    logger.error('ORDER_VALIDATION_ERROR', { error: error.message });
    throw new AppError('VALIDATION_ERROR', 'Error validando orden', { cause: error });
  }
}

/**
 * Helpers Auxiliares
 * Búsqueda de producto en menú
 * 
 * @param {Object} menu - Menú con estructura { categorias: [{productos: []}] }
 * @param {string|number} productId - ID del producto a buscar
 * @returns {Object|null} Producto encontrado o null
 */
function findProductInMenu(menu, productId) {
  // Validar inputs
  if (!menu || typeof menu !== 'object') return null;
  if (!productId) return null;

  try {
    if (!menu.categorias || !Array.isArray(menu.categorias)) return null;
    
    for (const cat of menu.categorias) {
      if (!cat.productos || !Array.isArray(cat.productos)) continue;

      const product = cat.productos.find(p => 
        p && (p.id === productId || p.sku === productId)
      );
      
      if (product) {
        return product;
      }
    }
    
    return null;
  } catch (error) {
    logger.error('FIND_PRODUCT_ERROR', { error: error.message, productId });
    return null;
  }
}

/**
 * Exports - Motor de IA Completo
 * 
 * Uso:
 * import aiEngine from './ai-engine.js';
 * const context = new aiEngine.ConversationContext({ userId: 'user1' });
 * const { intention, confidence } = aiEngine.detectIntention("quiero 2 pizzas");
 */
export default {
  // Constants
  INTENTIONS,
  
  // Classes
  ConversationContext,
  
  // Intent Detection
  detectIntention,
  
  // Semantic Analysis
  cosineSimilarity,
  findMostSimilarMessage,
  
  // Entity Extraction
  extractNumbers,
  extractModifiers,
  detectAnaphora,
  
  // Response Generation
  generateSmartResponse,
  generateSuggestions,
  
  // Validation
  validateOrder,
  findProductInMenu,
  
  // Metrics
  getMetrics: () => metrics.getMetrics(),
  resetMetrics: () => metrics.reset()
};

// Logging de inicio
logger.info('AI_ENGINE_LOADED', { 
  intentionsCount: Object.keys(INTENTIONS).length,
  version: '2.0.0'
});
