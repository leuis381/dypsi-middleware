# Menu Validation Guide

This document explains how to validate the menu.json file and ensure it complies with the schema and uniqueness requirements.

## Overview

The menu validation system consists of:
- **data/menu.schema.json**: JSON Schema (draft-07) that defines the structure and validation rules for menu.json
- **scripts/check_menu.js**: Validation script that checks schema compliance and ID/SKU uniqueness
- **scripts/normalize_menu.js**: Utility script to normalize menu.json (add missing fields)
- **scripts/list_duplicates.js**: Helper script to list duplicate IDs or SKUs
- **.github/workflows/validate-menu.yml**: CI workflow that runs validation on every push and pull request

## Running Validation Locally

### Prerequisites

Make sure you have Node.js 18+ installed and dependencies are up to date:

```bash
npm install
```

### Validate Menu

To validate the menu.json file:

```bash
npm run validate-menu
```

This will:
1. Validate menu.json against the JSON schema
2. Check for duplicate IDs and SKUs across all categories
3. Exit with code 0 if validation passes, or 1 if there are errors

### Lint JavaScript Files

To check for code style issues:

```bash
npm run lint
```

To automatically fix code style issues:

```bash
npm run lint:fix
```

## Schema Requirements

The menu.json must conform to the following structure:

### Root Level
- **meta** (required): Metadata object with version, store, currency
- **categorias** (required): Array of category objects
- **reglas** (optional): Additional rules or configuration

### Product Level (each product must have)
- **id** (string): Unique product identifier
- **sku** (string): Unique SKU code
- **nombre** (string): Product name
- **precio** (number or null): Price for single-price products, null for variant-only products
- **descripcion** (string): Product description
- **variantes** (null or object): Null for single-price products, object with variant names and prices for multi-variant products
- **modificadores** (array): Array of modifier objects (can be empty)
- **tags** (array): Array of tag strings (can be empty)
- **stock** (integer >= 0): Stock quantity
- **disponible** (boolean): Availability status
- **prep_time_min** (integer or null): Preparation time in minutes
- **calorias_kcal** (number or object): Single number for single-price products, object with variant keys for multi-variant products
- **imagenes** (array): Array of image URLs (can be empty)
- **created_at** (string): ISO8601 UTC timestamp (e.g., "2025-10-01T08:00:00Z")
- **alergenos** (array, optional): Array of allergen strings

### Validation Rules
- IDs must be unique across all categories
- SKUs must be unique across all categories
- Products with variantes should have calorias_kcal as an object keyed by variant name
- Products without variantes should have calorias_kcal as a number
- Decimal prices should have two decimal places
- created_at must be a valid ISO8601 UTC timestamp

## Helper Scripts

### Normalize Menu

If menu.json is missing required fields (variantes, modificadores, tags, imagenes, calorias_kcal), run:

```bash
node scripts/normalize_menu.js
```

This will add missing fields with appropriate defaults.

### List Duplicates

To check for duplicate IDs or SKUs:

```bash
node scripts/list_duplicates.js
```

This will output detailed information about any duplicates found, including their locations in the menu structure.

## CI/CD Integration

The validation runs automatically on every push and pull request via GitHub Actions. The workflow:

1. Checks out the code
2. Sets up Node.js 18
3. Installs dependencies
4. Runs menu validation
5. Runs ESLint

If any step fails, the CI build will fail and you'll need to fix the issues before merging.

## Troubleshooting

### Schema Validation Failures

If schema validation fails, the error output will show:
- The path to the failing property (e.g., `/categorias/1/productos/0/precio`)
- The validation rule that failed
- The expected vs actual values

Fix the issues in menu.json and run validation again.

### Duplicate IDs or SKUs

If duplicates are found, the output will show:
- The duplicate ID or SKU
- The locations of all occurrences (category index, product index)

To resolve:
1. Identify which occurrence to keep (usually the first or most complete)
2. Remove or merge the duplicate entries
3. Run validation again

### ESLint Warnings

ESLint warnings don't fail the build but should be addressed for code quality:
- Unused variables can be prefixed with `_` to indicate they're intentionally unused
- Use `npm run lint:fix` to automatically fix style issues

## Support

For questions or issues with validation, check:
- The schema file: `data/menu.schema.json`
- The validation script: `scripts/check_menu.js`
- This documentation
