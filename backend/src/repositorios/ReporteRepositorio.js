/**
 * Cálculo de reportes financieros/operativos para un rango de fechas
 * (CU18, CU19, CU29 / RF19, RF20, RF25, RF26). Cada función alimenta tanto
 * la vista en pantalla como su descarga en PDF (mismos números, dos formas
 * de verlos).
 */
const { pool } = require('../config/baseDeDatos');
const InsumoRepositorio = require('./InsumoRepositorio');
const AuditoriaRepositorio = require('./AuditoriaRepositorio');
const { formatearFechaLocal, obtenerFechaHoy } = require('../utilidades/fechas');
const { planSerie, acumularSerie, acumularPorDiaSemana } = require('../utilidades/seriesReporte');

// Cuántas filas de detalle se envían como máximo a pantalla/PDF (los totales
// siempre se calculan con TODAS las filas del período).
const MAX_FILAS_DETALLE = 500;

function parsearFechaLocal(fechaStr) {
  const [anio, mes, dia] = fechaStr.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

/** Rango anterior de la misma duración (para reportes comparativos). */
function calcularRangoAnterior(inicio, fin) {
  const dIni = parsearFechaLocal(inicio);
  const dFin = parsearFechaLocal(fin);
  const duracionDias = Math.round((dFin - dIni) / 86400000) + 1;
  const finAnt = new Date(dIni.getFullYear(), dIni.getMonth(), dIni.getDate() - 1);
  const inicioAnt = new Date(finAnt.getFullYear(), finAnt.getMonth(), finAnt.getDate() - duracionDias + 1);
  return { inicio: formatearFechaLocal(inicioAnt), fin: formatearFechaLocal(finAnt) };
}

/** Resumen general (Ingresos - Compras de insumos - Gastos - Comisiones = Ganancia neta). */
async function calcularReporte(inicio, fin) {
  const [ordenesPagadas] = await pool.query(
    `SELECT o.id, o.total, p.monto AS pago_monto, p.descuento_negocio, p.descuento_trabajador, p.propina,
            p.fecha_pago, p.metodo_pago, s.nombre AS servicio_nombre,
            COALESCE(v.tipo, o.tipo_vehiculo_anonimo, 'carro') AS tipo_vehiculo
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?`,
    [inicio, fin]
  );

  // OJO: un pago puede ser $0 (descuento total); por eso no se usa `||`, que
  // trataría ese 0 como "sin pago" y contaría el precio completo del servicio.
  const montoDe = (o) => (o.pago_monto !== null && o.pago_monto !== undefined ? Number(o.pago_monto) : Number(o.total));
  const totalIngresos = ordenesPagadas.reduce((suma, o) => suma + montoDe(o), 0);
  const ordenIds = ordenesPagadas.map(o => o.id);

  // Descuentos y propinas del período. Las propinas NO son ingreso del
  // negocio (van 100% a los lavadores) y por eso no entran en la ganancia.
  const totalDescuentoNegocio = ordenesPagadas.reduce((s, o) => s + Number(o.descuento_negocio || 0), 0);
  const totalDescuentoTrabajador = ordenesPagadas.reduce((s, o) => s + Number(o.descuento_trabajador || 0), 0);
  const totalPropinas = ordenesPagadas.reduce((s, o) => s + Number(o.propina || 0), 0);
  const pagoPorOrden = {};
  ordenesPagadas.forEach(o => { pagoPorOrden[o.id] = o; });

  // Comisión REAL a pagar: la comisión del servicio menos la parte del
  // descuento que asumió el lavador (repartida según su parte de la
  // comisión). Lo que asume el lavador no lo paga el negocio.
  let totalComisionesLavadores = 0;
  const lavadoresStats = {};
  if (ordenIds.length > 0) {
    const [comisiones] = await pool.query(
      `SELECT ol.orden_id, ol.valor_comision, l.nombre
       FROM orden_lavadores ol
       INNER JOIN lavadores l ON l.id = ol.lavador_id
       WHERE ol.orden_id IN (?)`,
      [ordenIds]
    );
    const comisionTotalPorOrden = {};
    const lavadoresPorOrdenCount = {};
    comisiones.forEach(c => {
      comisionTotalPorOrden[c.orden_id] = (comisionTotalPorOrden[c.orden_id] || 0) + Number(c.valor_comision);
      lavadoresPorOrdenCount[c.orden_id] = (lavadoresPorOrdenCount[c.orden_id] || 0) + 1;
    });
    comisiones.forEach(c => {
      const pago = pagoPorOrden[c.orden_id] || {};
      const bruta = Number(c.valor_comision);
      const totalOrden = comisionTotalPorOrden[c.orden_id] || 0;
      const parteDescuento = totalOrden > 0 ? Number(pago.descuento_trabajador || 0) * (bruta / totalOrden) : 0;
      const neta = bruta - parteDescuento;
      const propina = Number(pago.propina || 0) / (lavadoresPorOrdenCount[c.orden_id] || 1);
      totalComisionesLavadores += neta;
      if (!lavadoresStats[c.nombre]) lavadoresStats[c.nombre] = { servicios: 0, comision: 0, propinas: 0 };
      lavadoresStats[c.nombre].servicios += 1;
      lavadoresStats[c.nombre].comision += neta;
      lavadoresStats[c.nombre].propinas += propina;
    });
  }

  // Compras de insumos del período (antes se calculaba como consumo por orden,
  // pero los insumos ya no se descuentan por servicio — ver facturas de compra).
  const [comprasInsumos] = await pool.query(
    `SELECT SUM(total) AS total FROM facturas WHERE tipo = 'compra' AND fecha BETWEEN ? AND ?`,
    [inicio, fin]
  );
  const costoInsumos = Number(comprasInsumos[0].total) || 0;

  const [gastos] = await pool.query(`SELECT SUM(monto) AS total FROM gastos_operativos WHERE fecha BETWEEN ? AND ?`, [inicio, fin]);
  const totalGastos = Number(gastos[0].total) || 0;

  const gananciaNeta = totalIngresos - (costoInsumos + totalGastos + totalComisionesLavadores);
  const margenPorcentaje = totalIngresos > 0 ? Number(((gananciaNeta / totalIngresos) * 100).toFixed(1)) : 0;

  // Todo se discrimina por tipo de vehículo: cantidad de servicios e ingresos
  // de cada tipo, y por servicio (cada servicio ya es de un solo tipo).
  const distribucionVehiculos = {};
  const porTipoVehiculo = {};
  const serviciosStats = {};
  ordenesPagadas.forEach(o => {
    const tipo = o.tipo_vehiculo || 'carro';
    distribucionVehiculos[tipo] = (distribucionVehiculos[tipo] || 0) + 1;
    if (!porTipoVehiculo[tipo]) porTipoVehiculo[tipo] = { servicios: 0, ingresos: 0 };
    porTipoVehiculo[tipo].servicios += 1;
    porTipoVehiculo[tipo].ingresos += montoDe(o);

    const nombreServicio = o.servicio_nombre || 'Otros';
    if (!serviciosStats[nombreServicio]) serviciosStats[nombreServicio] = { count: 0, total: 0, tipoVehiculo: tipo };
    serviciosStats[nombreServicio].count += 1;
    serviciosStats[nombreServicio].total += montoDe(o);
  });

  // Servicios cancelados del período (turnos y órdenes): valen $0 y no entran
  // en los ingresos, pero se muestran para que se vea cuántos se cayeron.
  const [[turnosCancelados]] = await pool.query(
    `SELECT COUNT(*) AS cantidad FROM turnos WHERE estado = 'cancelado' AND fecha BETWEEN ? AND ?`, [inicio, fin]
  );
  const [[ordenesCanceladas]] = await pool.query(
    `SELECT COUNT(*) AS cantidad FROM ordenes_servicio WHERE estado = 'cancelado' AND DATE(fecha_hora_registro) BETWEEN ? AND ?`, [inicio, fin]
  );

  const alertasStock = await InsumoRepositorio.listarAlertasStockBajo();
  const auditoriaReciente = await AuditoriaRepositorio.obtenerRecientes(8);

  // Evolución de los ingresos (por hora si es un solo día, por día o por mes
  // según el largo del rango) y desglose por método de pago.
  const plan = planSerie(inicio, fin);
  const serieIngresos = {
    gran: plan.gran,
    etiquetas: plan.etiquetas,
    ingresos: acumularSerie(plan, ordenesPagadas, o => o.fecha_pago, montoDe),
    servicios: acumularSerie(plan, ordenesPagadas, o => o.fecha_pago, () => 1)
  };
  const porMetodoPago = {};
  ordenesPagadas.forEach(o => {
    const metodo = o.metodo_pago || 'efectivo';
    if (!porMetodoPago[metodo]) porMetodoPago[metodo] = { cantidad: 0, total: 0 };
    porMetodoPago[metodo].cantidad += 1;
    porMetodoPago[metodo].total += montoDe(o);
  });

  const [gastosDetalle] = await pool.query(
    `SELECT g.id, g.fecha, g.concepto, g.monto, u.nombre AS registrado_por
     FROM gastos_operativos g
     LEFT JOIN usuarios u ON u.id = g.usuario_id
     WHERE g.fecha BETWEEN ? AND ?
     ORDER BY g.fecha DESC, g.id DESC`,
    [inicio, fin]
  );

  return {
    rango: { inicio, fin },
    ticketPromedio: ordenesPagadas.length > 0 ? Math.round(totalIngresos / ordenesPagadas.length) : 0,
    serieIngresos, porMetodoPago,
    gastosDetalle: gastosDetalle.map(g => ({ id: g.id, fecha: g.fecha, concepto: g.concepto, monto: Number(g.monto), registradoPor: g.registrado_por || '-' })),
    totalIngresos, totalComisionesLavadores, costoInsumos, totalGastos, gananciaNeta, margenPorcentaje,
    totalDescuentoNegocio, totalDescuentoTrabajador, totalPropinas,
    serviciosAtendidos: ordenesPagadas.length,
    serviciosCancelados: {
      turnos: turnosCancelados.cantidad || 0,
      ordenes: ordenesCanceladas.cantidad || 0,
      total: (turnosCancelados.cantidad || 0) + (ordenesCanceladas.cantidad || 0)
    },
    distribucionVehiculos, porTipoVehiculo, serviciosStats, lavadoresStats,
    alertasStockCount: alertasStock.length, auditoriaReciente
  };
}

/**
 * Filtros opcionales de ventas (por cliente, por lavador que participó y por
 * método de pago) como fragmento SQL para consultas con los alias `p` (pagos)
 * y `o` (ordenes_servicio).
 */
function condicionesVenta(filtros = {}) {
  const sql = [];
  const params = [];
  if (filtros.clienteId) { sql.push('o.cliente_id = ?'); params.push(filtros.clienteId); }
  if (filtros.lavadorId) {
    sql.push('EXISTS (SELECT 1 FROM orden_lavadores fl WHERE fl.orden_id = o.id AND fl.lavador_id = ?)');
    params.push(filtros.lavadorId);
  }
  if (filtros.metodo) { sql.push('p.metodo_pago = ?'); params.push(filtros.metodo); }
  return { sql: sql.length ? ` AND ${sql.join(' AND ')}` : '', params };
}

/** Ventas agrupadas por día (de la más reciente a la más antigua), con el total de cada método de pago. */
function agruparVentasPorDia(pagos) {
  const dias = {};
  pagos.forEach(p => {
    const dia = String(p.fecha_pago).substring(0, 10);
    if (!dias[dia]) dias[dia] = { fecha: dia, ventas: 0, total: 0, descuentoNegocio: 0, descuentoTrabajador: 0, propinas: 0, efectivo: 0, tarjeta: 0, transferencia: 0, pse: 0 };
    const d = dias[dia];
    const monto = Number(p.monto);
    d.ventas += 1;
    d.total += monto;
    d.descuentoNegocio += Number(p.descuento_negocio || 0);
    d.descuentoTrabajador += Number(p.descuento_trabajador || 0);
    d.propinas += Number(p.propina || 0);
    if (d[p.metodo_pago] !== undefined) d[p.metodo_pago] += monto;
  });
  return Object.values(dias).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/**
 * Productividad de cada lavador en el período: servicios pagados que trabajó,
 * comisión bruta, la parte del descuento que asumió, comisión neta y propinas
 * (en partes iguales si atendieron varios).
 */
async function calcularProductividadLavadores(inicio, fin, filtros = {}) {
  const cond = condicionesVenta(filtros);
  const [filas] = await pool.query(
    `SELECT ol.orden_id, ol.lavador_id, l.nombre, ol.valor_comision, p.descuento_trabajador, p.propina,
            (SELECT COUNT(*) FROM orden_lavadores x WHERE x.orden_id = ol.orden_id) AS lavadores_count,
            (SELECT SUM(x.valor_comision) FROM orden_lavadores x WHERE x.orden_id = ol.orden_id) AS comision_total_orden
     FROM orden_lavadores ol
     INNER JOIN lavadores l ON l.id = ol.lavador_id
     INNER JOIN pagos p ON p.orden_id = ol.orden_id
     INNER JOIN ordenes_servicio o ON o.id = ol.orden_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?${cond.sql}${filtros.lavadorId ? ' AND ol.lavador_id = ?' : ''}`,
    [inicio, fin, ...cond.params, ...(filtros.lavadorId ? [filtros.lavadorId] : [])]
  );
  const mapa = {};
  filas.forEach(f => {
    const bruta = Number(f.valor_comision);
    const totalOrden = Number(f.comision_total_orden) || 0;
    const parteDescuento = totalOrden > 0 ? Number(f.descuento_trabajador || 0) * (bruta / totalOrden) : 0;
    if (!mapa[f.lavador_id]) mapa[f.lavador_id] = { id: f.lavador_id, nombre: f.nombre, servicios: 0, comisionBruta: 0, descuentos: 0, comision: 0, propinas: 0 };
    const l = mapa[f.lavador_id];
    l.servicios += 1;
    l.comisionBruta += bruta;
    l.descuentos += parteDescuento;
    l.comision += bruta - parteDescuento;
    l.propinas += Number(f.propina || 0) / (Number(f.lavadores_count) || 1);
  });
  return Object.values(mapa)
    .map(l => ({
      ...l,
      comisionBruta: Number(l.comisionBruta.toFixed(2)),
      descuentos: Number(l.descuentos.toFixed(2)),
      comision: Number(l.comision.toFixed(2)),
      propinas: Number(l.propinas.toFixed(2))
    }))
    .sort((a, b) => b.comision - a.comision);
}

/** Ventas: por servicio, método de pago, vehículo, día/hora, lavador, clientes, propinas y detalle de cada venta. */
async function calcularReporteVentas(inicio, fin, filtros = {}) {
  const cond = condicionesVenta(filtros);
  const [pagos] = await pool.query(
    `SELECT p.id AS pago_id, p.fecha_pago, p.metodo_pago, p.monto, p.descuento_negocio, p.descuento_trabajador,
            p.propina, p.observacion, o.id AS orden_id, o.es_venta_anonima, s.nombre AS servicio_nombre,
            COALESCE(v.tipo, o.tipo_vehiculo_anonimo, 'carro') AS tipo_vehiculo,
            COALESCE(v.placa, o.placa_anonima) AS placa,
            cl.nombre AS cliente_nombre,
            (SELECT GROUP_CONCAT(l.nombre ORDER BY l.nombre SEPARATOR ', ')
             FROM orden_lavadores ol INNER JOIN lavadores l ON l.id = ol.lavador_id
             WHERE ol.orden_id = o.id) AS lavadores
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     LEFT JOIN clientes cl ON cl.id = o.cliente_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?${cond.sql}
     ORDER BY p.fecha_pago DESC`,
    [inicio, fin, ...cond.params]
  );

  const porServicio = {};
  const porMetodoPago = {};
  const metodosDetalle = {};
  const porVehiculo = {};
  const cantidadPorVehiculo = {};
  const serviciosMapa = {};
  let total = 0;
  let totalDescuentoNegocio = 0;
  let totalDescuentoTrabajador = 0;
  let mayorVenta = null;
  const clientesDistintos = new Set();
  let ventasAnonimas = 0;
  pagos.forEach(p => {
    const monto = Number(p.monto);
    total += monto;
    totalDescuentoNegocio += Number(p.descuento_negocio || 0);
    totalDescuentoTrabajador += Number(p.descuento_trabajador || 0);
    const servicio = p.servicio_nombre || 'Otros';
    const tipoVeh = p.tipo_vehiculo || 'carro';
    porServicio[servicio] = (porServicio[servicio] || 0) + monto;
    porMetodoPago[p.metodo_pago] = (porMetodoPago[p.metodo_pago] || 0) + monto;
    if (!metodosDetalle[p.metodo_pago]) metodosDetalle[p.metodo_pago] = { cantidad: 0, total: 0 };
    metodosDetalle[p.metodo_pago].cantidad += 1;
    metodosDetalle[p.metodo_pago].total += monto;
    porVehiculo[tipoVeh] = (porVehiculo[tipoVeh] || 0) + monto;
    cantidadPorVehiculo[tipoVeh] = (cantidadPorVehiculo[tipoVeh] || 0) + 1;
    const clave = `${servicio}|${tipoVeh}`;
    if (!serviciosMapa[clave]) serviciosMapa[clave] = { servicio, tipoVehiculo: tipoVeh, cantidad: 0, total: 0 };
    serviciosMapa[clave].cantidad += 1;
    serviciosMapa[clave].total += monto;
    if (!mayorVenta || monto > mayorVenta.monto) mayorVenta = { monto, servicio, ordenId: p.orden_id };
    if (p.cliente_nombre) clientesDistintos.add(p.cliente_nombre); else ventasAnonimas += 1;
  });
  const serviciosDetalle = Object.values(serviciosMapa).sort((a, b) => b.total - a.total);

  const plan = planSerie(inicio, fin);
  const serie = {
    gran: plan.gran, etiquetas: plan.etiquetas,
    ingresos: acumularSerie(plan, pagos, p => p.fecha_pago, p => p.monto),
    servicios: acumularSerie(plan, pagos, p => p.fecha_pago, () => 1)
  };
  const porDiaSemana = acumularPorDiaSemana(pagos, p => p.fecha_pago, p => p.monto);
  const planHoras = planSerie(inicio, inicio); // un día => 24 cubos por hora
  const porHora = {
    etiquetas: planHoras.etiquetas,
    totales: acumularSerie(planHoras, pagos, p => p.fecha_pago, p => p.monto),
    cantidades: acumularSerie(planHoras, pagos, p => p.fecha_pago, () => 1)
  };

  const [topClientes] = await pool.query(
    `SELECT cl.nombre, COUNT(*) AS cantidad, SUM(p.monto) AS total, MAX(DATE(p.fecha_pago)) AS ultima,
            SUM(p.descuento_negocio + p.descuento_trabajador) AS descuentos, SUM(p.propina) AS propinas
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     INNER JOIN clientes cl ON cl.id = o.cliente_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?${cond.sql}
     GROUP BY cl.id ORDER BY total DESC LIMIT 10`,
    [inicio, fin, ...cond.params]
  );

  const porLavador = await calcularProductividadLavadores(inicio, fin, filtros);

  // Propinas del período: NO son ingreso del negocio (van 100% al lavador,
  // repartidas en partes iguales si atendieron varios), pero se reportan
  // aparte con el detalle de a qué servicio, cliente y lavador corresponde
  // cada una — no solo el total agregado.
  const [propinasFilas] = await pool.query(
    `SELECT p.fecha_pago, p.propina, o.id AS orden_id, s.nombre AS servicio_nombre,
            cl.nombre AS cliente_nombre, o.es_venta_anonima, l.id AS lavador_id, l.nombre AS lavador_nombre,
            (SELECT COUNT(*) FROM orden_lavadores ol2 WHERE ol2.orden_id = o.id) AS lavadores_count
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN clientes cl ON cl.id = o.cliente_id
     LEFT JOIN orden_lavadores ol ON ol.orden_id = o.id
     LEFT JOIN lavadores l ON l.id = ol.lavador_id
     WHERE p.propina > 0 AND DATE(p.fecha_pago) BETWEEN ? AND ?${cond.sql}
     ORDER BY p.fecha_pago DESC`,
    [inicio, fin, ...cond.params]
  );
  const detallePropinas = propinasFilas.filter(f => !filtros.lavadorId || f.lavador_id === filtros.lavadorId).map(f => ({
    fecha: f.fecha_pago,
    ordenId: f.orden_id,
    servicio: f.servicio_nombre || 'Otros',
    cliente: f.cliente_nombre || 'Venta anónima',
    lavador: f.lavador_nombre || 'Sin asignar',
    valor: Number((Number(f.propina) / (Number(f.lavadores_count) || 1)).toFixed(2))
  }));
  const totalPropinas = detallePropinas.reduce((s, p) => s + p.valor, 0);

  const filtrosAplicados = { cliente: null, lavador: null, metodo: filtros.metodo || null };
  if (filtros.clienteId) {
    const [[c]] = await pool.query(`SELECT nombre FROM clientes WHERE id = ?`, [filtros.clienteId]);
    filtrosAplicados.cliente = c ? c.nombre : `#${filtros.clienteId}`;
  }
  if (filtros.lavadorId) {
    const [[l]] = await pool.query(`SELECT nombre FROM lavadores WHERE id = ?`, [filtros.lavadorId]);
    filtrosAplicados.lavador = l ? l.nombre : `#${filtros.lavadorId}`;
  }

  return {
    rango: { inicio, fin },
    filtros: filtrosAplicados,
    porDia: agruparVentasPorDia(pagos),
    totalVentas: total,
    cantidadVentas: pagos.length,
    ticketPromedio: pagos.length > 0 ? Math.round(total / pagos.length) : 0,
    mayorVenta,
    totalDescuentoNegocio, totalDescuentoTrabajador,
    clientesDistintos: clientesDistintos.size, ventasAnonimas,
    porServicio, serviciosDetalle, porMetodoPago, metodosDetalle, porVehiculo, cantidadPorVehiculo,
    serie, porDiaSemana, porHora,
    porLavador,
    topClientes: topClientes.map(c => ({ nombre: c.nombre, cantidad: c.cantidad, total: Number(c.total), ultima: c.ultima, descuentos: Number(c.descuentos) || 0, propinas: Number(c.propinas) || 0 })),
    totalPropinas,
    detallePropinas,
    detalleTotal: pagos.length,
    detalle: pagos.slice(0, MAX_FILAS_DETALLE).map(p => ({
      fecha: p.fecha_pago, ordenId: p.orden_id,
      cliente: p.cliente_nombre || 'Venta anónima',
      placa: p.placa || '-', servicio: p.servicio_nombre || 'Otros', tipoVehiculo: p.tipo_vehiculo,
      lavadores: p.lavadores || 'Sin asignar', metodo: p.metodo_pago, monto: Number(p.monto),
      descuentoNegocio: Number(p.descuento_negocio || 0), descuentoTrabajador: Number(p.descuento_trabajador || 0),
      propina: Number(p.propina || 0), observacion: p.observacion || ''
    }))
  };
}

/** Compras: por proveedor, por insumo, evolución y el detalle de cada factura de compra. */
async function calcularReporteCompras(inicio, fin) {
  const [filas] = await pool.query(
    `SELECT f.id, f.numero_factura, f.fecha, f.concepto, f.total,
            COALESCE(pr.nombre, 'Sin proveedor') AS proveedor, m.cantidad, i.unidad_medida
     FROM facturas f
     LEFT JOIN proveedores pr ON pr.id = f.proveedor_id
     LEFT JOIN movimientos_inventario m ON m.id = f.movimiento_id
     LEFT JOIN insumos i ON i.id = m.insumo_id
     WHERE f.tipo = 'compra' AND f.fecha BETWEEN ? AND ?
     ORDER BY f.fecha DESC, f.id DESC`,
    [inicio, fin]
  );

  const porProveedor = {};
  const proveedoresMapa = {};
  const porInsumo = {};
  const insumosMapa = {};
  filas.forEach(f => {
    const total = Number(f.total);
    porProveedor[f.proveedor] = (porProveedor[f.proveedor] || 0) + total;
    if (!proveedoresMapa[f.proveedor]) proveedoresMapa[f.proveedor] = { proveedor: f.proveedor, compras: 0, total: 0 };
    proveedoresMapa[f.proveedor].compras += 1;
    proveedoresMapa[f.proveedor].total += total;
    porInsumo[f.concepto] = (porInsumo[f.concepto] || 0) + total;
    if (!insumosMapa[f.concepto]) insumosMapa[f.concepto] = { insumo: f.concepto, compras: 0, cantidad: 0, unidad: f.unidad_medida || '', total: 0 };
    insumosMapa[f.concepto].compras += 1;
    insumosMapa[f.concepto].cantidad += Number(f.cantidad) || 0;
    insumosMapa[f.concepto].total += total;
  });

  const totalCompras = filas.reduce((s, f) => s + Number(f.total), 0);

  // Las facturas solo guardan la fecha (no la hora): un solo día no se puede
  // graficar por hora.
  const plan = planSerie(inicio, fin);
  const serie = plan.gran === 'hora' ? null : {
    gran: plan.gran, etiquetas: plan.etiquetas,
    compras: acumularSerie(plan, filas, f => f.fecha, f => f.total)
  };

  return {
    rango: { inicio, fin },
    totalCompras,
    cantidadCompras: filas.length,
    promedioCompra: filas.length > 0 ? Math.round(totalCompras / filas.length) : 0,
    porProveedor, porInsumo,
    proveedoresDetalle: Object.values(proveedoresMapa).sort((a, b) => b.total - a.total),
    insumosDetalle: Object.values(insumosMapa).sort((a, b) => b.total - a.total),
    serie,
    detalleTotal: filas.length,
    detalle: filas.slice(0, MAX_FILAS_DETALLE).map(f => ({
      fecha: f.fecha, numero: f.numero_factura, proveedor: f.proveedor, concepto: f.concepto,
      cantidad: f.cantidad !== null && f.cantidad !== undefined ? Number(f.cantidad) : null,
      unidad: f.unidad_medida || '', total: Number(f.total)
    }))
  };
}

/** Inventario: valorización actual del stock y alertas (foto del momento, sin rango de fechas). */
async function calcularReporteInventario() {
  const insumos = await InsumoRepositorio.listarInsumos({ soloActivos: true });
  const valorizacion = insumos.map(i => ({
    nombre: i.nombre,
    unidad_medida: i.unidad_medida,
    stock_actual: Number(i.stock_actual),
    stock_minimo: Number(i.stock_minimo),
    costo_unitario: Number(i.costo_unitario),
    proveedor: i.proveedor_nombre || '-',
    valor: Number(i.stock_actual) * Number(i.costo_unitario),
    bajo_stock: i.bajo_stock
  })).sort((a, b) => b.valor - a.valor);

  const valorTotalInventario = valorizacion.reduce((s, i) => s + i.valor, 0);
  const alertas = valorizacion.filter(i => i.bajo_stock);

  return { valorTotalInventario, insumos: valorizacion, alertas };
}

/** Nómina: salarios y comisiones pagados en el período, lo pendiente, productividad y detalle de cada pago. */
async function calcularReporteNomina(inicio, fin) {
  const [salarios] = await pool.query(
    `SELECT SUM(valor_a_pagar) AS total, COUNT(*) AS cantidad FROM pagos_salario WHERE fecha_pago_real BETWEEN ? AND ?`,
    [inicio, fin]
  );
  const [comisionesPagadas] = await pool.query(
    `SELECT SUM(valor_a_pagar) AS total, COUNT(*) AS cantidad FROM liquidaciones_lavador WHERE estado = 'pagado' AND fecha_pago BETWEEN ? AND ?`,
    [inicio, fin]
  );
  const [liquidacionesPendientes] = await pool.query(
    `SELECT SUM(valor_a_pagar) AS total, COUNT(*) AS cantidad FROM liquidaciones_lavador WHERE estado = 'pendiente'`
  );
  const [asistencia] = await pool.query(
    `SELECT
       SUM(CASE WHEN inasistencia = TRUE THEN 1 ELSE 0 END) AS inasistencias,
       SUM(CASE WHEN inasistencia = FALSE THEN 1 ELSE 0 END) AS presentes,
       SUM(horas_trabajadas) AS horasTotales
     FROM asistencia WHERE fecha BETWEEN ? AND ?`,
    [inicio, fin]
  );

  // Detalle por trabajador: cuánto se le pagó a cada quién en el período,
  // no solo el total agregado del negocio.
  const [porEmpleado] = await pool.query(
    `SELECT u.id, u.nombre, u.rol, SUM(ps.valor_a_pagar) AS total, COUNT(*) AS cantidad
     FROM pagos_salario ps
     INNER JOIN usuarios u ON u.id = ps.empleado_id
     WHERE ps.fecha_pago_real BETWEEN ? AND ?
     GROUP BY u.id, u.nombre, u.rol
     ORDER BY total DESC`,
    [inicio, fin]
  );
  const [porLavador] = await pool.query(
    `SELECT l.id, l.nombre, SUM(ll.valor_a_pagar) AS total, COUNT(*) AS cantidad
     FROM liquidaciones_lavador ll
     INNER JOIN lavadores l ON l.id = ll.lavador_id
     WHERE ll.estado = 'pagado' AND ll.fecha_pago BETWEEN ? AND ?
     GROUP BY l.id, l.nombre
     ORDER BY total DESC`,
    [inicio, fin]
  );

  // Propinas recibidas y descuentos que asumieron los lavadores en el período.
  const [propinasYDescuentos] = await pool.query(
    `SELECT SUM(propina) AS propinas, SUM(descuento_trabajador) AS descuentos
     FROM pagos WHERE DATE(fecha_pago) BETWEEN ? AND ?`,
    [inicio, fin]
  );

  const [salariosDetalle] = await pool.query(
    `SELECT ps.id, ps.fecha_pago_real, u.nombre, u.rol, ps.periodicidad, ps.periodo_inicio, ps.periodo_fin,
            ps.salario_base, ps.descuentos, ps.valor_a_pagar
     FROM pagos_salario ps
     INNER JOIN usuarios u ON u.id = ps.empleado_id
     WHERE ps.fecha_pago_real BETWEEN ? AND ?
     ORDER BY ps.fecha_pago_real DESC, ps.id DESC`,
    [inicio, fin]
  );
  const [liquidacionesDetalle] = await pool.query(
    `SELECT ll.id, ll.fecha_pago, ll.creado_en, l.nombre, ll.periodo_inicio, ll.periodo_fin,
            ll.total_comision, ll.descuentos, ll.valor_a_pagar, ll.estado
     FROM liquidaciones_lavador ll
     INNER JOIN lavadores l ON l.id = ll.lavador_id
     WHERE (ll.estado = 'pagado' AND ll.fecha_pago BETWEEN ? AND ?) OR ll.estado = 'pendiente'
     ORDER BY ll.estado DESC, ll.fecha_pago DESC, ll.id DESC`,
    [inicio, fin]
  );

  // Lo que HOY se le debe a cada lavador (comisión + propinas - descuentos
  // asumidos - lo ya liquidado), sin importar el período elegido.
  const NominaRepositorio = require('./NominaRepositorio');
  const resumenLavadores = await NominaRepositorio.resumenComisionesLavadores();
  const pendientePorLavador = resumenLavadores
    .filter(l => l.comision_pendiente > 0)
    .map(l => ({ nombre: l.nombre, servicios: l.servicios_realizados, pendiente: Number(l.comision_pendiente) }))
    .sort((a, b) => b.pendiente - a.pendiente);

  const productividad = await calcularProductividadLavadores(inicio, fin);

  return {
    rango: { inicio, fin },
    propinasPeriodo: Number(propinasYDescuentos[0].propinas) || 0,
    descuentosTrabajadorPeriodo: Number(propinasYDescuentos[0].descuentos) || 0,
    salariosPagados: Number(salarios[0].total) || 0,
    salariosCantidad: salarios[0].cantidad || 0,
    comisionesPagadas: Number(comisionesPagadas[0].total) || 0,
    comisionesCantidad: comisionesPagadas[0].cantidad || 0,
    liquidacionesPendientesTotal: Number(liquidacionesPendientes[0].total) || 0,
    liquidacionesPendientesCantidad: liquidacionesPendientes[0].cantidad || 0,
    asistenciasPresentes: Number(asistencia[0].presentes) || 0,
    inasistencias: Number(asistencia[0].inasistencias) || 0,
    horasTrabajadasTotal: Number((Number(asistencia[0].horasTotales) || 0).toFixed(2)),
    porEmpleado: porEmpleado.map(e => ({ id: e.id, nombre: e.nombre, rol: e.rol, total: Number(e.total) || 0, cantidad: e.cantidad })),
    porLavador: porLavador.map(l => ({ id: l.id, nombre: l.nombre, total: Number(l.total) || 0, cantidad: l.cantidad })),
    salariosDetalle: salariosDetalle.map(s => ({
      id: s.id, fecha: s.fecha_pago_real, nombre: s.nombre, rol: s.rol, periodicidad: s.periodicidad,
      periodoInicio: s.periodo_inicio, periodoFin: s.periodo_fin,
      base: Number(s.salario_base), descuentos: Number(s.descuentos), neto: Number(s.valor_a_pagar)
    })),
    liquidacionesDetalle: liquidacionesDetalle.map(l => ({
      id: l.id, fecha: l.fecha_pago || String(l.creado_en).substring(0, 10), nombre: l.nombre,
      periodoInicio: l.periodo_inicio, periodoFin: l.periodo_fin,
      comision: Number(l.total_comision), descuentos: Number(l.descuentos), neto: Number(l.valor_a_pagar), estado: l.estado
    })),
    pendientePorLavador,
    pendienteTotalLavadores: pendientePorLavador.reduce((s, l) => s + l.pendiente, 0),
    productividad
  };
}

/** Comparativo: el período actual contra el período anterior de igual duración (métricas completas y series superpuestas). */
async function calcularReporteComparativo(inicio, fin) {
  const anterior = calcularRangoAnterior(inicio, fin);
  const [actual, previo] = await Promise.all([
    calcularReporte(inicio, fin),
    calcularReporte(anterior.inicio, anterior.fin)
  ]);

  const variacion = (actualVal, previoVal) => previoVal > 0 ? Number((((actualVal - previoVal) / previoVal) * 100).toFixed(1)) : null;
  const resumir = (r) => ({
    rango: r.rango,
    totalIngresos: r.totalIngresos,
    costoInsumos: r.costoInsumos,
    totalComisionesLavadores: r.totalComisionesLavadores,
    totalGastos: r.totalGastos,
    gananciaNeta: r.gananciaNeta,
    margenPorcentaje: r.margenPorcentaje,
    serviciosAtendidos: r.serviciosAtendidos,
    ticketPromedio: r.ticketPromedio,
    totalDescuentoNegocio: r.totalDescuentoNegocio,
    totalPropinas: r.totalPropinas,
    cancelados: r.serviciosCancelados.total
  });

  // El período anterior se alinea cubo a cubo con el actual (mismo largo).
  const n = actual.serieIngresos.ingresos.length;
  const alinear = (arr) => Array.from({ length: n }, (_, i) => arr[i] || 0);
  const a = resumir(actual);
  const b = resumir(previo);

  return {
    actual: a,
    anterior: b,
    serie: {
      gran: actual.serieIngresos.gran,
      etiquetas: actual.serieIngresos.etiquetas,
      actual: actual.serieIngresos.ingresos,
      anterior: alinear(previo.serieIngresos.ingresos)
    },
    variaciones: {
      ingresos: variacion(a.totalIngresos, b.totalIngresos),
      ganancia: variacion(a.gananciaNeta, b.gananciaNeta),
      servicios: variacion(a.serviciosAtendidos, b.serviciosAtendidos),
      ticket: variacion(a.ticketPromedio, b.ticketPromedio)
    },
    // compatibilidad con el formato anterior
    variacionIngresos: variacion(a.totalIngresos, b.totalIngresos),
    variacionGanancia: variacion(a.gananciaNeta, b.gananciaNeta),
    variacionServicios: variacion(a.serviciosAtendidos, b.serviciosAtendidos)
  };
}

/** Operativo: citas, demanda (día/hora), tiempos, cancelaciones y clientes nuevos vs. recurrentes. */
async function calcularReporteOperativo(inicio, fin) {
  const [citasPorEstado] = await pool.query(
    `SELECT estado, COUNT(*) AS cantidad FROM citas WHERE fecha BETWEEN ? AND ? GROUP BY estado`,
    [inicio, fin]
  );
  const [clientesNuevos] = await pool.query(
    `SELECT COUNT(*) AS cantidad FROM clientes WHERE DATE(creado_en) BETWEEN ? AND ?`,
    [inicio, fin]
  );
  const [clientesRecurrentes] = await pool.query(
    `SELECT COUNT(DISTINCT o.cliente_id) AS cantidad
     FROM ordenes_servicio o
     INNER JOIN pagos p ON p.orden_id = o.id
     INNER JOIN clientes cl ON cl.id = o.cliente_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ? AND DATE(cl.creado_en) < ?`,
    [inicio, fin, inicio]
  );

  const porEstadoCitas = {};
  citasPorEstado.forEach(c => { porEstadoCitas[c.estado] = c.cantidad; });

  const [citasDetalle] = await pool.query(
    `SELECT c.fecha, c.hora, c.estado, s.nombre AS servicio,
            COALESCE(cl.nombre, c.cliente_nombre_temp, 'Sin registrar') AS cliente,
            COALESCE(v.placa, c.placa_temp) AS placa
     FROM citas c
     LEFT JOIN clientes cl ON cl.id = c.cliente_id
     LEFT JOIN vehiculos v ON v.id = c.vehiculo_id
     LEFT JOIN servicios s ON s.id = c.servicio_id
     WHERE c.fecha BETWEEN ? AND ?
     ORDER BY c.fecha DESC, c.hora DESC`,
    [inicio, fin]
  );

  // Órdenes ingresadas en el período: demanda por día/hora, estados y tiempo
  // promedio desde que el vehículo ingresa hasta que se entrega.
  const [ordenes] = await pool.query(
    `SELECT o.id, o.estado, o.fecha_hora_registro, o.fecha_hora_entrega
     FROM ordenes_servicio o
     WHERE DATE(o.fecha_hora_registro) BETWEEN ? AND ?`,
    [inicio, fin]
  );
  const ordenesPorEstado = {};
  ordenes.forEach(o => { ordenesPorEstado[o.estado] = (ordenesPorEstado[o.estado] || 0) + 1; });
  const atenciones = ordenes.filter(o => o.estado !== 'cancelado');
  const plan = planSerie(inicio, fin);
  const serie = {
    gran: plan.gran, etiquetas: plan.etiquetas,
    atenciones: acumularSerie(plan, atenciones, o => o.fecha_hora_registro, () => 1)
  };
  const porDiaSemana = acumularPorDiaSemana(atenciones, o => o.fecha_hora_registro, () => 1);
  const planHoras = planSerie(inicio, inicio);
  const porHora = {
    etiquetas: planHoras.etiquetas,
    cantidades: acumularSerie(planHoras, atenciones, o => o.fecha_hora_registro, () => 1)
  };
  const duraciones = ordenes
    .filter(o => o.fecha_hora_entrega && o.fecha_hora_registro)
    .map(o => (new Date(String(o.fecha_hora_entrega).replace(' ', 'T')) - new Date(String(o.fecha_hora_registro).replace(' ', 'T'))) / 60000)
    .filter(m => m > 0 && m < 600);
  const minutosPromedio = duraciones.length ? Math.round(duraciones.reduce((s, m) => s + m, 0) / duraciones.length) : null;

  // Servicios cancelados del período: turnos que nunca se atendieron y
  // órdenes canceladas en el POS (valor $0, nunca llegaron a generar un pago).
  const [turnosCancelados] = await pool.query(
    `SELECT t.fecha, t.hora_llegada AS hora, COALESCE(v.placa, t.placa_temporal) AS placa, s.nombre AS servicio, t.observacion
     FROM turnos t
     LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
     LEFT JOIN servicios s ON s.id = t.servicio_id
     WHERE t.estado = 'cancelado' AND t.fecha BETWEEN ? AND ?
     ORDER BY t.fecha DESC, t.hora_llegada DESC`,
    [inicio, fin]
  );
  const [ordenesCanceladas] = await pool.query(
    `SELECT DATE(o.fecha_hora_registro) AS fecha, TIME(o.fecha_hora_registro) AS hora,
            COALESCE(v.placa, o.placa_anonima) AS placa, s.nombre AS servicio, o.observacion
     FROM ordenes_servicio o
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     WHERE o.estado = 'cancelado' AND DATE(o.fecha_hora_registro) BETWEEN ? AND ?
     ORDER BY o.fecha_hora_registro DESC`,
    [inicio, fin]
  );
  const cancelacionesDetalle = [
    ...turnosCancelados.map(t => ({ origen: 'Turno en fila', fecha: t.fecha, hora: t.hora, placa: t.placa || '-', servicio: t.servicio || '-', observacion: t.observacion || '' })),
    ...ordenesCanceladas.map(o => ({ origen: 'Orden en el POS', fecha: o.fecha, hora: o.hora, placa: o.placa || '-', servicio: o.servicio || '-', observacion: o.observacion || '' }))
  ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  return {
    rango: { inicio, fin },
    porEstadoCitas,
    citasTotal: citasDetalle.length,
    citasDetalle: citasDetalle.slice(0, MAX_FILAS_DETALLE).map(c => ({
      fecha: c.fecha, hora: String(c.hora).substring(0, 5), estado: c.estado, servicio: c.servicio || '-', cliente: c.cliente, placa: c.placa || '-'
    })),
    clientesNuevos: clientesNuevos[0].cantidad || 0,
    clientesRecurrentes: clientesRecurrentes[0].cantidad || 0,
    atencionesTotal: atenciones.length,
    ordenesPorEstado, serie, porDiaSemana, porHora, minutosPromedio,
    serviciosCancelados: {
      turnos: turnosCancelados.length,
      ordenes: ordenesCanceladas.length,
      total: turnosCancelados.length + ordenesCanceladas.length
    },
    cancelacionesDetalle: cancelacionesDetalle.slice(0, 200)
  };
}

/**
 * Asistencia: detalle día a día por cada trabajador (empleado/administrador
 * o lavador) en el período — no solo el total agregado del negocio que ya
 * trae el reporte de Nómina.
 */
async function calcularReporteAsistencia(inicio, fin) {
  const [porTrabajadorFilas] = await pool.query(
    `SELECT a.persona_tipo, a.persona_id,
            COALESCE(u.nombre, l.nombre) AS nombre,
            CASE WHEN a.persona_tipo = 'usuario' THEN u.rol ELSE 'lavador' END AS rol,
            SUM(CASE WHEN a.inasistencia = FALSE THEN 1 ELSE 0 END) AS presentes,
            SUM(CASE WHEN a.inasistencia = TRUE THEN 1 ELSE 0 END) AS inasistencias,
            SUM(a.horas_trabajadas) AS horasTrabajadas
     FROM asistencia a
     LEFT JOIN usuarios u ON a.persona_tipo = 'usuario' AND u.id = a.persona_id
     LEFT JOIN lavadores l ON a.persona_tipo = 'lavador' AND l.id = a.persona_id
     WHERE a.fecha BETWEEN ? AND ?
     GROUP BY a.persona_tipo, a.persona_id, nombre, rol
     ORDER BY nombre`,
    [inicio, fin]
  );

  const [detalleFilas] = await pool.query(
    `SELECT a.fecha, a.persona_tipo, a.hora_entrada, a.hora_salida, a.horas_trabajadas, a.horas_descanso, a.inasistencia,
            COALESCE(u.nombre, l.nombre) AS nombre,
            (SELECT GROUP_CONCAT(CONCAT(LEFT(s.hora_entrada, 5), ' a ', IFNULL(LEFT(s.hora_salida, 5), '...')) ORDER BY s.id SEPARATOR ', ')
             FROM asistencia_sesiones s WHERE s.asistencia_id = a.id) AS sesiones
     FROM asistencia a
     LEFT JOIN usuarios u ON a.persona_tipo = 'usuario' AND u.id = a.persona_id
     LEFT JOIN lavadores l ON a.persona_tipo = 'lavador' AND l.id = a.persona_id
     WHERE a.fecha BETWEEN ? AND ?
     ORDER BY a.fecha DESC, nombre`,
    [inicio, fin]
  );

  const porTrabajador = porTrabajadorFilas.map(f => ({
    nombre: f.nombre || `(${f.persona_tipo} #${f.persona_id})`,
    rol: f.rol,
    presentes: Number(f.presentes) || 0,
    inasistencias: Number(f.inasistencias) || 0,
    horasTrabajadas: Number((Number(f.horasTrabajadas) || 0).toFixed(2))
  }));

  return {
    rango: { inicio, fin },
    totalPresentes: porTrabajador.reduce((s, t) => s + t.presentes, 0),
    totalInasistencias: porTrabajador.reduce((s, t) => s + t.inasistencias, 0),
    totalHorasTrabajadas: Number(porTrabajador.reduce((s, t) => s + t.horasTrabajadas, 0).toFixed(2)),
    porTrabajador,
    detalle: detalleFilas.map(f => ({
      fecha: f.fecha, nombre: f.nombre, tipo: f.persona_tipo,
      horaEntrada: f.hora_entrada, horaSalida: f.hora_salida, sesiones: f.sesiones || '',
      horasTrabajadas: Number(f.horas_trabajadas) || 0, horasDescanso: Number(f.horas_descanso) || 0,
      inasistencia: !!f.inasistencia
    }))
  };
}

// Un cliente sin compras en los últimos 60 días se considera inactivo (foto
// del momento actual, no depende del período de reporte seleccionado).
const DIAS_INACTIVIDAD_CLIENTE = 60;

/** Clientes: activos/inactivos según su última compra (foto del momento, no por período). */
async function calcularReporteClientes() {
  const [filas] = await pool.query(
    `SELECT cl.id, cl.nombre, cl.telefono, cl.correo, cl.creado_en, cl.estado AS estado_manual,
            (SELECT COUNT(*) FROM cliente_notas n WHERE n.cliente_id = cl.id AND n.tipo = 'lista_negra') AS en_lista_negra,
            (SELECT COUNT(*) FROM vehiculos v WHERE v.cliente_id = cl.id) AS vehiculos,
            MAX(DATE(p.fecha_pago)) AS ultima_compra,
            MIN(DATE(p.fecha_pago)) AS primera_compra,
            COUNT(p.id) AS total_compras,
            SUM(p.monto) AS total_gastado,
            SUM(p.descuento_negocio) AS desc_negocio,
            SUM(p.descuento_trabajador) AS desc_trabajador,
            SUM(p.propina) AS propinas
     FROM clientes cl
     LEFT JOIN ordenes_servicio o ON o.cliente_id = cl.id
     LEFT JOIN pagos p ON p.orden_id = o.id
     GROUP BY cl.id, cl.nombre, cl.telefono, cl.correo, cl.creado_en, cl.estado
     ORDER BY ultima_compra IS NULL, ultima_compra DESC`
  );

  const hoy = parsearFechaLocal(obtenerFechaHoy());
  const clientes = filas.map((f) => {
    let estado = 'nunca_compro';
    if (f.ultima_compra) {
      const dias = Math.round((hoy - parsearFechaLocal(f.ultima_compra)) / 86400000);
      estado = dias <= DIAS_INACTIVIDAD_CLIENTE ? 'activo' : 'inactivo';
    }
    return {
      id: f.id,
      nombre: f.nombre,
      telefono: f.telefono,
      correo: f.correo,
      fechaRegistro: f.creado_en,
      desactivado: f.estado_manual === 'inactivo',
      enListaNegra: Number(f.en_lista_negra) > 0,
      vehiculos: Number(f.vehiculos) || 0,
      ultimaCompra: f.ultima_compra,
      primeraCompra: f.primera_compra,
      totalCompras: f.total_compras || 0,
      totalGastado: Number(f.total_gastado) || 0,
      descuentos: (Number(f.desc_negocio) || 0) + (Number(f.desc_trabajador) || 0),
      propinas: Number(f.propinas) || 0,
      estado
    };
  });

  // Ventas sin cliente registrado (ventas rápidas/anónimas): no pertenecen a
  // ningún cliente, pero también son dinero cobrado, con sus descuentos y propinas.
  const [[anonimas]] = await pool.query(
    `SELECT COUNT(*) AS compras, COALESCE(SUM(p.monto), 0) AS total, MAX(DATE(p.fecha_pago)) AS ultima, MIN(DATE(p.fecha_pago)) AS primera,
            COALESCE(SUM(p.descuento_negocio + p.descuento_trabajador), 0) AS descuentos, COALESCE(SUM(p.propina), 0) AS propinas
     FROM pagos p INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     WHERE o.cliente_id IS NULL`
  );

  return {
    ventasAnonimas: {
      totalCompras: Number(anonimas.compras) || 0, totalGastado: Number(anonimas.total) || 0,
      ultimaCompra: anonimas.ultima, primeraCompra: anonimas.primera,
      descuentos: Number(anonimas.descuentos) || 0, propinas: Number(anonimas.propinas) || 0
    },
    diasInactividad: DIAS_INACTIVIDAD_CLIENTE,
    totalClientes: clientes.length,
    activos: clientes.filter((c) => c.estado === 'activo').length,
    inactivos: clientes.filter((c) => c.estado === 'inactivo').length,
    nuncaCompraron: clientes.filter((c) => c.estado === 'nunca_compro').length,
    desactivados: clientes.filter((c) => c.desactivado).length,
    enListaNegra: clientes.filter((c) => c.enListaNegra).length,
    clientes
  };
}

module.exports = {
  calcularRangoAnterior,
  condicionesVenta,
  agruparVentasPorDia,
  MAX_FILAS_DETALLE,
  calcularReporte,
  calcularReporteVentas,
  calcularReporteCompras,
  calcularReporteInventario,
  calcularReporteNomina,
  calcularReporteComparativo,
  calcularReporteOperativo,
  calcularReporteAsistencia,
  calcularReporteClientes
};
