/**
 * api/kommo.js
 *
 * Supercerebro Kommo handler (ultrarrobusto)
 */
import axios from "axios";
import admin from "firebase-admin";
import parseOrderText from "../lib/parse-order.js";
import { readImage, readImageBuffer, extractMostLikelyTotal, validateReceiptAgainstOrder, parseWhatsAppCatalogSnippet } from "../lib/ocr.js";
import { detectAddress, normalizeAddress } from "../lib/detect-address.js";
import pricing from "../lib/zoma-precios.js";
import sessionStore from "../lib/session-store.js";
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
    return res.status(200).json({ ok: true, service: "KOMMO IA", status: "running", env: { firebase: !!process.env.FIREBASE_PROJECT_ID } });
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

    // Helper to persist and return reply
    const persistAndReply = async (newSessionData, replyObj) => {
      await sessionStore.saveSession(telefono, newSessionData);
      return res.json(replyObj);
    };

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
        const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
        const draft = pedido || pedido_borrador || null;

        if (draft?.items?.length) {
          const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
          const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01 });
          const validation = validateReceiptAgainstOrder(ocrResult, { items: draft.items, expectedTotal: calc.total }, menu, { tolerance: Number(process.env.PAYMENT_TOLERANCE || 0.06), debug });

          if (validation.ok) {
            await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "comprobante", amount: validation.detectedTotal, ocr: ocrResult } });
            await notifyAgent({ event: "order_paid", telefono, pedido: draft, amount: validation.detectedTotal });
            return res.json({ reply: `✅ Pago validado por ${formatMoney(validation.detectedTotal)}. Tu pedido está confirmado y en preparación.` });
          } else {
            await sessionStore.saveSession(telefono, { estado: "pago_verificacion", comprobante: { detected: detected, ocr: ocrResult, validation } });
            return res.json({ reply: `⚠️ Detecté S/${detected} en el comprobante. No coincide exactamente con el total del pedido. ¿Deseas que lo revise un agente o prefieres enviar el monto manualmente?` });
          }
        } else {
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

    /* ---------- TEXT: detect address ---------- */
    const addrDetection = detectAddress(mensaje);
    if (addrDetection && addrDetection.address) {
      await sessionStore.saveAddressForPhone(telefono, addrDetection.address, addrDetection.components);

      const { pedido, pedido_borrador } = await sessionStore.getSession(telefono) || {};
      const draft = pedido || pedido_borrador || null;

      if (draft?.items?.length) {
        const itemsForCalc = draft.items.map(it => ({ id: it.id, quantity: it.quantity, variant: it.variant, extras: it.extras }));
        const calc = pricing.calculateOrderTotal(itemsForCalc, menu, menu.reglas || [], { taxRate: 0, rounding: 0.01, delivery: { addressComponents: addrDetection.components } });
        await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: draft.items, pricing: calc }, address: { address: addrDetection.address, components: addrDetection.components } });
        return res.json({ reply: `📍 Dirección detectada: ${addrDetection.address}\nTotal a cobrar: ${formatMoney(calc.total)}\n${buildOrderSummaryText(draft, calc)}\n¿Confirmas y deseas pagar ahora?` });
      }
      return res.json({ reply: `📍 Dirección detectada: ${addrDetection.address}\n¿Deseas que calcule el costo total ahora o prefieres enviar tu pedido primero?` });
    }

    /* ---------- TEXT: user asks for menu or catalog ---------- */
    if (["menu", "carta", "catalogo"].some(keyword => mensaje.toLowerCase().includes(keyword))) {
      const topCats = (menu.categorias || []).slice(0, 4).map(c => `• ${c.nombre} (${(c.productos||[]).length} items)`).join("\n");
      return res.json({ reply: `📋 Nuestro menú:\n${topCats}\nEscribe el nombre del plato o envía tu pedido. Si quieres, puedo enviarte el catálogo completo.` });
    }

    /* ---------- TEXT: parse order from message ---------- */
    try {
      const parsed = parseOrderText(mensaje, menu, { synonyms, debug });
      if (parsed?.items?.length) {
        await sessionStore.saveOrderDraft(telefono, parsed);

        const { address } = await sessionStore.getSession(telefono) || {};
        const itemsForCalc = parsed.items.map(it => {
          const prod = pricing.findProductInMenu(menu, it.id);
          const unitPrice = prod ? pricing.applyVariantPrice(prod, it.variant) ?? prod.precio ?? null : it.price ?? it.priceHint ?? null;
          return { id: it.id, name: it.name, quantity: it.quantity, variant: it.variant, unitPrice, extras: it.extras || [] };
        });

        if (address?.components) {
          const calc = calculateDeliveryAndTotal(itemsForCalc, address.components, { taxRate: 0 });
          await sessionStore.saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: itemsForCalc, pricing: calc }, address });
          return res.json({ reply: `✅ Pedido recibido y total calculado.\n${buildOrderSummaryText({ items: itemsForCalc }, calc)}\n¿Confirmas y deseas pagar ahora?` });
        } else {
          return res.json({ reply: `✅ Pedido recibido: ${parsed.items.map(i => `${i.quantity}x ${i.name}`).join(", ")}.\n¿Delivery o recojo? Si es delivery, por favor envía tu dirección o ubicación.` });
        }
      }
    } catch (err) {
      log("parseOrderText error:", err?.message || err);
    }

    /* ---------- TEXT: user confirms payment manually ---------- */
    const lower = mensaje.toLowerCase();
    if (/(yape|plin|transferencia|transfer|pago|pagado|pague|pagu[eé])/i.test(lower) && /\d/.test(lower)) {
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
            await sessionStore.saveSession(telefono, { estado: "pagado", pedido: { items: draft.items, pricing: calc }, pago: { method: "manual", amount } });
            await notifyAgent({ event: "order_paid_manual", telefono, amount, pedido: draft });
            return res.json({ reply: `✅ Pago registrado por ${formatMoney(amount)}. Tu pedido está confirmado y en preparación.` });
          } else {
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

    /* ---------- TEXT: user asks status ---------- */
    if (/\b(estado|mi pedido|seguimiento|track|enviado|salio)\b/i.test(lower)) {
      const current = await sessionStore.getSession(telefono);
      if (!current?.pedido) return res.json({ reply: "No tengo un pedido asociado a tu número. ¿Deseas hacer un pedido ahora?" });
      const st = current.estado || "inicio";
      const replyMap = {
        inicio: "No hay pedido activo.",
        pedido_borrador: "¿Tienes un pedido en borrador. ¿Deseas confirmarlo?",
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
    try {
      const catalogMatches = parseWhatsAppCatalogSnippet(mensaje, menu);
      if (catalogMatches?.length) {
        const top = catalogMatches.slice(0, 3).map(c => `• ${c.name} — ${c.price ? formatMoney(c.price) : "precio no disponible"} (score ${c.matchScore})`).join("\n");
        return res.json({ reply: `Parece que compartiste un fragmento del catálogo. Coincidencias:\n${top}\n¿Quieres agregar alguno al pedido? Responde con el id o nombre.` });
      }
    } catch (err) {
      // ignore
    }

    return res.json({ reply: "Hola 👋 Escríbenos tu pedido o escribe *menu*. Si necesitas ayuda, escribe 'ayuda'." });

  } catch (err) {
    log("KOMMO handler error:", err?.message || err, err?.stack || "");
    return res.status(500).json({ reply: "⚠️ Ocurrió un error. Un asesor humano continuará." });
  }
}
