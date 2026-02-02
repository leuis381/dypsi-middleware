/**
 * lib/user-profile.js
 * 
 * Gestión Inteligente de Perfil de Usuario
 * - Preferencias y restricciones personalizadas
 * - Historial completo de órdenes
 * - Análisis de comportamiento y patrones
 * - Predicciones y sugerencias personalizadas
 * - Detección de cliente VIP y frecuente
 * - Validación exhaustiva de datos
 * - Logging centralizado
 */

import { logger, ValidationError, AppError, MetricsCollector } from './utils.js';

/** Instancia de métricas */
const metrics = new MetricsCollector();

/**
 * Perfil de Usuario - Clase Principal
 * Gestiona todos los aspectos del perfil de un usuario
 */
class UserProfile {
  /**
   * Constructor del perfil de usuario
   * @param {string} userId - ID único del usuario
   * @param {Object} initialData - Datos iniciales { name, phone, email, orders, preferences, createdAt }
   * @throws {ValidationError} Si los parámetros no son válidos
   */
  constructor(userId, initialData = {}) {
    // Validar userId
    if (!userId || typeof userId !== 'string') {
      throw new ValidationError('INVALID_USER_ID', 'userId debe ser una cadena no vacía');
    }

    // Validar initialData
    if (initialData && typeof initialData !== 'object') {
      throw new ValidationError('INVALID_DATA', 'initialData debe ser un objeto');
    }

    logger.debug('USER_PROFILE_CREATE', { userId });

    this.userId = userId;
    this.name = initialData.name && typeof initialData.name === 'string' 
      ? initialData.name.trim() 
      : 'Cliente';
    this.phone = initialData.phone || null;
    this.email = initialData.email || null;
    this.createdAt = initialData.createdAt || Date.now();
    
    // Historial de órdenes (últimas 50)
    this.orders = Array.isArray(initialData.orders) ? initialData.orders.slice(0, 50) : [];
    
    // Preferencias de usuario
    this.preferences = {
      noSalt: false,
      noOnion: false,
      noPepper: false,
      noSpicy: false,
      vegetarian: false,
      noDairy: false,
      noPork: false,
      noSeafood: false,
      noNuts: false,
      noGluten: false,
      customPreferences: [],
      ...((initialData.preferences && typeof initialData.preferences === 'object') ? initialData.preferences : {})
    };
    
    // Estadísticas calculadas
    this.stats = {
      totalOrders: this.orders.length,
      totalSpent: 0,
      averageOrderValue: 0,
      lastOrderDate: null,
      favoriteItems: [],
      favoriteCategory: null,
      averageDeliveryTime: 0,
      cancellationRate: 0,
      lastUpdated: Date.now()
    };

    // Calcular estadísticas iniciales
    this.updateStats();

    metrics.recordMetric('user_profile_created', { userId });
  }

  /**
   * Actualizar estadísticas del usuario
   * Calcula totales, promedios, items y categorías favoritas
   */
  updateStats() {
    try {
      if (this.orders.length === 0) {
        this.stats.totalOrders = 0;
        this.stats.totalSpent = 0;
        this.stats.averageOrderValue = 0;
        this.stats.lastOrderDate = null;
        return;
      }

      // Recalcular totales
      this.stats.totalOrders = this.orders.length;
      this.stats.totalSpent = this.orders.reduce((sum, o) => {
        const total = Number(o.total || 0);
        return sum + (Number.isFinite(total) ? total : 0);
      }, 0);

      // Promedio de orden
      this.stats.averageOrderValue = this.stats.totalOrders > 0 
        ? Number((this.stats.totalSpent / this.stats.totalOrders).toFixed(2))
        : 0;

      // Última orden
      const lastOrder = this.orders[0];
      this.stats.lastOrderDate = lastOrder?.date || null;

      // Items favoritos (con cantidad)
      const itemCounts = {};
      const categoryTotals = {};

      for (const order of this.orders) {
        for (const item of order.items || []) {
          if (!item || typeof item !== 'object') continue;

          const itemId = item.id || item.name;
          if (itemId) {
            itemCounts[itemId] = (itemCounts[itemId] || 0) + (Number(item.quantity) || 1);
          }

          const category = item.category || 'other';
          categoryTotals[category] = (categoryTotals[category] || 0) + 1;
        }
      }

      this.stats.favoriteItems = Object.entries(itemCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([id, count]) => ({ id, count }));

      // Categoría favorita
      if (Object.keys(categoryTotals).length > 0) {
        const [favorite] = Object.entries(categoryTotals)
          .sort(([, a], [, b]) => b - a)[0];
        this.stats.favoriteCategory = favorite;
      }

      // Promedio de tiempo de entrega (si está disponible)
      const deliveryTimes = this.orders
        .filter(o => o.deliveryTime !== undefined && o.deliveryTime !== null)
        .map(o => Number(o.deliveryTime) || 0);

      if (deliveryTimes.length > 0) {
        this.stats.averageDeliveryTime = Number(
          (deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length).toFixed(1)
        );
      }

      this.stats.lastUpdated = Date.now();

      logger.debug('STATS_UPDATED', { 
        userId: this.userId, 
        totalOrders: this.stats.totalOrders,
        totalSpent: this.stats.totalSpent 
      });
    } catch (error) {
      logger.error('STATS_UPDATE_ERROR', { error: error.message, userId: this.userId });
    }
  }

  /**
   * Agregar nueva orden al historial
   * @param {Object} order - Orden con { items, total, address, paymentMethod, deliveryTime, notes }
   * @throws {ValidationError} Si la orden no es válida
   * @returns {UserProfile} this para encadenamiento
   */
  addOrder(order) {
    // Validar orden
    if (!order || typeof order !== 'object') {
      throw new ValidationError('INVALID_ORDER', 'order debe ser un objeto');
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new ValidationError('EMPTY_ITEMS', 'order.items debe ser un array no vacío');
    }
    if (!Number.isFinite(order.total) || order.total <= 0) {
      throw new ValidationError('INVALID_TOTAL', 'order.total debe ser un número > 0');
    }

    const newOrder = {
      date: Date.now(),
      items: order.items.filter(i => i && typeof i === 'object'),
      total: Number(order.total),
      address: order.address || null,
      paymentMethod: order.paymentMethod || 'unknown',
      deliveryTime: order.deliveryTime || null,
      notes: Array.isArray(order.notes) ? order.notes : [],
      status: 'completed'
    };

    // Agregar al principio del array
    this.orders.unshift(newOrder);

    // Limitar a últimas 50 órdenes
    if (this.orders.length > 50) {
      this.orders = this.orders.slice(0, 50);
    }

    this.updateStats();

    logger.info('ORDER_ADDED', { 
      userId: this.userId, 
      total: newOrder.total,
      itemsCount: newOrder.items.length 
    });

    metrics.recordMetric('order_added', { userId: this.userId });

    return this;
  }

  /**
   * Establecer preferencia del usuario
   * @param {string} key - Clave de preferencia
   * @param {*} value - Valor a establecer
   * @returns {UserProfile} this para encadenamiento
   * @throws {ValidationError} Si los parámetros no son válidos
   */
  setPreference(key, value) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('INVALID_KEY', 'key debe ser una cadena no vacía');
    }

    if (key in this.preferences && typeof this.preferences[key] === 'boolean') {
      this.preferences[key] = Boolean(value);
    } else if (key === 'customPreferences') {
      // No permitir modificación directa
      logger.warn('CUSTOM_PREFS_DIRECT_MODIFY_BLOCKED', { userId: this.userId });
    } else {
      // Agregar como preferencia custom
      if (!Array.isArray(this.preferences.customPreferences)) {
        this.preferences.customPreferences = [];
      }
      this.preferences.customPreferences.push({ key, value });
    }

    logger.debug('PREFERENCE_SET', { userId: this.userId, key });

    return this;
  }

  /**
   * Obtener orden anterior (para "lo mismo")
   * @returns {Object|null} Última orden o null
   */
  getLastOrder() {
    return this.orders[0] || null;
  }

  /**
   * Obtener orden desde hace aproximadamente X días
   * @param {number} days - Número de días aproximados
   * @returns {Object|null} Orden encontrada o null
   */
  getOrderFromDaysAgo(days) {
    if (!Number.isInteger(days) || days < 0) {
      logger.warn('INVALID_DAYS_PARAMETER', { days });
      return null;
    }

    const now = Date.now();
    const targetTime = now - (days * 24 * 60 * 60 * 1000);
    
    return this.orders.find(order => {
      if (!order?.date) return false;
      const daysDiff = (now - order.date) / (24 * 60 * 60 * 1000);
      return daysDiff >= days - 0.5 && daysDiff < days + 0.5;
    }) || null;
  }

  /**
   * Calcular días desde última orden
   * @returns {number|null} Días o null si no hay órdenes
   */
  getDaysSinceLastOrder() {
    if (!this.stats.lastOrderDate) return null;
    const days = Math.floor((Date.now() - this.stats.lastOrderDate) / (24 * 60 * 60 * 1000));
    return days >= 0 ? days : null;
  }

  /**
   * ¿Es cliente VIP?
   * Criterios: 10+ órdenes O gasto > 500 soles
   * @returns {boolean}
   */
  isVIP() {
    return this.stats.totalOrders >= 10 || this.stats.totalSpent >= 500;
  }

  /**
   * ¿Es cliente frecuente?
   * Criterio: Última orden en últimos 7 días
   * @returns {boolean}
   */
  isFrequent() {
    const daysSinceLastOrder = this.getDaysSinceLastOrder();
    return daysSinceLastOrder !== null && daysSinceLastOrder <= 7;
  }

  /**
   * ¿Es cliente en riesgo (churn)?
   * Criterio: No ha pedido en 30+ días pero solía ser frecuente
   * @returns {boolean}
   */
  isAtRisk() {
    const daysSinceLastOrder = this.getDaysSinceLastOrder();
    return daysSinceLastOrder !== null && daysSinceLastOrder >= 30 && this.stats.totalOrders >= 3;
  }

  /**
   * Obtener próxima orden predicha basada en frecuencia
   * @returns {Object|null} { estimatedDate, daysFromNow, likelyItems, confidence }
   */
  predictNextOrder() {
    if (this.orders.length < 2) {
      return null;
    }

    try {
      // Analizar frecuencia de órdenes
      const orderDates = this.orders.map(o => o.date).sort((a, b) => b - a);
      const intervals = [];
      
      for (let i = 0; i < Math.min(orderDates.length - 1, 10); i++) {
        const interval = (orderDates[i] - orderDates[i + 1]) / (24 * 60 * 60 * 1000);
        if (interval > 0) {
          intervals.push(interval);
        }
      }

      if (intervals.length === 0) return null;

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const stdDev = Math.sqrt(
        intervals.reduce((sum, x) => sum + Math.pow(x - avgInterval, 2), 0) / intervals.length
      );

      const lastOrder = this.orders[0];
      const nextOrderTime = new Date(lastOrder.date + (avgInterval * 24 * 60 * 60 * 1000));

      // Confianza basada en consistencia
      const confidence = Math.max(0.1, 1 - (stdDev / avgInterval) * 0.5);

      return {
        estimatedDate: nextOrderTime,
        daysFromNow: Number(avgInterval.toFixed(1)),
        likelyItems: this.stats.favoriteItems.slice(0, 3),
        confidence: Number(Math.min(confidence, 1).toFixed(2))
      };
    } catch (error) {
      logger.error('PREDICTION_ERROR', { error: error.message, userId: this.userId });
      return null;
    }
  }

  /**
   * Aplicar preferencias automáticamente a items
   * Agrega modificadores basados en preferencias del usuario
   * @param {Array<Object>} items - Items para modificar
   * @returns {Array<Object>} Items con preferencias aplicadas
   */
  applyPreferences(items) {
    // Validar input
    if (!Array.isArray(items)) {
      throw new ValidationError('INVALID_ITEMS', 'items debe ser un array');
    }

    try {
      const modified = items.map(item => {
        if (!item || typeof item !== 'object') return item;

        const modifiedItem = { ...item };
        modifiedItem.modifiers = Array.isArray(modifiedItem.modifiers) 
          ? [...modifiedItem.modifiers]
          : [];

        // Aplicar preferencias booleanas
        const preferenceMap = {
          noSalt: 'sin sal',
          noOnion: 'sin cebolla',
          noPepper: 'sin ají',
          noSpicy: 'no picante',
          noPork: 'sin cerdo',
          noSeafood: 'sin mariscos',
          noDairy: 'sin lácteos',
          noNuts: 'sin nueces',
          noGluten: 'sin gluten',
          vegetarian: 'vegetariano'
        };

        for (const [key, modifier] of Object.entries(preferenceMap)) {
          if (this.preferences[key] === true && !modifiedItem.modifiers.includes(modifier)) {
            modifiedItem.modifiers.push(modifier);
          }
        }

        // Aplicar preferencias custom
        if (Array.isArray(this.preferences.customPreferences)) {
          for (const pref of this.preferences.customPreferences) {
            if (pref && pref.value && !modifiedItem.modifiers.includes(pref.value)) {
              modifiedItem.modifiers.push(pref.value);
            }
          }
        }

        return modifiedItem;
      });

      logger.debug('PREFERENCES_APPLIED', { 
        userId: this.userId, 
        itemsCount: items.length 
      });

      return modified;
    } catch (error) {
      logger.error('PREFERENCE_APPLICATION_ERROR', { error: error.message });
      throw new AppError('PREFERENCE_ERROR', 'Error aplicando preferencias', { cause: error });
    }
  }

  /**
   * Serializar para almacenamiento o transmisión
   * @returns {Object} Objeto serializado
   */
  toJSON() {
    return {
      userId: this.userId,
      name: this.name,
      phone: this.phone,
      email: this.email,
      createdAt: this.createdAt,
      orders: this.orders,
      preferences: this.preferences,
      stats: this.stats,
      serializedAt: Date.now()
    };
  }

  /**
   * Deserializar desde JSON (método estático)
   * @param {Object} data - Datos serializados
   * @returns {UserProfile} Nuevo UserProfile
   * @throws {ValidationError} Si los datos no son válidos
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object' || !data.userId) {
      throw new ValidationError('INVALID_JSON_DATA', 'data debe contener userId');
    }
    return new UserProfile(data.userId, data);
  }
}

/**
 * Análisis de Comportamiento
 * Analiza el perfil del usuario y genera insight
 * @param {UserProfile} profile - Perfil de usuario
 * @returns {Object} Análisis completo del comportamiento
 */
function analyzeBehavior(profile) {
  // Validar input
  if (!(profile instanceof UserProfile)) {
    throw new ValidationError('INVALID_PROFILE', 'profile debe ser una instancia de UserProfile');
  }

  try {
    const daysSinceLastOrder = profile.getDaysSinceLastOrder();
    const prediction = profile.predictNextOrder();

    const analysis = {
      userId: profile.userId,
      segmentation: {
        isVIP: profile.isVIP(),
        isFrequent: profile.isFrequent(),
        isAtRisk: profile.isAtRisk(),
        totalOrdersSegment: profile.stats.totalOrders >= 10 ? 'loyal' : profile.stats.totalOrders >= 5 ? 'regular' : 'occasional'
      },
      activity: {
        daysSinceLastOrder: daysSinceLastOrder,
        totalOrders: profile.stats.totalOrders,
        totalSpent: Number(profile.stats.totalSpent.toFixed(2)),
        averageOrderValue: profile.stats.averageOrderValue,
        lastOrderDate: profile.stats.lastOrderDate
      },
      preferences: {
        favoriteCategory: profile.stats.favoriteCategory,
        favoriteItems: profile.stats.favoriteItems,
        userPreferences: profile.preferences,
        averageDeliveryTime: profile.stats.averageDeliveryTime
      },
      prediction: prediction
    };

    logger.debug('BEHAVIOR_ANALYZED', { userId: profile.userId });
    metrics.recordMetric('behavior_analyzed', { userId: profile.userId });

    return analysis;
  } catch (error) {
    logger.error('BEHAVIOR_ANALYSIS_ERROR', { error: error.message });
    throw new AppError('ANALYSIS_ERROR', 'Error analizando comportamiento', { cause: error });
  }
}

/**
 * Generar mensaje personalizado
 * Crea mensajes según el tipo de cliente y contexto
 * @param {UserProfile} profile - Perfil de usuario
 * @param {string} type - Tipo de mensaje { welcome, frequentuser, longabsence, vip, atrisk }
 * @returns {string} Mensaje personalizado
 * @throws {ValidationError} Si los parámetros no son válidos
 */
function generatePersonalizedMessage(profile, type) {
  // Validar inputs
  if (!(profile instanceof UserProfile)) {
    throw new ValidationError('INVALID_PROFILE', 'profile debe ser una instancia de UserProfile');
  }
  if (typeof type !== 'string') {
    throw new ValidationError('INVALID_TYPE', 'type debe ser una cadena');
  }

  try {
    const name = profile.name || 'Cliente';
    const daysSince = profile.getDaysSinceLastOrder();
    
    const messages = {
      welcome: [
        `¡Hola ${name}! Bienvenido de vuelta. ¿Qué te preparamos hoy?`,
        `¡${name}! Te extrañábamos. ¿Qué deseas?`,
        `¡Saludos ${name}! Tu orden favorita sigue en el menú.`
      ],
      frequentuser: [
        `${name}, como buen cliente, te sugerimos tu orden de siempre.`,
        `¡Oye ${name}! ¿Repetimos tu pedido de la semana pasada?`,
        `${name}, creemos que estas cosas te van a gustar...`,
        `¡${name}! Te conocemos, aquí está lo que más pides.`
      ],
      longabsence: [
        `¡${name}! Hace ${daysSince} días que no te vemos. ¿Te echamos de menos?`,
        `${name}, ${daysSince} días sin verte. ¿Tienes ganas de nuestras pizzas? 🍕`,
        `¡${name}! Vuelve a deleitarte. Tenemos ofertas especiales.`,
        `${name}, te preparamos algo especial solo para ti esta vez.`
      ],
      vip: [
        `¡${name}! Nuestro cliente estrella. ¿Qué deseas hoy?`,
        `${name}, gracias por ser tan leal. Aquí está tu oferta especial VIP.`,
        `¡${name}! Preparamos algo especial solo para ti.`,
        `${name}, cliente preferido, recibe un regalo de nuestra parte. 🎁`
      ],
      atrisk: [
        `¡${name}! Te extrañamos. ¿Qué pasó? ¿Algo no te gustó?`,
        `${name}, hace poco no te vemos. Te echamos de menos. Aquí un 15% de descuento solo para ti.`,
        `¡${name}! Regresa con nosotros. Tenemos nuevas opciones que te van a encantar.`,
        `${name}, ¿dónde andabas? Vuelve y probá nuestros nuevos combos.`
      ]
    };

    const messageList = messages[type] || messages.welcome;
    const message = messageList[Math.floor(Math.random() * messageList.length)];

    logger.debug('MESSAGE_GENERATED', { userId: profile.userId, type });
    metrics.recordMetric('message_generated', { type });

    return message;
  } catch (error) {
    logger.error('MESSAGE_GENERATION_ERROR', { error: error.message });
    throw new AppError('MESSAGE_ERROR', 'Error generando mensaje', { cause: error });
  }
}

/**
 * Exports - User Profile Engine
 */

/**
 * Exports - User Profile Engine
 * 
 * Uso:
 * import { UserProfile, analyzeBehavior, generatePersonalizedMessage } from './user-profile.js';
 * const profile = new UserProfile('user123', { name: 'Juan', phone: '912345678' });
 * profile.addOrder({ items: [...], total: 50 });
 * const analysis = analyzeBehavior(profile);
 */
export default {
  // Classes
  UserProfile,
  
  // Analysis & Generation
  analyzeBehavior,
  generatePersonalizedMessage
};

// Logging de inicio
logger.info('USER_PROFILE_ENGINE_LOADED', { 
  version: '2.0.0'
});
