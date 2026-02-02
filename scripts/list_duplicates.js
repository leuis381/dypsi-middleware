#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const menuPath = join(projectRoot, 'data', 'menu.json');

function loadJSON(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ Error loading ${filePath}:`, error.message);
    process.exit(1);
  }
}

function findDuplicates(menu) {
  const idsMap = new Map();
  const skusMap = new Map();
  
  menu.categorias.forEach((categoria, catIndex) => {
    categoria.productos.forEach((producto, prodIndex) => {
      const location = {
        category: categoria.nombre,
        categoryIndex: catIndex,
        productIndex: prodIndex,
        product: {
          id: producto.id,
          sku: producto.sku,
          nombre: producto.nombre
        }
      };
      
      // Track IDs
      if (!idsMap.has(producto.id)) {
        idsMap.set(producto.id, []);
      }
      idsMap.get(producto.id).push(location);
      
      // Track SKUs
      if (!skusMap.has(producto.sku)) {
        skusMap.set(producto.sku, []);
      }
      skusMap.get(producto.sku).push(location);
    });
  });
  
  // Find duplicates
  const duplicateIds = Array.from(idsMap.entries()).filter(([_, locations]) => locations.length > 1);
  const duplicateSkus = Array.from(skusMap.entries()).filter(([_, locations]) => locations.length > 1);
  
  return { duplicateIds, duplicateSkus };
}

function main() {
  console.log('🔍 Checking for duplicates in menu.json...\n');
  
  const menu = loadJSON(menuPath);
  const { duplicateIds, duplicateSkus } = findDuplicates(menu);
  
  if (duplicateIds.length === 0 && duplicateSkus.length === 0) {
    console.log('✅ No duplicates found!');
    process.exit(0);
  }
  
  if (duplicateIds.length > 0) {
    console.log('❌ Duplicate IDs found:\n');
    duplicateIds.forEach(([id, locations]) => {
      console.log(`  ID: "${id}" (${locations.length} occurrences)`);
      locations.forEach((loc, idx) => {
        console.log(`    ${idx + 1}. ${loc.category} [${loc.categoryIndex}][${loc.productIndex}] - ${loc.product.nombre}`);
      });
      console.log('');
    });
  }
  
  if (duplicateSkus.length > 0) {
    console.log('❌ Duplicate SKUs found:\n');
    duplicateSkus.forEach(([sku, locations]) => {
      console.log(`  SKU: "${sku}" (${locations.length} occurrences)`);
      locations.forEach((loc, idx) => {
        console.log(`    ${idx + 1}. ${loc.category} [${loc.categoryIndex}][${loc.productIndex}] - ${loc.product.nombre}`);
      });
      console.log('');
    });
  }
  
  process.exit(1);
}

main();
