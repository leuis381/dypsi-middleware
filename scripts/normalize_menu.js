#!/usr/bin/env node

/**
 * Menu Normalization Script
 * 
 * Normalizes data/menu.json according to the schema requirements:
 * - Removes additional properties (like "reglas")
 * - Adds missing required fields with proper defaults
 * - Standardizes empty lists as []
 * - Ensures proper field types and formats
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MENU_PATH = path.join(__dirname, '../data/menu.json');

function normalizeProduct(product, metaVersionDate) {
  const normalized = {
    id: product.id,
    sku: product.sku,
    nombre: product.nombre,
    descripcion: product.descripcion || '',
    variantes: product.variantes || null,
    modificadores: product.modificadores || [],
    tags: product.tags || [],
    stock: typeof product.stock === 'number' ? Math.max(0, Math.floor(product.stock)) : 0,
    disponible: typeof product.disponible === 'boolean' ? product.disponible : true,
    prep_time_min: typeof product.prep_time_min === 'number' ? Math.floor(product.prep_time_min) : null,
    calorias_kcal: product.calorias_kcal || (product.variantes ? {} : 0),
    alergenos: product.alergenos || [],
    imagenes: product.imagenes || [],
    created_at: product.created_at || `${metaVersionDate}T00:00:00Z`
  };

  // Add precio only if no variantes
  if (normalized.variantes === null) {
    normalized.precio = typeof product.precio === 'number' 
      ? parseFloat(product.precio.toFixed(2)) 
      : 0.00;
  }

  return normalized;
}

function normalizeMenu(menu) {
  const normalized = {
    meta: {
      version: menu.meta.version,
      store: menu.meta.store,
      currency: menu.meta.currency
    },
    categorias: menu.categorias.map(categoria => ({
      id: categoria.id,
      nombre: categoria.nombre,
      descripcion: categoria.descripcion || '',
      productos: categoria.productos.map(p => normalizeProduct(p, menu.meta.version))
    }))
  };

  // Add optional meta.notes if present
  if (menu.meta.notes) {
    normalized.meta.notes = menu.meta.notes;
  }

  return normalized;
}

async function main() {
  try {
    console.log('Loading menu.json...');
    const menu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));

    console.log('Normalizing menu...');
    const normalized = normalizeMenu(menu);

    console.log('Writing normalized menu...');
    fs.writeFileSync(MENU_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');

    console.log('✓ Menu normalized successfully!');
    
    const productCount = normalized.categorias.reduce(
      (sum, cat) => sum + cat.productos.length,
      0
    );
    console.log(`  Categories: ${normalized.categorias.length}`);
    console.log(`  Products: ${productCount}`);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

main();
