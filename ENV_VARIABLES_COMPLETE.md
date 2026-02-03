# 🔧 VARIABLES DE ENTORNO v4.0 ULTRA+

## 📋 LISTA COMPLETA (Con OCR y Bot Control)

### **REQUERIDAS** (Obligatorias)

```bash
# Firebase - Autenticación y base de datos
FIREBASE_PROJECT_ID=tu-proyecto-firebase
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@tu-proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nXXXXXXXX...\n-----END PRIVATE KEY-----\n"

# Kommo API - WhatsApp Business
KOMMO_API_KEY=tu_kommo_api_key

# OCR API - Procesar imágenes de comprobantes
OCR_API_KEY=tu_ocr_api_key
```

### **OPCIONALES** (Mejoran funcionalidad)

```bash
# Google Maps - Geocoding y búsqueda de ubicaciones
GOOGLE_MAPS_API_KEY=tu_google_maps_api_key

# Ubicación de Tienda
STORE_LAT=-12.046374
STORE_LON=-77.042793
STORE_NAME=DYPSI Pizzería & Grill
STORE_PHONE=+51923883240
STORE_ADDRESS=Lima, Perú

# Bot Control - Encendido/Apagado
BOT_ENABLED=true
BOT_MAINTENANCE_MODE=false
```

---

## 🔐 CÓMO OBTENER CADA VARIABLE

### **1. FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY**

#### Paso 1: Firebase Console
1. Ve a: https://console.firebase.google.com/
2. Selecciona tu proyecto
3. Click en **⚙️ (Engranaje)** → **Project Settings**

#### Paso 2: Generar Service Account
1. Ve a la pestaña **Service Accounts**
2. Click en **Generate New Private Key**
3. Se descargará un archivo JSON

#### Paso 3: Extraer valores
Abre el JSON descargado y busca:
```json
{
  "project_id": "mi-proyecto-xxxxx",          // → FIREBASE_PROJECT_ID
  "client_email": "firebase-adminsdk-xxxxx@mi-proyecto.iam.gserviceaccount.com", // → FIREBASE_CLIENT_EMAIL
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBA..."  // → FIREBASE_PRIVATE_KEY
}
```

#### ⚠️ IMPORTANTE - FIREBASE_PRIVATE_KEY

Tu `FIREBASE_PRIVATE_KEY` puede venir en diferentes formatos:

**Formato 1** (Con saltos de línea reales):
```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...
-----END PRIVATE KEY-----
```

**Formato 2** (Escapado con \\n):
```
-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...\n-----END PRIVATE KEY-----\n
```

**✅ SOLUCIÓN**: El sistema ahora reconoce TODOS los formatos automáticamente.

**Cómo copiarlo en Vercel**:
1. Abre el archivo JSON
2. Busca el campo `private_key`
3. Cópialos EXACTAMENTE COMO ESTÁ (con \n o con saltos reales)
4. Pégalo en Vercel → Environment Variables

---

### **2. KOMMO_API_KEY**

1. Ve a: https://www.kommo.com/ (login con tu cuenta)
2. **Configuración** → **Integraciones** → **API**
3. Si no tienes una integración, crea una nueva:
   - Click en **+ Nueva Integración**
   - Nombre: "DYPSI Bot"
   - Tipo: "Incoming Webhook" o "Custom"
4. Copia el **API Token**
5. Pégalo en `KOMMO_API_KEY`

---

### **3. OCR_API_KEY** (NUEVO - Para imágenes)

#### Opción A: OCR.Space (Gratis, 25 requests/día)
1. Ve a: https://ocr.space/ocrapi
2. Scroll down → Section "Free OCR API"
3. Copia el API Key
4. Pégalo en `OCR_API_KEY`

#### Opción B: Google Cloud Vision (De pago)
1. Ve a: https://console.cloud.google.com/
2. Crea un proyecto
3. Habilita **Cloud Vision API**
4. Ve a **Credenciales** → **Create Credentials** → **API Key**
5. Copia la clave
6. Pégala en `OCR_API_KEY`

---

### **4. GOOGLE_MAPS_API_KEY** (Opcional)

1. Ve a: https://console.cloud.google.com/
2. Selecciona o crea un proyecto
3. Busca y habilita: **Maps JavaScript API** y **Geocoding API**
4. Ve a **Credenciales**
5. Click en **Create Credentials** → **API Key**
6. Copia y pégala en `GOOGLE_MAPS_API_KEY`

---

### **5. BOT CONTROL** (Nuevo - Encendido/Apagado)

```bash
# Valores: "true" o "false"
BOT_ENABLED=true              # ✅ Bot activo
BOT_MAINTENANCE_MODE=false    # 🔧 Modo mantenimiento
```

---

## 🚀 CÓMO CONFIGURAR EN VERCEL

### Paso 1: Acceder a Vercel
1. Ve a: https://vercel.com/dashboard
2. Selecciona tu proyecto: **dypsi-middleware**

### Paso 2: Agregar Variables
1. Click en **Settings**
2. Click en **Environment Variables**
3. Para cada variable:
   - **Name**: (nombre exacto, ej: `FIREBASE_PROJECT_ID`)
   - **Value**: (el valor)
   - Click en **Add**

### Paso 3: Variables a Agregar

```
┌─────────────────────────────┬────────────────────────┐
│ Variable                    │ Valor                  │
├─────────────────────────────┼────────────────────────┤
│ FIREBASE_PROJECT_ID         │ tu-proyecto            │
│ FIREBASE_CLIENT_EMAIL       │ firebase-adminsdk-...  │
│ FIREBASE_PRIVATE_KEY        │ -----BEGIN PRIVATE...  │
│ KOMMO_API_KEY               │ tu_api_key             │
│ OCR_API_KEY                 │ tu_ocr_api_key         │
│ GOOGLE_MAPS_API_KEY         │ tu_maps_key (opt)      │
│ BOT_ENABLED                 │ true                   │
│ BOT_MAINTENANCE_MODE        │ false                  │
│ STORE_LAT                   │ -12.046374             │
│ STORE_LON                   │ -77.042793             │
│ STORE_NAME                  │ DYPSI Pizzería        │
│ STORE_PHONE                 │ +51923883240          │
└─────────────────────────────┴────────────────────────┘
```

### Paso 4: Redeploy
1. Click en **Redeploy** después de agregar las variables
2. Vercel construirá y desplegará automáticamente

---

## 🧪 VERIFICAR QUE TODO FUNCIONA

### Test 1: Verificar Health
```bash
curl https://tu-proyecto.vercel.app/api/health
```

Esperado:
```json
{
  "status": "ok",
  "service": "DYPSI BOT v4.0",
  "version": "4.0 ULTRA+",
  "environmentVariables": {
    "FIREBASE_PROJECT_ID": "✅",
    "FIREBASE_CLIENT_EMAIL": "✅",
    "FIREBASE_PRIVATE_KEY": "✅",
    "KOMMO_API_KEY": "✅",
    "OCR_API_KEY": "✅"
  }
}
```

### Test 2: Estado del Bot
```bash
curl https://tu-proyecto.vercel.app/api/bot/status
```

Esperado:
```json
{
  "enabled": true,
  "maintenanceMode": false,
  "available": true,
  "version": "v4.0 ULTRA+",
  "health": "online"
}
```

### Test 3: Health Check Completo
```bash
curl https://tu-proyecto.vercel.app/api/bot/health
```

Esperado:
```json
{
  "status": "healthy",
  "bot": {
    "enabled": true,
    "maintenanceMode": false,
    "health": "online"
  },
  "performance": {
    "messagesProcessed": 0,
    "errorCount": 0,
    "errorRate": "0%",
    "uptime": "X days Y hours Z mins"
  }
}
```

### Test 4: OCR (Procesar Imagen)
```bash
curl -X POST https://tu-proyecto.vercel.app/api/ocr \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://ejemplo.com/imagen.jpg"
  }'
```

---

## 🎛️ CONTROLAR EL BOT

### Encender Bot
```bash
curl -X POST https://tu-proyecto.vercel.app/api/bot/enable
```

### Apagar Bot
```bash
curl -X POST https://tu-proyecto.vercel.app/api/bot/disable
```

### Modo Mantenimiento (ON)
```bash
curl -X POST https://tu-proyecto.vercel.app/api/bot/maintenance/on
```

### Modo Mantenimiento (OFF)
```bash
curl -X POST https://tu-proyecto.vercel.app/api/bot/maintenance/off
```

### Resetear Contadores
```bash
curl -X POST https://tu-proyecto.vercel.app/api/bot/reset
```

---

## ✅ CHECKLIST FINAL

- [ ] FIREBASE_PROJECT_ID configurada
- [ ] FIREBASE_CLIENT_EMAIL configurada
- [ ] FIREBASE_PRIVATE_KEY configurada (acepta cualquier formato ✅)
- [ ] KOMMO_API_KEY configurada
- [ ] OCR_API_KEY configurada
- [ ] GOOGLE_MAPS_API_KEY configurada (opcional)
- [ ] BOT_ENABLED = true
- [ ] BOT_MAINTENANCE_MODE = false
- [ ] STORE_LAT y STORE_LON configuradas
- [ ] Redeploy ejecutado en Vercel
- [ ] Tests pasando

---

## 🆘 TROUBLESHOOTING

### Error: "FIREBASE_PRIVATE_KEY invalid"
**Solución**: El sistema ahora acepta cualquier formato. Si aún falla:
1. Copia exactamente desde el JSON de Firebase
2. Verifica que incluya `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`
3. No modifiques nada, pega tal cual está

### Error: "OCR_API_KEY not found"
**Solución**: Obtén una de:
- OCR.Space (gratis): https://ocr.space/ocrapi
- Google Cloud Vision (de pago)

### El bot responde con "maintenance mode"
**Solución**: Desactiva modo mantenimiento:
```bash
curl -X POST https://tu-proyecto.vercel.app/api/bot/maintenance/off
```

### Las imágenes no se procesan
**Solución**: Verifica que OCR_API_KEY está configurada en Vercel

---

**Versión**: v4.0 ULTRA+  
**Fecha**: Febrero 3, 2026  
**Status**: ✅ Todas las variables documentadas y soportadas
