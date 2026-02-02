# 🚀 DYPSI Middleware - Production Deployment Guide

## 📋 Tabla de Contenidos

1. [Quick Start](#quick-start)
2. [Variables de Entorno](#variables-de-entorno)
3. [Deployment en Vercel](#deployment-en-vercel)
4. [API Endpoints](#api-endpoints)
5. [Ejemplos de Uso](#ejemplos-de-uso)
6. [Monitoreo y Logs](#monitoreo-y-logs)

---

## Quick Start

### Requisitos Previos
- Node.js 18+
- Cuenta en Vercel
- Credenciales Firebase (opcional, funciona con memoria en desarrollo)
- Git

### Instalación Local (Desarrollo)

```bash
# Clonar repositorio
git clone https://github.com/leuis381/dypsi-middleware.git
cd dypsi-middleware

# Instalar dependencias
npm install

# Levantar servidor de desarrollo (puerto 3000)
npm run dev
```

### Deploy a Vercel

**Opción 1: Desde GitHub (Recomendado)**

1. Push a GitHub main
```bash
git add .
git commit -m "Production ready: improved NLP, text normalization, Vercel optimized"
git push origin main
```

2. En Vercel:
   - Ir a https://vercel.com/new
   - Conectar repositorio GitHub
   - Seleccionar `dypsi-middleware`
   - Configurar variables de entorno
   - Deploy

**Opción 2: CLI de Vercel**

```bash
# Instalar CLI
npm i -g vercel

# Deploy
vercel

# Deploy a production
vercel --prod
```

---

## Variables de Entorno

### Crear archivo `.env.production` para Vercel

En Vercel dashboard, agregar estas variables:

```
FIREBASE_PROJECT_ID=tu-project-id
FIREBASE_CLIENT_EMAIL=tu-email@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
KOMMO_API_KEY=tu-kommo-key
GOOGLE_MAPS_API_KEY=tu-google-maps-key
AGENT_WEBHOOK=https://tu-dominio.com/webhook
NODE_ENV=production
```

### Variables Opcionales

```
LOG_LEVEL=info        # debug | info | warn | error
MAX_REQUEST_SIZE=10mb # Tamaño máximo de request
CACHE_TTL=3600000     # TTL de cache en ms
```

---

## Deployment en Vercel

### Estructura de Carpetas (Vercel)

```
/workspaces/dypsi-middleware
├── api/
│   └── kommo.js          ← Main handler serverless
├── lib/
│   ├── ai-engine.js      ← IA y análisis de intenciones
│   ├── text-normalizer.js ← Normalización de texto (NEW!)
│   ├── parse-order.js    ← Parser de órdenes
│   ├── utils.js          ← Utilities compartidas
│   └── [otros módulos]
├── data/
│   └── menu.json         ← Menú de productos
├── vercel.json           ← Configuración Vercel (NEW!)
└── package.json
```

### Optimizaciones para Vercel

✅ **Funciones Serverless**: Máximo 30s por request  
✅ **Memoria**: 1024MB  
✅ **Conexiones**: Connection pooling automático  
✅ **Cache**: In-memory con TTL  
✅ **Logging**: Integrado con Vercel

### Monitoreo en Vercel

```
Vercel Dashboard → Project → Analytics
- Requests: número y latencia
- Errors: tipo y stack trace
- CPU/Memory: uso de recursos
```

---

## API Endpoints

### Base URL (Vercel)
```
https://dypsi-middleware.vercel.app
```

### 1. Procesar Mensaje
```http
POST /api/kommo
Content-Type: application/json

{
  "telefono": "+51999999999",
  "nombre": "Juan García",
  "mensaje": "Hola! Quiero una pizza hawaiana"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "reply": "Perfecto Juan! He detectado que quieres pizza hawaiana. ¿Algo más?",
  "intention": "order_new",
  "order": {
    "items": [
      {
        "id": "pizza_hawaiana",
        "name": "Pizza Hawaiana",
        "quantity": 1,
        "price": 35.00
      }
    ]
  }
}
```

### 2. Mensajes Comunes

**Saludo**
```json
{
  "telefono": "+51999999999",
  "nombre": "Juan",
  "mensaje": "Hola"
}
```

Respuesta:
```json
{
  "ok": true,
  "reply": "¡Hola Juan! ¿Qué deseas hoy?"
}
```

**Consultar Menú**
```json
{
  "telefono": "+51999999999",
  "nombre": "Juan",
  "mensaje": "¿Qué ofrecen?"
}
```

Respuesta:
```json
{
  "ok": true,
  "reply": "Ofrecemos pizzas, entradas, pastas, bebidas y postres. ¿Qué te interesa?"
}
```

**Preguntar Estado**
```json
{
  "telefono": "+51999999999",
  "nombre": "Juan",
  "mensaje": "¿Dónde está mi pedido?"
}
```

Respuesta:
```json
{
  "ok": true,
  "reply": "Tu pedido está en preparación. Llegará en ~20 minutos."
}
```

---

## Ejemplos de Uso

### Cliente HTTP (curl)

```bash
# Test básico
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51999999999",
    "nombre": "Juan",
    "mensaje": "Hola"
  }'

# Pedido con variantes
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51999999999",
    "nombre": "Juan",
    "mensaje": "Quiero pizza hawaiana sin piña y pan al ajo con queso extra"
  }'
```

### Cliente JavaScript/Node.js

```javascript
const axios = require('axios');

async function sendMessage(phone, name, message) {
  try {
    const response = await axios.post(
      'https://dypsi-middleware.vercel.app/api/kommo',
      {
        telefono: phone,
        nombre: name,
        mensaje: message
      }
    );
    
    console.log('Reply:', response.data.reply);
    return response.data;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Uso
sendMessage('+51999999999', 'Juan', 'Hola');
```

### Cliente Python

```python
import requests
import json

def send_message(phone, name, message):
    url = "https://dypsi-middleware.vercel.app/api/kommo"
    payload = {
        "telefono": phone,
        "nombre": name,
        "mensaje": message
    }
    headers = {"Content-Type": "application/json"}
    
    response = requests.post(url, json=payload, headers=headers)
    return response.json()

# Uso
result = send_message("+51999999999", "Juan", "Hola")
print(result['reply'])
```

### Cliente WhatsApp (Integration)

```javascript
// En tu webhook de WhatsApp
app.post('/webhook/whatsapp', async (req, res) => {
  const { phone, name, message } = req.body;
  
  // Llamar a DYPSI
  const response = await axios.post(
    'https://dypsi-middleware.vercel.app/api/kommo',
    { telefono: phone, nombre: name, mensaje: message }
  );
  
  // Enviar respuesta back a WhatsApp
  await whatsappClient.messages.create({
    from: `whatsapp:+1234567890`,
    to: `whatsapp:${phone}`,
    body: response.data.reply
  });
  
  res.json({ success: true });
});
```

---

## Monitoreo y Logs

### Ver Logs en Vercel

```bash
# Usando Vercel CLI
vercel logs

# O en dashboard: Project → Deployments → Logs
```

### Logs Esperados

```
[INFO] Incoming message { telefono: '+51999999999', tipo: 'text', messageLength: 5 }
[INFO] Detected intention { intention: 'greeting', confidence: 0.99 }
[INFO] Request completed { telefono: '+51999999999', duration: 45, replyLength: 42 }
```

### Monitoreo de Errores

Los errores se registran automáticamente en Vercel:

```
[ERROR] KOMMO handler error { 
  telefono: '+51999999999', 
  error: 'Message too long',
  code: 'VALIDATION_ERROR'
}
```

---

## Features de Producción

### ✅ Normalización Extrema de Texto
- Mayúsculas/minúsculas normalizadas
- Tildes y acentos removidos automáticamente
- Typos detectados y corregidos
- Abreviaturas expandidas (q→que, k→que, etc)

### ✅ Detección Inteligente de Productos
- Fuzzy matching con Jaro-Winkler
- Manejo de variantes (hawaiana/hawaiiana)
- Búsqueda por nombre, sinónimos y SKU
- Sugerencias cuando no hay match exacto

### ✅ Análisis de Intenciones
- Greeting, Help, Order, Status, Cancel, Payment, etc
- Confidence scores para cada intención
- Context awareness (estado anterior de conversación)

### ✅ Manejo de Errores Robusto
- Validación de entrada exhaustiva
- Mensajes de error amigables
- Fallback inteligente a opciones seguras
- Logging detallado para debugging

### ✅ Performance
- Caching en memoria (10 min TTL)
- Parsing optimizado (~10-50ms por mensaje)
- In-memory sessions (no DB lag)
- Compresión de respuestas automática

---

## Troubleshooting

### Problema: "FIREBASE_NOT_INITIALIZED"
**Solución**: Funciona en desarrollo sin Firebase. En producción, agregar credenciales en variables de entorno Vercel.

### Problema: "Message too long"
**Solución**: Limitar mensajes a 2000 caracteres. Sistema trunca automáticamente.

### Problema: Latencia alta (>5s)
**Solución**: Verificar:
- Tamaño de menú (>500 productos = lento)
- Logs de Vercel para memory usage
- Estado de Firebase (si está configurado)

### Problema: Producto no detectado
**Solución**: Verificar:
- Producto existe en menu.json
- Nombre exacto del producto
- Sinónimos configurados en parse-order.js

---

## API Status

```bash
# Healthcheck
curl https://dypsi-middleware.vercel.app/api/kommo?health=1
```

Response:
```json
{
  "ok": true,
  "status": "operational",
  "uptime": 86400,
  "version": "2.0.0"
}
```

---

## Support & Contact

- **Issues**: https://github.com/leuis381/dypsi-middleware/issues
- **Email**: support@dypsi.com
- **Docs**: https://docs.dypsi.com

---

**Última actualización**: 2 Febrero 2026  
**Versión**: 2.0.0-production  
**Estado**: ✅ Production Ready
