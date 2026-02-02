# Validación del menú y CI

Archivos importantes:
- data/menu.json — catálogo principal (usa la versión normalizada pegada en este PR).
- data/menu.schema.json — JSON Schema (draft-07).
- scripts/check_menu.js — validador (Ajv + comprobación de duplicados).
- .github/workflows/validate-menu.yml — workflow que valida y hace lint en PR.

Comandos locales:
1. Instalar dependencias:
   npm install

2. Ejecutar validación:
   npm run validate-menu

3. Ejecutar lint:
   npm run lint
   npm run lint:fix  # aplica arreglos automáticos

Reglas principales:
- `id` y `sku` deben ser únicos en todo el catálogo.
- `variantes` es null o un objeto con precios (2 decimales).
- `calorias_kcal` es number o objeto por variante.
- `modificadores` y `imagenes` son arrays (usar [] si no aplica).
- `created_at` en formato ISO8601 (UTC).

CI:
- El workflow `.github/workflows/validate-menu.yml` ejecuta `npm ci`, `npm run validate-menu` y `npm run lint`.
- Si la validación falla o hay duplicados, CI fallará y el PR no podrá ser mergeado hasta correcciones.
