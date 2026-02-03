/**
 * api/kommo-simple.js
 * 
 * Versión simplificada para diagnosticar el problema
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Simple endpoint working' });
  }
  
  try {
    const { telefono, nombre, mensaje, tipo } = req.body;
    
    if (!telefono || !mensaje) {
      return res.status(400).json({
        ok: false,
        error: { message: 'telefono and mensaje are required' }
      });
    }
    
    // Try importing modules one by one
    const imports = {};
    const errors = {};
    
    try {
      const { CONFIG } = await import("../lib/config.js");
      imports.config = 'ok';
      imports.configData = {
        env: CONFIG.ENV,
        firebase: !!CONFIG.FIREBASE_PROJECT_ID
      };
    } catch (e) {
      errors.config = e.message;
    }
    
    try {
      const utils = await import("../lib/utils.js");
      imports.utils = 'ok';
    } catch (e) {
      errors.utils = e.message;
    }
    
    try {
      const aiEngine = await import("../lib/ai-engine.js");
      imports.aiEngine = 'ok';
    } catch (e) {
      errors.aiEngine = e.message;
    }
    
    try {
      const sessionStoreModule = await import("../lib/session-store.js");
      imports.sessionStore = 'ok';
    } catch (e) {
      errors.sessionStore = e.message;
    }
    
    try {
      const admin = await import("firebase-admin");
      imports.firebaseAdmin = 'ok';
      imports.firebaseApps = admin.default.apps.length;
    } catch (e) {
      errors.firebaseAdmin = e.message;
    }
    
    return res.status(200).json({
      ok: true,
      message: 'Diagnostic successful',
      request: {
        telefono,
        nombre,
        mensaje: mensaje.substring(0, 50),
        tipo
      },
      imports,
      errors,
      hasErrors: Object.keys(errors).length > 0
    });
    
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack
      }
    });
  }
}
