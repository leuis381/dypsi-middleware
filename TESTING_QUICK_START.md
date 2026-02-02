# 🎯 Guía Rápida - Testing en Postman

**¿Qué es?** El middleware DYPSI es el "cerebro" de tu bot Kommo. Procesa pedidos, valida pagos y gestiona conversaciones.

**¿Dónde está?** En Vercel: `https://tu-proyecto.vercel.app/api/kommo`

---

## ⚡ Quick Start (2 minutos)

### 1. Abre Postman

### 2. Crear un Health Check

```
GET https://tu-proyecto.vercel.app/api/kommo
```

**Resultado esperado:**
```json
{
  "ok": true,
  "service": "KOMMO IA",
  "status": "running"
}
```

Si ves esto → ✅ El middleware está vivo y funcionando

---

### 3. Enviar tu Primer Mensaje

```
POST https://tu-proyecto.vercel.app/api/kommo
Content-Type: application/json

{
  "telefono": "+51999888777",
  "mensaje": "hola",
  "tipo": "text"
}
```

**Resultado esperado:**
```json
{
  "reply": "Hola 👋 Escríbenos tu pedido o escribe *menu*. Si necesitas ayuda, escribe 'ayuda'."
}
```

Si ves esto → ✅ La conversación está funcionando

---

## 📋 Flujo Típico de Prueba

Copia y pega estos requests en orden (usa el mismo teléfono en todos):

### Step 1: Saludo
```json
{
  "telefono": "+51999888777",
  "mensaje": "hola",
  "tipo": "text"
}
```

### Step 2: Ver Menú
```json
{
  "telefono": "+51999888777",
  "mensaje": "menu",
  "tipo": "text"
}
```

### Step 3: Hacer Pedido
```json
{
  "telefono": "+51999888777",
  "mensaje": "2 pizzas hawaiana, 1 coca cola",
  "tipo": "text"
}
```

### Step 4: Confirmar
```json
{
  "telefono": "+51999888777",
  "mensaje": "si",
  "tipo": "text"
}
```

### Step 5: Enviar Ubicación
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

---

## 📱 Tipos de Mensajes Soportados

| Tipo | Ejemplo | Para Qué |
|------|---------|----------|
| `text` | "2 pizzas" | Pedidos, preguntas, comandos |
| `location` | `{lat, lon}` | Envirar dirección por GPS |
| `image` | URL de imagen | Comprobante de pago |
| `image_buffer` | base64 | Comprobante codificado |

---

## 🎯 Comandos Principales

Estos son inputs que el bot entiende especialmente:

| Comando | Resultado |
|---------|-----------|
| `menu` | Muestra catálogo |
| `ayuda` | Muestra opciones disponibles |
| `estado` / `¿dónde está?` | Estado del pedido actual |
| `cancelar` | Cancela el pedido |
| `si` / `confirmar` | Confirma el pedido |
| `no` / `cancelar` | Rechaza/cancela |
| Números | Busca por ID de producto |
| Cualquier texto | Busca en catálogo o pequeño talk |

---

## ✅ Respuestas Esperadas

### ✅ Respuesta Exitosa (200)
```json
{
  "reply": "Tu mensaje de respuesta aquí"
}
```

### ⚠️ Respuesta con Validación Fallida (200)
```json
{
  "reply": "⚠️ Algo no coincidió, pero intentamos procesarlo"
}
```

### ❌ Error de Entrada (400)
```json
{
  "ok": false,
  "reply": "❌ No se pudo identificar el cliente."
}
```
**Causa**: Falta el campo `telefono`

### ❌ Método No Permitido (405)
```json
{
  "ok": false,
  "error": "Method Not Allowed"
}
```
**Causa**: Usaste un método que no es GET o POST

### ❌ Error Interno (500)
```json
{
  "reply": "⚠️ Ocurrió un error. Un asesor humano continuará."
}
```
**Causa**: Error en el servidor (revisa logs en Vercel)

---

## 🔍 Troubleshooting

### Problema: "Error 404 - Not Found"
**Solución**: Verifica la URL exacta:
```
https://tu-proyecto.vercel.app/api/kommo  ✅ CORRECTO
https://tu-proyecto.vercel.app/kommo       ❌ INCORRECTO
```

### Problema: "Error 400 - No se pudo identificar"
**Solución**: Siempre incluye `telefono`:
```json
{
  "telefono": "+51999888777",    // ✅ REQUERIDO
  "mensaje": "hola"
}
```

### Problema: "Timeout de 60 segundos"
**Solución**: La función tardó demasiado (probablemente OCR)
- Intenta con imágenes más pequeñas
- Revisa que Firebase esté respondiendo

### Problema: "Error 500 - Internal Server Error"
**Solución**: 
1. Verifica logs en Vercel: Dashboard → Deployments → Function Logs
2. Chequea variables de entorno en Vercel Settings
3. Prueba localmente: `npm run dev`

---

## 📊 Estructura del Estado

El middleware mantiene un "estado" por teléfono (guardado en Firebase):

```javascript
{
  "telefono": "+51999888777",
  "estado": "pedido_borrador",
  "pedido": {
    "items": [
      { "id": "pizza_hawaiana", "quantity": 2, "name": "Pizzas Hawaiana" },
      { "id": "coca_grande", "quantity": 1, "name": "Coca Cola Grande" }
    ],
    "pricing": {
      "subtotal": 95.50,
      "delivery": 3.00,
      "total": 98.50
    }
  },
  "ubicacion": {
    "address": "Av. Pardo 123, Miraflores, Lima",
    "lat": -12.0464,
    "lon": -77.0428
  }
}
```

Cada request actualiza este estado.

---

## 🚀 Próximos Pasos

1. ✅ **Probado en Postman** → El middleware responde
2. ⏳ **Conectar a Kommo Bot** → Usa este endpoint en tu bot
3. ⏳ **Monitorear en Producción** → Revisa logs en Vercel
4. ⏳ **Ajustar según datos reales** → Optimiza basado en usage

---

## 📚 Documentos Completos

- **POSTMAN_TESTING.md** → Guía detallada con 15 casos de test
- **CONVERSATION_FLOWS.md** → Flujos conversacionales completos
- **VERCEL_DEPLOY.md** → Cómo deployar y troubleshoot en Vercel
- **DYPSI_Postman_Collection.json** → Colección lista para importar

---

## 💡 Ejemplo Real (Copy-Paste)

### Paso 1: Health Check
```bash
curl https://tu-proyecto.vercel.app/api/kommo
```

### Paso 2: Hola
```bash
curl -X POST https://tu-proyecto.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51999888777",
    "mensaje": "hola",
    "tipo": "text"
  }'
```

### Paso 3: Menú
```bash
curl -X POST https://tu-proyecto.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51999888777",
    "mensaje": "menu",
    "tipo": "text"
  }'
```

**¡Listo! Ahora integra esta URL en tu bot Kommo.** 🎉

---

**¿Dudas? Revisa los docs en `/docs/` o contacta al equipo de desarrollo.**
