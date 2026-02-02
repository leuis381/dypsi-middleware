# 🚀 Desplegar en Vercel - DYPSI Middleware

## Pasos para Deployar

### 1. Conectar Repositorio a Vercel

1. Ve a [vercel.com](https://vercel.com)
2. Haz login con GitHub
3. Importa este repositorio
4. Vercel detectará automáticamente que es un proyecto Node.js

### 2. Configurar Variables de Entorno

En el dashboard de Vercel, ve a **Settings → Environment Variables** y añade:

```
FIREBASE_PROJECT_ID=tu-proyecto-id
FIREBASE_CLIENT_EMAIL=tu-email@firebase.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n

AGENT_WEBHOOK=https://tu-webhook.com/notifications (opcional)
PAYMENT_TOLERANCE=0.06
NODE_ENV=production
```

### 3. Deploy Automático

Vercel automáticamente:
- ✅ Detecta `package.json`
- ✅ Instala dependencias
- ✅ Ejecuta build (sin necesario para Node.js puro)
- ✅ Despliega en `https://tu-proyecto.vercel.app`
- ✅ Configura el serverless function en `/api/kommo`

### 4. Verificar Deployment

```bash
curl https://tu-proyecto.vercel.app/api/kommo
```

Deberías obtener:
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

## URL del Middleware en Vercel

```
https://tu-proyecto.vercel.app/api/kommo
```

**Nota**: Vercel automáticamente ruteará las requests a `/api/kommo` al archivo `api/kommo.js`.

---

## Testing en Postman Después del Deploy

### Opción 1: Usar la Colección JSON Provided

1. Abre Postman
2. **File → Import → Upload Files**
3. Selecciona `docs/DYPSI_Postman_Collection.json`
4. En la colección, edita la variable `base_url` con tu URL de Vercel:
   ```
   https://tu-proyecto.vercel.app
   ```
5. Comienza a testear

### Opción 2: Manual (Quick Test)

**GET Health Check**:
```
GET https://tu-proyecto.vercel.app/api/kommo
```

**POST Primer Mensaje**:
```
POST https://tu-proyecto.vercel.app/api/kommo
Content-Type: application/json

{
  "telefono": "+51999888777",
  "mensaje": "hola",
  "tipo": "text"
}
```

---

## Troubleshooting

### ❌ Error 404 Not Found

**Problema**: El endpoint no existe

**Solución**:
- Verifica que el archivo esté en `/api/kommo.js` (no `/api/kommo/index.js`)
- Revisa que `vercel.json` no lo sobreescriba (no existe uno en el proyecto actual)

### ❌ Error 500 Internal Server Error

**Problema**: Firebase no está configurado o credenciales inválidas

**Solución**:
```bash
# Prueba localmente
npm run dev

# Verifica logs en Vercel
# Dashboard → Deployments → Latest → Function Logs
```

### ❌ Timeout (>60s)

**Problema**: OCR o Firebase tardan mucho

**Solución**:
- Reduce el tamaño de imágenes
- Usa `PAYMENT_TOLERANCE` apropiado
- Verifica que Firebase esté respondiendo rápido

### ❌ CORS Error desde Frontend

**Problema**: El navegador bloquea la request

**Solución**: Añade headers CORS (necesario si se llama desde un sitio web)

```javascript
// En api/kommo.js, antes del handler:
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

if (req.method === 'OPTIONS') {
  return res.status(200).end();
}
```

### ❌ Firebase Timeout

**Problema**: Sesiones no se guardan

**Solución**:
```bash
# Verifica credenciales en Vercel
# Dashboard → Settings → Environment Variables

# Reconecta Firebase:
rm package-lock.json
npm install
# Re-deploy
```

---

## Logs en Vercel

Para ver los logs en tiempo real:

```bash
# Instala Vercel CLI (si no lo tienes)
npm install -g vercel

# Login
vercel login

# Ver logs
vercel logs https://tu-proyecto.vercel.app
```

Alternativamente:
1. Abre el dashboard de Vercel
2. Selecciona tu proyecto
3. **Deployments → Latest → Function Logs**

---

## Monitoreo y Análisis

### Métricas de Vercel

- **Response Time**: Debe estar < 1s (excepto OCR)
- **CPU**: < 50%
- **Memory**: < 512MB
- **Calls/min**: Depende de tu plan

### Logs Estructurados

El middleware loguea automáticamente:
- Incoming messages
- State transitions
- OCR results
- Errors y excepciones

Busca logs con:
```bash
vercel logs --follow
```

---

## Actualizar el Código

Después de hacer cambios en el código:

```bash
# Commit y push a GitHub
git add .
git commit -m "Actualizar middleware"
git push origin main

# Vercel automáticamente re-deploya
# (generalmente en < 1 minuto)
```

---

## Integración con Kommo Bot

Una vez deployado, usa esta URL en tu bot Kommo:

```javascript
const MIDDLEWARE_URL = "https://tu-proyecto.vercel.app/api/kommo";

async function sendMessage(phone, message) {
  const response = await fetch(MIDDLEWARE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telefono: phone,
      mensaje: message,
      tipo: "text"
    })
  });
  
  return response.json();
}
```

---

## Plan Siguiente

1. ✅ Deploy en Vercel
2. ✅ Testear endpoints en Postman
3. ✅ Integrar con Kommo Bot (uso este middleware como backend)
4. ⏳ Conectar a base de datos (opcional)
5. ⏳ Implementar autenticación (si es necesario)
6. ⏳ Analytics y dashboards

---

**¿Necesitas ayuda? Revisa los logs en Vercel o el archivo `POSTMAN_TESTING.md`.**
