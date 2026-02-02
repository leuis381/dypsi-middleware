#!/usr/bin/env node

/**
 * Menu Validation Script
 * 
 * This script validates data/menu.json against data/menu.schema.json
 * and checks for duplicate IDs and SKUs across all products.
 * 
 * Usage: node scripts/check_menu.js
 * Exit code: 0 if validation passes, 1 if validation fails
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for terminal output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function main() {
  let hasErrors = false;

  log('\n=== DYPSI Menu Validation ===\n', 'blue');

  // Paths
  const menuPath = path.join(__dirname, '..', 'data', 'menu.json');
  const schemaPath = path.join(__dirname, '..', 'data', 'menu.schema.json');

  // Check if files exist
  if (!fs.existsSync(menuPath)) {
    log(`✗ Menu file not found: ${menuPath}`, 'red');
    process.exit(1);
  }

  if (!fs.existsSync(schemaPath)) {
    log(`✗ Schema file not found: ${schemaPath}`, 'red');
    process.exit(1);
  }

  // Load files
  let menuData;
  let schemaData;

  try {
    menuData = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
    log('✓ Menu JSON loaded successfully', 'green');
  } catch (error) {
    log(`✗ Failed to parse menu JSON: ${error.message}`, 'red');
    process.exit(1);
  }

  try {
    schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    log('✓ Schema JSON loaded successfully', 'green');
  } catch (error) {
    log(`✗ Failed to parse schema JSON: ${error.message}`, 'red');
    process.exit(1);
  }

  // Validate against schema
  log('\n--- Schema Validation ---', 'blue');
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  
  const validate = ajv.compile(schemaData);
  const valid = validate(menuData);

  if (!valid) {
    log('✗ Schema validation failed:', 'red');
    validate.errors.forEach((error, index) => {
      log(`  Error ${index + 1}:`, 'yellow');
      log(`    Path: ${error.instancePath || '(root)'}`, 'yellow');
      log(`    Message: ${error.message}`, 'yellow');
      if (error.params && Object.keys(error.params).length > 0) {
        log(`    Params: ${JSON.stringify(error.params)}`, 'yellow');
      }
    });
    hasErrors = true;
  } else {
    log('✓ Schema validation passed', 'green');
  }

  // Check for duplicate IDs and SKUs
  log('\n--- Uniqueness Validation ---', 'blue');
  const idMap = new Map();
  const skuMap = new Map();
  const duplicateIds = [];
  const duplicateSkus = [];

  menuData.categorias.forEach((categoria, catIndex) => {
    categoria.productos.forEach((producto, prodIndex) => {
      // Check ID uniqueness
      if (idMap.has(producto.id)) {
        duplicateIds.push({
          id: producto.id,
          locations: [
            idMap.get(producto.id),
            `categorias[${catIndex}].productos[${prodIndex}] (${categoria.id})`
          ]
        });
      } else {
        idMap.set(producto.id, `categorias[${catIndex}].productos[${prodIndex}] (${categoria.id})`);
      }

      // Check SKU uniqueness
      if (skuMap.has(producto.sku)) {
        duplicateSkus.push({
          sku: producto.sku,
          locations: [
            skuMap.get(producto.sku),
            `categorias[${catIndex}].productos[${prodIndex}] (${categoria.id})`
          ]
        });
      } else {
        skuMap.set(producto.sku, `categorias[${catIndex}].productos[${prodIndex}] (${categoria.id})`);
      }
    });
  });

  if (duplicateIds.length > 0) {
    log('✗ Duplicate product IDs found:', 'red');
    duplicateIds.forEach(dup => {
      log(`  ID: "${dup.id}"`, 'yellow');
      dup.locations.forEach(loc => {
        log(`    - ${loc}`, 'yellow');
      });
    });
    hasErrors = true;
  } else {
    log(`✓ All product IDs are unique (${idMap.size} products)`, 'green');
  }

  if (duplicateSkus.length > 0) {
    log('✗ Duplicate SKUs found:', 'red');
    duplicateSkus.forEach(dup => {
      log(`  SKU: "${dup.sku}"`, 'yellow');
      dup.locations.forEach(loc => {
        log(`    - ${loc}`, 'yellow');
      });
    });
    hasErrors = true;
  } else {
    log(`✓ All SKUs are unique (${skuMap.size} products)`, 'green');
  }

  // Summary
  log('\n=== Validation Summary ===', 'blue');
  if (hasErrors) {
    log('✗ Validation FAILED - Please fix the errors above', 'red');
    process.exit(1);
  } else {
    log('✓ All validations PASSED', 'green');
    log(`  - ${menuData.categorias.length} categories`, 'green');
    log(`  - ${idMap.size} products`, 'green');
    log(`  - ${menuData.reglas ? menuData.reglas.length : 0} business rules`, 'green');
    process.exit(0);
  }
}

main();
