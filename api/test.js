/**
 * api/test.js
 * 
 * Endpoint de prueba SIMPLE para Kommo/IA
 * Sin dependencias de Firebase ni configuración compleja
 * Perfecto para testing y desarrollo
 */

export default async function handler(req, res) {
  // Headers de CORS y seguridad
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // GET - Health check
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'DYPSI Bot v4.0 ULTRA+ (Test Mode)',
      status: 'running',
      endpoint: '/api/test',
      mode: 'SIMPLE_TEST',
      ready: true
    });
  }

  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  try {
    const { telefono, nombre, mensaje, tipo, imagen, ubicacion } = req.body;

    // Validación básica
    if (!telefono || !mensaje) {
      return res.status(400).json({
        ok: false,
        error: {
          message: 'telefono y mensaje son requeridos',
          code: 'VALIDATION_ERROR'
        }
      });
    }

    // Simular análisis de intención
    const lowerMsg = mensaje.toLowerCase();
    let intention = 'ORDER';
    let confidence = 0.85;

    if (lowerMsg.includes('menú') || lowerMsg.includes('que tienen') || lowerMsg.includes('opciones')) {
      intention = 'MENU_QUERY';
      confidence = 0.95;
    } else if (lowerMsg.includes('hablar con agente') || lowerMsg.includes('gerente') || lowerMsg.includes('queja')) {
      intention = 'ESCALATION';
      confidence = 0.92;
    } else if (lowerMsg.includes('¿') || lowerMsg.includes('?')) {
      intention = 'HELP';
      confidence = 0.88;
    }

    // Simular extracción de items
    const extractedItems = [];
    if (lowerMsg.includes('pizza') || lowerMsg.includes('piza')) {
      const sizeMatch = mensaje.match(/(pequeña|mediana|grande|xl)/i);
      const flavorMatch = mensaje.match(/(hawaiana|pepperoni|margherita|vegetariana|queso|champiñones)/i);
      
      extractedItems.push({
        item: 'pizza',
        size: sizeMatch ? sizeMatch[1].toLowerCase() : 'mediana',
        flavors: flavorMatch ? [flavorMatch[1].toLowerCase()] : [],
        quantity: 1
      });
    }

    // Respuesta
    return res.status(200).json({
      ok: true,
      telefono,
      nombre: nombre || 'Cliente',
      message: mensaje,
      analysis: {
        intention,
        confidence,
        sentiment: 'positive',
        hasLocation: !!ubicacion,
        hasImage: !!imagen,
        extractedItems,
        shouldEscalate: intention === 'ESCALATION'
      },
      reply: generateReply(intention, mensaje),
      processed: true,
      mode: 'TEST',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in test endpoint:', error);
    return res.status(500).json({
      ok: false,
      error: {
        message: error.message || 'Internal server error',
        code: 'ERROR'
      }
    });
  }
}

function generateReply(intention, mensaje) {
  if (intention === 'MENU_QUERY') {
    return '🍕 Contamos con las siguientes pizzas:\n\n' +
           '• Margarita - $12.99\n' +
           '• Pepperoni - $14.99\n' +
           '• Hawaiana - $15.99\n' +
           '• Vegetariana - $13.99\n' +
           '• Especial de la Casa - $18.99';
  }

  if (intention === 'ESCALATION') {
    return '👤 Entendido, te voy a conectar con un agente especializado. Por favor espera un momento.';
  }

  if (intention === 'HELP') {
    return 'Puedo ayudarte con: 🍕 hacer un pedido, 📋 consultar el menú, 🗺️ indicar tu ubicación, o 📞 hablar con un agente. ¿En qué puedo ayudarte?';
  }

  // Orden
  return '✅ Perfecto, entendí tu pedido. ¿Hay algo más que quieras agregar?';
}
