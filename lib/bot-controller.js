/**
 * 🎛️ BOT CONTROLLER - Control de Encendido/Apagado
 * 
 * Permite controlar el estado del bot:
 * - Encendido/Apagado
 * - Modo mantenimiento
 * - Monitoreo de salud
 * - Estado general
 */

import { CONFIG } from './config.js';

class BotController {
  constructor() {
    this.status = {
      enabled: CONFIG.BOT_ENABLED,
      maintenanceMode: CONFIG.BOT_MAINTENANCE_MODE,
      version: CONFIG.BOT_VERSION,
      timestamp: new Date(),
      uptime: 0,
      messagesProcessed: 0,
      errorsCount: 0,
      lastError: null,
      health: 'online'
    };
    
    this.startTime = Date.now();
    this.messageCount = 0;
    this.errorCount = 0;
  }

  /**
   * Encender el bot
   */
  enableBot() {
    this.status.enabled = true;
    this.status.maintenanceMode = false;
    this.status.health = 'online';
    this.logAction('BOT_ENABLED', '✅ Bot encendido');
    return { success: true, message: 'Bot encendido correctamente' };
  }

  /**
   * Apagar el bot
   */
  disableBot() {
    this.status.enabled = false;
    this.status.health = 'offline';
    this.logAction('BOT_DISABLED', '⛔ Bot apagado');
    return { success: true, message: 'Bot apagado correctamente' };
  }

  /**
   * Activar modo mantenimiento
   */
  enableMaintenanceMode() {
    this.status.maintenanceMode = true;
    this.status.health = 'maintenance';
    this.logAction('MAINTENANCE_ENABLED', '🔧 Modo mantenimiento activado');
    return { success: true, message: 'Modo mantenimiento activado' };
  }

  /**
   * Desactivar modo mantenimiento
   */
  disableMaintenanceMode() {
    this.status.maintenanceMode = false;
    this.status.health = 'online';
    this.logAction('MAINTENANCE_DISABLED', '✅ Modo mantenimiento desactivado');
    return { success: true, message: 'Modo mantenimiento desactivado' };
  }

  /**
   * Verificar si el bot está disponible
   */
  isBotAvailable() {
    return this.status.enabled && !this.status.maintenanceMode;
  }

  /**
   * Obtener estado actual
   */
  getStatus() {
    const uptime = Date.now() - this.startTime;
    
    return {
      enabled: this.status.enabled,
      maintenanceMode: this.status.maintenanceMode,
      available: this.isBotAvailable(),
      version: this.status.version,
      health: this.status.health,
      uptime: this.formatUptime(uptime),
      uptimeMs: uptime,
      messagesProcessed: this.messageCount,
      errorsCount: this.errorCount,
      lastError: this.status.lastError,
      timestamp: new Date().toISOString(),
      timestamp_unix: Date.now()
    };
  }

  /**
   * Registrar procesamiento de mensaje
   */
  recordMessage() {
    this.messageCount++;
    this.status.messagesProcessed = this.messageCount;
  }

  /**
   * Registrar error
   */
  recordError(error) {
    this.errorCount++;
    this.status.errorsCount = this.errorCount;
    this.status.lastError = {
      message: error.message || String(error),
      timestamp: new Date().toISOString(),
      count: this.errorCount
    };
    
    // Pasar a modo offline si hay demasiados errores
    if (this.errorCount > 10) {
      this.status.health = 'degraded';
    }
    if (this.errorCount > 20) {
      this.status.health = 'critical';
    }
  }

  /**
   * Resetear contadores
   */
  resetCounters() {
    this.messageCount = 0;
    this.errorCount = 0;
    this.status.messagesProcessed = 0;
    this.status.errorsCount = 0;
    this.status.lastError = null;
    this.status.health = 'online';
    this.logAction('COUNTERS_RESET', '🔄 Contadores reseteados');
    return { success: true, message: 'Contadores reseteados' };
  }

  /**
   * Formatear uptime para legibilidad
   */
  formatUptime(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
  }

  /**
   * Logging interno
   */
  logAction(action, message) {
    console.log(`[BOT-CONTROLLER] ${action}: ${message}`);
  }

  /**
   * Healthcheck completo
   */
  getHealthCheck() {
    return {
      status: this.isBotAvailable() ? 'healthy' : 'unhealthy',
      bot: {
        enabled: this.status.enabled,
        maintenanceMode: this.status.maintenanceMode,
        health: this.status.health
      },
      performance: {
        messagesProcessed: this.messageCount,
        errorCount: this.errorCount,
        errorRate: this.messageCount > 0 
          ? ((this.errorCount / this.messageCount) * 100).toFixed(2) + '%'
          : '0%',
        uptime: this.formatUptime(Date.now() - this.startTime)
      },
      version: this.status.version,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Obtener mensaje para el usuario si bot está inactivo
   */
  getUnavailableMessage() {
    if (this.status.maintenanceMode) {
      return {
        error: true,
        message: '🔧 El bot está en modo mantenimiento. Por favor, intenta más tarde.',
        status: 'maintenance'
      };
    }
    
    if (!this.status.enabled) {
      return {
        error: true,
        message: '⛔ El bot está desconectado en este momento. Por favor, intenta más tarde.',
        status: 'offline'
      };
    }

    return null;
  }
}

// Singleton instance
const botController = new BotController();

export default botController;
export { BotController };
