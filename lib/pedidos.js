import admin from "firebase-admin";

/* ---------------- FIREBASE INIT ---------------- */

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

/* ---------------- CORE FUNCTION (REUTILIZABLE) ---------------- */

export async function guardarPedidoFirebase({
  nombre_cliente = "Cliente WhatsApp",
  telefono_cliente = "",
  direccion = "",
  tipo_entrega = "delivery",
  pago = "",
  pedido = [],
}) {
  if (!pedido || !pedido.length) {
    throw new Error("Pedido vacío");
  }

  // 🔢 calcular total
  const total = pedido.reduce(
    (sum, item) => sum + item.precio * item.cantidad,
    0
  );

  // 📦 estructura EXACTA según tu Firebase
  const pedidoDoc = {
    nombre_cliente,
    telefono_cliente,
    direccion,
    tipo_entrega,
    pago,
    estado: "pendiente",
    fecha: admin.firestore.Timestamp.now(),
    pedido,
    total,
  };

  const ref = await db.collection("pedidos").add(pedidoDoc);

  return {
    id: ref.id,
    pedido: pedidoDoc,
  };
}

/* ---------------- API HANDLER (NO SE ROMPE) ---------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const result = await guardarPedidoFirebase(req.body);

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("❌ Error guardando pedido:", error);

    return res.status(500).json({
      ok: false,
      error: "Error al guardar pedido",
      details: error.message,
    });
  }
}
