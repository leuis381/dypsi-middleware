/**
 * api/kommo-v2.js
 * 
 * Versión simplificada y funcional del endpoint kommo
 * Con TODAS las capacidades pero estructura más simple
 */

import admin from "firebase-admin";
import { CONFIG } from "../lib/config.js";
import { 
  logger,
  AppError,
  ValidationError,
  validatePhone,
  sanitizeInput,
  sendSuccess,
  sendError
} from "../lib/utils.js";
import aiEngineModule from "../lib/ai-engine.js";
import sessionStore from "../lib/session-store.js";

const { detectIntention, ConversationContext } = aiEngineModule;

// Initialize Firebase
let firebaseInitialized = false;
if (!admin.apps.length && CONFIG.FIREBASE_PROJECT_ID) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: CONFIG.FIREBASE_PROJECT_ID,
        clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
        privateKey: CONFIG.FIREBASE_PRIVATE_KEY,
      }),
    });
    firebaseInitialized = true;
    logger.info('Firebase initialized in kommo-v2');
  } catch (err) {
    logger.error('Firebase init failed:', err.message);
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Health check
  if (req.method === 'GET') {
    return sendSuccess(res, {
      service: 'KOMMO IA v2',
      status: 'running',
      firebase: firebaseInitialized,
      timestamp: new Date().toISOString()
    });
  }
  
  // POST - Process message
  if (req.method !== 'POST') {
    return sendError(res, new AppError('Method Not Allowed', 405, 'METHOD_NOT_ALLOWED'));
  }
  
  try {
    const { telefono, nombre, mensaje, tipo } = req.body;
    
    // Validate
    if (!telefono) {
      throw new ValidationError('telefono is required');
    }
    if (!mensaje) {
      throw new ValidationError('mensaje is required');
    }
    
    validatePhone(telefono);
    const cleanMessage = sanitizeInput(mensaje, 2000);
    const cleanName = sanitizeInput(nombre || 'Cliente', 100);
    const messageType = tipo || 'text';
    
    logger.info('Processing message', { telefono, tipo: messageType });
    
    // Get or create context
    let context;
    try {
      const session = await sessionStore.getSession(telefono);
      if (session?.context) {
        context = Object.assign(new ConversationContext({ userId: telefono, name: cleanName }), session.context);
      } else {
        context = new ConversationContext({ userId: telefono, name: cleanName });
      }
    } catch (err) {
      logger.warn('Failed to load session, using new context', { error: err.message });
      context = new ConversationContext({ userId: telefono, name: cleanName });
    }
    
    // Add message to context
    context.addMessage({
      role: 'user',
      content: cleanMessage,
      timestamp: Date.now()
    });
    
    // Detect intention
    const intentionResult = detectIntention(cleanMessage, context);
    logger.info('Intention detected', { 
      telefono,
      intention: intentionResult.intention,
      confidence: intentionResult.confidence
    });
    
    // Generate response based on intention
    let reply = '';
    switch (intentionResult.intention) {
      case 'ORDER':
        reply = `✅ Perfecto, entiendo que quieres hacer un pedido. ¿Qué te gustaría ordenar?`;
        break;
      case 'GREETING':
        reply = `¡Hola ${cleanName}! 👋 Bienvenido a Pizza Dypsi. ¿En qué puedo ayudarte hoy?`;
        break;
      case 'QUERY_MENU':
        reply = `📋 Tenemos deliciosas pizzas, pollos a la brasa, pastas y más. ¿Qué te gustaría conocer?`;
        break;
      case 'QUERY_PRICE':
        reply = `💰 Con gusto te ayudo con los precios. ¿De qué producto quieres saber el precio?`;
        break;
      case 'LOCATION':
        reply = `📍 Perfecto, necesito tu dirección para calcular el delivery. ¿Cuál es tu dirección?`;
        break;
      case 'COMPLAINT':
        reply = `😔 Lamento mucho que tengas un inconveniente. Un agente se comunicará contigo pronto.`;
        break;
      case 'THANKS':
        reply = `😊 ¡De nada! Estamos para servirte. ¿Necesitas algo más?`;
        break;
      default:
        reply = `Entiendo. ¿Puedes darme más detalles sobre lo que necesitas?`;
    }
    
    // Add bot response to context
    context.addMessage({
      role: 'assistant',
      content: reply,
      timestamp: Date.now()
    });
    
    // Save session
    try {
      await sessionStore.saveSession(telefono, {
        context: {
          userId: context.userId,
          userName: context.userName,
          recentMessages: context.recentMessages,
          currentIntention: context.currentIntention,
          previousIntentions: context.previousIntentions
        },
        lastActivity: Date.now()
      });
    } catch (err) {
      logger.warn('Failed to save session', { error: err.message });
    }
    
    // Return response
    return sendSuccess(res, {
      telefono,
      nombre: cleanName,
      mensaje: cleanMessage,
      tipo: messageType,
      intention: intentionResult.intention,
      confidence: intentionResult.confidence,
      reply,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    logger.error('Handler error', { 
      error: err.message,
      stack: err.stack
    });
    
    if (err instanceof ValidationError) {
      return sendError(res, err);
    }
    
    if (err instanceof AppError) {
      return sendError(res, err);
    }
    
    return sendError(res, new AppError('Internal server error', 500, 'INTERNAL_ERROR'));
  }
}
