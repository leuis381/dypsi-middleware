#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const menuPath = join(projectRoot, 'data', 'menu.json');

function loadJSON(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function normalizeProduct(product) {
  // Ensure variantes exists (null or object)
  if (!('variantes' in product)) {
    product.variantes = null;
  }
  
  // Ensure modificadores is an array
  if (!('modificadores' in product) || product.modificadores === null) {
    product.modificadores = [];
  }
  
  // Ensure tags is an array
  if (!('tags' in product) || product.tags === null) {
    product.tags = [];
  }
  
  // Ensure imagenes is an array
  if (!('imagenes' in product) || product.imagenes === null) {
    product.imagenes = [];
  }
  
  // Ensure calorias_kcal exists
  if (!('calorias_kcal' in product)) {
    // Default to 0 if missing
    product.calorias_kcal = 0;
  }
  
  // Ensure precio exists (if no variantes, precio should be set)
  if (!('precio' in product) && !product.variantes) {
    console.warn(`⚠️  Product ${product.id} missing precio and has no variantes`);
  }
  
  return product;
}

function normalizeMenu(menu) {
  menu.categorias.forEach(categoria => {
    categoria.productos = categoria.productos.map(normalizeProduct);
  });
  
  return menu;
}

function main() {
  console.log('🔧 Normalizing menu.json...\n');
  
  const menu = loadJSON(menuPath);
  const normalized = normalizeMenu(menu);
  
  // Write back to file with 2-space indentation
  writeFileSync(menuPath, JSON.stringify(normalized, null, 2) + '\n', 'utf-8');
  
  console.log('✅ Menu normalized successfully!');
}

main();
