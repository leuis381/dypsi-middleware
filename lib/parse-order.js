/**
 * lib/parse-order.js
 *
 * Parser ultrarobusto para pedidos
 *
 * API:
 *   parseOrderText(text, catalogOrMenu, options)
 *
 * - text: string (mensaje u OCR)
 * - catalogOrMenu: array de productos o objeto menu { categorias: [...] }
 * - options:
 *    - synonyms: { productId: [alias1, alias2], alias: productId } (ambos formatos)
 *    - language: "es"|"en"
 *    - allowFuzzy: boolean (default true)
 *    - fuzzyThreshold: number (0-1) (default 0.5)
 *    - preferExactVariant: boolean (default true)
 *    - debug: boolean (si true, incluye campo diagnostics)
 *
 * Devuelve:
 *  {
 *    items: [{ id, name, quantity, variant, extras, unitPrice, price, confidence, candidates, rawMatches }],
 *    warnings: [],
 *    extrasDetected: [],
 *    diagnostics?: {...} // si options.debug = true
 *  }
 *
 * Nota: autónomo, sin dependencias externas.
 */

/* -------------------- Config / Diccionarios -------------------- */

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
  /\bcon\s+([a-záéíóúñ0-9\s\-\/]+?)(?:,|\.|y\b|$)/gi,
  /\bsin\s+([a-záéíóúñ0-9\s\-\/]+?)(?:,|\.|y\b|$)/gi,
  /\bmas\s+([a-záéíóúñ0-9\s\-\/]+?)(?:,|\.|y\b|$)/gi,
  /\bagregue\s+([a-záéíóúñ0-9\s\-\/]+?)(?:,|\.|y\b|$)/gi
];

const GENERIC_KEYWORDS = ["pizza","alitas","lasagna","lasaña","burger","hamburguesa","salchipapa","choripan","tequenos","crispy","combo"];

/* -------------------- Utilidades -------------------- */

function normalize(s) {
  if (!s) return "";
  return s.toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
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

/* Levenshtein distance (para fuzzy) */
function levenshtein(a = "", b = "") {
  a = a || ""; b = b || "";
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const v0 = new Array(bl + 1).fill(0);
  const v1 = new Array(bl + 1).fill(0);
  for (let i = 0; i <= bl; i++) v0[i] = i;
  for (let i = 0; i < al; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bl; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let k = 0; k <= bl; k++) v0[k] = v1[k];
  }
  return v1[bl];
}

function similarityScore(a = "", b = "") {
  // normalized token overlap + normalized levenshtein
  const an = normalize(a);
  const bn = normalize(b);
  if (!an || !bn) return 0;
  const atoks = tokenize(an);
  const btoks = tokenize(bn);
  const overlap = tokenOverlapScore(atoks, btoks);
  const lev = levenshtein(an, bn);
  const maxLen = Math.max(an.length, bn.length);
  const levScore = maxLen === 0 ? 1 : 1 - (lev / maxLen);
  // weight tokens more
  return Math.max(0, Math.min(1, (0.65 * overlap) + (0.35 * levScore)));
}

function tokenOverlapScore(queryTokens, nameTokens) {
  if (!queryTokens.length || !nameTokens.length) return 0;
  const qSet = new Set(queryTokens);
  const nSet = new Set(nameTokens);
  let common = 0;
  for (const t of qSet) if (nSet.has(t)) common++;
  return common / Math.max(qSet.size, nSet.size);
}

/* -------------------- Extracción de cantidades / variantes / extras -------------------- */

function extractQuantityAroundRaw(raw, indexStart, indexEnd) {
  const windowSize = 80;
  const start = Math.max(0, indexStart - windowSize);
  const end = Math.min(raw.length, indexEnd + windowSize);
  const snippet = raw.slice(start, end);

  const patterns = [
    /(\d+)\s*[xX]?\s*(?:de\s+)?[a-záéíóúñ\w]{0,30}/i,
    /\b[xX]\s*(\d+)\b/,
    /(\d+)\s*(?:unidades|und|uds|piezas|pz|pz\.)/i,
    /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|veinte)\b/i
  ];

  for (const pat of patterns) {
    const m = snippet.match(pat);
    if (m) {
      for (let i = 1; i < m.length; i++) {
        const q = parseNumberToken(m[i]);
        if (q != null) return q;
      }
      const wordMatch = snippet.match(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|veinte)\b/i);
      if (wordMatch) {
        const q = parseNumberToken(wordMatch[1]);
        if (q != null) return q;
      }
    }
  }
  return null;
}

function extractVariantAroundRaw(raw, indexStart, indexEnd) {
  const windowSize = 80;
  const start = Math.max(0, indexStart - windowSize);
  const end = Math.min(raw.length, indexEnd + windowSize);
  const snippet = normalize(raw.slice(start, end));
  for (const k of Object.keys(SIZE_KEYWORDS)) {
    if (snippet.includes(k)) return SIZE_KEYWORDS[k];
  }
  // also detect common abbreviations like "med", "fam", "pers"
  if (/\bmed\b/i.test(snippet)) return "mediana";
  if (/\bfam\b/i.test(snippet)) return "familiar";
  if (/\bpers\b/i.test(snippet)) return "personal";
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

/* -------------------- Catalog helpers -------------------- */

function flattenCatalog(menuOrArray) {
  const list = [];
  if (!menuOrArray) return list;
  if (Array.isArray(menuOrArray)) {
    for (const p of menuOrArray) {
      list.push(normalizeProduct(p));
    }
    return list;
  }
  // assume menu object with categorias
  const categorias = menuOrArray.categorias || [];
  for (const cat of categorias) {
    const productos = cat.productos || [];
    for (const p of productos) list.push(normalizeProduct(p));
  }
  return list;
}

function normalizeProduct(p) {
  const name = (p.nombre || p.name || p.title || "").toString();
  return {
    id: p.id || p.sku || name,
    name,
    normName: normalize(name),
    tokens: tokenize(name),
    price: p.precio ?? p.price ?? null,
    variantes: p.variantes || null,
    modifiers: p.modificadores || p.modifiers || [],
    raw: p
  };
}

/* -------------------- Synonyms map -------------------- */

function buildAliasMap(synonyms) {
  const aliasToId = {};
  if (!synonyms || typeof synonyms !== "object") return aliasToId;
  for (const key of Object.keys(synonyms)) {
    const val = synonyms[key];
    if (Array.isArray(val)) {
      // key is productId
      for (const a of val) {
        const an = normalize(a);
        if (!aliasToId[an]) aliasToId[an] = key;
        else {
          const existing = aliasToId[an];
          if (Array.isArray(existing)) {
            if (!existing.includes(key)) existing.push(key);
          } else if (existing !== key) {
            aliasToId[an] = [existing, key];
          }
        }
      }
    } else if (typeof val === "string") {
      // key is alias, val is productId
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

/* -------------------- Matching strategies -------------------- */

function findExactMatches(normalizedText, catalog, usedPositions) {
  const results = [];
  for (const prod of catalog) {
    if (!prod.normName) continue;
    if (normalizedText.includes(prod.normName)) {
      let idx = normalizedText.indexOf(prod.normName);
      while (idx >= 0) {
        const endIdx = idx + prod.normName.length;
        const overlaps = usedPositions.some(p => !(endIdx <= p.start || idx >= p.end));
        if (!overlaps) {
          results.push({ prod, idx, endIdx, method: "exact_name" });
          usedPositions.push({ start: idx, end: endIdx });
        }
        idx = normalizedText.indexOf(prod.normName, idx + 1);
      }
    }
  }
  return results;
}

function findAliasMatches(normalizedText, aliasMap, catalog, usedPositions) {
  const results = [];
  const aliasList = Object.keys(aliasMap).sort((a,b)=>b.length-a.length);
  for (const aliasNorm of aliasList) {
    let idx = normalizedText.indexOf(aliasNorm);
    while (idx >= 0) {
      const endIdx = idx + aliasNorm.length;
      const overlaps = usedPositions.some(p => !(endIdx <= p.start || idx >= p.end));
      if (!overlaps) {
        const productIdOrList = aliasMap[aliasNorm];
        const productIds = Array.isArray(productIdOrList) ? productIdOrList : [productIdOrList];
        // try to map to catalog product
        let mappedProd = null;
        for (const pid of productIds) {
          const prod = catalog.find(c => String(c.id) === String(pid));
          if (prod) { mappedProd = prod; break; }
        }
        results.push({ alias: aliasNorm, idx, endIdx, productIds, mappedProd, method: "synonym" });
        usedPositions.push({ start: idx, end: endIdx });
      }
      idx = normalizedText.indexOf(aliasNorm, idx + 1);
    }
  }
  return results;
}

function findFuzzyMatches(tokens, catalog, usedIds, fuzzyThreshold) {
  const results = [];
  for (const prod of catalog) {
    if (usedIds.has(String(prod.id))) continue;
    const score = similarityScore(tokens.join(" "), prod.normName);
    if (score >= fuzzyThreshold) {
      results.push({ prod, score, method: "fuzzy" });
    }
  }
  // sort by score desc
  results.sort((a,b)=>b.score - a.score);
  return results;
}

/* -------------------- Merge / Postprocess -------------------- */

function mergeResults(rawResults) {
  const merged = [];
  for (const it of rawResults) {
    const key = `${String(it.id)}||${it.variant || ""}`;
    const existing = merged.find(m => `${String(m.id)}||${m.variant || ""}` === key);
    if (existing) {
      existing.quantity = (existing.quantity || 0) + (it.quantity || 0);
      existing.rawMatches = existing.rawMatches || [];
      existing.rawMatches.push(it.rawMatch);
      if (!existing.unitPrice && it.unitPrice) existing.unitPrice = it.unitPrice;
      existing.extras = Array.from(new Set([...(existing.extras||[]), ...(it.extras||[])]));
      existing.candidates = Array.from(new Set([...(existing.candidates||[]), ...(it.candidates||[])]));
      existing.confidence = Math.max(existing.confidence || 0, it.confidence || 0);
    } else {
      merged.push({ ...it, rawMatches: [it.rawMatch], candidates: it.candidates || [], confidence: it.confidence || 1 });
    }
  }
  return merged;
}

/* -------------------- Main parser -------------------- */

export function parseOrderText(text = "", catalogOrMenu = [], options = {}) {
  const lang = options.language || "es";
  const allowFuzzy = options.allowFuzzy !== false;
  const fuzzyThreshold = typeof options.fuzzyThreshold === "number" ? options.fuzzyThreshold : 0.5;
  const synonyms = options.synonyms || {};
  const debug = !!options.debug;

  const diagnostics = { steps: [], rawMatches: [] };

  const raw = (text || "").toString();
  const normalized = normalize(raw);
  const tokens = tokenize(normalized);
  const extrasGlobal = extractExtras(raw);

  if (!normalized) return { items: [], warnings: ["No text provided"], extrasDetected: [], diagnostics: debug ? diagnostics : undefined };

  // build catalog
  const catalog = flattenCatalog(catalogOrMenu);
  diagnostics.steps.push(`Catalog flattened: ${catalog.length} products`);

  // build alias map
  const aliasMap = buildAliasMap(synonyms);
  diagnostics.steps.push(`Alias map entries: ${Object.keys(aliasMap).length}`);

  const usedPositions = [];
  const rawResults = [];
  const usedIds = new Set();

  // 1) Alias matches (prioritizar alias largos)
  const aliasMatches = findAliasMatches(normalized, aliasMap, catalog, usedPositions);
  for (const am of aliasMatches) {
    const idx = am.idx;
    const endIdx = am.endIdx;
    const qty = extractQuantityAroundRaw(raw, idx, endIdx) || 1;
    const variant = extractVariantAroundRaw(raw, idx, endIdx) || null;
    const prod = am.mappedProd || null;
    const id = prod ? prod.id : (Array.isArray(am.productIds) ? am.productIds[0] : am.productIds);
    const name = prod ? prod.name : id;
    const unitPrice = prod ? (prod.price ?? null) : null;
    const confidence = prod ? 0.95 : 0.6;
    rawResults.push({
      id, name, quantity: qty, variant, extras: extrasGlobal, unitPrice, price: unitPrice != null ? unitPrice * qty : null,
      rawMatch: { method: am.method, alias: am.alias, index: idx }, candidates: prod ? [] : am.productIds, confidence
    });
    diagnostics.rawMatches.push({ type: "alias", alias: am.alias, idx });
    if (prod) usedIds.add(String(prod.id));
  }

  // 2) Exact name matches
  const exactMatches = findExactMatches(normalized, catalog, usedPositions);
  for (const em of exactMatches) {
    const prod = em.prod;
    const idx = em.idx;
    const endIdx = em.endIdx;
    const qty = extractQuantityAroundRaw(raw, idx, endIdx) || 1;
    const variant = extractVariantAroundRaw(raw, idx, endIdx) || null;
    const unitPrice = prod.price ?? null;
    rawResults.push({
      id: prod.id, name: prod.name, quantity: qty, variant, extras: extrasGlobal, unitPrice, price: unitPrice != null ? unitPrice * qty : null,
      rawMatch: { method: em.method, matched: prod.normName, index: idx }, candidates: [], confidence: 0.98
    });
    diagnostics.rawMatches.push({ type: "exact", id: prod.id, idx });
    usedIds.add(String(prod.id));
  }

  // 3) Fuzzy matching (tokens / levenshtein)
  if (allowFuzzy) {
    const fuzzyCandidates = findFuzzyMatches(tokens, catalog, usedIds, fuzzyThreshold);
    for (const fc of fuzzyCandidates) {
      const prod = fc.prod;
      const score = fc.score;
      // approximate index: first token of product in normalized text
      let idx = -1;
      for (const t of prod.tokens) {
        idx = normalized.indexOf(t);
        if (idx >= 0) break;
      }
      if (idx < 0) idx = 0;
      const endIdx = idx + (prod.normName.length || 0);
      const qty = extractQuantityAroundRaw(raw, idx, endIdx) || 1;
      const variant = extractVariantAroundRaw(raw, idx, endIdx) || null;
      const unitPrice = prod.price ?? null;
      rawResults.push({
        id: prod.id, name: prod.name, quantity: qty, variant, extras: extrasGlobal, unitPrice, price: unitPrice != null ? unitPrice * qty : null,
        rawMatch: { method: "fuzzy", score: Number(score.toFixed(2)), matchedTokens: prod.tokens }, candidates: [], confidence: Number(score.toFixed(2))
      });
      diagnostics.rawMatches.push({ type: "fuzzy", id: prod.id, score });
      usedIds.add(String(prod.id));
    }
  }

  // 4) Fallback generic keywords if still nothing
  if (rawResults.length === 0) {
    for (const kw of GENERIC_KEYWORDS) {
      if (normalized.includes(kw)) {
        const idx = normalized.indexOf(kw);
        const qty = extractQuantityAroundRaw(raw, idx, idx + kw.length) || 1;
        const candidate = catalog.find(c => c.normName.includes(kw));
        if (candidate) {
          rawResults.push({
            id: candidate.id, name: candidate.name, quantity: qty, variant: extractVariantAroundRaw(raw, idx, idx + kw.length) || null,
            extras: extrasGlobal, unitPrice: candidate.price ?? null, price: candidate.price != null ? candidate.price * qty : null,
            rawMatch: { method: "fallback_generic", keyword: kw }, candidates: [], confidence: 0.6
          });
          usedIds.add(String(candidate.id));
        } else {
          rawResults.push({
            id: kw, name: kw, quantity: qty, variant: null, extras: extrasGlobal, unitPrice: null, price: null,
            rawMatch: { method: "fallback_generic", keyword: kw }, candidates: [], confidence: 0.4
          });
        }
      }
    }
  }

  // 5) Post-process: merge duplicates, compute safe defaults
  const merged = mergeResults(rawResults);

  // 6) Finalize items: ensure types, compute price if missing using variantes
  const items = merged.map(m => {
    // compute unitPrice from variant if missing and product has variantes
    let unitPrice = m.unitPrice != null ? Number(m.unitPrice) : null;
    // try to get variant price from raw product if available
    if ((unitPrice == null || unitPrice === 0) && m.rawMatches && m.rawMatches.length) {
      // attempt to find product in catalog to resolve variant price
      const prod = catalog.find(c => String(c.id) === String(m.id));
      if (prod && prod.variantes && m.variant) {
        const vprice = prod.variantes[m.variant] ?? prod.variantes[normalize(m.variant)];
        if (vprice != null) unitPrice = Number(vprice);
      }
    }
    const quantity = Math.max(1, parseInt(m.quantity || 1, 10));
    const price = unitPrice != null ? roundTo(unitPrice * quantity, 0.01) : null;
    return {
      id: m.id,
      name: m.name,
      quantity,
      variant: m.variant || null,
      extras: Array.isArray(m.extras) ? m.extras : (m.extras ? [m.extras] : []),
      unitPrice: unitPrice != null ? Number(unitPrice) : null,
      price,
      confidence: typeof m.confidence === "number" ? Number(m.confidence) : 1,
      candidates: m.candidates || [],
      rawMatches: m.rawMatches || []
    };
  });

  // 7) Warnings for ambiguous items (low confidence or multiple candidates)
  const warnings = [];
  for (const it of items) {
    if (it.confidence < 0.6) warnings.push(`Posible ambigüedad para "${it.name}" (confidence ${it.confidence}).`);
    if (it.candidates && it.candidates.length > 0) warnings.push(`Alias con múltiples coincidencias para "${it.name}": ${it.candidates.join(", ")}`);
  }

  // diagnostics
  if (debug) {
    diagnostics.itemsRaw = rawResults;
    diagnostics.merged = merged;
    diagnostics.tokens = tokens;
    diagnostics.extrasGlobal = extrasGlobal;
  }

  return {
    items,
    warnings,
    extrasDetected: extrasGlobal,
    diagnostics: debug ? diagnostics : undefined
  };
}

/* -------------------- Helpers -------------------- */

function roundTo(value, step = 0.01) {
  const factor = 1 / step;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/* -------------------- Exports -------------------- */

export default parseOrderText;

/* -------------------- Ejemplos rápidos (para pruebas locales)
   Copia y pega en un REPL o Node para probar:
   const parse = require('./lib/parse-order').default;
   const menu = require('./data/menu.json');
   console.log(parse('2 alitas picantes y 1 pizza mediana pepperoni', menu, { debug: true }));
------------------------------------------------------------------ */
