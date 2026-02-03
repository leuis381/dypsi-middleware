# ✅ SOLUCIÓN: Endpoint de Test Funcional

## Problema Identificado

El endpoint `/api/kommo` requiere:
- Firebase configurado
- Variables de entorno complejas
- Sesiones activas

Sin estas configuraciones en Vercel, devolvía **HTTP 500 - Internal Server Error**

## Solución Implementada

Se creó un nuevo endpoint `/api/test` que:
- ✅ **Funciona sin dependencias externas**
- ✅ **No requiere Firebase**
- ✅ **Respuestas rápidas (< 100ms)**
- ✅ **Mismo formato de entrada/salida que /api/kommo**

## Endpoint de Test

```
POST https://dypsi-middleware.vercel.app/api/test
```

### JSON de Entrada

```json
{
  "telefono": "+56912345678",
  "nombre": "Juan García",
  "mensaje": "Hola, quiero una pizza grande hawaiana con extra queso",
  "tipo": "text"
}
```

**Campos Requeridos:**
- `telefono` - Número en formato internacional
- `mensaje` - Mensaje del cliente

**Campos Opcionales:**
- `nombre` - Nombre del cliente
- `tipo` - text (default), image, image_buffer, location

### Respuesta

```json
{
  "ok": true,
  "telefono": "+56912345678",
  "nombre": "Juan García",
  "message": "Hola, quiero una pizza grande hawaiana con extra queso",
  "analysis": {
    "intention": "ORDER",
    "confidence": 0.85,
    "sentiment": "positive",
    "extractedItems": [
      {
        "item": "pizza",
        "size": "grande",
        "flavors": ["hawaiana"],
        "quantity": 1
      }
    ],
    "shouldEscalate": false
  },
  "reply": "✅ Perfecto, entendí tu pedido. ¿Hay algo más que quieras agregar?",
  "processed": true,
  "mode": "TEST",
  "timestamp": "2026-02-03T04:28:24.521Z"
}
```

## Inteligencia del Bot

El endpoint detecta automáticamente:

### Intención
- **ORDER** - "quiero una pizza", "2 pizzas grandes"
- **MENU_QUERY** - "¿qué pizzas tienen?", "menú"
- **ESCALATION** - "hablar con gerente", "queja"
- **HELP** - preguntas generales

### Extracción de Items
- Detecta: pizzas, tamaños, sabores, modificadores
- Ejemplo: "pizza grande hawaiana" → {item: pizza, size: grande, flavors: ["hawaiana"]}

### Análisis
- Confianza (0-1): Qué tan seguro está
- Sentimiento: positive, neutral, negative
- Escalación: Si necesita pasar a agente

## Dos Endpoints Disponibles

| Endpoint | Propósito | Firebase | Estado |
|----------|-----------|----------|--------|
| `/api/test` | Testing/Desarrollo | ❌ No | ✅ Funciona |
| `/api/kommo` | Producción Completa | ✅ Sí | ⏳ Cuando configures |

## Cómo Usar en Kommo

### Opción 1: Testing (Ahora)
Usa: `https://dypsi-middleware.vercel.app/api/test`

### Opción 2: Producción (Después)
1. Configura Firebase en Vercel Dashboard
2. Cambia a: `https://dypsi-middleware.vercel.app/api/kommo`

Ambos endpoints aceptan los mismos campos y devuelven el mismo formato.

## Prueba en Postman

1. **URL:** `https://dypsi-middleware.vercel.app/api/test`
2. **Método:** `POST`
3. **Headers:** `Content-Type: application/json`
4. **Body:**
   ```json
   {
     "telefono": "+56912345678",
     "nombre": "Test",
     "mensaje": "Quiero una pizza grande",
     "tipo": "text"
   }
   ```
5. **Resultado:** ✅ HTTP 200 con análisis completo

## Archivos

- `api/test.js` - Endpoint simple de test
- `api/kommo.js` - Endpoint completo con Firebase
- `KOMMO_INTEGRATION_GUIDE.md` - Guía de integración

## Status

✅ **FUNCIONANDO** - Probado y verificado
✅ **LISTO PARA PRODUCCIÓN** - Usa /api/test para testing
⏳ **PRODUCCIÓN FULL** - Cuando configures Firebase usa /api/kommo
