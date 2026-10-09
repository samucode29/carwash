/**
 * Arma, para cada reporte, un "documento" estructurado (KPIs, hallazgos,
 * gráficos y tablas con su explicación). El MISMO documento se dibuja en
 * pantalla (frontend/js/app.js) y en el PDF (generadorReportePdf.js), así los
 * números y el orden siempre coinciden.
 *
 * Forma del documento:
 *  { tipo, titulo, descripcion, periodo: {etiqueta, inicio, fin} | null,
 *    kpis: [{titulo, valor, detalle?, tono?, variacion?, mejorSiSube?}],
 *    hallazgos: [texto],
 *    secciones: [ barras | dona | serie | tabla | formula | texto ] }
 */
const F = require('./formatos');

const PALETA = ['#0077b6', '#00b4d8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b', '#ec4899', '#14b8a6', '#f97316'];
const color = (i) => PALETA[i % PALETA.length];

const GRAN_TEXTO = { hora: 'hora', dia: 'día', mes: 'mes' };

function documento({ tipo, titulo, descripcion, periodo }) {
  return { tipo, titulo, descripcion, periodo: periodo || null, kpis: [], hallazgos: [], secciones: [] };
}

function kpi(titulo, valor, extra = {}) {
  return { titulo, valor, ...extra };
}

/** Columnas de tabla: 'der' alinea números a la derecha. */
const col = (titulo, alinear = 'izq') => ({ titulo, alinear });
const celda = (t, tono) => ({ t: String(t), tono });

function tabla(titulo, explicacion, columnas, filas, { totales = null, nota = null, vacio = 'Sin datos en el período.', accion = null, totalFilas = null } = {}) {
  const extraNota = totalFilas && totalFilas > filas.length
    ? `Se muestran las ${F.entero(filas.length)} filas más recientes de ${F.entero(totalFilas)}; los totales de arriba sí incluyen todas.`
    : null;
  return { tipo: 'tabla', titulo, explicacion, columnas, filas, totales, nota: [nota, extraNota].filter(Boolean).join(' ') || null, vacio, accion };
}

/** Un solo día se grafica por hora: se recorta a las horas con actividad (mínimo 7am–7pm). */
function recortarHoras(etiquetas, series) {
  let lo = 7;
  let hi = 19;
  series.forEach(s => s.valores.forEach((v, i) => { if (v > 0) { lo = Math.min(lo, i); hi = Math.max(hi, i); } }));
  return {
    etiquetas: etiquetas.slice(lo, hi + 1),
    series: series.map(s => ({ ...s, valores: s.valores.slice(lo, hi + 1) }))
  };
}

function serie(titulo, explicacion, gran, etiquetas, series, { formato = 'dinero', estilo = 'columnas' } = {}) {
  let e = etiquetas;
  let s = series;
  if (gran === 'hora') ({ etiquetas: e, series: s } = recortarHoras(etiquetas, series));
  return { tipo: 'serie', titulo, explicacion, etiquetas: e, series: s, formato, estilo };
}

function barras(titulo, explicacion, items, { colorUnico = null } = {}) {
  return {
    tipo: 'barras', titulo, explicacion,
    items: items.map((it, i) => ({ ...it, color: it.color || colorUnico || color(i) }))
  };
}

function dona(titulo, explicacion, items) {
  return {
    tipo: 'dona', titulo, explicacion,
    items: items.map((it, i) => ({ ...it, color: it.color || color(i) }))
  };
}

function texto(titulo, contenido) {
  return { tipo: 'texto', titulo, texto: contenido };
}

/** Indica el mayor valor de un arreglo y su posición. */
function maximo(valores) {
  let mejor = -1;
  let indice = -1;
  valores.forEach((v, i) => { if (v > mejor) { mejor = v; indice = i; } });
  return mejor > 0 ? { valor: mejor, indice } : null;
}

function minimoConActividad(valores) {
  let menor = Infinity;
  let indice = -1;
  valores.forEach((v, i) => { if (v > 0 && v < menor) { menor = v; indice = i; } });
  return indice >= 0 ? { valor: menor, indice } : null;
}

function frasePico(gran, etiqueta) {
  if (gran === 'hora') return `La hora más fuerte fue las ${etiqueta}`;
  if (gran === 'mes') return `El mejor mes fue ${etiqueta}`;
  return `El mejor día fue ${etiqueta}`;
}

function textoVariacion(v) {
  if (v === null || v === undefined) return null;
  return `${v > 0 ? 'subieron' : v < 0 ? 'bajaron' : 'se mantuvieron'} ${F.porcentaje(Math.abs(v))}`;
}

function tonoVariacion(v, mejorSiSube = true) {
  if (v === null || v === undefined || v === 0) return undefined;
  const sube = v > 0;
  return sube === mejorSiSube ? 'ok' : 'mal';
}

// ---------------------------------------------------------------------------
// RESUMEN GENERAL
// ---------------------------------------------------------------------------
function vistaResumen(r, previo, periodo) {
  const doc = documento({
    tipo: 'resumen', titulo: 'Resumen General del Negocio', periodo,
    descripcion: 'Foto completa del período: cuánto entró, en qué se fue el dinero y cuánto quedó de ganancia. La ganancia neta es lo que ingresa menos las compras de insumos, las comisiones de los lavadores y los gastos operativos.'
  });
  const v = (act, ant) => (ant > 0 ? Number((((act - ant) / ant) * 100).toFixed(1)) : null);
  const totalCostos = r.costoInsumos + r.totalComisionesLavadores + r.totalGastos;
  const sinVentas = r.serviciosAtendidos === 0;

  doc.kpis.push(
    kpi('Ingresos', F.moneda(r.totalIngresos), { tono: 'ok', detalle: 'Dinero cobrado por servicios', variacion: previo ? v(r.totalIngresos, previo.totalIngresos) : null }),
    kpi('Ganancia neta', F.moneda(r.gananciaNeta), { tono: r.gananciaNeta >= 0 ? 'ok' : 'mal', detalle: `Margen de rentabilidad: ${F.porcentaje(r.margenPorcentaje)}`, variacion: previo ? v(r.gananciaNeta, previo.gananciaNeta) : null }),
    kpi('Servicios atendidos', F.entero(r.serviciosAtendidos), { detalle: 'Órdenes cobradas', variacion: previo ? v(r.serviciosAtendidos, previo.serviciosAtendidos) : null }),
    kpi('Ticket promedio', F.moneda(r.ticketPromedio), { detalle: 'Ingreso medio por servicio', variacion: previo ? v(r.ticketPromedio, previo.ticketPromedio) : null }),
    kpi('Compras de insumos', F.moneda(r.costoInsumos), { tono: 'mal', detalle: `${F.porcentaje(F.participacion(r.costoInsumos, r.totalIngresos))} de los ingresos`, mejorSiSube: false }),
    kpi('Comisiones de lavadores', F.moneda(r.totalComisionesLavadores), { tono: 'mal', detalle: `${F.porcentaje(F.participacion(r.totalComisionesLavadores, r.totalIngresos))} de los ingresos (netas de descuentos)` }),
    kpi('Gastos operativos', F.moneda(r.totalGastos), { tono: 'mal', detalle: `${F.porcentaje(F.participacion(r.totalGastos, r.totalIngresos))} de los ingresos` }),
    kpi('Descuentos del negocio', F.moneda(r.totalDescuentoNegocio), { tono: 'aviso', detalle: 'Ya restados de los ingresos' }),
    kpi('Descuentos a lavadores', F.moneda(r.totalDescuentoTrabajador), { tono: 'aviso', detalle: 'Ya restados de sus comisiones' }),
    kpi('Propinas', F.moneda(r.totalPropinas), { tono: 'ok', detalle: '100% de los lavadores, no son ingreso' }),
    kpi('Servicios cancelados', F.entero(r.serviciosCancelados.total), { tono: r.serviciosCancelados.total > 0 ? 'aviso' : undefined, detalle: `${r.serviciosCancelados.turnos} turnos y ${r.serviciosCancelados.ordenes} órdenes ($0)` })
  );

  // --- Hallazgos
  if (sinVentas) {
    doc.hallazgos.push('No hay servicios cobrados en este período, por eso los gráficos están vacíos.');
  } else {
    doc.hallazgos.push(`Se cobraron ${F.entero(r.serviciosAtendidos)} servicios por ${F.moneda(r.totalIngresos)}, con un ticket promedio de ${F.moneda(r.ticketPromedio)}.`);
  }
  if (previo && previo.totalIngresos > 0) {
    const vi = v(r.totalIngresos, previo.totalIngresos);
    doc.hallazgos.push(`Los ingresos ${textoVariacion(vi)} frente al período anterior (de ${F.moneda(previo.totalIngresos)} a ${F.moneda(r.totalIngresos)}).`);
  }
  const pico = maximo(r.serieIngresos.ingresos);
  if (pico && r.serieIngresos.ingresos.filter(x => x > 0).length > 1) {
    doc.hallazgos.push(`${frasePico(r.serieIngresos.gran, r.serieIngresos.etiquetas[pico.indice])} con ${F.moneda(pico.valor)} (${F.entero(r.serieIngresos.servicios[pico.indice])} servicios).`);
  }
  const servicios = Object.entries(r.serviciosStats).sort((a, b) => b[1].total - a[1].total);
  if (servicios.length) {
    const [nombre, st] = servicios[0];
    doc.hallazgos.push(`El servicio que más dinero dejó fue "${nombre}" (${F.entero(st.count)} veces, ${F.moneda(st.total)}, ${F.porcentaje(F.participacion(st.total, r.totalIngresos))} de los ingresos).`);
  }
  const vehiculos = Object.entries(r.porTipoVehiculo).sort((a, b) => b[1].ingresos - a[1].ingresos);
  if (vehiculos.length > 1) {
    const [tipo, st] = vehiculos[0];
    doc.hallazgos.push(`${F.capitalizar(tipo)} es el vehículo que más ingresos aporta: ${F.porcentaje(F.participacion(st.ingresos, r.totalIngresos))} del total (${F.entero(st.servicios)} servicios).`);
  }
  const lavadores = Object.entries(r.lavadoresStats).sort((a, b) => b[1].servicios - a[1].servicios);
  if (lavadores.length) {
    doc.hallazgos.push(`${lavadores[0][0]} fue quien más servicios atendió (${F.entero(lavadores[0][1].servicios)}), con ${F.moneda(lavadores[0][1].comision)} de comisión.`);
  }
  if (r.totalIngresos > 0) {
    const pc = F.participacion;
    doc.hallazgos.push(r.gananciaNeta >= 0
      ? `De cada $100 que entran: $${F.decimal(pc(r.totalComisionesLavadores, r.totalIngresos), 0)} van a comisiones, $${F.decimal(pc(r.costoInsumos, r.totalIngresos), 0)} a insumos, $${F.decimal(pc(r.totalGastos, r.totalIngresos), 0)} a gastos y $${F.decimal(pc(r.gananciaNeta, r.totalIngresos), 0)} quedan de ganancia.`
      : `Los costos (${F.moneda(totalCostos)}) superan los ingresos: el período cierra con una pérdida de ${F.moneda(Math.abs(r.gananciaNeta))}.`);
  } else if (totalCostos > 0) {
    doc.hallazgos.push(`Hubo ${F.moneda(totalCostos)} en costos y gastos sin ingresos que los respalden en este período.`);
  }
  if (r.totalDescuentoNegocio > 0) doc.hallazgos.push(`El negocio absorbió ${F.moneda(r.totalDescuentoNegocio)} en descuentos a clientes.`);
  if (r.serviciosCancelados.total > 0) doc.hallazgos.push(`Se cancelaron ${r.serviciosCancelados.total} servicios (no suman ingresos). Revisa el reporte Operativo para ver el detalle.`);
  if (r.alertasStockCount > 0) doc.hallazgos.push(`Hay ${r.alertasStockCount} insumos en bajo stock; revisa el reporte de Inventario.`);

  // --- Secciones
  doc.secciones.push({
    tipo: 'formula', titulo: '¿Cómo se calcula la ganancia?',
    explicacion: 'Se parte de lo cobrado y se restan los tres costos del negocio. Las propinas y los descuentos a lavadores no alteran esta cuenta.',
    pasos: [
      { etiqueta: 'Ingresos', valor: F.moneda(r.totalIngresos), tono: 'ok' },
      { operador: '−', etiqueta: 'Insumos', valor: F.moneda(r.costoInsumos), tono: 'mal' },
      { operador: '−', etiqueta: 'Comisiones', valor: F.moneda(r.totalComisionesLavadores), tono: 'mal' },
      { operador: '−', etiqueta: 'Gastos', valor: F.moneda(r.totalGastos), tono: 'mal' },
      { operador: '=', etiqueta: 'Ganancia neta', valor: F.moneda(r.gananciaNeta), tono: r.gananciaNeta >= 0 ? 'destacado' : 'mal', detalle: `Margen ${F.porcentaje(r.margenPorcentaje)}` }
    ]
  });

  const granTexto = GRAN_TEXTO[r.serieIngresos.gran];
  doc.secciones.push(serie(
    `Evolución de los ingresos por ${granTexto}`,
    `Cada columna es el dinero cobrado en ese ${granTexto}. Sirve para identificar qué momentos son los más fuertes y cuáles los más flojos.`,
    r.serieIngresos.gran, r.serieIngresos.etiquetas,
    [{ nombre: 'Ingresos', valores: r.serieIngresos.ingresos, color: PALETA[0] }]
  ));

  const itemsReparto = [
    { etiqueta: 'Comisiones lavadores', valor: r.totalComisionesLavadores, texto: F.moneda(r.totalComisionesLavadores) },
    { etiqueta: 'Compras de insumos', valor: r.costoInsumos, texto: F.moneda(r.costoInsumos) },
    { etiqueta: 'Gastos operativos', valor: r.totalGastos, texto: F.moneda(r.totalGastos) }
  ];
  if (r.gananciaNeta > 0) itemsReparto.push({ etiqueta: 'Ganancia neta', valor: r.gananciaNeta, texto: F.moneda(r.gananciaNeta), color: '#10b981' });
  doc.secciones.push(dona(
    '¿A dónde se va cada peso que entra?',
    r.gananciaNeta >= 0
      ? 'Reparte los ingresos entre los costos y lo que finalmente queda como ganancia.'
      : 'Muestra el peso de cada costo. No hay ganancia que repartir porque los costos superaron a los ingresos.',
    itemsReparto
  ));

  const filasServicios = Object.entries(r.serviciosStats).sort((a, b) => b[1].total - a[1].total).map(([nombre, st]) => [
    nombre, F.capitalizar(st.tipoVehiculo || '-'), F.entero(st.count), F.moneda(st.total),
    F.porcentaje(F.participacion(st.total, r.totalIngresos)), F.moneda(st.count ? st.total / st.count : 0)
  ]);
  doc.secciones.push(tabla(
    'Ventas por servicio',
    'Qué servicios se vendieron, cuántas veces y cuánto aportó cada uno. "% de ingresos" indica qué tan importante es ese servicio para el negocio.',
    [col('Servicio'), col('Vehículo'), col('Cantidad', 'der'), col('Total vendido', 'der'), col('% de ingresos', 'der'), col('Promedio', 'der')],
    filasServicios,
    { totales: ['Total', '', F.entero(r.serviciosAtendidos), F.moneda(r.totalIngresos), '100%', F.moneda(r.ticketPromedio)] }
  ));

  doc.secciones.push(dona(
    'Ingresos por tipo de vehículo',
    'Qué tipo de vehículo deja más dinero. Entre paréntesis, cuántos servicios fueron.',
    vehiculos.map(([tipo, st]) => ({ etiqueta: `${F.capitalizar(tipo)} (${st.servicios})`, valor: st.ingresos, texto: F.moneda(st.ingresos) }))
  ));

  doc.secciones.push(dona(
    'Ingresos por método de pago',
    'Cómo pagan los clientes. Útil para saber cuánto efectivo debe haber en caja y cuánto entra por banco o tarjeta.',
    Object.entries(r.porMetodoPago).sort((a, b) => b[1].total - a[1].total).map(([m, st]) => ({ etiqueta: `${F.etiquetaMetodo(m)} (${st.cantidad})`, valor: st.total, texto: F.moneda(st.total) }))
  ));

  const filasLav = Object.entries(r.lavadoresStats).sort((a, b) => b[1].comision - a[1].comision);
  const totServLav = filasLav.reduce((s, [, st]) => s + st.servicios, 0);
  doc.secciones.push(tabla(
    'Productividad por lavador',
    'Cuántos servicios atendió cada lavador y cuánto ganó. La comisión ya descuenta la parte que el lavador asumió en descuentos; la propina es 100% suya.',
    [col('Lavador'), col('Servicios', 'der'), col('% de servicios', 'der'), col('Comisión neta', 'der'), col('Propinas', 'der'), col('Total para el lavador', 'der')],
    filasLav.map(([nombre, st]) => [nombre, F.entero(st.servicios), F.porcentaje(F.participacion(st.servicios, totServLav)), F.moneda(st.comision), F.moneda(st.propinas), F.moneda(st.comision + st.propinas)]),
    {
      totales: ['Total', F.entero(totServLav), '100%', F.moneda(filasLav.reduce((s, [, st]) => s + st.comision, 0)), F.moneda(filasLav.reduce((s, [, st]) => s + st.propinas, 0)), F.moneda(filasLav.reduce((s, [, st]) => s + st.comision + st.propinas, 0))],
      nota: 'Si una orden la atienden varios lavadores, el servicio cuenta para cada uno.'
    }
  ));

  doc.secciones.push(tabla(
    'Gastos operativos del período',
    'Gastos del lavadero que no son insumos ni comisiones (servicios públicos, arriendo, etc.). Se restan de la ganancia.',
    [col('Fecha'), col('Concepto'), col('Registrado por'), col('Monto', 'der')],
    r.gastosDetalle.map(g => [F.fecha(g.fecha), g.concepto, g.registradoPor, F.moneda(g.monto)]),
    { totales: ['Total', '', '', F.moneda(r.totalGastos)], vacio: 'No se registraron gastos operativos en el período.', accion: { texto: '+ Registrar Gasto', fn: 'abrirModalNuevoGasto' } }
  ));

  doc.secciones.push(tabla(
    'Registro de auditoría reciente',
    'Últimas acciones sensibles hechas en el sistema (quién hizo qué). Sirve para control y seguridad.',
    [col('Fecha y hora'), col('Acción'), col('Detalle')],
    (r.auditoriaReciente || []).map(a => [String(a.fecha).substring(0, 16), String(a.accion || '').toUpperCase(), a.detalle || '']),
    { vacio: 'Sin movimientos recientes.' }
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// VENTAS
// ---------------------------------------------------------------------------
function textoFiltrosVentas(f) {
  const partes = [];
  if (f && f.cliente) partes.push(`cliente ${f.cliente}`);
  if (f && f.lavador) partes.push(`lavador ${f.lavador}`);
  if (f && f.metodo) partes.push(`pago en ${F.etiquetaMetodo(f.metodo).toLowerCase()}`);
  return partes.join(', ');
}

function vistaVentas(r, periodo) {
  const filtrado = textoFiltrosVentas(r.filtros);
  const doc = documento({
    tipo: 'ventas', titulo: filtrado ? 'Reporte de Ventas (filtrado)' : 'Reporte de Ventas', periodo,
    descripcion: (filtrado ? `Solo las ventas con: ${filtrado}. ` : '') + 'Todo lo vendido en el período: cuándo se vende más, qué servicios y vehículos dejan más dinero, cómo pagan los clientes, quién atiende y el detalle de cada venta cobrada, día por día.'
  });
  const descuentos = r.totalDescuentoNegocio + r.totalDescuentoTrabajador;

  doc.kpis.push(
    kpi('Total vendido', F.moneda(r.totalVentas), { tono: 'ok', detalle: 'Suma de lo cobrado (sin propinas)' }),
    kpi('Ventas cobradas', F.entero(r.cantidadVentas), { detalle: `${F.entero(r.clientesDistintos)} clientes registrados y ${F.entero(r.ventasAnonimas)} ventas anónimas` }),
    kpi('Ticket promedio', F.moneda(r.ticketPromedio), { detalle: 'Valor medio de cada venta' }),
    kpi('Venta más alta', r.mayorVenta ? F.moneda(r.mayorVenta.monto) : '$0', { detalle: r.mayorVenta ? `${r.mayorVenta.servicio} (orden #${r.mayorVenta.ordenId})` : 'Sin ventas' }),
    kpi('Descuentos otorgados', F.moneda(descuentos), { tono: descuentos > 0 ? 'aviso' : undefined, detalle: `Negocio ${F.moneda(r.totalDescuentoNegocio)} • Lavadores ${F.moneda(r.totalDescuentoTrabajador)}` }),
    kpi('Propinas', F.moneda(r.totalPropinas), { tono: 'ok', detalle: '100% de los lavadores, no es ingreso' })
  );

  if (filtrado) doc.hallazgos.push(`Este reporte está filtrado: solo cuenta las ventas con ${filtrado}. Quita el filtro para ver todo el negocio.`);
  if (r.cantidadVentas === 0) {
    doc.hallazgos.push('No hay ventas cobradas en este período.');
  } else {
    doc.hallazgos.push(`Se cobraron ${F.entero(r.cantidadVentas)} ventas por ${F.moneda(r.totalVentas)}; cada venta dejó en promedio ${F.moneda(r.ticketPromedio)}.`);
    const pico = maximo(r.serie.ingresos);
    if (pico && r.serie.ingresos.filter(x => x > 0).length > 1) {
      doc.hallazgos.push(`${frasePico(r.serie.gran, r.serie.etiquetas[pico.indice])} con ${F.moneda(pico.valor)}.`);
    }
    const dia = maximo(r.porDiaSemana.totales);
    const diaFlojo = minimoConActividad(r.porDiaSemana.totales);
    if (dia && diaFlojo && dia.indice !== diaFlojo.indice) {
      doc.hallazgos.push(`Por día de la semana, el que más vende es el ${r.porDiaSemana.nombresCompletos[dia.indice].toLowerCase()} (${F.moneda(dia.valor)}) y el más flojo el ${r.porDiaSemana.nombresCompletos[diaFlojo.indice].toLowerCase()} (${F.moneda(diaFlojo.valor)}).`);
    }
    const hora = maximo(r.porHora.cantidades);
    if (hora) doc.hallazgos.push(`La hora de más movimiento es a las ${r.porHora.etiquetas[hora.indice]} (${F.entero(hora.valor)} ventas en total). Conviene tener todo el personal listo a esa hora.`);
    const s = r.serviciosDetalle[0];
    if (s) doc.hallazgos.push(`El servicio estrella es "${s.servicio}" (${F.capitalizar(s.tipoVehiculo)}): ${F.entero(s.cantidad)} ventas y ${F.moneda(s.total)}, ${F.porcentaje(F.participacion(s.total, r.totalVentas))} del total.`);
    const metodos = Object.entries(r.metodosDetalle).sort((a, b) => b[1].total - a[1].total);
    if (metodos.length) doc.hallazgos.push(`${F.etiquetaMetodo(metodos[0][0])} es la forma de pago más usada: ${F.porcentaje(F.participacion(metodos[0][1].total, r.totalVentas))} de lo cobrado.`);
    if (r.topClientes[0]) doc.hallazgos.push(`El mejor cliente fue ${r.topClientes[0].nombre}: ${F.entero(r.topClientes[0].cantidad)} servicios y ${F.moneda(r.topClientes[0].total)}.`);
    if (descuentos > 0) doc.hallazgos.push(`Se dieron ${F.moneda(descuentos)} en descuentos (${F.porcentaje(F.participacion(descuentos, r.totalVentas + descuentos))} del valor de lista).`);
  }

  doc.secciones.push(serie(
    `Ventas por ${GRAN_TEXTO[r.serie.gran]}`,
    'Dinero cobrado en cada momento del período. Pasa el mouse sobre una columna para ver el valor exacto.',
    r.serie.gran, r.serie.etiquetas, [{ nombre: 'Ventas', valores: r.serie.ingresos, color: PALETA[0] }]
  ));

  doc.secciones.push(tabla(
    'Ventas día por día',
    'Lo vendido en cada día del período, con cuántas ventas fueron, cómo se pagó, los descuentos dados y las propinas recibidas. Del día más reciente al más antiguo.',
    [col('Día'), col('Ventas', 'der'), col('Total vendido', 'der'), col('Ticket promedio', 'der'), col('Efectivo', 'der'), col('Tarjeta', 'der'), col('Transferencia', 'der'), col('PSE', 'der'), col('Descuentos', 'der'), col('Propinas', 'der')],
    r.porDia.map(d => [F.fecha(d.fecha), F.entero(d.ventas), F.moneda(d.total), F.moneda(d.total / d.ventas), d.efectivo > 0 ? F.moneda(d.efectivo) : '-', d.tarjeta > 0 ? F.moneda(d.tarjeta) : '-', d.transferencia > 0 ? F.moneda(d.transferencia) : '-', d.pse > 0 ? F.moneda(d.pse) : '-', d.descuentoNegocio + d.descuentoTrabajador > 0 ? F.moneda(d.descuentoNegocio + d.descuentoTrabajador) : '-', d.propinas > 0 ? F.moneda(d.propinas) : '-']),
    {
      totales: ['Total', F.entero(r.cantidadVentas), F.moneda(r.totalVentas), F.moneda(r.ticketPromedio),
        F.moneda(r.porDia.reduce((s, d) => s + d.efectivo, 0)), F.moneda(r.porDia.reduce((s, d) => s + d.tarjeta, 0)),
        F.moneda(r.porDia.reduce((s, d) => s + d.transferencia, 0)), F.moneda(r.porDia.reduce((s, d) => s + d.pse, 0)),
        F.moneda(r.totalDescuentoNegocio + r.totalDescuentoTrabajador), F.moneda(r.porDia.reduce((s, d) => s + d.propinas, 0))],
      vacio: 'No hay ventas en el período.'
    }
  ));

  doc.secciones.push(barras(
    'Ventas por día de la semana',
    'Suma de lo vendido en cada día de la semana durante el período. Ayuda a planear turnos y promociones en los días flojos.',
    r.porDiaSemana.etiquetas.map((e, i) => ({ etiqueta: r.porDiaSemana.nombresCompletos[i], valor: r.porDiaSemana.totales[i], texto: `${F.moneda(r.porDiaSemana.totales[i])} • ${F.entero(r.porDiaSemana.cantidades[i])} ventas` })),
    { colorUnico: PALETA[1] }
  ));

  doc.secciones.push(serie(
    'Movimiento por hora del día',
    'Cantidad de ventas cobradas en cada hora, sumando todos los días del período. Muestra las horas pico.',
    'hora', r.porHora.etiquetas, [{ nombre: 'Ventas', valores: r.porHora.cantidades, color: PALETA[2] }], { formato: 'numero' }
  ));

  doc.secciones.push(tabla(
    'Ventas por servicio',
    'Cuántas veces se vendió cada servicio y cuánto dinero dejó. Cada servicio pertenece a un solo tipo de vehículo.',
    [col('Servicio'), col('Vehículo'), col('Cantidad', 'der'), col('Total vendido', 'der'), col('% del total', 'der'), col('Promedio', 'der')],
    r.serviciosDetalle.map(s => [s.servicio, F.capitalizar(s.tipoVehiculo), F.entero(s.cantidad), F.moneda(s.total), F.porcentaje(F.participacion(s.total, r.totalVentas)), F.moneda(s.total / s.cantidad)]),
    { totales: ['Total', '', F.entero(r.cantidadVentas), F.moneda(r.totalVentas), '100%', F.moneda(r.ticketPromedio)] }
  ));

  doc.secciones.push(dona(
    'Por método de pago',
    'Cómo pagaron los clientes. Entre paréntesis, la cantidad de ventas.',
    Object.entries(r.metodosDetalle).sort((a, b) => b[1].total - a[1].total).map(([m, st]) => ({ etiqueta: `${F.etiquetaMetodo(m)} (${st.cantidad})`, valor: st.total, texto: F.moneda(st.total) }))
  ));

  doc.secciones.push(dona(
    'Por tipo de vehículo',
    'Qué tipo de vehículo genera más ventas. Entre paréntesis, cuántos servicios fueron.',
    Object.entries(r.porVehiculo).sort((a, b) => b[1] - a[1]).map(([tipo, valor]) => ({ etiqueta: `${F.capitalizar(tipo)} (${r.cantidadPorVehiculo[tipo] || 0})`, valor, texto: F.moneda(valor) }))
  ));

  const totServ = r.porLavador.reduce((s, l) => s + l.servicios, 0);
  doc.secciones.push(tabla(
    'Servicios atendidos por lavador',
    'Cuántos servicios cobrados atendió cada lavador, su comisión (neta de descuentos que asumió) y las propinas que recibió.',
    [col('Lavador'), col('Servicios', 'der'), col('% de servicios', 'der'), col('Comisión bruta', 'der'), col('Descuentos asumidos', 'der'), col('Comisión neta', 'der'), col('Propinas', 'der')],
    r.porLavador.map(l => [l.nombre, F.entero(l.servicios), F.porcentaje(F.participacion(l.servicios, totServ)), F.moneda(l.comisionBruta), l.descuentos > 0 ? F.moneda(-l.descuentos) : '-', F.moneda(l.comision), F.moneda(l.propinas)]),
    { vacio: 'Ningún lavador atendió servicios cobrados en el período.' }
  ));

  doc.secciones.push(tabla(
    'Mejores clientes (Top 10)',
    'Clientes registrados que más dinero dejaron en el período. Una venta anónima no aparece aquí.',
    [col('#', 'der'), col('Cliente'), col('Servicios', 'der'), col('Total gastado', 'der'), col('Última visita')],
    r.topClientes.map((c, i) => [String(i + 1), c.nombre, F.entero(c.cantidad), F.moneda(c.total), F.fecha(c.ultima)]),
    { vacio: 'Sin clientes registrados con compras en el período.' }
  ));

  doc.secciones.push(tabla(
    'Detalle de propinas',
    'A qué servicio, cliente y lavador corresponde cada propina. Si atendieron varios lavadores, la propina se reparte en partes iguales.',
    [col('Fecha'), col('Servicio'), col('Cliente'), col('Lavador'), col('Propina', 'der')],
    r.detallePropinas.map(p => [F.fechaHora(p.fecha), `#${p.ordenId} ${p.servicio}`, p.cliente, p.lavador, F.moneda(p.valor)]),
    { totales: ['Total', '', '', '', F.moneda(r.totalPropinas)], vacio: 'Sin propinas registradas en el período.' }
  ));

  doc.secciones.push(tabla(
    'Detalle de todas las ventas',
    'Cada venta cobrada, de la más reciente a la más antigua: quién fue el cliente, qué vehículo, qué servicio, quién lo atendió, cómo pagó y si hubo descuento o propina.',
    [col('Fecha y hora'), col('Cliente'), col('Placa'), col('Orden y servicio'), col('Lavador(es)'), col('Pago'), col('Valor', 'der'), col('Desc. negocio', 'der'), col('Desc. lavador', 'der'), col('Propina', 'der'), col('Observación')],
    r.detalle.map(d => [F.fechaHora(d.fecha), d.cliente, d.placa, `#${d.ordenId} ${d.servicio}`, d.lavadores, F.etiquetaMetodo(d.metodo), F.moneda(d.monto), d.descuentoNegocio > 0 ? F.moneda(d.descuentoNegocio) : '-', d.descuentoTrabajador > 0 ? F.moneda(d.descuentoTrabajador) : '-', d.propina > 0 ? F.moneda(d.propina) : '-', d.observacion || '-']),
    { totales: ['Total (todas las ventas)', '', '', '', '', '', F.moneda(r.totalVentas), F.moneda(r.totalDescuentoNegocio), F.moneda(r.totalDescuentoTrabajador), F.moneda(r.totalPropinas), ''], totalFilas: r.detalleTotal, vacio: 'No hay ventas en el período.' }
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// COMPRAS
// ---------------------------------------------------------------------------
function vistaCompras(r, periodo) {
  const doc = documento({
    tipo: 'compras', titulo: 'Reporte de Compras de Insumos', periodo,
    descripcion: 'Dinero invertido en insumos (productos de limpieza, ceras, etc.): a qué proveedores se les compra más, qué insumos pesan más en el gasto y el detalle de cada factura de compra.'
  });
  const prov = r.proveedoresDetalle[0];
  const ins = r.insumosDetalle[0];

  doc.kpis.push(
    kpi('Total comprado', F.moneda(r.totalCompras), { tono: 'mal', detalle: 'Facturas de compra del período' }),
    kpi('Compras registradas', F.entero(r.cantidadCompras), { detalle: 'Cantidad de facturas de compra' }),
    kpi('Promedio por compra', F.moneda(r.promedioCompra), { detalle: 'Valor medio de cada factura' }),
    kpi('Proveedor principal', prov ? prov.proveedor : '-', { detalle: prov ? `${F.moneda(prov.total)} (${F.porcentaje(F.participacion(prov.total, r.totalCompras))})` : 'Sin compras' }),
    kpi('Insumo con más gasto', ins ? ins.insumo : '-', { detalle: ins ? `${F.moneda(ins.total)} (${F.porcentaje(F.participacion(ins.total, r.totalCompras))})` : 'Sin compras' })
  );

  if (r.cantidadCompras === 0) {
    doc.hallazgos.push('No se registraron compras de insumos en este período.');
  } else {
    doc.hallazgos.push(`Se invirtieron ${F.moneda(r.totalCompras)} en ${F.entero(r.cantidadCompras)} compras (promedio ${F.moneda(r.promedioCompra)} por compra).`);
    if (prov) doc.hallazgos.push(`${prov.proveedor} concentra ${F.porcentaje(F.participacion(prov.total, r.totalCompras))} del gasto en compras (${F.entero(prov.compras)} facturas).${r.proveedoresDetalle.length === 1 ? ' Es el único proveedor del período: depender de uno solo puede ser un riesgo.' : ''}`);
    if (ins) doc.hallazgos.push(`"${ins.insumo}" es el insumo que más pesa: ${F.moneda(ins.total)} (${F.porcentaje(F.participacion(ins.total, r.totalCompras))}).`);
    if (r.serie) {
      const pico = maximo(r.serie.compras);
      if (pico && r.serie.compras.filter(x => x > 0).length > 1) doc.hallazgos.push(`${frasePico(r.serie.gran, r.serie.etiquetas[pico.indice])} en compras: ${F.moneda(pico.valor)}.`);
    }
  }

  if (r.serie) {
    doc.secciones.push(serie(
      `Compras por ${GRAN_TEXTO[r.serie.gran]}`,
      'Cuánto se gastó en insumos en cada momento del período.',
      r.serie.gran, r.serie.etiquetas, [{ nombre: 'Compras', valores: r.serie.compras, color: PALETA[3] }]
    ));
  }

  doc.secciones.push(barras(
    'Compras por proveedor',
    'Cuánto dinero se le ha comprado a cada proveedor. Entre paréntesis, la cantidad de facturas.',
    r.proveedoresDetalle.slice(0, 10).map(p => ({ etiqueta: p.proveedor, valor: p.total, texto: `${F.moneda(p.total)} (${F.entero(p.compras)})` })),
    { colorUnico: PALETA[3] }
  ));
  doc.secciones.push(tabla(
    'Detalle por proveedor',
    '"% del gasto" muestra cuánto del dinero invertido en insumos se fue con cada proveedor.',
    [col('Proveedor'), col('Facturas', 'der'), col('Total comprado', 'der'), col('% del gasto', 'der'), col('Promedio por factura', 'der')],
    r.proveedoresDetalle.map(p => [p.proveedor, F.entero(p.compras), F.moneda(p.total), F.porcentaje(F.participacion(p.total, r.totalCompras)), F.moneda(p.total / p.compras)]),
    { totales: ['Total', F.entero(r.cantidadCompras), F.moneda(r.totalCompras), '100%', F.moneda(r.promedioCompra)], vacio: 'Sin compras en el período.' }
  ));
  doc.secciones.push(tabla(
    'Detalle por insumo',
    'Qué insumos se compraron, en qué cantidad y cuánto costaron en total.',
    [col('Insumo'), col('Compras', 'der'), col('Cantidad comprada', 'der'), col('Total', 'der'), col('% del gasto', 'der')],
    r.insumosDetalle.map(i => [i.insumo, F.entero(i.compras), `${F.decimal(i.cantidad, 2)} ${i.unidad}`.trim(), F.moneda(i.total), F.porcentaje(F.participacion(i.total, r.totalCompras))]),
    { totales: ['Total', F.entero(r.cantidadCompras), '', F.moneda(r.totalCompras), '100%'], vacio: 'Sin compras en el período.' }
  ));
  doc.secciones.push(tabla(
    'Detalle de facturas de compra',
    'Cada factura de compra del período con su proveedor, insumo, cantidad y valor.',
    [col('Fecha'), col('Factura'), col('Proveedor'), col('Insumo'), col('Cantidad', 'der'), col('Total', 'der')],
    r.detalle.map(d => [F.fecha(d.fecha), d.numero, d.proveedor, d.concepto, d.cantidad !== null ? `${F.decimal(d.cantidad, 2)} ${d.unidad}`.trim() : '-', F.moneda(d.total)]),
    { totales: ['Total', '', '', '', '', F.moneda(r.totalCompras)], totalFilas: r.detalleTotal, vacio: 'No hay facturas de compra en el período.' }
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// INVENTARIO
// ---------------------------------------------------------------------------
function vistaInventario(r, fechaCorte) {
  const doc = documento({
    tipo: 'inventario', titulo: 'Reporte de Inventario Valorizado',
    periodo: { etiqueta: `Corte al ${fechaCorte}`, inicio: null, fin: null },
    descripcion: 'Foto del inventario en este momento (no depende del período): cuánto dinero hay guardado en insumos, qué insumos pesan más y cuáles están por agotarse. Valor = stock actual × costo unitario.'
  });
  const top = r.insumos[0];
  const top3 = r.insumos.slice(0, 3).reduce((s, i) => s + i.valor, 0);

  doc.kpis.push(
    kpi('Valor del inventario', F.moneda(r.valorTotalInventario), { tono: 'ok', detalle: 'Stock actual × costo unitario' }),
    kpi('Insumos activos', F.entero(r.insumos.length), { detalle: 'Productos que se manejan' }),
    kpi('En bajo stock', F.entero(r.alertas.length), { tono: r.alertas.length > 0 ? 'mal' : 'ok', detalle: r.alertas.length > 0 ? 'Stock igual o menor al mínimo' : 'Todo por encima del mínimo' }),
    kpi('Insumo de mayor valor', top ? top.nombre : '-', { detalle: top ? `${F.moneda(top.valor)} (${F.porcentaje(F.participacion(top.valor, r.valorTotalInventario))})` : '' })
  );

  if (r.insumos.length === 0) {
    doc.hallazgos.push('No hay insumos activos registrados.');
  } else {
    doc.hallazgos.push(`El inventario vale ${F.moneda(r.valorTotalInventario)} repartido en ${r.insumos.length} insumos.`);
    if (r.insumos.length > 3) doc.hallazgos.push(`Los 3 insumos de mayor valor concentran ${F.porcentaje(F.participacion(top3, r.valorTotalInventario))} del inventario (${r.insumos.slice(0, 3).map(i => i.nombre).join(', ')}).`);
    doc.hallazgos.push(r.alertas.length > 0
      ? `Atención: ${r.alertas.length} insumos están en o por debajo de su stock mínimo (${r.alertas.slice(0, 5).map(i => i.nombre).join(', ')}${r.alertas.length > 5 ? '…' : ''}). Conviene reponerlos pronto.`
      : 'Todos los insumos están por encima de su stock mínimo.');
    const sinValor = r.insumos.filter(i => i.valor === 0);
    if (sinValor.length) doc.hallazgos.push(`${sinValor.length} insumos tienen valor $0 (sin stock o sin costo definido): ${sinValor.slice(0, 5).map(i => i.nombre).join(', ')}.`);
  }

  doc.secciones.push(barras(
    'Valor por insumo (los 10 mayores)',
    'Cuánto dinero hay en cada insumo. Las barras más largas son los productos donde más capital está inmovilizado.',
    r.insumos.slice(0, 10).map(i => ({ etiqueta: i.nombre, valor: i.valor, texto: F.moneda(i.valor) })),
    { colorUnico: PALETA[0] }
  ));
  doc.secciones.push(dona(
    'Estado del stock',
    'Cuántos insumos están bien surtidos y cuántos necesitan reposición.',
    [
      { etiqueta: 'Stock suficiente', valor: r.insumos.length - r.alertas.length, texto: String(r.insumos.length - r.alertas.length), color: '#10b981' },
      { etiqueta: 'Bajo stock', valor: r.alertas.length, texto: String(r.alertas.length), color: '#ef4444' }
    ]
  ));
  if (r.alertas.length > 0) {
    doc.secciones.push(tabla(
      'Insumos por reponer',
      'Insumos cuyo stock llegó al mínimo. "Faltante" es cuánto se necesita para volver al mínimo.',
      [col('Insumo'), col('Proveedor'), col('Stock actual', 'der'), col('Stock mínimo', 'der'), col('Faltante', 'der')],
      r.alertas.map(i => [i.nombre, i.proveedor, `${F.decimal(i.stock_actual, 2)} ${i.unidad_medida}`, `${F.decimal(i.stock_minimo, 2)} ${i.unidad_medida}`, `${F.decimal(Math.max(0, i.stock_minimo - i.stock_actual), 2)} ${i.unidad_medida}`])
    ));
  }
  doc.secciones.push(tabla(
    'Inventario completo',
    'Todos los insumos activos, ordenados por valor. "% del valor" indica cuánto pesa cada insumo en el total del inventario.',
    [col('Insumo'), col('Proveedor'), col('Stock', 'der'), col('Mínimo', 'der'), col('Costo unitario', 'der'), col('Valor', 'der'), col('% del valor', 'der'), col('Estado')],
    r.insumos.map(i => [i.nombre, i.proveedor, `${F.decimal(i.stock_actual, 2)} ${i.unidad_medida}`, `${F.decimal(i.stock_minimo, 2)} ${i.unidad_medida}`, F.moneda(i.costo_unitario), F.moneda(i.valor), F.porcentaje(F.participacion(i.valor, r.valorTotalInventario)), i.bajo_stock ? celda('BAJO STOCK', 'mal') : celda('OK', 'ok')]),
    { totales: ['Total', '', '', '', '', F.moneda(r.valorTotalInventario), '100%', ''], vacio: 'No hay insumos activos.' }
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// NÓMINA
// ---------------------------------------------------------------------------
function vistaNomina(r, periodo) {
  const doc = documento({
    tipo: 'nomina', titulo: 'Reporte de Nómina', periodo,
    descripcion: 'Lo que se pagó al personal en el período (salarios y comisiones), lo que todavía se le debe a los lavadores, su productividad y la asistencia. Las propinas son 100% del lavador y no cuestan al negocio.'
  });
  const totalPagado = r.salariosPagados + r.comisionesPagadas;
  const totalAsist = r.asistenciasPresentes + r.inasistencias;
  const pctAsist = totalAsist > 0 ? F.participacion(r.asistenciasPresentes, totalAsist) : null;

  doc.kpis.push(
    kpi('Nómina pagada', F.moneda(totalPagado), { tono: 'mal', detalle: 'Salarios + comisiones del período' }),
    kpi('Salarios pagados', F.moneda(r.salariosPagados), { tono: 'mal', detalle: `${F.entero(r.salariosCantidad)} pagos a empleados` }),
    kpi('Comisiones pagadas', F.moneda(r.comisionesPagadas), { tono: 'mal', detalle: `${F.entero(r.comisionesCantidad)} liquidaciones a lavadores` }),
    kpi('Por pagar a lavadores', F.moneda(r.pendienteTotalLavadores), { tono: r.pendienteTotalLavadores > 0 ? 'aviso' : 'ok', detalle: `${r.pendientePorLavador.length} lavadores con saldo (a hoy)` }),
    kpi('Propinas a lavadores', F.moneda(r.propinasPeriodo), { tono: 'ok', detalle: 'Recibidas en el período' }),
    kpi('Descuentos a lavadores', F.moneda(r.descuentosTrabajadorPeriodo), { tono: 'aviso', detalle: 'Asumidos por los lavadores' }),
    kpi('Horas trabajadas', `${F.decimal(r.horasTrabajadasTotal, 1)} hrs`, { detalle: `${F.entero(r.asistenciasPresentes)} días de asistencia` }),
    kpi('Asistencia', pctAsist === null ? '-' : F.porcentaje(pctAsist), { tono: pctAsist !== null && pctAsist < 90 ? 'aviso' : 'ok', detalle: `${F.entero(r.inasistencias)} inasistencias` })
  );

  doc.hallazgos.push(totalPagado > 0
    ? `En el período se pagaron ${F.moneda(totalPagado)} de nómina: ${F.moneda(r.salariosPagados)} en salarios y ${F.moneda(r.comisionesPagadas)} en comisiones.`
    : 'No se registraron pagos de nómina en este período.');
  if (r.pendienteTotalLavadores > 0) {
    const mayor = r.pendientePorLavador[0];
    doc.hallazgos.push(`A hoy se les debe ${F.moneda(r.pendienteTotalLavadores)} a ${r.pendientePorLavador.length} lavadores; el mayor saldo es de ${mayor.nombre} (${F.moneda(mayor.pendiente)}). Se paga desde Nómina → Liquidar Comisión.`);
  }
  if (r.liquidacionesPendientesCantidad > 0) doc.hallazgos.push(`Hay ${r.liquidacionesPendientesCantidad} liquidaciones antiguas marcadas como pendientes por ${F.moneda(r.liquidacionesPendientesTotal)}; revísalas en Nómina.`);
  if (r.productividad[0]) doc.hallazgos.push(`${r.productividad[0].nombre} generó la mayor comisión del período: ${F.moneda(r.productividad[0].comision)} en ${F.entero(r.productividad[0].servicios)} servicios.`);
  if (r.descuentosTrabajadorPeriodo > 0) doc.hallazgos.push(`Los lavadores asumieron ${F.moneda(r.descuentosTrabajadorPeriodo)} en descuentos, que se restaron de sus comisiones.`);
  if (pctAsist !== null && r.inasistencias > 0) doc.hallazgos.push(`Se registraron ${r.inasistencias} inasistencias (${F.porcentaje(100 - pctAsist)} de los días registrados).`);

  doc.secciones.push(barras(
    'Salarios pagados por empleado',
    'Cuánto se le pagó de salario a cada empleado o administrador en el período.',
    r.porEmpleado.map(e => ({ etiqueta: e.nombre, valor: e.total, texto: `${F.moneda(e.total)} (${e.cantidad} pagos)` })),
    { colorUnico: PALETA[0] }
  ));
  doc.secciones.push(barras(
    'Comisiones pagadas por lavador',
    'Cuánto se le liquidó y pagó de comisión a cada lavador en el período.',
    r.porLavador.map(l => ({ etiqueta: l.nombre, valor: l.total, texto: `${F.moneda(l.total)} (${l.cantidad} liq.)` })),
    { colorUnico: PALETA[3] }
  ));
  doc.secciones.push(tabla(
    'Lo que se debe a los lavadores hoy',
    'Saldo acumulado de cada lavador: comisiones de servicios cobrados + propinas − descuentos asumidos − lo ya liquidado. No depende del período elegido.',
    [col('Lavador'), col('Servicios históricos', 'der'), col('Saldo pendiente', 'der')],
    r.pendientePorLavador.map(l => [l.nombre, F.entero(l.servicios), F.moneda(l.pendiente)]),
    { totales: ['Total por pagar', '', F.moneda(r.pendienteTotalLavadores)], vacio: 'No se le debe nada a ningún lavador.' }
  ));
  doc.secciones.push(tabla(
    'Productividad y comisiones generadas en el período',
    'Lo que ganó cada lavador por los servicios cobrados en el período (lo haya liquidado ya o no).',
    [col('Lavador'), col('Servicios', 'der'), col('Comisión bruta', 'der'), col('Descuentos asumidos', 'der'), col('Comisión neta', 'der'), col('Propinas', 'der'), col('Total generado', 'der')],
    r.productividad.map(l => [l.nombre, F.entero(l.servicios), F.moneda(l.comisionBruta), l.descuentos > 0 ? F.moneda(-l.descuentos) : '-', F.moneda(l.comision), F.moneda(l.propinas), F.moneda(l.comision + l.propinas)]),
    {
      totales: ['Total', F.entero(r.productividad.reduce((s, l) => s + l.servicios, 0)), F.moneda(r.productividad.reduce((s, l) => s + l.comisionBruta, 0)), F.moneda(-r.productividad.reduce((s, l) => s + l.descuentos, 0)), F.moneda(r.productividad.reduce((s, l) => s + l.comision, 0)), F.moneda(r.productividad.reduce((s, l) => s + l.propinas, 0)), F.moneda(r.productividad.reduce((s, l) => s + l.comision + l.propinas, 0))],
      vacio: 'Ningún lavador atendió servicios cobrados en el período.'
    }
  ));
  doc.secciones.push(tabla(
    'Pagos de salario del período',
    'Cada pago de salario registrado: período pagado, salario calculado por horas, descuentos y neto entregado.',
    [col('Fecha de pago'), col('Empleado'), col('Rol'), col('Período pagado'), col('Salario', 'der'), col('Descuentos', 'der'), col('Neto pagado', 'der')],
    r.salariosDetalle.map(s => [F.fecha(s.fecha), s.nombre, F.capitalizar(s.rol), `${F.fecha(s.periodoInicio)} a ${F.fecha(s.periodoFin)}`, F.moneda(s.base), s.descuentos > 0 ? F.moneda(-s.descuentos) : '-', F.moneda(s.neto)]),
    { totales: ['Total', '', '', '', F.moneda(r.salariosDetalle.reduce((s, x) => s + x.base, 0)), F.moneda(-r.salariosDetalle.reduce((s, x) => s + x.descuentos, 0)), F.moneda(r.salariosPagados)], vacio: 'No se pagaron salarios en el período.' }
  ));
  doc.secciones.push(tabla(
    'Liquidaciones de comisiones',
    'Liquidaciones pagadas en el período y las que siguen pendientes (marcadas en amarillo).',
    [col('Fecha'), col('Lavador'), col('Período liquidado'), col('Comisión', 'der'), col('Descuentos', 'der'), col('Neto', 'der'), col('Estado')],
    r.liquidacionesDetalle.map(l => [F.fecha(l.fecha), l.nombre, `${F.fecha(l.periodoInicio)} a ${F.fecha(l.periodoFin)}`, F.moneda(l.comision), l.descuentos > 0 ? F.moneda(-l.descuentos) : '-', F.moneda(l.neto), l.estado === 'pagado' ? celda('PAGADA', 'ok') : celda('PENDIENTE', 'aviso')]),
    { vacio: 'No hay liquidaciones en el período.' }
  ));
  doc.secciones.push(dona(
    'Asistencia del período',
    'Proporción de días con asistencia frente a inasistencias registradas del personal.',
    [
      { etiqueta: 'Presentes', valor: r.asistenciasPresentes, texto: String(r.asistenciasPresentes), color: '#10b981' },
      { etiqueta: 'Inasistencias', valor: r.inasistencias, texto: String(r.inasistencias), color: '#ef4444' }
    ]
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// COMPARATIVO
// ---------------------------------------------------------------------------
function vistaComparativo(r, periodo) {
  const doc = documento({
    tipo: 'comparativo', titulo: 'Comparativo de Períodos', periodo,
    descripcion: `Compara el período actual (${r.actual.rango.inicio} a ${r.actual.rango.fin}) con el período anterior de igual duración (${r.anterior.rango.inicio} a ${r.anterior.rango.fin}) para ver si el negocio crece, se estanca o cae.`
  });
  const a = r.actual;
  const b = r.anterior;
  const vr = r.variaciones;

  doc.kpis.push(
    kpi('Ingresos', F.moneda(a.totalIngresos), { tono: 'ok', detalle: `Antes: ${F.moneda(b.totalIngresos)}`, variacion: vr.ingresos }),
    kpi('Ganancia neta', F.moneda(a.gananciaNeta), { tono: a.gananciaNeta >= 0 ? 'ok' : 'mal', detalle: `Antes: ${F.moneda(b.gananciaNeta)}`, variacion: vr.ganancia }),
    kpi('Servicios atendidos', F.entero(a.serviciosAtendidos), { detalle: `Antes: ${F.entero(b.serviciosAtendidos)}`, variacion: vr.servicios }),
    kpi('Ticket promedio', F.moneda(a.ticketPromedio), { detalle: `Antes: ${F.moneda(b.ticketPromedio)}`, variacion: vr.ticket })
  );

  if (b.totalIngresos === 0 && a.totalIngresos === 0) {
    doc.hallazgos.push('No hubo ingresos ni en este período ni en el anterior, así que no hay nada que comparar.');
  } else {
    if (vr.ingresos === null) doc.hallazgos.push(`El período anterior no tuvo ingresos, por eso no se puede calcular una variación. El período actual vendió ${F.moneda(a.totalIngresos)}.`);
    else doc.hallazgos.push(`Los ingresos ${textoVariacion(vr.ingresos)}: ${F.moneda(b.totalIngresos)} antes y ${F.moneda(a.totalIngresos)} ahora (${F.moneda(a.totalIngresos - b.totalIngresos)} de diferencia).`);
    if (vr.ganancia !== null) doc.hallazgos.push(`La ganancia neta ${textoVariacion(vr.ganancia)}: de ${F.moneda(b.gananciaNeta)} a ${F.moneda(a.gananciaNeta)}.`);
    if (vr.servicios !== null) doc.hallazgos.push(`Se atendieron ${F.entero(a.serviciosAtendidos)} servicios, ${a.serviciosAtendidos >= b.serviciosAtendidos ? 'frente a' : 'contra'} ${F.entero(b.serviciosAtendidos)} del período anterior.`);
    const dm = a.margenPorcentaje - b.margenPorcentaje;
    if (b.totalIngresos > 0 && a.totalIngresos > 0) doc.hallazgos.push(`El margen de rentabilidad ${dm >= 0 ? 'mejoró' : 'empeoró'} ${F.decimal(Math.abs(dm), 1)} puntos (de ${F.porcentaje(b.margenPorcentaje)} a ${F.porcentaje(a.margenPorcentaje)}).`);
    const crecioCosto = [['insumos', a.costoInsumos, b.costoInsumos], ['comisiones', a.totalComisionesLavadores, b.totalComisionesLavadores], ['gastos operativos', a.totalGastos, b.totalGastos]]
      .filter(([, x, y]) => y > 0 && x > y).sort((p, q) => (q[1] / q[2]) - (p[1] / p[2]))[0];
    if (crecioCosto) doc.hallazgos.push(`El costo que más creció fue ${crecioCosto[0]}: ${F.porcentaje(((crecioCosto[1] - crecioCosto[2]) / crecioCosto[2]) * 100)} más que antes.`);
  }

  doc.secciones.push(serie(
    `Ingresos por ${GRAN_TEXTO[r.serie.gran]}: actual vs. anterior`,
    'La línea azul es el período actual y la gris el anterior, alineados momento a momento. Donde la azul va por encima, se vendió más.',
    r.serie.gran, r.serie.etiquetas,
    [{ nombre: 'Período actual', valores: r.serie.actual, color: PALETA[0] }, { nombre: 'Período anterior', valores: r.serie.anterior, color: '#94a3b8' }],
    { estilo: 'lineas' }
  ));

  doc.secciones.push(serie(
    'Ingresos, costos y ganancia',
    'Cada grupo compara el período actual con el anterior en las cuentas principales del negocio.',
    'grupo', ['Ingresos', 'Insumos', 'Comisiones', 'Gastos', 'Ganancia'],
    [
      { nombre: 'Período actual', valores: [a.totalIngresos, a.costoInsumos, a.totalComisionesLavadores, a.totalGastos, Math.max(0, a.gananciaNeta)], color: PALETA[0] },
      { nombre: 'Período anterior', valores: [b.totalIngresos, b.costoInsumos, b.totalComisionesLavadores, b.totalGastos, Math.max(0, b.gananciaNeta)], color: '#94a3b8' }
    ]
  ));

  const fila = (nombre, act, ant, formato, mejorSiSube = true) => {
    const dif = act - ant;
    const varPct = ant > 0 ? ((act - ant) / ant) * 100 : null;
    const tono = dif === 0 ? undefined : ((dif > 0) === mejorSiSube ? 'ok' : 'mal');
    return [
      nombre, formato(act), formato(ant),
      celda(`${dif > 0 ? '+' : ''}${formato(dif)}`, tono),
      varPct === null ? '-' : celda(`${varPct > 0 ? '+' : ''}${F.porcentaje(varPct)}`, tono)
    ];
  };
  doc.secciones.push(tabla(
    'Detalle comparado',
    'Verde = el cambio favorece al negocio; rojo = lo perjudica (para los costos, subir es negativo).',
    [col('Concepto'), col('Período actual', 'der'), col('Período anterior', 'der'), col('Diferencia', 'der'), col('Variación', 'der')],
    [
      fila('Ingresos', a.totalIngresos, b.totalIngresos, F.moneda),
      fila('Compras de insumos', a.costoInsumos, b.costoInsumos, F.moneda, false),
      fila('Comisiones de lavadores', a.totalComisionesLavadores, b.totalComisionesLavadores, F.moneda, false),
      fila('Gastos operativos', a.totalGastos, b.totalGastos, F.moneda, false),
      fila('Ganancia neta', a.gananciaNeta, b.gananciaNeta, F.moneda),
      fila('Margen de rentabilidad (%)', a.margenPorcentaje, b.margenPorcentaje, (x) => F.porcentaje(x)),
      fila('Servicios atendidos', a.serviciosAtendidos, b.serviciosAtendidos, F.entero),
      fila('Ticket promedio', a.ticketPromedio, b.ticketPromedio, F.moneda),
      fila('Descuentos del negocio', a.totalDescuentoNegocio, b.totalDescuentoNegocio, F.moneda, false),
      fila('Propinas', a.totalPropinas, b.totalPropinas, F.moneda),
      fila('Servicios cancelados', a.cancelados, b.cancelados, F.entero, false)
    ]
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// OPERATIVO
// ---------------------------------------------------------------------------
const ETIQUETA_ESTADO_CITA = { agendada: 'Agendada', reprogramada: 'Reprogramada', atendida: 'Atendida', cancelada: 'Cancelada' };
const COLOR_ESTADO_CITA = { agendada: '#0077b6', reprogramada: '#f59e0b', atendida: '#10b981', cancelada: '#ef4444' };
const ETIQUETA_ESTADO_ORDEN = { recibido: 'Recibido', en_proceso: 'En proceso', terminado: 'Terminado', entregado: 'Entregado', cancelado: 'Cancelado' };
const COLOR_ESTADO_ORDEN = { recibido: '#64748b', en_proceso: '#0077b6', terminado: '#f59e0b', entregado: '#10b981', cancelado: '#ef4444' };

function vistaOperativo(r, periodo) {
  const doc = documento({
    tipo: 'operativo', titulo: 'Reporte Operativo', periodo,
    descripcion: 'Cómo se mueve el día a día: cuántos vehículos entran y a qué horas, cómo funcionan las citas, cuánto tarda un servicio, qué se cancela y si los clientes son nuevos o vuelven.'
  });
  const atendidas = r.porEstadoCitas.atendida || 0;
  const pctAtendidas = r.citasTotal > 0 ? F.participacion(atendidas, r.citasTotal) : null;
  const canceladas = r.serviciosCancelados.total;
  const totalOrdenes = Object.values(r.ordenesPorEstado).reduce((s, x) => s + x, 0);

  doc.kpis.push(
    kpi('Vehículos atendidos', F.entero(r.atencionesTotal), { detalle: 'Órdenes ingresadas (sin canceladas)' }),
    kpi('Citas del período', F.entero(r.citasTotal), { detalle: pctAtendidas === null ? 'Sin citas' : `${F.porcentaje(pctAtendidas)} se atendieron` }),
    kpi('Tiempo promedio', r.minutosPromedio === null ? '-' : `${r.minutosPromedio} min`, { detalle: 'Desde el ingreso hasta la entrega' }),
    kpi('Clientes nuevos', F.entero(r.clientesNuevos), { tono: 'ok', detalle: 'Registrados en el período' }),
    kpi('Clientes recurrentes', F.entero(r.clientesRecurrentes), { detalle: 'Ya eran clientes y volvieron' }),
    kpi('Servicios cancelados', F.entero(canceladas), { tono: canceladas > 0 ? 'mal' : 'ok', detalle: `${r.serviciosCancelados.turnos} turnos y ${r.serviciosCancelados.ordenes} órdenes ($0)` })
  );

  if (r.atencionesTotal === 0 && r.citasTotal === 0) {
    doc.hallazgos.push('No hubo movimiento (atenciones ni citas) en este período.');
  } else {
    doc.hallazgos.push(`Entraron ${F.entero(r.atencionesTotal)} vehículos y se agendaron ${F.entero(r.citasTotal)} citas.`);
    const pico = maximo(r.serie.atenciones);
    if (pico && r.serie.atenciones.filter(x => x > 0).length > 1) doc.hallazgos.push(`${frasePico(r.serie.gran, r.serie.etiquetas[pico.indice])} en movimiento: ${F.entero(pico.valor)} vehículos.`);
    const hora = maximo(r.porHora.cantidades);
    if (hora) doc.hallazgos.push(`La hora pico de llegada de vehículos es a las ${r.porHora.etiquetas[hora.indice]}.`);
    const dia = maximo(r.porDiaSemana.cantidades);
    if (dia) doc.hallazgos.push(`El día con más vehículos es el ${r.porDiaSemana.nombresCompletos[dia.indice].toLowerCase()}.`);
    if (r.minutosPromedio !== null) doc.hallazgos.push(`Un servicio tarda en promedio ${r.minutosPromedio} minutos desde que el vehículo ingresa hasta que se entrega (incluye la espera por el cobro).`);
    if (pctAtendidas !== null && pctAtendidas < 60 && r.citasTotal >= 3) doc.hallazgos.push(`Solo ${F.porcentaje(pctAtendidas)} de las citas se atendieron: revisa por qué se cancelan o no se cumplen.`);
    if (canceladas > 0 && totalOrdenes + r.serviciosCancelados.turnos > 0) doc.hallazgos.push(`Se cancelaron ${canceladas} servicios (${F.porcentaje(F.participacion(canceladas, totalOrdenes + r.serviciosCancelados.turnos))} de los ingresados).`);
    if (r.clientesNuevos + r.clientesRecurrentes > 0) doc.hallazgos.push(`${F.porcentaje(F.participacion(r.clientesRecurrentes, r.clientesNuevos + r.clientesRecurrentes))} de los clientes que compraron ya eran clientes de antes: señal de fidelidad.`);
  }

  doc.secciones.push(serie(
    `Vehículos atendidos por ${GRAN_TEXTO[r.serie.gran]}`,
    'Cantidad de órdenes ingresadas en cada momento del período.',
    r.serie.gran, r.serie.etiquetas, [{ nombre: 'Vehículos', valores: r.serie.atenciones, color: PALETA[0] }], { formato: 'numero' }
  ));
  doc.secciones.push(barras(
    'Demanda por día de la semana',
    'Vehículos que ingresaron en cada día de la semana. Sirve para decidir cuánto personal poner cada día.',
    r.porDiaSemana.etiquetas.map((e, i) => ({ etiqueta: r.porDiaSemana.nombresCompletos[i], valor: r.porDiaSemana.cantidades[i], texto: String(r.porDiaSemana.cantidades[i]) })),
    { colorUnico: PALETA[1] }
  ));
  doc.secciones.push(serie(
    'Demanda por hora del día',
    'A qué horas llegan más vehículos (suma de todos los días del período).',
    'hora', r.porHora.etiquetas, [{ nombre: 'Vehículos', valores: r.porHora.cantidades, color: PALETA[2] }], { formato: 'numero' }
  ));
  doc.secciones.push(dona(
    'Citas por estado',
    'Qué pasó con las citas agendadas: cuántas se atendieron, siguen pendientes, se reprogramaron o se cancelaron.',
    Object.entries(r.porEstadoCitas).map(([e, n]) => ({ etiqueta: ETIQUETA_ESTADO_CITA[e] || e, valor: n, texto: String(n), color: COLOR_ESTADO_CITA[e] }))
  ));
  doc.secciones.push(dona(
    'Órdenes por estado',
    'En qué estado quedaron las órdenes ingresadas en el período.',
    Object.entries(r.ordenesPorEstado).map(([e, n]) => ({ etiqueta: ETIQUETA_ESTADO_ORDEN[e] || e, valor: n, texto: String(n), color: COLOR_ESTADO_ORDEN[e] }))
  ));
  doc.secciones.push(tabla(
    'Detalle de citas',
    'Todas las citas del período con su cliente, vehículo, servicio y estado actual.',
    [col('Fecha'), col('Hora'), col('Cliente'), col('Placa'), col('Servicio'), col('Estado')],
    r.citasDetalle.map(c => [F.fecha(c.fecha), c.hora, c.cliente, c.placa, c.servicio, celda(ETIQUETA_ESTADO_CITA[c.estado] || c.estado, c.estado === 'atendida' ? 'ok' : c.estado === 'cancelada' ? 'mal' : 'aviso')]),
    { totalFilas: r.citasTotal, vacio: 'No hay citas en el período.' }
  ));
  doc.secciones.push(tabla(
    'Servicios cancelados',
    'Turnos o vehículos cancelados antes de atenderse. Valen $0 y no cuentan como ingreso, pero conviene saber por qué se cayeron.',
    [col('Fecha'), col('Hora'), col('Origen'), col('Placa'), col('Servicio'), col('Observación')],
    r.cancelacionesDetalle.map(c => [F.fecha(c.fecha), String(c.hora || '').substring(0, 5), c.origen, c.placa, c.servicio, c.observacion || '-']),
    { vacio: 'No hubo cancelaciones en el período.' }
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// ASISTENCIA
// ---------------------------------------------------------------------------
function vistaAsistencia(r, periodo) {
  const doc = documento({
    tipo: 'asistencia', titulo: 'Reporte de Asistencia', periodo,
    descripcion: 'Quién vino, cuántas horas trabajó y quién faltó. Las horas son el tiempo entre entradas y salidas menos el descanso del almuerzo, y son la base para calcular el pago por horas de los empleados.'
  });
  const totalDias = r.totalPresentes + r.totalInasistencias;
  const pct = totalDias > 0 ? F.participacion(r.totalPresentes, totalDias) : null;

  doc.kpis.push(
    kpi('Días presentes', F.entero(r.totalPresentes), { tono: 'ok', detalle: 'Registros con asistencia' }),
    kpi('Inasistencias', F.entero(r.totalInasistencias), { tono: r.totalInasistencias > 0 ? 'mal' : 'ok', detalle: 'Días marcados como falta' }),
    kpi('% de asistencia', pct === null ? '-' : F.porcentaje(pct), { tono: pct !== null && pct < 90 ? 'aviso' : 'ok', detalle: `${F.entero(totalDias)} días registrados` }),
    kpi('Horas trabajadas', `${F.decimal(r.totalHorasTrabajadas, 1)} hrs`, { detalle: 'Suma de todo el personal' }),
    kpi('Promedio por día', r.totalPresentes > 0 ? `${F.decimal(r.totalHorasTrabajadas / r.totalPresentes, 1)} hrs` : '-', { detalle: 'Horas por persona y día presente' })
  );

  if (totalDias === 0) {
    doc.hallazgos.push('No hay registros de asistencia en este período.');
  } else {
    doc.hallazgos.push(`Se registraron ${F.entero(totalDias)} días de personal: ${F.entero(r.totalPresentes)} con asistencia y ${F.entero(r.totalInasistencias)} inasistencias (${F.porcentaje(pct)} de asistencia).`);
    const masHoras = [...r.porTrabajador].sort((a, b) => b.horasTrabajadas - a.horasTrabajadas)[0];
    if (masHoras && masHoras.horasTrabajadas > 0) doc.hallazgos.push(`${masHoras.nombre} es quien más horas acumuló: ${F.decimal(masHoras.horasTrabajadas, 1)} hrs en ${masHoras.presentes} días.`);
    const faltones = r.porTrabajador.filter(t => t.inasistencias > 0).sort((a, b) => b.inasistencias - a.inasistencias);
    if (faltones.length) doc.hallazgos.push(`Con inasistencias: ${faltones.slice(0, 5).map(t => `${t.nombre} (${t.inasistencias})`).join(', ')}.`);
    else doc.hallazgos.push('Nadie faltó en el período.');
  }

  doc.secciones.push(dona(
    'Asistencia vs. inasistencias',
    'Proporción de días con asistencia frente a faltas.',
    [
      { etiqueta: 'Presentes', valor: r.totalPresentes, texto: String(r.totalPresentes), color: '#10b981' },
      { etiqueta: 'Inasistencias', valor: r.totalInasistencias, texto: String(r.totalInasistencias), color: '#ef4444' }
    ]
  ));
  doc.secciones.push(barras(
    'Horas trabajadas por persona',
    'Total de horas acumuladas por cada trabajador en el período.',
    [...r.porTrabajador].sort((a, b) => b.horasTrabajadas - a.horasTrabajadas).slice(0, 15).map(t => ({ etiqueta: t.nombre, valor: t.horasTrabajadas, texto: `${F.decimal(t.horasTrabajadas, 1)} hrs` })),
    { colorUnico: PALETA[0] }
  ));
  doc.secciones.push(tabla(
    'Resumen por trabajador',
    '"% asistencia" es la proporción de días en que el trabajador vino frente a los días registrados.',
    [col('Trabajador'), col('Rol'), col('Presentes', 'der'), col('Inasistencias', 'der'), col('% asistencia', 'der'), col('Horas trabajadas', 'der'), col('Promedio por día', 'der')],
    r.porTrabajador.map(t => {
      const dias = t.presentes + t.inasistencias;
      const p = dias > 0 ? F.participacion(t.presentes, dias) : 0;
      return [t.nombre, F.capitalizar(t.rol), F.entero(t.presentes), t.inasistencias > 0 ? celda(String(t.inasistencias), 'mal') : '0', celda(F.porcentaje(p), p >= 90 ? 'ok' : p >= 70 ? 'aviso' : 'mal'), `${F.decimal(t.horasTrabajadas, 1)} hrs`, t.presentes > 0 ? `${F.decimal(t.horasTrabajadas / t.presentes, 1)} hrs` : '-'];
    }),
    { totales: ['Total', '', F.entero(r.totalPresentes), F.entero(r.totalInasistencias), pct === null ? '-' : F.porcentaje(pct), `${F.decimal(r.totalHorasTrabajadas, 1)} hrs`, r.totalPresentes > 0 ? `${F.decimal(r.totalHorasTrabajadas / r.totalPresentes, 1)} hrs` : '-'], vacio: 'Sin registros de asistencia en el período.' }
  ));
  doc.secciones.push(tabla(
    'Detalle día a día',
    'Cada registro de asistencia con sus entradas y salidas, el descanso descontado y las horas netas.',
    [col('Fecha'), col('Trabajador'), col('Entradas y salidas'), col('Descanso', 'der'), col('Horas', 'der'), col('Estado')],
    r.detalle.slice(0, 500).map(d => [F.fecha(d.fecha), d.nombre, d.sesiones || `${d.horaEntrada || '-'} a ${d.horaSalida || '-'}`, d.horasDescanso > 0 ? `${d.horasDescanso} hrs` : '-', F.decimal(d.horasTrabajadas, 2), d.inasistencia ? celda('INASISTENCIA', 'mal') : celda('PRESENTE', 'ok')]),
    { totalFilas: r.detalle.length, vacio: 'Sin registros de asistencia en el período.' }
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------------
const ETIQUETA_ESTADO_CLIENTE = { activo: 'VIENE SEGUIDO', inactivo: 'SIN VISITAS RECIENTES', nunca_compro: 'NUNCA HA COMPRADO' };
const TONO_ESTADO_CLIENTE = { activo: 'ok', inactivo: 'mal', nunca_compro: 'aviso' };

function vistaClientes(r, fechaCorte) {
  const doc = documento({
    tipo: 'clientes', titulo: 'Reporte de Clientes',
    periodo: { etiqueta: `Corte al ${fechaCorte}`, inicio: null, fin: null },
    descripcion: `Foto de la cartera de clientes (no depende del período): quiénes siguen viniendo, quiénes dejaron de venir y quiénes aportan más. Un cliente aparece "sin visitas recientes" si no ha comprado en más de ${r.diasInactividad} días; eso es distinto de un cliente desactivado a mano en la pestaña Clientes.`
  });
  const conCompras = r.clientes.filter(c => c.totalCompras > 0);
  const totalGastado = r.clientes.reduce((s, c) => s + c.totalGastado, 0);
  const totalCompras = r.clientes.reduce((s, c) => s + c.totalCompras, 0);
  const ranking = [...conCompras].sort((a, b) => b.totalGastado - a.totalGastado);
  const inactivos = r.clientes.filter(c => c.estado === 'inactivo' && !c.desactivado).sort((a, b) => b.totalGastado - a.totalGastado);

  doc.kpis.push(
    kpi('Total de clientes', F.entero(r.totalClientes), { detalle: 'Registrados en el sistema' }),
    kpi('Vienen seguido', F.entero(r.activos), { tono: 'ok', detalle: `${F.porcentaje(F.participacion(r.activos, r.totalClientes))} de la cartera (compraron en los últimos ${r.diasInactividad} días)` }),
    kpi('Sin visitas recientes', F.entero(r.inactivos), { tono: r.inactivos > 0 ? 'mal' : 'ok', detalle: `Más de ${r.diasInactividad} días sin comprar` }),
    kpi('Nunca han comprado', F.entero(r.nuncaCompraron), { tono: r.nuncaCompraron > 0 ? 'aviso' : undefined, detalle: 'Registrados sin ninguna compra' }),
    kpi('Desactivados', F.entero(r.desactivados), { detalle: 'Inactivados a mano; ya no se les agenda ni atiende' }),
    kpi('En lista negra', F.entero(r.enListaNegra), { tono: r.enListaNegra > 0 ? 'mal' : undefined, detalle: 'Con observaciones de riesgo' }),
    kpi('Gasto promedio por cliente', conCompras.length ? F.moneda(totalGastado / conCompras.length) : '-', { detalle: 'Entre clientes con compras' })
  );

  if (r.totalClientes === 0) {
    doc.hallazgos.push('Aún no hay clientes registrados.');
  } else {
    doc.hallazgos.push(`De ${F.entero(r.totalClientes)} clientes, ${F.entero(r.activos)} vienen seguido (${F.porcentaje(F.participacion(r.activos, r.totalClientes))}), ${F.entero(r.inactivos)} llevan tiempo sin venir y ${F.entero(r.nuncaCompraron)} nunca han comprado.`);
    if (ranking[0]) doc.hallazgos.push(`El mejor cliente histórico es ${ranking[0].nombre}: ${F.entero(ranking[0].totalCompras)} servicios y ${F.moneda(ranking[0].totalGastado)}.`);
    if (ranking.length >= 5 && totalGastado > 0) {
      const top5 = ranking.slice(0, 5).reduce((s, c) => s + c.totalGastado, 0);
      doc.hallazgos.push(`Los 5 mejores clientes aportan ${F.porcentaje(F.participacion(top5, totalGastado))} de todo lo vendido a clientes registrados.`);
    }
    if (inactivos.length) doc.hallazgos.push(`${F.entero(inactivos.length)} clientes dejaron de venir. Llamarlos con una promoción puede recuperar ventas (ver la lista "Clientes por recuperar").`);
    if (r.enListaNegra > 0) doc.hallazgos.push(`${r.enListaNegra} clientes están en la lista negra; revisa sus observaciones antes de atenderlos a crédito o sin pago anticipado.`);
  }

  doc.secciones.push(dona(
    'Estado de la cartera',
    'Cuántos clientes siguen viniendo, cuántos llevan tiempo sin venir y cuántos nunca compraron.',
    [
      { etiqueta: 'Vienen seguido', valor: r.activos, texto: String(r.activos), color: '#10b981' },
      { etiqueta: 'Sin visitas recientes', valor: r.inactivos, texto: String(r.inactivos), color: '#ef4444' },
      { etiqueta: 'Nunca han comprado', valor: r.nuncaCompraron, texto: String(r.nuncaCompraron), color: '#f59e0b' }
    ]
  ));
  doc.secciones.push(barras(
    'Mejores clientes por dinero gastado (Top 10)',
    'Los clientes que más han gastado en toda su historia.',
    ranking.slice(0, 10).map(c => ({ etiqueta: c.nombre, valor: c.totalGastado, texto: `${F.moneda(c.totalGastado)} (${c.totalCompras})` })),
    { colorUnico: PALETA[2] }
  ));
  if (inactivos.length > 0) {
    doc.secciones.push(tabla(
      'Clientes por recuperar',
      'Clientes que llevan tiempo sin venir y más gastaron: son los más valiosos para contactar con una oferta.',
      [col('Cliente'), col('Teléfono'), col('Última compra'), col('Servicios', 'der'), col('Total gastado', 'der')],
      inactivos.slice(0, 20).map(c => [c.nombre, c.telefono || '-', c.ultimaCompra || 'Nunca', F.entero(c.totalCompras), F.moneda(c.totalGastado)])
    ));
  }
  doc.secciones.push(tabla(
    'Todos los clientes',
    'Cartera completa, de la compra más reciente a la más antigua.',
    [col('Cliente'), col('Teléfono'), col('Vehículos', 'der'), col('Última compra'), col('Servicios', 'der'), col('Total gastado', 'der'), col('Promedio', 'der'), col('Estado')],
    r.clientes.slice(0, 500).map(c => [
      c.desactivado ? celda(`${c.nombre} (desactivado)`, 'aviso') : (c.enListaNegra ? celda(`${c.nombre} (lista negra)`, 'mal') : c.nombre), c.telefono || '-', F.entero(c.vehiculos), c.ultimaCompra || 'Nunca',
      F.entero(c.totalCompras), F.moneda(c.totalGastado), c.totalCompras > 0 ? F.moneda(c.totalGastado / c.totalCompras) : '-',
      celda(ETIQUETA_ESTADO_CLIENTE[c.estado] || c.estado, TONO_ESTADO_CLIENTE[c.estado])
    ]),
    { totales: ['Total', '', '', '', F.entero(totalCompras), F.moneda(totalGastado), '', ''], totalFilas: r.clientes.length, vacio: 'Sin clientes registrados.' }
  ));

  return doc;
}

module.exports = {
  vistaResumen, vistaVentas, vistaCompras, vistaInventario, vistaNomina,
  vistaComparativo, vistaOperativo, vistaAsistencia, vistaClientes,
  helpers: { documento, kpi, col, celda, tabla, serie, barras, dona, texto, maximo, frasePico, PALETA, GRAN_TEXTO }
};
