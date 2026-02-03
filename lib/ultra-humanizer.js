/**
 * lib/ultra-humanizer.js
 * 
 * Sistema de Humanización Ultra Avanzado
 * Respuestas con variaciones infinitas, emociones y personalización extrema
 * La IA más humana del mundo para restaurantes
 */

import { logger, MetricsCollector } from './utils.js';
import { CONFIG } from './config.js';

const metrics = new MetricsCollector();

/**
 * Templates ultra humanizados con múltiples variaciones
 * Cada respuesta tiene 10+ variaciones para sonar siempre natural
 */
const ULTRA_RESPONSES = {
  greeting: [
    '¡Hola {nombre}! 😊 ¿Cómo estás? Bienvenido a DYPSI, estoy aquí para ayudarte con tu pedido.',
    '¡Hey {nombre}! 👋 ¡Qué gusto verte por aquí! ¿Listo para ordenar algo delicioso?',
    'Hola {nombre}, ¡es un placer atenderte! 🍕 ¿Qué se te antoja hoy?',
    '¡{nombre}! ¿Cómo has estado? Cuéntame, ¿qué vas a pedir hoy?',
    '¡Buenas {nombre}! 😄 Estoy listo para tomar tu pedido. ¿Qué te provoca?',
    '¡Hola! Soy tu asistente de DYPSI 🤖💚 ¿En qué puedo ayudarte hoy {nombre}?',
    '{nombre}, ¡qué alegría verte! ¿Delivery o recojo? Escríbeme qué quieres',
    'Hey {nombre}! 👋 Lista para ayudarte. ¿Pizza, burgers, pastas? ¿Qué se te antoja?',
    '¡Hola {nombre}! 🌟 Bienvenido de vuelta. ¿Lo mismo de siempre o algo nuevo?',
    '¡{nombre}! Genial que estés aquí. Cuéntame, ¿hambre de qué tienes hoy? 😋'
  ],
  
  greeting_vip: [
    '¡{nombre}! 🌟⭐ ¡Nuestro cliente VIP favorito! ¿Lo de siempre o probamos algo nuevo?',
    '¡Hey {nombre}! ⭐ Siempre es un placer atender a nuestros mejores clientes. ¿Qué va a ser hoy?',
    '{nombre}, ¡qué honor verte! 👑 Como cliente VIP tienes prioridad. ¿Tu pedido usual?',
    '¡{nombre}! 💎 Cliente estrella detectado. ¿Te preparo lo de siempre o variamos?',
    '¡Hola {nombre}! 🎖️ VIP en la casa. Tu opinión es oro para nosotros. ¿Qué ordenamos?'
  ],
  
  menu_request: [
    '¡Claro {nombre}! 📋 Aquí está nuestro menú completo:\n\n{menu}\n\n¿Cuál te llama la atención?',
    '¡Por supuesto! Mira todo lo que tenemos para ti:\n\n{menu}\n\n¿Qué se te antoja? 😋',
    'Con gusto te muestro el menú {nombre}:\n\n{menu}\n\nDime cuál quieres y te lo preparo 🍕',
    '¡Excelente elección pedir el menú! Aquí está:\n\n{menu}\n\n¿Ya sabes qué quieres o te ayudo a elegir?',
    'Nuestras delicias del día {nombre}:\n\n{menu}\n\nTodas frescas y deliciosas. ¿Qué te llevás?'
  ],
  
  order_received: [
    '¡Perfecto {nombre}! 👌 Anoté tu pedido:\n\n{items}\n\n💰 Total: S/ {total}\n\n¿Todo ok? Responde "sí" para confirmar',
    'Genial, esto quedó así:\n\n{items}\n\n💵 Son S/ {total}\n\n¿Confirmamos? Escribe "sí" y seguimos',
    'Súper {nombre}! Tu pedido:\n\n{items}\n\nTotal: S/ {total} ✨\n\n¿Le damos? Responde "sí"',
    'Ok, entendido:\n\n{items}\n\n💰 Total: S/ {total}\n\nSi está bien, escribe "sí" para confirmar 😊',
    '¡Listo {nombre}! Anotado:\n\n{items}\n\nSubtotal: S/ {total}\n\n¿Confirmamos este pedido? (sí/no)',
    'Perfecto, aquí va:\n\n{items}\n\n💵 Total: S/ {total}\n\n¿Todo correcto? Dime "sí" y lo procesamos',
    '¡Entendido! 📝\n\n{items}\n\nTotal: S/ {total}\n\n¿Está bien así? Confirma con "sí"',
    'Excelente elección {nombre}! 🌟\n\n{items}\n\nTotal a pagar: S/ {total}\n\n¿Le damos? Escribe "sí"'
  ],
  
  order_confirmed: [
    '¡Confirmado {nombre}! 🎉 Tu pedido está en proceso. ¿Cómo vas a pagar? (Yape/Plin/Efectivo)',
    '¡Listo! ✅ Pedido registrado. Ahora dime, ¿pagas con Yape, Plin o efectivo?',
    '¡Genial {nombre}! 👍 Ya tengo tu pedido. ¿Método de pago? (Yape/Plin/Efectivo)',
    'Confirmado ✨ ¿Cómo prefieres pagar? Yape, Plin o efectivo al entregar',
    '¡Perfecto! Pedido anotado 📝 Ahora dime, ¿Yape, Plin o efectivo?',
    '¡Listo {nombre}! 🚀 Tu pedido está confirmado. ¿Pagas con Yape/Plin o en efectivo?',
    '¡Excelente! Ya está en el sistema ✅ ¿Forma de pago? (Yape/Plin/Efectivo)',
    '¡Confirmadísimo {nombre}! 💯 ¿Cómo pagas? Tenemos Yape, Plin o efectivo'
  ],
  
  ask_address: [
    'Perfecto {nombre}! 📍 Ahora necesito tu dirección para el delivery. ¿Dónde te envío el pedido?',
    '¡Genial! ¿A qué dirección te lo llevo? Comparte tu ubicación o escríbeme la dirección completa 🗺️',
    '¿Dónde estás {nombre}? Comparte tu ubicación o escríbeme: calle, número, referencia 📍',
    '¿A dónde te lo envío? Puedes compartir tu ubicación o escribir la dirección completa 🏠',
    'Ya casi listo! Solo falta saber dónde estás. ¿Me compartes tu ubicación? 📍',
    '¿Dónde te encuentras {nombre}? Comparte ubicación o escribe tu dirección para delivery 🚗',
    'Para enviarte el pedido necesito tu dirección. ¿Me la compartes? 📍',
    '¿A qué dirección te lo llevamos {nombre}? (calle, número, referencia) 🏡'
  ],
  
  payment_yape_instructions: [
    '¡Perfecto {nombre}! 💳 Para Yape:\n\n📱 Número: 900146424\n👤 Titular: Joel Santos\n💰 Monto: S/ {total}\n\nEnvíame la captura del pago y confirmo 📸',
    'Para pagar con Yape:\n\n📱 900146424 (Joel Santos)\n💵 Monto: S/ {total}\n\nCuando pagues, envíame el screenshot ✅',
    '¡Dale {nombre}! Yapea a:\n\n📱 900146424\n👤 Joel Santos\n💰 S/ {total}\n\nY me mandas la captura 📸',
    'Info para Yape:\n\nNúmero: 900146424\nNombre: Joel Santos\nTotal: S/ {total}\n\nEnvía captura del pago 📱',
    '¡Listo! Yape aquí:\n\n📱 900146424 (Joel Santos)\n💰 Monto total: S/ {total}\n\nLuego me mandas pantallazo ✨'
  ],
  
  payment_plin_instructions: [
    'Para Plin:\n\n📱 900146424\n👤 Joel Santos\n💰 S/ {total}\n\nEnvíame captura cuando pagues 📸',
    '¡Ok {nombre}! Plin a:\n\n📱 900146424 (Joel Santos)\n💵 Total: S/ {total}\n\nCaptura del pago please 📱',
    'Info Plin:\n\nNúmero: 900146424\nNombre: Joel Santos\nMonto: S/ {total}\n\nLuego screenshot 📸'
  ],
  
  payment_cash: [
    '¡Perfecto {nombre}! 💵 Pago en efectivo. ¿Con cuánto vas a pagar? (para tener el cambio listo)',
    'Ok, efectivo al entregar. ¿Con cuánto pagas {nombre}? Así tenemos tu cambio preparado',
    '¡Listo! Efectivo. ¿Tienes el monto exacto o con cuánto pagarás? 💵',
    'Perfecto, cash al recibir. ¿Cuánto darás para tener el cambio? 💰',
    '¡Genial! Pagas en efectivo. Dime con cuánto para preparar el cambio 💵'
  ],
  
  payment_verified: [
    '¡Pago verificado {nombre}! ✅ Todo perfecto. Tu pedido está confirmado y en camino 🚗',
    '¡Recibido! ✅ Pago confirmado. Ya estamos preparando tu pedido {nombre} 🍕',
    '¡Confirmado el pago! ✨ Tu pedido sale en breve. Tiempo estimado: {time} min 🚗',
    '¡Listo {nombre}! Pago ok ✅ Preparando tu pedido ahora mismo. Llega en ~{time} min',
    '¡Perfecto! Pago verificado ✅ Tu pedido ya está en proceso {nombre} 🎉'
  ],
  
  order_preparing: [
    'Tu pedido está en preparación {nombre}! 👨‍🍳 Llega en aproximadamente {time} minutos',
    '¡Ya estamos cocinando {nombre}! 🍕 Te llega en unos {time} min',
    'Pedido en proceso 👨‍🍳 Tiempo estimado: {time} minutos. ¡Paciencia!',
    'Estamos preparando tu orden {nombre}! Calcula {time} min ⏰',
    'Tu pedido va saliendo {nombre}! Llegaría en {time} minutos aprox 🚗'
  ],
  
  order_on_way: [
    '¡Tu pedido va en camino {nombre}! 🚗💨 Llegaría en ~{time} min',
    '¡Delivery en ruta! 🛵 Calcula {time} minutos {nombre}',
    'Ya salió tu pedido {nombre}! 🚗 Llega en {time} min aprox',
    '¡En camino {nombre}! El repartidor llega en ~{time} min 🛵💨'
  ],
  
  order_delivered: [
    '¡Pedido entregado! 🎉 Gracias por tu preferencia {nombre}. ¡Que lo disfrutes! 😋',
    '¡Llegó! Espero que disfrutes tu pedido {nombre} 🍕 ¡Gracias por elegirnos!',
    '¡Entregado {nombre}! 🎊 ¡Buen provecho! Nos vemos pronto 😊',
    '¡Listo {nombre}! Pedido entregado ✅ ¡A disfrutar! Gracias por tu confianza 💚'
  ],
  
  thanks_feedback: [
    '¡Gracias {nombre}! 💚 Tu opinión es muy importante. ¡Vuelve pronto!',
    'Agradecemos tu feedback {nombre} 🙏 ¡Esperamos verte de nuevo!',
    '¡Gracias por tus comentarios! Los tomamos en cuenta {nombre} ✨',
    'Tu opinión nos ayuda a mejorar {nombre} 💚 ¡Gracias!'
  ],
  
  apology: [
    'Lo siento mucho {nombre} 🙏 Vamos a resolver esto de inmediato. ¿Qué sucedió?',
    'Disculpa los inconvenientes {nombre} 😔 Cuéntame qué pasó para ayudarte',
    'Lamento lo sucedido {nombre} 🙏 ¿Cómo puedo solucionarlo?',
    'Mil disculpas {nombre} 😔 Déjame ayudarte. ¿Qué necesitas?'
  ],
  
  order_repeat: [
    '¡Perfecto {nombre}! ¿Quieres lo mismo que la última vez? 🔄\n\n{lastOrder}\n\n¿Le damos?',
    '¿Lo de siempre {nombre}? 😊 Sería:\n\n{lastOrder}\n\n¿Confirmamos?',
    'Claro, tu pedido anterior fue:\n\n{lastOrder}\n\n¿Lo repetimos {nombre}? 🔄',
    '¡Súper! Tu última orden:\n\n{lastOrder}\n\n¿Mismo pedido {nombre}? ✨'
  ],
  
  suggest_items: [
    'Mmm, basado en tu historial {nombre}, te recomendaría: {suggestions} 🌟 ¿Te interesa?',
    '¿Qué tal si pruebas: {suggestions}? Clientes como tú los aman 😋',
    'Te sugiero: {suggestions} 💡 Perfectos para acompañar tu pedido {nombre}',
    'Podrías agregar: {suggestions} 🍕 ¿Qué dices {nombre}?'
  ],
  
  not_understand: [
    'Mmm, no entendí bien {nombre} 🤔 ¿Puedes repetir de otra forma?',
    'Perdón {nombre}, no capté eso. ¿Podrías decirlo diferente? 😅',
    'No estoy seguro de haber entendido {nombre}. ¿Me lo explicas de nuevo? 🤷',
    'Disculpa {nombre}, ¿podrías reformular eso? No lo capté bien 😊',
    'Hmm, no logro entender {nombre}. ¿Puedes ser más específico? 🤔'
  ],
  
  help: [
    '¡Claro {nombre}! 🆘 Puedo ayudarte con:\n\n📋 Ver menú\n🍕 Hacer pedidos\n💳 Info de pago\n📍 Calcular delivery\n📦 Estado de tu orden\n\n¿Qué necesitas?',
    'Por supuesto {nombre}! Estoy aquí para:\n\n• Mostrarte el menú\n• Tomar tu pedido\n• Darte info de pago\n• Calcular delivery\n• Ver estado de tu orden\n\n¿En qué te ayudo?',
    '¡Para eso estoy {nombre}! 😊 Puedo:\n\n✓ Mostrar menú completo\n✓ Procesar pedidos\n✓ Info de Yape/Plin\n✓ Calcular envío\n✓ Status de orden\n\nDime qué necesitas'
  ],
  
  cancel_order: [
    'Entiendo {nombre} 😔 ¿Quieres cancelar tu pedido? ¿Pasó algo?',
    '¿Seguro quieres cancelar {nombre}? Cuéntame qué sucedió',
    'Ok {nombre}, ¿cancelamos el pedido? ¿Hubo algún problema?',
    'Entendido. ¿Cancelo tu orden {nombre}? ¿Todo bien?'
  ],
  
  order_cancelled: [
    'Pedido cancelado {nombre} ✅ Si cambias de opinión, estoy aquí 😊',
    'Listo {nombre}, cancelado. Cuando quieras volver, aquí estaré 💚',
    'Ok, cancelado {nombre}. Espero verte pronto! 👋',
    'Entendido {nombre}, pedido cancelado. ¡Hasta pronto! ✨'
  ],
  
  out_of_stock: [
    'Ay {nombre} 😔 Lamentablemente {item} no está disponible ahora. ¿Te interesa {alternative}?',
    'Lo siento {nombre}, {item} se agotó 😭 ¿Qué tal {alternative}?',
    'Ups, {item} no tenemos ahora {nombre}. ¿Probamos con {alternative}? 🤔'
  ],
  
  special_day_greeting: [
    '¡Feliz {occasion} {nombre}! 🎉🎊 ¿Qué tal si celebramos con una pizza?',
    '¡{occasion} {nombre}! 🎈 Tenemos ofertas especiales hoy',
    '¡Hey {nombre}! Es {occasion} 🎉 ¿Pedimos algo rico para celebrar?'
  ]
};

/**
 * Emojis contextuales por tipo de mensaje
 */
const CONTEXTUAL_EMOJIS = {
  pizza: ['🍕', '🍕', '🍕', '🍕', '🍕', '🍴', '😋', '🤤'],
  burger: ['🍔', '🍔', '🍔', '🍟', '🤤', '😋'],
  pasta: ['🍝', '🍝', '🍝', '🍴', '😋'],
  chicken: ['🍗', '🍗', '🍗', '🐔', '🤤'],
  drink: ['🥤', '🥤', '🥤', '🍺', '🧃'],
  dessert: ['🍰', '🍰', '🧁', '🍪', '😋'],
  delivery: ['🚗', '🚗', '🚗', '🛵', '🛵', '🏍️', '💨'],
  money: ['💰', '💰', '💵', '💵', '💳', '💸'],
  success: ['✅', '✅', '✅', '✅', '👍', '👌', '🎉', '✨'],
  error: ['❌', '😔', '🙏', '😅'],
  thinking: ['🤔', '🤔', '💭', '🧐'],
  happy: ['😊', '😊', '😊', '😄', '🙂', '😃', '🥰'],
  vip: ['⭐', '⭐', '👑', '💎', '🌟', '🎖️']
};

/**
 * Selecciona una variación aleatoria de respuesta
 * @param {Array<string>} variations 
 * @returns {string}
 */
function selectVariation(variations) {
  if (!Array.isArray(variations) || variations.length === 0) {
    return '';
  }
  const index = Math.floor(Math.random() * variations.length);
  return variations[index];
}

/**
 * Añade emojis contextuales a un mensaje
 * @param {string} message 
 * @param {string} context 
 * @returns {string}
 */
function addContextualEmojis(message, context = '') {
  const lower = message.toLowerCase() + ' ' + context.toLowerCase();
  
  // Detectar contexto y añadir emojis apropiados
  for (const [key, emojis] of Object.entries(CONTEXTUAL_EMOJIS)) {
    if (lower.includes(key)) {
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      // 70% chance de añadir emoji
      if (Math.random() < 0.7) {
        return message + ' ' + emoji;
      }
    }
  }
  
  return message;
}

/**
 * Reemplaza variables en template
 * @param {string} template 
 * @param {Object} vars 
 * @returns {string}
 */
function fillTemplate(template, vars = {}) {
  let result = template;
  
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value || '');
  }
  
  // Limpiar variables no reemplazadas
  result = result.replace(/\{[^}]+\}/g, '');
  
  return result;
}

/**
 * Genera respuesta ultra humanizada
 * @param {string} type - Tipo de respuesta
 * @param {Object} data - Datos para personalización
 * @returns {string} Respuesta humanizada
 */
export function generateHumanizedResponse(type, data = {}) {
  try {
    const nombre = data.nombre || data.name || 'amigo';
    const isVIP = data.isVIP || false;
    
    // Seleccionar tipo de respuesta, considerar VIP
    let responseType = type;
    if (isVIP && type === 'greeting' && ULTRA_RESPONSES.greeting_vip) {
      responseType = 'greeting_vip';
    }
    
    // Obtener variaciones
    const variations = ULTRA_RESPONSES[responseType] || ULTRA_RESPONSES.not_understand;
    
    // Seleccionar variación aleatoria
    let response = selectVariation(variations);
    
    // Llenar template
    response = fillTemplate(response, { nombre, ...data });
    
    // Añadir emojis contextuales
    const context = data.context || type;
    response = addContextualEmojis(response, context);
    
    logger.debug('HUMANIZED_RESPONSE_GENERATED', { 
      type, 
      length: response.length,
      isVIP 
    });
    
    metrics.record('humanized_response', 1, { type, isVIP });
    
    return response;
    
  } catch (error) {
    logger.error('HUMANIZE_ERROR', error);
    return '¡Hola! ¿En qué puedo ayudarte? 😊';
  }
}

/**
 * Genera respuesta de error humanizada
 * @param {string} errorType 
 * @param {Object} data 
 * @returns {string}
 */
export function generateErrorResponse(errorType, data = {}) {
  const errorResponses = {
    invalid_input: [
      'Mmm, creo que hubo un error con lo que escribiste 🤔 ¿Puedes intentar de nuevo?',
      'No logré entender eso 😅 ¿Podrías reformularlo?',
      'Ups, algo no salió bien con tu mensaje. ¿Lo intentas otra vez?'
    ],
    network_error: [
      'Ay no 😔 Tuve un problema de conexión. ¿Reintentas en un momento?',
      'Ups, fallo técnico 🔧 Intenta de nuevo en unos segundos',
      'Perdón, problema de conexión 📡 ¿Puedes enviar de nuevo?'
    ],
    timeout: [
      'Mmm, esto está tardando mucho 😅 ¿Seguimos?',
      'Creo que se demoró demasiado. ¿Continuamos? ⏰',
      'Ups, timeout. ¿Reintentamos? 🔄'
    ],
    generic: [
      'Disculpa, algo salió mal 😔 ¿Lo intentamos de nuevo?',
      'Ay, hubo un error. Pero estoy aquí para ayudarte 💪',
      'Ups, fallé en eso 😅 ¿Probamos otra vez?'
    ]
  };
  
  const responses = errorResponses[errorType] || errorResponses.generic;
  return selectVariation(responses);
}

/**
 * Adapta el tono según el momento del día
 * @returns {string}
 */
export function getDayTimeGreeting() {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 12) {
    return selectVariation([
      '¡Buenos días!', 
      '¡Buen día!', 
      '¡Hola, buenos días!',
      '¡Good morning!',
      '¡Muy buenos días!'
    ]);
  } else if (hour >= 12 && hour < 19) {
    return selectVariation([
      '¡Buenas tardes!',
      '¡Buena tarde!',
      '¡Hola, buenas tardes!',
      '¡Qué tal esta tarde!',
      '¡Linda tarde!'
    ]);
  } else {
    return selectVariation([
      '¡Buenas noches!',
      '¡Buena noche!',
      '¡Hola, buenas noches!',
      '¡Qué tal esta noche!',
      '¡Linda noche!'
    ]);
  }
}

/**
 * Detecta ocasiones especiales automáticamente
 * @returns {string|null}
 */
export function detectSpecialOccasion() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const dayOfWeek = now.getDay();
  
  // Navidad
  if (month === 12 && day === 25) return 'Navidad';
  if (month === 12 && day === 24) return 'Nochebuena';
  
  // Año Nuevo
  if (month === 1 && day === 1) return 'Año Nuevo';
  if (month === 12 && day === 31) return 'Fin de Año';
  
  // Amor y Amistad
  if (month === 2 && day === 14) return 'San Valentín';
  
  // Día del Trabajo
  if (month === 5 && day === 1) return 'Día del Trabajo';
  
  // Fiestas Patrias Perú
  if (month === 7 && (day === 28 || day === 29)) return 'Fiestas Patrias';
  
  // Viernes!
  if (dayOfWeek === 5) return 'Viernes';
  
  // Fin de semana
  if (dayOfWeek === 6 || dayOfWeek === 0) return 'fin de semana';
  
  return null;
}

/**
 * Genera respuesta contextual basada en análisis avanzado
 */
export function generateContextAwareResponse(clientName, intention, context = {}) {
  const responsesByIntention = {
    ORDER: [
      `¡Perfecto ${clientName}! 📦 Ayúdame a capturar tu pedido. ¿Qué te gustaría?`,
      `${clientName}, genial que quieras pedir 🛒 Cuéntame qué se te antoja`,
      `¡Excelente ${clientName}! 🍽️ Dime qué productos quieres y en qué cantidad`,
    ],
    PRICE_INQUIRY: [
      `¡Claro ${clientName}! 💰 Mostrame qué tipo de comida buscas y te digo precios`,
      `${clientName}, con gusto 💵 ¿Qué tipo de platillos te interesan?`,
      `¡Seguro ${clientName}! 🏷️ Tenemos opciones para todos los presupuestos`,
    ],
    LOCATION: [
      `${clientName}, perfecto 📍 Necesito tu ubicación para calcular el delivery`,
      `¡Ok ${clientName}! 🗺️ Comparte tu ubicación o dame la dirección completa`,
      `${clientName}, ayúdame con tus coordenadas 📍 ¿Dónde estás exactamente?`,
    ],
    NEARBY_CUSTOMER: [
      `${clientName}, ¡veo que estás muy cerca! 🎯 ¿Quieres pasar por la tienda o prefieres que te lo lleve?`,
      `¡Oye ${clientName}! 👀 Parece que estás al lado nuestro. ¿Vienes al local o lo envío?`,
      `${clientName}, ¡estás prácticamente aquí! 😄 ¿Pasas a buscar o lo dejo en tu puerta?`,
    ],
    ESCALATE_AGENT: [
      `${clientName}, déjame conectarte con alguien que pueda ayudarte mejor 👥`,
      `${clientName}, voy a pasar esto con un especialista en el equipo 🤝`,
      `Un momento ${clientName}, voy a comunicarte con un agente ahora 📞`,
    ]
  };

  const responses = responsesByIntention[intention] || responsesByIntention.ORDER;
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Respuesta para mensaje con errores de escritura detectados
 */
export function generateTypoCorrectionResponse(clientName, originalMessage, correctedMessage) {
  if (originalMessage === correctedMessage) {
    return null; // Sin correcciones necesarias
  }

  const responses = [
    `${clientName}, creo que quisiste decir: "${correctedMessage}" ¿Es correcto? 😊`,
    `${clientName}, lo que entendí: "${correctedMessage}" ¿Está bien así? ✅`,
    `Déjame confirmar: "${correctedMessage}" ¿Es lo que querías ${clientName}?`,
    `Ok, entendí: "${correctedMessage}" - ¿Así es ${clientName}? 👍`,
  ];

  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Respuesta para validación de ubicación cercana
 */
export function generateProximityResponse(clientName, proximityZone, distance) {
  const responses = {
    EN_TIENDA: [
      `${clientName}, ¡veo que estás en nuestra zona! 🎯 ¿Necesitas asistencia en la tienda?`,
      `¡${clientName}! 👀 Parece que estás aquí. Déjame conectarte con alguien del equipo 👥`,
    ],
    MUY_CERCANO: [
      `${clientName}, estás a solo ${distance.toFixed(1)}km 🚗 ¿Lo recoges rápido o lo envío?`,
      `¡${clientName}! Muy cerca nuestro 😄 ${distance.toFixed(1)}km nada más`,
    ],
    CERCANO: [
      `${clientName}, ${distance.toFixed(1)}km y llega en 15 minutos 🚗`,
      `${clientName}, tienes delivery rápido 💨 ${distance.toFixed(1)}km de distancia`,
    ],
    MEDIO: [
      `${clientName}, ${distance.toFixed(1)}km 📍 Llega en 25-30 minutos`,
    ],
  };

  const selectedResponses = responses[proximityZone] || responses.MEDIO;
  return selectedResponses[Math.floor(Math.random() * selectedResponses.length)];
}

/**
 * Respuesta amigable cuando no se entiende el mensaje
 */
export function generateNotUnderstoodResponse(clientName) {
  const responses = [
    `${clientName}, disculpa, no capté bien eso 😅 ¿Puedes escribirlo de otra forma?`,
    `Hmm ${clientName}, no entendí muy bien 🤔 ¿Lo escribes diferente?`,
    `${clientName}, no sé si entendí correcto 😊 ¿Me lo repites de otra forma?`,
    `${clientName}, necesito que me lo expliques un poco más 💭 ¿Puedes?`,
    `Disculpa ${clientName} 😅 ¿Podrías ser más específico con lo que necesitas?`,
  ];

  return responses[Math.floor(Math.random() * responses.length)];
}

export default {
  generateHumanizedResponse,
  generateErrorResponse,
  getDayTimeGreeting,
  detectSpecialOccasion,
  generateContextAwareResponse,
  generateTypoCorrectionResponse,
  generateProximityResponse,
  generateNotUnderstoodResponse,
  ULTRA_RESPONSES
};
