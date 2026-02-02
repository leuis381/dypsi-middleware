/**
 * lib/ai-engine.js
 * 
 * Motor de IA mejorado con:
 * - Detección avanzada de intenciones
 * - Contexto conversacional real
 * - Sentido común extremo
 * - Análisis semántico
 * - Perfil de usuario
 * - Sugerencias inteligentes
 */

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
    /ayuda|cómo|como|funciona|pasos|instrucciones|qué hago|no entiendo|duda|pregunta/i
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
 */
class ConversationContext {
  constructor(userData = {}) {
    this.userId = userData.userId;
    this.name = userData.name || 'Cliente';
    this.messages = [];           // Últimos N mensajes
    this.currentOrder = null;     // Pedido actual
    this.previousOrders = userData.previousOrders || [];
    this.preferences = userData.preferences || {}; // sin cebolla, etc
    this.lastMentioned = {};      // último item mencionado
    this.conversationState = 'active';
    this.sessionStart = Date.now();
  }

  addMessage(role, content, meta = {}) {
    this.messages.push({
      role,           // 'user' | 'bot'
      content,
      timestamp: Date.now(),
      intent: meta.intent,
      confidence: meta.confidence,
      entities: meta.entities || []
    });
    
    // Mantener últimos 10 mensajes
    if (this.messages.length > 10) {
      this.messages.shift();
    }
  }

  getContext() {
    return {
      recentMessages: this.messages.slice(-3),
      currentOrder: this.currentOrder,
      lastOrder: this.previousOrders[0],
      preferences: this.preferences,
      isRepeat: !!this.previousOrders.length,
      daysSinceLastOrder: this.previousOrders[0] 
        ? Math.floor((Date.now() - this.previousOrders[0].date) / 86400000)
        : null
    };
  }
}

/**
 * Detección de Intención Multi-Layered
 */
function detectIntention(message, context = {}) {
  if (!message) return { intention: null, confidence: 0, details: {} };

  const lower = message.toLowerCase();
  const tokens = lower.split(/\s+/);
  
  const scores = {};

  // Layer 1: Regex Pattern Matching
  for (const [intention, patterns] of Object.entries(INTENTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        scores[intention] = (scores[intention] || 0) + 1;
      }
    }
  }

  // Layer 2: Contexto (heurística)
  if (context.currentOrder && lower.includes('si')) {
    scores[INTENTIONS.PAYMENT] = (scores[INTENTIONS.PAYMENT] || 0) + 0.5;
  }

  if (context.previousOrders?.length && (
    lower.includes('igual') || lower.includes('lo mismo') || lower.includes('otra vez')
  )) {
    scores[INTENTIONS.ORDER_REPEAT] = (scores[INTENTIONS.ORDER_REPEAT] || 0) + 2;
  }

  // Layer 3: Keywords específicos
  if (lower.match(/\d+\s*x\s*|x\d+|dos|tres|uno/)) {
    scores[INTENTIONS.ORDER_NEW] = (scores[INTENTIONS.ORDER_NEW] || 0) + 0.3;
  }

  // Normalizar scores y encontrar ganador
  const maxScore = Math.max(...Object.values(scores), 0);
  const winnerIntention = Object.entries(scores).find(([_, s]) => s === maxScore)?.[0] || null;

  return {
    intention: winnerIntention,
    confidence: maxScore > 0 ? Math.min(maxScore / 3, 1) : 0,
    allScores: scores,
    tokens
  };
}

/**
 * Análisis Semántico Simple (Similitud)
 */
function cosineSimilarity(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function findMostSimilarMessage(message, messagePool = []) {
  if (!messagePool.length) return null;
  
  const messageTokens = message.toLowerCase().split(/\s+/);
  
  let mostSimilar = null;
  let maxSimilarity = 0;

  for (const candidate of messagePool) {
    const candidateTokens = candidate.toLowerCase().split(/\s+/);
    const similarity = cosineSimilarity(messageTokens, candidateTokens);
    
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      mostSimilar = candidate;
    }
  }

  return { message: mostSimilar, similarity: maxSimilarity };
}

/**
 * Detección de Números en Texto
 */
function extractNumbers(text) {
  const patterns = [
    /(\d+)\s*x\s*(?:de\s+)?/i,           // "2 x pizza" o "2x"
    /(\d+)\s*(?:más|mas|adicionales)/i,  // "2 más"
    /cantidad\s*[:=]?\s*(\d+)/i,         // "cantidad: 2"
    /(\d+)(?:\s+(?:pizza|burger|ala))/i  // "2 pizzas"
  ];

  const matches = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      matches.push(parseInt(match[1]));
    }
  }

  return matches.length > 0 ? matches[0] : null;
}

/**
 * Extracción de Modificadores/Preferencias
 */
function extractModifiers(text) {
  const modifiers = {
    without: [],  // sin, sin queso
    with: [],     // con, con extra queso
    notes: []     // notas especiales
  };

  const sinMatch = text.match(/sin\s+([a-záéíóúñ\s]+?)(?:,|\.|$)/gi);
  if (sinMatch) {
    modifiers.without = sinMatch.map(m => m.replace(/sin\s+/, '').trim());
  }

  const conMatch = text.match(/con\s+([a-záéíóúñ\s]+?)(?:,|\.|$)/gi);
  if (conMatch) {
    modifiers.with = conMatch.map(m => m.replace(/con\s+/, '').trim());
  }

  return modifiers;
}

/**
 * Detección de Referencia Anafórica
 */
function detectAnaphora(text, context) {
  // "dos más" → agregar 2 al último item
  // "lo mismo" → repetir última orden
  // "eso" → referirse al último mencionado
  
  const pronouns = ['eso', 'esa', 'ese', 'esto', 'esta', 'este', 'lo mismo', 'igual'];
  
  if (pronouns.some(p => text.toLowerCase().includes(p))) {
    return {
      isAnaphora: true,
      referentType: 'previousOrder', // o 'lastProduct', 'lastPrice'
      confidence: 0.8
    };
  }

  return { isAnaphora: false };
}

/**
 * Generador de Respuesta Inteligente
 */
function generateSmartResponse(intention, context, data = {}) {
  const templates = {
    [INTENTIONS.ORDER_NEW]: [
      `Perfecto, entendí que quieres ${data.summary || 'tu pedido'}. ¿Algo más para agregar?`,
      `Listo, anoté ${data.summary}. ¿Te falta algo?`,
      `Excelente, ${data.summary}. ¿Delivery o recojo?`
    ],
    [INTENTIONS.ORDER_REPEAT]: [
      `Claro, igual que la vez pasada: ${data.lastOrder || 'tu orden de siempre'}. ¿Listo así?`,
      `Perfecto, repito tu pedido favorito. ¿Confirmamos?`,
      `Tu orden usual viene en camino. ¿Todo igual?`
    ],
    [INTENTIONS.PAYMENT]: [
      `Gracias por el pago. Tu pedido está en preparación.`,
      `Pago recibido ✅. Te aviso cuando salga a entrega.`,
      `¡Listo! Ya confirmamos tu pago.`
    ],
    [INTENTIONS.STATUS]: [
      `Tu pedido está ${data.status || 'en preparación'}. ${data.eta ? `Llega en ${data.eta}.` : ''}`,
      `Te cuento, tu orden ${data.status || 'sigue en cocina'}. ¡Casi lista!`,
      `Aquí va el estado: ${data.status || 'en preparación'}.`
    ],
    [INTENTIONS.GREETING]: [
      `¡Hola! ¿Qué deseas hoy?`,
      `¡Hola ${context.name}! ¿En qué te ayudo?`,
      `¡Saludos! ¿Tienes hambre?`
    ]
  };

  const responses = templates[intention] || [];
  return responses.length > 0 
    ? responses[Math.floor(Math.random() * responses.length)]
    : "¿En qué te ayudo?";
}

/**
 * Sugerencias Inteligentes
 */
function generateSuggestions(context, menu) {
  const suggestions = [];

  // Si tiene órdenes previas, sugerir combo relacionado
  if (context.previousOrders.length > 0) {
    const lastItems = context.previousOrders[0].items || [];
    
    // Sugerir bebida si no la tiene
    if (!lastItems.some(i => i.category === 'bebidas')) {
      suggestions.push({
        type: 'upsell',
        message: '¿Agregamos una bebida?',
        products: ['coca-grande', 'sprite', 'agua']
      });
    }

    // Sugerir postre
    if (!lastItems.some(i => i.category === 'postres')) {
      suggestions.push({
        type: 'upsell',
        message: '¿Cerramos con un postre?',
        products: ['helado', 'brownie']
      });
    }
  }

  // Sugerir combo si tiene 2+ items
  if (context.currentOrder?.items?.length >= 2) {
    suggestions.push({
      type: 'combo',
      message: 'Hay un combo que te sale más barato...',
      discount: '5%'
    });
  }

  return suggestions;
}

/**
 * Validación Inteligente de Orden
 */
function validateOrder(items, menu) {
  const errors = [];
  const warnings = [];

  if (!items || items.length === 0) {
    errors.push('No hay items en la orden');
    return { isValid: false, errors, warnings };
  }

  // Validar cada item
  for (const item of items) {
    const product = findProductInMenu(menu, item.id);
    if (!product) {
      warnings.push(`No encontré "${item.name}" en el menú`);
    }

    if (!item.quantity || item.quantity <= 0) {
      errors.push(`Cantidad inválida para ${item.name}`);
    }
  }

  // Validar totales
  const subtotal = items.reduce((sum, i) => sum + (i.price || 0), 0);
  if (subtotal === 0) {
    errors.push('El total del pedido es cero');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Helpers Auxiliares
 */
function findProductInMenu(menu, productId) {
  if (!menu.categorias) return null;
  
  for (const cat of menu.categorias) {
    const product = (cat.productos || []).find(p => p.id === productId || p.sku === productId);
    if (product) return product;
  }
  
  return null;
}

/**
 * Exports
 */
export default {
  INTENTIONS,
  ConversationContext,
  detectIntention,
  cosineSimilarity,
  findMostSimilarMessage,
  extractNumbers,
  extractModifiers,
  detectAnaphora,
  generateSmartResponse,
  generateSuggestions,
  validateOrder,
  findProductInMenu
};
