/**
 * lib/text-normalizer.js
 * 
 * Normalizador de texto EXTREMO para manejo de:
 * - Mayúsculas/minúsculas
 * - Tildes y caracteres especiales
 * - Typos comunes
 * - Variaciones de escritura
 * - Espacios múltiples
 */

import { logger } from './utils.js';

/**
 * Diccionario de reemplazos de typos comunes
 */
const TYPO_DICTIONARY = {
  'q': ['k', 'kk', 'c'],
  'z': ['s', 'c', 'ç'],
  'c': ['k', 's', 'z'],
  'v': ['b', 'u'],
  'b': ['v', 'u'],
  'rr': ['r', 'rrrr'],
  'll': ['l', 'lll'],
  'j': ['g', 'h', 'x'],
  'x': ['j', 'h', 's'],
  'h': ['j', 'x', ''],
  'ñ': ['n', 'ni', 'ny'],
  'y': ['i', 'll', 'y'],
  'i': ['y', 'e', '1'],
  'o': ['0', 'u', 'au'],
  'a': ['á', 'à', 'â', 'ä'],
  'e': ['é', 'è', 'ê', 'ë'],
  'u': ['ú', 'ù', 'û', 'ü'],
};

/**
 * Diccionario de variantes de palabras
 */
const WORD_VARIANTS = {
  'cheeese': 'cheese',
  'queso': 'cheese',
  'jamón': 'jamon',
  'jamon': 'jamón',
  'choriso': 'chorizo',
  'salchicha': 'salchicha',
  'peperoni': 'pepperoni',
  'pepperoni': 'pepperoni',
  'hawaiiana': 'hawaiana',
  'hawaiiana': 'hawaiana',
  'margherita': 'margherita',
  'margarita': 'margherita',
  'cuatro quesos': 'cuatro_quesos',
  '4 quesos': 'cuatro_quesos',
  'cuatro magos': 'cuatro_quesos',
  'especial': 'especialidad',
  'borde': 'borde_relleno',
  'relleno': 'borde_relleno',
  'pan': 'pan_ajo',
  'papa': 'papa',
  'papa frita': 'papa_frita',
  'papas fritas': 'papa_frita',
  'fritas': 'papa_frita',
};

/**
 * Reemplazos comunes de abreviaturas/jerga
 */
const ABBREVIATION_MAP = {
  'tbm': 'tambien',
  'tb': 'tambien',
  'tmb': 'tambien',
  'pq': 'porque',
  'x': 'por',
  'xq': 'porque',
  'x2': 'por dos',
  'k': 'que',
  'q': 'que',
  '1': 'uno',
  '2': 'dos',
  '3': 'tres',
  '4': 'cuatro',
  '5': 'cinco',
  '6': 'seis',
  '7': 'siete',
  '8': 'ocho',
  '9': 'nueve',
  '0': 'cero',
  'msg': 'mensaje',
  'msg': 'mensaje',
  'sms': 'mensaje',
  'pls': 'por favor',
  'plz': 'por favor',
  'thx': 'gracias',
  'thanks': 'gracias',
  'ok': 'okay',
};

/**
 * Normaliza tildes y caracteres especiales
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto sin tildes
 */
function removeDiacritics(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/gi, 'n')
    .replace(/ç/gi, 'c');
}

/**
 * Normalización EXTREMA de texto
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
export function extremeNormalize(text) {
  if (!text || typeof text !== 'string') return '';

  let normalized = text
    // 1. Convertir a minúsculas
    .toLowerCase()
    // 2. Remover tildes y acentos
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // 3. Remover caracteres especiales (mantener letras, números, espacios)
    .replace(/[^a-z0-9\s]/gi, ' ')
    // 4. Reemplazar múltiples espacios con uno
    .replace(/\s+/g, ' ')
    // 5. Trim
    .trim();

  // 6. Reemplazar abreviaturas y jerga
  const words = normalized.split(/\s+/);
  const expanded = words.map(word => ABBREVIATION_MAP[word] || word).join(' ');

  // 7. Reemplazar variantes de palabras
  let result = expanded;
  Object.entries(WORD_VARIANTS).forEach(([variant, canonical]) => {
    const regex = new RegExp(`\\b${removeDiacritics(variant)}\\b`, 'gi');
    result = result.replace(regex, canonical);
  });

  return result;
}

/**
 * Calcula similitud Levenshtein entre dos strings (edits distance)
 * @param {string} a - Primer string
 * @param {string} b - Segundo string
 * @returns {number} Distancia de edición (0 = idéntico)
 */
export function levenshteinDistance(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return Infinity;
  
  const normalized_a = extremeNormalize(a);
  const normalized_b = extremeNormalize(b);
  
  if (normalized_a === normalized_b) return 0;
  
  const matrix = [];
  
  for (let i = 0; i <= normalized_b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= normalized_a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= normalized_b.length; i++) {
    for (let j = 1; j <= normalized_a.length; j++) {
      if (normalized_b.charAt(i - 1) === normalized_a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[normalized_b.length][normalized_a.length];
}

/**
 * Calcula similitud como porcentaje (0-1)
 * @param {string} a - Primer string
 * @param {string} b - Segundo string
 * @returns {number} Similitud (0-1)
 */
export function stringSimilarity(a, b) {
  const normalized_a = extremeNormalize(a);
  const normalized_b = extremeNormalize(b);
  
  if (!normalized_a || !normalized_b) return 0;
  
  const distance = levenshteinDistance(normalized_a, normalized_b);
  const maxLen = Math.max(normalized_a.length, normalized_b.length);
  
  if (maxLen === 0) return 1;
  
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Calcula similitud Jaro-Winkler (mejor para nombres)
 * @param {string} a - Primer string
 * @param {string} b - Segundo string
 * @returns {number} Similitud (0-1)
 */
export function jaroWinklerSimilarity(a, b) {
  const normalized_a = extremeNormalize(a);
  const normalized_b = extremeNormalize(b);
  
  if (normalized_a === normalized_b) return 1;
  if (!normalized_a || !normalized_b) return 0;

  const len_a = normalized_a.length;
  const len_b = normalized_b.length;
  const match_distance = Math.floor(Math.max(len_a, len_b) / 2) - 1;
  
  if (match_distance < 0) return 0;

  const a_matches = new Array(len_a).fill(false);
  const b_matches = new Array(len_b).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len_a; i++) {
    const start = Math.max(0, i - match_distance);
    const end = Math.min(i + match_distance + 1, len_b);
    
    for (let j = start; j < end; j++) {
      if (b_matches[j] || normalized_a[i] !== normalized_b[j]) continue;
      a_matches[i] = true;
      b_matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len_a; i++) {
    if (!a_matches[i]) continue;
    while (!b_matches[k]) k++;
    if (normalized_a[i] !== normalized_b[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len_a + matches / len_b + (matches - transpositions / 2) / matches) / 3;
  
  // Jaro-Winkler adds prefix bonus
  let prefix = 0;
  for (let i = 0; i < Math.min(len_a, len_b, 4); i++) {
    if (normalized_a[i] === normalized_b[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Busca coincidencias en un array de strings con manejo de typos
 * @param {string} query - Texto de búsqueda
 * @param {string[]} candidates - Array de candidatos
 * @param {number} threshold - Umbral mínimo de similitud (0-1)
 * @returns {Array<{candidate: string, score: number}>} Resultados ordenados por score
 */
export function fuzzyMatch(query, candidates = [], threshold = 0.6) {
  if (!query || !Array.isArray(candidates)) return [];

  const normalized_query = extremeNormalize(query);
  
  const results = candidates
    .map(candidate => {
      if (!candidate) return null;
      
      const normalized_candidate = extremeNormalize(candidate);
      
      // Usar Jaro-Winkler para mejor precisión
      const score = jaroWinklerSimilarity(normalized_query, normalized_candidate);
      
      // Bonus por coincidencia de prefijo
      let prefixBonus = 0;
      if (normalized_candidate.startsWith(normalized_query.substring(0, 3))) {
        prefixBonus = 0.15;
      }
      
      const finalScore = Math.min(1, score + prefixBonus);
      
      return { candidate, score: finalScore };
    })
    .filter(r => r && r.score >= threshold)
    .sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Encuentra la mejor coincidencia en un array
 * @param {string} query - Texto de búsqueda
 * @param {string[]} candidates - Array de candidatos
 * @returns {Object|null} {candidate: string, score: number} o null
 */
export function bestMatch(query, candidates = []) {
  const results = fuzzyMatch(query, candidates, 0.5);
  return results.length > 0 ? results[0] : null;
}

export default {
  extremeNormalize,
  removeDiacritics,
  levenshteinDistance,
  stringSimilarity,
  jaroWinklerSimilarity,
  fuzzyMatch,
  bestMatch
};
