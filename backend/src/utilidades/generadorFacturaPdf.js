/**
 * Genera el PDF descargable/imprimible de una factura (venta, compra o pago de
 * nómina) y lo transmite directamente sobre la respuesta HTTP, sin guardar el
 * archivo. Además de los datos de la factura incluye el detalle completo de la
 * operación: quién es el cliente o proveedor, el vehículo, los servicios o
 * insumos con su valor, quién atendió, cómo se pagó, descuentos y propina.
 */
const PDFDocument = require('pdfkit');
const F = require('./formatos');

const M = 40;
const W = 532;
const AZUL_OSCURO = '#0b3a5b';
const AZUL = '#0077b6';
const GRIS = '#64748b';
const TEXTO = '#0f172a';
const LIMITE_Y = 792 - 60;

const TITULOS = { venta: 'Factura de Venta', compra: 'Factura de Compra', nomina: 'Comprobante de Pago de Nómina' };

function limpiar(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/[−–]/g, '-').replace(/→/g, '>').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function fechaHora(valor) {
  return valor ? String(valor).substring(0, 16) : '-';
}

/** Recuadro con título y pares etiqueta/valor; devuelve su alto para alinear lo que sigue. */
function caja(doc, x, y, ancho, titulo, pares) {
  const filas = pares.filter(p => p[1] !== undefined && p[1] !== null && String(p[1]).trim() !== '');
  doc.font('Helvetica').fontSize(9);
  let alto = 30;
  const alturas = filas.map(([, valor]) => {
    const h = Math.max(13, doc.heightOfString(limpiar(valor), { width: ancho - 100 }) + 2);
    alto += h;
    return h;
  });
  alto += 6;
  doc.roundedRect(x, y, ancho, alto, 6).fillAndStroke('#f8fafc', '#e2e8f0');
  doc.rect(x, y + 6, 3, alto - 12).fill(AZUL);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text(limpiar(titulo).toUpperCase(), x + 12, y + 9, { width: ancho - 20, lineBreak: false });
  let yy = y + 26;
  filas.forEach(([etiqueta, valor], i) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(limpiar(etiqueta), x + 12, yy + 0.5, { width: 82, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXTO).text(limpiar(valor), x + 96, yy, { width: ancho - 106 });
    yy += alturas[i];
  });
  return alto;
}

function tablaItems(doc, y, columnas, filas) {
  const total = columnas.reduce((a, c) => a + c.ancho, 0);
  const xs = columnas.reduce((acc, c, i) => { acc.push(i === 0 ? M : acc[i - 1] + columnas[i - 1].ancho); return acc; }, []);
  doc.rect(M, y, total, 20).fill(AZUL_OSCURO);
  columnas.forEach((c, i) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
      .text(limpiar(c.titulo), xs[i] + 6, y + 6, { width: c.ancho - 12, align: c.alinear === 'der' ? 'right' : 'left', lineBreak: false });
  });
  let yy = y + 20;
  filas.forEach((fila, idx) => {
    doc.font('Helvetica').fontSize(9.5);
    const alto = Math.max(20, doc.heightOfString(limpiar(fila[0]), { width: columnas[0].ancho - 12 }) + 10);
    if (idx % 2 === 1) doc.rect(M, yy, total, alto).fill('#f8fafc');
    fila.forEach((celda, i) => {
      doc.font('Helvetica').fontSize(9.5).fillColor(TEXTO)
        .text(limpiar(celda), xs[i] + 6, yy + 5, { width: columnas[i].ancho - 12, align: columnas[i].alinear === 'der' ? 'right' : 'left' });
    });
    doc.moveTo(M, yy + alto).lineTo(M + total, yy + alto).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
    yy += alto;
  });
  return yy;
}

/** Bloque de totales alineado a la derecha: [[etiqueta, valor, estilo]] */
function totales(doc, y, filas) {
  const ancho = 250;
  const x = M + W - ancho;
  let yy = y;
  filas.forEach(([etiqueta, valor, estilo]) => {
    if (estilo === 'total') {
      doc.roundedRect(x, yy, ancho, 30, 6).fill('#e0f2fe');
      doc.font('Helvetica-Bold').fontSize(12).fillColor(AZUL_OSCURO).text(limpiar(etiqueta), x + 12, yy + 9, { width: 130, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(14).fillColor(AZUL).text(limpiar(valor), x + 100, yy + 8, { width: ancho - 112, align: 'right', lineBreak: false });
      yy += 36;
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(limpiar(etiqueta), x + 12, yy, { width: 140, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(estilo === 'rojo' ? '#b91c1c' : TEXTO).text(limpiar(valor), x + 100, yy, { width: ancho - 112, align: 'right', lineBreak: false });
      yy += 16;
    }
  });
  return yy;
}

function generarPdfFactura(res, factura, detalle = {}) {
  const doc = new PDFDocument({ margin: M, size: 'LETTER', info: { Title: `${TITULOS[factura.tipo] || 'Factura'} ${factura.numero_factura}`, Author: 'CarWash Pro' } });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${factura.numero_factura}.pdf"`);
  doc.pipe(res);

  // ---- Encabezado
  doc.rect(0, 0, 612, 100).fill(AZUL_OSCURO);
  doc.rect(0, 100, 612, 4).fill('#00b4d8');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#7dd3fc').text('CARWASH PRO', M, 24, { characterSpacing: 2, lineBreak: false });
  const titulo = TITULOS[factura.tipo] || 'Factura';
  let tamTitulo = 20;
  doc.font('Helvetica-Bold').fontSize(tamTitulo);
  while (doc.widthOfString(titulo) > 290 && tamTitulo > 12) { tamTitulo -= 1; doc.fontSize(tamTitulo); }
  doc.fillColor('#ffffff').text(titulo, M, 42, { width: 300, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor('#93c5fd').text('Servicio de lavado y detallado de vehículos', M, 72, { width: 300, lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor('#93c5fd').text('No.', 372, 24, { width: 200, align: 'right', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text(limpiar(factura.numero_factura), 340, 36, { width: 232, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#e0f2fe').text(`Fecha: ${F.fecha(factura.fecha)}`, 340, 60, { width: 232, align: 'right', lineBreak: false });
  const emitida = detalle.pago && detalle.pago.fecha ? `Pagada el ${fechaHora(detalle.pago.fecha)}` : `Emitida el ${fechaHora(factura.creado_en)}`;
  doc.font('Helvetica').fontSize(8.5).fillColor('#93c5fd').text(emitida, 340, 76, { width: 232, align: 'right', lineBreak: false });

  let y = 124;

  // ======================================================== VENTA
  if (factura.tipo === 'venta') {
    const cliente = detalle.cliente;
    const v = detalle.vehiculo || {};
    const hCliente = caja(doc, M, y, 258, 'Cliente', [
      ['Nombre', cliente ? cliente.nombre : 'Venta anónima / cliente ocasional'],
      ['Celular', cliente ? cliente.telefono : ''],
      ['Correo', cliente ? cliente.correo : '']
    ]);
    const hVeh = caja(doc, M + 274, y, 258, 'Vehículo', [
      ['Placa', v.placa || '-'],
      ['Tipo', F.capitalizar(v.tipo)],
      ['Marca', v.marca],
      ['Color', v.color]
    ]);
    y += Math.max(hCliente, hVeh) + 12;

    if (detalle.orden) {
      const o = detalle.orden;
      const hOrden = caja(doc, M, y, 258, 'Servicio prestado', [
        ['Orden', `#${o.id}`],
        ['Ingreso', fechaHora(o.ingreso)],
        ['Entrega', o.entrega ? fechaHora(o.entrega) : ''],
        ['Atendido por', (detalle.lavadores || []).join(', ') || 'Sin asignar']
      ]);
      const p = detalle.pago;
      const hPago = caja(doc, M + 274, y, 258, 'Pago', [
        ['Método', p ? F.etiquetaMetodo(p.metodo) : ''],
        ['Fecha de pago', p ? fechaHora(p.fecha) : ''],
        ['Cobrado por', factura.creado_por_nombre || o.registradoPor],
        ['Estado', p ? 'PAGADA' : '']
      ]);
      y += Math.max(hOrden, hPago) + 12;
      if (o.observacion) {
        y += caja(doc, M, y, W, 'Observaciones del servicio', [['Nota', o.observacion]]) + 12;
      }
    }

    const items = (detalle.items && detalle.items.length) ? detalle.items : [{ descripcion: factura.concepto, cantidad: 1, valor: Number(factura.total) }];
    y = tablaItems(doc, y, [
      { titulo: 'Descripción', ancho: 292 }, { titulo: 'Cant.', ancho: 50, alinear: 'der' },
      { titulo: 'Valor unitario', ancho: 95, alinear: 'der' }, { titulo: 'Valor', ancho: 95, alinear: 'der' }
    ], items.map(i => [i.descripcion, String(i.cantidad), F.moneda(i.valor / (i.cantidad || 1)), F.moneda(i.valor)])) + 14;

    const p = detalle.pago;
    const filas = [['Subtotal', F.moneda(detalle.subtotal !== undefined ? detalle.subtotal : factura.total)]];
    if (p && p.descuento > 0) filas.push(['Descuento otorgado', `-${F.moneda(p.descuento)}`, 'rojo']);
    filas.push(['TOTAL PAGADO', F.moneda(p ? p.monto : factura.total), 'total']);
    y = totales(doc, y, filas);
    if (p && p.propina > 0) {
      y += 4;
      doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(
        `Propina voluntaria: ${F.moneda(p.propina)}. Es 100% para quien atendió el servicio y no hace parte del total de esta factura.`,
        M + W - 250, y, { width: 250 }
      );
    }
  }

  // ======================================================== COMPRA
  if (factura.tipo === 'compra') {
    const prov = detalle.proveedor || { nombre: factura.proveedor_nombre };
    const c = detalle.compra || {};
    const hProv = caja(doc, M, y, 258, 'Proveedor', [
      ['Nombre', prov.nombre || 'Sin proveedor asociado'],
      ['Contacto', prov.contacto],
      ['Teléfono', prov.telefono],
      ['Correo', prov.correo],
      ['Dirección', prov.direccion]
    ]);
    const hCompra = caja(doc, M + 274, y, 258, 'Datos de la compra', [
      ['Ingreso al inventario', c.fecha ? fechaHora(c.fecha) : F.fecha(factura.fecha)],
      ['Registrada por', factura.creado_por_nombre || c.registradoPor],
      ['Observación', c.observacion]
    ]);
    y += Math.max(hProv, hCompra) + 14;

    const items = (detalle.items && detalle.items.length) ? detalle.items : [{ descripcion: factura.concepto, cantidad: factura.movimiento_cantidad || 1, unidad: '', valorUnitario: Number(factura.total), valor: Number(factura.total) }];
    y = tablaItems(doc, y, [
      { titulo: 'Insumo', ancho: 232 }, { titulo: 'Cantidad', ancho: 100, alinear: 'der' },
      { titulo: 'Costo unitario', ancho: 100, alinear: 'der' }, { titulo: 'Total', ancho: 100, alinear: 'der' }
    ], items.map(i => [i.descripcion, `${F.decimal(i.cantidad, 2)} ${i.unidad || ''}`.trim(), F.moneda(i.valorUnitario), F.moneda(i.valor)])) + 14;
    y = totales(doc, y, [['TOTAL COMPRA', F.moneda(factura.total), 'total']]);
  }

  // ======================================================== NÓMINA
  if (factura.tipo === 'nomina') {
    const per = detalle.persona || {};
    const hPer = caja(doc, M, y, 258, per.etiqueta || 'Beneficiario', [
      ['Nombre', per.nombre],
      ['Documento', per.documento],
      ['Rol', per.rol ? F.capitalizar(per.rol) : '']
    ]);
    const hDet = caja(doc, M + 274, y, 258, 'Detalle del pago', [
      ['Concepto', detalle.concepto || factura.concepto],
      ['Período', detalle.periodo],
      ['Fecha de pago', F.fecha(factura.fecha)],
      ['Registrado por', factura.creado_por_nombre]
    ]);
    y += Math.max(hPer, hDet) + 14;

    if (detalle.neto !== undefined) {
      y = tablaItems(doc, y, [{ titulo: 'Concepto', ancho: 392 }, { titulo: 'Valor', ancho: 140, alinear: 'der' }], [
        [detalle.concepto, F.moneda(detalle.bruto)],
        ['Descuentos (inasistencias, anticipos, etc.)', detalle.descuentos > 0 ? `-${F.moneda(detalle.descuentos)}` : F.moneda(0)]
      ]) + 14;
    } else {
      y = tablaItems(doc, y, [{ titulo: 'Concepto', ancho: 392 }, { titulo: 'Valor', ancho: 140, alinear: 'der' }], [[factura.concepto, F.moneda(factura.total)]]) + 14;
    }
    y = totales(doc, y, [['TOTAL PAGADO', F.moneda(factura.total), 'total']]);
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GRIS).text(
      'Este documento es el soporte contable del pago. El comprobante con espacios de firma se imprime desde Nómina (botón "Comprobante PDF").',
      M, y + 8, { width: W }
    );
  }

  // ---- Pie
  doc.moveTo(M, LIMITE_Y).lineTo(M + W, LIMITE_Y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
  doc.page.margins.bottom = 0;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(AZUL_OSCURO).text(
    factura.tipo === 'venta' ? 'Gracias por preferirnos' : 'Documento de soporte contable',
    M, LIMITE_Y + 8, { width: W, align: 'center', lineBreak: false }
  );
  doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8').text(
    `Documento generado automáticamente por CarWash Pro el ${new Date().toLocaleString('es-CO')}`,
    M, LIMITE_Y + 22, { width: W, align: 'center', lineBreak: false }
  );

  doc.end();
}

module.exports = { generarPdfFactura };
