#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const menuPath = join(projectRoot, 'data', 'menu.json');
const schemaPath = join(projectRoot, 'data', 'menu.schema.json');

function loadJSON(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ Error loading ${filePath}:`, error.message);
    process.exit(1);
  }
}

function validateSchema(menu, schema) {
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  
  const validate = ajv.compile(schema);
  const valid = validate(menu);
  
  if (!valid) {
    console.error('❌ Schema validation failed:');
    console.error(JSON.stringify(validate.errors, null, 2));
    return false;
  }
  
  console.log('✅ Schema validation passed');
  return true;
}

function checkUniqueness(menu) {
  const ids = new Map();
  const skus = new Map();
  let hasErrors = false;
  
  menu.categorias.forEach((categoria, catIndex) => {
    categoria.productos.forEach((producto, prodIndex) => {
      const location = `categorias[${catIndex}].productos[${prodIndex}]`;
      
      // Check ID uniqueness
      if (ids.has(producto.id)) {
        console.error(`❌ Duplicate ID "${producto.id}" found:`);
        console.error(`   - First occurrence: ${ids.get(producto.id)}`);
        console.error(`   - Duplicate at: ${location}`);
        hasErrors = true;
      } else {
        ids.set(producto.id, location);
      }
      
      // Check SKU uniqueness
      if (skus.has(producto.sku)) {
        console.error(`❌ Duplicate SKU "${producto.sku}" found:`);
        console.error(`   - First occurrence: ${skus.get(producto.sku)}`);
        console.error(`   - Duplicate at: ${location}`);
        hasErrors = true;
      } else {
        skus.set(producto.sku, location);
      }
    });
  });
  
  if (!hasErrors) {
    console.log(`✅ Uniqueness check passed: ${ids.size} unique IDs, ${skus.size} unique SKUs`);
  }
  
  return !hasErrors;
}

function main() {
  console.log('🔍 Validating menu.json...\n');
  
  const menu = loadJSON(menuPath);
  const schema = loadJSON(schemaPath);
  
  const schemaValid = validateSchema(menu, schema);
  const uniquenessValid = checkUniqueness(menu);
  
  console.log('\n' + '='.repeat(50));
  
  if (schemaValid && uniquenessValid) {
    console.log('✅ All validation checks passed!');
    process.exit(0);
  } else {
    console.log('❌ Validation failed. Please fix the errors above.');
    process.exit(1);
  }
}

main();
