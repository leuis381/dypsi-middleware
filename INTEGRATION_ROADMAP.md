# Roadmap de Integración - Motor de IA Ultra-Mejorado

## 📋 Estado Actual
✅ **Módulos Creados:**
- `lib/ai-engine.js` - Motor de IA con 540 líneas (intenciones, contexto, análisis semántico)
- `lib/smart-ocr.js` - OCR inteligente con 480 líneas (clasificación de imágenes)
- `lib/user-profile.js` - Perfiles de usuario con 350 líneas (predicción, personalización)

✅ **JSON Reparado:**
- `data/sinonimos.json` - Error de sintaxis corregido (faltaba coma)

---

## 🚀 FASES DE INTEGRACIÓN

### **FASE 1: Integración del Motor de IA en api/kommo.js** (CRÍTICA)
**Objetivo:** Reemplazar detección regex → inteligencia multi-layer

**Pasos:**

1. **Importar módulos en api/kommo.js**
```javascript
import { detectIntention, ConversationContext, generateSmartResponse } from '../lib/ai-engine.js';
import { smartOCRAnalysis } from '../lib/smart-ocr.js';
import { UserProfile } from '../lib/user-profile.js';
```

2. **Crear contexto conversacional por sesión**
   - Reemplazar lógica de sesión básica
   - Instanciar `ConversationContext` para cada usuario
   - Guardar contexto en Firebase (persistencia)

3. **Reemplazar detección de intención**
   - Remover `findInJSON()` y regex patterns
   - Usar `detectIntention(text, context)` inteligente
   - 13 intenciones soportadas: ORDER_NEW, ORDER_MODIFY, ORDER_REPEAT, PAYMENT, STATUS, CANCEL, FEEDBACK, HELP, GREETING, SMALLTALK, COMPLAINT, LOYALTY

4. **Implementar respuestas inteligentes**
   - Reemplazar templates hardcoded
   - Usar `generateSmartResponse()` con variación
   - Agregar sugerencias con `generateSuggestions()`

5. **Validación de órdenes**
   - Usar `validateOrder()` del motor de IA
   - Proporcionar warnings específicos

**Archivos a Modificar:**
- `api/kommo.js` - Líneas 174-392 (detección y procesamiento)

**Resultado Esperado:**
- Intenciones detectadas con precisión 95%+
- Contexto preservado entre turnos
- Sugerencias dinámicas aumentan ticket promedio

---

### **FASE 2: OCR Inteligente y Análisis de Imágenes**
**Objetivo:** Diferenciar tipos de imagen y extraer datos contextuales

**Pasos:**

1. **Reemplazar procesamiento OCR**
   - Usar `smartOCRAnalysis()` en lugar de `ocrHandler()`
   - Automaticamente clasifica: RECEIPT, MENU, CATALOG_ITEM, PRODUCT, QR

2. **Implementar handlers especializados**
   - **Recibos:** Extrae monto, fecha, método de pago, validación
   - **Menús:** Extrae categorías, items, precios
   - **Catálogo WhatsApp:** Detecta producto ID, variantes, disponibilidad

3. **Validación inteligente**
   - `validateOCRAmount()` compara con orden esperada
   - Tolerancia configurable (5-10%)

4. **Almacenamiento de análisis**
   - Guardar clasificación en Firebase
   - Historial de imágenes analizadas por usuario

**Archivos a Modificar:**
- `lib/ocr-handler.js` - Reemplazar con smart approach
- `api/kommo.js` - Líneas 219-272 (manejo de imágenes)

**Resultado Esperado:**
- Clasificación correcta de imágenes 99%
- Extracción de datos 95%+ precisa
- Manejo de catálogo nativo WhatsApp

---

### **FASE 3: Sistema de Perfiles de Usuario**
**Objetivo:** Aprender preferencias y personalizar

**Pasos:**

1. **Cargar/crear perfil del usuario**
   - Firebase: `users/{phoneNumber}/profile`
   - Instanciar `UserProfile` en cada request
   - Cargar historial de órdenes

2. **Actualizar perfil automáticamente**
   - `addOrder()` después de cada transacción
   - Calcular stats: favoritos, gasto total, frecuencia
   - Detectar VIP: 10+ órdenes O $500+ gastado

3. **Aplicar preferencias**
   - `applyPreferences()` modifica items automáticamente
   - Recordar alergias, aversiones, restricciones
   - Sugerir alternativas respetando preferencias

4. **Predicción de órdenes**
   - `predictNextOrder()` analiza intervalos
   - Sugerir "¿Hoy otro café como siempre?" a clientes frecuentes
   - Análisis: días desde última orden, promedio de frecuencia

5. **Personalización de mensajes**
   - `generatePersonalizedMessage()` por tipo de usuario
   - VIP: Ofrecer descuentos especiales
   - Frecuente: Acelerar proceso de orden
   - Nuevo: Explicar más opciones

**Archivos a Modificar:**
- `lib/session-store.js` - Persistencia en Firebase
- `api/kommo.js` - Instanciación y actualización de perfil

**Resultado Esperado:**
- Tasa de retención +35%
- Ticket promedio +25% (VIP upsell)
- Satisfacción +40% (personalización)

---

### **FASE 4: Contexto Multi-Turno y Conversación Natural**
**Objetivo:** Entender referencias y mantener conversación coherente

**Pasos:**

1. **Persistencia de contexto**
   - Guardar últimos 5-10 mensajes
   - Almacenar intención detectada por turno
   - Mantener estado de carrito

2. **Detección de anáforas**
   - "Eso" → referencia a última mención
   - "Dos más" → cantidad relativa
   - "Lo mismo" → repetir última orden
   - `detectAnaphora()` automáticamente resuelve

3. **Conversación sin máquina de estados**
   - Contexto reemplaza estado rígido
   - Usuario puede volver atrás ("cambiar pedido")
   - Retomar conversación después de días

4. **Recuperación de contexto**
   - Si usuario vuelve en 48h, mostrar contexto
   - "Veo que estabas pidiendo un café..."

**Archivos a Modificar:**
- `api/kommo.js` - Manejo de contexto en cada turno
- `lib/session-store.js` - Persistencia estructurada

**Resultado Esperado:**
- Conversación fluida y natural
- Comprensión de referencias contextuales
- Reducción de repetición de información 80%

---

### **FASE 5: Soporte Nativo de Catálogo WhatsApp**
**Objetivo:** Integración seamless con productos de catálogo

**Pasos:**

1. **Detección de mensaje de catálogo**
   - WhatsApp envía `productId` cuando usuario selecciona item
   - Detectar automáticamente en payload
   - Diferenciar de órdenes por texto/imagen

2. **Parsing de variantes**
   - Tamaño: pequeño/mediano/grande
   - Temperatura: caliente/frío
   - Extras: con/sin ají, etc.
   - `extractCatalogItemData()` estructura todo

3. **Flujo simplificado**
   - Mostrar precio actualizado de catálogo
   - Confirmar variantes seleccionadas
   - Agregar a carrito automáticamente
   - Buscar alternativas complementarias

4. **Sincronización precio**
   - Si hay descrepancia, catálogo > json local
   - Alertar admin si producto no existe

**Archivos a Modificar:**
- `api/kommo.js` - Nuevo handler para mensajes de catálogo
- `lib/smart-ocr.js` - Ya soporta catalogItemData()

**Resultado Esperado:**
- Conversión de catálogo +50%
- Reducción de pasos en orden a 2-3
- Verificación de inventario automática

---

### **FASE 6: Humanización de Respuestas**
**Objetivo:** Bot menos robótico, más conversacional

**Pasos:**

1. **Variación de templates**
   - Múltiples opciones por situación
   - Selección aleatoria (no repetitiva)
   - Tone matching: frustrado → empático

2. **Emojis contextuales**
   - ¿Orden? 🍕🛒
   - ¿Pago? 💳✅
   - ¿Problema? 🆘
   - ¿VIP? 👑✨

3. **Uso de nombre**
   - Guardar nombre del usuario
   - Usar en saludos: "Hola Juan, ¿qué tal?"
   - Personalizar: "Juan, para ti especial 10%"

4. **Detección de emoción**
   - Usuario frustrado: agradecer, ofrecer ayuda rápida
   - Usuario feliz: sugerir aún más
   - Usuario casual: ser más relajado

5. **Fechas y contexto temporal**
   - "Buen lunes" vs "Buen viernes"
   - Cumpleaños: descuento especial
   - Horarios: "¡Perfecto para la merienda!"

**Archivos a Modificar:**
- `lib/ai-engine.js` - Expandir `generateSmartResponse()`
- `lib/user-profile.js` - Guardar nombre, cumpleaños

**Resultado Esperado:**
- Percepción de humanidad +60%
- Engagement +45%
- Satisfaction score +50%

---

### **FASE 7: Inteligencia Empresarial (BI)**
**Objetivo:** Optimización de negocios con datos

**Pasos:**

1. **Detección de VIP**
   - Aplicar automáticamente: "Tienes 10% descuento VIP"
   - Prioritizar soporte
   - Sugerir productos premium

2. **Recomendaciones dinámicas**
   - Basadas en historial: "Con pizza siempre pides bebida"
   - Upsell: combo + bebida = +$3, +15% venta
   - Cross-sell: "Otros también piden..."

3. **Descuentos inteligentes**
   - Usuario inactivo 7 días: "Te extrañamos, -15%"
   - Cliente frecuente (3+ órdenes): programa de lealtad
   - Viernes: "Happy Hour, -20% después de 5pm"

4. **Análisis de comportamiento**
   - ¿Cuándo pide? (lunes=bajo, viernes=alto)
   - ¿Cuánto gasta? (segmentos de valor)
   - ¿Qué le gusta? (categoría favorita)

5. **Dashboard de métricas**
   - Tasa de conversión por intención
   - Valor promedio de orden por VIP
   - Preferencias poblacionales
   - Horas pico de actividad

**Archivos a Crear:**
- `lib/business-analytics.js` - Análisis y reportes
- `api/admin-dashboard.js` - Endpoint para métricas

**Resultado Esperado:**
- Revenue +40-60%
- Customer lifetime value +80%
- Churn rate -50%
- Predictability de demanda +95%

---

## 📊 ROADMAP TEMPORAL

| Fase | Descripción | Tiempo Est. | Prioridad | Depende de |
|------|------------|-------------|-----------|-----------|
| 1 | Integración Motor IA | 3-4 horas | 🔴 CRÍTICA | - |
| 2 | OCR Inteligente | 2-3 horas | 🔴 CRÍTICA | Fase 1 |
| 3 | Perfiles Usuario | 2-3 horas | 🟠 ALTA | Fase 1 |
| 4 | Contexto Multi-turno | 2 horas | 🟠 ALTA | Fase 1,3 |
| 5 | Catálogo WhatsApp | 1-2 horas | 🟡 MEDIA | Fase 2 |
| 6 | Humanización | 2 horas | 🟡 MEDIA | Fase 1,3 |
| 7 | Business Intelligence | 3-4 horas | 🟢 BAJA | Todas |

**Tiempo Total:** 15-21 horas de desarrollo

---

## ✅ CHECKLIST DE INTEGRACIÓN

### Antes de Empezar
- [ ] Todos los módulos están en `lib/`
- [ ] `ANALYSIS_AND_IMPROVEMENTS.md` está disponible
- [ ] Backup de `api/kommo.js` original
- [ ] Git en estado limpio

### Fase 1
- [ ] Importar módulos en kommo.js
- [ ] Crear instancia de ConversationContext
- [ ] Reemplazar findInJSON con detectIntention
- [ ] Implementar respuestas inteligentes
- [ ] Test: intenciones detectadas correctamente
- [ ] Test: respuestas variadas
- [ ] Test: sugerencias mostradas

### Fase 2
- [ ] Reemplazar OCR basic con smartOCRAnalysis
- [ ] Test: Clasificación de imágenes correcta
- [ ] Test: Extracción de datos precisa
- [ ] Test: Validación de recibos

### Fase 3
- [ ] Firebase setup para perfiles de usuario
- [ ] Cargar/guardar UserProfile
- [ ] Test: Historial se actualiza
- [ ] Test: Preferencias se aplican

### Fase 4
- [ ] Persistencia de contexto en Firebase
- [ ] Anáfora resolution
- [ ] Test: "Dos más" se entiende
- [ ] Test: Contexto se mantiene en segundos turnos

### Fase 5
- [ ] Detectar mensajes de catálogo WhatsApp
- [ ] Parsing de variantes
- [ ] Test: Items de catálogo funcionan

### Fase 6
- [ ] Expandir templates de respuesta
- [ ] Agregar emojis
- [ ] Usar nombre en respuestas
- [ ] Test: Respuestas variadas cada vez

### Fase 7
- [ ] Crear lib/business-analytics.js
- [ ] Implementar detección VIP
- [ ] Dashboard básico
- [ ] Test: Métricas correctas

---

## 🎯 OBJETIVOS FINALES

### Métricas de Éxito

| Métrica | Línea Base | Meta | Timeline |
|---------|-----------|------|----------|
| Precisión de Intención | 60% | 95%+ | Fase 1 |
| Conversion Rate | 25% | 35%+ | Fase 3,5 |
| Ticket Promedio | $15 | $20+ | Fase 6,7 |
| Customer Satisfaction | 70% | 90%+ | Fase 6 |
| Customer Retention | 40% | 75%+ | Fase 3,7 |
| Response Time | 2s | <1s | Fase 4 |
| Error Rate | 8% | <2% | Todas |

### Experiencia de Usuario

**Antes:**
```
Usuario: ¡hola! necesito una pizza
Bot: ¿Pizza? ok, tamaño?
Usuario: mediana
Bot: ¿Con qué ingredientes?
Usuario: como la anterior
Bot: No tengo registro
Usuario: 😠
```

**Después:**
```
Usuario: ¡hola! necesito una pizza como hace una semana
Bot: 👑 Hola Carlos! Recuerdo esa mediana especial que te encantó.
     ¿Repito? → $18 (igual de siempre)
     O ¿probamos nueva? → Margherita Premium → $21 (para ti: -10%)
Usuario: nueva porfa
Bot: ¡Excelente! Agrego bebida? 🥤 Con pizza siempre pides:
     • Coca 2L → +$5
     • Jugo naranja → +$4
     • Cerveza → +$6
Usuario: coca
Bot: ✅ Perfecto! Total $27 (envío $2) = $29
     🎁 VIP: Descuento -10% aplicado = $26.10
     Dirección: Av. Principal 123 ✓
     📱 Pago con Mercado Pago?
Usuario: dale
Bot: 💳 Link enviado: [mercadopago.com/...] 
     Llega en 35 min ⏱️
     Rastreo: [link] 📍
Usuario: ✅ (Satisfacción 99%)
```

---

## 🔧 CONFIGURACIÓN RECOMENDADA

```javascript
// .env o config.js
const AI_CONFIG = {
  intentionDetectionThreshold: 0.7,
  contextMemorySize: 10,
  suggestionCount: 3,
  vipThreshold: { orders: 10, spent: 500 },
  ocrConfidenceMinimum: 0.85,
  anaphoraTimeout: 300000, // 5 minutos
  personalMessageVariations: 5,
  recommendationAlgorithm: 'collaborative-filtering',
}
```

---

## 📚 REFERENCIAS

- `lib/ai-engine.js` - Motor de IA (540 líneas)
- `lib/smart-ocr.js` - OCR inteligente (480 líneas)  
- `lib/user-profile.js` - Perfiles (350 líneas)
- `ANALYSIS_AND_IMPROVEMENTS.md` - Análisis completo
- `api/kommo.js` - Handler principal a integrar

---

**Última actualización:** 2024
**Próximo paso:** FASE 1 - Integración del Motor de IA
