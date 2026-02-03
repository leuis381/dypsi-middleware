/**
 * 🎛️ BOT CONTROL ENDPOINT
 * 
 * API para controlar el bot:
 * - POST /api/bot/enable - Encender bot
 * - POST /api/bot/disable - Apagar bot
 * - POST /api/bot/maintenance/on - Activar mantenimiento
 * - POST /api/bot/maintenance/off - Desactivar mantenimiento
 * - GET /api/bot/status - Obtener estado
 * - GET /api/bot/health - Health check completo
 * - POST /api/bot/reset - Resetear contadores
 */

import botController from './lib/bot-controller.js';

/**
 * Controlador de endpoints del bot
 */
export const handleBotControl = async (req, res) => {
  const { method, url } = req;

  try {
    // POST /api/bot/enable
    if (method === 'POST' && url === '/api/bot/enable') {
      const result = botController.enableBot();
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    }

    // POST /api/bot/disable
    if (method === 'POST' && url === '/api/bot/disable') {
      const result = botController.disableBot();
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    }

    // POST /api/bot/maintenance/on
    if (method === 'POST' && url === '/api/bot/maintenance/on') {
      const result = botController.enableMaintenanceMode();
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    }

    // POST /api/bot/maintenance/off
    if (method === 'POST' && url === '/api/bot/maintenance/off') {
      const result = botController.disableMaintenanceMode();
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    }

    // GET /api/bot/status
    if (method === 'GET' && url === '/api/bot/status') {
      const status = botController.getStatus();
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status));
    }

    // GET /api/bot/health
    if (method === 'GET' && url === '/api/bot/health') {
      const health = botController.getHealthCheck();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      return res.writeHead(statusCode, { 'Content-Type': 'application/json' }).end(JSON.stringify(health));
    }

    // POST /api/bot/reset
    if (method === 'POST' && url === '/api/bot/reset') {
      const result = botController.resetCounters();
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    }

    return false; // No route matched
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
};

/**
 * Middleware para verificar si el bot está disponible
 */
export const requireBotAvailable = (handler) => {
  return async (req, res, message) => {
    if (!botController.isBotAvailable()) {
      const unavailableMsg = botController.getUnavailableMessage();
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(unavailableMsg));
    }

    botController.recordMessage();
    
    try {
      return await handler(req, res, message);
    } catch (error) {
      botController.recordError(error);
      throw error;
    }
  };
};

export default {
  handleBotControl,
  requireBotAvailable,
  botController
};
