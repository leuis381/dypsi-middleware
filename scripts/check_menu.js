#!/usr/bin/env node

/**
 * Menu Validation Script
 * 
 * Validates data/menu.json against data/menu.schema.json using AJV
 * and checks for duplicate IDs and SKUs.
 * 
 * Exit codes:
 *   0 - Validation successful
 *   1 - Validation failed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MENU_PATH = path.join(__dirname, '../data/menu.json');
const SCHEMA_PATH = path.join(__dirname, '../data/menu.schema.json');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

// function logWarning(message) {
//   log(`⚠ ${message}`, colors.yellow);
// }

function logInfo(message) {
  log(`ℹ ${message}`, colors.blue);
}

/**
 * Load and parse JSON file
 */
function loadJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    } else if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate menu against schema using AJV
 */
function validateSchema(menu, schema) {
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false
  });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(menu);

  if (!valid) {
    logError('Schema validation failed:');
    validate.errors.forEach((error, index) => {
      const path = error.instancePath || '/';
      console.log(`\n  ${index + 1}. ${error.message}`);
      console.log(`     Path: ${path}`);
      if (error.params) {
        console.log(`     Details: ${JSON.stringify(error.params)}`);
      }
    });
    return false;
  }

  return true;
}

/**
 * Check for duplicate product IDs and SKUs
 */
function checkDuplicates(menu) {
  const ids = new Map();
  const skus = new Map();
  const duplicateIds = [];
  const duplicateSkus = [];

  menu.categorias.forEach((categoria) => {
    categoria.productos.forEach((producto) => {
      // Check ID duplicates
      if (ids.has(producto.id)) {
        duplicateIds.push({
          id: producto.id,
          locations: [ids.get(producto.id), categoria.nombre]
        });
      } else {
        ids.set(producto.id, categoria.nombre);
      }

      // Check SKU duplicates
      if (skus.has(producto.sku)) {
        duplicateSkus.push({
          sku: producto.sku,
          locations: [skus.get(producto.sku), categoria.nombre]
        });
      } else {
        skus.set(producto.sku, categoria.nombre);
      }
    });
  });

  let hasErrors = false;

  if (duplicateIds.length > 0) {
    hasErrors = true;
    logError('Duplicate product IDs found:');
    duplicateIds.forEach(({ id, locations }) => {
      console.log(`  - ID "${id}" appears in: ${locations.join(', ')}`);
    });
  }

  if (duplicateSkus.length > 0) {
    hasErrors = true;
    logError('Duplicate product SKUs found:');
    duplicateSkus.forEach(({ sku, locations }) => {
      console.log(`  - SKU "${sku}" appears in: ${locations.join(', ')}`);
    });
  }

  if (!hasErrors) {
    logSuccess(`All product IDs are unique (${ids.size} products)`);
    logSuccess(`All product SKUs are unique (${skus.size} products)`);
  }

  return !hasErrors;
}

/**
 * Main validation function
 */
async function main() {
  log(`${colors.bold}DYPSI Menu Validation${colors.reset}\n`);

  let hasErrors = false;

  try {
    // Load files
    logInfo('Loading menu.json...');
    const menu = loadJSON(MENU_PATH);
    
    logInfo('Loading menu.schema.json...');
    const schema = loadJSON(SCHEMA_PATH);

    // Count products
    const productCount = menu.categorias.reduce(
      (sum, cat) => sum + cat.productos.length,
      0
    );
    logInfo(`Menu contains ${menu.categorias.length} categories and ${productCount} products`);

    console.log();

    // Validate schema
    logInfo('Validating against JSON Schema...');
    const schemaValid = validateSchema(menu, schema);
    if (!schemaValid) {
      hasErrors = true;
    } else {
      logSuccess('Schema validation passed');
    }

    console.log();

    // Check duplicates
    logInfo('Checking for duplicate IDs and SKUs...');
    const duplicatesValid = checkDuplicates(menu);
    if (!duplicatesValid) {
      hasErrors = true;
    }

    console.log();

    // Final result
    if (hasErrors) {
      logError('Validation FAILED');
      process.exit(1);
    } else {
      logSuccess('Validation PASSED - menu.json is valid!');
      process.exit(0);
    }
  } catch (error) {
    console.log();
    logError(`Fatal error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
