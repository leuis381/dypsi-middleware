/**
 * 🎯 FUZZY MATCHER - Corrección Inteligente de Errores Ortográficos
 * 
 * Maneja:
 * - Errores de escritura (typos)
 * - Palabras sin tildes
 * - Variaciones de mayúsculas
 * - Omisión de letras
 * - Substitución de caracteres similares
 * - Distancia de Levenshtein
 */

// Diccionario de palabras comunes en restaurante
const RESTAURANT_DICTIONARY = {
  'pollo': ['polo', 'pllo', 'pollo', 'poyo', 'poollo'],
  'pizza': ['piza', 'piza', 'pizzaa', 'pitza', 'pisa'],
  'agua': ['agua', 'aua', 'agüa', 'agua con gas', 'agua pura'],
  'cerveza': ['cervesa', 'cerveza', 'cerve', 'cervecita'],
  'jugo': ['jgo', 'jugo', 'juco', 'zumo'],
  'gaseosa': ['gasesa', 'gaseosa', 'gasosa', 'refresco'],
  'pedido': ['pedido', 'peddi', 'peddido', 'orden'],
  'dirección': ['direccion', 'dirección', 'domicilio', 'direc'],
  'envío': ['envio', 'envío', 'entrega', 'despacho'],
  'precio': ['precio', 'precis', 'preci', 'costo'],
  'pagar': ['pagar', 'paga', 'pago', 'abonar', 'cancelar'],
  'efectivo': ['efectivo', 'efctivo', 'efectv', 'cash'],
  'tarjeta': ['tarjeta', 'terjeta', 'tarj', 'card'],
  'ahora': ['ahora', 'aora', 'ahorita', 'ya'],
  'cuando': ['cuando', 'cuand', 'k', 'kdo'],
  'donde': ['donde', 'dnd', 'dond', 'dn'],
  'promoción': ['promocion', 'promoción', 'promo', 'descuento'],
  'delivery': ['delivery', 'deliveri', 'entrega', 'reparto'],
  'domicilio': ['domicilio', 'domici', 'casa', 'dirección'],
  'cambio': ['cambio', 'cambio', 'cambiar'],
  'comentario': ['comentario', 'coment', 'nota'],
};

// Caracteres similares que suelen confundirse
const SIMILAR_CHARS = {
  '0': 'o', 'o': '0',
  '1': 'l', 'l': '1',
  '3': 'e', 'e': '3',
  '4': 'a', 'a': '4',
  '5': 's', 's': '5',
  '7': 't', 't': '7',
  '8': 'b', 'b': '8',
};

/**
 * Calcula distancia de Levenshtein entre dos strings
 */
function levenshteinDistance(str1, str2) {
  const track = Array(str2.length + 1).fill(null).map(() =>
    Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }

  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }

  return track[str2.length][str1.length];
}

/**
 * Calcula similitud entre dos palabras (0-1)
 */
function calculateSimilarity(word1, word2) {
  const maxLen = Math.max(word1.length, word2.length);
  if (maxLen === 0) return 1;
  
  const distance = levenshteinDistance(word1, word2);
  return 1 - (distance / maxLen);
}

/**
 * Normaliza texto: sin tildes, minúsculas, espacios extras
 */
function normalizeText(text) {
  if (!text) return '';
  
  // Quitar tildes
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Quitar marcas diacríticas
  
  return normalized.toLowerCase().trim();
}

/**
 * Aplica correcciones de caracteres similares
 */
function correctSimilarChars(word) {
  let corrected = word.toLowerCase();
  
  // Intentar corregir sustituciones numéricas comunes
  for (let i = 0; i < corrected.length; i++) {
    const char = corrected[i];
    if (SIMILAR_CHARS[char]) {
      // Probar con el carácter similar
      const testWord = corrected.substring(0, i) + 
                       SIMILAR_CHARS[char] + 
                       corrected.substring(i + 1);
      
      // Ver si existe en diccionario
      for (const [dictWord] of Object.entries(RESTAURANT_DICTIONARY)) {
        if (normalizeText(dictWord) === normalizeText(testWord)) {
          return dictWord;
        }
      }
    }
  }
  
  return word;
}

/**
 * Encuentra la palabra correcta del diccionario más cercana
 */
function findClosestWord(inputWord) {
  const normalized = normalizeText(inputWord);
  let bestMatch = null;
  let bestSimilarity = 0;

  // Buscar en diccionario
  for (const [correctWord, variations] of Object.entries(RESTAURANT_DICTIONARY)) {
    const normalizedCorrect = normalizeText(correctWord);
    
    // Comparar con palabra correcta
    let similarity = calculateSimilarity(normalized, normalizedCorrect);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = correctWord;
    }

    // Comparar con variaciones conocidas
    for (const variation of variations) {
      similarity = calculateSimilarity(normalized, normalizeText(variation));
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = correctWord;
      }
    }
  }

  // Si similitud > 0.65, consideramos que es match
  return bestSimilarity > 0.65 ? bestMatch : inputWord;
}

/**
 * Procesa un texto completo corrigiendo errores
 */
function processText(text) {
  if (!text) return text;

  const words = text.split(/\s+/);
  const correctedWords = words.map(word => {
    // Primero intentar corrección de caracteres similares
    let corrected = correctSimilarChars(word);
    
    // Luego buscar palabra más cercana
    corrected = findClosestWord(corrected);
    
    return corrected;
  });

  return correctedWords.join(' ');
}

/**
 * Detecta si un texto probablemente tiene errores
 */
function hasTypos(text) {
  if (!text) return false;

  const words = text.split(/\s+/);
  let typoCount = 0;

  for (const word of words) {
    const cleaned = word.replace(/[.,!?;:]/g, '');
    
    // Palabras de 3+ letras que no están en diccionario
    if (cleaned.length > 2) {
      let found = false;
      
      for (const dictWord of Object.keys(RESTAURANT_DICTIONARY)) {
        if (normalizeText(cleaned) === normalizeText(dictWord)) {
          found = true;
          break;
        }
        
        const similarity = calculateSimilarity(normalizeText(cleaned), normalizeText(dictWord));
        if (similarity > 0.7) {
          found = true;
          break;
        }
      }
      
      if (!found) {
        typoCount++;
      }
    }
  }

  return typoCount > 0;
}

/**
 * Obtiene sugerencias para un word específico
 */
function getSuggestions(word, limit = 5) {
  const normalized = normalizeText(word);
  const suggestions = [];

  for (const dictWord of Object.keys(RESTAURANT_DICTIONARY)) {
    const similarity = calculateSimilarity(normalized, normalizeText(dictWord));
    if (similarity > 0.5) {
      suggestions.push({
        word: dictWord,
        similarity: similarity
      });
    }
  }

  return suggestions
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Analiza mensaje completo y retorna información de correcciones
 */
function analyzeMessage(message) {
  return {
    original: message,
    processed: processText(message),
    hasTypos: hasTypos(message),
    normalized: normalizeText(message),
    words: message.split(/\s+/).map(word => ({
      original: word,
      corrected: findClosestWord(word),
      suggestions: getSuggestions(word, 3)
    }))
  };
}

export {
  normalizeText,
  levenshteinDistance,
  calculateSimilarity,
  findClosestWord,
  processText,
  hasTypos,
  getSuggestions,
  analyzeMessage,
  correctSimilarChars,
  RESTAURANT_DICTIONARY,
};

export default {
  normalizeText,
  levenshteinDistance,
  calculateSimilarity,
  findClosestWord,
  processText,
  hasTypos,
  getSuggestions,
  analyzeMessage,
  correctSimilarChars,
  RESTAURANT_DICTIONARY,
};
