import admin from "firebase-admin";

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) {
    throw new Error("FIREBASE_PRIVATE_KEY no está definida en las variables de entorno");
  }

  // Si la clave contiene "\n" literal, conviértelo en saltos reales
  if (key.includes("\\n")) {
    return key.replace(/\\n/g, "\n");
  }

  // Si ya tiene saltos reales, úsala tal cual
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
