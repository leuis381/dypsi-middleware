#!/usr/bin/env node
/**
 * Validates data/menu.json against data/menu.schema.json using Ajv
 * Also checks uniqueness of product id and sku across categories.
 *
 * Usage: node scripts/check_menu.js
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');
const MENU_PATH = path.join(ROOT, 'data', 'menu.json');
const SCHEMA_PATH = path.join(ROOT, 'data', 'menu.schema.json');

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`Error parsing JSON file ${p}:`, err.message);
    process.exit(2);
  }
}

const menu = readJSON(MENU_PATH);
const schema = readJSON(SCHEMA_PATH);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const valid = validate(menu);

let failed = false;

if (!valid) {
  console.error('Schema validation errors:');
  for (const e of validate.errors) {
    console.error(` - ${e.instancePath || '/'}: ${e.message}`);
  }
  failed = true;
}

// collect ids & skus
const ids = new Map();
const skus = new Map();
const duplicates = [];

if (Array.isArray(menu.categorias)) {
  menu.categorias.forEach((cat, catIndex) => {
    if (!Array.isArray(cat.productos)) return;
    cat.productos.forEach((p, pIndex) => {
      const loc = `categorias[${catIndex}].productos[${pIndex}]`;
      if (!p.id) {
        console.error(`Missing id at ${loc}`);
        failed = true;
      } else {
        if (ids.has(p.id)) duplicates.push({ type: 'id', value: p.id, first: ids.get(p.id), second: loc });
        else ids.set(p.id, loc);
      }
      if (!p.sku) {
        console.error(`Missing sku at ${loc}`);
        failed = true;
      } else {
        if (skus.has(p.sku)) duplicates.push({ type: 'sku', value: p.sku, first: skus.get(p.sku), second: loc });
        else skus.set(p.sku, loc);
      }
    });
  });
}

if (duplicates.length) {
  console.error('Duplicates found:');
  duplicates.forEach(d => {
    console.error(` - ${d.type.toUpperCase()} "${d.value}" at ${d.second} (first at ${d.first})`);
  });
  failed = true;
}

if (failed) {
  console.error('\nValidation failed. Fix the errors and run again.');
  process.exit(1);
} else {
  console.log('Validation passed: menu.json matches schema and has unique ids/skus.');
  process.exit(0);
}
