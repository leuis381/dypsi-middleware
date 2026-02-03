/**
 * api/kommo-diag.js
 * 
 * Endpoint de diagnóstico que replica la estructura de kommo.js paso a paso
 */

export default async function handler(req, res) {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    steps: []
  };
  
  try {
    // Step 1: Import básicos
    diagnostics.steps.push({ step: 1, name: 'basic_imports', status: 'attempting' });
    const { CONFIG } = await import("../lib/config.js");
    diagnostics.steps[0].status = 'success';
    diagnostics.config = {
      env: CONFIG.ENV,
      hasFirebase: !!CONFIG.FIREBASE_PROJECT_ID
    };
    
    // Step 2: Import utils
    diagnostics.steps.push({ step: 2, name: 'utils', status: 'attempting' });
    const utils = await import("../lib/utils.js");
    diagnostics.steps[1].status = 'success';
    
    // Step 3: Import Firebase
    diagnostics.steps.push({ step: 3, name: 'firebase', status: 'attempting' });
    const admin = await import("firebase-admin");
    diagnostics.steps[2].status = 'success';
    diagnostics.firebase = {
      appsLength: admin.default.apps.length
    };
    
    // Step 4: Import AI modules
    diagnostics.steps.push({ step: 4, name: 'ai_modules', status: 'attempting' });
    const aiEngine = await import("../lib/ai-engine.js");
    const smartOcr = await import("../lib/smart-ocr.js");
    const userProfile = await import("../lib/user-profile.js");
    diagnostics.steps[3].status = 'success';
    
    // Step 5: Import advanced modules
    diagnostics.steps.push({ step: 5, name: 'advanced_modules', status: 'attempting' });
    const ultraHumanizer = await import("../lib/ultra-humanizer.js");
    const smartDelivery = await import("../lib/smart-delivery.js");
    const kommoSender = await import("../lib/kommo-sender.js");
    const smartInterpreter = await import("../lib/smart-interpreter.js");
    diagnostics.steps[4].status = 'success';
    
    // Step 6: Import NLP modules
    diagnostics.steps.push({ step: 6, name: 'nlp_modules', status: 'attempting' });
    const advancedNLP = await import("../lib/advanced-nlp.js");
    const fuzzyMatcher = await import("../lib/fuzzy-matcher.js");
    diagnostics.steps[5].status = 'success';
    
    // Step 7: Import pricing
    diagnostics.steps.push({ step: 7, name: 'pricing', status: 'attempting' });
    const pricing = await import("../lib/zona-precios.js");
    diagnostics.steps[6].status = 'success';
    
    // Step 8: Load menu data
    diagnostics.steps.push({ step: 8, name: 'load_menu', status: 'attempting' });
    const fs = await import("fs");
    const menuPath = new URL("../data/menu.json", import.meta.url);
    const menu = JSON.parse(fs.default.readFileSync(menuPath, "utf8"));
    diagnostics.steps[7].status = 'success';
    diagnostics.menu = {
      categoriesCount: menu?.categorias?.length || 0
    };
    
    // Step 9: Initialize Firebase
    diagnostics.steps.push({ step: 9, name: 'init_firebase', status: 'attempting' });
    if (!admin.default.apps.length && CONFIG.FIREBASE_PROJECT_ID) {
      admin.default.initializeApp({
        credential: admin.default.credential.cert({
          projectId: CONFIG.FIREBASE_PROJECT_ID,
          clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
          privateKey: CONFIG.FIREBASE_PRIVATE_KEY,
        }),
      });
      diagnostics.steps[8].status = 'success';
      diagnostics.firebase.initialized = true;
    } else {
      diagnostics.steps[8].status = 'skipped';
      diagnostics.firebase.initialized = false;
      diagnostics.firebase.reason = 'already initialized or no credentials';
    }
    
    // Step 10: Test request handling
    diagnostics.steps.push({ step: 10, name: 'test_request', status: 'attempting' });
    if (req.method === 'POST' && req.body) {
      const { telefono, mensaje } = req.body;
      diagnostics.request = {
        telefono: telefono?.substring(0, 10) + '...',
        hasMessage: !!mensaje
      };
      diagnostics.steps[9].status = 'success';
    } else {
      diagnostics.steps[9].status = 'skipped';
      diagnostics.request = { method: req.method };
    }
    
    return res.status(200).json({
      ok: true,
      message: 'All diagnostics passed',
      diagnostics
    });
    
  } catch (error) {
    // Mark failed step
    const lastStep = diagnostics.steps[diagnostics.steps.length - 1];
    if (lastStep) {
      lastStep.status = 'failed';
      lastStep.error = error.message;
    }
    
    return res.status(500).json({
      ok: false,
      message: 'Diagnostic failed',
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack
      },
      diagnostics
    });
  }
}
