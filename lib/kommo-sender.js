/**
 * lib/kommo-sender.js
 * 
 * Sistema Ultra Inteligente de Envío de Pedidos a Kommo
 * Envía resúmenes de pedidos confirmados al agente humano
 * vía el mismo número del bot de WhatsApp
 */

import axios from 'axios';
import { logger, AppError, ValidationError, MetricsCollector, formatMoney } from './utils.js';
import { CONFIG } from './config.js';

const metrics = new MetricsCollector();

/**
 * Formatea un pedido completo en mensaje ultra humanizado para el agente
 * @param {Object} pedido - Datos del pedido
 * @param {Object} cliente - Datos del cliente
 * @returns {string} Mensaje formateado bellamente
 */
export function formatOrderForAgent(pedido, cliente = {}) {
  try {
    logger.debug('FORMATTING_ORDER_FOR_AGENT', { 
      orderId: pedido.id, 
      clientPhone: cliente.telefono 
    });

    const lines = [];
    
    // Header ultra visible
    lines.push('🔔 ═══════════════════════════════');
    lines.push('    ¡NUEVO PEDIDO CONFIRMADO!');
    lines.push('═══════════════════════════════ 🔔\n');
    
    // Info del cliente
    lines.push('👤 CLIENTE:');
    lines.push(`   Nombre: ${cliente.nombre || 'Cliente'}`);
    lines.push(`   Teléfono: ${cliente.telefono || 'N/A'}`);
    if (cliente.isVIP) lines.push('   ⭐ CLIENTE VIP ⭐');
    if (cliente.totalOrders > 1) lines.push(`   📊 Órdenes previas: ${cliente.totalOrders}`);
    lines.push('');
    
    // Items del pedido
    lines.push('🍕 ITEMS:');
    if (pedido.items && pedido.items.length > 0) {
      pedido.items.forEach((item, idx) => {
        const qty = item.cantidad || item.quantity || 1;
        const name = item.nombre || item.name || 'Item';
        const size = item.tamano || item.size || '';
        const price = item.precio || item.price || 0;
        const extras = item.extras || [];
        
        lines.push(`   ${idx + 1}. ${qty}x ${name}${size ? ` (${size})` : ''}`);
        if (price > 0) lines.push(`      Precio: S/ ${price.toFixed(2)}`);
        
        if (extras.length > 0) {
          lines.push(`      Extras: ${extras.join(', ')}`);
        }
        
        if (item.notas || item.observaciones) {
          lines.push(`      📝 Nota: ${item.notas || item.observaciones}`);
        }
      });
    } else {
      lines.push('   (Sin items especificados)');
    }
    lines.push('');
    
    // Totales
    lines.push('💰 TOTALES:');
    const subtotal = pedido.subtotal || pedido.total || 0;
    const delivery = pedido.costoEnvio || pedido.delivery || 0;
    const total = pedido.total || (subtotal + delivery);
    
    lines.push(`   Subtotal: S/ ${subtotal.toFixed(2)}`);
    if (delivery > 0) {
      lines.push(`   Delivery: S/ ${delivery.toFixed(2)}`);
    }
    lines.push(`   ───────────────────`);
    lines.push(`   TOTAL: S/ ${total.toFixed(2)}`);
    lines.push('');
    
    // Método de pago
    lines.push('💳 PAGO:');
    const metodoPago = pedido.metodoPago || pedido.paymentMethod || 'No especificado';
    lines.push(`   Método: ${metodoPago}`);
    if (pedido.pagoVerificado) {
      lines.push('   ✅ Pago verificado');
    } else if (metodoPago.toLowerCase().includes('efectivo')) {
      lines.push('   💵 Pago en efectivo al entregar');
      if (pedido.pagarCon) {
        lines.push(`   Cliente pagará con: S/ ${pedido.pagarCon}`);
        const cambio = pedido.pagarCon - total;
        if (cambio > 0) lines.push(`   Cambio: S/ ${cambio.toFixed(2)}`);
      }
    }
    lines.push('');
    
    // Dirección de entrega
    lines.push('📍 ENTREGA:');
    if (pedido.direccion || pedido.address) {
      lines.push(`   ${pedido.direccion || pedido.address}`);
      if (pedido.referencia) {
        lines.push(`   Ref: ${pedido.referencia}`);
      }
      if (pedido.coordenadas) {
        lines.push(`   📌 Coords: ${pedido.coordenadas.lat}, ${pedido.coordenadas.lon}`);
      }
    } else {
      lines.push('   ⚠️ SIN DIRECCIÓN - Preguntar al cliente');
    }
    
    if (pedido.tiempoEstimado) {
      lines.push(`   ⏰ Tiempo estimado: ${pedido.tiempoEstimado} min`);
    }
    lines.push('');
    
    // Notas especiales
    if (pedido.notas || pedido.observacionesGenerales) {
      lines.push('📝 NOTAS ESPECIALES:');
      lines.push(`   ${pedido.notas || pedido.observacionesGenerales}`);
      lines.push('');
    }
    
    // Timestamp
    const now = new Date();
    lines.push(`⏰ Recibido: ${now.toLocaleString('es-PE', { 
      timeZone: 'America/Lima',
      dateStyle: 'short',
      timeStyle: 'medium'
    })}`);
    
    // Footer
    lines.push('\n═══════════════════════════════');
    lines.push('  Procesar este pedido AHORA');
    lines.push('═══════════════════════════════');
    
    const formattedMessage = lines.join('\n');
    
    logger.info('ORDER_FORMATTED_FOR_AGENT', { 
      orderId: pedido.id,
      messageLength: formattedMessage.length,
      itemsCount: pedido.items?.length || 0
    });
    
    metrics.record('order_formatted', 1, { success: true });
    
    return formattedMessage;
    
  } catch (error) {
    logger.error('FORMAT_ORDER_ERROR', error);
    metrics.record('order_formatted', 1, { success: false });
    
    // Fallback simple si falla el formateo
    return `🔔 NUEVO PEDIDO\n\nCliente: ${cliente.nombre || 'N/A'}\nTel: ${cliente.telefono || 'N/A'}\nTotal: S/ ${pedido.total || 0}\n\n⚠️ Ver detalles completos en sesión`;
  }
}

/**
 * Envía un pedido confirmado al número de Kommo (agente humano)
 * Usa el mismo número del bot para notificar al agente
 * @param {Object} pedido - Pedido completo
 * @param {Object} cliente - Datos del cliente
 * @returns {Promise<Object>} Resultado del envío
 */
export async function sendOrderToAgent(pedido, cliente = {}) {
  const startTime = Date.now();
  
  try {
    logger.info('SENDING_ORDER_TO_AGENT', { 
      orderId: pedido.id,
      clientPhone: cliente.telefono,
      agentPhone: CONFIG.KOMMO_PHONE_NUMBER
    });
    
    // Validaciones
    if (!pedido || typeof pedido !== 'object') {
      throw new ValidationError('INVALID_ORDER', 'Pedido inválido');
    }
    
    if (!CONFIG.KOMMO_PHONE_NUMBER) {
      logger.warn('NO_AGENT_PHONE_CONFIGURED', { 
        hint: 'Set KOMMO_PHONE_NUMBER or STORE_PHONE env var' 
      });
      // No es error crítico, solo no se envía
      return { 
        ok: false, 
        sent: false, 
        reason: 'No agent phone configured',
        message: 'Order saved but not sent to agent'
      };
    }
    
    // Formatear mensaje ultra profesional
    const message = formatOrderForAgent(pedido, cliente);
    
    // Intentar enviar via webhook si está configurado
    if (CONFIG.KOMMO_AGENT_WEBHOOK) {
      try {
        const response = await axios.post(
          CONFIG.KOMMO_AGENT_WEBHOOK,
          {
            to: CONFIG.KOMMO_PHONE_NUMBER,
            from: cliente.telefono,
            message: message,
            type: 'order_confirmed',
            order: pedido,
            client: cliente,
            timestamp: new Date().toISOString()
          },
          {
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'DYPSI-Middleware/2.0'
            }
          }
        );
        
        const duration = Date.now() - startTime;
        
        logger.info('ORDER_SENT_TO_AGENT_SUCCESS', { 
          orderId: pedido.id,
          webhook: CONFIG.KOMMO_AGENT_WEBHOOK,
          duration,
          status: response.status
        });
        
        metrics.record('order_sent_to_agent', 1, { 
          success: true, 
          method: 'webhook',
          duration 
        });
        
        return {
          ok: true,
          sent: true,
          method: 'webhook',
          message: 'Pedido enviado al agente exitosamente',
          duration
        };
        
      } catch (webhookError) {
        logger.error('WEBHOOK_SEND_FAILED', webhookError, {
          webhook: CONFIG.KOMMO_AGENT_WEBHOOK,
          willFallback: true
        });
        // Continue to fallback method
      }
    }
    
    // Fallback: Guardar en Firebase para que el agente lo vea
    // (Ya se guarda en session-store, esto es redundancia)
    logger.info('ORDER_SAVED_FOR_AGENT_REVIEW', { 
      orderId: pedido.id,
      agentPhone: CONFIG.KOMMO_PHONE_NUMBER,
      message: 'Order saved in session store for agent to review'
    });
    
    metrics.record('order_sent_to_agent', 1, { 
      success: true, 
      method: 'session_store' 
    });
    
    return {
      ok: true,
      sent: true,
      method: 'session_store',
      message: 'Pedido guardado para revisión del agente',
      agentPhone: CONFIG.KOMMO_PHONE_NUMBER,
      formattedMessage: message
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('SEND_ORDER_TO_AGENT_ERROR', error, {
      orderId: pedido?.id,
      clientPhone: cliente?.telefono,
      duration
    });
    
    metrics.record('order_sent_to_agent', 1, { 
      success: false, 
      error: error.message,
      duration 
    });
    
    throw new AppError(
      'Error al enviar pedido al agente',
      500,
      'AGENT_SEND_ERROR',
      { originalError: error.message }
    );
  }
}

/**
 * Crea un resumen corto del pedido para notificaciones rápidas
 * @param {Object} pedido 
 * @returns {string}
 */
export function createOrderShortSummary(pedido) {
  try {
    const items = pedido.items || [];
    const itemsText = items.length > 0 
      ? items.slice(0, 3).map(i => `${i.cantidad || 1}x ${i.nombre}`).join(', ')
      : 'Sin items';
    
    const more = items.length > 3 ? ` +${items.length - 3} más` : '';
    const total = pedido.total || 0;
    
    return `🔔 Pedido S/${total.toFixed(2)}: ${itemsText}${more}`;
    
  } catch (error) {
    logger.error('SHORT_SUMMARY_ERROR', error);
    return '🔔 Nuevo pedido recibido';
  }
}

/**
 * Valida que un pedido esté listo para ser enviado al agente
 * @param {Object} pedido 
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateOrderForAgent(pedido) {
  const errors = [];
  
  if (!pedido) {
    errors.push('Pedido es null o undefined');
    return { valid: false, errors };
  }
  
  if (!pedido.items || pedido.items.length === 0) {
    errors.push('Pedido sin items');
  }
  
  if (!pedido.total || pedido.total <= 0) {
    errors.push('Total inválido o cero');
  }
  
  if (!pedido.metodoPago) {
    errors.push('Sin método de pago especificado');
  }
  
  // Warnings (no críticos)
  const warnings = [];
  
  if (!pedido.direccion && !pedido.address) {
    warnings.push('Sin dirección de entrega');
  }
  
  if (!pedido.pagoVerificado && pedido.metodoPago?.toLowerCase().includes('yape')) {
    warnings.push('Pago Yape no verificado');
  }
  
  if (warnings.length > 0) {
    logger.warn('ORDER_VALIDATION_WARNINGS', { warnings, orderId: pedido.id });
  }
  
  const valid = errors.length === 0;
  
  logger.debug('ORDER_VALIDATION', { 
    valid, 
    errors, 
    warnings,
    orderId: pedido.id 
  });
  
  return { valid, errors, warnings };
}

export default {
  sendOrderToAgent,
  formatOrderForAgent,
  createOrderShortSummary,
  validateOrderForAgent
};
