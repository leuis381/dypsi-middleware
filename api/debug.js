/**
 * api/debug.js
 * 
 * Endpoint de diagnóstico para verificar configuración
 */

import admin from "firebase-admin";
import { CONFIG } from "../lib/config.js";

export default async function handler(req, res) {
  // Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: CONFIG.ENV || process.env.NODE_ENV || 'unknown',
    config: {
      firebase: {
        hasProjectId: !!CONFIG.FIREBASE_PROJECT_ID,
        hasClientEmail: !!CONFIG.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!CONFIG.FIREBASE_PRIVATE_KEY,
        projectId: CONFIG.FIREBASE_PROJECT_ID || 'missing',
        clientEmailPrefix: CONFIG.FIREBASE_CLIENT_EMAIL ? CONFIG.FIREBASE_CLIENT_EMAIL.substring(0, 20) + '...' : 'missing',
        privateKeyStart: CONFIG.FIREBASE_PRIVATE_KEY ? CONFIG.FIREBASE_PRIVATE_KEY.substring(0, 30) + '...' : 'missing',
        privateKeyLength: CONFIG.FIREBASE_PRIVATE_KEY?.length || 0,
        privateKeyHasBegin: CONFIG.FIREBASE_PRIVATE_KEY?.includes('-----BEGIN PRIVATE KEY-----') || false,
        privateKeyHasEnd: CONFIG.FIREBASE_PRIVATE_KEY?.includes('-----END PRIVATE KEY-----') || false,
        privateKeyHasNewlines: CONFIG.FIREBASE_PRIVATE_KEY?.includes('\n') || false,
      },
      ocr: {
        hasApiKey: !!CONFIG.OCR_API_KEY,
      },
      features: {
        iaEnabled: CONFIG.IA_ENABLED,
        aiEngine: CONFIG.FEATURE_AI_ENGINE,
        smartOcr: CONFIG.FEATURE_SMART_OCR,
      }
    },
    firebase: {
      appsLength: admin.apps.length,
      initialized: admin.apps.length > 0,
    }
  };
  
  // Try to initialize Firebase
  let firebaseTest = { status: 'not_attempted' };
  if (CONFIG.FIREBASE_PROJECT_ID && CONFIG.FIREBASE_CLIENT_EMAIL && CONFIG.FIREBASE_PRIVATE_KEY) {
    try {
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: CONFIG.FIREBASE_PROJECT_ID,
            clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
            privateKey: CONFIG.FIREBASE_PRIVATE_KEY,
          }),
        });
        firebaseTest = { status: 'initialized', success: true };
      } else {
        firebaseTest = { status: 'already_initialized', success: true };
      }
    } catch (error) {
      firebaseTest = {
        status: 'failed',
        success: false,
        error: error.message,
        errorCode: error.code,
        errorName: error.name,
      };
    }
  } else {
    firebaseTest = {
      status: 'missing_credentials',
      success: false,
    };
  }
  
  diagnostics.firebaseInitTest = firebaseTest;
  
  // Test imports
  let importTests = {};
  try {
    await import("../lib/ai-engine.js");
    importTests.aiEngine = 'ok';
  } catch (e) {
    importTests.aiEngine = e.message;
  }
  
  try {
    await import("../lib/ultra-humanizer.js");
    importTests.ultraHumanizer = 'ok';
  } catch (e) {
    importTests.ultraHumanizer = e.message;
  }
  
  try {
    await import("../lib/smart-delivery.js");
    importTests.smartDelivery = 'ok';
  } catch (e) {
    importTests.smartDelivery = e.message;
  }
  
  diagnostics.importTests = importTests;
  
  return res.status(200).json({
    ok: true,
    diagnostics
  });
}
