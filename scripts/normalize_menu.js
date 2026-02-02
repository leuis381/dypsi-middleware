#!/usr/bin/env node

/**
 * Fix menu.json to pass all schema validations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const menuPath = path.join(__dirname, '..', 'data', 'menu.json');
const data = JSON.parse(fs.readFileSync(menuPath, 'utf8'));

// Function to normalize a product
function normalizeProduct(product, categoryId) {
  const normalized = { ...product };
  
  // Ensure precio is present and correct format
  if (normalized.variantes && typeof normalized.variantes === 'object' && !Array.isArray(normalized.variantes)) {
    // Has variants - if precio is missing, use first variant price
    if (!normalized.precio) {
      const firstVariantPrice = Object.values(normalized.variantes)[0];
      normalized.precio = typeof firstVariantPrice === 'number' ? parseFloat(firstVariantPrice.toFixed(2)) : 0;
    } else {
      normalized.precio = parseFloat(normalized.precio.toFixed(2));
    }
  } else {
    // No variants - ensure precio exists and is formatted
    if (typeof normalized.precio === 'number') {
      normalized.precio = parseFloat(normalized.precio.toFixed(2));
    } else if (typeof normalized.precio === 'string') {
      normalized.precio = parseFloat(parseFloat(normalized.precio).toFixed(2));
    } else if (!normalized.precio) {
      console.warn('Warning: Missing precio for product', normalized.id, 'in category', categoryId);
      normalized.precio = 0;
    }
  }
  
  // Ensure variantes is present
  if (normalized.variantes === undefined) {
    normalized.variantes = null;
  }
  
  // Fix variantes - ensure proper format
  if (normalized.variantes && typeof normalized.variantes === 'object' && !Array.isArray(normalized.variantes)) {
    const fixedVariantes = {};
    Object.keys(normalized.variantes).forEach(key => {
      const price = normalized.variantes[key];
      fixedVariantes[key] = typeof price === 'number' ? parseFloat(price.toFixed(2)) : price;
    });
    normalized.variantes = fixedVariantes;
  }
  
  // Ensure modificadores is present and is array
  if (normalized.modificadores === undefined || normalized.modificadores === null) {
    normalized.modificadores = [];
  }
  
  // Fix modifier IDs to match pattern
  if (Array.isArray(normalized.modificadores)) {
    normalized.modificadores = normalized.modificadores.map(mod => {
      const fixedMod = { ...mod };
      if (fixedMod.id) {
        fixedMod.id = fixedMod.id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      }
      if (typeof fixedMod.precio === 'number') {
        fixedMod.precio = parseFloat(fixedMod.precio.toFixed(2));
      }
      return fixedMod;
    });
  }
  
  // Ensure imagenes is array
  if (normalized.imagenes === undefined || normalized.imagenes === null) {
    normalized.imagenes = [];
  }
  
  // Ensure calorias_kcal is present
  if (normalized.calorias_kcal === undefined) {
    if (normalized.variantes && typeof normalized.variantes === 'object' && !Array.isArray(normalized.variantes)) {
      // Use object with default values
      normalized.calorias_kcal = {};
      Object.keys(normalized.variantes).forEach(key => {
        normalized.calorias_kcal[key] = 0;
      });
    } else {
      normalized.calorias_kcal = 0;
    }
  }
  
  // Ensure stock is integer >= 0
  if (typeof normalized.stock === 'number') {
    normalized.stock = Math.max(0, Math.floor(normalized.stock));
  } else if (normalized.stock === undefined) {
    normalized.stock = 0;
  }
  
  // Ensure prep_time_min is integer or null
  if (normalized.prep_time_min !== null && typeof normalized.prep_time_min === 'number') {
    normalized.prep_time_min = Math.floor(normalized.prep_time_min);
  } else if (normalized.prep_time_min === undefined) {
    normalized.prep_time_min = null;
  }
  
  return normalized;
}

// Normalize all products
data.categorias.forEach(cat => {
  cat.productos = cat.productos.map(prod => normalizeProduct(prod, cat.id));
});

// Write normalized data
fs.writeFileSync(menuPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Menu normalized successfully');
