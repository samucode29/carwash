/**
 * Comprobante de pago de nómina (comisiones de lavador o salario de
 * empleado) pensado para IMPRIMIR: lleva el detalle del pago y dos espacios
 * de firma (quien recibe y quien paga). El negocio lo imprime, lo firman y
 * lo archiva en físico, por eso el sistema ya no pide subir un soporte.
 */
const PDFDocument = require('pdfkit');
const { formatearMoneda } = require('./generadorReportePdf');

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function menorMil(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto < 30) {
    if (resto) partes.push(UNIDADES[resto]);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    partes.push(u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d]);
  }
  return partes.join(' ');
}

function apocopar(texto) {
  return texto.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
}

/** 1.250.000 → "un millón doscientos cincuenta mil pesos". */
function numeroALetras(valor) {
  let n = Math.round(Number(valor) || 0);
  if (n === 0) return 'cero pesos';
  const millones = Math.floor(n / 1000000);
  n %= 1000000;
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'un millón' : `${apocopar(menorMil(millones))} millones`);
  if (miles) partes.push(miles === 1 ? 'mil' : `${apocopar(menorMil(miles))} mil`);
  if (resto) partes.push(menorMil(resto));
  const texto = partes.join(' ');
  const deMillones = millones && !miles && !resto ? ' de' : '';
  return `${texto}${deMillones} pesos`;
}

function fechaCorta(valor) {
  return String(valor || '').substring(0, 10);
}

function dibujarFirma(doc, x, y, ancho, titulo, nombre, documento) {
  doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor('#333').lineWidth(1).stroke();
  doc.fontSize(10).fillColor('#111').text(titulo, x, y + 6, { width: ancho, align: 'center' });
  if (nombre) doc.fontSize(10).fillColor('#333').text(nombre, x, doc.y, { width: ancho, align: 'center' });
  doc.fontSize(9).fillColor('#555').text(documento ? `C.C. ${documento}` : 'C.C. ______________________', x, doc.y, { width: ancho, align: 'center' });
}

/**
 * @param {import('express').Response} res
 * @param {{titulo: string, numero: string, nombreArchivo: string, fechaPago: string,
 *          persona: {nombre: string, documento?: string, etiqueta: string},
 *          periodo: string, concepto: string, valorNeto: number,
 *          filas: [string, string][], notas?: string[]}} datos
 */
function generarPdfComprobanteNomina(res, datos) {
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${datos.nombreArchivo}"`);
  doc.pipe(res);

  const izquierda = 50;
  const ancho = 512;

  doc.fontSize(20).fillColor('#0077b6').text('CarWash Pro', izquierda, 50);
  doc.fontSize(14).fillColor('#111').text(datos.titulo);
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#555').text(`Comprobante N° ${datos.numero}   |   Fecha de pago: ${fechaCorta(datos.fechaPago)}`);
  doc.moveDown(0.8);
  doc.moveTo(izquierda, doc.y).lineTo(izquierda + ancho, doc.y).strokeColor('#ddd').lineWidth(1).stroke();
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor('#333');
  doc.text(`${datos.persona.etiqueta}: `, izquierda, doc.y, { continued: true }).fillColor('#000').text(datos.persona.nombre);
  doc.fillColor('#333').text('Documento de identidad: ', izquierda, doc.y, { continued: true }).fillColor('#000').text(datos.persona.documento || '—');
  doc.fillColor('#333').text('Período: ', izquierda, doc.y, { continued: true }).fillColor('#000').text(datos.periodo);
  doc.fillColor('#333').text('Concepto: ', izquierda, doc.y, { continued: true }).fillColor('#000').text(datos.concepto);
  doc.moveDown(0.8);

  doc.fontSize(13).fillColor('#111').text('Detalle del Pago', izquierda, doc.y, { underline: true });
  doc.moveDown(0.5);
  datos.filas.forEach(([etiqueta, valor]) => {
    doc.fontSize(11).fillColor('#333').text(etiqueta, izquierda, doc.y, { continued: true, width: 340 });
    doc.fillColor('#000').text(String(valor), { align: 'right' });
  });
  doc.moveDown(0.4);
  doc.moveTo(izquierda, doc.y).lineTo(izquierda + ancho, doc.y).strokeColor('#999').lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fontSize(14).fillColor('#111').text('TOTAL PAGADO', izquierda, doc.y, { continued: true, width: 340 });
  doc.text(formatearMoneda(datos.valorNeto), { align: 'right' });
  doc.moveDown(0.6);

  const letras = numeroALetras(datos.valorNeto);
  doc.fontSize(10).fillColor('#333').text(`Son: ${letras.charAt(0).toUpperCase()}${letras.slice(1)}.`, izquierda, doc.y, { width: ancho });
  doc.moveDown(0.8);

  doc.fontSize(10).fillColor('#333').text(
    `Yo, ${datos.persona.nombre}${datos.persona.documento ? `, identificado(a) con documento ${datos.persona.documento}` : ''}, declaro que recibí a satisfacción de CarWash Pro la suma de ${formatearMoneda(datos.valorNeto)} (${letras}) por el concepto y período indicados, y que con este pago quedan saldados esos valores.`,
    izquierda, doc.y, { width: ancho, align: 'justify' }
  );

  (datos.notas || []).forEach(nota => {
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#666').text(nota, izquierda, doc.y, { width: ancho });
  });

  // Firmas: si no queda espacio en la página, pasan a una nueva.
  if (doc.y > 590) doc.addPage();
  const yFirma = Math.max(doc.y + 90, 620);
  dibujarFirma(doc, izquierda, yFirma, 230, 'Firma de quien recibe', datos.persona.nombre, datos.persona.documento);
  dibujarFirma(doc, izquierda + 282, yFirma, 230, 'Firma de quien paga (CarWash Pro)', '', '');

  doc.fontSize(8).fillColor('#999').text(`Generado: ${new Date().toLocaleString('es-CO')}`, izquierda, 745, { width: ancho, align: 'center' });

  doc.end();
}

module.exports = { generarPdfComprobanteNomina, numeroALetras };
