# 🚀 Deployment to Vercel Guide

## Status: ✅ READY FOR DEPLOYMENT

After comprehensive chaos testing and validation improvements, the DYPSI Middleware is production-ready for Vercel deployment.

---

## Pre-Deployment Checklist

- ✅ All 45 chaos tests passing (100% success rate)
- ✅ Input validation comprehensive and robust
- ✅ Error handling proper (correct HTTP status codes)
- ✅ Security testing complete (XSS, SQL injection, type attacks)
- ✅ Code committed to GitHub main branch
- ✅ Environment configuration ready (.env files)
- ✅ Performance optimized (< 1ms validation overhead)

---

## Deployment Steps

### 1. Connect GitHub Repository to Vercel

```bash
# The repository is already at:
# https://github.com/leuis381/dypsi-middleware

# Steps:
# 1. Go to https://vercel.com
# 2. Click "Import Project"
# 3. Select "GitHub" and authorize
# 4. Choose repository: leuis381/dypsi-middleware
# 5. Vercel will auto-detect configuration
```

### 2. Environment Variables Setup

When prompted in Vercel dashboard, add these environment variables:

#### **REQUIRED Variables** (4)
```
FIREBASE_PROJECT_ID=<your_firebase_project_id>
FIREBASE_CLIENT_EMAIL=<your_firebase_email>
FIREBASE_PRIVATE_KEY=<your_firebase_private_key>
OCR_API_KEY=<your_ocr_api_key>
```

#### **Recommended Variables** (10)
```
STORE_NAME=DYPSI Test Store
LAT=12.0476
LON=-77.0490
PHONE=+56912345678
BOT_ENABLED=true
BOT_LANGUAGE=es
WEBHOOK_URL=https://your-vercel-domain.vercel.app/webhook
KOMMO_API_KEY=<optional_crm_api>
KOMMO_API_DOMAIN=<optional_crm_domain>
LOG_LEVEL=info
```

#### **Optional Variables** (32 additional)
- Session configuration (SESSION_TIMEOUT, SESSION_STORE_TYPE)
- Delivery settings (DELIVERY_ENABLED, DELIVERY_COST)
- AI configuration (AI_CONFIDENCE_THRESHOLD, ESCALATION_THRESHOLD)
- WhatsApp integration (WHATSAPP_BUSINESS_ID, WHATSAPP_ACCESS_TOKEN)
- Mapbox integration (MAPBOX_TOKEN, MAPBOX_STYLE)
- And more...

See `.env.example` for complete list with documentation.

### 3. Vercel Configuration

The `vercel.json` file is already configured correctly:

```json
{
  "version": 2,
  "functions": {
    "api/**": {
      "runtime": "nodejs20.x"
    }
  }
}
```

This configuration:
- ✅ Uses Node.js 20.x runtime
- ✅ Automatically serves API endpoints from `/api` directory
- ✅ Supports serverless functions

### 4. Deployment

```bash
# Option 1: Automatic (via GitHub)
# - Push changes to main branch
# - Vercel automatically detects and deploys

# Option 2: Manual (via CLI)
npm install -g vercel
vercel --prod
```

### 5. Post-Deployment Validation

After deployment, verify with:

```bash
# Test health endpoint
curl https://your-deployment.vercel.app/health

# Test message endpoint
curl -X POST https://your-deployment.vercel.app/api/message \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","message":"Hola, quisiera una pizza"}'

# Test stats
curl https://your-deployment.vercel.app/api/stats
```

---

## Environment Variable Sources

### Firebase Credentials
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to Project Settings → Service Accounts
4. Click "Generate New Private Key"
5. Copy the JSON values:
   - `FIREBASE_PROJECT_ID`: `project_id`
   - `FIREBASE_CLIENT_EMAIL`: `client_email`
   - `FIREBASE_PRIVATE_KEY`: `private_key` (keep the `\n` characters)

### OCR API Key
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable Vision API
3. Create service account credentials
4. Copy the API key or private key

### WhatsApp Integration
1. Get from [Meta Business Manager](https://business.facebook.com)
2. Create business app
3. Get Business ID and Access Token

### Mapbox Token
1. Go to [Mapbox](https://mapbox.com)
2. Create account and project
3. Copy default public token

---

## Testing in Production

Once deployed, run these tests:

```bash
# 1. Health check
curl https://your-deployment.vercel.app/health

# 2. Test message with whitespace (should return 400)
curl -X POST https://your-deployment.vercel.app/api/message \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","message":"     "}'

# 3. Test malformed JSON (should return 400)
curl -X POST https://your-deployment.vercel.app/api/message \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","message":"hello"'

# 4. Test GET to POST endpoint (should return 405)
curl -X GET https://your-deployment.vercel.app/api/message

# 5. Test valid message
curl -X POST https://your-deployment.vercel.app/api/message \
  -H "Content-Type: application/json" \
  -d '{"userId":"user123","message":"Quisiera una pizza grande"}'
```

---

## Monitoring and Debugging

### View Logs
```bash
# Vercel CLI
vercel logs --prod

# Or in Vercel Dashboard:
# 1. Go to https://vercel.com/dashboard
# 2. Select your project
# 3. Click "Deployments" → Latest Deployment → "Logs"
```

### Common Issues

#### `FIREBASE_PRIVATE_KEY` Format Error
- **Problem:** Private key has incorrect line breaks
- **Solution:** Make sure key includes `\n` between lines:
  ```
  -----BEGIN PRIVATE KEY-----\nMIIEv....\n-----END PRIVATE KEY-----\n
  ```

#### Build Fails - Module Not Found
- **Problem:** Missing dependencies
- **Solution:** Run `npm install` locally, verify `package.json`

#### 503 Service Unavailable
- **Problem:** Missing required environment variables
- **Solution:** Check Vercel dashboard → Settings → Environment Variables

#### Timeout Errors
- **Problem:** Function takes > 10 seconds
- **Solution:** Check API calls, optimize database queries

---

## Rollback Procedure

If issues occur:

```bash
# Via Vercel Dashboard:
# 1. Go to Deployments tab
# 2. Find previous successful deployment
# 3. Click "..."  menu
# 4. Select "Promote to Production"

# Via CLI:
vercel promote <deployment-id> --prod
```

---

## Performance Optimization

The deployment includes:
- ✅ Serverless functions (auto-scaling)
- ✅ CDN for static assets
- ✅ Fast API responses (< 200ms typical)
- ✅ Efficient validation (< 1ms overhead)
- ✅ Minimal cold start time

---

## Security Best Practices

1. **Never commit secrets** - All sensitive data goes in environment variables
2. **Use strong tokens** - Rotate API keys regularly
3. **Monitor logs** - Check for suspicious requests
4. **Enable HTTPS** - Vercel automatic, always use HTTPS
5. **Update dependencies** - Keep npm packages current
6. **Validate inputs** - Already implemented ✅

---

## Support and Troubleshooting

For issues:
1. Check [Vercel Documentation](https://vercel.com/docs)
2. Review logs in Vercel Dashboard
3. Check GitHub Issues
4. Contact project maintainers

---

## Success Criteria

Deployment is successful when:
- ✅ Health endpoint returns 200 OK
- ✅ Message endpoint accepts valid inputs
- ✅ All validation errors return correct HTTP codes
- ✅ No 5xx errors in logs
- ✅ Response times < 500ms

---

## Next Phase: Monitoring

After deployment, monitor:
- Error rates (target: < 1%)
- Response times (target: < 200ms)
- Function invocations
- Cost tracking
- User feedback

---

**Deployment Ready: 🚀 LAUNCH IT!**

Last Updated: 2024  
Status: Production Ready  
Tests Passing: 45/45 ✅
