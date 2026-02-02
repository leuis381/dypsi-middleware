# Menu Validation Guide

This document describes how to validate the menu catalog and run code quality checks locally and in CI.

## Overview

The DYPSI middleware includes automated validation for the menu catalog (`data/menu.json`) using JSON Schema validation and custom uniqueness checks.

## Local Validation

### Prerequisites

- Node.js 18 or higher
- npm dependencies installed

### Installation

```bash
npm install
```

### Running Validation

To validate the menu catalog:

```bash
npm run validate-menu
```

This script will:
- Load and parse `data/menu.json`
- Validate it against `data/menu.schema.json` using AJV
- Check for duplicate product IDs across all categories
- Check for duplicate SKUs across all categories
- Report any validation errors with clear messages
- Exit with code 0 on success, 1 on failure

### Running Linter

To check JavaScript code quality:

```bash
npm run lint
```

To automatically fix linting issues:

```bash
npm run lint:fix
```

## Schema Rules

The JSON Schema (`data/menu.schema.json`) enforces:

### Required Fields
All products must include:
- `id` - Unique identifier (lowercase alphanumeric with underscores)
- `sku` - Stock keeping unit (uppercase alphanumeric with hyphens)
- `nombre` - Product name
- `precio` - Base price (number with 2 decimal places)
- `descripcion` - Product description
- `variantes` - Either `null` or object with variant prices
- `modificadores` - Array of modifier objects (use `[]` for products without modifiers)
- `tags` - Array of tag strings
- `stock` - Integer >= 0
- `disponible` - Boolean availability flag
- `prep_time_min` - Preparation time in minutes (integer or null)
- `calorias_kcal` - Calories (number for single-price, object for variants)
- `alergenos` - Array of allergen strings
- `imagenes` - Array of image URLs (use `[]` for products without images)
- `created_at` - ISO8601 datetime string

### Field Types and Formats

#### Variantes
- **null**: For products with a single fixed price
- **object**: For products with multiple size/variant options
  - Keys must match pattern: `pequena`, `mediana`, `grande`, `familiar`, etc.
  - Values must be numbers with 2 decimal places

#### Calorias_kcal
- **number**: For single-price products (e.g., `420`)
- **object**: For products with variants (e.g., `{"pequena": 300, "mediana": 450}`)
  - Keys must match the variant keys
  - Values must be numbers

#### Modificadores
- Array of objects with:
  - `id`: Modifier identifier
  - `nombre`: Modifier name
  - `precio`: Additional price (number with 2 decimal places)

### Uniqueness Constraints
- Product `id` must be unique across all categories
- Product `sku` must be unique across all categories

## Continuous Integration

The GitHub Actions workflow (`.github/workflows/validate-menu.yml`) runs automatically on:
- Every push to any branch
- Every pull request

The workflow:
1. Checks out the repository
2. Sets up Node.js 18.x
3. Installs dependencies with `npm ci`
4. Runs `npm run validate-menu`
5. Runs `npm run lint`

If validation or linting fails, the workflow will fail and prevent merging.

## Common Issues

### Duplicate IDs or SKUs
If validation reports duplicate IDs or SKUs:
1. Search for the duplicate value in `data/menu.json`
2. Determine which entry is canonical
3. Remove or update the duplicate entry

### Schema Validation Errors
If schema validation fails:
1. Check the error path (e.g., `categorias[0].productos[5]`)
2. Review the error message
3. Fix the field to match the schema requirements

### Linting Warnings
The project uses ESLint with `eslint:recommended` rules:
- Warnings about unused variables are acceptable if the variable is used elsewhere
- Use `// eslint-disable-next-line` comments sparingly for intentional exceptions
- Most issues can be auto-fixed with `npm run lint:fix`

## Normalizations Applied

The menu catalog has been normalized to:
- Use `[]` instead of `null` for `modificadores` and `imagenes`
- Ensure all prices have exactly 2 decimal places
- Ensure `stock` is an integer >= 0
- Ensure `prep_time_min` is an integer when not null
- Ensure all `created_at` values are valid ISO8601 datetimes
- Remove any duplicate products by ID and SKU

## Extending the Schema

To add new fields or modify validation rules:

1. Update `data/menu.schema.json` with the new requirements
2. Update existing products in `data/menu.json` to match the new schema
3. Run `npm run validate-menu` to verify all products pass
4. Update this documentation with the new rules

## Support

For questions or issues with menu validation:
1. Check this documentation
2. Review the schema at `data/menu.schema.json`
3. Examine the validation script at `scripts/check_menu.js`
4. Open an issue in the repository
