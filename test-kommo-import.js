/**
 * Test script para verificar que api/kommo.js se pueda importar correctamente
 */

console.log('Iniciando test de importación...\n');

try {
  console.log('1. Importando kommo.js...');
  const kommoModule = await import('./api/kommo.js');
  console.log('✅ kommo.js importado exitosamente');
  console.log('   Exports:', Object.keys(kommoModule));
  
  console.log('\n2. Verificando handler...');
  if (typeof kommoModule.default === 'function') {
    console.log('✅ Handler encontrado');
  } else {
    console.log('❌ Handler no es una función');
  }
  
  console.log('\n✅ TODAS LAS IMPORTACIONES EXITOSAS\n');
  process.exit(0);
  
} catch (error) {
  console.error('\n❌ ERROR AL IMPORTAR:\n');
  console.error('Mensaje:', error.message);
  console.error('\nStack trace:');
  console.error(error.stack);
  console.error('\n');
  process.exit(1);
}
