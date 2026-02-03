# 📮 Ejemplos para Postman - DYPSI Middleware

## URL Base
```
https://dypsi-middleware.vercel.app/api/kommo
```

---

## 1️⃣ Saludo / Mensaje Simple

**POST** `https://dypsi-middleware.vercel.app/api/kommo`

```json
{
  "telefono": "+51923883240",
  "nombre": "Juan Pérez",
  "mensaje": "Hola!",
  "tipo": "text"
}
```

**Respuesta**:
```json
{
  "ok": true,
  "reply": "¡Bienvenid@ de vuelta! ¿Qué te preparamos?"
}
```

---

## 2️⃣ Consultar Menú / Carta

**POST** `https://dypsi-middleware.vercel.app/api/kommo`

```json
{
  "telefono": "+51923883240",
  "nombre": "María García",
  "mensaje": "Muéstrame la carta",
  "tipo": "text"
}
```

**Respuesta**:
```json
{
  "ok": true,
  "reply": "Aquí tienes la carta:\n• Entradas (10 items)\n• Pizzas (20 items)..."
}
```

---

## 3️⃣ Hacer un Pedido

**POST** `https://dypsi-middleware.vercel.app/api/kommo`

```json
{
  "telefono": "+51923883240",
  "nombre": "Carlos López",
  "mensaje": "Quiero 2 pizzas grandes de pollo",
  "tipo": "text"
}
```

**Respuesta**:
```json
{
  "ok": true,
  "reply": "✅ Pedido recibido: 2x Pizza Pollo.\n📍 ¿Delivery o recojo?"
}
```

---

## 4️⃣ Enviar Dirección → Geocodificación Automática ⭐

**POST** `https://dypsi-middleware.vercel.app/api/kommo`

```json
{
  "telefono": "+51923883240",
  "nombre": "Ana Torres",
  "mensaje": "Av. Larco 1234, Miraflores",
  "tipo": "text"
}
```

**Respuesta**:
```json
{
  "ok": true,
  "reply": "📍 Dirección detectada: av. larco, Nro. 1234, miraflores\n🚚 Delivery estimado: S/8.00 (11.6 km)"
}
```

---

## 5️⃣ Enviar Ubicación GPS ⭐

**POST** `https://dypsi-middleware.vercel.app/api/kommo`

```json
{
  "telefono": "+51923883240",
  "nombre": "Pedro Ramírez",
  "tipo": "location",
  "ubicacion": {
    "lat": -12.0464,
    "lon": -77.0428
  }
}
```

**Respuesta**:
```json
{
  "ok": true,
  "reply": "📍 Delivery calculado: S/5.00 (distancia 3.2 km)..."
}
```

---

## 6️⃣ Health Check (GET)

**GET** `https://dypsi-middleware.vercel.app/api/kommo`

**Respuesta**:
```json
{
  "ok": true,
  "status": "running",
  "version": "2.0-ultra-inteligente",
  "features": ["ai-engine", "smart-ocr", "user-profiles"]
}
```

---

## 📦 Colección Postman (JSON)

Copia y pega esto en Postman → Import → Raw text:

```json
{
  "info": {
    "name": "DYPSI API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Saludo",
      "request": {
        "method": "POST",
        "header": [{"key": "Content-Type", "value": "application/json"}],
        "body": {
          "mode": "raw",
          "raw": "{\"telefono\":\"+51923883240\",\"nombre\":\"Test\",\"mensaje\":\"Hola\",\"tipo\":\"text\"}"
        },
        "url": "https://dypsi-middleware.vercel.app/api/kommo"
      }
    },
    {
      "name": "Consultar Menú",
      "request": {
        "method": "POST",
        "header": [{"key": "Content-Type", "value": "application/json"}],
        "body": {
          "mode": "raw",
          "raw": "{\"telefono\":\"+51923883240\",\"nombre\":\"Test\",\"mensaje\":\"Muéstrame la carta\",\"tipo\":\"text\"}"
        },
        "url": "https://dypsi-middleware.vercel.app/api/kommo"
      }
    },
    {
      "name": "Dirección Geocodificada",
      "request": {
        "method": "POST",
        "header": [{"key": "Content-Type", "value": "application/json"}],
        "body": {
          "mode": "raw",
          "raw": "{\"telefono\":\"+51923883240\",\"nombre\":\"Test\",\"mensaje\":\"Av. Arequipa 2080, Lince\",\"tipo\":\"text\"}"
        },
        "url": "https://dypsi-middleware.vercel.app/api/kommo"
      }
    },
    {
      "name": "Ubicación GPS",
      "request": {
        "method": "POST",
        "header": [{"key": "Content-Type", "value": "application/json"}],
        "body": {
          "mode": "raw",
          "raw": "{\"telefono\":\"+51923883240\",\"tipo\":\"location\",\"ubicacion\":{\"lat\":-12.08,\"lon\":-77.05}}"
        },
        "url": "https://dypsi-middleware.vercel.app/api/kommo"
      }
    }
  ]
}
```

---

## 🎯 Más Ejemplos

### Diferentes Direcciones para Probar:
- `"Av. Arequipa 2080, Lince"` → 6.1 km → S/8.00
- `"Av. Larco 1234, Miraflores"` → 11.6 km → S/8.00
- `"Av. Javier Prado 2390, San Isidro"` → ~5 km → S/7.00

### Coordenadas GPS para Probar:
- Centro de Lima: `{"lat": -12.046374, "lon": -77.042793}`
- Miraflores: `{"lat": -12.12, "lon": -77.03}`
- San Isidro: `{"lat": -12.08, "lon": -77.05}`

---

✅ **Listo para probar en Postman!**
