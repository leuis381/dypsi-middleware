#!/usr/bin/env node

/**
 * Menu Validation Script
 * 
 * This script validates data/menu.json against data/menu.schema.json
 * and checks for duplicate IDs and SKUs across all products.
 * 
 * Exit codes:
 *   0 - Validation passed
 *   1 - Validation or duplicate errors found
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function loadJSON(filepath) {
  try {
    const content = readFileSync(filepath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    log(`Error loading ${filepath}: ${error.message}`, 'red');
    process.exit(1);
  }
}

function validateSchema(menu, schema) {
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  
  const validate = ajv.compile(schema);
  const valid = validate(menu);
  
  if (!valid) {
    log('\n❌ Schema Validation Failed:', 'red');
    log('─'.repeat(60), 'red');
    
    validate.errors.forEach((error, index) => {
      log(`\nError ${index + 1}:`, 'yellow');
      log(`  Path: ${error.instancePath || '(root)'}`, 'yellow');
      log(`  Message: ${error.message}`, 'yellow');
      
      if (error.params) {
        log(`  Details: ${JSON.stringify(error.params)}`, 'yellow');
      }
    });
    
    log('\n' + '─'.repeat(60), 'red');
    return false;
  }
  
  return true;
}

function checkDuplicates(menu) {
  const ids = new Map();
  const skus = new Map();
  let hasErrors = false;
  
  menu.categorias.forEach((categoria) => {
    categoria.productos.forEach((producto) => {
      const id = producto.id;
      const sku = producto.sku;
      const location = `${categoria.id}/${producto.nombre}`;
      
      // Check ID duplicates
      if (ids.has(id)) {
        ids.get(id).push(location);
      } else {
        ids.set(id, [location]);
      }
      
      // Check SKU duplicates
      if (skus.has(sku)) {
        skus.get(sku).push(location);
      } else {
        skus.set(sku, [location]);
      }
    });
  });
  
  // Report duplicate IDs
  const duplicateIds = Array.from(ids.entries()).filter(([_, locs]) => locs.length > 1);
  if (duplicateIds.length > 0) {
    hasErrors = true;
    log('\n❌ Duplicate Product IDs Found:', 'red');
    log('─'.repeat(60), 'red');
    
    duplicateIds.forEach(([id, locations]) => {
      log(`\nID: ${id}`, 'yellow');
      log(`  Found in ${locations.length} locations:`, 'yellow');
      locations.forEach((loc) => {
        log(`    - ${loc}`, 'yellow');
      });
    });
    
    log('\n' + '─'.repeat(60), 'red');
  }
  
  // Report duplicate SKUs
  const duplicateSkus = Array.from(skus.entries()).filter(([_, locs]) => locs.length > 1);
  if (duplicateSkus.length > 0) {
    hasErrors = true;
    log('\n❌ Duplicate Product SKUs Found:', 'red');
    log('─'.repeat(60), 'red');
    
    duplicateSkus.forEach(([sku, locations]) => {
      log(`\nSKU: ${sku}`, 'yellow');
      log(`  Found in ${locations.length} locations:`, 'yellow');
      locations.forEach((loc) => {
        log(`    - ${loc}`, 'yellow');
      });
    });
    
    log('\n' + '─'.repeat(60), 'red');
  }
  
  return !hasErrors;
}

function main() {
  log('\n🔍 Validating Menu Data...', 'blue');
  log('═'.repeat(60), 'blue');
  
  // Load files
  const menuPath = join(rootDir, 'data', 'menu.json');
  const schemaPath = join(rootDir, 'data', 'menu.schema.json');
  
  log('\n📂 Loading files...', 'blue');
  const menu = loadJSON(menuPath);
  const schema = loadJSON(schemaPath);
  
  log(`  ✓ Loaded ${menuPath}`, 'green');
  log(`  ✓ Loaded ${schemaPath}`, 'green');
  
  // Count products
  let totalProducts = 0;
  menu.categorias.forEach((cat) => {
    totalProducts += cat.productos.length;
  });
  
  log(`\n📊 Menu Statistics:`, 'blue');
  log(`  Categories: ${menu.categorias.length}`, 'blue');
  log(`  Total Products: ${totalProducts}`, 'blue');
  
  // Validate schema
  log('\n🔎 Running schema validation...', 'blue');
  const schemaValid = validateSchema(menu, schema);
  
  // Check duplicates
  log('\n🔎 Checking for duplicates...', 'blue');
  const noDuplicates = checkDuplicates(menu);
  
  // Summary
  log('\n' + '═'.repeat(60), 'blue');
  
  if (schemaValid && noDuplicates) {
    log('✅ All validations passed!', 'green');
    log('═'.repeat(60), 'green');
    process.exit(0);
  } else {
    log('❌ Validation failed!', 'red');
    log('═'.repeat(60), 'red');
    process.exit(1);
  }
}

main();
