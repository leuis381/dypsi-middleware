#!/usr/bin/env node

/**
 * scripts/test-ai-integration.js
 * 
 * Script de prueba para verificar la integración del motor de IA
 */

import aiEngine from '../lib/ai-engine.js';
import smartOcrModule from '../lib/smart-ocr.js';
import userProfileModule from '../lib/user-profile.js';
import fs from 'fs';

const { detectIntention, ConversationContext, generateSmartResponse, generateSuggestions, validateOrder } = aiEngine;
const { smartOCRAnalysis } = smartOcrModule;
const { UserProfile } = userProfileModule;

const menuPath = new URL("../data/menu.json", import.meta.url);
const menu = JSON.parse(fs.readFileSync(menuPath, "utf8"));

console.log('🧪 TESTING AI INTEGRATION\n');

// Test 1: Intention Detection
console.log('📋 TEST 1: Intention Detection');
const testMessages = [
  { text: 'Hola, ¿cómo estás?', expectedType: 'GREETING' },
  { text: 'Quiero una pizza mediana con jamón', expectedType: 'ORDER_NEW' },
  { text: '¿Cuál es el estado de mi pedido?', expectedType: 'STATUS' },
  { text: 'Dos más como la anterior', expectedType: 'ORDER_REPEAT' },
  { text: 'Cancelar mi pedido', expectedType: 'CANCEL' },
  { text: 'Pague por Yape S/45.50', expectedType: 'PAYMENT' },
  { text: 'Me llegó mal el pedido :(', expectedType: 'COMPLAINT' },
];

const context = new ConversationContext('1234567890', 'Carlos');
testMessages.forEach(test => {
  const result = detectIntention(test.text, context);
  const status = result.type === test.expectedType ? '✅' : '❌';
  console.log(`${status} "${test.text}" → ${result.type} (conf: ${result.confidence.toFixed(2)})`);
});

// Test 2: User Profile
console.log('\n📊 TEST 2: User Profile Management');
const profile = new UserProfile('1234567890', 'Carlos');
console.log(`✅ Created profile for ${profile.name}`);

profile.addOrder({
  items: [{ id: 'pizza', name: 'Pizza Mediana', quantity: 1 }],
  total: 25,
  date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  verified: true
});

profile.addOrder({
  items: [{ id: 'pizza', name: 'Pizza Mediana', quantity: 1 }],
  total: 25,
  date: new Date(),
  verified: true
});

console.log(`✅ Added 2 orders to profile`);
console.log(`   Total orders: ${profile.orders.length}`);
console.log(`   Last order: ${profile.getLastOrder()?.items[0]?.name}`);
console.log(`   Total spent: S/${profile.stats.totalSpent || 0}`);
console.log(`   Is VIP: ${profile.isVIP()}`);
console.log(`   Is Frequent: ${profile.isFrequent()}`);

// Test 3: Conversation Context
console.log('\n💬 TEST 3: Conversation Context');
context.addMessage('Hola, quiero una pizza', 'user');
context.addMessage('Perfecto, ¿mediana o grande?', 'assistant');
context.addMessage('Mediana por favor', 'user');
console.log(`✅ Added 3 messages to context`);
console.log(`   Recent messages: ${context.recentMessages.length}`);
console.log(`   Last user message: "${context.recentMessages[context.recentMessages.length - 1]?.content}"`);

// Test 4: Smart Response Generation
console.log('\n🎤 TEST 4: Smart Response Generation');
const responses = [
  { key: 'greeting', profile },
  { key: 'menu_available', profile },
  { key: 'payment_confirmed', profile, data: { amount: 45.50 } },
  { key: 'order_repeat', profile },
];

responses.forEach(resp => {
  try {
    const generated = generateSmartResponse(context, resp.key, resp.profile, resp.data);
    console.log(`✅ ${resp.key}:`);
    console.log(`   "${generated.slice(0, 60)}..."`);
  } catch (e) {
    console.log(`❌ ${resp.key}: ${e.message}`);
  }
});

// Test 5: Order Validation
console.log('\n✔️ TEST 5: Order Validation');
const validOrder = {
  items: [
    { id: 'pizza', name: 'Pizza', quantity: 1 },
    { id: 'bebida', name: 'Coca', quantity: 1 }
  ]
};

const invalidOrder = {
  items: []
};

const validResult = validateOrder(validOrder);
const invalidResult = validateOrder(invalidOrder);

console.log(`✅ Valid order: ${validResult.isValid ? '✓' : '✗'} (errors: ${validResult.errors.length})`);
console.log(`❌ Invalid order: ${invalidResult.isValid ? '✓' : '✗'} (errors: ${invalidResult.errors.length})`);
if (invalidResult.errors.length > 0) {
  invalidResult.errors.forEach(err => console.log(`   - ${err}`));
}

// Test 6: Suggestions
console.log('\n💡 TEST 6: Smart Suggestions');
const orderItems = [
  { id: 'pizza', name: 'Pizza Mediana' },
];

const suggestions = generateSuggestions(orderItems, profile, menu);
console.log(`✅ Generated ${suggestions.length} suggestions`);
suggestions.slice(0, 3).forEach(sug => {
  console.log(`   - ${sug.name} (reason: ${sug.reason})`);
});

console.log('\n✅ ALL TESTS COMPLETED\n');
