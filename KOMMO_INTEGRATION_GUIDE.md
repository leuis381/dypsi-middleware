# 🚀 DYPSI Middleware - Configuración para Kommo/IA Bot

## ✅ Tu Deployment en Vercel

**URL Base:** `https://dypsi-middleware.vercel.app/`

---

## 🔗 Endpoint para Kommo / IA

El endpoint principal que le pasarás a la IA para crear el bot es:

```
https://dypsi-middleware.vercel.app/api/kommo
```

### Detalles del Endpoint

| Propiedad | Valor |
|-----------|-------|
| **URL** | `https://dypsi-middleware.vercel.app/api/kommo` |
| **Método** | `POST` |
| **Content-Type** | `application/json` |
| **Autenticación** | Por webhook (Kommo maneja) |
| **Timeout** | 30 segundos |

---

## 📝 JSON de Prueba para Postman

### Test 1: Pedido Simple de Pizza

```json
{
  "userId": "user_12345",
  "phone": "+56912345678",
  "message": "Hola, quiero una pizza grande hawaiana con extra queso",
  "userName": "Juan García",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Respuesta Esperada (HTTP 200):**
```json
{
  "ok": true,
  "userId": "user_12345",
  "message": "Hola, quiero una pizza grande hawaiana con extra queso",
  "analysis": {
    "intention": "ORDER",
    "confidence": 0.95,
    "sentiment": "positive",
    "extractedItems": [
      {
        "item": "pizza",
        "size": "grande",
        "flavors": ["hawaiana"],
        "modifiers": ["extra queso"],
        "quantity": 1
      }
    ],
    "totalEstimated": null,
    "shouldEscalate": false
  },
  "processed": true,
  "session": {
    "conversationId": "conv_xxxxx",
    "messagesCount": 1,
    "state": "ORDER_IN_PROGRESS"
  }
}
```

---

### Test 2: Consulta de Menú

```json
{
  "userId": "user_67890",
  "phone": "+56987654321",
  "message": "¿Qué pizzas tienen?",
  "userName": "María López",
  "timestamp": "2024-01-15T10:35:00Z"
}
```

**Respuesta Esperada (HTTP 200):**
```json
{
  "ok": true,
  "userId": "user_67890",
  "message": "¿Qué pizzas tienen?",
  "analysis": {
    "intention": "MENU_QUERY",
    "confidence": 0.92,
    "sentiment": "neutral",
    "menuCategory": "pizzas",
    "shouldEscalate": false
  },
  "reply": "Contamos con las siguientes pizzas:\n\n🍕 **Margarita** - $12.99\n🍕 **Pepperoni** - $14.99\n🍕 **Hawaiana** - $15.99\n🍕 **Cuatro Quesos** - $16.99\n🍕 **Especial de la Casa** - $18.99",
  "processed": true
}
```

---

### Test 3: Pedido con Ubicación

```json
{
  "userId": "user_54321",
  "phone": "+56988776655",
  "message": "Una pizza mediana vegetariana, enviar a Av. Principal 456",
  "location": "-33.8688,-51.2093",
  "userName": "Carlos Ruiz",
  "timestamp": "2024-01-15T10:40:00Z"
}
```

**Respuesta Esperada (HTTP 200):**
```json
{
  "ok": true,
  "userId": "user_54321",
  "message": "Una pizza mediana vegetariana, enviar a Av. Principal 456",
  "analysis": {
    "intention": "ORDER",
    "confidence": 0.94,
    "sentiment": "positive",
    "extractedItems": [
      {
        "item": "pizza",
        "size": "mediana",
        "type": "vegetariana",
        "quantity": 1
      }
    ],
    "deliveryLocation": "Av. Principal 456",
    "coordinates": {
      "lat": -33.8688,
      "lon": -51.2093
    },
    "estimatedDeliveryTime": "25-30 minutos",
    "deliveryFee": "$2.50",
    "shouldEscalate": false
  },
  "processed": true,
  "order": {
    "id": "ORD-2024-0001",
    "status": "PENDING_CONFIRMATION",
    "estimatedTotal": "$15.99"
  }
}
```

---

### Test 4: Typo / Ortografía Mala (La IA entiende)

```json
{
  "userId": "user_99999",
  "phone": "+56911223344",
  "message": "kiero dos pizzas peperoni, la mitad sin cebolla y con mucho ajo",
  "userName": "Cliente Test",
  "timestamp": "2024-01-15T10:45:00Z"
}
```

**Respuesta Esperada (HTTP 200):**
```json
{
  "ok": true,
  "userId": "user_99999",
  "message": "kiero dos pizzas peperoni, la mitad sin cebolla y con mucho ajo",
  "analysis": {
    "intention": "ORDER",
    "confidence": 0.91,
    "sentiment": "positive",
    "correctedText": "Quiero dos pizzas pepperoni, la mitad sin cebolla y con mucho ajo",
    "extractedItems": [
      {
        "item": "pizza",
        "flavor": "pepperoni",
        "quantity": 2,
        "modifiers": ["sin cebolla", "extra ajo"]
      }
    ],
    "shouldEscalate": false,
    "typosDetected": 2,
    "correctionApplied": true
  },
  "reply": "Perfecto, entendí que quieres 2 pizzas pepperoni. Una mitad sin cebolla y con extra ajo. ¿Qué tamaño prefieres?",
  "processed": true
}
```

---

### Test 5: Escalación a Agente

```json
{
  "userId": "user_escalate",
  "phone": "+56922334455",
  "message": "Necesito hablar con un gerente, tengo una queja sobre mi pedido anterior",
  "userName": "Cliente Enojado",
  "timestamp": "2024-01-15T10:50:00Z"
}
```

**Respuesta Esperada (HTTP 200):**
```json
{
  "ok": true,
  "userId": "user_escalate",
  "message": "Necesito hablar con un gerente, tengo una queja sobre mi pedido anterior",
  "analysis": {
    "intention": "ESCALATION",
    "confidence": 0.96,
    "sentiment": "negative",
    "escalationReason": "complaint",
    "priority": "high",
    "shouldEscalate": true
  },
  "reply": "Entendido, te voy a conectar con un agente especializado de nuestro equipo. Por favor espera un momento.",
  "escalation": {
    "triggered": true,
    "reason": "CUSTOMER_COMPLAINT",
    "priority": "HIGH",
    "assignedTo": "team@kommo",
    "notes": "Cliente quejoso - pedido anterior con problema"
  },
  "processed": true
}
```

---

## 🧪 Pruebas en Postman

### Configuración Básica

1. **Crear Nueva Request**
   - Método: `POST`
   - URL: `https://dypsi-middleware.vercel.app/api/kommo`

2. **Headers**
   ```
   Content-Type: application/json
   ```

3. **Body** (raw JSON)
   - Copiar uno de los JSONs de prueba arriba

4. **Enviar** y ver la respuesta

### Scripts de Prueba Rápida

**Script de Pre-request (opcional):**
```javascript
pm.environment.set("base_url", "https://dypsi-middleware.vercel.app");
pm.environment.set("timestamp", new Date().toISOString());
```

**Script de Test (opcional):**
```javascript
pm.test("Status 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has ok field", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.ok).to.be.true;
});

pm.test("Response has analysis", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.analysis).to.exist;
});
```

---

## 🔐 Configuración en Kommo

### En el CRM Kommo:

1. **Ir a:** Configuración → Integraciones → Webhooks
2. **URL del Webhook:**
   ```
   https://dypsi-middleware.vercel.app/api/kommo
   ```

3. **Eventos a Disparar:**
   - Mensajes entrantes de clientes
   - Consultas de menú
   - Nuevos pedidos

4. **Headers Recomendados:**
   ```
   Content-Type: application/json
   Authorization: Bearer YOUR_TOKEN (si lo necesitas)
   ```

5. **Payload que Kommo enviará:**
   ```json
   {
     "userId": "kommo_user_id",
     "phone": "+56912345678",
     "message": "Mensaje del cliente",
     "userName": "Nombre Cliente",
     "timestamp": "ISO_STRING"
   }
   ```

---

## 📊 Campos Disponibles en Request

| Campo | Tipo | Requerido | Ejemplo |
|-------|------|-----------|---------|
| `userId` | String | ✅ | `"user_123"` |
| `phone` | String | ✅ | `"+56912345678"` |
| `message` | String | ✅ | `"Quiero una pizza"` |
| `userName` | String | ❌ | `"Juan García"` |
| `location` | String | ❌ | `"-33.8688,-51.2093"` |
| `timestamp` | String | ❌ | ISO 8601 |
| `imageUrl` | String | ❌ | URL de imagen |
| `imageBase64` | String | ❌ | Base64 de imagen |

---

## 🎯 Campos en Response

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `ok` | Boolean | Éxito de la operación |
| `userId` | String | ID del usuario |
| `message` | String | Mensaje original |
| `analysis` | Object | Análisis de IA |
| `reply` | String | Respuesta automática |
| `processed` | Boolean | Si fue procesado |
| `escalation` | Object | Info si se escaló |
| `order` | Object | Info de pedido si aplica |
| `session` | Object | Info de sesión |

---

## ✨ Ejemplo Completo en cURL

```bash
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_12345",
    "phone": "+56912345678",
    "message": "Hola, quiero una pizza grande hawaiana con extra queso",
    "userName": "Juan García",
    "timestamp": "2024-01-15T10:30:00Z"
  }'
```

---

## 🚨 Códigos de Error Esperados

| Código | Razón | Solución |
|--------|-------|----------|
| 200 | ✅ Éxito | Normal |
| 400 | Validación fallida | Revisar JSON, campos requeridos |
| 401 | No autorizado | Verificar credenciales |
| 422 | Datos inválidos | Formato incorrecto |
| 429 | Rate limit | Esperar 60 segundos |
| 500 | Error servidor | Contactar soporte |

---

## 💡 Tips Importantes

✅ **Siempre incluir:**
- `userId` (identificador único del cliente)
- `phone` (número de teléfono)
- `message` (el mensaje del cliente)

✅ **Manejo de Errores:**
- La IA entiende typos y ortografía mala
- Detecta automáticamente intención (ORDER, MENU_QUERY, ESCALATION, etc.)
- Escala a agentes cuando es necesario

✅ **Performance:**
- Respuesta típica: < 500ms
- Soporta múltiples idiomas
- OCR integrado para facturas/recibos

---

## 📞 Soporte

**API Status:** ✅ Online  
**Última Actualización:** 2024  
**Versión:** v4.0 ULTRA+

Para más detalles, ver documentación completa en el repositorio.
