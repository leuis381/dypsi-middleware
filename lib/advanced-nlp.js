/**
 * 🧠 ADVANCED NLP - Procesamiento de Lenguaje Natural Avanzado
 * 
 * Capacidades:
 * - Análisis de intención compleja
 * - Detección de emojis y símbolos
 * - Análisis de sentimiento
 * - Detección de ubicación/dirección
 * - Soporte para múltiples formatos
 * - Contexto conversacional
 */

import fuzzyMatcher from './fuzzy-matcher.js';

// Patrones de intención complejos
const INTENTION_PATTERNS = {
  // Intención: Realizar pedido
  ORDER: {
    keywords: ['quiero', 'pido', 'dame', 'trae', 'llevar', 'compro', 'necesito', 'me trae', 'dame uno', 'me da'],
    patterns: [
      /^(quiero|pido|dame|trae|necesito|me trae|dame uno|me da|compro|llevar)\s+(.+)/i,
      /(\d+)\s+(pollo|pizza|hamburguesa|arroz|comida|plato|orden)/i,
    ],
    confidence: 0.9
  },

  // Intención: Preguntar precio/promoción
  PRICE_INQUIRY: {
    keywords: ['cuanto', 'costo', 'precio', 'vale', 'cuesta', 'promocion', 'descuento', 'oferta', 'especial'],
    patterns: [
      /(cuanto|costo|precio|vale|cuesta)\s+(.+)?/i,
      /(hay|tiene|oferta|promocion|descuento)/i,
    ],
    confidence: 0.85
  },

  // Intención: Preguntar horarios
  HOURS_INQUIRY: {
    keywords: ['horario', 'atienden', 'abre', 'cierra', 'que hora', 'cuando', 'abierto'],
    patterns: [
      /(horario|atienden|abre|cierra|cuando|que\s+hora)/i,
      /^(esta|estoy|donde|como\s+llego)/i,
    ],
    confidence: 0.8
  },

  // Intención: Ubicación/Dirección
  LOCATION: {
    keywords: ['dirección', 'donde', 'ubicado', 'localizado', 'domicilio', 'calle', 'avda', 'av'],
    patterns: [
      /(donde|ubicado|localizado|dirección|domicilio|calle|avda|av)/i,
      /([A-Z][a-z]+\s+\d+|calle\s+[a-zA-Z]+)/i,
    ],
    confidence: 0.85
  },

  // Intención: Delivery
  DELIVERY_INQUIRY: {
    keywords: ['delivery', 'entrega', 'domicilio', 'llevar', 'reparto', 'pasa', 'trae'],
    patterns: [
      /(delivery|entrega|domicilio|llevar|reparto|hace\s+delivery)/i,
    ],
    confidence: 0.9
  },

  // Intención: Cambio de pedido
  MODIFY_ORDER: {
    keywords: ['cambio', 'sin', 'quita', 'agrega', 'más', 'menos', 'extra', 'modificar'],
    patterns: [
      /(cambio|sin|quita|agrega|mas|menos|extra|modificar|reemplaza)/i,
    ],
    confidence: 0.8
  },

  // Intención: Consulta de estado
  STATUS_CHECK: {
    keywords: ['donde', 'llego', 'viene', 'estado', 'cuando', 'cuanto falta', 'falta mucho'],
    patterns: [
      /(donde|llego|viene|estado|cuando\s+llega|cuanto\s+falta|falta\s+mucho)/i,
    ],
    confidence: 0.85
  },

  // Intención: Agradecimiento/Satisfacción
  SATISFACTION: {
    keywords: ['gracias', 'excelente', 'bueno', 'perfecto', 'genial', 'me encanta', 'rico'],
    patterns: [
      /(gracias|excelente|bueno|perfecto|genial|me\s+encanta|muy\s+rico)/i,
    ],
    confidence: 0.8
  },

  // Intención: Queja/Problema
  COMPLAINT: {
    keywords: ['problema', 'malo', 'queja', 'roto', 'falta', 'error', 'equivocado', 'mal'],
    patterns: [
      /(problema|malo|queja|roto|falta|error|equivocado|mal\s+servicio|no\s+llego)/i,
    ],
    confidence: 0.85
  },
};

// Emojis comunes y su significado
const EMOJI_MEANINGS = {
  '😀': { meaning: 'happy', sentiment: 'positive' },
  '😂': { meaning: 'laughing', sentiment: 'positive' },
  '😃': { meaning: 'smile', sentiment: 'positive' },
  '❤️': { meaning: 'love', sentiment: 'positive' },
  '🍕': { meaning: 'pizza', category: 'food' },
  '🍔': { meaning: 'burger', category: 'food' },
  '🍗': { meaning: 'chicken', category: 'food' },
  '🍜': { meaning: 'noodles', category: 'food' },
  '🥤': { meaning: 'drink', category: 'beverage' },
  '🚗': { meaning: 'car', category: 'delivery' },
  '📍': { meaning: 'location', category: 'location' },
  '⏰': { meaning: 'time', category: 'time' },
  '💰': { meaning: 'money', category: 'payment' },
  '😢': { meaning: 'sad', sentiment: 'negative' },
  '😡': { meaning: 'angry', sentiment: 'negative' },
  '👍': { meaning: 'approved', sentiment: 'positive' },
};

/**
 * Detección de intentión basada en patrones
 */
function detectIntention(message) {
  const processedMsg = fuzzyMatcher.processText(message);
  const results = {};

  for (const [intentionType, config] of Object.entries(INTENTION_PATTERNS)) {
    let score = 0;
    let matchedKeywords = [];
    let matchedPatterns = [];

    // Buscar keywords
    for (const keyword of config.keywords) {
      if (new RegExp(`\\b${keyword}\\b`, 'i').test(processedMsg)) {
        score += 0.15;
        matchedKeywords.push(keyword);
      }
    }

    // Buscar patrones
    for (const pattern of config.patterns) {
      if (pattern.test(processedMsg)) {
        score += 0.35;
        matchedPatterns.push(pattern.toString());
      }
    }

    if (score > 0) {
      results[intentionType] = {
        score: Math.min(score, config.confidence),
        matchedKeywords,
        matchedPatterns,
        confidence: config.confidence
      };
    }
  }

  // Retornar la intención más probable
  let topIntention = null;
  let topScore = 0;

  for (const [intention, data] of Object.entries(results)) {
    if (data.score > topScore) {
      topScore = data.score;
      topIntention = intention;
    }
  }

  return {
    primary: topIntention || 'UNKNOWN',
    score: topScore,
    allDetections: results,
    message: processedMsg
  };
}

/**
 * Extrae ubicación de múltiples fuentes: escritura, Google Maps, WhatsApp share
 */
function extractLocationInfo(message) {
  // Tipo 1: Ubicación por escritura manual
  const manualLocation = extractManualLocation(message);
  if (manualLocation.found) return manualLocation;

  // Tipo 2: Google Maps URL
  const mapsLocation = extractGoogleMapsLocation(message);
  if (mapsLocation.found) return mapsLocation;

  // Tipo 3: WhatsApp Location Share (coordenadas)
  const whatsappLocation = extractWhatsAppLocation(message);
  if (whatsappLocation.found) return whatsappLocation;

  // Tipo 4: Dirección como texto
  const addressLocation = extractAddressFromText(message);
  if (addressLocation.found) return addressLocation;

  return {
    found: false,
    type: 'UNKNOWN',
    source: null,
    latitude: null,
    longitude: null,
    address: null,
    district: null,
    confidence: 0
  };
}

// Extrae ubicación manual/escrita (dirección de texto)
function extractManualLocation(message) {
  // Patrones: "Jr. Bolognesi 123", "Calle Principal 456", etc.
  const manualPatterns = [
    /(?:jr|jirón|calle|avenida|av|avda|pasaje|psj)\s+([a-z\s]+?)\s+(\d+)/i,
    /([a-z\s]+?)\s+(\d+)\s*,?\s+(miraflores|san isidro|santiago|breña|chorrillos|la molina|ate|comas|puente piedra|surco|barranco)/i,
  ];

  for (const pattern of manualPatterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        found: true,
        type: 'MANUAL_ADDRESS',
        source: 'TEXTO_ESCRITO',
        latitude: null,
        longitude: null,
        address: match[0].trim(),
        district: match[3] || null,
        confidence: 0.8
      };
    }
  }

  return { found: false };
}

// Extrae ubicación desde URL de Google Maps
function extractGoogleMapsLocation(message) {
  // Patrones de Google Maps:
  // - https://maps.app.goo.gl/xxxxx
  // - https://www.google.com/maps/place/-12.0465,-77.0428
  // - maps.google.com?q=-12.0465,-77.0428
  const hasMapsIndicator = /maps\.google|google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|google\s*maps|maps\s*:/i.test(message);
  // Primero buscar URLs cortas
  const shortUrl = /https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\/([a-zA-Z0-9]+)/;
  if (shortUrl.test(message)) {
    return {
      found: true,
      type: 'MAPS_SHORT_URL',
      source: 'GOOGLE_MAPS_URL',
      latitude: null,
      longitude: null,
      address: 'URL de Google Maps compartida',
      district: null,
      confidence: 0.9
    };
  }

  // Patrón 1: Coordenadas explícitas en URL (solo si hay indicador de Maps)
  if (hasMapsIndicator) {
    const coordPattern = /(-?\d{1,3}\.?\d{0,6}),\s*(-?\d{1,3}\.?\d{0,6})/;
    const coordMatch = message.match(coordPattern);
    
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      
      // Validar rangos de Perú
      if (lat >= -18 && lat <= -0 && lon >= -84 && lon <= -68) {
        return {
          found: true,
          type: 'COORDINATES',
          source: 'GOOGLE_MAPS_URL',
          latitude: lat,
          longitude: lon,
          coordinates: { lat, lon },
          address: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          district: getDistrictFromCoordinates(lat, lon),
          confidence: 0.95
        };
      }
    }
  }

  return { found: false };
}

// Extrae ubicación desde WhatsApp Location Share
function extractWhatsAppLocation(message) {
  // WhatsApp share location genera:
  // - "📍 Ubicación: -12.0465, -77.0428"
  // - "location: latitude: -12.0465, longitude: -77.0428"
  // - O solo coordenadas en formato "(-12.0465, -77.0428)"
  
  const patterns = [
    /latitude[:\s]*(-?\d{1,3}\.\?\d{0,6})[,\s]+longitude[:\s]*(-?\d{1,3}\.\?\d{0,6})/i,
    /lat[:\s]*(-?\d{1,3}\.\?\d{0,6})[,\s]+lng[:\s]*(-?\d{1,3}\.\?\d{0,6})/i,
    /(-?\d{1,3}\.\?\d{0,6}),\s*(-?\d{1,3}\.\?\d{0,6})/,
    /location[:\s]*lat[^,]*?(-?\d+\.?\d*)[^,]*?lon[^,]*?(-?\d+\.?\d*)/i,
    /ubicación[:\s]*(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/i,
    /coordinates?[:\s]*(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);

      if (lat >= -18 && lat <= -0 && lon >= -84 && lon <= -68) {
        return {
          found: true,
          type: 'WHATSAPP_LOCATION',
          source: 'WHATSAPP_SHARE',
          latitude: lat,
          longitude: lon,
          coordinates: { lat, lon },
          address: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          district: getDistrictFromCoordinates(lat, lon),
          confidence: 0.95
        };
      }
    }
  }

  return { found: false };
}

// Extrae dirección de texto libre
function extractAddressFromText(message) {
  // Busca patrones de dirección en el texto
  const addressPatterns = [
    /(?:enviar a|viven en|vivo en|manda en|en la|dirección|domicilio)\s+(.+?)(?:\.|,|$)/i,
  ];

  for (const pattern of addressPatterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        found: true,
        type: 'FREE_TEXT_ADDRESS',
        source: 'TEXTO_LIBRE',
        latitude: null,
        longitude: null,
        address: match[1].trim(),
        district: null,
        confidence: 0.7
      };
    }
  }

  return { found: false };
}

// Determina distrito basado en coordenadas (aproximado)
function getDistrictFromCoordinates(lat, lon) {
  // Rangos aproximados de distritos de Lima
  const districts = [
    { name: 'MIRAFLORES', latMin: -12.15, latMax: -12.09, lonMin: -77.05, lonMax: -76.99 },
    { name: 'SAN_ISIDRO', latMin: -12.10, latMax: -12.05, lonMin: -77.04, lonMax: -76.98 },
    { name: 'SANTIAGO', latMin: -12.17, latMax: -12.12, lonMin: -77.00, lonMax: -76.94 },
    { name: 'BREÑA', latMin: -12.12, latMax: -12.07, lonMin: -77.08, lonMax: -77.03 },
    { name: 'CHORRILLOS', latMin: -12.25, latMax: -12.15, lonMin: -77.08, lonMax: -77.00 },
    { name: 'LA_MOLINA', latMin: -12.08, latMax: -12.00, lonMin: -76.94, lonMax: -76.86 },
    { name: 'ATE', latMin: -12.07, latMax: -12.00, lonMin: -76.90, lonMax: -76.82 },
  ];

  for (const district of districts) {
    if (lat >= district.latMin && lat <= district.latMax && 
        lon >= district.lonMin && lon <= district.lonMax) {
      return district.name;
    }
  }

  return 'DESCONOCIDO';
}

// FUNCIÓN ANTERIOR (preservada para compatibilidad)
function extractLocationInfoLegacy(message) {
  const patterns = {
    coordinates: /(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    googleMapsLink: /maps\.google\.com|goo\.gl\/maps/i,
    address: /(?:calle|c\.?|av\.?|avenida|pasaje|jirón|psj\.?)\s+([^,\n]+)/i,
    district: /(miraflores|san\s+isidro|surco|san\s+borja|chorrillos|san\s+juan|breña|lima)/i,
    phone: /(\+?51)?(\d{9})/,
  };

  const info = {
    hasCoordinates: false,
    coordinates: null,
    hasGoogleMaps: false,
    address: null,
    district: null,
    phone: null,
  };

  // Buscar coordenadas
  const coordMatch = message.match(patterns.coordinates);
  if (coordMatch) {
    info.hasCoordinates = true;
    info.coordinates = {
      lat: parseFloat(coordMatch[1]),
      lon: parseFloat(coordMatch[2])
    };
  }

  // Buscar Google Maps
  if (patterns.googleMapsLink.test(message)) {
    info.hasGoogleMaps = true;
  }

  // Buscar dirección
  const addressMatch = message.match(patterns.address);
  if (addressMatch) {
    info.address = addressMatch[1].trim();
  }

  // Buscar distrito
  const districtMatch = message.match(patterns.district);
  if (districtMatch) {
    info.district = districtMatch[1].trim();
  }

  // Buscar teléfono
  const phoneMatch = message.match(patterns.phone);
  if (phoneMatch) {
    info.phone = phoneMatch[0];
  }

  return info;
}

/**
 * Analiza sentimiento del mensaje
 */
function analyzeSentiment(message) {
  const positive = ['bueno', 'excelente', 'perfecto', 'genial', 'rico', 'gracias', 'amor', 'mejor'];
  const negative = ['malo', 'terrible', 'horrible', 'problema', 'queja', 'roto', 'falta', 'error'];

  let positiveScore = 0;
  let negativeScore = 0;

  for (const word of positive) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(message)) {
      positiveScore++;
    }
  }

  for (const word of negative) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(message)) {
      negativeScore++;
    }
  }

  const total = positiveScore + negativeScore;
  
  return {
    positive: positiveScore,
    negative: negativeScore,
    sentiment: total === 0 ? 'neutral' : 
               positiveScore > negativeScore ? 'positive' : 'negative',
    score: (positiveScore - negativeScore) / (total || 1)
  };
}

/**
 * Detecta emojis en el mensaje
 */
function detectEmojis(message) {
  const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
  const emojis = message.match(emojiRegex) || [];
  
  const analysis = {
    emojis: emojis,
    count: emojis.length,
    meanings: [],
    sentiment: 'neutral',
    hasFood: false,
    hasDelivery: false,
  };

  for (const emoji of emojis) {
    const meaning = EMOJI_MEANINGS[emoji];
    if (meaning) {
      analysis.meanings.push(meaning);
      
      if (meaning.sentiment) {
        analysis.sentiment = meaning.sentiment;
      }
      if (meaning.category === 'food') {
        analysis.hasFood = true;
      }
      if (meaning.category === 'delivery') {
        analysis.hasDelivery = true;
      }
    }
  }

  return analysis;
}

/**
 * Análisis completo de mensaje
 */
function analyzeMessage(message) {
  return {
    original: message,
    processed: fuzzyMatcher.processText(message),
    intention: {
      type: detectIntention(message).primary,
      ...detectIntention(message)
    },
    location: extractLocationInfo(message),
    sentiment: analyzeSentiment(message),
    emojis: detectEmojis(message),
    typoAnalysis: fuzzyMatcher.analyzeMessage(message),
  };
}

/**
 * Detecta si es cliente nuevo o repetido (por patrones)
 */
function detectClientType(message, conversationHistory = []) {
  const isFirstMessage = conversationHistory.length === 0;
  const hasLocationInfo = extractLocationInfo(message).address || 
                         extractLocationInfo(message).coordinates;

  return {
    isNew: isFirstMessage,
    isReturning: !isFirstMessage,
    seemsOrganized: hasLocationInfo,
    sentiment: analyzeSentiment(message).sentiment
  };
}

export {
  detectIntention,
  extractLocationInfo,
  analyzeSentiment,
  detectEmojis,
  analyzeMessage,
  detectClientType,
  INTENTION_PATTERNS,
  EMOJI_MEANINGS,
};

export default {
  detectIntention,
  extractLocationInfo,
  analyzeSentiment,
  detectEmojis,
  analyzeMessage,
  detectClientType,
  INTENTION_PATTERNS,
  EMOJI_MEANINGS,
};
