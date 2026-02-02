export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ respuesta: 'Método no permitido' });
  }

  const { archivo } = req.body;

  if (!archivo) {
    return res.status(400).json({ respuesta: 'No se recibió ninguna imagen' });
  }

  try {
    // Simulación de OCR (aquí iría tu lógica real con Tesseract, Google Vision, etc.)
    const montoDetectado = '25.00'; // ejemplo fijo para test

    // Validación básica
    const esValido = montoDetectado === '25.00'; // puedes comparar con pedido registrado

    const respuesta = esValido
      ? `Comprobante válido por S/${montoDetectado} ✅`
      : `El comprobante no coincide con el monto esperado ❌`;

    return res.status(200).json({ respuesta });
  } catch (error) {
    console.error('Error en OCR:', error);
    return res.status(500).json({ respuesta: 'Error al procesar la imagen' });
  }
}
