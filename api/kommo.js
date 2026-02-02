/**
 * kommo.js
 *
 * Handler principal integrado:
 * - Inicializa Firebase (si no está inicializado)
 * - Usa ocr.js, detect-address.js, parse-order.js, zona-precios.js, session-store.js
 * - Flujo:
 *    * Si tipo=image -> OCR -> extraer monto/operación -> responder
 *    * Si tipo=location -> calcular ruta -> guardar session -> responder
 *    * Si texto contiene dirección -> detectar y guardar -> ofrecer calcular total
 *    * Si texto contiene pedido -> parseOrder -> guardar draft -> si hay dirección en session -> calcular total y responder
 *    * Manejo de confirmación de pago (estado pago)
 */

import admin from "firebase-admin";
import parseOrder from "./parse-order.js";
import { readImage, extractMostLikelyTotal } from "./ocr.js";
import isAddress from "./detect-address.js";
import { calculateOrderTotal } from "./zona-precios.js";
import { getSession, saveSession, saveAddressForPhone, saveOrderDraft } from "./session-store.js";
import { calculateRoutePrice } from "./zona-precios.js";

/* ---------- FIREBASE INIT (si no está) ---------- */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") : undefined
    }),
  });
}

/* ---------- CATALOGO Y SINONIMOS (carga desde archivos en tu proyecto) ---------- */
import productsCatalog from "./menu.json" assert { type: "json" };
import synonyms from "./sinonimos.json" assert { type: "json" };

/* ---------- HANDLER ---------- */
export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "KOMMO IA", status: "running" });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const { nombre = "Cliente", telefono, mensaje = "", tipo = "text", imagen = null, ubicacion = null } = req.body;
    if (!telefono) return res.status(400).json({ ok: false, reply: "❌ No se pudo identificar el cliente." });

    const session = await getSession(telefono);

    /* ---------- OCR (imagen enviada como URL) ---------- */
    if (tipo === "image" && imagen) {
      try {
        const ocrResult = await readImage(imagen);
        const amount = extractMostLikelyTotal(ocrResult);
        if (!amount) {
          return res.json({ reply: "📸 Imagen recibida, pero no pude leer el monto. ¿Puedes enviarla más clara o escribir el monto?" });
        }
        // Guardar comprobante en sesión para validación posterior
        await saveSession(telefono, { estado: "pago_verificacion", comprobante: { provider: ocrResult.provider, text: ocrResult.text, amount } });
        return res.json({ reply: `✅ Comprobante detectado por S/${amount}. ¿Deseas que lo valide y confirme el pago?` });
      } catch (err) {
        console.error("OCR error:", err);
        return res.json({ reply: "📸 No pude procesar la imagen. Intenta enviar una foto más clara o escribe el monto manualmente." });
      }
    }

    /* ---------- OCR (imagen enviada como buffer/base64) ---------- */
    if (tipo === "image_buffer" && req.body.imageBase64) {
      try {
        const buffer = Buffer.from(req.body.imageBase64, "base64");
        const ocrResult = await readImageBuffer(buffer);
        const amount = extractMostLikelyTotal(ocrResult);
        if (!amount) return res.json({ reply: "📸 Imagen recibida, pero no pude leer el monto. ¿Puedes enviarla más clara?" });
        await saveSession(telefono, { estado: "pago_verificacion", comprobante: { provider: ocrResult.provider, text: ocrResult.text, amount } });
        return res.json({ reply: `✅ Comprobante detectado por S/${amount}. ¿Deseas que lo valide y confirme el pago?` });
      } catch (err) {
        console.error("OCR buffer error:", err);
        return res.json({ reply: "📸 No pude procesar la imagen. Intenta enviar una foto más clara o escribe el monto manualmente." });
      }
    }

    /* ---------- LOCATION (lat/lon) ---------- */
    if (tipo === "location" && ubicacion?.lat && ubicacion?.lon) {
      try {
        const storeCoords = { lat: Number(process.env.STORE_LAT), lon: Number(process.env.STORE_LON) };
        const destCoords = { lat: Number(ubicacion.lat), lon: Number(ubicacion.lon) };
        const route = calculateRoutePrice(storeCoords, destCoords);
        await saveSession(telefono, { estado: "pago", delivery: route.price, address: { address: `Coordenadas ${destCoords.lat}, ${destCoords.lon}`, components: { lat: destCoords.lat, lon: destCoords.lon } } });
        return res.json({ reply: `📍 Delivery calculado: S/${route.price}. Distancia ${route.distanceKm} km. ¿Cómo deseas pagar? (Yape / Efectivo)` });
      } catch (err) {
        console.error("Route calc error:", err);
        return res.json({ reply: "No pude calcular la ruta. ¿Puedes enviar la dirección en texto?" });
      }
    }

    /* ---------- TEXTO: detectar dirección primero ---------- */
    const text = (mensaje || "").toString();
    const addr = isAddress(text);
    if (addr.isAddress) {
      await saveAddressForPhone(telefono, addr.address, addr.components);
      // Si ya hay pedido en sesión, calcular total
      const currentSession = await getSession(telefono);
      if (currentSession?.pedido?.items?.length) {
        const itemsWithPrices = currentSession.pedido.items.map(it => {
          const prod = productsCatalog.find(p => String(p.id) === String(it.id));
          return { ...it, price: prod?.price ?? it.price ?? it.priceHint ?? 0, extrasPrice: 0 };
        });
        const totalCalc = calculateOrderTotal({ items: itemsWithPrices, addressComponents: addr.components });
        await saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: itemsWithPrices, total: totalCalc.total }, address: { address: addr.address, components: addr.components } });
        return res.json({ reply: `📍 Dirección recibida: ${addr.address}\nZona: ${totalCalc.zone}\nSubtotal S/${totalCalc.breakdown.subtotal}\nImpuestos S/${totalCalc.breakdown.tax}\nDelivery S/${totalCalc.breakdown.delivery}\nTotal a cobrar S/${totalCalc.total}` });
      }
      return res.json({ reply: `📍 Dirección recibida: ${addr.address}\n¿Deseas que calcule el costo total ahora o prefieres enviar tu pedido primero?` });
    }

    /* ---------- TEXTO: mostrar menu ---------- */
    if (text.toLowerCase().includes("menu")) {
      return res.json({ reply: "📋 Escríbenos tu pedido así:\n2 alitas BBQ y 1 pizza familiar" });
    }

    /* ---------- TEXTO: parsear pedido ---------- */
    const parsed = await parseOrder(text, productsCatalog, { synonyms });
    if (parsed?.items?.length) {
      await saveOrderDraft(telefono, parsed);
      // si ya hay dirección en session, calcular total
      const currentSession = await getSession(telefono);
      if (currentSession?.address?.components) {
        const itemsWithPrices = parsed.items.map(it => {
          const prod = productsCatalog.find(p => String(p.id) === String(it.id));
          return { ...it, price: prod?.price ?? it.price ?? it.priceHint ?? 0, extrasPrice: 0 };
        });
        const totalCalc = calculateOrderTotal({ items: itemsWithPrices, addressComponents: currentSession.address.components });
        await saveSession(telefono, { estado: "pedido_confirmado", pedido: { items: itemsWithPrices, total: totalCalc.total }, address: currentSession.address });
        return res.json({ reply: `✅ Pedido: ${itemsWithPrices.length} ítems.\nZona: ${totalCalc.zone}\nSubtotal S/${totalCalc.breakdown.subtotal}\nImpuestos S/${totalCalc.breakdown.tax}\nDelivery S/${totalCalc.breakdown.delivery}\nTotal a cobrar S/${totalCalc.total}` });
      }
      return res.json({ reply: "✅ Pedido recibido.\n¿Delivery o recojo? Si ya enviaste tu dirección, puedo calcular el total." });
    }

    /* ---------- ESTADO PAGO: confirmar pago ---------- */
    if (session.estado === "pago" && session.pedido) {
      // guardar pago y confirmar
      // aquí deberías validar el método (Yape/Plin/efectivo) y guardar en pedidos
      await saveSession(telefono, { estado: "confirmado" });
      return res.json({ reply: "🎉 Pedido confirmado. Gracias por tu compra." });
    }

    return res.json({ reply: "Hola 👋 Escríbenos tu pedido o escribe *menu*." });
  } catch (err) {
    console.error("🔥 KOMMO IA ERROR:", err);
    return res.status(500).json({ reply: "⚠️ Ocurrió un error. Un asesor humano continuará." });
  }
}
