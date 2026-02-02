# ⚡ Quick Start - Deploy a Vercel en 30 Segundos

## Opción 1: Usar el Script (Recomendado)

```bash
bash quick-start.sh
```

**Eso es todo.** El script hace todo automáticamente:
- ✓ Verifica Node.js/npm
- ✓ Instala dependencias
- ✓ Instala Vercel CLI
- ✓ Inicia el deploy

## Opción 2: Manual (5 minutos)

### 1️⃣ Instalar Vercel CLI
```bash
npm install -g vercel
```

### 2️⃣ Login en Vercel
```bash
vercel login
```
Te abrirá el navegador para autenticarte.

### 3️⃣ Deploy
```bash
cd /workspaces/dypsi-middleware
vercel --prod
```

### 4️⃣ Seguir las preguntas
- **Project name**: `dypsi-middleware`
- **Framework**: `Other`
- **Root directory**: `.`
- **Build command**: Leave empty (skip)

## Opción 3: GitHub Auto-Deploy

1. Push a GitHub (ya hecho):
```bash
git push origin main
```

2. Ve a **https://vercel.com**
3. Click "New Project"
4. Conecta tu repo GitHub
5. Click "Deploy"

**Vercel deployará automáticamente en 2-3 minutos.**

---

## ✅ Verificar que Funcione

Después del deploy, prueba tu API:

```bash
curl -X POST https://dypsi-middleware.vercel.app/api/kommo \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+51999999999","nombre":"Juan","mensaje":"hawaiiana"}'
```

Deberías recibir:
```json
{"ok":true,"reply":"¡Bienvenid@ de vuelta! ¿Qué te preparamos?"}
```

---

## 🔑 Configurar Variables de Entorno

1. Ve a **https://vercel.com/dashboard**
2. Selecciona tu proyecto
3. **Settings** → **Environment Variables**
4. Añade:

| Variable | Valor |
|----------|-------|
| `FIREBASE_PROJECT_ID` | Tu Firebase Project ID |
| `FIREBASE_CLIENT_EMAIL` | Tu Firebase email |
| `FIREBASE_PRIVATE_KEY` | Tu Firebase private key |
| `KOMMO_API_KEY` | Tu API key de Kommo |
| `GOOGLE_MAPS_API_KEY` | Tu Google Maps API key |

5. Click "Save"
6. Vercel re-deployará automáticamente

---

## 🎉 ¡Listo!

Tu AI de restaurante está **LIVE** en:
```
https://dypsi-middleware.vercel.app
```

El bot ahora está:
- ✅ Operativo 24/7
- ✅ Escalable a millones de usuarios
- ✅ Con HTTPS automático
- ✅ CDN global
- ✅ Monitoreo en tiempo real
- ✅ Analytics incluido

---

## 🚨 Problemas?

### No tengo Vercel
→ Crea cuenta gratis en https://vercel.com (5 minutos)

### Error "Build failed"
→ Verifica que `vercel.json` existe y esté en la raíz

### Variables de entorno no funcionan
→ Espera 2-3 minutos después de guardarlas

### El endpoint no responde
→ Verifica que el proyecto esté en "Production"

### Need more help?
→ Lee `DEPLOYMENT_GUIDE.md` para instrucciones completas

---

## 📊 Monitoreo

En Vercel Dashboard puedes ver:
- **Functions**: Tiempo de ejecución de cada request
- **Logs**: Error logs en tiempo real
- **Analytics**: Estadísticas de uso
- **Deployments**: Historial de versiones

---

**Hecho. Tu IA ya está en el mundo. 🚀**
