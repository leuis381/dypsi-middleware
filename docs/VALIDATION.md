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
- El workflow `.github/workflows/validate-menu.yml` ejecuta `npm ci` y luego `npm run validate-menu` y `npm run lint` por defecto (en ese orden).
- Si la validación falla o hay duplicados, CI fallará y el PR no podrá ser mergeado hasta correcciones.

CI - comportamiento respecto a lockfile (package-lock.json / npm-shrinkwrap.json)
- El workflow ahora detecta si existe un lockfile (`package-lock.json` o `npm-shrinkwrap.json`).
  - Si existe lockfile, el workflow ejecuta `npm ci` (recomendado: instalación determinista en CI).
  - Si NO existe lockfile, el workflow hace fallback a `npm install` para evitar fallos de CI.
- Recomendación: genera y commitea `package-lock.json` para instalaciones reproducibles en CI:
  - Generar lockfile sin instalar node_modules:
    npm install --package-lock-only
  - Luego:
    git add package-lock.json
    git commit -m "chore: add package-lock.json for deterministic CI"
    git push
- Alternativa: si no deseas commitear el lockfile, el workflow seguirá funcionando gracias al fallback; sin embargo, `npm install` puede producir resultados no deterministas entre entornos.

Notas adicionales:
- Si tu proyecto usa workspaces o tiene estructura monorepo, adapta la lógica del workflow para comprobar lockfiles en las rutas correspondientes.
- Para producción y despliegues, mantener el lockfile en el repositorio suele ser la práctica recomendada (garantiza instalaciones reproducibles).
