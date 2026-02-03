/**
 * 🎯 SMART INTERPRETER - Intérprete Inteligente de Mensajes
 * 
 * Sistema avanzado que:
 * - Interpreta cualquier tipo de mensaje (texto, emojis, ubicaciones)
 * - Corrige automáticamente errores de escritura
 * - Analiza contexto profundamente
 * - Detecta intenciones complejas
 * - Toma decisiones sobre derivación a agente
 */

import nlp from './advanced-nlp.js';
import fuzzyMatcher from './fuzzy-matcher.js';
import smartDelivery from './smart-delivery.js';

/**
 * Contexto de conversación del usuario
 */
class ConversationContext {
  constructor(userId) {
    this.userId = userId;
    this.messages = [];
    this.lastIntention = null;
    this.currentOrder = null;
    this.userLocation = null;
    this.userPhone = null;
    this.isReturningCustomer = false;
    this.satisfactionLevel = 'neutral';
  }

  addMessage(role, content, analysis) {
    this.messages.push({
      role,
      content,
      analysis,
      timestamp: new Date()
    });
  }

  getContext() {
    return {
      messageCount: this.messages.length,
      lastIntention: this.lastIntention,
      currentOrder: this.currentOrder,
      userLocation: this.userLocation,
      isReturningCustomer: this.isReturningCustomer,
      satisfactionLevel: this.satisfactionLevel,
    };
  }
}

/**
 * Procesa un mensaje completamente
 */
function processMessage(rawMessage, conversationContext = null) {
  // Análisis inicial
  const messageAnalysis = nlp.analyzeMessage(rawMessage);
  const correctedMessage = fuzzyMatcher.processText(rawMessage);
  const intention = nlp.detectIntention(rawMessage);
  const locationInfo = nlp.extractLocationInfo(rawMessage);
  const sentiment = nlp.analyzeSentiment(rawMessage);
  const emojiAnalysis = nlp.detectEmojis(rawMessage);

  // Integración con contexto
  let shouldEscalateToAgent = false;
  let escalationReason = null;
  let recommendedAction = null;

  // Análisis de necesidad de escalación
  const escalationAnalysis = analyzeEscalationNeeds(
    intention,
    sentiment,
    locationInfo,
    conversationContext,
    rawMessage
  );

  if (escalationAnalysis.shouldEscalate) {
    shouldEscalateToAgent = true;
    escalationReason = escalationAnalysis.reason;
  }

  // Acción recomendada basada en intención
  recommendedAction = getRecommendedAction(intention, locationInfo, sentiment);

  // Retorna análisis completo
  const result = {
    success: true,
    original: rawMessage,
    corrected: correctedMessage,
    analysis: {
      intention: intention,
      sentiment: sentiment,
      location: locationInfo,
      emojis: emojiAnalysis,
      typos: messageAnalysis.typoAnalysis,
      clientType: nlp.detectClientType(rawMessage, conversationContext?.messages || [])
    },
    escalation: {
      shouldEscalate: shouldEscalateToAgent,
      reason: escalationReason,
      priority: escalationAnalysis.priority
    },
    action: recommendedAction,
    confidence: intention.score
  };

  // Actualizar contexto si existe
  if (conversationContext) {
    conversationContext.lastIntention = intention.primary;
    conversationContext.satisfactionLevel = sentiment.sentiment;
    if (locationInfo.address || locationInfo.coordinates) {
      conversationContext.userLocation = locationInfo;
    }
    if (locationInfo.phone) {
      conversationContext.userPhone = locationInfo.phone;
    }
    conversationContext.addMessage('user', correctedMessage, messageAnalysis);
  }

  return result;
}

/**
 * Analiza si debe derivarse a agente humano
 */
function analyzeEscalationNeeds(intention, sentiment, locationInfo, context, rawMessage = '') {
  let shouldEscalate = false;
  let reason = null;
  let priority = 'normal';

  // Caso 1: Cliente está muy cerca de la tienda (< 500m)
  if ((locationInfo.coordinates || (locationInfo.latitude && locationInfo.longitude)) && smartDelivery && smartDelivery.calculateDistance) {
    try {
      const coords = locationInfo.coordinates || {
        lat: locationInfo.latitude,
        lon: locationInfo.longitude
      };
      const distance = smartDelivery.calculateDistance(
        coords.lat,
        coords.lon,
        parseFloat(process.env?.STORE_LAT || '-12.046374'),
        parseFloat(process.env?.STORE_LON || '-77.042793')
      );

      if (distance < 0.5) { // Menos de 500 metros
        shouldEscalate = true;
        reason = 'CLIENTE_EN_TIENDA';
        priority = 'high';
      }
    } catch (e) {
      // Ignorar si hay error con cálculo de distancia
    }
  }

  // Caso 2: Cliente indica estar en tienda por texto
  if (!shouldEscalate && /estoy\s+en\s+la\s+tienda|ya\s+estoy\s+en\s+el\s+local|estoy\s+en\s+el\s+local/i.test(rawMessage)) {
    shouldEscalate = true;
    reason = 'CLIENTE_EN_TIENDA';
    priority = 'high';
  }

  // Caso 3: Queja o problema
  if (intention.primary === 'COMPLAINT' && intention.score > 0.8) {
    shouldEscalate = true;
    reason = 'QUEJA_CLIENTE';
    priority = 'high';
  }

  // Caso 4: Sentimiento muy negativo
  if (sentiment.sentiment === 'negative' && Math.abs(sentiment.score) > 0.7) {
    shouldEscalate = true;
    reason = 'SENTIMIENTO_NEGATIVO';
    priority = 'high';
  }

  // Caso 5: Solicitud compleja no identificada
  if (intention.primary === 'UNKNOWN' && intention.score < 0.3) {
    // Si no se entiende bien el mensaje
    const wordCount = context?.messages?.length || 0;
    if (wordCount > 3) { // Después de varios intentos
      shouldEscalate = true;
      reason = 'NO_ENTENDIDO';
      priority = 'normal';
    }
  }

  // Caso 6: Solicitud especial (cambios complejos, devoluciones, etc)
  if (intention.primary === 'MODIFY_ORDER' && context?.currentOrder) {
    // Si son varios cambios, escalar
    const modifications = (context.currentOrder.modifications || []).length;
    if (modifications > 3) {
      shouldEscalate = true;
      reason = 'MODIFICACIONES_COMPLEJAS';
      priority = 'normal';
    }
  }

  return {
    shouldEscalate,
    reason,
    priority
  };
}

/**
 * Determina acción recomendada
 */
function getRecommendedAction(intention, locationInfo, sentiment) {
  const intentionType = intention.primary;
  const score = intention.score;

  const actionMap = {
    'ORDER': {
      action: 'PROCESAR_PEDIDO',
      description: 'Capturar detalles del pedido',
      priority: 'high'
    },
    'PRICE_INQUIRY': {
      action: 'MOSTRAR_MENU',
      description: 'Mostrar menú y precios',
      priority: 'normal'
    },
    'HOURS_INQUIRY': {
      action: 'MOSTRAR_HORARIOS',
      description: 'Informar horarios de atención',
      priority: 'normal'
    },
    'LOCATION': {
      action: 'CONFIRMAR_UBICACION',
      description: 'Confirmar ubicación de entrega',
      priority: 'high'
    },
    'DELIVERY_INQUIRY': {
      action: 'CALCULAR_DELIVERY',
      description: 'Calcular costo y tiempo de delivery',
      priority: 'normal'
    },
    'MODIFY_ORDER': {
      action: 'EDITAR_PEDIDO',
      description: 'Permitir modificar pedido existente',
      priority: 'high'
    },
    'STATUS_CHECK': {
      action: 'RASTREAR_PEDIDO',
      description: 'Proporcionar estado del pedido',
      priority: 'normal'
    },
    'SATISFACTION': {
      action: 'AGRADECER',
      description: 'Responder amablemente',
      priority: 'low'
    },
    'COMPLAINT': {
      action: 'ESCALAR_AGENTE',
      description: 'Derivar a agente especializado',
      priority: 'high'
    },
    'UNKNOWN': {
      action: 'PEDIR_ACLARACION',
      description: 'Solicitar aclaración del cliente',
      priority: 'normal'
    }
  };

  if (score < 0.3) {
    return actionMap['UNKNOWN'];
  }

  return actionMap[intentionType] || actionMap['UNKNOWN'];
}

/**
 * Valida si un mensaje es apropiado para procesar
 */
function validateMessage(message) {
  if (!message || message.trim().length === 0) {
    return { valid: false, reason: 'MENSAJE_VACIO' };
  }

  if (message.length > 5000) {
    return { valid: false, reason: 'MENSAJE_MUY_LARGO' };
  }

  // Detectar spam
  const spamPatterns = [
    /^[!@#$%^&*()]+$/,  // Solo caracteres especiales
    /(.)\1{9,}/,        // Más de 10 caracteres repetidos
    /(http|www|\.com|\.net)/i // URLs (spam potencial)
  ];

  for (const pattern of spamPatterns) {
    if (pattern.test(message)) {
      return { valid: false, reason: 'POSIBLE_SPAM' };
    }
  }

  return { valid: true };
}

/**
 * Procesa mensaje con validación completa
 */
function smartProcess(rawMessage, conversationContext = null) {
  // Validar primero
  const validation = validateMessage(rawMessage);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.reason,
      message: 'No se puede procesar este mensaje'
    };
  }

  // Procesar con análisis completo
  try {
    const result = processMessage(rawMessage, conversationContext);
    return {
      success: true,
      ...result
    };
  } catch (error) {
    return {
      success: false,
      error: 'ERROR_PROCESAMIENTO',
      message: error.message
    };
  }
}

/**
 * Genera respuesta humana basada en análisis
 */
function generateContextAwareResponse(analysis, clientName = 'Cliente') {
  const intention = analysis.intention.primary;
  const sentiment = analysis.sentiment.sentiment;
  const shouldEscalate = analysis.escalation.shouldEscalate;

  // Si debe escalarse, retornar mensaje de escalación
  if (shouldEscalate) {
    const escalationMessages = {
      'CLIENTE_EN_TIENDA': `${clientName}, veo que estás en nuestra zona 🎯. Conectándote con un agente que te pueda ayudar en tiempo real...`,
      'QUEJA_CLIENTE': `Entiendo tu preocupación, ${clientName}. Déjame conectarte con un especialista que pueda resolver esto 🤝`,
      'SENTIMIENTO_NEGATIVO': `${clientName}, quiero asegurarme de atenderte bien. Hablemos con un agente directamente 👥`,
      'NO_ENTENDIDO': `Disculpa, creo que no estoy captando bien tu solicitud. Voy a conectarte con alguien que pueda ayudarte mejor 💬`,
      'MODIFICACIONES_COMPLEJAS': `Veo que necesitas varios cambios. Mejor hablo con un agente que te dé las mejores opciones 📋`
    };

    return {
      message: escalationMessages[analysis.escalation.reason] || `${clientName}, conectándote con un agente ahora...`,
      shouldEscalate: true,
      reason: analysis.escalation.reason
    };
  }

  // Respuestas basadas en intención
  const responseTemplates = {
    'ORDER': `¡Perfecto ${clientName}! 📦 Capturemos tu pedido. ¿Qué tipo de comida te llama la atención hoy?`,
    'PRICE_INQUIRY': `¡Claro! 💰 Tengo varias opciones para ti. ¿Qué tipo de comida buscas?`,
    'HOURS_INQUIRY': `📅 Estamos abiertos de lunes a domingo, 10 AM a 10 PM. ¿En qué te puedo ayudar?`,
    'LOCATION': `📍 Perfecto, voy a confirmar tu ubicación. ¿Es esta tu dirección de entrega?`,
    'DELIVERY_INQUIRY': `🚗 Claro, calculemos el delivery para ti. ¿Cuál es tu ubicación?`,
    'MODIFY_ORDER': `✏️ Sin problema ${clientName}, ajustemos tu pedido. ¿Qué quieres cambiar?`,
    'STATUS_CHECK': `📦 Déjame checar el estado de tu pedido...`,
    'SATISFACTION': `¡Gracias ${clientName}! 💓 Tu satisfacción es lo más importante para nosotros.`,
    'COMPLAINT': `${clientName}, lamento oír esto. Un especialista va a ayudarte ahora mismo...`,
    'UNKNOWN': `Hola ${clientName}! 👋 Dime, ¿en qué te puedo ayudar hoy?`
  };

  return {
    message: responseTemplates[intention] || responseTemplates['UNKNOWN'],
    shouldEscalate: false,
    intention: intention
  };
}

export {
  ConversationContext,
  processMessage,
  smartProcess,
  analyzeEscalationNeeds,
  getRecommendedAction,
  validateMessage,
  generateContextAwareResponse,
};

export default {
  ConversationContext,
  processMessage,
  smartProcess,
  analyzeEscalationNeeds,
  getRecommendedAction,
  validateMessage,
  generateContextAwareResponse,
};
