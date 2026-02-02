/**
 * session-store.js
 *
 * Abstracción mínima para sesiones usando Firestore (compatible con tu kommo.js).
 * - getSession(phone)
 * - saveSession(phone, data)
 * - saveAddressForPhone(phone, addressObj)
 * - saveOrderDraft(phone, parsedOrder)
 *
 * Requiere inicialización de Firebase Admin en el entorno (como en tu kommo.js).
 */

import admin from "firebase-admin";

if (!admin.apps.length) {
  // No inicializamos aquí; kommo.js ya lo hace. Si no, espera que el caller inicialice.
  // Esto evita doble init en entornos serverless.
}

const db = admin.apps.length ? admin.firestore() : null;

export async function getSession(phone) {
  if (!db || !phone) return { estado: "inicio" };
  const ref = db.collection("sessions").doc(String(phone));
  const snap = await ref.get();
  if (!snap.exists) {
    const initial = { estado: "inicio", pedido: null, address: null, updatedAt: new Date().toISOString() };
    await ref.set(initial);
    return initial;
  }
  return snap.data();
}

export async function saveSession(phone, data) {
  if (!db || !phone) return null;
  const ref = db.collection("sessions").doc(String(phone));
  await ref.set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });
  return true;
}

export async function saveAddressForPhone(phone, address, components = {}) {
  if (!db || !phone) return null;
  const ref = db.collection("sessions").doc(String(phone));
  const payload = { address: { address, components }, estado: "address_received", updatedAt: new Date().toISOString() };
  await ref.set(payload, { merge: true });
  return payload;
}

export async function saveOrderDraft(phone, parsedOrder) {
  if (!db || !phone) return null;
  const ref = db.collection("sessions").doc(String(phone));
  const payload = { pedido: parsedOrder, estado: "pedido", updatedAt: new Date().toISOString() };
  await ref.set(payload, { merge: true });
  return payload;
}

export default { getSession, saveSession, saveAddressForPhone, saveOrderDraft };
