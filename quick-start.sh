#!/bin/bash

# DYPSI Middleware - Quick Start Script
# Automatiza el deploy a Vercel en 30 segundos

set -e

echo "🚀 DYPSI Middleware - Quick Deploy to Vercel"
echo "=============================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Verificar Node.js
echo -e "${BLUE}📦 Verificando Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está instalado. Descárgalo de: https://nodejs.org"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION} encontrado${NC}"

# Step 2: Verificar npm
echo -e "${BLUE}📦 Verificando npm...${NC}"
if ! command -v npm &> /dev/null; then
    echo "❌ npm no está instalado"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo -e "${GREEN}✓ npm ${NPM_VERSION} encontrado${NC}"

# Step 3: Instalar dependencias
echo ""
echo -e "${BLUE}📥 Instalando dependencias...${NC}"
npm install
echo -e "${GREEN}✓ Dependencias instaladas${NC}"

# Step 4: Instalar Vercel CLI
echo ""
echo -e "${BLUE}🔧 Instalando Vercel CLI...${NC}"
npm install -g vercel
echo -e "${GREEN}✓ Vercel CLI instalado${NC}"

# Step 5: Deploy
echo ""
echo -e "${BLUE}🚀 Iniciando deploy a Vercel...${NC}"
echo ""
echo -e "${YELLOW}Instrucciones:${NC}"
echo "1. Selecciona 'Y' para conectar con tu cuenta de Vercel"
echo "2. Nombre del proyecto: ${YELLOW}dypsi-middleware${NC} (o el que prefieras)"
echo "3. Framework: ${YELLOW}Other${NC}"
echo "4. Root directory: ${YELLOW}.${NC}"
echo "5. Build command: ${YELLOW}skip${NC}"
echo ""

vercel --prod

echo ""
echo -e "${GREEN}✅ ¡Deploy completado!${NC}"
echo ""
echo "Próximos pasos:"
echo "1. Ve a https://vercel.com/dashboard"
echo "2. Selecciona tu proyecto"
echo "3. Settings → Environment Variables"
echo "4. Añade estas variables:"
echo "   - FIREBASE_PROJECT_ID"
echo "   - FIREBASE_CLIENT_EMAIL"
echo "   - FIREBASE_PRIVATE_KEY"
echo "   - KOMMO_API_KEY"
echo "   - GOOGLE_MAPS_API_KEY"
echo ""
echo "5. Vercel re-deployará automáticamente"
echo ""
echo -e "${GREEN}¡Listo!${NC}"
