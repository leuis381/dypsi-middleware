/**
 * lib/utils.js
 * 
 * Utilidades compartidas para todo el middleware
 * - Error handling robusto
 * - Logging centralizado
 * - Rate limiting
 * - Validación de datos
 * - Retry logic
 * - Caching
 * - Security utilities
 */

/* ========== LOGGING ========== */

const LOG_LEVELS = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5
};

const LOG_LEVEL = process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL] : LOG_LEVELS.INFO;

export const logger = {
  trace: (...args) => LOG_LEVEL <= LOG_LEVELS.TRACE && console.log('[TRACE]', new Date().toISOString(), ...args),
  debug: (...args) => LOG_LEVEL <= LOG_LEVELS.DEBUG && console.log('[DEBUG]', new Date().toISOString(), ...args),
  info: (...args) => LOG_LEVEL <= LOG_LEVELS.INFO && console.log('[INFO]', new Date().toISOString(), ...args),
  warn: (...args) => LOG_LEVEL <= LOG_LEVELS.WARN && console.warn('[WARN]', new Date().toISOString(), ...args),
  error: (...args) => LOG_LEVEL <= LOG_LEVELS.ERROR && console.error('[ERROR]', new Date().toISOString(), ...args),
  fatal: (...args) => { console.error('[FATAL]', new Date().toISOString(), ...args); process.exit(1); }
};

/* ========== ERROR HANDLING ========== */

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.timestamp = new Date();
  }
}

export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', retryAfter = 60) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

export function formatError(error) {
  if (error instanceof AppError) {
    const payload = {
      ok: false,
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        timestamp: error.timestamp
      }
    };

    if (error.exposeDetails && error.details) {
      payload.error.details = error.details;
    }

    return payload;
  }
  
  return {
    ok: false,
    error: {
      message: error.message || 'Unknown error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      timestamp: new Date()
    }
  };
}

/* ========== VALIDATION ========== */

export function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    throw new ValidationError('Phone number is required', { field: 'phone' });
  }
  
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 9) {
    throw new ValidationError('Phone number must be at least 9 digits', { field: 'phone', value: phone });
  }
  
  return cleaned;
}

export function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) {
    throw new ValidationError('Invalid email format', { field: 'email', value: email });
  }
  return email.toLowerCase();
}

export function validateAmount(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    throw new ValidationError('Invalid amount', { field: 'amount', value: amount });
  }
  return Math.round(num * 100) / 100; // 2 decimales
}

export function validateUrl(url) {
  try {
    new URL(url);
    return url;
  } catch {
    throw new ValidationError('Invalid URL', { field: 'url', value: url });
  }
}

export function sanitizeInput(input, maxLength = 500) {
  if (typeof input !== 'string') return '';
  return input
    .substring(0, maxLength)
    .trim()
    .replace(/[<>]/g, ''); // Remove potential HTML/script tags
}

/* ========== RETRY & BACKOFF ========== */

export async function retryAsync(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelayMs = 300,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    shouldRetry = (err) => err.statusCode >= 500 || err.code === 'ECONNREFUSED'
  } = options;

  let lastError;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      logger.warn(`Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms:`, error.message);
      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/* ========== CACHING ========== */

export class Cache {
  constructor(ttlMs = 5 * 60 * 1000) {
    this.store = new Map();
    this.ttlMs = ttlMs;
  }

  set(key, value) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    
    return item.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  prune() {
    const now = Date.now();
    for (const [key, item] of this.store.entries()) {
      if (now > item.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  size() {
    return this.store.size;
  }
}

/* ========== RATE LIMITING ========== */

export class RateLimiter {
  constructor(maxRequests = 100, windowMs = 60 * 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  checkLimit(key) {
    const now = Date.now();
    const userRequests = this.requests.get(key) || [];
    
    // Limpiar requests expirados
    const validRequests = userRequests.filter(timestamp => now - timestamp < this.windowMs);
    
    if (validRequests.length >= this.maxRequests) {
      throw new RateLimitError(`Rate limit exceeded for ${key}`, this.windowMs / 1000);
    }

    validRequests.push(now);
    this.requests.set(key, validRequests);

    return {
      limit: this.maxRequests,
      remaining: this.maxRequests - validRequests.length,
      resetAt: new Date(now + this.windowMs)
    };
  }

  reset(key) {
    this.requests.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, requests] of this.requests.entries()) {
      const valid = requests.filter(timestamp => now - timestamp < this.windowMs);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }
}

/* ========== UTILITIES ========== */

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function formatMoney(value) {
  if (value == null) return '—';
  return `S/${Number(value).toFixed(2)}`;
}

export function parseJSON(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function isEmpty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && Object.keys(value).length === 0);
}

export function flatten(arr) {
  return arr.reduce((flat, item) => flat.concat(Array.isArray(item) ? flatten(item) : item), []);
}

export function groupBy(arr, key) {
  return arr.reduce((result, item) => {
    const group = item[key];
    result[group] = result[group] || [];
    result[group].push(item);
    return result;
  }, {});
}

export function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function debounce(fn, delayMs) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

export function throttle(fn, delayMs) {
  let lastCall = 0;
  return function throttled(...args) {
    const now = Date.now();
    if (now - lastCall >= delayMs) {
      lastCall = now;
      fn(...args);
    }
  };
}

/* ========== API RESPONSE HELPERS ========== */

export function sendSuccess(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    ok: true,
    ...data
  });
}

export function sendError(res, error, statusCode = null) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json(formatError(error));
  }

  const code = statusCode || 500;
  return res.status(code).json(formatError(new AppError(error.message || 'Unknown error', code)));
}

export function sendReply(res, reply, userData = {}) {
  return res.status(200).json({
    ok: true,
    reply,
    ...userData
  });
}

/* ========== ASYNC MIDDLEWARE ========== */

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      logger.error('Handler error:', error);
      return sendError(res, error);
    }
  };
}

/* ========== METRICS ========== */

export class MetricsCollector {
  constructor() {
    this.metrics = {};
  }

  recordMetric(name, value = 1, tags = {}) {
    // Backward-compatible alias
    return this.record(name, value, tags);
  }

  record(name, value = 1, tags = {}) {
    const key = `${name}:${JSON.stringify(tags)}`;
    if (!this.metrics[key]) {
      this.metrics[key] = { name, tags, count: 0, sum: 0, min: Infinity, max: -Infinity };
    }
    
    const metric = this.metrics[key];
    metric.count += 1;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
  }

  getStats(name) {
    return Object.entries(this.metrics)
      .filter(([key]) => key.startsWith(`${name}:`))
      .map(([_, metric]) => ({
        name: metric.name,
        tags: metric.tags,
        count: metric.count,
        average: (metric.sum / metric.count).toFixed(2),
        min: metric.min,
        max: metric.max,
        total: metric.sum
      }));
  }

  reset() {
    this.metrics = {};
  }
}

export default {
  logger,
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  RateLimitError,
  formatError,
  validatePhone,
  validateEmail,
  validateAmount,
  validateUrl,
  sanitizeInput,
  retryAsync,
  Cache,
  RateLimiter,
  sleep,
  generateId,
  formatMoney,
  parseJSON,
  isEmpty,
  flatten,
  groupBy,
  chunk,
  debounce,
  throttle,
  sendSuccess,
  sendError,
  sendReply,
  asyncHandler,
  withErrorHandling,
  MetricsCollector
};
