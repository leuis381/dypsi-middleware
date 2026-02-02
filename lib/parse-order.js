/**
 * Parser ultrarobusto para pedidos
 *
 * - Detecta ítems, cantidades (números y palabras), variantes/tamaños,
 *   extras (con/sin), y mapea contra el catálogo y sinónimos por plato.
 * - Tolerante a mayúsculas/minúsculas, errores comunes de OCR y abreviaturas.
 * - Devuelve estructura consistente: { items: [{ id, name, quantity, variant, extras, price, rawMatches }], warnings, extrasDetected }
 *
 * Uso
 *   parseOrderText(text, products, { synonyms, language, allowFuzzy })
 *
 * - text string: mensaje del cliente (OCR o texto)
 * - products array: catálogo opcional con objetos { id, name, precio }
 * - synonyms object: { product_id: [alias1, alias2, ...] }
 *
 * Nota: este archivo es autónomo, sin dependencias externas.
 */

const NUMBER_WORDS = {
  // Español
  "cero": 0, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
  "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11,
  "doce": 12, "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16,
  "diecisiete": 17, "dieciocho": 18, "diecinueve": 19, "veinte": 20,
  "veintiuno": 21, "veintidos": 22, "treinta": 30, "cuarenta": 40,
  // Inglés básicos
  "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
  "seven": 7, "eight": 8, "nine": 9, "ten": 10
};

const SIZE_KEYWORDS = {
  "pequeña": "pequena", "pequena": "pequena", "personal": "personal",
  "mediana": "mediana", "familiar": "familiar",
  "small": "pequena", "medium": "mediana", "large": "familiar"
};

const EXTRA_PATTERNS = [
  /\bcon\s+([a-záéíóúñ0-9\s]+?)(?:,|\.|y\b|$)/gi,
  /\bsin\s+([a-záéíóúñ0-9\s]+?)(?:,|\.|y\b|$)/gi,
  /\bagregue\s+([a-záéíóúñ0-9\s]+?)(?:,|\.|y\b|$)/gi,
  /\bmas\s+([a-záéíóúñ0-9\s]+?)(?:,|\.|y\b|$)/gi
];

function normalize(s) {
  if (!s) return "";
  return s.toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // quitar acentos
    .replace(/[^\w\s-]/g, " ")         // quitar puntuación extra
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function parseNumberToken(token) {
  if (!token) return null;
  const digits = token.replace(/[^\d]/g, "");
  if (digits.length) {
    const n = Number(digits);
    if (Number.isFinite(n)) return n;
  }
  const w = token.toLowerCase();
  if (NUMBER_WORDS[w] != null) return NUMBER_WORDS[w];
  return null;
}

function tokenOverlapScore(queryTokens, nameTokens) {
  if (!queryTokens.length || !nameTokens.length) return 0;
  const qSet = new Set(queryTokens);
  const nSet = new Set(nameTokens);
  let common = 0;
  for (const t of qSet) if (nSet.has(t)) common++;
  return common / Math.max(qSet.size, nSet.size);
}

function extractQuantityAroundRaw(raw, indexStart, indexEnd) {
  // Busca patrones en el snippet alrededor de la mención
  const windowSize = 60;
  const start = Math.max(0, indexStart - windowSize);
  const end = Math.min(raw.length, indexEnd + windowSize);
  const snippet = raw.slice(start, end);

  // patrones comunes
  const patterns = [
    /(\d+)\s*[xX]?\s*(?:de\s+)?[a-záéíóúñ\w]{0,30}/i,   // "2 pizza", "2x pizza"
    /\b(x|X)\s*(\d+)\b/,                                // "pizza x2"
    /(\d+)\s*(?:unidades|und|uds|piezas|pz|pz\.)/i,     // "2 unidades"
    /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|veinte)\b/i
  ];

  for (const pat of patterns) {
    const m = snippet.match(pat);
    if (m) {
      for (let i = 1; i < m.length; i++) {
        const q = parseNumberToken(m[i]);
        if (q != null) return q;
      }
      // fallback: buscar palabra número
      const wordMatch = snippet.match(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|veinte)\b/i);
      if (wordMatch) {
        const q = parseNumberToken(wordMatch[1]);
        if (q != null) return q;
      }
    }
  }

  // Si no se detecta, devolver null para que el llamador decida default
  return null;
}

function extractVariantAroundRaw(raw, indexStart, indexEnd) {
  const windowSize = 60;
  const start = Math.max(0, indexStart - windowSize);
  const end = Math.min(raw.length, indexEnd + windowSize);
  const snippet = normalize(raw.slice(start, end));
  for (const k of Object.keys(SIZE_KEYWORDS)) {
    if (snippet.includes(k)) return SIZE_KEYWORDS[k];
  }
  return null;
}

function extractExtras(raw) {
  const extras = [];
  for (const pat of EXTRA_PATTERNS) {
    let m;
    while ((m = pat.exec(raw)) !== null) {
      const rawMatch = m[1] ? m[1].trim() : null;
      if (rawMatch) {
        const cleaned = rawMatch.split(/\b(?:y|,|\.)\b/)[0].trim();
        if (cleaned) extras.push(cleaned);
      }
    }
  }
  return extras;
}

/**
 * Construye mapa alias -> productId a partir de synonyms
 * Soporta dos formatos:
 *  - { productId: [alias1, alias2] }
 *  - { alias: productId }
 */
function buildAliasMap(synonyms) {
  const aliasToId = {};
  if (!synonyms || typeof synonyms !== "object") return aliasToId;
  for (const key of Object.keys(synonyms)) {
    const val = synonyms[key];
    if (Array.isArray(val)) {
      // key es productId
      for (const a of val) {
        const an = normalize(a);
        if (!aliasToId[an]) aliasToId[an] = key;
        else {
          // si ya existe, mantener array de prioridades (primero agregado tiene prioridad)
          const existing = aliasToId[an];
          if (Array.isArray(existing)) {
            if (!existing.includes(key)) existing.push(key);
          } else if (existing !== key) {
            aliasToId[an] = [existing, key];
          }
        }
      }
    } else if (typeof val === "string") {
      // key es alias, val es productId
      const an = normalize(key);
      if (!aliasToId[an]) aliasToId[an] = val;
      else {
        const existing = aliasToId[an];
        if (Array.isArray(existing)) {
          if (!existing.includes(val)) existing.push(val);
        } else if (existing !== val) {
          aliasToId[an] = [existing, val];
        }
      }
    }
  }
  return aliasToId;
}

/**
 * parseOrderText
 */
export function parseOrderText(text = "", products = [], options = {}) {
  const lang = options.language || "es";
  const allowFuzzy = options.allowFuzzy !== false;
  const synonyms = options.synonyms || {};

  const raw = (text || "").toString();
  const normalized = normalize(raw);
  const tokens = tokenize(normalized);
  const extrasGlobal = extractExtras(raw);

  if (!normalized) return { items: [], warnings: ["No text provided"], extrasDetected: [] };

  // Catalogo procesado
  const catalog = (products || []).map((p) => {
    const name = (p.name || p.nombre || p.title || "").toString();
    return {
      id: p.id || p.product_id || name,
      name,
      normName: normalize(name),
      tokens: tokenize(name),
      price: p.precio ?? p.price ?? p.valor ?? null,
      variantes: p.variantes || p.variants || null,
      raw: p
    };
  });

  const aliasToId = buildAliasMap(synonyms);

  const results = [];
  const usedPositions = []; // para evitar matches solapados

  // 1) Buscar coincidencias por alias (sinónimos) - priorizar alias más largos para evitar falsos positivos
  const aliasList = Object.keys(aliasToId).sort((a, b) => b.length - a.length);
  for (const aliasNorm of aliasList) {
    let idx = normalized.indexOf(aliasNorm);
    while (idx >= 0) {
      // evitar solapamiento con match ya usado
      const endIdx = idx + aliasNorm.length;
      const overlaps = usedPositions.some(p => !(endIdx <= p.start || idx >= p.end));
      if (!overlaps) {
        const productIdOrList = aliasToId[aliasNorm];
        // resolver prioridad si hay múltiples productIds para el mismo alias
        const productIds = Array.isArray(productIdOrList) ? productIdOrList : [productIdOrList];
        // intentar mapear a producto del catálogo si existe
        let mappedProd = null;
        for (const pid of productIds) {
          const prod = catalog.find(c => String(c.id) === String(pid));
          if (prod) { mappedProd = prod; break; }
        }
        // si no está en catálogo, usar el primer productId como id y name fallback
        const id = mappedProd ? mappedProd.id : productIds[0];
        const name = mappedProd ? mappedProd.name : id;

        // extraer cantidad y variante alrededor del índice en raw (usar raw para preservar números)
        const qty = extractQuantityAroundRaw(raw, idx, endIdx) || 1;
        const variant = extractVariantAroundRaw(raw, idx, endIdx) || null;

        results.push({
          id,
          name,
          quantity: qty,
          variant,
          extras: extrasGlobal,
          priceHint: mappedProd ? mappedProd.price : null,
          rawMatch: { method: "synonym", alias: aliasNorm, index: idx }
        });

        usedPositions.push({ start: idx, end: endIdx });
      }
      // buscar siguiente ocurrencia del alias
      idx = normalized.indexOf(aliasNorm, idx + 1);
    }
  }

  // 2) Exact name substring matches en catálogo (si no ya detectado)
  for (const prod of catalog) {
    if (!prod.normName) continue;
    if (results.find(r => String(r.id) === String(prod.id))) continue;
    const idx = normalized.indexOf(prod.normName);
    if (idx >= 0) {
      const endIdx = idx + prod.normName.length;
      const overlaps = usedPositions.some(p => !(endIdx <= p.start || idx >= p.end));
      if (!overlaps) {
        const qty = extractQuantityAroundRaw(raw, idx, endIdx) || 1;
        const variant = extractVariantAroundRaw(raw, idx, endIdx) || null;
        results.push({
          id: prod.id,
          name: prod.name,
          quantity: qty,
          variant,
          extras: extrasGlobal,
          priceHint: prod.price,
          rawMatch: { method: "exact_name", matched: prod.normName, index: idx }
        });
        usedPositions.push({ start: idx, end: endIdx });
      }
    }
  }

  // 3) Fuzzy/token-overlap matching para productos no detectados
  if (allowFuzzy) {
    const unmatched = catalog.filter(c => !results.find(r => String(r.id) === String(c.id)));
    for (const prod of unmatched) {
      const score = tokenOverlapScore(tokens, prod.tokens);
      const hasExactToken = prod.tokens.some(t => tokens.includes(t));
      if (score >= 0.5 || hasExactToken) {
        // intentar localizar índice aproximado por primer token coincidente
        let idx = -1;
        for (const t of prod.tokens) {
          idx = normalized.indexOf(t);
          if (idx >= 0) break;
        }
        if (idx < 0) idx = 0;
        const endIdx = idx + (prod.normName.length || 0);
        const qty = extractQuantityAroundRaw(raw, idx, endIdx) || 1;
        const variant = extractVariantAroundRaw(raw, idx, endIdx) || null;
        results.push({
          id: prod.id,
          name: prod.name,
          quantity: qty,
          variant,
          extras: extrasGlobal,
          priceHint: prod.price,
          rawMatch: { method: "fuzzy", score: Number(score.toFixed(2)), matchedTokens: prod.tokens }
        });
      }
    }
  }

  // 4) Fallback genérico por keywords si no hay resultados
  if (results.length === 0) {
    const genericKeywords = ["pizza", "alitas", "lasagna", "lasaña", "burger", "hamburguesa", "salchipapa", "choripan", "tequenos", "crispy"];
    for (const kw of genericKeywords) {
      if (normalized.includes(kw)) {
        const idx = normalized.indexOf(kw);
        const qty = extractQuantityAroundRaw(raw, idx, idx + kw.length) || 1;
        // buscar mejor candidato en catálogo que contenga la keyword
        const candidate = catalog.find(c => c.normName.includes(kw));
        if (candidate) {
          results.push({
            id: candidate.id,
            name: candidate.name,
            quantity: qty,
            variant: extractVariantAroundRaw(raw, idx, idx + kw.length) || null,
            extras: extrasGlobal,
            priceHint: candidate.price,
            rawMatch: { method: "fallback_generic", keyword: kw }
          });
        } else {
          // si no hay candidato, devolver keyword genérica como id
          results.push({
            id: kw,
            name: kw,
            quantity: qty,
            variant: extractVariantAroundRaw(raw, idx, idx + kw.length) || null,
            extras: extrasGlobal,
            priceHint: null,
            rawMatch: { method: "fallback_generic", keyword: kw }
          });
        }
      }
    }
  }

  // 5) Post-procesamiento: merge duplicados sumando cantidades y consolidando rawMatches
  const merged = [];
  for (const it of results) {
    const key = `${String(it.id)}||${it.variant || ""}`;
    const existing = merged.find(m => `${String(m.id)}||${m.variant || ""}` === key);
    if (existing) {
      existing.quantity = (existing.quantity || 0) + (it.quantity || 0);
      existing.rawMatches = existing.rawMatches || [];
      existing.rawMatches.push(it.rawMatch);
      // preferir priceHint si existe
      if (!existing.priceHint && it.priceHint) existing.priceHint = it.priceHint;
      // merge extras
      existing.extras = Array.from(new Set([...(existing.extras || []), ...(it.extras || [])]));
    } else {
      merged.push({ ...it, rawMatches: [it.rawMatch] });
    }
  }

  // 6) Construir items finales con defaults seguros
  const items = merged.map(m => ({
    id: m.id,
    name: m.name,
    quantity: Math.max(1, parseInt(m.quantity || 1, 10)),
    variant: m.variant || null,
    extras: Array.isArray(m.extras) ? m.extras : (m.extras ? [m.extras] : []),
    price: m.priceHint != null ? Number(m.priceHint) : null,
    rawMatches: m.rawMatches || []
  }));

  // 7) Warnings para coincidencias ambiguas (fuzzy con score bajo)
  const warnings = [];
  for (const m of merged) {
    const rm = m.rawMatches?.[0];
    if (rm && rm.method === "fuzzy" && rm.score && rm.score < 0.6) {
      warnings.push(`Posible ambigüedad para "${m.name}" (score ${rm.score}).`);
    }
  }

  return { items, warnings, extrasDetected: extrasGlobal };
}

export default parseOrderText;
