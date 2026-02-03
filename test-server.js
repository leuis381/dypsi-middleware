/**
 * test-server.js
 * Servidor de prueba completo con todos los endpoints
 * Corre en http://localhost:3000
 */

import http from 'http';
import url from 'url';
import fuzzyMatcherExport from './lib/fuzzy-matcher.js';
import advancedNLPExport from './lib/advanced-nlp.js';
import smartInterpreterExport from './lib/smart-interpreter.js';

const PORT = 3000;

const fuzzyMatcher = fuzzyMatcherExport;
const advancedNLP = advancedNLPExport;
const smartInterpreter = smartInterpreterExport;

// Bot state
let botState = {
  enabled: true,
  maintenanceMode: false,
  health: 'online',
  messagesProcessed: 0,
  errors: 0,
  startTime: Date.now()
};

const parseJSON = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

const sendJSON = (res, statusCode, data) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
};

const handleRequest = async (req, res, parsedUrl, body) => {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  console.log(`[${new Date().toISOString()}] ${method} ${pathname}`);

  // ════════════════════════════════════════════════════════════
  // GET ENDPOINTS
  // ════════════════════════════════════════════════════════════

  if (method === 'GET') {
    // Health check
    if (pathname === '/health' || pathname === '/api/health') {
      return sendJSON(res, 200, {
        ok: true,
        service: 'DYPSI BOT v4.0 ULTRA+',
        status: 'online',
        version: '4.0 ULTRA+',
        timestamp: new Date().toISOString(),
        bot: botState
      });
    }

    // Bot status
    if (pathname === '/api/bot/status') {
      return sendJSON(res, 200, {
        ok: true,
        bot: {
          enabled: botState.enabled,
          maintenanceMode: botState.maintenanceMode,
          health: botState.health,
          available: botState.enabled && !botState.maintenanceMode,
          version: '4.0 ULTRA+'
        }
      });
    }

    // Bot health
    if (pathname === '/api/bot/health') {
      const uptime = Date.now() - botState.startTime;
      const uptimeStr = `${Math.floor(uptime / 86400000)}d ${Math.floor((uptime % 86400000) / 3600000)}h`;
      
      return sendJSON(res, 200, {
        ok: true,
        health: {
          status: botState.health,
          messagesProcessed: botState.messagesProcessed,
          errors: botState.errors,
          uptime: uptimeStr,
          enabled: botState.enabled,
          maintenanceMode: botState.maintenanceMode
        }
      });
    }

    // Stats
    if (pathname === '/api/stats') {
      return sendJSON(res, 200, {
        ok: true,
        stats: {
          messagesProcessed: botState.messagesProcessed,
          errors: botState.errors,
          errorRate: botState.messagesProcessed > 0 
            ? ((botState.errors / botState.messagesProcessed) * 100).toFixed(2) + '%'
            : '0%'
        }
      });
    }

    // Check if this is a POST-only endpoint accessed with GET
    const postOnlyEndpoints = [
      '/api/message',
      '/api/location',
      '/api/bot/enable',
      '/api/bot/disable',
      '/api/bot/maintenance/on',
      '/api/bot/maintenance/off',
      '/api/bot/reset'
    ];

    if (postOnlyEndpoints.includes(pathname)) {
      return sendJSON(res, 405, { error: 'Método no permitido - Este endpoint solo acepta POST' });
    }

    return sendJSON(res, 404, { error: 'Endpoint no encontrado' });
  }

  // ════════════════════════════════════════════════════════════
  // POST ENDPOINTS
  // ════════════════════════════════════════════════════════════

  if (method === 'POST') {
    // Parse JSON with error handling
    let data = {};
    if (body && body.trim().length > 0) {
      try {
        data = JSON.parse(body);
      } catch (error) {
        // JSON inválido - devolver 400 en lugar de 500
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'JSON inválido en el body del request',
            code: 'JSON_PARSE_ERROR',
            details: error.message
          }
        });
      }
    }

    // Message endpoint
    if (pathname === '/api/message') {
      // Validate required fields with strict type checking
      if (!data.userId) {
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'userId es requerido',
            code: 'VALIDATION_ERROR'
          }
        });
      }

      if (!data.message) {
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'message es requerido',
            code: 'VALIDATION_ERROR'
          }
        });
      }

      // Validate message type - must be string
      if (typeof data.message !== 'string') {
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'message debe ser un string',
            code: 'INVALID_TYPE'
          }
        });
      }

      // Validate message not only whitespace
      if (!data.message.trim()) {
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'message no puede estar vacío o contener solo espacios',
            code: 'EMPTY_MESSAGE'
          }
        });
      }

      // Validate message length (max 500 chars)
      if (data.message.length > 500) {
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'message no puede exceder 500 caracteres',
            code: 'MESSAGE_TOO_LONG'
          }
        });
      }

      try {
        botState.messagesProcessed++;

        // Analyze message
        const analysis = advancedNLP.analyzeMessage ? 
          advancedNLP.analyzeMessage(data.message) : 
          { intention: 'ORDER', confidence: 0.85, sentiment: 'neutral', location: null };

        return sendJSON(res, 200, {
          ok: true,
          userId: data.userId,
          message: data.message,
          analysis: {
            intention: analysis.intention || 'UNKNOWN',
            confidence: analysis.confidence || 0.5,
            sentiment: analysis.sentiment || 'neutral',
            hasLocation: analysis.location !== null,
            shouldEscalate: false
          },
          processed: true
        });
      } catch (error) {
        botState.errors++;
        return sendJSON(res, 500, {
          ok: false,
          error: {
            message: error.message,
            code: 'PROCESSING_ERROR'
          }
        });
      }
    }

    // Location endpoint
    if (pathname === '/api/location') {
      if (!data.userId) {
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'userId es requerido',
            code: 'VALIDATION_ERROR'
          }
        });
      }

      // Support two formats:
      // 1. {"address": "..."} or {"latitude": ..., "longitude": ...}
      // 2. {"location": "lat,lon"}
      let coordinates = null;
      let address = null;

      // Format 1: address or latitude/longitude fields
      if (data.latitude && data.longitude) {
        const lat = parseFloat(data.latitude);
        const lon = parseFloat(data.longitude);
        
        // Check if parsing successful
        if (!isNaN(lat) && !isNaN(lon)) {
          coordinates = { lat, lon };
        }
      } else if (data.address) {
        address = data.address;
      }

      // Format 2: location as "lat,lon" string
      if (data.location && !coordinates) {
        // Allow multiple signs (for chaos testing) - normalize before parsing
        // Split by comma first
        const parts = data.location.split(',');
        if (parts.length === 2) {
          // Clean up each part: remove all signs except the last minus
          const cleanLat = parts[0].replace(/[+-]/g, '');
          const cleanLon = parts[1].replace(/[+-]/g, '');
          
          // Check if parts contain only digits and dots (valid number format)
          if (/^[\d.]+$/.test(cleanLat) && /^[\d.]+$/.test(cleanLon)) {
            // Add back the sign if it was present
            const shouldBeNegativeLat = parts[0].startsWith('-');
            const shouldBeNegativeLon = parts[1].startsWith('-');
            
            const lat = parseFloat((shouldBeNegativeLat ? '-' : '') + cleanLat);
            const lon = parseFloat((shouldBeNegativeLon ? '-' : '') + cleanLon);
            
            // Check if parsing was successful
            if (!isNaN(lat) && !isNaN(lon)) {
              coordinates = { lat, lon };
            }
          }
        }
      }

      // Validate that we got either coordinates or address
      if (!coordinates && !address) {
        return sendJSON(res, 400, {
          ok: false,
          error: {
            message: 'Proporciona dirección o coordenadas (latitud y longitud o location)',
            code: 'VALIDATION_ERROR'
          }
        });
      }

      try {
        botState.messagesProcessed++;

        const location = {
          userId: data.userId,
          address: address || null,
          coordinates: coordinates,
          valid: true
        };

        return sendJSON(res, 200, {
          ok: true,
          location: location,
          processed: true
        });
      } catch (error) {
        botState.errors++;
        return sendJSON(res, 500, {
          ok: false,
          error: { message: error.message, code: 'PROCESSING_ERROR' }
        });
      }
    }

    // Bot enable
    if (pathname === '/api/bot/enable') {
      botState.enabled = true;
      botState.maintenanceMode = false;
      botState.health = 'online';
      return sendJSON(res, 200, {
        ok: true,
        message: 'Bot encendido',
        bot: botState
      });
    }

    // Bot disable
    if (pathname === '/api/bot/disable') {
      botState.enabled = false;
      botState.health = 'offline';
      return sendJSON(res, 200, {
        ok: true,
        message: 'Bot apagado',
        bot: botState
      });
    }

    // Bot maintenance ON
    if (pathname === '/api/bot/maintenance/on') {
      botState.maintenanceMode = true;
      botState.health = 'maintenance';
      return sendJSON(res, 200, {
        ok: true,
        message: 'Modo mantenimiento activado',
        bot: botState
      });
    }

    // Bot maintenance OFF
    if (pathname === '/api/bot/maintenance/off') {
      botState.maintenanceMode = false;
      botState.enabled = true;
      botState.health = 'online';
      return sendJSON(res, 200, {
        ok: true,
        message: 'Modo mantenimiento desactivado',
        bot: botState
      });
    }

    // Bot status (POST)
    if (pathname === '/api/bot/status') {
      const uptime = Date.now() - botState.startTime;
      return sendJSON(res, 200, {
        ok: true,
        status: {
          enabled: botState.enabled,
          maintenanceMode: botState.maintenanceMode,
          health: botState.health,
          available: botState.enabled && !botState.maintenanceMode,
          uptime: uptime,
          messagesProcessed: botState.messagesProcessed,
          errors: botState.errors
        }
      });
    }

    // Bot reset
    if (pathname === '/api/bot/reset') {
      botState.messagesProcessed = 0;
      botState.errors = 0;
      return sendJSON(res, 200, {
        ok: true,
        message: 'Contadores reseteados',
        bot: botState
      });
    }

    return sendJSON(res, 404, { error: 'Endpoint no encontrado' });
  }

  // Method not allowed
  sendJSON(res, 405, { error: 'Método no permitido' });
};

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL
  const parsedUrl = url.parse(req.url, true);

  // Collect body
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      await handleRequest(req, res, parsedUrl, body);
    } catch (error) {
      console.error('Error:', error);
      sendJSON(res, 500, { error: 'Error interno del servidor' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════════╗`);
  console.log(`║                                            ║`);
  console.log(`║  🚀 SERVIDOR DE TEST INICIADO              ║`);
  console.log(`║     http://localhost:${PORT}                    ║`);
  console.log(`║                                            ║`);
  console.log(`║  Endpoints:                                ║`);
  console.log(`║    GET  /health                            ║`);
  console.log(`║    GET  /api/health                        ║`);
  console.log(`║    GET  /api/bot/status                    ║`);
  console.log(`║    GET  /api/stats                         ║`);
  console.log(`║    POST /api/message                       ║`);
  console.log(`║    POST /api/location                      ║`);
  console.log(`║    POST /api/bot/enable                    ║`);
  console.log(`║    POST /api/bot/disable                   ║`);
  console.log(`║    POST /api/bot/maintenance/on            ║`);
  console.log(`║    POST /api/bot/maintenance/off           ║`);
  console.log(`║    POST /api/bot/reset                     ║`);
  console.log(`║                                            ║`);
  console.log(`╚════════════════════════════════════════════╝`);
});

process.on('SIGINT', () => {
  console.log('\n✅ Servidor detenido');
  process.exit(0);
});
