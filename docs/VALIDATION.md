# Menu Validation Documentation

This document describes how to validate the menu.json file both locally and in CI.

## Overview

The `data/menu.json` file contains the complete product catalog for DYPSI Pizzería & Grill. To ensure data integrity and consistency, we use:

1. **JSON Schema validation** - Validates the structure and data types against `data/menu.schema.json`
2. **Duplicate detection** - Checks for duplicate product IDs and SKUs across all categories
3. **ESLint** - Lints JavaScript files for code quality

## Running Validation Locally

### Prerequisites

- Node.js 18 or higher
- npm

### Install Dependencies

```bash
npm install
```

### Validate Menu

To validate the menu.json file against the schema and check for duplicates:

```bash
npm run validate-menu
```

This will:
- Load `data/menu.json` and `data/menu.schema.json`
- Validate the JSON structure against the schema
- Check for duplicate product IDs
- Check for duplicate SKUs
- Exit with code 0 on success, 1 on failure

### Lint JavaScript Files

To lint JavaScript files in the repository:

```bash
npm run lint
```

To automatically fix safe linting issues:

```bash
npm run lint:fix
```

**Note**: Some linting issues require manual intervention and cannot be auto-fixed. These include:
- Unused variables
- Unnecessary regex escapes that might be intentional
- Other context-dependent issues

## CI/CD Integration

### GitHub Actions Workflow

The repository includes a GitHub Actions workflow (`.github/workflows/validate-menu.yml`) that automatically runs validation on:

- Every push to any branch
- Every pull request
- Manual workflow dispatch

The workflow:
1. Checks out the code
2. Sets up Node.js 18
3. Installs dependencies with `npm ci`
4. Runs menu validation with `npm run validate-menu`
5. Runs linting with `npm run lint`

If any step fails, the workflow will fail and prevent merging.

## Menu Schema

The schema (`data/menu.schema.json`) enforces:

### Meta Section
- `version` - Date in YYYY-MM-DD format
- `store` - Store name
- `currency` - Currency code (PEN, USD, EUR)

### Categories
Each category must have:
- `id` - Unique identifier
- `nombre` - Category name
- `productos` - Array of products

### Products
Each product must have:
- `id` - Unique product identifier (checked for duplicates)
- `sku` - Stock keeping unit (checked for duplicates)
- `nombre` - Product name
- `precio` - Base price (number ≥ 0)
- `variantes` - Null or object mapping variant name to price
- `modificadores` - Array of modifiers (can be empty)
- `tags` - Array of tags (can be empty)
- `stock` - Integer ≥ 0
- `disponible` - Boolean availability flag
- `imagenes` - Array of image URLs (can be empty)
- `created_at` - ISO8601 datetime string

Optional product fields:
- `descripcion` - Product description
- `prep_time_min` - Preparation time in minutes (integer or null)
- `calorias_kcal` - Number (for products without variants) or object (for products with variants)
- `alergenos` - Array of allergen strings

### Validation Rules

1. **Required fields** - All required fields must be present
2. **No additional properties** - Products cannot have extra fields beyond those defined in the schema
3. **Type checking** - All fields must match their specified types
4. **Uniqueness** - Product IDs and SKUs must be unique across all categories
5. **Price format** - Prices must be positive numbers
6. **Date format** - created_at must be valid ISO8601 datetime

## Troubleshooting

### Schema Validation Errors

If you see schema validation errors, check:
- All required fields are present
- Field types match the schema (string, number, boolean, array, object, null)
- No extra fields on product objects
- Prices are positive numbers
- Dates are in ISO8601 format

### Duplicate Errors

If duplicate IDs or SKUs are found:
- The validation script will list all locations where duplicates occur
- Remove duplicate entries, keeping the most complete version
- Document removed duplicates in your PR

### Linting Errors

If linting fails:
- Run `npm run lint:fix` to auto-fix safe issues
- Manually review and fix remaining issues
- Do not remove functionality to fix lint warnings
- Use eslint-disable comments sparingly and only when justified

## Making Changes to menu.json

When updating the menu:

1. Edit `data/menu.json`
2. Run `npm run validate-menu` to check for errors
3. Fix any validation errors
4. Run `npm run lint` to check JavaScript files
5. Commit your changes
6. Push and verify CI passes

## Schema Updates

If you need to add new product fields:

1. Update `data/menu.schema.json` with the new field definition
2. Set `additionalProperties: false` remains in place (or adjust as needed)
3. Add the field to existing products or mark it as optional
4. Run validation to ensure all products conform
5. Document the change

## Contact

For questions or issues with menu validation, please open an issue in the repository.
