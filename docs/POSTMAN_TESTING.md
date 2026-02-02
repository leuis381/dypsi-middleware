# 🚀 Guía de Testing en Postman - DYPSI Middleware

> **Middleware**: Cerebro IA para Kommo BOT  
> **Deploy**: Vercel  
> **Tipo de aplicación**: REST API para procesamiento de pedidos, OCR y chat conversacional

---

## 📋 Resumen de Endpoints

El middleware expone un **único endpoint principal** (compatible con Vercel):

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| **GET** | `/api/kommo` | Health check - Verifica que el servicio esté activo |
| **POST** | `/api/kommo` | Handler principal - Procesa mensajes de texto, imágenes y ubicaciones |
| **OPTIONS** | `/api/kommo` | CORS preflight |

---

## 🔌 Endpoint Principal: POST `/api/kommo`

### Estructura del Request

```json
{
  "nombre": "string (opcional, default: 'Cliente')",
  "telefono": "string (requerido, ej: +51999888777)",
  "mensaje": "string (el input del usuario)",
  "tipo": "text | image | image_buffer | location (default: text)",
  "imagen": "string (URL de imagen si tipo=image)",
  "imageBase64": "string (base64 si tipo=image_buffer)",
  "ubicacion": { "lat": number, "lon": number } (si tipo=location),
  "debug": "boolean (para logs detallados)"
}
```

### Respuestas Esperadas

Todas las respuestas están en formato JSON:

```json
{
  "ok": true | false,
  "reply": "string (respuesta para el usuario)",
  "estado": "string (estado actual de la sesión, opcional)",
  "pedido": "object (draft del pedido, opcional)"
}
```

---

## 📝 Casos de Testing

### 1️⃣ Health Check

**Método**: `GET`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Response** (200 OK):
```json
{
  "ok": true,
  "service": "KOMMO IA",
  "status": "running",
  "env": {
    "firebase": true
  }
}
```

---

### 2️⃣ Mensaje Simple - Saludo

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "nombre": "Juan",
  "telefono": "+51999888777",
  "mensaje": "Hola",
  "tipo": "text"
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "Hola 👋 Escríbenos tu pedido o escribe *menu*. Si necesitas ayuda, escribe 'ayuda'."
}
```

---

### 3️⃣ Solicitar el Menú

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "mensaje": "menu",
  "tipo": "text"
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "🍽️ **MENÚ DISPONIBLE:**\n\n📍 **Secciones:**\n• Pizzas\n• Bebidas\n• Postres\n...\n\n¿Qué deseas pedir? Responde con el nombre o ID del producto."
}
```

---

### 4️⃣ Realizar un Pedido - Texto

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "mensaje": "2 pizzas hawaiana, 1 coca cola grande",
  "tipo": "text"
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "🧾 Resumen del pedido:\n• 2 x Pizzas Hawaiana — S/45.00 — S/90.00\n• 1 x Coca Cola Grande — S/5.50 — S/5.50\n\nSubtotal: S/95.50\nEntrega: S/3.00\nTotal a cobrar: **S/98.50**\n\n¿Deseas confirmarlo? Responde SI o *cancelar*."
}
```

---

### 5️⃣ Confirmar Pedido

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "mensaje": "si, confirmar",
  "tipo": "text"
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "✅ Pedido confirmado. Total: S/98.50.\n\n📍 Necesito tu dirección para confirmar la entrega. ¿Cuál es tu dirección?"
}
```

---

### 6️⃣ Enviar Ubicación (GPS)

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "tipo": "location",
  "ubicacion": {
    "lat": -12.0464,
    "lon": -77.0428
  }
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "📍 Ubicación recibida: Av. Pardo 123, Miraflores, Lima\n\n✅ Pedido confirmado y enviado a cocina. Tiempo estimado: 35-40 minutos.\nNúmero de pedido: #2024001"
}
```

---

### 7️⃣ Enviar Comprobante de Pago (Imagen URL)

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "tipo": "image",
  "imagen": "https://example.com/comprobante.jpg"
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "✅ Pago validado por S/98.50. Tu pedido está confirmado y en preparación."
}
```

O si hay discrepancia:
```json
{
  "reply": "⚠️ Detecté S/100.00 en el comprobante. No coincide exactamente con el total del pedido (S/98.50). ¿Deseas que lo revise un agente o prefieres enviar el monto manualmente?"
}
```

---

### 8️⃣ Comprobante como Base64

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "tipo": "image_buffer",
  "imageBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "✅ Comprobante detectado por S/98.50. ¿Deseas que lo valide con tu pedido?"
}
```

---

### 9️⃣ Consultar Estado del Pedido

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "mensaje": "¿dónde está mi pedido?",
  "tipo": "text"
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "Tu pedido está en reparto. Repartidor: Carlos Mendoza Tel: +51987654321"
}
```

---

### 🔟 Solicitar Ayuda

**Método**: `POST`  
**URL**: `https://tu-vercel-url.vercel.app/api/kommo`

**Body**:
```json
{
  "telefono": "+51999888777",
  "mensaje": "ayuda",
  "tipo": "text"
}
```

**Response Esperada** (200 OK):
```json
{
  "reply": "📞 **AYUDA DISPONIBLE:**\n\n• *menu* - Ver catálogo\n• *estado* - Ver tu pedido\n• *cancelar* - Cancelar pedido\n• *contacto* - Hablar con un agente\n\n¿En qué te ayudamos?"
}
```

---

## 🌍 Flujos Completos de Testing

### Flujo A: Pedido Simple (sin verificación de pago)

```
1. GET /api/kommo                          → Health check
2. POST con "hola"                         → Saludo
3. POST con "2 pizzas hawaiana"            → Resumen + espera confirmación
4. POST con "si"                           → Pide dirección
5. POST con ubicación (location)           → Confirma pedido
```

### Flujo B: Pedido con Validación de Pago

```
1. Realizar pedido (pasos 1-4 de Flujo A)
2. POST con imagen del comprobante        → Valida pago contra OCR
3. Si coincide: Pedido confirmado
   Si no coincide: Pide revisión humana
```

### Flujo C: Consultas Posteriores

```
1. POST con "estado" o "dónde está"        → Devuelve estado del pedido
2. POST con "cancelar"                     → Inicia cancelación
3. POST con números/IDs                    → Procesa números como ID de pedido
```

---

## 🛠️ Errores y Respuestas de Error

### Error 400 - Teléfono No Proporcionado

**Request**:
```json
{
  "mensaje": "hola"
}
```

**Response** (400 Bad Request):
```json
{
  "ok": false,
  "reply": "❌ No se pudo identificar el cliente."
}
```

### Error 405 - Método No Permitido

**Request**: `DELETE /api/kommo`

**Response** (405 Method Not Allowed):
```json
{
  "ok": false,
  "error": "Method Not Allowed"
}
```

### Error 500 - Error Interno

**Response** (500 Internal Server Error):
```json
{
  "reply": "⚠️ Ocurrió un error. Un asesor humano continuará."
}
```

---

## 📊 Variables de Entorno Necesarias en Vercel

Para que el middleware funcione completamente, necesitas configurar:

```bash
# Firebase
FIREBASE_PROJECT_ID=tu-proyecto
FIREBASE_CLIENT_EMAIL=tu-email@firebase.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----

# Webhooks (opcional)
AGENT_WEBHOOK=https://tu-webhook.com/notifications

# OCR y Validación
PAYMENT_TOLERANCE=0.06  # Tolerancia de pago ±6%
NODE_ENV=production
```

---

## 🧪 Variables de Testing en Postman

Crea estas variables en tu colección de Postman:

```javascript
{
  "base_url": "https://tu-vercel-url.vercel.app",
  "telefono": "+51999888777",
  "nombre": "Juan",
  "imagen_url": "https://example.com/comprobante.jpg"
}
```

Y úsalas así:

```
POST {{base_url}}/api/kommo
Body: {
  "telefono": "{{telefono}}",
  "nombre": "{{nombre}}",
  ...
}
```

---

## ✅ Checklist de Testing

- [ ] GET `/api/kommo` retorna 200 con status "running"
- [ ] POST sin teléfono retorna error 400
- [ ] POST con "menu" devuelve catálogo
- [ ] POST con orden simple devuelve resumen
- [ ] POST con "si" confirma pedido y pide dirección
- [ ] POST con ubicación confirma entrega
- [ ] POST con imagen procesa OCR
- [ ] POST con "estado" devuelve estado actual
- [ ] POST con "ayuda" devuelve opciones
- [ ] Sesiones persisten entre requests (mismo teléfono)
- [ ] Respuestas son siempre JSON válido
- [ ] Tiempos de respuesta < 5 segundos

---

## 📌 Notas Importantes

1. **Persistencia de Sesiones**: El middleware mantiene sesiones por teléfono. Usa el mismo `telefono` en múltiples requests para simular una conversación.

2. **OCR**: Solo funciona si Firebase está configurado y si la imagen contiene números de monto detectables.

3. **Pricing**: Los precios se calculan según el archivo `data/zonas-precio.json` y las reglas en `data/reglas.json`.

4. **Debug Mode**: Añade `"debug": true` en el request para obtener logs más detallados (solo visible si hay terminal abierta).

5. **Timeout de Vercel**: Vercel tiene un límite de 60 segundos. Asegúrate de que OCR y Firebase no excedan este tiempo.

---

**¿Listo para probar? 🚀 Abre Postman y comienza con el health check.**
