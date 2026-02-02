/**
 * lib/smart-ocr.js
 * 
 * OCR Inteligente que clasifica imágenes y extrae información relevante
 * - Detecta si es comprobante, menú o producto
 * - Extrae información contextual
 * - Entiende diferentes formatos
 */

/**
 * Clasificación de Tipo de Imagen
 */
const IMAGE_TYPES = {
  RECEIPT: 'receipt',           // Comprobante de pago
  MENU: 'menu',                 // Menú o catálogo
  CATALOG_ITEM: 'catalog_item', // Item de catálogo WhatsApp
  PRODUCT: 'product',           // Foto de producto
  SCREENSHOT: 'screenshot',     // Captura de pantalla
  QR: 'qr',                     // Código QR
  UNKNOWN: 'unknown'
};

/**
 * Patrones para Detectar Tipo de Imagen
 */
function classifyImageType(ocrText = '', imageMetadata = {}) {
  if (!ocrText) return IMAGE_TYPES.UNKNOWN;

  const lower = ocrText.toLowerCase();
  let scores = {};

  // Receipt indicators
  if (/total|monto|pago|ruc|factura|boleta|comprobante|ticket/i.test(lower)) {
    scores[IMAGE_TYPES.RECEIPT] = (scores[IMAGE_TYPES.RECEIPT] || 0) + 2;
  }
  if (/fecha|hora|método de pago|efectivo|tarjeta|yape|plin/i.test(lower)) {
    scores[IMAGE_TYPES.RECEIPT] = (scores[IMAGE_TYPES.RECEIPT] || 0) + 1;
  }
  if (/\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(lower)) {
    scores[IMAGE_TYPES.RECEIPT] = (scores[IMAGE_TYPES.RECEIPT] || 0) + 1;
  }

  // Menu indicators
  if (/menú|carta|catálogo|categor|precio|disponib|especial|promo|combo/i.test(lower)) {
    scores[IMAGE_TYPES.MENU] = (scores[IMAGE_TYPES.MENU] || 0) + 2;
  }
  if (/(pizza|burger|ala|postre|bebida|entrada)/i.test(lower) && /\d+[\.,]\d{2}/.test(lower)) {
    scores[IMAGE_TYPES.MENU] = (scores[IMAGE_TYPES.MENU] || 0) + 1;
  }

  // Catalog item (WhatsApp)
  if (/descripción|tamaño|cantidad|disponible|agregar/i.test(lower)) {
    scores[IMAGE_TYPES.CATALOG_ITEM] = (scores[IMAGE_TYPES.CATALOG_ITEM] || 0) + 1;
  }

  // QR Code
  if (lower.includes('qr') || /^[A-Za-z0-9+/=]{100,}$/.test(lower)) {
    scores[IMAGE_TYPES.QR] = (scores[IMAGE_TYPES.QR] || 0) + 1;
  }

  // Encontrar tipo con mayor score
  const maxScore = Math.max(...Object.values(scores), 0);
  const detectedType = Object.entries(scores).find(([_, s]) => s === maxScore)?.[0] || IMAGE_TYPES.UNKNOWN;

  return {
    type: detectedType,
    confidence: maxScore / 3,
    scores,
    ocrText: lower.substring(0, 200) // Primeros 200 caracteres
  };
}

/**
 * Extracción de Datos de Comprobante
 */
function extractReceiptData(ocrText) {
  const data = {
    amounts: [],
    total: null,
    subtotal: null,
    tax: null,
    currency: 'PEN',
    paymentMethod: null,
    date: null,
    time: null,
    items: [],
    confidence: 0
  };

  if (!ocrText) return data;

  // Buscar montos (S/ 123.45 o 123,45)
  const amountPattern = /S\/\s*([\d.,]+)|(\d{1,3}(?:[.,]\d{2})?)\s*$/gm;
  const amounts = [];
  let match;
  while ((match = amountPattern.exec(ocrText)) !== null) {
    const amount = parseFloat((match[1] || match[2]).replace(',', '.'));
    if (amount > 0 && amount < 10000) amounts.push(amount);
  }

  // El total usualmente es el monto más grande
  if (amounts.length > 0) {
    data.amounts = amounts;
    data.total = Math.max(...amounts);
    data.confidence += 0.5;
  }

  // Buscar método de pago
  if (/yape|plin|transfer|banco|tarjeta|crédito|débito|efectivo/i.test(ocrText)) {
    data.paymentMethod = 'digital';
    data.confidence += 0.2;
  }

  // Buscar fecha
  const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
  const dateMatch = ocrText.match(datePattern);
  if (dateMatch) {
    data.date = dateMatch[1];
    data.confidence += 0.15;
  }

  // Buscar hora
  const timePattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:am|pm|a\.m\.|p\.m\.)?/i;
  const timeMatch = ocrText.match(timePattern);
  if (timeMatch) {
    data.time = timeMatch[1];
    data.confidence += 0.15;
  }

  // Extraer items (patrón: cantidad + nombre + precio)
  const itemPattern = /(\d+)\s+x?\s+([a-záéíóúñ\s]+)\s+(?:S\/\s*)?([\d.,]+)/gim;
  while ((match = itemPattern.exec(ocrText)) !== null) {
    data.items.push({
      quantity: parseInt(match[1]),
      name: match[2].trim(),
      price: parseFloat(match[3].replace(',', '.'))
    });
  }

  return data;
}

/**
 * Extracción de Datos de Menú
 */
function extractMenuData(ocrText) {
  const data = {
    categories: [],
    items: [],
    currency: 'PEN',
    confidence: 0
  };

  if (!ocrText) return data;

  // Detectar categorías
  const categoryPatterns = ['pizza', 'burger', 'entrada', 'bebida', 'postre', 'combo', 'promo', 'ensalada'];
  for (const pattern of categoryPatterns) {
    if (new RegExp(pattern, 'i').test(ocrText)) {
      data.categories.push(pattern);
    }
  }

  if (data.categories.length > 0) data.confidence += 0.3;

  // Extraer items con precios
  const itemPattern = /([a-záéíóúñ\s\-]+?)\s+(?:S\/\s*)?([\d.,]+)/gim;
  let match;
  const seenItems = new Set();

  while ((match = itemPattern.exec(ocrText)) !== null) {
    const name = match[1].trim();
    const price = parseFloat(match[2].replace(',', '.'));

    if (name.length > 3 && name.length < 100 && price > 0 && price < 500 && !seenItems.has(name)) {
      data.items.push({ name, price });
      seenItems.add(name);
    }
  }

  if (data.items.length > 0) data.confidence += 0.4;

  return data;
}

/**
 * Extracción de Item de Catálogo WhatsApp
 */
function extractCatalogItemData(ocrText) {
  const data = {
    productId: null,
    name: null,
    description: null,
    price: null,
    sizes: [],
    available: true,
    confidence: 0
  };

  if (!ocrText) return data;

  // Buscar nombre (usualmente la primera línea prominente)
  const namePattern = /^([A-Za-záéíóúñ\s]+)/m;
  const nameMatch = ocrText.match(namePattern);
  if (nameMatch) {
    data.name = nameMatch[1].trim();
    data.confidence += 0.2;
  }

  // Buscar precio
  const pricePattern = /S\/\s*([\d.,]+)|precio[:\s]+([\d.,]+)/i;
  const priceMatch = ocrText.match(pricePattern);
  if (priceMatch) {
    data.price = parseFloat((priceMatch[1] || priceMatch[2]).replace(',', '.'));
    data.confidence += 0.3;
  }

  // Buscar tamaños
  const sizePattern = /(pequeña|mediana|grande|personal|familiar|pequeño|mediano)/gi;
  const sizeMatches = ocrText.match(sizePattern);
  if (sizeMatches) {
    data.sizes = [...new Set(sizeMatches.map(s => s.toLowerCase()))];
    data.confidence += 0.2;
  }

  // Detectar disponibilidad
  if (/no dispon|agotado|sin stock|no hay/i.test(ocrText)) {
    data.available = false;
  }

  return data;
}

/**
 * Análisis Inteligente de Imagen (Wrapper)
 */
async function smartOCRAnalysis(ocrResult, imageMetadata = {}) {
  const classification = classifyImageType(ocrResult, imageMetadata);

  let extractedData = {};

  switch (classification.type) {
    case IMAGE_TYPES.RECEIPT:
      extractedData = extractReceiptData(ocrResult);
      break;
    case IMAGE_TYPES.MENU:
      extractedData = extractMenuData(ocrResult);
      break;
    case IMAGE_TYPES.CATALOG_ITEM:
      extractedData = extractCatalogItemData(ocrResult);
      break;
    default:
      // Intentar extraer todo
      extractedData = {
        receipt: extractReceiptData(ocrResult),
        menu: extractMenuData(ocrResult),
        catalogItem: extractCatalogItemData(ocrResult)
      };
  }

  return {
    classification,
    extractedData,
    timestamp: Date.now(),
    metadata: imageMetadata
  };
}

/**
 * Validación de Monto OCR
 */
function validateOCRAmount(detectedAmount, expectedTotal, tolerance = 0.06) {
  if (!detectedAmount || !expectedTotal) return false;

  const diff = Math.abs(detectedAmount - expectedTotal);
  const tolerance_amount = expectedTotal * tolerance;

  return diff <= tolerance_amount;
}

/**
 * Confianza Global del OCR
 */
function calculateOCRConfidence(analysis) {
  let confidence = 0;

  const { classification, extractedData } = analysis;

  // Confianza por clasificación
  confidence += classification.confidence * 0.3;

  // Confianza por datos extraídos
  if (extractedData.total) confidence += 0.3;
  if (extractedData.date || extractedData.paymentMethod) confidence += 0.2;
  if (extractedData.items?.length > 0) confidence += 0.2;

  return Math.min(confidence, 1);
}

export default {
  IMAGE_TYPES,
  classifyImageType,
  extractReceiptData,
  extractMenuData,
  extractCatalogItemData,
  smartOCRAnalysis,
  validateOCRAmount,
  calculateOCRConfidence
};
