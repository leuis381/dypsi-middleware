/**
 * lib/health.js
 *
 * Endpoint robusto de health check para monitoreo
 * - Métricas de runtime (uptime, memoria, carga)
 * - Verificación de variables de entorno críticas
 * - Verificación de conectividad a WhatsApp API
 * - Verificación de menu.json local
 * - Health check de DNS para database URL
 * - GET /api/health
 */

import axios from 'axios';
import fs from 'fs/promises';
import os from 'os';
import dns from 'dns/promises';
import path from 'path';
import { 
  logger, 
  AppError, 
  asyncHandler, 
  sendSuccess,
  MetricsCollector,
  Cache
} from './utils.js';
import CONFIG from './config.js';

const WHATSAPP_GRAPH_BASE = 'https://graph.facebook.com';
const WHATSAPP_TIMEOUT_MS = 3000; // Timeout corto para health probe
const LOCAL_MENU_PATH = CONFIG.MENU_DATA_PATH;
const PACKAGE_JSON_PATH = path.resolve(process.cwd(), 'package.json');

const metrics = new MetricsCollector();
const healthCache = new Cache(30000); // 30s cache for health checks

/**
 * Verifica la conectividad con WhatsApp Graph API
 * @returns {Object} { ok, status, reason, details }
 * @private
 */
async function checkWhatsApp() {
  const startTime = Date.now();
  try {
    const id = CONFIG.WHATSAPP_BUSINESS_ID;
    const token = CONFIG.WHATSAPP_TOKEN;

    if (!id || !token) {
      logger.debug('HEALTH_WHATSAPP_NOT_CONFIGURED');
      metrics.record('health.whatsapp.not_configured', 1);
      return { ok: false, reason: 'not_configured', details: 'WHATSAPP_BUSINESS_ID o WHATSAPP_TOKEN no configurados' };
    }

    const url = `${WHATSAPP_GRAPH_BASE}/v18.0/${id}`;
    logger.debug('HEALTH_WHATSAPP_CHECK_START', { url: url.substring(0, 50) });

    const response = await axios.get(url, {
      timeout: WHATSAPP_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true
    });

    const duration = Date.now() - startTime;

    if (response.status === 200) {
      logger.info('HEALTH_WHATSAPP_OK', { status: response.status, duration_ms: duration });
      metrics.record('health.whatsapp.success', 1);
      metrics.record('health.whatsapp.duration_ms', duration);
      return { ok: true, status: response.status, details: 'WhatsApp Graph API accesible' };
    }

    logger.warn('HEALTH_WHATSAPP_ERROR', { status: response.status, duration_ms: duration });
    metrics.record('health.whatsapp.error', 1);
    return {
      ok: false,
      status: response.status,
      reason: 'api_error',
      details: `HTTP ${response.status}`
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.warn('HEALTH_WHATSAPP_PROBE_FAILED', { error: error.message, code: error.code, duration_ms: duration });
    metrics.record('health.whatsapp.failure', 1);
    return {
      ok: false,
      reason: 'network_error',
      details: error.message || 'Error de red',
      code: error.code
    };
  }
}

/**
 * Verifica la integridad del menu.json local
 * @returns {Object} { ok, path, size_bytes, reason, details }
 * @private
 */
async function checkLocalMenu() {
  const startTime = Date.now();
  try {
    logger.debug('HEALTH_MENU_CHECK_START', { path: LOCAL_MENU_PATH });

    const stat = await fs.stat(LOCAL_MENU_PATH);

    if (!stat.isFile()) {
      logger.warn('HEALTH_MENU_NOT_FILE', { path: LOCAL_MENU_PATH });
      metrics.record('health.menu.not_file', 1);
      return { ok: false, reason: 'not_a_file', path: LOCAL_MENU_PATH };
    }

    // Leer y validar JSON
    const content = await fs.readFile(LOCAL_MENU_PATH, 'utf8');

    if (!content || content.length === 0) {
      logger.warn('HEALTH_MENU_EMPTY', { path: LOCAL_MENU_PATH });
      metrics.record('health.menu.empty', 1);
      return { ok: false, reason: 'empty_file', path: LOCAL_MENU_PATH };
    }

    try {
      JSON.parse(content);
    } catch (jsonError) {
      logger.warn('HEALTH_MENU_INVALID_JSON', { path: LOCAL_MENU_PATH, error: jsonError.message });
      metrics.record('health.menu.invalid_json', 1);
      return { ok: false, reason: 'invalid_json', path: LOCAL_MENU_PATH, details: jsonError.message };
    }

    const duration = Date.now() - startTime;
    logger.info('HEALTH_MENU_OK', { path: LOCAL_MENU_PATH, size_bytes: stat.size, duration_ms: duration });
    metrics.record('health.menu.success', 1);
    metrics.record('health.menu.duration_ms', duration);
    return { ok: true, path: LOCAL_MENU_PATH, size_bytes: stat.size, valid_json: true };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.warn('HEALTH_MENU_CHECK_FAILED', { error: error.message, code: error.code, duration_ms: duration });
    metrics.record('health.menu.failure', 1);
    return {
      ok: false,
      reason: 'file_error',
      path: LOCAL_MENU_PATH,
      details: error.message || 'Error accediendo archivo',
      code: error.code
    };
  }
}

/**
 * Verifica la conectividad DNS para DATABASE_URL
 * @returns {Object} { ok, host, address, family, reason, details }
 * @private
 */
async function checkDatabaseDns() {
  const startTime = Date.now();
  try {
    const dbUrl = process.env.DATABASE_URL || process.env.DB_URL;

    if (!dbUrl) {
      logger.debug('HEALTH_DATABASE_NOT_CONFIGURED');
      return { ok: null, reason: 'no_database_configured', details: 'DATABASE_URL no configurada' };
    }

    logger.debug('HEALTH_DATABASE_CHECK_START', { urlPrefix: dbUrl.substring(0, 20) });

    // Parsear URL de forma segura
    let url;
    try {
      url = new URL(dbUrl);
    } catch (urlError) {
      logger.warn('HEALTH_DATABASE_INVALID_URL', { error: urlError.message });
      metrics.record('health.database.invalid_url', 1);
      return { ok: false, reason: 'invalid_url', details: 'DATABASE_URL no es una URL válida' };
    }

    const host = url.hostname;
    const port = url.port || null;

    const records = await dns.lookup(host);

    const duration = Date.now() - startTime;
    logger.info('HEALTH_DATABASE_DNS_OK', { host, address: records.address, duration_ms: duration });
    metrics.record('health.database.success', 1);
    metrics.record('health.database.duration_ms', duration);
    return { ok: true, host, port, address: records.address, family: `IPv${records.family}` };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.warn('HEALTH_DATABASE_DNS_FAILED', { error: error.message, code: error.code, duration_ms: duration });
    metrics.record('health.database.failure', 1);
    return {
      ok: false,
      reason: 'dns_lookup_failed',
      details: error.message || 'Error resolviendo DNS',
      code: error.code
    };
  }
}

/**
 * Lee información del package.json
 * @returns {Object} { ok, name, version }
 * @private
 */
async function readPackageInfo() {
  try {
    const content = await fs.readFile(PACKAGE_JSON_PATH, 'utf8');
    const pkg = JSON.parse(content);
    return { ok: true, name: pkg.name || 'unknown', version: pkg.version || 'unknown' };
  } catch (error) {
    logger.warn('HEALTH_PACKAGE_READ_FAILED', { error: error.message });
    return { ok: false, error: error.message };
  }
}

/**
 * Obtiene métricas de runtime del proceso
 * @returns {Object} Métricas de memoria, CPU, uptime, etc.
 * @private
 */
function getRuntimeMetrics() {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const load = os.loadavg();

  return {
    uptime_seconds: Math.floor(uptime),
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024)
    },
    cpu: {
      cores: os.cpus().length,
      load_average: {
        '1m': load[0].toFixed(2),
        '5m': load[1].toFixed(2),
        '15m': load[2].toFixed(2)
      }
    },
    system: {
      free_memory_mb: Math.round(os.freemem() / 1024 / 1024),
      total_memory_mb: Math.round(os.totalmem() / 1024 / 1024)
    }
  };
}

/**
 * Handler de health check
 * GET /api/health
 * Devuelve estado general del servicio con métricas detalladas
 */
export default asyncHandler(async (req, res) => {
  const requestId = `health_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info('HEALTH_CHECK_REQUEST', { method: req.method, ip: req.ip, requestId });
  metrics.record('health.request', 1);

  // Solo permitir GET
  if (req.method !== 'GET') {
    logger.warn('HEALTH_INVALID_METHOD', { method: req.method, requestId });
    res.setHeader('Allow', 'GET');
    metrics.record('health.invalid_method', 1);
    return sendSuccess(res, { ok: false, error: 'Use GET method' }, 405);
  }

  const startTime = Date.now();

  try {
    // Check cache first
    const cached = healthCache.get('health_status');
    if (cached) {
      logger.debug('HEALTH_CACHE_HIT', { requestId });
      metrics.record('health.cache_hit', 1);
      const cachedPayload = {
        ...cached,
        cached: true,
        cache_age_ms: Date.now() - cached.computed_at
      };
      return sendSuccess(res, cachedPayload, 200);
    }

    // Recopilar información del paquete
    const pkg = await readPackageInfo();

    // Obtener métricas de runtime
    const runtime = getRuntimeMetrics();

    // Verificar variables de entorno críticas
    const env = {
      NODE_ENV: process.env.NODE_ENV || 'development',
      WHATSAPP_CONFIGURED: !!(CONFIG.WHATSAPP_BUSINESS_ID && CONFIG.WHATSAPP_TOKEN),
      DATABASE_CONFIGURED: !!(process.env.DATABASE_URL || process.env.DB_URL),
      VERCEL_DEPLOYED: !!process.env.VERCEL
    };

    logger.debug('HEALTH_ENV_CHECK', { ...env, requestId });

    // Ejecutar checks en paralelo con timeout
    logger.debug('HEALTH_RUNNING_PROBES', { requestId });

    const probes = await Promise.allSettled([
      checkWhatsApp(),
      checkLocalMenu(),
      checkDatabaseDns()
    ]);

    // Procesar resultados de probes
    const whatsappProbe = probes[0].status === 'fulfilled'
      ? probes[0].value
      : { ok: false, reason: 'probe_failed', details: String(probes[0].reason) };

    const localMenuProbe = probes[1].status === 'fulfilled'
      ? probes[1].value
      : { ok: false, reason: 'probe_failed', details: String(probes[1].reason) };

    const databaseProbe = probes[2].status === 'fulfilled'
      ? probes[2].value
      : { ok: false, reason: 'probe_failed', details: String(probes[2].reason) };

    // Determinar estado general
    const criticalFailures = [];
    const warnings = [];

    // WhatsApp es opcional si no está configurado
    if (env.WHATSAPP_CONFIGURED && !whatsappProbe.ok) {
      criticalFailures.push({ component: 'whatsapp', ...whatsappProbe });
    }

    // Menu local es crítico
    if (!localMenuProbe.ok) {
      criticalFailures.push({ component: 'local_menu', ...localMenuProbe });
    }

    // Database es warning, no crítico
    if (env.DATABASE_CONFIGURED && databaseProbe.ok === false) {
      warnings.push({ component: 'database_dns', ...databaseProbe });
    }

    // Duración total del health check
    const duration_ms = Date.now() - startTime;

    const payload = {
      ok: criticalFailures.length === 0,
      service: 'delivery-middleware',
      status: criticalFailures.length === 0 ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      duration_ms,
      version: pkg.ok ? `${pkg.name}@${pkg.version}` : 'unknown',
      environment: env,
      runtime,
      probes: {
        whatsapp: whatsappProbe,
        local_menu: localMenuProbe,
        database: databaseProbe
      },
      issues: {
        critical: criticalFailures,
        warnings
      },
      computed_at: Date.now()
    };

    // Cache the result
    healthCache.set('health_status', payload);

    logger.info('HEALTH_CHECK_COMPLETE', {
      ok: payload.ok,
      status: payload.status,
      duration_ms,
      criticalFailures: criticalFailures.length,
      warnings: warnings.length,
      requestId
    });
    
    metrics.record('health.success', 1);
    metrics.record('health.duration_ms', duration_ms);
    if (criticalFailures.length > 0) {
      metrics.record('health.degraded', 1);
    }

    // Devolver 200 incluso si degradado (para que monitoring lea los detalles)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Content-Type', 'application/json');

    return sendSuccess(res, payload, 200);

  } catch (error) {
    logger.error('HEALTH_CHECK_FAILED', { error: error.message, requestId });
    metrics.record('health.error', 1);

    const duration_ms = Date.now() - startTime;

    const errorPayload = {
      ok: false,
      service: 'delivery-middleware',
      status: 'error',
      timestamp: new Date().toISOString(),
      duration_ms,
      error: error.message || 'Unknown error',
      issues: {
        critical: [{ component: 'health_check', error: error.message }]
      }
    };

    return sendSuccess(res, errorPayload, 200);
  }
});