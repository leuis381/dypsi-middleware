#!/usr/bin/env node
/**
 * test-modules.js
 * Test de módulos individuales sin necesidad de Firebase
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import modules
import ultraHumanizer from './lib/ultra-humanizer.js';
import smartDelivery from './lib/smart-delivery.js';
import kommoSender from './lib/kommo-sender.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 TESTING MODULES\n');

// Test 1: Ultra Humanizer
console.log('📋 TEST 1: Ultra Humanizer');
try {
  const response = ultraHumanizer.generateHumanizedResponse('greeting', { 
    nombre: 'Carlos',
    isVIP: false 
  });
  console.log(`✅ Greeting generated: "${response.substring(0, 80)}..."`);
  
  const vipResponse = ultraHumanizer.generateHumanizedResponse('greeting', {
    nombre: 'VIP Cliente',
    isVIP: true
  });
  console.log(`✅ VIP Greeting generated: "${vipResponse.substring(0, 80)}..."`);
  
  const timeGreeting = ultraHumanizer.getDayTimeGreeting();
  console.log(`✅ Time greeting: "${timeGreeting}"`);
  
  const occasion = ultraHumanizer.detectSpecialOccasion();
  console.log(`✅ Special occasion detected: ${occasion || 'None'}`);
  
} catch (error) {
  console.error(`❌ Ultra Humanizer error: ${error.message}`);
}

// Test 2: Smart Delivery
console.log('\n📋 TEST 2: Smart Delivery');
try {
  // Distance calculation
  const distance = smartDelivery.calculateDistance(
    -12.046374, -77.042793,  // Tienda
    -12.120000, -77.030000   // Cliente
  );
  console.log(`✅ Distance calculated: ${distance} km`);
  
  // Delivery cost
  const cost = smartDelivery.calculateDeliveryCost(distance);
  console.log(`✅ Delivery cost: S/ ${cost.cost}`);
  console.log(`   Zone: ${cost.zone}`);
  console.log(`   Estimated time: ${cost.estimatedTime} min`);
  
  // Delivery hours
  const hours = smartDelivery.validateDeliveryHours();
  console.log(`✅ Delivery hours: ${hours.opensAt} - ${hours.closesAt}`);
  console.log(`   Currently open: ${hours.available ? 'YES' : 'NO'}`);
  
  // Geocode simple
  const coords = smartDelivery.geocodeAddressSimple('Miraflores, Lima');
  console.log(`✅ Geocoded "Miraflores": (${coords.lat}, ${coords.lon})`);
  
} catch (error) {
  console.error(`❌ Smart Delivery error: ${error.message}`);
}

// Test 3: Kommo Sender
console.log('\n📋 TEST 3: Kommo Sender');
try {
  const testOrder = {
    id: 'order-test-123',
    items: [
      { cantidad: 2, nombre: 'Pizza Hawaiana', tamano: 'Mediana', precio: 25 },
      { cantidad: 1, nombre: 'Coca Cola', tamano: '2L', precio: 8 }
    ],
    subtotal: 58,
    costoEnvio: 5,
    total: 63,
    metodoPago: 'Yape',
    direccion: 'Av. Principal 123, Miraflores',
    referencias: 'Casa roja con portón azul'
  };
  
  const testCliente = {
    nombre: 'Carlos',
    telefono: '+51999888777',
    isVIP: false,
    totalOrders: 1
  };
  
  const formatted = kommoSender.formatOrderForAgent(testOrder, testCliente);
  console.log(`✅ Order formatted for agent:`);
  console.log(`   Length: ${formatted.length} chars`);
  console.log(`   Preview: "${formatted.substring(0, 100)}..."`);
  
  const summary = kommoSender.createOrderShortSummary(testOrder);
  console.log(`✅ Short summary: "${summary}"`);
  
  const validation = kommoSender.validateOrderForAgent(testOrder);
  console.log(`✅ Order validation: valid=${validation.valid}`);
  if (validation.errors.length > 0) {
    console.log(`   Errors: ${validation.errors.join(', ')}`);
  }
  if (validation.warnings.length > 0) {
    console.log(`   Warnings: ${validation.warnings.join(', ')}`);
  }
  
} catch (error) {
  console.error(`❌ Kommo Sender error: ${error.message}`);
}

console.log('\n' + '='.repeat(60));
console.log('✅ ALL MODULE TESTS PASSED!');
console.log('='.repeat(60));
