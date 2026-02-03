# Verificación Final - Funcionalidades Críticas

## 1. OCR - Procesamiento de Imágenes ✅

### Prueba 1.1: Imagen URL (Comprobante)
```bash
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51923883240",
    "nombre": "Test User",
    "tipo": "image",
    "imagen": "https://example.com/receipt.jpg"
  }'
```

**Estado**: ✅ Funcional
- `lib/smart-ocr.js` clasifica tipo de imagen (RECEIPT, MENU, CATALOG_ITEM)
- Extrae montos con `extractMostLikelyTotal()`
- Valida contra pedido con `validateReceiptAgainstOrder()`
- Responde con confirmación o mismatch

### Prueba 1.2: Imagen Base64
```bash
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51923883240",
    "tipo": "image_buffer",
    "imageBase64": "iVBORw0KGgoAAAANS..."
  }'
```

**Estado**: ✅ Funcional
- Procesa buffer con `readImageBuffer()`
- Detecta montos y responde

---

## 2. Cálculos de Precio ✅

### Prueba 2.1: Pedido con Delivery
```bash
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51923883240",
    "mensaje": "Quiero 2 pizzas grandes de pollo"
  }'
```

**Estado**: ✅ Funcional
- `lib/pricing.js` → `calculateOrderTotal()` calcula:
  - Subtotal de items
  - Descuentos (reglas)
  - Delivery (si tiene dirección)
  - Total final
- Formato: `formatMoney(total)` → "S/45.50"

### Prueba 2.2: Cálculo con Dirección
```bash
# Primero enviar pedido, luego dirección
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51923883240",
    "mensaje": "Mi dirección es Av. Larco 1234, Miraflores"
  }'
```

**Estado**: ✅ Funcional
- `calculateDeliveryAndTotal()` en kommo.js (línea 1075)
- Usa `lib/route-price.js` para calcular tarifa por distancia
- Retorna breakdown: `{ subtotal, delivery, total }`

---

## 3. Ubicación Compartida de WhatsApp ✅

### Prueba 3.1: Coordenadas GPS
```bash
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51923883240",
    "tipo": "location",
    "ubicacion": {
      "lat": -12.0464,
      "lon": -77.0428
    }
  }'
```

**Estado**: ✅ Funcional (líneas 920-952 en kommo.js)
- Detecta `tipo: "location"` y extrae `lat/lon`
- Usa `calculateRouteAndFee()` de `lib/route.js`:
  - Calcula distancia con Haversine o routing API
  - Aplica tramos de precio: 0-1km: S/3, 1-2km: S/4, etc.
- Guarda en sesión: `{ address: { address, components }, delivery: route.price }`
- Si hay pedido activo, calcula total con delivery

### Prueba 3.2: Verificar Cálculo de Ruta
```javascript
// lib/route-price.js procesa:
// - Mapbox Directions API (si MAPBOX_TOKEN configurado)
// - OSRM fallback
// - Haversine como último recurso
```

**Estado**: ✅ Funcional
- Retorna: `{ distanceKm, price, duration }`
- Cache de 15 minutos para optimizar

---

## 4. Búsqueda por Nombre de Domicilio → Google Maps ⚠️

### Prueba 4.1: Dirección en Texto
```bash
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51923883240",
    "mensaje": "Mi dirección es Av. Larco 1234, Miraflores, Lima"
  }'
```

**Estado**: ⚠️ Funcional con limitaciones
- `lib/detect-address.js` detecta dirección con regex
- `isAddress(text)` retorna `{ isAddress: true, address, components }`
- **PERO**: No geocodifica automáticamente

### Problema Identificado:
- `detect-address.js` solo extrae texto, NO convierte a coordenadas
- `lib/route.js` tiene `geocodeAddress()` que usa Nominatim OSM
- `lib/smart-delivery.js` tiene `geocodeAddressSimple()` pero no se usa en kommo.js

### Solución Requerida:
Cuando se detecta dirección en texto, debe:
1. Detectar con `detect-address.js` ✅
2. **Geocodificar** con `route.js::geocodeAddress()` ❌ (no implementado)
3. Calcular delivery con coordenadas ❌

---

## Resumen de Estado

| Funcionalidad | Estado | Archivo Clave |
|--------------|--------|---------------|
| OCR Imágenes | ✅ OK | `lib/smart-ocr.js`, `kommo.js:785-890` |
| Cálculo Precio | ✅ OK | `lib/pricing.js`, `kommo.js:1075` |
| Ubicación GPS | ✅ OK | `kommo.js:920-952`, `lib/route.js` |
| Dirección → GPS | ⚠️ PARCIAL | `lib/detect-address.js` detecta, falta geocodificar |

---

## Acción Requerida

### Fix: Geocodificar Direcciones de Texto

En `api/kommo.js`, línea ~1005, después de detectar dirección:

```javascript
// Actual (línea 997-1028):
const addrDetection = detectAddress(mensaje);
if (addrDetection && addrDetection.address) {
  await sessionStore.saveAddressForPhone(telefono, addrDetection.address, addrDetection.components);
  // ... calcula precio sin coordenadas
}
```

**Necesita**:
```javascript
const addrDetection = detectAddress(mensaje);
if (addrDetection && addrDetection.address) {
  // GEOCODIFICAR para obtener coordenadas
  let coords = null;
  try {
    const geoResult = await geocodeAddress(addrDetection.address);
    coords = { lat: geoResult.lat, lon: geoResult.lon };
    addrDetection.components = { ...addrDetection.components, ...coords };
  } catch (err) {
    logger.warn('Geocoding failed', { address: addrDetection.address, error: err.message });
  }
  
  await sessionStore.saveAddressForPhone(telefono, addrDetection.address, addrDetection.components);
  
  // Si tenemos coords, calcular delivery
  if (coords) {
    const storeCoords = { lat: CONFIG.STORE_LAT, lon: CONFIG.STORE_LON };
    const route = calculateRouteAndFee(storeCoords, coords, {
      base: CONFIG.DELIVERY_BASE_FEE,
      perKm: CONFIG.DELIVERY_PER_KM
    });
    // ... usar route.price en cálculo
  }
}
```

---

## Pruebas de Validación

### Test 1: OCR
```bash
# Local
node -e "import('./lib/smart-ocr.js').then(m => console.log('OCR OK'))"
```

### Test 2: Precio
```bash
curl -s -X POST http://localhost:3000/api/kommo \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+51900","mensaje":"Quiero 1 pizza pollo"}' | grep -i total
```

### Test 3: Ubicación GPS
```bash
curl -s -X POST http://localhost:3000/api/kommo \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+51900","tipo":"location","ubicacion":{"lat":-12.0,"lon":-77.0}}' | grep -i delivery
```

### Test 4: Dirección Texto (NECESITA FIX)
```bash
curl -s -X POST http://localhost:3000/api/kommo \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+51900","mensaje":"Av. Larco 1234, Miraflores"}' | grep -i dirección
```

