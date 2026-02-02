/**
 * api/kommo.js
 *
 * Supercerebro Kommo handler (ultrarrobusto)
 *
 * Requisitos:
 *  - lib/ocr.js (readImage, readImageBuffer, extractMostLikelyTotal, validateReceiptAgainstOrder)
 *  - lib/parse-order.js (parseOrderText default export)
 *  - lib/detect-address.js (detectAddress)
 *  - lib/zoma-precios.js (calculateOrderTotal, calculateRoutePrice)
 *  - lib/session-store.js (initFirebase, getSession, saveSession, clearSession, saveAddressForPhone, saveOrderDraft)
 *  - data/menu.json
 *  - data/sinonimos.json
 *
 * Variables de entorno recomendadas:
 *  - FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *  - GOOGLE_API_KEY or OCR_API_KEY
 *  - STORE_LAT, STORE_LON
 *  - DELIVERY_BASE_FEE, DELIVERY_PER_KM
 *  - PAYMENT_TOLERANCE (0.06 default)
 *  - AGENT_WEBHOOK (opcional)
 *
 * Nota: este archivo es intencionalmente detallado y extensible.
 */
import admin from "firebase-admin";
import parseOrderText from "../lib/parse-order.js";
import { readImage, readImageBuffer, extractMostLikelyTotal, validateReceiptAgainstOrder, parseWhatsAppCatalogSnippet } from "../lib/ocr.js";
import { detectAddress, normalizeAddress } from "../lib/detect-address.js";
import pricing from "../lib/zoma-precios.js";
import sessionStore from "../lib/session-store.js";
import menu from "../data/menu.json" assert { type: "json" };
import synonyms from "../data/sinonimos.json" assert { type: "json" };
// Optional: a simple logger wrapper
function log(...args) {
  if (process.env.NODE_ENV === "production") {
    console.log(new Date().toISOString(), ...args);
  } else {
    console.debug(new Date().toISOString(), ...args);
  }
}

/* ---------- FIREBASE INIT (si está configurado) ---------- */
if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") : undefined
      }),
    });
    sessionStore.initFirebase(admin);
    log("Firebase initialized");
  } catch (err) {
    console.warn("Firebase init failed, falling back to in-memory sessions:", err?.message || err);
  }
} else {
  // ensure sessionStore uses fallback if firebase not configured
  sessionStore.initFirebase(admin);
}

/* ---------- Helpers internos ---------- */

/**
 * formatMoney
 */
function formatMoney(v) {
  if (v == null) return "—";
  return `S/${Number(v).toFixed(2)}`;
}

/**
 * buildOrderSummaryText
 * - Construye un texto amigable para enviar al cliente con el detalle del pedido y totales.
 */
function buildOrderSummaryText(orderDraft, pricingResult) {
  const lines = [];
  lines.push("🧾 Resumen del pedido:");
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
}

/**
 * safeParseJSON
 */
function safeParseJSON(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

/**
 * notifyAgent (webhook)
 * - Llama a webhook de agente si está configurado para notificar pedidos que requieren intervención.
 */
async function notifyAgent(payload) {
  const url = process.env.AGENT_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    log("notifyAgent failed:", err?.message || err);
  }
}

/* ---------- Estado de pedido y transiciones ---------- */
/*
  Estados principales:
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

/* ---------- Utilidades de cálculo de delivery y totales ---------- */

/**
 * calculateDeliveryAndTotal
 * - items: array { id, quantity, variant, extras }
 * - addressComponents: object (puede contener lat/lon o district)
 * - options: { taxRate, timeZone }
 *
 * Devuelve objeto con breakdown y total (usa lib/zoma-precios.js)
 */
function calculateDeliveryAndTotal(items, addressComponents = {}, options = {}) {
  // zoma-precios.calculateOrderTotal espera items y menu/reglas
  const rules = menu.reglas || [];
  const calc = pricing.calculateOrderTotal(items, menu, rules, { taxRate: options.taxRate || 0, rounding: 0.01, delivery: options.delivery || null });
  // calc: { itemsDetailed, subtotal, discounts, deliveryFee, tax, total, appliedRules }
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
}

/**
 * calculateRouteAndFee
 * - storeCoords: { lat, lon }
 * - destCoords: { lat, lon }
 * - options: { base, perKm }
 *
 * Devuelve { distanceKm, price }
 */
function calculateRouteAndFee(storeCoords, destCoords, options = {}) {
  // Usa zoma-precios.calculateRoutePrice si existe, si no, simple haversine
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
}

/* ---------- Core handler ---------- */

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "KOMMO IA", status: "running", env: { firebase: !!process.env.FIREBASE_PROJECT_ID } });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const nombre = body.nombre || "Cliente";
    const telefono = body.telefono;
    const mensaje = (body.mensaje || "").toString();
    const tipo = body.tipo || "text";
    const imagen = body.imagen || null;
    const ubicacion = body.ubicacion || null;
    const debug = !!body.debug;

    if (!telefono) return res.status(400).json({ ok: false, reply: "❌ No se pudo identificar el cliente." });

    log("Incoming message", { telefono, tipo, mensaje: mensaje.slice(0, 120) });

    // Load session
    const session = await sessionStore.getSession(telefono);

    // Helper to persist and return reply
    async function persistAndReply(newSessionData, replyObj) {
      await sessionStore.saveSession(telefono, newSessionData);
      return res.json(replyObj);
    }

    /* ---------- IMAGE (URL) ---------- */
    if (tipo === "image" && imagen) {
      try {
        const ocrResult = await readImage(imagen, { debug });
        const detected = extractMostLikelyTotal(ocrResult);
        // Save raw OCR in session for later validation
        await sessionStore.saveSession(telefono, { lastOCR: ocrResult, estado: "pago_verificacion" });
        if (!detected) {
          return res.json({ reply: "📸 Imagen recibida, pero no pude leer el monto. ¿Puedes enviarla más clara o escribir el monto?" });
        }
        // If we have a draft order in session, attempt auto-validate
        const current = await sessionStore.getSession(telefono);
        const draft = current?.pedido || current?.pedido_borrador || null;
        if (draft && draft.items && draft.items.length) {
          // compute expected total
          const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
          const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01 });
          const validation = validateReceiptAgainstOrder(ocrResult, { items: draft.items, expectedTotal: calc.total }, menu, { tolerance: Number(process.env.PAYMENT_TOLERANCE || 0.06), debug });
          if (validation.ok) {
            // mark as paid and move to preparation
            await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "comprobante", amount: validation.detectedTotal, ocr: ocrResult } });
            // notify agent if needed
            await notifyAgent({ event: "order_paid", telefono, pedido: draft, amount: validation.detectedTotal });
            return res.json({ reply: `✅ Pago validado por ${formatMoney(validation.detectedTotal)}. Tu pedido está confirmado y en preparación.` });
          } else {
            // save comprobante for manual review
            await sessionStore.saveSession(telefono, { estado: "pago_verificacion", comprobante: { detected: detected, ocr: ocrResult, validation } });
            return res.json({ reply: `⚠️ Detecté S/${detected} en el comprobante. No coincide exactamente con el total del pedido. ¿Deseas que lo revise un agente o prefieres enviar el monto manualmente?` });
          }
        } else {
          // no draft: ask user to confirm which order this comprobante corresponde to
          await sessionStore.saveSession(telefono, { estado: "pago_verificacion", comprobante: { detected: detected, ocr: ocrResult } });
          return res.json({ reply: `✅ Comprobante detectado por ${formatMoney(detected)}. ¿A qué pedido corresponde? Si ya enviaste tu pedido, responde "es mi pedido" o envía el número de pedido.` });
        }
      } catch (err) {
        log("OCR image error:", err?.message || err);
        return res.json({ reply: "📸 No pude procesar la imagen. Intenta enviar una foto más clara o escribe el monto manualmente." });
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
        // Save address as coordinates
        await sessionStore.saveSession(telefono, { estado: "direccion", address: { address: `Coordenadas ${destCoords.lat}, ${destCoords.lon}`, components: { lat: destCoords.lat, lon: destCoords.lon } }, delivery: route.price });
        // If there is a draft order, compute total
        const current = await sessionStore.getSession(telefono);
        const draft = current?.pedido || current?.pedido_borrador || null;
        if (draft && draft.items && draft.items.length) {
          const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
          const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01, delivery: { base: route.price } });
          await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: draft.items, pricing: calc }, address: { address: `Coordenadas ${destCoords.lat}, ${destCoords.lon}`, components: { lat: destCoords.lat, lon: destCoords.lon } } });
          return res.json({ reply: `📍 Delivery calculado: ${formatMoney(route.price)} (distancia ${route.distanceKm} km).\nTotal a cobrar: ${formatMoney(calc.total)}. ¿Deseas confirmar el pedido y pagar ahora?` });
        }
        return res.json({ reply: `📍 Delivery estimado: ${formatMoney(route.price)} (distancia ${route.distanceKm} km). ¿Deseas que calcule el total si me envías tu pedido?` });
      } catch (err) {
        log("Location handling error:", err?.message || err);
        return res.json({ reply: "No pude calcular la ruta. ¿Puedes enviar la dirección en texto?" });
      }
    }

    /* ---------- TEXT: detect address ---------- */
    const addrDetection = detectAddress(mensaje);
    if (addrDetection && addrDetection.address) {
      // Save address
      await sessionStore.saveAddressForPhone(telefono, addrDetection.address, addrDetection.components);
      // If draft exists, calculate total
      const current = await sessionStore.getSession(telefono);
      const draft = current?.pedido || current?.pedido_borrador || null;
      if (draft && draft.items && draft.items.length) {
        const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
        const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01, delivery: { addressComponents: addrDetection.components } });
        await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: draft.items, pricing: calc }, address: { address: addrDetection.address, components: addrDetection.components } });
        return res.json({ reply: `📍 Dirección detectada: ${addrDetection.address}\nTotal a cobrar: ${formatMoney(calc.total)}\n${buildOrderSummaryText(draft, calc)}\n¿Confirmas y deseas pagar ahora?` });
      }
      return res.json({ reply: `📍 Dirección detectada: ${addrDetection.address}\n¿Deseas que calcule el costo total ahora o prefieres enviar tu pedido primero?` });
    }

    /* ---------- TEXT: user asks for menu or catalog ---------- */
    if (mensaje.toLowerCase().includes("menu") || mensaje.toLowerCase().includes("carta") || mensaje.toLowerCase().includes("catalogo")) {
      // Provide a short menu summary and offer to send full catalog (agent)
      const topCats = (menu.categorias || []).slice(0, 4).map(c => `• ${c.nombre} (${(c.productos||[]).length} items)`).join("\n");
      return res.json({ reply: `📋 Nuestro menú:\n${topCats}\nEscribe el nombre del plato o envía tu pedido. Si quieres, puedo enviarte el catálogo completo.` });
    }

    /* ---------- TEXT: parse order from message ---------- */
    // Try to parse order using parse-order module
    try {
      const parsed = parseOrderText(mensaje, menu, { synonyms, debug });
      if (parsed && parsed.items && parsed.items.length) {
        // Save draft
        await sessionStore.saveOrderDraft(telefono, parsed);
        // If address exists in session, compute total immediately
        const current = await sessionStore.getSession(telefono);
        const address = current?.address?.components || null;
        const itemsForCalc = parsed.items.map(it => {
          // resolve unitPrice from menu if possible
          const prod = pricing.findProductInMenu(menu, it.id);
          const unitPrice = prod ? pricing.applyVariantPrice(prod, it.variant) ?? prod.precio ?? null : it.price ?? it.priceHint ?? null;
          return { id: it.id, name: it.name, quantity: it.quantity, variant: it.variant, unitPrice, extras: it.extras || [] };
        });
        if (address) {
          const calc = calculateDeliveryAndTotal(itemsForCalc, address, { taxRate: 0 });
          await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: itemsForCalc, pricing: calc }, address: current.address });
          return res.json({ reply: `✅ Pedido recibido y total calculado.\n${buildOrderSummaryText({ items: itemsForCalc }, calc)}\n¿Confirmas y deseas pagar ahora?` });
        } else {
          // Ask for delivery or pickup
          return res.json({ reply: `✅ Pedido recibido: ${parsed.items.map(i => `${i.quantity}x ${i.name}`).join(", ")}.\n¿Delivery o recojo? Si es delivery, por favor envía tu dirección o ubicación.` });
        }
      }
    } catch (err) {
      log("parseOrderText error:", err?.message || err);
      // continue to other handlers
    }

    /* ---------- TEXT: user confirms payment manually (e.g., "pague con yape S/24") ---------- */
    const lower = mensaje.toLowerCase();
    if (/yape|plin|plin|transferencia|transfer|pago|pagado|pague|pagu[eé]/i.test(lower) && /\d/.test(lower)) {
      // try to extract amount
      const amountMatch = mensaje.match(/([0-9]+(?:[.,][0-9]{1,2})?)/);
      const amount = amountMatch ? Number(String(amountMatch[1]).replace(",", ".")) : null;
      const current = await sessionStore.getSession(telefono);
      const draft = current?.pedido || current?.pedido_borrador || null;
      if (draft && draft.items && draft.items.length) {
        // compute expected total
        const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
        const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01 });
        // If amount provided, compare
        if (amount != null) {
          const diff = Math.abs(calc.total - amount);
          const tol = Number(process.env.PAYMENT_TOLERANCE || 0.06);
          if (diff <= calc.total * tol) {
            // accept payment
            await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "manual", amount } });
            await notifyAgent({ event: "order_paid_manual", telefono, amount, pedido: draft });
            return res.json({ reply: `✅ Pago registrado por ${formatMoney(amount)}. Tu pedido está confirmado y en preparación.` });
          } else {
            // mismatch
            await sessionStore.saveSession(telefono, { estado: "pago_verificacion", comprobante: { method: "manual", amount, note: "monto no coincide" } });
            return res.json({ reply: `⚠️ El monto que indicas (${formatMoney(amount)}) no coincide con el total calculado (${formatMoney(calc.total)}). ¿Deseas que lo revise un agente?` });
          }
        } else {
          return res.json({ reply: "¿Puedes indicar el monto que pagaste (ej.: S/24.00) y el método (Yape/Plin)?" });
        }
      } else {
        return res.json({ reply: "No encuentro un pedido asociado a tu número. Por favor envía tu pedido primero." });
      }
    }

    /* ---------- TEXT: user asks status (ej. "estado", "mi pedido") ---------- */
    if (/\b(estado|mi pedido|seguimiento|track|enviado|salio)\b/i.test(lower)) {
      const current = await sessionStore.getSession(telefono);
      if (!current || !current.pedido) return res.json({ reply: "No tengo un pedido asociado a tu número. ¿Deseas hacer un pedido ahora?" });
      const st = current.estado || "inicio";
      const replyMap = {
        inicio: "No hay pedido activo.",
        pedido_borrador: "Tienes un pedido en borrador. ¿Deseas confirmarlo?",
        pedido_confirmado: `Tu pedido está confirmado. Total: ${formatMoney(current.pedido.pricing?.total ?? 0)}.`,
        pagado: "Tu pago fue recibido. El pedido está en preparación.",
        preparacion: "Tu pedido está en preparación.",
        en_reparto: `Tu pedido está en reparto. Repartidor: ${current.repartidor?.nombre || "—"} Tel: ${current.repartidor?.telefono || "—"}`,
        entregado: "Tu pedido fue entregado. ¡Gracias!",
        cancelado: "Tu pedido fue cancelado."
      };
      return res.json({ reply: replyMap[st] || `Estado actual: ${st}` });
    }

    /* ---------- TEXT: small talk or fallback ---------- */
    // Try to detect if user pasted a WhatsApp catalog snippet (common when copying product from WA)
    try {
      const catalogMatches = parseWhatsAppCatalogSnippet(mensaje, menu);
      if (catalogMatches && catalogMatches.length) {
        const top = catalogMatches.slice(0, 3).map(c => `• ${c.name} — ${c.price ? formatMoney(c.price) : "precio no disponible"} (score ${c.matchScore})`).join("\n");
        return res.json({ reply: `Parece que compartiste un fragmento del catálogo. Coincidencias:\n${top}\n¿Quieres agregar alguno al pedido? Responde con el id o nombre.` });
      }
    } catch (err) {
      // ignore
    }

    // Default fallback
    return res.json({ reply: "Hola 👋 Escríbenos tu pedido o escribe *menu*. Si necesitas ayuda, escribe 'ayuda'." });

  } catch (err) {
    log("KOMMO handler error:", err?.message || err, err?.stack || "");
    // In production, avoid leaking error details
    return res.status(500).json({ reply: "⚠️ Ocurrió un error. Un asesor humano continuará." });
  }
}
