/**
 * dev-server.js
 * Servidor de desarrollo local para testing
 * Corre en http://localhost:3000
 */

import http from 'http';
import handler from './api/kommo.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Método no permitido para endpoints que no son POST
  const isPostEndpoint = req.url === '/api/kommo' || req.url === '/api/message' || req.url.startsWith('/api/');
  if (isPostEndpoint && req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Parse body
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      req.body = body ? JSON.parse(body) : {};
    } catch (e) {
      // JSON inválido - devolver 400 en lugar de ignorar
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON', details: e.message }));
      return;
    }

    // Wrap res to be compatible with Express/Vercel
    let statusCode = 200;
    let sentResponse = false;
    
    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    
    res.status = (code) => {
      statusCode = code;
      return res;
    };
    
    res.json = (data) => {
      if (sentResponse) return;
      sentResponse = true;
      res.setHeader('Content-Type', 'application/json');
      originalWriteHead(statusCode);
      originalEnd(JSON.stringify(data));
    };
    
    res.send = (data) => {
      if (sentResponse) return;
      sentResponse = true;
      res.setHeader('Content-Type', 'application/json');
      originalWriteHead(statusCode);
      originalEnd(JSON.stringify(typeof data === 'string' ? JSON.parse(data) : data));
    };
    
    // Override writeHead to track status
    res.writeHead = function(code, headers) {
      statusCode = code;
      return originalWriteHead(code, headers);
    };

    // Call the handler
    try {
      await handler(req, res);
      // If nothing was sent yet, send default response
      if (!sentResponse && !res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }
    } catch (error) {
      console.error('Handler error:', error);
      if (!sentResponse && !res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📝 Endpoint: POST http://localhost:${PORT}/api/kommo\n`);
  console.log('Ejemplo de request:');
  console.log(`curl -X POST http://localhost:${PORT}/api/kommo \\
    -H "Content-Type: application/json" \\
    -d '{
      "action": "message",
      "userId": "user_123",
      "userName": "Juan",
      "message": "Hola! Quiero una pizza"
    }'\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Puerto ${PORT} ya está en uso`);
    process.exit(1);
  }
  throw err;
});
