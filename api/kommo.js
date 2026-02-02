/**
 * api/kommo.js
 *
 * Supercerebro Kommo handler con Motor de IA Ultra-Mejorado
 * Detección inteligente de intenciones, análisis semántico, perfiles de usuario,
 * contexto multi-turno, y respuestas humanizadas
 */
import axios from "axios";
import admin from "firebase-admin";
import parseOrderText from "../lib/parse-order.js";
import { readImage, readImageBuffer, extractMostLikelyTotal, validateReceiptAgainstOrder, parseWhatsAppCatalogSnippet } from "../lib/ocr.js";
import { detectAddress, normalizeAddress } from "../lib/detect-address.js";
import pricing from "../lib/zona-precios.js";
import sessionStore from "../lib/session-store.js";
import aiEngineModule from "../lib/ai-engine.js";
import smartOcrModule from "../lib/smart-ocr.js";
import userProfileModule from "../lib/user-profile.js";

const { detectIntention, ConversationContext, generateSmartResponse, generateSuggestions, validateOrder, INTENTIONS } = aiEngineModule;
const { smartOCRAnalysis } = smartOcrModule;
const { UserProfile } = userProfileModule;
import fs from "fs";
import path from "path";

const menuPath = new URL("../data/menu.json", import.meta.url);
const synonymsPath = new URL("../data/sinonimos.json", import.meta.url);

const menu = JSON.parse(fs.readFileSync(menuPath, "utf8"));
const synonyms = JSON.parse(fs.readFileSync(synonymsPath, "utf8"));

// Logger wrapper
const log = (...args) => {
  const timestamp = new Date().toISOString();
  if (process.env.NODE_ENV === "production") {
    console.log(timestamp, ...args);
  } else {
    console.debug(timestamp, ...args);
  }
};

/* ---------- FIREBASE INIT ---------- */
if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
    sessionStore.initFirebase(admin);
    log("Firebase initialized");
  } catch (err) {
    console.warn("Firebase init failed, falling back to in-memory sessions:", err?.message || err);
  }
} else {
  sessionStore.initFirebase(admin);
}

// Session store compatibility wrappers
sessionStore.saveAddressForPhone = sessionStore.saveAddressForPhone || (async (phone, address, components) => {
  const data = { address: { address, components } };
  await sessionStore.saveSession(phone, data);
  return data;
});

sessionStore.saveOrderDraft = sessionStore.saveOrderDraft || (async (phone, draft) => {
  const data = { pedido_borrador: draft, estado: "pedido_borrador" };
  await sessionStore.saveSession(phone, data);
  return data;
});

/* ---------- AI Context Management ---------- */

/**
 * Cargar o crear contexto conversacional del usuario
 */
const getOrCreateContext = async (telefono, nombre) => {
  const session = await sessionStore.getSession(telefono);
  let context = session?.context;
  
  if (!context) {
    context = new ConversationContext(telefono, nombre);
  } else {
    // Restaurar contexto desde sesión
    context = Object.assign(new ConversationContext(telefono, nombre), context);
  }
  
  return context;
};

/**
 * Cargar o crear perfil del usuario
 */
const getOrCreateUserProfile = async (telefono, nombre) => {
  const session = await sessionStore.getSession(telefono);
  let profileData = session?.userProfile;
  
  let profile = new UserProfile(telefono, nombre);
  
  if (profileData) {
    // Restaurar perfil desde sesión
    profile.orders = profileData.orders || [];
    profile.preferences = profileData.preferences || {};
    profile.stats = profileData.stats || {};
    if (profileData.name) profile.name = profileData.name;
  }
  
  return profile;
};

/**
 * Guardar contexto en sesión
 */
const saveContextToSession = async (telefono, context, profile) => {
  const session = await sessionStore.getSession(telefono) || {};
  session.context = {
    userId: context.userId,
    userName: context.userName,
    recentMessages: context.recentMessages,
    currentIntention: context.currentIntention,
    previousIntentions: context.previousIntentions,
    preferences: context.preferences,
  };
  session.userProfile = {
    name: profile.name,
    phone: profile.phone,
    orders: profile.orders,
    preferences: profile.preferences,
    stats: profile.stats,
  };
  await sessionStore.saveSession(telefono, session);
};

/* ---------- Internal Helpers ---------- */

const formatMoney = (v) => (v == null ? "—" : `S/${Number(v).toFixed(2)}`);

const buildOrderSummaryText = (orderDraft, pricingResult) => {
  const lines = ["🧾 Resumen del pedido:"];
  for (const it of orderDraft.items) {
    const qty = it.quantity || 1;
    const name = it.name || it.id;
    const variant = it.variant ? ` (${it.variant})` : "";
    const unit = it.unitPrice != null ? formatMoney(it.unitPrice) : "precio a confirmar";
    const lineTotal = it.price != null ? formatMoney(it.price) : "—";
    lines.push(`• ${qty} x ${name}${variant} — ${unit} — ${lineTotal}`);
  }
  lines.push("");
  lines.push(`Subtotal: ${formatMoney(pricingResult.subtotal)}`);
  if (pricingResult.discounts && pricingResult.discounts > 0) lines.push(`Descuentos: -${formatMoney(pricingResult.discounts)}`);
  if (pricingResult.tax && pricingResult.tax > 0) lines.push(`Impuestos: ${formatMoney(pricingResult.tax)}`);
  if (pricingResult.deliveryFee && pricingResult.deliveryFee > 0) lines.push(`Delivery: ${formatMoney(pricingResult.deliveryFee)}`);
  lines.push(`Total a cobrar: *${formatMoney(pricingResult.total)}*`);
  return lines.join("\n");
};

const safeParseJSON = (s, fallback = null) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

const notifyAgent = async (payload) => {
  const url = process.env.AGENT_WEBHOOK;
  if (!url) return;
  try {
    await axios.post(url, payload, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    log("notifyAgent failed:", err?.message || err);
  }
};

/* ---------- Order State & Transitions ---------- */
/*
  Main states:
  - inicio
  - pedido_borrador
  - direccion
  - pedido_confirmado (total calculado)
  - pago_verificacion (comprobante recibido)
  - pagado
  - preparacion
  - en_reparto
  - entregado
  - cancelado
*/

/* ---------- Delivery & Total Calculation Utilities ---------- */

const calculateDeliveryAndTotal = (items, addressComponents = {}, options = {}) => {
  const rules = menu.reglas || [];
  const calc = pricing.calculateOrderTotal(items, menu, rules, { taxRate: options.taxRate || 0, rounding: 0.01, delivery: options.delivery || null });
  return {
    breakdown: {
      subtotal: calc.subtotal,
      discounts: calc.discounts,
      delivery: calc.deliveryFee,
      tax: calc.tax
    },
    total: calc.total,
    details: calc.itemsDetailed,
    appliedRules: calc.appliedRules,
    zone: calc.zone || null
  };
};

const calculateRouteAndFee = (storeCoords, destCoords, options = {}) => {
  try {
    if (typeof pricing.calculateRoutePrice === "function") {
      return pricing.calculateRoutePrice(storeCoords, destCoords, options);
    }
  } catch (err) {
    log("pricing.calculateRoutePrice failed:", err?.message || err);
  }

  // fallback: haversine
  const R = 6371;
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(destCoords.lat - storeCoords.lat);
  const dLon = toRad(destCoords.lon - storeCoords.lon);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(storeCoords.lat))*Math.cos(toRad(destCoords.lat))*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const km = R * c;
  const base = Number(process.env.DELIVERY_BASE_FEE || 3.5);
  const perKm = Number(process.env.DELIVERY_PER_KM || 1.2);
  const price = Math.max(base, Math.round((base + perKm * km) * 100) / 100);
  return { distanceKm: Number(km.toFixed(2)), price };
};

/* ---------- Core handler ---------- */

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ 
      ok: true, 
      service: "KOMMO IA", 
      status: "running", 
      version: "2.0-ultra-inteligente",
      features: ["ai-engine", "smart-ocr", "user-profiles", "semantic-analysis", "context-awareness"],
      env: { firebase: !!process.env.FIREBASE_PROJECT_ID } 
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { body } = req;
    const nombre = body.nombre || "Cliente";
    const telefono = body.telefono;
    const mensaje = (body.mensaje || "").toString();
    const tipo = body.tipo || "text";
    const imagen = body.imagen || null;
    const ubicacion = body.ubicacion || null;
    const debug = !!body.debug;

    if (!telefono) {
      return res.status(400).json({ ok: false, reply: "❌ No se pudo identificar el cliente." });
    }

    log("Incoming message", { telefono, tipo, mensaje: mensaje.slice(0, 120) });

    // Load session
    const session = await sessionStore.getSession(telefono);
    
    // Load AI context y user profile
    const context = await getOrCreateContext(telefono, nombre);
    const userProfile = await getOrCreateUserProfile(telefono, nombre);

    // Helper to persist and return reply
    const persistAndReply = async (newSessionData, replyObj) => {
      // Guardar contexto y perfil actualizado
      await saveContextToSession(telefono, context, userProfile);
      // Guardar sesión con datos adicionales
      newSessionData = newSessionData || {};
      newSessionData.context = context;
      newSessionData.userProfile = { name: userProfile.name, orders: userProfile.orders, preferences: userProfile.preferences, stats: userProfile.stats };
      await sessionStore.saveSession(telefono, newSessionData);
      return res.json(replyObj);
    };

    /* ---------- IMAGE (URL) - Smart OCR ---------- */
    if (tipo === "image" && imagen) {
      try {
        const ocrResult = await readImage(imagen, { debug });
        const smartAnalysis = await smartOCRAnalysis(ocrResult, { userProfile, menu, debug });
        
        log("Smart OCR analysis:", { imageType: smartAnalysis.imageType, confidence: smartAnalysis.confidence });
        
        // Actualizar contexto
        context.addMessage("user", "[imagen]", { type: smartAnalysis.imageType });
        context.currentIntention = "PAYMENT"; // Por defecto, imágenes son comprobantes
        
        if (smartAnalysis.imageType === "RECEIPT" || smartAnalysis.imageType === "SCREENSHOT") {
          const detected = smartAnalysis.data?.amount;
          if (!detected) {
            const reply = generateSmartResponse(context, "help_image_quality", userProfile);
            return persistAndReply({ estado: "pago_verificacion" }, { reply });
          }
          
          const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
          const draft = pedido || pedido_borrador || null;

          if (draft?.items?.length) {
            const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
            const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01 });
            const validation = validateReceiptAgainstOrder(ocrResult, { items: draft.items, expectedTotal: calc.total }, menu, { tolerance: Number(process.env.PAYMENT_TOLERANCE || 0.06), debug });

            if (validation.ok) {
              // Actualizar perfil con orden pagada
              userProfile.addOrder({
                items: draft.items,
                total: validation.detectedTotal,
                date: new Date(),
                method: "receipt",
                verified: true
              });
              
              context.currentIntention = "ORDER_REPEAT";
              const reply = generateSmartResponse(context, "payment_confirmed", userProfile, { amount: validation.detectedTotal });
              
              await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "comprobante", amount: validation.detectedTotal, ocr: ocrResult } });
              await notifyAgent({ event: "order_paid", telefono, pedido: draft, amount: validation.detectedTotal });
              
              return persistAndReply({}, { reply });
            } else {
              const reply = generateSmartResponse(context, "payment_mismatch", userProfile, { detected: detected, expected: calc.total });
              return persistAndReply({ estado: "pago_verificacion", comprobante: { detected: detected, ocr: ocrResult, validation } }, { reply });
            }
          } else {
            const reply = generateSmartResponse(context, "receipt_no_order", userProfile, { amount: detected });
            return persistAndReply({ estado: "pago_verificacion", comprobante: { detected: detected, ocr: ocrResult } }, { reply });
          }
        } else if (smartAnalysis.imageType === "MENU" || smartAnalysis.imageType === "CATALOG_ITEM") {
          const extractedItems = smartAnalysis.data?.items || [];
          if (extractedItems.length > 0) {
            const reply = `📸 Detecté un ${smartAnalysis.imageType === "MENU" ? "menú" : "producto"} en la imagen.\n` +
                         extractedItems.slice(0, 3).map(it => `• ${it.name} - ${it.price ? `S/${it.price}` : "precio no especificado"}`).join("\n") +
                         "\n¿Quieres agregar alguno al pedido?";
            return persistAndReply({}, { reply });
          }
        }
        
        // Fallback
        const detected = extractMostLikelyTotal(ocrResult);
        await sessionStore.saveSession(telefono, { lastOCR: ocrResult, estado: "pago_verificacion" });
        const reply = generateSmartResponse(context, "image_received", userProfile, { amount: detected });
        return persistAndReply({}, { reply });
        
      } catch (err) {
        log("OCR image error:", err?.message || err);
        const reply = generateSmartResponse(context, "help_image_quality", userProfile);
        return persistAndReply({}, { reply });
      }
    }

    /* ---------- IMAGE BUFFER (base64) ---------- */
    if (tipo === "image_buffer" && body.imageBase64) {
      try {
        const buffer = Buffer.from(body.imageBase64, "base64");
        const ocrResult = await readImageBuffer(buffer, "upload.jpg", { debug });
        const detected = extractMostLikelyTotal(ocrResult);
        await sessionStore.saveSession(telefono, { lastOCR: ocrResult, estado: "pago_verificacion" });
        if (!detected) return res.json({ reply: "📸 Imagen recibida, pero no pude leer el monto. ¿Puedes enviarla más clara?" });
        return res.json({ reply: `✅ Comprobante detectado por ${formatMoney(detected)}. ¿Deseas que lo valide con tu pedido?` });
      } catch (err) {
        log("OCR buffer error:", err?.message || err);
        return res.json({ reply: "📸 No pude procesar la imagen. Intenta enviar una foto más clara o escribe el monto manualmente." });
      }
    }

    /* ---------- LOCATION (lat/lon) ---------- */
    if (tipo === "location" && ubicacion?.lat && ubicacion?.lon) {
      try {
        const storeCoords = { lat: Number(process.env.STORE_LAT || -12.068), lon: Number(process.env.STORE_LON || -77.036) };
        const destCoords = { lat: Number(ubicacion.lat), lon: Number(ubicacion.lon) };
        const route = calculateRouteAndFee(storeCoords, destCoords, { base: Number(process.env.DELIVERY_BASE_FEE || 3.5), perKm: Number(process.env.DELIVERY_PER_KM || 1.2) });
        const address = `Coordenadas ${destCoords.lat}, ${destCoords.lon}`;
        const components = { lat: destCoords.lat, lon: destCoords.lon };

        await sessionStore.saveSession(telefono, { estado: "direccion", address: { address, components }, delivery: route.price });

        const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
        const draft = pedido || pedido_borrador || null;

        if (draft?.items?.length) {
          const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
          const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01, delivery: { base: route.price } });
          await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: draft.items, pricing: calc }, address: { address, components } });
          return res.json({ reply: `📍 Delivery calculado: ${formatMoney(route.price)} (distancia ${route.distanceKm} km).\nTotal a cobrar: ${formatMoney(calc.total)}. ¿Deseas confirmar el pedido y pagar ahora?` });
        }
        return res.json({ reply: `📍 Delivery estimado: ${formatMoney(route.price)} (distancia ${route.distanceKm} km). ¿Deseas que calcule el total si me envías tu pedido?` });
      } catch (err) {
        log("Location handling error:", err?.message || err);
        return res.json({ reply: "No pude calcular la ruta. ¿Puedes enviar la dirección en texto?" });
      }
    }

    /* ---------- TEXT: Intelligent Processing with AI Engine ---------- */
    
    // Agregar mensaje al contexto
    context.addMessage("user", mensaje);
    
    // Detectar intención con el motor de IA
    const intentionResult = detectIntention(mensaje, context);
    const intention = intentionResult.intention;
    context.currentIntention = intention;
    
    log("Detected intention:", { type: intention, confidence: intentionResult.confidence, context: context.userId });

    // Manejar diferentes intenciones
    if (intention === INTENTIONS.GREETING || intention === INTENTIONS.SMALLTALK) {
      const reply = generateSmartResponse(context, "greeting", userProfile);
      return persistAndReply({}, { reply });
    }

    if (intention === INTENTIONS.HELP) {
      const topCats = (menu.categorias || []).slice(0, 4).map(c => `• ${c.nombre} (${(c.productos||[]).length} items)`).join("\n");
      const reply = generateSmartResponse(context, "menu_available", userProfile, { categories: topCats });
      return persistAndReply({}, { reply });
    }

    // Detectar dirección en el mensaje
    const addrDetection = detectAddress(mensaje);
    if (addrDetection && addrDetection.address && (intention === INTENTIONS.HELP || session?.estado === "direccion")) {
      context.currentIntention = INTENTIONS.HELP;
      await sessionStore.saveAddressForPhone(telefono, addrDetection.address, addrDetection.components);

      const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
      const draft = pedido || pedido_borrador || null;

      if (draft?.items?.length) {
        const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
        const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01, delivery: { addressComponents: addrDetection.components } });
        await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: draft.items, pricing: calc }, address: { address: addrDetection.address, components: addrDetection.components } });
        
        const suggestions = generateSuggestions(draft.items, userProfile, menu);
        const reply = `📍 Dirección detectada: ${addrDetection.address}\n` +
                     `Total a cobrar: ${formatMoney(calc.total)}\n` +
                     `${buildOrderSummaryText(draft, calc)}\n` +
                     (suggestions.length > 0 ? `\n💡 Te sugiero: ${suggestions.slice(0, 2).map(s => s.name).join(", ")}\n` : "") +
                     `¿Confirmas y deseas pagar ahora?`;
        return persistAndReply({ estado: "pedido_confirmado" }, { reply });
      }
      const reply = generateSmartResponse(context, "address_received", userProfile, { address: addrDetection.address });
      return persistAndReply({ address: { address: addrDetection.address, components: addrDetection.components } }, { reply });
    }

    // Intentar parsear orden del mensaje
    if (intention === INTENTIONS.ORDER_NEW || intention === INTENTIONS.ORDER_REPEAT) {
      try {
        let parsed;
        
        // Si es ORDER_REPEAT y hay orden previa, usar esa
        if (intention === INTENTIONS.ORDER_REPEAT && userProfile.orders.length > 0) {
          const lastOrder = userProfile.getLastOrder();
          if (lastOrder?.items) {
            parsed = { items: lastOrder.items };
            log("Using last order for repeat");
          }
        }
        
        // Si no, intentar parsear el mensaje
        if (!parsed) {
          parsed = parseOrderText(mensaje, menu, { synonyms, debug });
        }

        if (parsed?.items?.length) {
          // Aplicar preferencias del usuario
          userProfile.applyPreferences(parsed.items);
          
          await sessionStore.saveOrderDraft(telefono, parsed);

          const { address } = await sessionStore.getSession(telefono) || {};
          const itemsForCalc = parsed.items.map(it => {
            const prod = pricing.findProductInMenu(menu, it.id);
            const unitPrice = prod ? pricing.applyVariantPrice(prod, it.variant) ?? prod.precio ?? null : it.price ?? it.priceHint ?? null;
            return { id: it.id, name: it.name, quantity: it.quantity, variant: it.variant, unitPrice, extras: it.extras || [] };
          });

          // Validar orden
          const validation = validateOrder(parsed);
          if (validation.errors.length > 0) {
            const reply = generateSmartResponse(context, "order_incomplete", userProfile, { errors: validation.errors });
            return persistAndReply({ pedido_borrador: parsed }, { reply });
          }

          if (address?.components) {
            const calc = calculateDeliveryAndTotal(itemsForCalc, address.components, { taxRate: 0 });
            
            const suggestions = generateSuggestions(itemsForCalc, userProfile, menu);
            let reply = `✅ Pedido recibido y total calculado.\n${buildOrderSummaryText({ items: itemsForCalc }, calc)}`;
            if (suggestions.length > 0) {
              reply += `\n\n💡 Para completar: ${suggestions.slice(0, 2).map(s => s.name).join(", ")}?`;
            }
            reply += `\n¿Confirmas y deseas pagar ahora?`;
            
            await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: itemsForCalc, pricing: calc }, address });
            return persistAndReply({ estado: "pedido_confirmado" }, { reply });
          } else {
            let reply = `✅ Pedido recibido: ${parsed.items.map(i => `${i.quantity}x ${i.name}`).join(", ")}.\n📍 ¿Delivery o recojo? Si es delivery, envía tu dirección o ubicación.`;
            
            const suggestions = generateSuggestions(itemsForCalc, userProfile, menu);
            if (suggestions.length > 0) {
              reply += `\n\n💡 También pedimos: ${suggestions.slice(0, 2).map(s => s.name).join(", ")}?`;
            }
            
            return persistAndReply({ pedido_borrador: parsed }, { reply });
          }
        }
      } catch (err) {
        log("parseOrderText error:", err?.message || err);
      }
    }

    // Manejo de pagos
    if (intention === INTENTIONS.PAYMENT) {
      const lower = mensaje.toLowerCase();
      const amountMatch = mensaje.match(/([0-9]+(?:[.,][0-9]{1,2})?)/);
      const amount = amountMatch ? Number(String(amountMatch[1]).replace(",", ".")) : null;

      const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
      const draft = pedido || pedido_borrador || null;

      if (draft?.items?.length) {
        const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
        const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01 });

        if (amount != null) {
          const diff = Math.abs(calc.total - amount);
          const tol = Number(process.env.PAYMENT_TOLERANCE || 0.06);
          if (diff <= calc.total * tol) {
            // Actualizar perfil con orden pagada
            userProfile.addOrder({
              items: draft.items,
              total: amount,
              date: new Date(),
              method: "manual",
              verified: true
            });
            
            const reply = generateSmartResponse(context, "payment_confirmed", userProfile, { amount });
            await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "manual", amount } });
            await notifyAgent({ event: "order_paid_manual", telefono, amount, pedido: draft });
            
            return persistAndReply({ estado: "pagado" }, { reply });
          } else {
            const reply = generateSmartResponse(context, "payment_mismatch", userProfile, { detected: amount, expected: calc.total });
            return persistAndReply({ estado: "pago_verificacion" }, { reply });
          }
        }
      } else {
        const reply = generateSmartResponse(context, "no_order_found", userProfile);
        return persistAndReply({}, { reply });
      }
    }

    // Status de pedido
    if (intention === INTENTIONS.STATUS) {
      const current = await sessionStore.getSession(telefono);
      if (!current?.pedido) {
        const reply = generateSmartResponse(context, "no_order_found", userProfile);
        return persistAndReply({}, { reply });
      }
      
      const st = current.estado || "inicio";
      const replyMap = {
        inicio: { key: "no_active_order", data: {} },
        pedido_borrador: { key: "order_draft", data: {} },
        pedido_confirmado: { key: "order_confirmed", data: { total: current.pedido.pricing?.total } },
        pagado: { key: "payment_received", data: {} },
        preparacion: { key: "order_preparing", data: {} },
        en_reparto: { key: "order_dispatched", data: { driver: current.repartidor?.nombre, phone: current.repartidor?.telefono } },
        entregado: { key: "order_delivered", data: {} },
        cancelado: { key: "order_cancelled", data: {} }
      };
      
      const replyConfig = replyMap[st] || { key: "unknown_status", data: { status: st } };
      const reply = generateSmartResponse(context, replyConfig.key, userProfile, replyConfig.data);
      return persistAndReply({}, { reply });
    }

    // Cancelación
    if (intention === INTENTIONS.CANCEL) {
      const current = await sessionStore.getSession(telefono);
      if (current?.pedido && current.estado !== "entregado" && current.estado !== "cancelado") {
        const reply = generateSmartResponse(context, "order_cancelled", userProfile);
        await sessionStore.saveSession(telefono, { estado: "cancelado", cancelado: new Date() });
        return persistAndReply({ estado: "cancelado" }, { reply });
      } else {
        const reply = generateSmartResponse(context, "cannot_cancel", userProfile);
        return persistAndReply({}, { reply });
      }
    }

    // Queja o feedback
    if (intention === INTENTIONS.COMPLAINT || intention === INTENTIONS.FEEDBACK) {
      const reply = generateSmartResponse(context, intention === INTENTIONS.COMPLAINT ? "complaint_received" : "feedback_received", userProfile);
      await notifyAgent({ event: "user_feedback", telefono, type: intention, message: mensaje, userProfile: { name: userProfile.name, vipStatus: userProfile.isVIP() } });
      return persistAndReply({}, { reply });
    }

    // Fallback amigable
    const reply = generateSmartResponse(context, "fallback", userProfile);
    return persistAndReply({}, { reply });

  } catch (err) {
    log("KOMMO handler error:", err?.message || err, err?.stack || "");
    return res.status(500).json({ reply: "⚠️ Ocurrió un error. Un asesor humano continuará." });
  }
}
