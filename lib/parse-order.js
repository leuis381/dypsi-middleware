/**
 * parse-order.js
 *
 * Robust order text parser for DYPSI middleware.
 * - Detecta ítems, cantidades (números y palabras), variantes/tamaños (pequeña/mediana/familiar/personal),
 *   extras (con/sin), y mapea contra el catálogo local/WhatsApp.
 * - Soporta sinónimos (pasar un objeto sinonimos: { product_id: [aliases...] }).
 * - Devuelve estructura consistente para downstream: [{ id, name, quantity, variant, extras, priceHint, rawMatch }]
 *
 * Requisitos:
 * - Este módulo no depende de librerías externas (apto para Vercel).
 * - parseOrderText(text, products, options)
 *    - text: string con el pedido (puede venir de OCR o mensaje)
 *    - products: array de productos (cada producto puede tener: id, name, precio/price, variantes)
 *    - options (opcional): { synonyms: object, language: "es"|"en", allowFuzzy: boolean }
 *
 * Notas:
 * - El parser intenta ser conservador: si no encuentra precio en catálogo, deja priceHint = null.
 * - Para ambigüedades devuelve posiblesMatches en rawMatch; la capa superior puede preguntar al cliente.
 */

const NUMBER_WORDS = {
  // Español
  "cero": 0, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
  "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
  // Inglés
  "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
};

const SIZE_KEYWORDS = {
  // normalized -> canonical variant key
  "pequeña": "pequena", "pequena": "pequena", "personal": "personal", "mediana": "mediana", "familiar": "familiar",
  "small": "pequena", "medium": "mediana", "large": "familiar", "personal": "personal"
};

const EXTRA_PATTERNS = [
  // patterns to capture extras or modifiers
  /\bcon\s+([a-záéíóúñ0-9\s]+?)(?:,|\.|y\b|$)/gi,
  /\bsin\s+([a-záéíóúñ0-9\s]+?)(?:,|\.|y\b|$)/gi,
  /\bagregue\s+([a-záéíóúñ0-9\s]+?)(?:,|\.|y\b|$)/gi
];

function normalize(s) {
  if (!s) return "";
  return s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^\w\s-]/g, " ") // remove punctuation except dash
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function parseNumberToken(token) {
  if (!token) return null;
  const n = Number(token.replace(/[^\d]/g, ""));
  if (Number.isFinite(n) && String(n).length > 0) return n;
  const w = token.toLowerCase();
  if (NUMBER_WORDS[w] != null) return NUMBER_WORDS[w];
  return null;
}

/**
 * Simple token overlap score between query tokens and product name tokens.
 * Returns score between 0 and 1.
 */
function tokenOverlapScore(queryTokens, nameTokens) {
  if (!queryTokens.length || !nameTokens.length) return 0;
  const qSet = new Set(queryTokens);
  const nSet = new Set(nameTokens);
  let common = 0;
  for (const t of qSet) if (nSet.has(t)) common++;
  return common / Math.max(qSet.size, nSet.size);
}

/**
 * Try to extract quantity near a product mention.
 * - Busca patrones: "2 pizza", "dos pizzas", "pizza x2", "2x pizza", "2x pizza mediana"
 */
function extractQuantityAround(text, indexStart, indexEnd) {
  // text normalized
  const windowSize = 40; // chars before/after
  const start = Math.max(0, indexStart - windowSize);
  const end = Math.min(text.length, indexEnd + windowSize);
  const snippet = text.slice(start, end);
  // patterns
  const patterns = [
    /(\d+)\s*[xX]?\s*(?:de\s+)?\b[^\d\s]{0,30}\b/, // "2 pizza" or "2x pizza"
    /(?:\b)(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five)\b/i,
    /\b[xX]\s*(\d+)\b/, // "pizza x2"
    /(\d+)\s*(?:unidades|und|uds|piezas|pz|pz\.)/i
  ];
  for (const pat of patterns) {
    const m = snippet.match(pat);
    if (m) {
      for (let i = 1; i < m.length; i++) {
        const q = parseNumberToken(m[i]);
        if (q != null) return q;
      }
      // if matched a word number
      const wordMatch = snippet.match(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five)\b/i);
      if (wordMatch) {
        const q = parseNumberToken(wordMatch[1]);
        if (q != null) return q;
      }
    }
  }
  return null;
}

/**
 * Detect variant (size) near product mention.
 */
function extractVariantAround(text, indexStart, indexEnd) {
  const start = Math.max(0, indexStart - 40);
  const end = Math.min(text.length, indexEnd + 40);
  const snippet = normalize(text.slice(start, end));
  for (const k of Object.keys(SIZE_KEYWORDS)) {
    if (snippet.includes(k)) return SIZE_KEYWORDS[k];
  }
  return null;
}

/**
 * Extract extras (con/sin) from the whole text.
 * Returns array of strings like "con queso", "sin cebolla"
 */
function extractExtras(text) {
  const extras = [];
  for (const pat of EXTRA_PATTERNS) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const raw = m[1] ? m[1].trim() : null;
      if (raw) {
        // limit length
        const cleaned = raw.split(/\b(?:y|,|\.)\b/)[0].trim();
        if (cleaned) extras.push(cleaned);
      }
    }
  }
  return extras;
}

/**
 * Main parser
 * - products: array of product objects. Each product may have: id, name, precio/price, variantes (object)
 * - options:
 *    - synonyms: { product_id: [alias1, alias2, ...] } OR { alias: product_id } (both supported)
 *    - language: "es" (default) or "en"
 *    - allowFuzzy: boolean (default true) - uses token overlap scoring
 */
export function parseOrderText(text = "", products = [], options = {}) {
  const lang = options.language || "es";
  const allowFuzzy = options.allowFuzzy !== false;
  const synonyms = options.synonyms || {};

  const raw = (text || "").toString();
  const normalized = normalize(raw);
  const tokens = tokenize(normalized);
  const extrasGlobal = extractExtras(raw);

  const results = [];
  const warnings = [];

  if (!normalized) return { items: [], warnings: ["No text provided"] };

  // Build synonyms reverse map: alias -> product_id
  const aliasToId = {};
  if (synonyms && typeof synonyms === "object") {
    for (const key of Object.keys(synonyms)) {
      const val = synonyms[key];
      if (Array.isArray(val)) {
        // key is product_id, val are aliases
        for (const a of val) aliasToId[normalize(a)] = key;
      } else if (typeof val === "string") {
        // key is alias, val is product_id
        aliasToId[normalize(key)] = val;
      }
    }
  }

  // Precompute product name tokens
  const catalog = (products || []).map((p) => {
    const name = (p.name || p.nombre || p.title || "").toString();
    return {
      id: p.id || p.product_id || name,
      name,
      normName: normalize(name),
      tokens: tokenize(name),
      price: p.precio ?? p.price ?? p.valor ?? null,
      variantes: p.variantes || p.variants || p.variations || null,
      raw: p
    };
  });

  // Strategy:
  // 1) Find direct alias matches (synonyms)
  // 2) Find exact name substring matches
  // 3) If allowFuzzy, compute token overlap score and pick matches above threshold
  // For each match, extract quantity and variant around the match position in original raw text.

  // 1) Synonym matches
  for (const aliasNorm of Object.keys(aliasToId)) {
    if (normalized.includes(aliasNorm)) {
      const productId = aliasToId[aliasNorm];
      const prod = catalog.find((c) => String(c.id) === String(productId));
      if (prod) {
        // find index of alias in raw text (use normalized positions)
        const idx = normalized.indexOf(aliasNorm);
        const qty = extractQuantityAround(raw, idx, idx + aliasNorm.length) || 1;
        const variant = extractVariantAround(raw, idx, idx + aliasNorm.length) || null;
        results.push({
          id: prod.id,
          name: prod.name,
          quantity: qty,
          variant,
          extras: extrasGlobal,
          priceHint: prod.price,
          rawMatch: { method: "synonym", alias: aliasNorm }
        });
      }
    }
  }

  // 2) Exact name substring matches
  for (const prod of catalog) {
    if (!prod.normName) continue;
    // Avoid duplicates if already matched by id
    const already = results.find((r) => String(r.id) === String(prod.id));
    if (already) continue;

    if (normalized.includes(prod.normName)) {
      const idx = normalized.indexOf(prod.normName);
      const qty = extractQuantityAround(raw, idx, idx + prod.normName.length) || 1;
      const variant = extractVariantAround(raw, idx, idx + prod.normName.length) || null;
      results.push({
        id: prod.id,
        name: prod.name,
        quantity: qty,
        variant,
        extras: extrasGlobal,
        priceHint: prod.price,
        rawMatch: { method: "exact_name", matched: prod.normName }
      });
    }
  }

  // 3) Fuzzy/token-overlap matching for remaining products
  if (allowFuzzy) {
    const unmatchedCatalog = catalog.filter((c) => !results.find((r) => String(r.id) === String(c.id)));
    // Build sliding windows of tokens from the input to try to match multi-word product names
    const joined = tokens.join(" ");
    for (const prod of unmatchedCatalog) {
      const score = tokenOverlapScore(tokens, prod.tokens);
      // threshold: require at least 0.5 overlap or at least one token exact match
      const hasExactToken = prod.tokens.some((t) => tokens.includes(t));
      if (score >= 0.5 || hasExactToken) {
        // find approximate index by searching for first token occurrence
        let idx = -1;
        for (const t of prod.tokens) {
          idx = normalized.indexOf(t);
          if (idx >= 0) break;
        }
        if (idx < 0) idx = 0;
        const qty = extractQuantityAround(raw, idx, idx + (prod.normName.length || 0)) || 1;
        const variant = extractVariantAround(raw, idx, idx + (prod.normName.length || 0)) || null;
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

  // 4) Post-process: merge duplicates (same id) summing quantities
  const merged = [];
  for (const it of results) {
    const existing = merged.find((m) => String(m.id) === String(it.id) && (m.variant || "") === (it.variant || ""));
    if (existing) {
      existing.quantity = (existing.quantity || 0) + (it.quantity || 0);
      existing.rawMatches = existing.rawMatches || [];
      existing.rawMatches.push(it.rawMatch);
    } else {
      merged.push({ ...it, rawMatches: [it.rawMatch] });
    }
  }

  // 5) If no items found, attempt a fallback: look for patterns like "1 pizza", "2 alitas"
  if (merged.length === 0) {
    // try to detect generic keywords: pizza, alitas, lasagna, burger, salchipapa
    const genericKeywords = ["pizza", "alitas", "lasagna", "lasaña", "burger", "hamburguesa", "salchipapa", "choripan", "choripapa"];
    for (const kw of genericKeywords) {
      if (normalized.includes(kw)) {
        const idx = normalized.indexOf(kw);
        const qty = extractQuantityAround(raw, idx, idx + kw.length) || 1;
        // try to find best catalog match that contains kw
        const candidate = catalog.find((c) => c.normName.includes(kw));
        if (candidate) {
          merged.push({
            id: candidate.id,
            name: candidate.name,
            quantity: qty,
            variant: extractVariantAround(raw, idx, idx + kw.length) || null,
            extras: extrasGlobal,
            priceHint: candidate.price,
            rawMatches: [{ method: "fallback_generic", keyword: kw }]
          });
        }
      }
    }
  }

  // 6) Build final items with safe defaults
  const items = merged.map((m) => ({
    id: m.id,
    name: m.name,
    quantity: Math.max(1, parseInt(m.quantity || 1, 10)),
    variant: m.variant || null,
    extras: Array.isArray(m.extras) ? m.extras : (m.extras ? [m.extras] : []),
    price: m.priceHint != null ? Number(m.priceHint) : null,
    rawMatches: m.rawMatches || []
  }));

  // 7) Warnings for ambiguous matches (low confidence fuzzy)
  for (const m of merged) {
    const rm = m.rawMatches?.[0];
    if (rm && rm.method === "fuzzy" && rm.score && rm.score < 0.6) {
      warnings.push(`Posible ambigüedad para "${m.name}" (score ${rm.score}).`);
    }
  }

  return { items, warnings, extrasDetected: extrasGlobal };
}

export default parseOrderText;
