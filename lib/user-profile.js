/**
 * lib/user-profile.js
 * 
 * Gestión inteligente de perfil de usuario
 * - Preferencias y restricciones
 * - Historial de órdenes
 * - Análisis de comportamiento
 * - Predicciones y sugerencias personalizadas
 */

/**
 * Perfil de Usuario
 */
class UserProfile {
  constructor(userId, initialData = {}) {
    this.userId = userId;
    this.name = initialData.name || 'Cliente';
    this.phone = initialData.phone;
    this.email = initialData.email;
    this.createdAt = initialData.createdAt || Date.now();
    
    // Historial
    this.orders = initialData.orders || [];  // [{date, items, total, address}, ...]
    this.preferences = initialData.preferences || {
      noSalt: false,
      noOnion: false,
      noPepper: false,
      noSpicy: false,
      vegetarian: false,
      noDairy: false,
      noPork: false,
      customPreferences: []
    };
    
    // Estadísticas
    this.stats = {
      totalOrders: this.orders.length,
      totalSpent: this.orders.reduce((sum, o) => sum + (o.total || 0), 0),
      averageOrderValue: 0,
      lastOrderDate: this.orders[0]?.date || null,
      favoriteItems: {},
      favoriteCategory: null,
      averageDeliveryTime: 0
    };

    this.updateStats();
  }

  /**
   * Actualizar estadísticas
   */
  updateStats() {
    if (this.orders.length === 0) return;

    // Promedio de orden
    this.stats.averageOrderValue = this.stats.totalSpent / this.orders.length;

    // Última orden
    this.stats.lastOrderDate = Math.max(...this.orders.map(o => o.date || 0));

    // Items favoritos
    const itemCounts = {};
    for (const order of this.orders) {
      for (const item of order.items || []) {
        itemCounts[item.id] = (itemCounts[item.id] || 0) + 1;
      }
    }
    this.stats.favoriteItems = Object.entries(itemCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([id, count]) => ({ id, count }));

    // Categoría favorita
    const categoryCounts = {};
    for (const order of this.orders) {
      for (const item of order.items || []) {
        categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      }
    }
    if (Object.keys(categoryCounts).length > 0) {
      this.stats.favoriteCategory = Object.entries(categoryCounts)
        .sort(([,a], [,b]) => b - a)[0][0];
    }
  }

  /**
   * Agregar nueva orden al historial
   */
  addOrder(order) {
    this.orders.unshift({
      date: Date.now(),
      items: order.items,
      total: order.total,
      address: order.address,
      paymentMethod: order.paymentMethod,
      notes: order.notes || []
    });

    // Limitar a últimas 50 órdenes
    if (this.orders.length > 50) {
      this.orders.pop();
    }

    this.updateStats();
    return this;
  }

  /**
   * Agregar preferencia
   */
  setPreference(key, value) {
    if (key in this.preferences) {
      this.preferences[key] = value;
    } else {
      this.preferences.customPreferences.push({ key, value });
    }
    return this;
  }

  /**
   * Obtener orden anterior (para "lo mismo")
   */
  getLastOrder() {
    return this.orders[0] || null;
  }

  /**
   * Obtener orden desde hace X días
   */
  getOrderFromDaysAgo(days) {
    const now = Date.now();
    const targetTime = now - (days * 24 * 60 * 60 * 1000);
    
    return this.orders.find(order => {
      const daysDiff = (now - order.date) / (24 * 60 * 60 * 1000);
      return daysDiff >= days - 0.5 && daysDiff < days + 0.5;
    }) || null;
  }

  /**
   * Calcular días desde última orden
   */
  getDaysSinceLastOrder() {
    if (!this.stats.lastOrderDate) return null;
    return Math.floor((Date.now() - this.stats.lastOrderDate) / (24 * 60 * 60 * 1000));
  }

  /**
   * ¿Es cliente VIP?
   */
  isVIP() {
    return this.stats.totalOrders >= 10 || this.stats.totalSpent > 500;
  }

  /**
   * ¿Es cliente frecuente?
   */
  isFrequent() {
    const daysSinceLastOrder = this.getDaysSinceLastOrder();
    return daysSinceLastOrder !== null && daysSinceLastOrder <= 7;
  }

  /**
   * Obtener próxima orden predicha
   */
  predictNextOrder() {
    if (this.orders.length < 2) return null;

    // Analizar frecuencia
    const orderDates = this.orders.map(o => o.date).sort((a, b) => b - a);
    const intervals = [];
    
    for (let i = 0; i < orderDates.length - 1; i++) {
      intervals.push((orderDates[i] - orderDates[i + 1]) / (24 * 60 * 60 * 1000));
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const lastOrder = this.orders[0];
    const nextOrderTime = new Date(lastOrder.date + avgInterval * 24 * 60 * 60 * 1000);

    return {
      estimatedDate: nextOrderTime,
      daysFromNow: avgInterval,
      likelyItems: this.stats.favoriteItems.slice(0, 3)
    };
  }

  /**
   * Aplicar preferencias a items
   */
  applyPreferences(items) {
    const modified = JSON.parse(JSON.stringify(items));

    for (const item of modified) {
      item.modifiers = item.modifiers || [];

      if (this.preferences.noSalt) {
        item.modifiers.push('sin sal');
      }
      if (this.preferences.noOnion) {
        item.modifiers.push('sin cebolla');
      }
      if (this.preferences.noPepper) {
        item.modifiers.push('sin ají');
      }
      if (this.preferences.noSpicy) {
        item.modifiers.push('no picante');
      }
      if (this.preferences.noPork) {
        item.modifiers = item.modifiers.filter(m => !m.toLowerCase().includes('cerdo'));
      }

      // Custom preferences
      for (const pref of this.preferences.customPreferences) {
        item.modifiers.push(pref.value);
      }
    }

    return modified;
  }

  /**
   * Serializar para almacenamiento
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
      stats: this.stats
    };
  }

  /**
   * Deserializar desde almacenamiento
   */
  static fromJSON(data) {
    return new UserProfile(data.userId, data);
  }
}

/**
 * Análisis de Comportamiento
 */
function analyzeBehavior(profile) {
  return {
    isVIP: profile.isVIP(),
    isFrequent: profile.isFrequent(),
    daysSinceLastOrder: profile.getDaysSinceLastOrder(),
    nextPredictedOrder: profile.predictNextOrder(),
    preferredCategory: profile.stats.favoriteCategory,
    preferredItems: profile.stats.favoriteItems,
    averageOrderValue: profile.stats.averageOrderValue,
    preferences: profile.preferences
  };
}

/**
 * Generar mensaje personalizado
 */
function generatePersonalizedMessage(profile, type) {
  const name = profile.name;
  const daysSince = profile.getDaysSinceLastOrder();
  
  const messages = {
    welcome: [
      `¡Hola ${name}! Bienvenido de vuelta.`,
      `¡${name}! Te extrañábamos. ¿Qué te traes hoy?`,
      `¡Saludos ${name}! Tu orden favorita sigue en el menú.`
    ],
    frequentuser: [
      `${name}, como buen cliente tuyo, te sugerimos tu orden de siempre.`,
      `¡Oye ${name}! ¿Repetimos lo de la semana pasada?`,
      `${name}, creemos que estas cosas te van a gustar...`
    ],
    longabsence: [
      `¡${name}! Hace ${daysSince} días que no te vemos. ¿Tienes ganas de algo?`,
      `${name}, ${daysSince} días sin verte. ¿Te echamos de menos? 😢`,
      `¡${name}! ¿Dónde andabas? Vuelve a deleitarte con nuestras pizzas.`
    ],
    vip: [
      `¡${name}! Nuestro cliente estrella. ¿Qué deseas hoy?`,
      `${name}, gracias por ser tan leal. Aquí está tu oferta especial VIP.`,
      `¡${name}! Hoy preparamos algo especial solo para ti.`
    ]
  };

  const messageList = messages[type] || messages.welcome;
  return messageList[Math.floor(Math.random() * messageList.length)];
}

export default {
  UserProfile,
  analyzeBehavior,
  generatePersonalizedMessage
};
