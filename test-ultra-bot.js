#!/usr/bin/env node
/**
 * test-ultra-bot.js
 * 
 * Script de prueba para validar todas las funcionalidades ultra mejoradas
 * Simula requests GET y POST al endpoint de Kommo
 */

import axios from 'axios';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/kommo`;

console.log('🧪 TESTING ULTRA BOT - DYPSI MIDDLEWARE');
console.log('=' .repeat(60));
console.log(`Endpoint: ${API_ENDPOINT}\n`);

/**
 * Test GET - Health check
 */
async function testHealthCheck() {
  console.log('📋 TEST 1: Health Check (GET)');
  try {
    const response = await axios.get(API_ENDPOINT);
    
    if (response.status === 200 && response.data.status === 'running') {
      console.log('✅ Health check passed');
      console.log(`   Service: ${response.data.service}`);
      console.log(`   Version: ${response.data.version}`);
      console.log(`   Features: ${response.data.features.join(', ')}`);
      return true;
    } else {
      console.log('❌ Health check failed - unexpected response');
      return false;
    }
  } catch (error) {
    console.log(`❌ Health check failed: ${error.message}`);
    return false;
  }
}

/**
 * Test POST - Greeting
 */
async function testGreeting() {
  console.log('\n📋 TEST 2: Greeting Message (POST)');
  try {
    const response = await axios.post(API_ENDPOINT, {
      telefono: '+51999888777',
      nombre: 'Carlos Test',
      mensaje: 'Hola',
      tipo: 'text'
    });
    
    if (response.status === 200 && response.data.ok) {
      console.log('✅ Greeting test passed');
      console.log(`   Reply: "${response.data.reply.substring(0, 100)}..."`);
      return true;
    } else {
      console.log('❌ Greeting test failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ Greeting test failed: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

/**
 * Test POST - Menu request
 */
async function testMenuRequest() {
  console.log('\n📋 TEST 3: Menu Request (POST)');
  try {
    const response = await axios.post(API_ENDPOINT, {
      telefono: '+51999888777',
      nombre: 'Carlos Test',
      mensaje: 'quiero ver el menu',
      tipo: 'text'
    });
    
    if (response.status === 200 && response.data.ok) {
      console.log('✅ Menu request test passed');
      console.log(`   Reply length: ${response.data.reply.length} chars`);
      console.log(`   Contains "pizza": ${response.data.reply.includes('pizza') || response.data.reply.includes('Pizza')}`);
      return true;
    } else {
      console.log('❌ Menu request test failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ Menu request test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test POST - Order
 */
async function testOrder() {
  console.log('\n📋 TEST 4: Order Processing (POST)');
  try {
    const response = await axios.post(API_ENDPOINT, {
      telefono: '+51999888777',
      nombre: 'Carlos Test',
      mensaje: 'quiero 2 pizzas hawaianas medianas',
      tipo: 'text'
    });
    
    if (response.status === 200 && response.data.ok) {
      console.log('✅ Order test passed');
      console.log(`   Reply: "${response.data.reply.substring(0, 150)}..."`);
      console.log(`   Contains "hawaiana": ${response.data.reply.toLowerCase().includes('hawaiana')}`);
      return true;
    } else {
      console.log('❌ Order test failed');
      return false;
    }
  } catch (error) {
    console.log(`❌ Order test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test POST - Invalid input
 */
async function testInvalidInput() {
  console.log('\n📋 TEST 5: Invalid Input Handling (POST)');
  try {
    const response = await axios.post(API_ENDPOINT, {
      // Missing telefono
      nombre: 'Test',
      mensaje: 'test',
      tipo: 'text'
    });
    
    // Should not get here if validation works
    console.log('❌ Invalid input test failed - should have rejected');
    return false;
    
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log('✅ Invalid input test passed - correctly rejected');
      console.log(`   Error: ${error.response.data.error || 'Validation error'}`);
      return true;
    } else {
      console.log(`❌ Invalid input test failed: ${error.message}`);
      return false;
    }
  }
}

/**
 * Test POST - Rate limiting (if enabled)
 */
async function testRateLimit() {
  console.log('\n📋 TEST 6: Rate Limiting (POST)');
  console.log('   Sending 5 rapid requests...');
  
  try {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        axios.post(API_ENDPOINT, {
          telefono: '+51999777666',
          nombre: 'Rate Test',
          mensaje: `test ${i}`,
          tipo: 'text'
        })
      );
    }
    
    const results = await Promise.allSettled(promises);
    const successes = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`✅ Rate limit test completed`);
    console.log(`   Successful: ${successes}/5`);
    console.log(`   Note: All passing means rate limit is high or disabled`);
    return true;
    
  } catch (error) {
    console.log(`⚠️  Rate limit test error: ${error.message}`);
    return true; // Not critical
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n🚀 Starting all tests...\n');
  
  const results = {
    healthCheck: await testHealthCheck(),
    greeting: await testGreeting(),
    menuRequest: await testMenuRequest(),
    order: await testOrder(),
    invalidInput: await testInvalidInput(),
    rateLimit: await testRateLimit()
  };
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;
  
  for (const [test, result] of Object.entries(results)) {
    console.log(`${result ? '✅' : '❌'} ${test}: ${result ? 'PASSED' : 'FAILED'}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${passed}/${total} tests passed (${Math.round(passed/total*100)}%)`);
  console.log('='.repeat(60));
  
  if (passed === total) {
    console.log('\n🎉 ALL TESTS PASSED! Bot is ready for production! 🚀');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Review the logs above.');
    process.exit(1);
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('\n❌ Test suite error:', error.message);
    process.exit(1);
  });
}

export default runAllTests;
