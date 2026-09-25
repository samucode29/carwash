/**
 * Genera el PDF descargable/imprimible de una factura (compra o venta) y lo
 * transmite directamente sobre la respuesta HTTP, sin guardar el archivo.
 */
const PDFDocument = require('pdfkit');

function formatearMoneda(valor) {
  const numero = Number(valor) || 0;
  return '$' + numero.toLocaleString('es-CO');
}

/**
 * @param {import('express').Response} res
 * @param {object} factura - resultado de FacturaRepositorio.obtenerFacturaPorId()
 */
function generarPdfFactura(res, factura) {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${factura.numero_factura}.pdf"`);
  doc.pipe(res);

  const esVenta = factura.tipo === 'venta';

  doc.fontSize(20).fillColor('#0077b6').text('CarWash Pro');
  doc.fontSize(14).fillColor('#111').text(esVenta ? 'Factura de Venta' : 'Factura de Compra');
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#555').text(`No. ${factura.numero_factura}`);
  doc.fontSize(10).fillColor('#555').text(`Fecha: ${factura.fecha}  |  Generada: ${new Date().toLocaleString('es-CO')}`);
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(560, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(1);

  doc.fontSize(13).fillColor('#111').text(esVenta ? 'Cliente' : 'Proveedor', { underline: true });
  doc.moveDown(0.4);
  if (esVenta) {
    doc.fontSize(11).fillColor('#333').text(factura.cliente_nombre || 'Venta anónima / cliente ocasional');
    if (factura.cliente_telefono) doc.fontSize(10).fillColor('#555').text(factura.cliente_telefono);
    if (factura.placa_anonima) doc.fontSize(10).fillColor('#555').text(`Vehículo: ${factura.placa_anonima} (${factura.tipo_vehiculo_anonimo || ''})`);
  } else {
    doc.fontSize(11).fillColor('#333').text(factura.proveedor_nombre || 'Sin proveedor asociado');
  }
  doc.moveDown(1);

  doc.fontSize(13).fillColor('#111').text('Detalle', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#333').text(factura.concepto, 50, doc.y, { continued: true, width: 350 });
  doc.fontSize(11).fillColor('#000').text(formatearMoneda(factura.total), { align: 'right' });
  if (!esVenta && factura.movimiento_cantidad) {
    doc.fontSize(9).fillColor('#888').text(`Cantidad ingresada: ${factura.movimiento_cantidad}`);
  }
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(560, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(0.6);

  doc.fontSize(13).fillColor('#111').text('Total', 50, doc.y, { continued: true, width: 400 });
  doc.fontSize(13).fillColor('#0077b6').text(formatearMoneda(factura.total), { align: 'right' });

  doc.moveDown(2);
  doc.fontSize(9).fillColor('#888').text(`Registrado por: ${factura.creado_por_nombre || '-'}`);
  doc.fontSize(8).fillColor('#aaa').text('Documento generado automáticamente por CarWash Pro.', { align: 'center' });

  doc.end();
}

module.exports = { generarPdfFactura };
