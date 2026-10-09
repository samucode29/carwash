/**
 * Documentos de los reportes "de una sola persona": el historial completo de
 * un cliente y el trabajo (con sus ingresos) de un lavador. Usan los mismos
 * bloques que el resto de reportes, así se ven igual en pantalla y en PDF.
 */
const F = require('./formatos');
const { helpers } = require('./vistasReporte');
const { documento, kpi, col, celda, tabla, serie, barras, dona, texto, maximo, frasePico, PALETA, GRAN_TEXTO } = helpers;

const ESTADO_ORDEN = { recibido: 'En espera', en_proceso: 'En proceso', terminado: 'Terminado sin cobrar', entregado: 'Entregado', cancelado: 'Cancelado' };
const ESTADO_CITA = { agendada: 'Agendada', reprogramada: 'Reprogramada', cancelada: 'Cancelada', atendida: 'Atendida' };

const guion = (valor, formato = F.moneda) => (Number(valor) > 0 ? formato(valor) : '-');

// ---------------------------------------------------------------------------
// CLIENTE
// ---------------------------------------------------------------------------
function vistaCliente(r, periodo) {
  const c = r.cliente;
  const doc = documento({
    tipo: 'cliente', titulo: `Reporte del cliente: ${c.nombre}`, periodo,
    descripcion: 'Todo lo que este cliente compró en el período: cada venta con su fecha, vehículo, servicio, quién lo atendió, cómo pagó y qué descuentos o propinas hubo; además sus citas, lo que quedó sin cobrar y su historial total.'
  });
  const descuentos = r.descuentoNegocio + r.descuentoTrabajador;

  doc.kpis.push(
    kpi('Total comprado', F.moneda(r.total), { tono: 'ok', detalle: `En el período (${F.entero(r.cantidad)} servicios cobrados)` }),
    kpi('Ticket promedio', F.moneda(r.ticketPromedio), { detalle: 'Lo que deja en cada visita' }),
    kpi('Descuentos recibidos', F.moneda(descuentos), { tono: descuentos > 0 ? 'aviso' : undefined, detalle: `Negocio ${F.moneda(r.descuentoNegocio)} • Lavador ${F.moneda(r.descuentoTrabajador)}` }),
    kpi('Propinas dadas', F.moneda(r.propinas), { detalle: 'Van 100% a los lavadores' }),
    kpi('Total histórico', F.moneda(r.historico.total), { detalle: `${F.entero(r.historico.ventas)} servicios desde ${F.fecha(r.historico.primera)}` }),
    kpi('Última visita', F.fecha(r.historico.ultima), { detalle: r.historico.ultima ? 'Último servicio cobrado' : 'Nunca ha comprado' })
  );

  const ficha = [
    `Nombre: ${c.nombre}`, `Teléfono: ${c.telefono || '-'}`, `Correo: ${c.correo || '-'}`,
    `Estado: ${c.estado === 'activo' ? 'Activo' : 'Inactivo (no se le crean citas ni servicios nuevos)'}`,
    `Cliente desde: ${F.fecha(c.desde)}`,
    `Vehículos: ${r.vehiculos.length ? r.vehiculos.map(v => `${v.placa || 'sin placa'} (${F.capitalizar(v.tipo)}${v.marca ? `, ${v.marca}` : ''}${v.color ? `, ${v.color}` : ''})`).join('; ') : 'ninguno registrado'}`
  ];
  doc.secciones.push(texto('Datos del cliente', ficha.join('\n')));

  if (r.cantidad === 0) {
    doc.hallazgos.push('Este cliente no tiene ventas cobradas en el período elegido. Prueba con un rango más amplio (mes o año).');
  } else {
    doc.hallazgos.push(`En el período compró ${F.entero(r.cantidad)} servicios por ${F.moneda(r.total)}; en promedio ${F.moneda(r.ticketPromedio)} por visita.`);
    const s = r.serviciosDetalle[0];
    if (s) doc.hallazgos.push(`Su servicio preferido es "${s.servicio}" (${F.capitalizar(s.tipoVehiculo)}): lo pidió ${F.entero(s.cantidad)} ${s.cantidad === 1 ? 'vez' : 'veces'} y dejó ${F.moneda(s.total)}.`);
    const l = r.porLavador[0];
    if (l) doc.hallazgos.push(`Quien más lo ha atendido es ${l.nombre}: ${F.entero(l.servicios)} ${l.servicios === 1 ? 'servicio' : 'servicios'}.`);
    const metodos = Object.entries(r.metodosDetalle).sort((a, b) => b[1].total - a[1].total);
    if (metodos.length) doc.hallazgos.push(`Paga sobre todo con ${F.etiquetaMetodo(metodos[0][0]).toLowerCase()} (${F.porcentaje(F.participacion(metodos[0][1].total, r.total))} de lo que compra).`);
    if (descuentos > 0) doc.hallazgos.push(`Recibió ${F.moneda(descuentos)} en descuentos (${F.porcentaje(F.participacion(descuentos, r.valorLista))} del valor de lista de sus servicios).`);
  }
  if (r.noCobrados.length > 0) doc.hallazgos.push(`Tiene ${F.entero(r.noCobrados.length)} servicio(s) en el período que no terminaron en una venta cobrada (cancelados o aún abiertos). Míralos en la tabla correspondiente.`);
  r.notas.filter(n => n.tipo === 'lista_negra').slice(0, 3).forEach(n => doc.hallazgos.push(`Lista negra: ${n.texto} (${F.fecha(n.creado_en)}).`));

  doc.secciones.push(serie(
    `Compras por ${GRAN_TEXTO[r.serie.gran]}`,
    'Dinero que dejó el cliente en cada momento del período.',
    r.serie.gran, r.serie.etiquetas, [{ nombre: 'Compras', valores: r.serie.ingresos, color: PALETA[0] }]
  ));

  doc.secciones.push(tabla(
    'Compras día por día',
    'Lo que compró cada día: cuántos servicios, cuánto pagó, cómo pagó, descuentos y propinas.',
    [col('Día'), col('Servicios', 'der'), col('Total pagado', 'der'), col('Efectivo', 'der'), col('Tarjeta', 'der'), col('Transferencia', 'der'), col('PSE', 'der'), col('Descuentos', 'der'), col('Propinas', 'der')],
    r.porDia.map(d => [F.fecha(d.fecha), F.entero(d.ventas), F.moneda(d.total), guion(d.efectivo), guion(d.tarjeta), guion(d.transferencia), guion(d.pse), guion(d.descuentoNegocio + d.descuentoTrabajador), guion(d.propinas)]),
    { totales: ['Total', F.entero(r.cantidad), F.moneda(r.total), '', '', '', '', F.moneda(descuentos), F.moneda(r.propinas)], vacio: 'Sin compras en el período.' }
  ));

  doc.secciones.push(tabla(
    'Servicios que ha comprado',
    'Qué servicios pide este cliente, cuántas veces y cuánto ha dejado en cada uno.',
    [col('Servicio'), col('Vehículo'), col('Veces', 'der'), col('Total pagado', 'der'), col('% del total', 'der')],
    r.serviciosDetalle.map(s => [s.servicio, F.capitalizar(s.tipoVehiculo), F.entero(s.cantidad), F.moneda(s.total), F.porcentaje(F.participacion(s.total, r.total))]),
    { vacio: 'Sin servicios en el período.' }
  ));

  doc.secciones.push(tabla(
    'Por vehículo',
    'Qué vehículos del cliente se lavaron, cuántas veces y cuánto se cobró por cada uno.',
    [col('Placa'), col('Tipo'), col('Servicios', 'der'), col('Total pagado', 'der')],
    r.vehiculosDetalle.map(v => [v.placa, F.capitalizar(v.tipoVehiculo), F.entero(v.cantidad), F.moneda(v.total)]),
    { vacio: 'Sin vehículos atendidos en el período.' }
  ));

  doc.secciones.push(dona(
    'Cómo paga',
    'Métodos de pago que usa este cliente. Entre paréntesis, la cantidad de pagos.',
    Object.entries(r.metodosDetalle).sort((a, b) => b[1].total - a[1].total).map(([m, st]) => ({ etiqueta: `${F.etiquetaMetodo(m)} (${st.cantidad})`, valor: st.total, texto: F.moneda(st.total) }))
  ));

  doc.secciones.push(tabla(
    'Lavadores que lo han atendido',
    'Quién le hizo los servicios en el período y cuándo fue la última vez. Si un servicio lo hicieron varios, cuenta para cada uno.',
    [col('Lavador'), col('Servicios', 'der'), col('Valor de esos servicios', 'der'), col('Último servicio')],
    r.porLavador.map(l => [l.nombre, F.entero(l.servicios), F.moneda(l.total), F.fechaHora(l.ultima)]),
    { vacio: 'Ningún lavador atendió servicios cobrados en el período.' }
  ));

  doc.secciones.push(tabla(
    'Citas del cliente',
    'Citas agendadas en el período y qué pasó con cada una.',
    [col('Fecha'), col('Hora'), col('Servicio'), col('Placa'), col('Estado')],
    r.citas.map(x => [F.fecha(x.fecha), String(x.hora).substring(0, 5), x.servicio_nombre || '-', x.placa || '-', celda(ESTADO_CITA[x.estado] || x.estado, x.estado === 'cancelada' ? 'mal' : x.estado === 'atendida' ? 'ok' : 'aviso')]),
    { vacio: 'Sin citas en el período.' }
  ));

  if (r.noCobrados.length > 0) {
    doc.secciones.push(tabla(
      'Servicios cancelados o sin cobrar',
      'Servicios de este cliente que no terminaron en una venta cobrada.',
      [col('Fecha y hora'), col('Orden y servicio'), col('Placa'), col('Lavador(es)'), col('Valor', 'der'), col('Estado')],
      r.noCobrados.map(o => [F.fechaHora(o.fecha), `#${o.ordenId} ${o.servicio}`, o.placa, o.lavadores, F.moneda(o.total), celda(ESTADO_ORDEN[o.estado] || o.estado, o.estado === 'cancelado' ? 'mal' : 'aviso')])
    ));
  }

  if (r.notas.length > 0) {
    doc.secciones.push(tabla(
      'Notas del cliente',
      'Observaciones guardadas: incidentes (lista negra) y preferencias de cómo le gusta el servicio.',
      [col('Fecha'), col('Tipo'), col('Nota')],
      r.notas.map(n => [F.fecha(n.creado_en), celda(n.tipo === 'lista_negra' ? 'Lista negra' : 'Preferencia', n.tipo === 'lista_negra' ? 'mal' : undefined), n.texto])
    ));
  }

  // La columna de observaciones solo se muestra si alguna venta la trae (así la tabla no se aprieta).
  const hayObservaciones = r.detalle.some(d => d.observacion);
  doc.secciones.push(tabla(
    'Detalle de todas sus compras',
    'Cada venta cobrada a este cliente, de la más reciente a la más antigua, con su número de factura.',
    [col('Fecha y hora'), col('Factura'), col('Placa'), col('Orden y servicio'), col('Lavador(es)'), col('Pago'), col('Valor de lista', 'der'), col('Pagó', 'der'), col('Desc. negocio', 'der'), col('Desc. lavador', 'der'), col('Propina', 'der'), ...(hayObservaciones ? [col('Observación')] : [])],
    r.detalle.map(d => [F.fechaHora(d.fecha), d.factura, d.placa, `#${d.ordenId} ${d.servicio}`, d.lavadores, F.etiquetaMetodo(d.metodo), F.moneda(d.valorLista), F.moneda(d.monto), guion(d.descuentoNegocio), guion(d.descuentoTrabajador), guion(d.propina), ...(hayObservaciones ? [d.observacion || '-'] : [])]),
    { totales: ['Total', '', '', '', '', '', F.moneda(r.valorLista), F.moneda(r.total), F.moneda(r.descuentoNegocio), F.moneda(r.descuentoTrabajador), F.moneda(r.propinas), ...(hayObservaciones ? [''] : [])], totalFilas: r.detalleTotal, vacio: 'Sin compras en el período.' }
  ));

  return doc;
}

// ---------------------------------------------------------------------------
// LAVADOR
// ---------------------------------------------------------------------------
function vistaLavador(r, periodo) {
  const l = r.lavador;
  const t = r.totales;
  const doc = documento({
    tipo: 'lavador', titulo: `Reporte del lavador: ${l.nombre}`, periodo,
    descripcion: 'Qué hizo este lavador y cuánto ganó: cada servicio con su fecha, cliente, vehículo y valor; lo que le corresponde (comisión, descuentos que asumió y propinas), día por día, su asistencia, sus liquidaciones y lo que se le debe hoy.'
  });
  const horas = r.asistencia.reduce((s, a) => s + a.horas, 0);
  const diasAsistidos = r.asistencia.filter(a => !a.inasistencia).length;
  const inasistencias = r.asistencia.filter(a => a.inasistencia).length;

  doc.kpis.push(
    kpi('Servicios hechos', F.entero(t.servicios), { detalle: `Cobrados en el período${r.canceladas ? ` • ${F.entero(r.canceladas)} cancelados` : ''}` }),
    kpi('Vendido con su trabajo', F.moneda(t.cobrado), { tono: 'ok', detalle: 'Dinero cobrado por sus servicios (su parte si fueron en equipo)' }),
    kpi('Comisión neta', F.moneda(t.comisionNeta), { detalle: `Bruta ${F.moneda(t.comisionBruta)}${t.descuentos > 0 ? ` - descuentos asumidos ${F.moneda(t.descuentos)}` : ''}` }),
    kpi('Propinas', F.moneda(t.propinas), { detalle: '100% suyas' }),
    kpi('Total ganado', F.moneda(t.ganado), { tono: 'ok', detalle: 'Comisión neta + propinas del período' }),
    kpi('Le deben hoy', F.moneda(r.saldo.pendiente), { tono: r.saldo.pendiente > 0 ? 'aviso' : 'ok', detalle: `Pagado en total: ${F.moneda(r.saldo.pagado)}` })
  );

  const ficha = [
    `Nombre: ${l.nombre}`, `Documento: ${l.documento}`, `Teléfono: ${l.telefono || '-'}`,
    `Estado: ${l.estado === 'activo' ? 'Activo' : 'Inactivo'}`, `Porcentaje de comisión: ${F.porcentaje(l.porcentaje)}`,
    `Ingresó: ${F.fecha(l.ingreso)}`, `Acceso al sistema: ${l.acceso || 'sin acceso'}`
  ];
  doc.secciones.push(texto('Datos del lavador', ficha.join('\n')));

  if (t.servicios === 0) {
    doc.hallazgos.push('Este lavador no tiene servicios cobrados en el período elegido. Prueba con un rango más amplio.');
  } else {
    doc.hallazgos.push(`Hizo ${F.entero(t.servicios)} servicios cobrados que dejaron ${F.moneda(t.cobrado)} al negocio; a él le corresponden ${F.moneda(t.ganado)} (${F.moneda(t.comisionNeta)} de comisión y ${F.moneda(t.propinas)} de propinas).`);
    const mejorDia = maximo(r.porDia.map(d => d.ganado));
    if (mejorDia) doc.hallazgos.push(`Su mejor día fue el ${F.fecha(r.porDia[mejorDia.indice].fecha)}: ${F.entero(r.porDia[mejorDia.indice].servicios)} servicios y ${F.moneda(mejorDia.valor)} ganados.`);
    const s = r.porServicio[0];
    if (s) doc.hallazgos.push(`El servicio que más hace es "${s.servicio}" (${F.capitalizar(s.tipoVehiculo)}): ${F.entero(s.cantidad)} veces y ${F.moneda(s.ganado)} ganados.`);
    const cl = r.porCliente[0];
    if (cl && cl.cantidad > 1) doc.hallazgos.push(`El cliente que más atendió fue ${cl.cliente}: ${F.entero(cl.cantidad)} servicios.`);
    if (t.descuentos > 0) doc.hallazgos.push(`Asumió ${F.moneda(t.descuentos)} en descuentos (se le restan de su comisión).`);
    const enEquipo = r.detalle.filter(x => x.compartido > 1).length;
    if (enEquipo > 0) doc.hallazgos.push(`${F.entero(enEquipo)} de sus servicios los hizo en equipo con otros lavadores; en esos, la comisión y la propina se reparten.`);
  }
  if (r.asistencia.length > 0) doc.hallazgos.push(`Asistencia: ${F.entero(diasAsistidos)} días trabajados (${F.decimal(horas)} horas)${inasistencias ? ` y ${F.entero(inasistencias)} inasistencias` : ''} en el período.`);
  if (r.abiertos.length > 0) doc.hallazgos.push(`Tiene ${F.entero(r.abiertos.length)} servicio(s) asignado(s) que aún no se cobran; cuando se cobren sumarán su comisión.`);

  doc.secciones.push(serie(
    `Lo que ganó por ${GRAN_TEXTO[r.serie.gran]}`,
    'Comisión neta más propinas en cada momento del período.',
    r.serie.gran, r.serie.etiquetas, [{ nombre: 'Ganado', valores: r.serie.ganado, color: PALETA[2] }]
  ));
  doc.secciones.push(serie(
    `Servicios por ${GRAN_TEXTO[r.serie.gran]}`,
    'Cuántos servicios hizo en cada momento del período.',
    r.serie.gran, r.serie.etiquetas, [{ nombre: 'Servicios', valores: r.serie.servicios, color: PALETA[0] }], { formato: 'numero' }
  ));

  doc.secciones.push(tabla(
    'Día por día: qué hizo y cuánto ganó',
    'Para cada día: cuántos servicios hizo, cuánto se vendió con su trabajo, su comisión (bruta, descuentos y neta), propinas, total ganado y las horas que trabajó.',
    [col('Día'), col('Servicios', 'der'), col('Vendido', 'der'), col('Comisión bruta', 'der'), col('Descuentos', 'der'), col('Comisión neta', 'der'), col('Propinas', 'der'), col('Total ganado', 'der'), col('Horas', 'der'), col('Asistencia')],
    r.porDia.map(d => [F.fecha(d.fecha), F.entero(d.servicios), guion(d.cobrado), guion(d.comisionBruta), d.descuentos > 0 ? F.moneda(-d.descuentos) : '-', guion(d.comisionNeta), guion(d.propinas), guion(d.ganado), d.horas === null ? '-' : F.decimal(d.horas), d.estadoAsistencia ? celda(d.estadoAsistencia, d.estadoAsistencia === 'Inasistencia' ? 'mal' : 'ok') : '-']),
    { totales: ['Total', F.entero(t.servicios), F.moneda(t.cobrado), F.moneda(t.comisionBruta), t.descuentos > 0 ? F.moneda(-t.descuentos) : '-', F.moneda(t.comisionNeta), F.moneda(t.propinas), F.moneda(t.ganado), F.decimal(horas), ''], vacio: 'Sin actividad en el período.' }
  ));

  doc.secciones.push(tabla(
    'Servicios que hace',
    'Qué servicios hizo, cuántas veces, cuánto se vendió y cuánto ganó con cada uno.',
    [col('Servicio'), col('Vehículo'), col('Veces', 'der'), col('Vendido', 'der'), col('Ganado', 'der'), col('% de lo ganado', 'der')],
    r.porServicio.map(s => [s.servicio, F.capitalizar(s.tipoVehiculo), F.entero(s.cantidad), F.moneda(s.cobrado), F.moneda(s.ganado), F.porcentaje(F.participacion(s.ganado, t.ganado))]),
    { vacio: 'Sin servicios en el período.' }
  ));

  doc.secciones.push(dona(
    'Por tipo de vehículo',
    'Qué tipo de vehículo atiende más. Entre paréntesis, cuántos servicios fueron.',
    r.porVehiculo.map(v => ({ etiqueta: `${F.capitalizar(v.tipoVehiculo)} (${v.cantidad})`, valor: v.ganado, texto: F.moneda(v.ganado) }))
  ));

  doc.secciones.push(tabla(
    'Clientes que más atendió (Top 10)',
    'A quién le hizo más servicios en el período.',
    [col('Cliente'), col('Servicios', 'der'), col('Vendido', 'der'), col('Ganado', 'der')],
    r.porCliente.map(c => [c.cliente, F.entero(c.cantidad), F.moneda(c.cobrado), F.moneda(c.ganado)]),
    { vacio: 'Sin clientes en el período.' }
  ));

  doc.secciones.push(tabla(
    'Asistencia del período',
    'Cada día que registró entrada (o inasistencia), con su hora de entrada, salida y las horas trabajadas.',
    [col('Día'), col('Entrada'), col('Salida'), col('Horas trabajadas', 'der'), col('Descanso', 'der'), col('Estado')],
    r.asistencia.map(a => [F.fecha(a.fecha), a.entrada ? String(a.entrada).substring(0, 5) : '-', a.salida ? String(a.salida).substring(0, 5) : '-', F.decimal(a.horas), a.descanso > 0 ? `${F.decimal(a.descanso)} h` : '-', celda(a.inasistencia ? 'Inasistencia' : 'Asistió', a.inasistencia ? 'mal' : 'ok')]),
    { totales: ['Total', '', '', F.decimal(horas), '', `${F.entero(diasAsistidos)} días`], vacio: 'Sin registros de asistencia en el período.' }
  ));

  if (r.abiertos.length > 0) {
    doc.secciones.push(tabla(
      'Servicios asignados sin cobrar',
      'Servicios que tiene en curso o terminados que todavía no se cobran. No dependen del período.',
      [col('Fecha y hora'), col('Orden y servicio'), col('Cliente'), col('Placa'), col('Valor', 'der'), col('Su comisión', 'der'), col('Estado')],
      r.abiertos.map(o => [F.fechaHora(o.fecha), `#${o.ordenId} ${o.servicio}`, o.cliente, o.placa, F.moneda(o.total), F.moneda(o.comision), celda(ESTADO_ORDEN[o.estado] || o.estado, 'aviso')])
    ));
  }

  doc.secciones.push(tabla(
    'Liquidaciones de comisión',
    'Pagos de comisión hechos al lavador (y pendientes por pagar).',
    [col('#'), col('Fecha'), col('Período liquidado'), col('Comisión', 'der'), col('Descuentos', 'der'), col('Valor pagado', 'der'), col('Estado')],
    r.liquidaciones.map(x => [`#${x.id}`, F.fecha(x.fecha), `${F.fecha(x.periodoInicio)} a ${F.fecha(x.periodoFin)}`, F.moneda(x.comision), guion(x.descuentos), F.moneda(x.neto), celda(x.estado === 'pagado' ? 'Pagado' : 'Pendiente', x.estado === 'pagado' ? 'ok' : 'aviso')]),
    { vacio: 'Sin liquidaciones en el período.' }
  ));

  doc.secciones.push(tabla(
    'Cuenta con el lavador (todo el historial)',
    'Cuánto ha generado y cuánto se le ha pagado desde siempre, sin importar el período elegido. Lo que se le debe es: comisión + propinas - descuentos asumidos - lo ya pagado.',
    [col('Concepto'), col('Valor', 'der')],
    [
      ['Servicios cobrados en total', F.entero(r.saldo.servicios)],
      ['Comisión total ganada', F.moneda(r.saldo.comisionHistorica)],
      ['Propinas recibidas', F.moneda(r.saldo.propinasHistoricas)],
      ['Descuentos que asumió', F.moneda(-r.saldo.descuentosHistoricos)],
      ['Ya liquidado y pagado', F.moneda(-r.saldo.pagado)],
      [celda('Le deben hoy', 'aviso'), celda(F.moneda(r.saldo.pendiente), 'aviso')]
    ]
  ));

  doc.secciones.push(tabla(
    'Detalle de todos sus servicios',
    'Cada servicio cobrado de este lavador, del más reciente al más antiguo: qué hizo, para quién, cuánto se cobró y cuánto le corresponde.',
    [col('Cobrado el'), col('Orden y servicio'), col('Cliente'), col('Placa'), col('En equipo con'), col('Valor servicio', 'der'), col('% comisión', 'der'), col('Comisión bruta', 'der'), col('Descuento asumido', 'der'), col('Propina', 'der'), col('Total ganado', 'der'), col('Pago')],
    r.detalle.map(d => [F.fechaHora(d.fecha), `#${d.ordenId} ${d.servicio}`, d.cliente, d.placa, d.companeros || '-', F.moneda(d.valorServicio), F.porcentaje(d.porcentaje), F.moneda(d.comisionBruta), d.descuentoAsumido > 0 ? F.moneda(-d.descuentoAsumido) : '-', guion(d.propina), F.moneda(d.ganado), F.etiquetaMetodo(d.metodo)]),
    { totales: ['Total', '', '', '', '', F.moneda(t.valorServicio), '', F.moneda(t.comisionBruta), t.descuentos > 0 ? F.moneda(-t.descuentos) : '-', F.moneda(t.propinas), F.moneda(t.ganado), ''], totalFilas: r.detalleTotal, vacio: 'Sin servicios cobrados en el período.' }
  ));

  return doc;
}

module.exports = { vistaCliente, vistaLavador };
