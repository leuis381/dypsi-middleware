import admin from "firebase-admin";

function getPrivateKey() {
  let key = process.env.FIREBASE_PRIVATE_KEY;

  if (!key) {
    throw new Error("FIREBASE_PRIVATE_KEY no está definida en las variables de entorno");
  }

  // Elimina espacios extra al inicio/fin
  key = key.trim();

  // Caso 1: si contiene "\n" literal, conviértelo en saltos reales
  if (key.includes("\\n")) {
    key = key.replace(/\\n/g, "\n");
  }

  // Caso 2: si ya tiene saltos reales, lo dejamos tal cual
  // (pero aseguramos que empiece y termine con los delimitadores correctos)
  if (!key.startsWith("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("La clave privada no tiene un encabezado válido");
  }
  if (!key.endsWith("-----END PRIVATE KEY-----")) {
    throw new Error("La clave privada no tiene un pie válido");
  }

  return key;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getPrivateKey(),
    }),
  });
}

const db = admin.firestore();
export default db;
