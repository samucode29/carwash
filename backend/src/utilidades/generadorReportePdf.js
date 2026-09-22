/**
 * Genera el PDF descargable de un reporte financiero/operativo y lo transmite
 * directamente sobre la respuesta HTTP (streaming), sin guardar el archivo
 * en disco: ideal para un despliegue serverless (Vercel/Railway) donde el
 * sistema de archivos no es persistente.
 */
const PDFDocument = require('pdfkit');

function formatearMoneda(valor) {
  const numero = Number(valor) || 0;
  return '$' + numero.toLocaleString('es-CO');
}

/**
 * @param {import('express').Response} res
 * @param {object} reporte - resultado de ReporteRepositorio.calcularReporte()
 * @param {{etiquetaPeriodo: string}} opciones
 */
function generarPdfReporte(res, reporte, opciones = {}) {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const nombreArchivo = `reporte_carwash_${reporte.rango.inicio}_a_${reporte.rango.fin}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  doc.pipe(res);

  // Encabezado
  doc.fontSize(20).fillColor('#0077b6').text('CarWash Pro', { continued: false });
  doc.fontSize(14).fillColor('#111').text('Reporte de Operación y Ganancias');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#555').text(
    `Período: ${opciones.etiquetaPeriodo || reporte.rango.inicio + ' a ' + reporte.rango.fin}  |  Generado: ${new Date().toLocaleString('es-CO')}`
  );
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(560, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(1);

  // Resumen financiero
  doc.fontSize(13).fillColor('#111').text('Resumen Financiero', { underline: true });
  doc.moveDown(0.5);
  const filasResumen = [
    ['Ingresos Totales', formatearMoneda(reporte.totalIngresos)],
    ['Costo de Insumos', formatearMoneda(reporte.costoInsumos)],
    ['Comisiones de Lavadores', formatearMoneda(reporte.totalComisionesLavadores)],
    ['Gastos Operativos', formatearMoneda(reporte.totalGastos)],
    ['Ganancia Neta', formatearMoneda(reporte.gananciaNeta)],
    ['Margen Neto', `${reporte.margenPorcentaje}%`],
    ['Órdenes Atendidas', String(reporte.serviciosAtendidos)]
  ];
  filasResumen.forEach(([etiqueta, valor]) => {
    doc.fontSize(11).fillColor('#333').text(etiqueta, 50, doc.y, { continued: true, width: 300 });
    doc.fontSize(11).fillColor('#000').text(valor, { align: 'right' });
  });

  doc.moveDown(1.2);

  // Distribución por vehículo
  doc.fontSize(13).fillColor('#111').text('Vehículos Atendidos', { underline: true });
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#333').text(`Carros: ${reporte.distribucionVehiculos.carro}   |   Motos: ${reporte.distribucionVehiculos.moto}`);
  doc.moveDown(1);

  // Servicios más solicitados
  doc.fontSize(13).fillColor('#111').text('Ventas por Servicio', { underline: true });
  doc.moveDown(0.4);
  Object.entries(reporte.serviciosStats).forEach(([nombre, stat]) => {
    doc.fontSize(10).fillColor('#333').text(`${nombre}: ${stat.count} atendidos - ${formatearMoneda(stat.total)}`);
  });
  if (Object.keys(reporte.serviciosStats).length === 0) {
    doc.fontSize(10).fillColor('#888').text('Sin servicios registrados en el período.');
  }

  doc.moveDown(1);

  // Rendimiento por lavador
  doc.fontSize(13).fillColor('#111').text('Productividad por Lavador', { underline: true });
  doc.moveDown(0.4);
  Object.entries(reporte.lavadoresStats).forEach(([nombre, stat]) => {
    doc.fontSize(10).fillColor('#333').text(`${nombre}: ${stat.servicios} lavados - Comisión ${formatearMoneda(stat.comision)}`);
  });
  if (Object.keys(reporte.lavadoresStats).length === 0) {
    doc.fontSize(10).fillColor('#888').text('Sin actividad de lavadores en el período.');
  }

  doc.end();
}

module.exports = { generarPdfReporte, formatearMoneda };
