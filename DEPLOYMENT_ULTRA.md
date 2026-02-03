# 🚀 DYPSI ULTRA BOT v3.0 - GUÍA DE DEPLOYMENT

## 🎯 LA MEJOR IA DE RESTAURANTES - Lista para Vercel

Este es el bot de IA más avanzado y humanizado para restaurantes. Completamente optimizado para Vercel sin dependencias de APIs externas (excepto OCR para comprobantes).

---

## 📋 REQUISITOS PREVIOS

- Node.js >= 18.0.0
- Cuenta en Vercel (free o paga)
- Firebase Project (free o paga)
- OCR.Space API Key (gratis: https://ocr.space/ocrapi)

---

## 🔧 PASO 1: Configuración Local

### 1.1 Clonar y Instalar

```bash
git clone https://github.com/leuis381/dypsi-middleware.git
cd dypsi-middleware
npm install
```

### 1.2 Crear archivo .env

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
# Firebase (obligatorio)
FIREBASE_PROJECT_ID=tu-proyecto
FIREBASE_CLIENT_EMAIL=tu-email@proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# OCR (obligatorio para verificar pagos)
OCR_API_KEY=tu-api-key-ocr-space

# Store Location (obligatorio)
STORE_LAT=-12.046374
STORE_LON=-77.042793

# Kommo (para enviar pedidos al agente)
KOMMO_PHONE_NUMBER=+51923883240
KOMMO_AGENT_WEBHOOK=https://tu-webhook.com/notify (opcional)

# Variables opcionales (tienen defaults)
STORE_NAME=DYPSI Pizzería & Grill
DELIVERY_BASE_FEE=5.0
NODE_ENV=development
```

### 1.3 Obtener Credenciales Firebase

1. Ve a https://console.firebase.google.com
2. Crea un proyecto o usa uno existente
3. Dirígete a Settings → Service Accounts
4. Click "Generate New Private Key"
5. Copia los valores de `project_id`, `client_email`, `private_key`

**⚠️ IMPORTANTE:** La `private_key` debe tener `\n` literal en los saltos de línea.

Ejemplo correcto:
```
"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq...\nxyz123==\n-----END PRIVATE KEY-----\n"
```

### 1.4 Obtener OCR API Key

1. Ve a https://ocr.space/ocrapi
2. Regístrate (gratis)
3. Obtén tu API Key en el dashboard
4. Úsalo en `OCR_API_KEY`

---

## 🧪 PASO 2: Pruebas Locales

### 2.1 Test GET (Health Check)

```bash
curl http://localhost:3000/api/kommo

# Esperado:
{
  "ok": true,
  "service": "KOMMO IA",
  "status": "running",
  "version": "3.0-ultra"
}
```

### 2.2 Test POST (Greeting)

```bash
curl -X POST http://localhost:3000/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51999888777",
    "nombre": "Carlos",
    "mensaje": "Hola",
    "tipo": "text"
  }'

# Esperado:
{
  "ok": true,
  "reply": "¡Hola Carlos! 😊 ¿Cómo estás?..."
}
```

### 2.3 Test POST (Order)

```bash
curl -X POST http://localhost:3000/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51999888777",
    "nombre": "Carlos",
    "mensaje": "quiero 2 pizzas hawaianas medianas",
    "tipo": "text"
  }'

# Esperado:
{
  "ok": true,
  "reply": "Perfecto Carlos! Anotté tu pedido:\n\n2x Pizza Hawaiana Mediana..."
}
```

### 2.4 Ejecutar Suite de Tests

```bash
npm test

# Ejecutará:
# ✅ Health Check
# ✅ Greeting
# ✅ Menu Request
# ✅ Order Processing
# ✅ Invalid Input Handling
# ✅ Rate Limiting
```

---

## 🚀 PASO 3: Deploy a Vercel

### 3.1 Instalar Vercel CLI

```bash
npm install -g vercel
vercel login
```

### 3.2 Deploy

```bash
cd /workspaces/dypsi-middleware
vercel --prod
```

Vercel te pedirá:
- Confirmar proyecto
- Build settings (dejar defaults)

### 3.3 Configurar Variables de Entorno en Vercel

**Opción A: Via CLI**

```bash
vercel env add FIREBASE_PROJECT_ID
vercel env add FIREBASE_CLIENT_EMAIL
vercel env add FIREBASE_PRIVATE_KEY
vercel env add OCR_API_KEY
vercel env add STORE_LAT
vercel env add STORE_LON
vercel env add KOMMO_PHONE_NUMBER
# ... resto de variables
```

**Opción B: Via Dashboard Vercel**

1. Ve a https://vercel.com/dashboard
2. Selecciona tu proyecto
3. Settings → Environment Variables
4. Añade las variables:

```
FIREBASE_PROJECT_ID = tu-proyecto
FIREBASE_CLIENT_EMAIL = tu-email@...
FIREBASE_PRIVATE_KEY = -----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
OCR_API_KEY = tu-api-key
STORE_LAT = -12.046374
STORE_LON = -77.042793
KOMMO_PHONE_NUMBER = +51923883240
KOMMO_AGENT_WEBHOOK = https://... (opcional)
NODE_ENV = production
```

### 3.4 Redeploy

Una vez configuradas las variables:

```bash
vercel --prod
```

O desde Vercel Dashboard: Click "Redeploy"

---

## 🔗 PASO 4: Conectar con Kommo

### 4.1 Obtener URL del Deploy

```bash
vercel env
# Verás algo como:
# https://dypsi-middleware-xyz.vercel.app
```

### 4.2 En Kommo Bot

1. Ve a tu bot en Kommo
2. Settings → Webhooks
3. Añade webhook:
   - **URL:** `https://dypsi-middleware-xyz.vercel.app/api/kommo`
   - **Método:** POST
   - **Headers:** `Content-Type: application/json`

4. Test webhook desde Kommo
5. Si funciona: ¡Está listo!

---

## ✅ VALIDACIÓN POST-DEPLOY

### Test Health Check

```bash
curl https://dypsi-middleware-xyz.vercel.app/api/kommo

# Debe retornar 200 con status "running"
```

### Test Greeting

```bash
curl -X POST https://dypsi-middleware-xyz.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+51999888777",
    "nombre": "Test",
    "mensaje": "hola",
    "tipo": "text"
  }'
```

### Monitor Vercel

Ve a https://vercel.com/dashboard → tu proyecto → Functions

Verás:
- ✅ Status: Active
- ⏱️ Response times
- 📊 Request counts
- ⚠️ Errores (si hay)

---

## 🐛 TROUBLESHOOTING

### Error: "Missing environment variables"

**Solución:** Verifica que TODAS las variables requeridas están en Vercel:

```bash
vercel env list
```

Debe mostrar:
- FIREBASE_PROJECT_ID ✅
- FIREBASE_CLIENT_EMAIL ✅
- FIREBASE_PRIVATE_KEY ✅
- OCR_API_KEY ✅
- STORE_LAT ✅
- STORE_LON ✅

### Error: "Firebase initialization failed"

**Solución 1:** Valida Firebase credentials

```bash
# Localmente, verifica que funciona:
npm test
```

**Solución 2:** Regenera Service Account Key

1. Firebase Console → Settings → Service Accounts
2. Click "Generate New Key"
3. Actualiza FIREBASE_PRIVATE_KEY en Vercel
4. Redeploy: `vercel --prod`

### Error: "Timeout on response"

**Solución:** El endpoint tarda >30s (límite Vercel)

- Verifica que Firebase está accesible
- Aumenta timeout en código si es necesario
- Usa cache más agresivo

### Error: "Rate limit exceeded"

**Solución 1:** Aumenta límite

```env
RATE_LIMIT_MAX_REQUESTS=200
```

**Solución 2:** Limpia cache rate limiter

Este se limpia automáticamente cada 5 min

### Bot no responde mensajes

**Checklist:**

1. ✅ Webhook en Kommo apunta a URL correcta
2. ✅ POST body tiene campos: `telefono`, `mensaje`, `tipo`
3. ✅ Ver logs en Vercel Dashboard → Functions
4. ✅ Firebase credenciales válidas
5. ✅ Variables de entorno seteadas

---

## 📊 MONITOREO EN PRODUCCIÓN

### Vercel Analytics

Ve a: https://vercel.com/dashboard → tu proyecto → Analytics

Verás:
- **Requests:** Total requests al endpoint
- **Response Time:** Tiempo promedio de respuesta
- **Status Codes:** Distribution de 200, 400, 500, etc.

### Logs en Tiempo Real

```bash
vercel logs api/kommo
```

### Alertas Automáticas

Configura en Vercel Dashboard:
- Threshold de errores
- Response time altos
- Bandwidth usage

---

## 🔐 SEGURIDAD

✅ **Lo que tenemos:**

- Rate limiting: 60 req/min por número
- Input sanitization: XSS protection
- Helmet headers: HSTS, CSP, etc.
- Firebase security rules: Datos encriptados
- Validación de inputs: Todos validados
- No guardar datos sensibles: Solo orden

**Recomendaciones adicionales:**

1. Usa HTTPS (Vercel lo da gratis)
2. Rotate Firebase keys cada 3 meses
3. Monitor logs para actividad sospechosa
4. Backup de datos en Firebase
5. Usa VPN en producción (opcional)

---

## 📈 ESCALABILIDAD

**Vercel Limits:**

- ✅ Unlimited requests por mes
- ✅ Auto-scaling (maneja 1000+ req/s)
- ✅ Edge network (< 100ms latencia)
- ✅ Free tier suficiente para 10k+ usuarios/mes

**Optimizaciones ya implementadas:**

- Cache de 5 min (OCR results)
- Cache de 15 min (Delivery calculations)
- Firebase connection pooling
- Lazy loading de data
- Compression automática

---

## 🎉 ¡LISTO!

Tu bot está en producción. Características:

✅ **IA Ultra Inteligente**
- Entiende 13 tipos de intenciones
- Respuestas humanizadas infinitas
- Contexto conversacional real
- Profiles automáticos de clientes

✅ **Sin APIs Externas** (excepto OCR)
- Delivery sin Google Maps
- Geocoding simplificado
- Fallback automático

✅ **Kommo Integration**
- Envío automático de pedidos
- Notificaciones al agente
- Sesiones persistentes

✅ **Production Ready**
- 99.9% uptime (Vercel)
- Rate limiting
- Error handling
- Logging completo

---

## 📞 SOPORTE

- **Docs:** Ver archivos `.md` en root
- **Tests:** `npm test`
- **Logs:** `vercel logs api/kommo`
- **Community:** GitHub Issues

---

**Versión:** 3.0 Ultra  
**Última actualización:** Feb 2026  
**Status:** ✅ Production Ready
