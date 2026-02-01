import admin from "firebase-admin";
import parseOrder from "../lib/parse-order.js";
import processOrder from "../lib/order-full.js";
import { calculateRoute } from "../lib/route-price.js";
import { readImage } from "../lib/ocr.js";
import { guardarPedidoFirebase } from "../lib/pedidos.js";

/* ---------- FIREBASE INIT ---------- */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

/* ---------- SESSION HELPERS ---------- */
async function getSession(phone) {
  if (!db || !phone) return { estado: "inicio" };
  const ref = db.collection("sessions").doc(phone);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ estado: "inicio", pedido: null });
    return { estado: "inicio", pedido: null };
  }
  return snap.data();
}

async function saveSession(phone, data) {
  if (!db || !phone) return;
  await db.collection("sessions").doc(phone).set(data, { merge: true });
}

/* ---------- MAIN HANDLER ---------- */
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "KOMMO IA", status: "running" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { nombre = "Cliente", telefono, mensaje = "", tipo = "text", imagen = null, ubicacion = null } = req.body;
    if (!telefono) {
      return res.status(400).json({ ok: false, reply: "❌ No se pudo identificar el cliente." });
    }

    const session = await getSession(telefono);

    /* ---------- OCR ---------- */
    if (tipo === "image" && imagen) {
      const ocrResult = await readImage(imagen);
      if (!ocrResult?.amounts?.length) {
        return res.json({ reply: "📸 Imagen recibida, pero no pude leer el monto. ¿Puedes enviarla más clara?" });
      }
      const amount = ocrResult.amounts[0];
      return res.json({ reply: `✅ Comprobante detectado por S/${amount}. Estamos validando tu pago.` });
    }

    /* ---------- UBICACIÓN ---------- */
    if (tipo === "location" && ubicacion?.lat && ubicacion?.lon) {
      const delivery = await calculateRoute(
        { lat: Number(process.env.STORE_LAT), lon: Number(process.env.STORE_LON) },
        { lat: ubicacion.lat, lon: ubicacion.lon }
      );
      await saveSession(telefono, { estado: "pago", delivery: delivery.price });
      return res.json({ reply: `📍 Delivery calculado: S/${delivery.price}. ¿Cómo deseas pagar? (Yape / Efectivo)` });
    }

    /* ---------- TEXTO ---------- */
    if (mensaje.toLowerCase().includes("menu")) {
      return res.json({ reply: "📋 Escríbenos tu pedido así:\n2 alitas BBQ y 1 pizza familiar" });
    }

    const parsed = await parseOrder(mensaje);
    if (parsed?.items?.length) {
      await saveSession(telefono, { estado: "pedido", pedido: parsed });
      return res.json({ reply: "✅ Pedido recibido.\n¿Delivery o recojo?" });
    }

    if (session.estado === "pago" && session.pedido) {
      const result = await guardarPedidoFirebase({
        nombre_cliente: nombre,
        telefono_cliente: telefono,
        pedido: session.pedido.items,
        total: session.pedido.total,
        tipo_entrega: "delivery",
        pago: mensaje,
      });
      await saveSession(telefono, { estado: "confirmado" });
      return res.json({ reply: "🎉 Pedido confirmado. Gracias por tu compra.", id: result.id });
    }

    return res.json({ reply: "Hola 👋 Escríbenos tu pedido o escribe *menu*." });
  } catch (err) {
    console.error("🔥 KOMMO IA ERROR:", err);
    return res.status(500).json({ reply: "⚠️ Ocurrió un error. Un asesor humano continuará." });
  }
}
