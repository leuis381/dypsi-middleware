/**
 * lib/smart-ocr.js
 * 
 * OCR Inteligente con Clasificación y Extracción de Datos
 * - Detecta si es comprobante, menú, producto o catálogo
 * - Extrae información contextual detallada
 * - Entiende diferentes formatos (S/, montos, fechas, etc)
 * - Validación exhaustiva de datos extraídos
 * - Logging centralizado y métricas
 * - Manejo robusto de errores
 */

import { logger, ValidationError, AppError, MetricsCollector } from './utils.js';

/** Instancia de métricas */
const metrics = new MetricsCollector();

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
 * Clasificar tipo de imagen basado en contenido OCR
 * 
 * @param {string} ocrText - Texto extraído por OCR
 * @param {Object} imageMetadata - Metadata de imagen { width, height, format, size }
 * @returns {Object} { type, confidence, scores, details }
 * @throws {ValidationError} Si los inputs no son válidos
 */
function classifyImageType(ocrText = '', imageMetadata = {}) {
  // Validar inputs
  if (typeof ocrText !== 'string') {
    throw new ValidationError('INVALID_OCR_TEXT', 'ocrText debe ser una cadena');
  }
  if (imageMetadata && typeof imageMetadata !== 'object') {
    throw new ValidationError('INVALID_METADATA', 'imageMetadata debe ser un objeto');
  }

  if (!ocrText.trim()) {
    logger.warn('EMPTY_OCR_TEXT', { metadata: imageMetadata });
    return { 
      type: IMAGE_TYPES.UNKNOWN, 
      confidence: 0, 
      scores: {},
      details: { empty: true }
    };
  }

  const lower = ocrText.toLowerCase().trim();
  let scores = {};

  try {
    // Receipt indicators - Documentos de pago
    if (/total|monto|pago|ruc|factura|boleta|comprobante|ticket|recibo/i.test(lower)) {
      scores[IMAGE_TYPES.RECEIPT] = (scores[IMAGE_TYPES.RECEIPT] || 0) + 2;
    }
    if (/fecha|hora|método de pago|efectivo|tarjeta|yape|plin|transferencia/i.test(lower)) {
      scores[IMAGE_TYPES.RECEIPT] = (scores[IMAGE_TYPES.RECEIPT] || 0) + 1;
    }
    if (/\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{2}:\d{2}:\d{2}/.test(lower)) {
      scores[IMAGE_TYPES.RECEIPT] = (scores[IMAGE_TYPES.RECEIPT] || 0) + 1;
    }
    if (/subtotal|descuento|impuesto|igv|total a pagar/i.test(lower)) {
      scores[IMAGE_TYPES.RECEIPT] = (scores[IMAGE_TYPES.RECEIPT] || 0) + 0.5;
    }

    // Menu indicators - Menús y cartas
    if (/menú|carta|catálogo|categor|precio|disponib|especial|promo|combo/i.test(lower)) {
      scores[IMAGE_TYPES.MENU] = (scores[IMAGE_TYPES.MENU] || 0) + 2;
    }
    if (/(pizza|burger|ala|postre|bebida|entrada|sándwich|pasta)/i.test(lower) && /\d+[\.,]\d{2}/.test(lower)) {
      scores[IMAGE_TYPES.MENU] = (scores[IMAGE_TYPES.MENU] || 0) + 1;
    }
    if (/pequeña|mediana|grande|personal|familiar|tamaño/i.test(lower)) {
      scores[IMAGE_TYPES.MENU] = (scores[IMAGE_TYPES.MENU] || 0) + 0.5;
    }

    // Catalog item (WhatsApp) - Items de catálogo
    if (/descripción|tamaño|cantidad|disponible|agregar|carrito|comprar|producto/i.test(lower)) {
      scores[IMAGE_TYPES.CATALOG_ITEM] = (scores[IMAGE_TYPES.CATALOG_ITEM] || 0) + 1;
    }
    if (/whatsapp|wa\.me|https:\/\/wa\./i.test(lower)) {
      scores[IMAGE_TYPES.CATALOG_ITEM] = (scores[IMAGE_TYPES.CATALOG_ITEM] || 0) + 1;
    }

    // Product photo - Foto de producto
    if (/foto|imagen|producto|presentación|embalaje|caja|empaque/i.test(lower)) {
      scores[IMAGE_TYPES.PRODUCT] = (scores[IMAGE_TYPES.PRODUCT] || 0) + 0.5;
    }

    // QR Code
    if (/qr|código qr|escanear|scanner/i.test(lower) || /^[A-Za-z0-9+/=]{100,}$/.test(lower)) {
      scores[IMAGE_TYPES.QR] = (scores[IMAGE_TYPES.QR] || 0) + 1;
    }

    // Screenshot - Captura de pantalla
    if (/screenshot|conversación|chat|mensaje|whatsapp|telegram|facebook/i.test(lower)) {
      scores[IMAGE_TYPES.SCREENSHOT] = (scores[IMAGE_TYPES.SCREENSHOT] || 0) + 1;
    }

    // Encontrar tipo con mayor score
    const maxScore = Math.max(...Object.values(scores), 0);
    const sortedScores = Object.entries(scores).sort(([, a], [, b]) => b - a);
    const detectedType = sortedScores.length > 0 ? sortedScores[0][0] : IMAGE_TYPES.UNKNOWN;
    
    const confidence = maxScore > 0 ? Math.min(maxScore / 3, 1) : 0;

    const result = {
      type: detectedType,
      confidence: Number(confidence.toFixed(3)),
      scores: scores,
      details: {
        ocrLength: lower.length,
        topAlternatives: sortedScores.slice(0, 3),
        imageMetadata: imageMetadata
      }
    };

    logger.debug('IMAGE_CLASSIFIED', { 
      type: result.type, 
      confidence: result.confidence,
      ocrLength: lower.length 
    });

    metrics.recordMetric('image_classified', { type: result.type });

    return result;
  } catch (error) {
    logger.error('CLASSIFICATION_ERROR', { error: error.message });
    throw new AppError('CLASSIFICATION_ERROR', 'Error clasificando imagen', { cause: error });
  }
}

/**
 * Extracción de Datos de Comprobante
 * Extrae montos, total, fecha, método de pago, items
 * 
 * @param {string} ocrText - Texto OCR del comprobante
 * @returns {Object} { amounts, total, subtotal, tax, currency, paymentMethod, date, time, items, confidence }
 * @throws {ValidationError} Si el input no es válido
 */
function extractReceiptData(ocrText) {
  // Validar input
  if (typeof ocrText !== 'string') {
    throw new ValidationError('INVALID_TEXT', 'ocrText debe ser una cadena');
  }

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
    confidence: 0,
    ruc: null,
    buyerName: null
  };

  if (!ocrText.trim()) {
    logger.warn('EMPTY_RECEIPT_TEXT');
    return data;
  }

  try {
    // Buscar montos (S/ 123.45 o 123,45)
    const amountPattern = /S\/\s*([\d.,]+)|(\d{1,3}(?:[.,]\d{2})?)\s*(?:PEN|soles)?/gm;
    const amounts = [];
    let match;

    while ((match = amountPattern.exec(ocrText)) !== null) {
      const amountStr = (match[1] || match[2]).replace(',', '.');
      const amount = parseFloat(amountStr);
      
      if (amount > 0 && amount < 100000) {
        amounts.push(amount);
      }
    }

    // El total usualmente es el monto más grande
    if (amounts.length > 0) {
      data.amounts = [...new Set(amounts)].sort((a, b) => a - b);
      data.total = Math.max(...amounts);
      data.confidence += 0.4;
      logger.debug('AMOUNTS_EXTRACTED', { count: amounts.length, total: data.total });
    }

    // Buscar subtotal
    const subtotalMatch = ocrText.match(/subtotal[:\s]+([\d.,]+)/i);
    if (subtotalMatch) {
      data.subtotal = parseFloat(subtotalMatch[1].replace(',', '.'));
      data.confidence += 0.1;
    }

    // Buscar impuesto
    const taxMatch = ocrText.match(/(?:igv|impuesto)[:\s]+([\d.,]+)/i);
    if (taxMatch) {
      data.tax = parseFloat(taxMatch[1].replace(',', '.'));
      data.confidence += 0.1;
    }

    // Buscar método de pago
    const paymentMethods = {
      yape: 'yape',
      plin: 'plin',
      transfer: 'transferencia',
      banco: 'transferencia',
      tarjeta: 'tarjeta',
      crédito: 'tarjeta_credito',
      débito: 'tarjeta_debito',
      efectivo: 'efectivo'
    };

    for (const [pattern, method] of Object.entries(paymentMethods)) {
      if (new RegExp(pattern, 'i').test(ocrText)) {
        data.paymentMethod = method;
        data.confidence += 0.15;
        break;
      }
    }

    // Buscar fecha (DD/MM/YYYY, DD-MM-YYYY, etc)
    const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
    const dateMatch = ocrText.match(datePattern);
    if (dateMatch) {
      data.date = dateMatch[1];
      data.confidence += 0.15;
    }

    // Buscar hora (HH:MM, HH:MM:SS)
    const timePattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:am|pm|a\.m\.|p\.m\.)?/i;
    const timeMatch = ocrText.match(timePattern);
    if (timeMatch) {
      data.time = timeMatch[1];
      data.confidence += 0.1;
    }

    // Buscar RUC
    const rucMatch = ocrText.match(/RUC[:\s]+(\d{11})/i);
    if (rucMatch) {
      data.ruc = rucMatch[1];
      data.confidence += 0.05;
    }

    // Buscar nombre del comprador
    const buyerMatch = ocrText.match(/(?:cliente|sr\.|sra\.)[:\s]+([a-záéíóúñ\s]+)/i);
    if (buyerMatch) {
      data.buyerName = buyerMatch[1].trim();
      data.confidence += 0.05;
    }

    // Extraer items (patrón: cantidad + nombre + precio)
    const itemPattern = /(\d+)\s+x?\s+([a-záéíóúñ\s\-().]+?)\s+(?:S\/\s*)?([\d.,]+)/gim;
    const seenItems = new Set();

    while ((match = itemPattern.exec(ocrText)) !== null) {
      const qty = parseInt(match[1], 10);
      const name = match[2].trim();
      const price = parseFloat(match[3].replace(',', '.'));

      if (name.length > 2 && name.length < 200 && price > 0 && price < 10000 && !seenItems.has(name)) {
        data.items.push({ quantity: qty, name, price });
        seenItems.add(name);
      }
    }

    if (data.items.length > 0) {
      data.confidence += 0.2;
      logger.debug('RECEIPT_ITEMS_EXTRACTED', { count: data.items.length });
    }

    data.confidence = Math.min(data.confidence, 1);

    logger.info('RECEIPT_DATA_EXTRACTED', { 
      total: data.total,
      itemsCount: data.items.length,
      confidence: data.confidence 
    });

    return data;
  } catch (error) {
    logger.error('RECEIPT_EXTRACTION_ERROR', { error: error.message });
    throw new AppError('EXTRACTION_ERROR', 'Error extrayendo datos de comprobante', { cause: error });
  }
}

/**
 * Extracción de Datos de Menú
 * Extrae categorías e items con precios
 * 
 * @param {string} ocrText - Texto OCR del menú
 * @returns {Object} { categories, items, currency, confidence, itemsByCategory }
 */
function extractMenuData(ocrText) {
  // Validar input
  if (typeof ocrText !== 'string') {
    throw new ValidationError('INVALID_TEXT', 'ocrText debe ser una cadena');
  }

  const data = {
    categories: [],
    items: [],
    currency: 'PEN',
    confidence: 0,
    itemsByCategory: {}
  };

  if (!ocrText.trim()) {
    logger.warn('EMPTY_MENU_TEXT');
    return data;
  }

  try {
    // Detectar categorías
    const categoryPatterns = {
      pizzas: /pizza/i,
      burgers: /burger|hamburguesa/i,
      alitas: /ala|wings|aleta/i,
      entradas: /entrada|aperitivo|starter/i,
      bebidas: /bebida|refresco|jugo|agua|gaseosa/i,
      postres: /postre|dulce|helado|brownie|flan/i,
      combos: /combo|promoción|oferta/i,
      ensaladas: /ensalada|salad/i,
      pastas: /pasta|tallarín|fettuccini/i
    };

    for (const [category, pattern] of Object.entries(categoryPatterns)) {
      if (pattern.test(ocrText)) {
        data.categories.push(category);
        data.itemsByCategory[category] = [];
      }
    }

    if (data.categories.length > 0) data.confidence += 0.3;

    // Extraer items con precios
    const itemPattern = /([a-záéíóúñ\s\-(),.]+?)\s+(?:S\/\s*)?([\d.,]+)(?:\s+soles)?/gim;
    const seenItems = new Set();

    let match;
    while ((match = itemPattern.exec(ocrText)) !== null) {
      const name = match[1].trim();
      const priceStr = match[2].replace(',', '.');
      const price = parseFloat(priceStr);

      if (name.length > 3 && name.length < 150 && price > 0 && price < 1000 && !seenItems.has(name)) {
        data.items.push({ name, price });
        seenItems.add(name);

        // Clasificar en categoría si la encontramos
        for (const [category, pattern] of Object.entries(categoryPatterns)) {
          if (pattern.test(name)) {
            data.itemsByCategory[category].push({ name, price });
            break;
          }
        }
      }
    }

    if (data.items.length > 0) {
      data.confidence += 0.4;
      logger.debug('MENU_ITEMS_EXTRACTED', { count: data.items.length });
    }

    data.confidence = Math.min(data.confidence, 1);

    logger.info('MENU_DATA_EXTRACTED', { 
      itemsCount: data.items.length,
      categoriesCount: data.categories.length,
      confidence: data.confidence 
    });

    return data;
  } catch (error) {
    logger.error('MENU_EXTRACTION_ERROR', { error: error.message });
    throw new AppError('EXTRACTION_ERROR', 'Error extrayendo datos de menú', { cause: error });
  }
}

/**
 * Extracción de Item de Catálogo WhatsApp
 * Extrae información de un producto individual
 * 
 * @param {string} ocrText - Texto OCR del item
 * @returns {Object} { productId, name, description, price, sizes, available, confidence }
 */
function extractCatalogItemData(ocrText) {
  // Validar input
  if (typeof ocrText !== 'string') {
    throw new ValidationError('INVALID_TEXT', 'ocrText debe ser una cadena');
  }

  const data = {
    productId: null,
    name: null,
    description: null,
    price: null,
    sizes: [],
    available: true,
    confidence: 0,
    images: 0,
    sku: null
  };

  if (!ocrText.trim()) {
    logger.warn('EMPTY_CATALOG_TEXT');
    return data;
  }

  try {
    // Buscar nombre (usualmente la primera línea prominente)
    const namePattern = /^([A-Za-záéíóúñ\s\-()]+)/m;
    const nameMatch = ocrText.match(namePattern);
    if (nameMatch) {
      data.name = nameMatch[1].trim();
      if (data.name.length > 2 && data.name.length < 150) {
        data.confidence += 0.25;
      }
    }

    // Buscar descripción (generalmente después del nombre)
    const descPattern = /(?:descripción|desc|description)[:\s]+(.{10,300}?)(?:precio|tamaño|talla|size|S\/|$)/i;
    const descMatch = ocrText.match(descPattern);
    if (descMatch) {
      data.description = descMatch[1].trim();
      data.confidence += 0.15;
    }

    // Buscar precio
    const pricePattern = /(?:precio|price)[:\s]*S\/\s*([\d.,]+)|S\/\s*([\d.,]+)|(\d+[\.,]\d{2})\s*(?:soles|PEN)/i;
    const priceMatch = ocrText.match(pricePattern);
    if (priceMatch) {
      const priceStr = (priceMatch[1] || priceMatch[2] || priceMatch[3]).replace(',', '.');
      data.price = parseFloat(priceStr);
      if (data.price > 0 && data.price < 10000) {
        data.confidence += 0.3;
        logger.debug('PRICE_EXTRACTED', { price: data.price });
      }
    }

    // Buscar tamaños/tallas
    const sizePattern = /(pequeña|pequeño|mediana|mediano|grande|personal|familiar|individual|xs|s|m|l|xl|xxl)/gi;
    const sizeMatches = ocrText.match(sizePattern);
    if (sizeMatches) {
      data.sizes = [...new Set(sizeMatches.map(s => s.toLowerCase()))];
      data.confidence += 0.15;
    }

    // Detectar disponibilidad
    if (/no dispon|agotado|sin stock|no hay|out of stock|no disponible/i.test(ocrText)) {
      data.available = false;
      data.confidence += 0.1;
    } else if (/disponib|en stock|disponible/i.test(ocrText)) {
      data.available = true;
      data.confidence += 0.05;
    }

    // Buscar SKU o código de producto
    const skuMatch = ocrText.match(/(?:sku|código|code)[:\s]+([A-Z0-9\-]+)/i);
    if (skuMatch) {
      data.sku = skuMatch[1];
      data.confidence += 0.1;
    }

    // Contar imágenes (si menciona)
    const imgMatch = ocrText.match(/(\d+)\s*(?:imágenes|fotos|photos|images)/i);
    if (imgMatch) {
      data.images = parseInt(imgMatch[1], 10);
    }

    data.confidence = Math.min(data.confidence, 1);

    logger.info('CATALOG_ITEM_EXTRACTED', { 
      name: data.name?.substring(0, 30),
      price: data.price,
      confidence: data.confidence 
    });

    return data;
  } catch (error) {
    logger.error('CATALOG_EXTRACTION_ERROR', { error: error.message });
    throw new AppError('EXTRACTION_ERROR', 'Error extrayendo datos de catálogo', { cause: error });
  }
}

/**
 * Análisis Inteligente de Imagen (Wrapper)
 * Ejecuta clasificación y extracción basada en tipo detectado
 * 
 * @param {string} ocrResult - Resultado OCR
 * @param {Object} imageMetadata - Metadata de imagen
 * @returns {Promise<Object>} { classification, extractedData, timestamp, metadata, confidence }
 */
async function smartOCRAnalysis(ocrResult, imageMetadata = {}) {
  // Validar inputs
  if (typeof ocrResult !== 'string') {
    throw new ValidationError('INVALID_OCR', 'ocrResult debe ser una cadena');
  }
  if (imageMetadata && typeof imageMetadata !== 'object') {
    throw new ValidationError('INVALID_METADATA', 'imageMetadata debe ser un objeto');
  }

  try {
    logger.info('SMART_OCR_ANALYSIS_START', { ocrLength: ocrResult.length });

    const classification = classifyImageType(ocrResult, imageMetadata);

    let extractedData = {};

    // Ejecutar extracción específica basada en tipo
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
      case IMAGE_TYPES.PRODUCT:
        extractedData = extractCatalogItemData(ocrResult); // Similar a catalog item
        break;
      default:
        // Intentar extraer todo para análisis completo
        extractedData = {
          receipt: extractReceiptData(ocrResult),
          menu: extractMenuData(ocrResult),
          catalogItem: extractCatalogItemData(ocrResult)
        };
    }

    // Calcular confianza global
    const globalConfidence = calculateOCRConfidence({
      classification,
      extractedData
    });

    const result = {
      classification,
      extractedData,
      timestamp: Date.now(),
      metadata: imageMetadata,
      confidence: globalConfidence
    };

    logger.info('SMART_OCR_ANALYSIS_COMPLETE', { 
      type: classification.type,
      confidence: globalConfidence,
      extractionTime: result.timestamp - imageMetadata.captureTime || 0
    });

    metrics.recordMetric('ocr_analysis_complete', { type: classification.type });

    return result;
  } catch (error) {
    logger.error('SMART_OCR_ANALYSIS_ERROR', { error: error.message });
    throw new AppError('ANALYSIS_ERROR', 'Error en análisis OCR inteligente', { cause: error });
  }
}

/**
 * Validación de Monto OCR
 * Verifica si un monto detectado coincide con total esperado
 * 
 * @param {number} detectedAmount - Monto detectado
 * @param {number} expectedTotal - Total esperado
 * @param {number} tolerance - Tolerancia como decimal (default 0.06 = 6%)
 * @returns {boolean} ¿Es válido el monto?
 */
function validateOCRAmount(detectedAmount, expectedTotal, tolerance = 0.06) {
  // Validar inputs
  if (typeof detectedAmount !== 'number' || typeof expectedTotal !== 'number') {
    logger.warn('INVALID_AMOUNT_VALIDATION', { 
      detected: typeof detectedAmount, 
      expected: typeof expectedTotal 
    });
    return false;
  }

  if (detectedAmount <= 0 || expectedTotal <= 0) {
    return false;
  }

  const diff = Math.abs(detectedAmount - expectedTotal);
  const tolerance_amount = expectedTotal * Math.max(0, Math.min(tolerance, 0.5)); // Clamp entre 0 y 50%

  const isValid = diff <= tolerance_amount;

  logger.debug('AMOUNT_VALIDATED', { 
    detected: detectedAmount,
    expected: expectedTotal,
    diff: Number(diff.toFixed(2)),
    tolerance_amount: Number(tolerance_amount.toFixed(2)),
    isValid 
  });

  return isValid;
}

/**
 * Confianza Global del OCR
 * Calcula la confianza combinada de análisis
 * 
 * @param {Object} analysis - Resultado de análisis { classification, extractedData }
 * @returns {number} Confianza entre 0 y 1
 */
function calculateOCRConfidence(analysis) {
  // Validar input
  if (!analysis || typeof analysis !== 'object') {
    logger.warn('INVALID_ANALYSIS_INPUT');
    return 0;
  }

  let confidence = 0;

  try {
    const { classification, extractedData } = analysis;

    if (!classification || !extractedData) return 0;

    // Confianza por clasificación (30%)
    confidence += (classification.confidence || 0) * 0.3;

    // Confianza por datos extraídos - varía según tipo
    if (classification.type === IMAGE_TYPES.RECEIPT && extractedData) {
      if (extractedData.total) confidence += 0.25;
      if (extractedData.date || extractedData.paymentMethod) confidence += 0.2;
      if (extractedData.items?.length > 0) confidence += 0.25;
    } else if (classification.type === IMAGE_TYPES.MENU && extractedData) {
      if (extractedData.items?.length > 0) confidence += 0.35;
      if (extractedData.categories?.length > 0) confidence += 0.15;
      if (extractedData.itemsByCategory && Object.keys(extractedData.itemsByCategory).length > 0) confidence += 0.2;
    } else if (classification.type === IMAGE_TYPES.CATALOG_ITEM && extractedData) {
      if (extractedData.name) confidence += 0.25;
      if (extractedData.price) confidence += 0.3;
      if (extractedData.description) confidence += 0.15;
      if (extractedData.sizes?.length > 0) confidence += 0.15;
    }

    confidence = Math.min(confidence, 1);

    return Number(confidence.toFixed(3));
  } catch (error) {
    logger.error('CONFIDENCE_CALCULATION_ERROR', { error: error.message });
    return 0;
  }
}

/**
 * Exports - Smart OCR Engine
 */

/**
 * Exports - Smart OCR Engine
 * 
 * Uso:
 * import smartOCR from './smart-ocr.js';
 * const result = await smartOCR.smartOCRAnalysis(ocrText, metadata);
 * const confidence = smartOCR.calculateOCRConfidence(result);
 */
export default {
  // Constants
  IMAGE_TYPES,
  
  // Classification
  classifyImageType,
  
  // Data Extraction
  extractReceiptData,
  extractMenuData,
  extractCatalogItemData,
  
  // Analysis
  smartOCRAnalysis,
  
  // Validation & Confidence
  validateOCRAmount,
  calculateOCRConfidence,
  
  // Metrics
  getMetrics: () => metrics.getMetrics(),
  resetMetrics: () => metrics.reset()
};

// Logging de inicio
logger.info('SMART_OCR_ENGINE_LOADED', { 
  imageTypesCount: Object.keys(IMAGE_TYPES).length,
  version: '2.0.0'
});
