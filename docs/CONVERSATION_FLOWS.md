# 📱 Flujos Conversacionales - DYPSI Middleware

Este documento muestra ejemplos reales de conversaciones completas con el middleware.

---

## Flujo 1: Pedido Completo (Texto + Ubicación)

### Conversación

```
Usuario: Hola
Bot: Hola 👋 Escríbenos tu pedido o escribe *menu*. Si necesitas ayuda, escribe 'ayuda'.

Usuario: Menu
Bot: 🍽️ **MENÚ DISPONIBLE:**

📍 **Secciones:**
• Pizzas (Hawaiana $45, Pepperoni $42, Margarita $38)
• Bebidas (Coca Cola Grande $5.50, Agua $1.50)
• Postres (Helado $4.00, Brownie $5.00)

¿Qué deseas pedir? Responde con el nombre o ID del producto.

Usuario: 2 pizzas hawaiana, 1 coca cola grande
Bot: 🧾 Resumen del pedido:
• 2 x Pizzas Hawaiana — S/45.00 — S/90.00
• 1 x Coca Cola Grande — S/5.50 — S/5.50

Subtotal: S/95.50
Delivery: S/3.00
Total a cobrar: **S/98.50**

¿Deseas confirmarlo? Responde SI o *cancelar*.

Usuario: si, confirmar
Bot: ✅ Pedido confirmado. Total: S/98.50.

📍 Necesito tu dirección para confirmar la entrega. ¿Cuál es tu dirección?

Usuario: [Envía ubicación GPS: -12.0464, -77.0428]
Bot: 📍 Ubicación recibida: Av. Pardo 123, Miraflores, Lima

✅ Pedido confirmado y enviado a cocina. Tiempo estimado: 35-40 minutos.
Número de pedido: #2024001
```

### Requests en Postman

#### Request 1: Saludo
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "Hola",
  "tipo": "text"
}
```

**Response**:
```json
{
  "reply": "Hola 👋 Escríbenos tu pedido o escribe *menu*. Si necesitas ayuda, escribe 'ayuda'."
}
```

#### Request 2: Menú
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "menu",
  "tipo": "text"
}
```

**Response**:
```json
{
  "reply": "🍽️ **MENÚ DISPONIBLE:**\n\n📍 **Secciones:**\n• Pizzas (Hawaiana $45, Pepperoni $42, Margarita $38)\n• Bebidas (Coca Cola Grande $5.50, Agua $1.50)\n• Postres (Helado $4.00, Brownie $5.00)\n\n¿Qué deseas pedir? Responde con el nombre o ID del producto."
}
```

#### Request 3: Realizar Pedido
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "2 pizzas hawaiana, 1 coca cola grande",
  "tipo": "text"
}
```

**Response**:
```json
{
  "reply": "🧾 Resumen del pedido:\n• 2 x Pizzas Hawaiana — S/45.00 — S/90.00\n• 1 x Coca Cola Grande — S/5.50 — S/5.50\n\nSubtotal: S/95.50\nDelivery: S/3.00\nTotal a cobrar: **S/98.50**\n\n¿Deseas confirmarlo? Responde SI o *cancelar*."
}
```

#### Request 4: Confirmar Pedido
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "si, confirmar",
  "tipo": "text"
}
```

**Response**:
```json
{
  "reply": "✅ Pedido confirmado. Total: S/98.50.\n\n📍 Necesito tu dirección para confirmar la entrega. ¿Cuál es tu dirección?"
}
```

#### Request 5: Enviar Ubicación
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "tipo": "location",
  "ubicacion": {
    "lat": -12.0464,
    "lon": -77.0428
  }
}
```

**Response**:
```json
{
  "reply": "📍 Ubicación recibida: Av. Pardo 123, Miraflores, Lima\n\n✅ Pedido confirmado y enviado a cocina. Tiempo estimado: 35-40 minutos.\nNúmero de pedido: #2024001"
}
```

---

## Flujo 2: Verificación de Pago (Con OCR)

### Conversación

```
Usuario: [Envía comprobante de pago como imagen]
Bot: ✅ Pago validado por S/98.50. Tu pedido está confirmado y en preparación.

Usuario: ¿dónde está mi pedido?
Bot: Tu pedido está en reparto. Repartidor: Carlos Mendoza Tel: +51987654321

Usuario: Gracias!
Bot: De nada 😊 Esperamos tu siguiente pedido. ¡Gracias por confiar en nosotros!
```

### Requests en Postman

#### Request 1: Enviar Comprobante (URL)
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "tipo": "image",
  "imagen": "https://example.com/comprobante.jpg"
}
```

**Response** (Pago Válido):
```json
{
  "reply": "✅ Pago validado por S/98.50. Tu pedido está confirmado y en preparación."
}
```

**Response** (Pago con Discrepancia):
```json
{
  "reply": "⚠️ Detecté S/100.00 en el comprobante. No coincide exactamente con el total del pedido (S/98.50). ¿Deseas que lo revise un agente o prefieres enviar el monto manualmente?"
}
```

#### Request 2: Estado del Pedido
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "¿dónde está mi pedido?",
  "tipo": "text"
}
```

**Response** (Pedido en Reparto):
```json
{
  "reply": "Tu pedido está en reparto. Repartidor: Carlos Mendoza Tel: +51987654321"
}
```

---

## Flujo 3: Gestión de Errores

### Conversación

```
Usuario: [Envía request sin teléfono]
Bot: ❌ No se pudo identificar el cliente.

Usuario: [Envía DELETE request]
Bot: ❌ Método no permitido

Usuario: [Envía imagen poco clara]
Bot: 📸 No pude procesar la imagen. Intenta enviar una foto más clara o escribe el monto manualmente.
```

### Requests en Postman

#### Request 1: Sin Teléfono
```json
POST /api/kommo
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

#### Request 2: Método No Permitido
```
DELETE /api/kommo
```

**Response** (405 Method Not Allowed):
```json
{
  "ok": false,
  "error": "Method Not Allowed"
}
```

#### Request 3: OCR Fallido
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "tipo": "image",
  "imagen": "https://example.com/imagen-sin-texto.jpg"
}
```

**Response**:
```json
{
  "reply": "📸 No pude procesar la imagen. Intenta enviar una foto más clara o escribe el monto manualmente."
}
```

---

## Flujo 4: Búsqueda y Modificación de Pedido

### Conversación

```
Usuario: ¿tienen pizzas vegetarianas?
Bot: Parece que buscas en el catálogo. Coincidencias:
• Pizza Margarita — S/38.00 (score 0.85)
• Pizza Especial Verduras — S/42.00 (score 0.78)

¿Quieres agregar alguna al pedido? Responde con el id o nombre.

Usuario: quiero cambiar mi pedido a 3 pizzas margarita
Bot: 🧾 Resumen del pedido actualizado:
• 3 x Pizzas Margarita — S/38.00 — S/114.00

Subtotal: S/114.00
Delivery: S/3.00
Total a cobrar: **S/117.00**

¿Deseas confirmarlo? Responde SI o *cancelar*.
```

### Requests en Postman

#### Request 1: Búsqueda
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "¿tienen pizzas vegetarianas?",
  "tipo": "text"
}
```

**Response**:
```json
{
  "reply": "Parece que buscas en el catálogo. Coincidencias:\n• Pizza Margarita — S/38.00 (score 0.85)\n• Pizza Especial Verduras — S/42.00 (score 0.78)\n\n¿Quieres agregar alguna al pedido? Responde con el id o nombre."
}
```

#### Request 2: Modificar Pedido
```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "quiero cambiar mi pedido a 3 pizzas margarita",
  "tipo": "text"
}
```

**Response**:
```json
{
  "reply": "🧾 Resumen del pedido actualizado:\n• 3 x Pizzas Margarita — S/38.00 — S/114.00\n\nSubtotal: S/114.00\nDelivery: S/3.00\nTotal a cobrar: **S/117.00**\n\n¿Deseas confirmarlo? Responde SI o *cancelar*."
}
```

---

## Estados Internos del Middleware

El middleware mantiene un estado por teléfono. Los estados posibles son:

| Estado | Descripción | Siguiente Paso |
|--------|-------------|----------------|
| `inicio` | Sin pedido activo | Espera input del usuario |
| `pedido_borrador` | Pedido creado pero no confirmado | Confirmar (SI) o cancelar |
| `pedido_confirmado` | Pedido confirmado, espera dirección | Enviar ubicación |
| `pago_verificacion` | Esperando verificación de pago | Enviar comprobante |
| `pagado` | Pago validado | Pedido en preparación |
| `preparacion` | En cocina | Seguimiento |
| `en_reparto` | En reparto | Seguimiento |
| `entregado` | Pedido entregado | Fin |
| `cancelado` | Pedido cancelado | Nuevo pedido |

---

## Testing Checklist

Usa esta checklist para verificar que todo funciona:

- [ ] **Health Check**: `GET /api/kommo` retorna `"status": "running"`
- [ ] **Saludo**: Primer mensaje devuelve menú o bienvenida
- [ ] **Menú**: Comando "menu" devuelve catálogo completo
- [ ] **Parseo**: Entiende órdenes complejas (ej: "2 pizzas hawaiana, 1 coca cola")
- [ ] **Resumen**: Calcula precios y delivery correctamente
- [ ] **Confirmación**: "SI" confirma el pedido
- [ ] **Ubicación**: GPS es convertido a dirección
- [ ] **OCR**: Imagen se procesa y extrae monto
- [ ] **Validación de Pago**: Comprobante se valida vs pedido
- [ ] **Estado**: Consulta de estado devuelve información actual
- [ ] **Errores**: Sin teléfono retorna error 400
- [ ] **Métodos**: DELETE retorna 405
- [ ] **Sessions**: Mismo teléfono mantiene contexto entre requests
- [ ] **Timeout**: Respuestas < 5 segundos

---

## Debug Mode

Para obtener logs más detallados, añade `"debug": true`:

```json
POST /api/kommo
{
  "telefono": "+51999888777",
  "mensaje": "2 pizzas",
  "tipo": "text",
  "debug": true
}
```

El servidor loguea:
- Entrada y parsing de mensaje
- Detección de intención
- Items encontrados
- Cálculo de precios
- Errores de procesamiento

(Los logs se ven en `npm run dev` o en Vercel Function Logs)

---

**¡Listo! Ahora puedes testear el middleware en Postman. Usa la colección JSON provided.**
