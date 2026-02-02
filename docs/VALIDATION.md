# Menu Validation

This document describes how to validate the menu catalog (`data/menu.json`) locally and explains how the automated validation works in CI.

## Overview

The menu validation system ensures that `data/menu.json`:
- Conforms to the JSON Schema defined in `data/menu.schema.json`
- Contains no duplicate product IDs or SKUs
- Has properly formatted and standardized fields

## Running Validation Locally

### Prerequisites

- Node.js 18 or higher
- npm (comes with Node.js)

### Installation

Install dependencies if you haven't already:

```bash
npm install
```

### Validate Menu

To validate the menu catalog:

```bash
npm run validate-menu
```

This will:
1. Load `data/menu.json` and `data/menu.schema.json`
2. Validate the menu structure against the JSON Schema
3. Check for duplicate product IDs and SKUs
4. Report any errors with detailed messages

### Expected Output

**Success:**
```
DYPSI Menu Validation

ℹ Loading menu.json...
ℹ Loading menu.schema.json...
ℹ Menu contains 11 categories and 141 products

ℹ Validating against JSON Schema...
✓ Schema validation passed

ℹ Checking for duplicate IDs and SKUs...
✓ All product IDs are unique (141 products)
✓ All product SKUs are unique (141 products)

✓ Validation PASSED - menu.json is valid!
```

**Failure:**
If validation fails, you'll see detailed error messages indicating:
- Schema violations (missing fields, wrong types, etc.)
- Duplicate IDs or SKUs with their locations

## Running Linter

To check code style and common issues:

```bash
npm run lint
```

To automatically fix issues where possible:

```bash
npm run lint:fix
```

## Menu Schema Requirements

The menu must follow this structure:

### Root Level
- `meta`: Metadata about the catalog
  - `version`: Date in YYYY-MM-DD format
  - `store`: Store name
  - `currency`: 3-letter currency code (e.g., "PEN")
  - `notes`: (optional) Additional notes
- `categorias`: Array of product categories

### Category Structure
- `id`: Unique category identifier
- `nombre`: Category name
- `descripcion`: Category description (optional)
- `productos`: Array of products

### Product Structure

Each product must have:

- `id` (string): Unique product identifier
- `sku` (string): Stock Keeping Unit code
- `nombre` (string): Product name
- `descripcion` (string): Product description
- `variantes`: Either `null` or an object with variant names as keys and prices as values
- `precio` (number): Base price (only required when `variantes` is `null`)
- `modificadores` (array): Available add-ons/modifiers (can be empty)
- `tags` (array): Product tags (can be empty)
- `stock` (integer): Available stock quantity (≥0)
- `disponible` (boolean): Whether product is available
- `prep_time_min` (integer or null): Preparation time in minutes
- `calorias_kcal`: Number (for single-price) or object (for variants with calories per variant)
- `alergenos` (array): List of allergens
- `imagenes` (array): Product image URLs (can be empty)
- `created_at` (string): ISO 8601 UTC timestamp

### Product Variants

Products can have variants (e.g., sizes) or be single-price:

**Single-price product:**
```json
{
  "id": "pan_ajo_cheese",
  "variantes": null,
  "precio": 5.00,
  "calorias_kcal": 420
}
```

**Product with variants:**
```json
{
  "id": "pizza_mozzarella",
  "variantes": {
    "pequena": 9.00,
    "mediana": 20.90,
    "familiar": 27.90
  },
  "calorias_kcal": {
    "pequena": 650,
    "mediana": 1200,
    "familiar": 1800
  }
}
```

## Continuous Integration (CI)

### GitHub Actions Workflow

The repository includes a GitHub Actions workflow (`.github/workflows/validate-menu.yml`) that automatically validates the menu and runs the linter on:

- Push to `main`, `develop`, or any `fix/**` or `feature/**` branch
- Pull requests to `main` or `develop`

### CI Steps

1. **Checkout code**: Gets the latest code from the repository
2. **Setup Node.js**: Installs Node.js 18
3. **Install dependencies**: Runs `npm ci` to install exact versions
4. **Validate menu**: Runs `npm run validate-menu`
5. **Run ESLint**: Runs `npm run lint`

If any step fails, the workflow will fail and prevent merging (in protected branches).

### Viewing CI Results

1. Go to the "Actions" tab in the GitHub repository
2. Click on the workflow run you want to inspect
3. View the logs for each step to see validation results

## Troubleshooting

### Validation Fails Locally

1. Read the error messages carefully - they indicate what's wrong
2. For schema errors, check the field types and required properties
3. For duplicate errors, search for the duplicate ID/SKU in the file
4. Fix the issues and run validation again

### Validation Passes Locally but Fails in CI

1. Ensure you've committed all changes (including `data/menu.json`)
2. Ensure your Node.js version matches CI (18+)
3. Check that `package-lock.json` is committed
4. Review the CI logs for specific error messages

### Linter Errors

1. Run `npm run lint` to see all errors
2. Run `npm run lint:fix` to auto-fix where possible
3. For remaining errors, manually fix according to ESLint rules
4. The `.eslintrc.json` file contains the linting configuration

## Normalizing the Menu

If you need to normalize an existing menu file, you can use the normalization script:

```bash
node scripts/normalize_menu.js
```

This will:
- Remove additional properties not in the schema
- Add missing required fields with defaults
- Standardize empty arrays and null values
- Format timestamps and numbers correctly

**Note:** Always backup your menu file before running normalization.

## Files Overview

- `data/menu.json` - The menu catalog
- `data/menu.schema.json` - JSON Schema definition (draft-07)
- `scripts/check_menu.js` - Validation script
- `scripts/normalize_menu.js` - Normalization script
- `.eslintrc.json` - ESLint configuration
- `.eslintignore` - Files to ignore in linting
- `.github/workflows/validate-menu.yml` - CI workflow
- `docs/VALIDATION.md` - This file

## Support

If you encounter issues with validation:

1. Check this documentation
2. Review the JSON Schema in `data/menu.schema.json`
3. Look at example products in `data/menu.json`
4. Check the validation script source in `scripts/check_menu.js`
