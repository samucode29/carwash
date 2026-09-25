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
    `SELECT o.id, o.total, p.monto AS pago_monto, s.nombre AS servicio_nombre,
            COALESCE(v.tipo, o.tipo_vehiculo_anonimo, 'carro') AS tipo_vehiculo
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?`,
    [inicio, fin]
  );

  const totalIngresos = ordenesPagadas.reduce((suma, o) => suma + Number(o.pago_monto || o.total), 0);
  const ordenIds = ordenesPagadas.map(o => o.id);

  let totalComisionesLavadores = 0;
  const lavadoresStats = {};
  if (ordenIds.length > 0) {
    const [comisiones] = await pool.query(
      `SELECT ol.valor_comision, l.nombre
       FROM orden_lavadores ol
       INNER JOIN lavadores l ON l.id = ol.lavador_id
       WHERE ol.orden_id IN (?)`,
      [ordenIds]
    );
    comisiones.forEach(c => {
      totalComisionesLavadores += Number(c.valor_comision);
      if (!lavadoresStats[c.nombre]) lavadoresStats[c.nombre] = { servicios: 0, comision: 0 };
      lavadoresStats[c.nombre].servicios += 1;
      lavadoresStats[c.nombre].comision += Number(c.valor_comision);
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

  const distribucionVehiculos = {};
  const serviciosStats = {};
  ordenesPagadas.forEach(o => {
    const tipo = o.tipo_vehiculo || 'carro';
    distribucionVehiculos[tipo] = (distribucionVehiculos[tipo] || 0) + 1;

    const nombreServicio = o.servicio_nombre || 'Otros';
    if (!serviciosStats[nombreServicio]) serviciosStats[nombreServicio] = { count: 0, total: 0 };
    serviciosStats[nombreServicio].count += 1;
    serviciosStats[nombreServicio].total += Number(o.pago_monto || o.total);
  });

  const alertasStock = await InsumoRepositorio.listarAlertasStockBajo();
  const auditoriaReciente = await AuditoriaRepositorio.obtenerRecientes(8);

  return {
    rango: { inicio, fin },
    totalIngresos, totalComisionesLavadores, costoInsumos, totalGastos, gananciaNeta, margenPorcentaje,
    serviciosAtendidos: ordenesPagadas.length,
    distribucionVehiculos, serviciosStats, lavadoresStats,
    alertasStockCount: alertasStock.length, auditoriaReciente
  };
}

/** Ventas: por servicio, por método de pago, por vehículo, top clientes y ticket promedio. */
async function calcularReporteVentas(inicio, fin) {
  const [pagos] = await pool.query(
    `SELECT p.metodo_pago, p.monto, s.nombre AS servicio_nombre,
            COALESCE(v.tipo, o.tipo_vehiculo_anonimo, 'carro') AS tipo_vehiculo
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?`,
    [inicio, fin]
  );

  const porServicio = {};
  const porMetodoPago = {};
  const porVehiculo = {};
  let total = 0;
  pagos.forEach(p => {
    const monto = Number(p.monto);
    total += monto;
    const servicio = p.servicio_nombre || 'Otros';
    const tipoVeh = p.tipo_vehiculo || 'carro';
    porServicio[servicio] = (porServicio[servicio] || 0) + monto;
    porMetodoPago[p.metodo_pago] = (porMetodoPago[p.metodo_pago] || 0) + monto;
    porVehiculo[tipoVeh] = (porVehiculo[tipoVeh] || 0) + monto;
  });

  const [topClientes] = await pool.query(
    `SELECT cl.nombre, COUNT(*) AS cantidad, SUM(p.monto) AS total
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     INNER JOIN clientes cl ON cl.id = o.cliente_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?
     GROUP BY cl.id ORDER BY total DESC LIMIT 5`,
    [inicio, fin]
  );

  // Ventas atendidas por cada lavador (cuántas órdenes pagadas trabajó y
  // cuánta comisión generó en el período), no solo el total del negocio.
  const [porLavadorFilas] = await pool.query(
    `SELECT l.nombre, COUNT(DISTINCT ol.orden_id) AS servicios, SUM(ol.valor_comision) AS comision
     FROM orden_lavadores ol
     INNER JOIN lavadores l ON l.id = ol.lavador_id
     INNER JOIN pagos p ON p.orden_id = ol.orden_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?
     GROUP BY l.id, l.nombre ORDER BY comision DESC`,
    [inicio, fin]
  );

  return {
    rango: { inicio, fin },
    totalVentas: total,
    cantidadVentas: pagos.length,
    ticketPromedio: pagos.length > 0 ? Math.round(total / pagos.length) : 0,
    porServicio, porMetodoPago, porVehiculo,
    porLavador: porLavadorFilas.map(f => ({ nombre: f.nombre, servicios: f.servicios, comision: Number(f.comision) || 0 })),
    topClientes: topClientes.map(c => ({ nombre: c.nombre, cantidad: c.cantidad, total: Number(c.total) }))
  };
}

/** Compras: por proveedor, por insumo y total del período (con base en las facturas de compra). */
async function calcularReporteCompras(inicio, fin) {
  const [porProveedorFilas] = await pool.query(
    `SELECT COALESCE(p.nombre, 'Sin proveedor') AS proveedor, COUNT(*) AS cantidad, SUM(f.total) AS total
     FROM facturas f
     LEFT JOIN proveedores p ON p.id = f.proveedor_id
     WHERE f.tipo = 'compra' AND f.fecha BETWEEN ? AND ?
     GROUP BY proveedor ORDER BY total DESC`,
    [inicio, fin]
  );
  const [porInsumoFilas] = await pool.query(
    `SELECT concepto AS insumo, COUNT(*) AS cantidad, SUM(total) AS total
     FROM facturas
     WHERE tipo = 'compra' AND fecha BETWEEN ? AND ?
     GROUP BY concepto ORDER BY total DESC`,
    [inicio, fin]
  );

  const porProveedor = {};
  porProveedorFilas.forEach(f => { porProveedor[f.proveedor] = Number(f.total); });
  const porInsumo = {};
  porInsumoFilas.forEach(f => { porInsumo[f.insumo] = Number(f.total); });

  const totalCompras = porProveedorFilas.reduce((s, f) => s + Number(f.total), 0);

  return { rango: { inicio, fin }, totalCompras, cantidadCompras: porProveedorFilas.reduce((s, f) => s + f.cantidad, 0), porProveedor, porInsumo };
}

/** Inventario: valorización actual del stock y alertas (foto del momento, sin rango de fechas). */
async function calcularReporteInventario() {
  const insumos = await InsumoRepositorio.listarInsumos({ soloActivos: true });
  const valorizacion = insumos.map(i => ({
    nombre: i.nombre,
    unidad_medida: i.unidad_medida,
    stock_actual: Number(i.stock_actual),
    costo_unitario: Number(i.costo_unitario),
    valor: Number(i.stock_actual) * Number(i.costo_unitario),
    bajo_stock: i.bajo_stock
  })).sort((a, b) => b.valor - a.valor);

  const valorTotalInventario = valorizacion.reduce((s, i) => s + i.valor, 0);
  const alertas = valorizacion.filter(i => i.bajo_stock);

  return { valorTotalInventario, insumos: valorizacion, alertas };
}

/** Nómina: salarios y comisiones pagados en el período, más liquidaciones/asistencia. */
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

  return {
    rango: { inicio, fin },
    salariosPagados: Number(salarios[0].total) || 0,
    salariosCantidad: salarios[0].cantidad || 0,
    comisionesPagadas: Number(comisionesPagadas[0].total) || 0,
    comisionesCantidad: comisionesPagadas[0].cantidad || 0,
    liquidacionesPendientesTotal: Number(liquidacionesPendientes[0].total) || 0,
    liquidacionesPendientesCantidad: liquidacionesPendientes[0].cantidad || 0,
    asistenciasPresentes: Number(asistencia[0].presentes) || 0,
    inasistencias: Number(asistencia[0].inasistencias) || 0,
    horasTrabajadasTotal: Number(asistencia[0].horasTotales) || 0,
    porEmpleado: porEmpleado.map(e => ({ id: e.id, nombre: e.nombre, rol: e.rol, total: Number(e.total) || 0, cantidad: e.cantidad })),
    porLavador: porLavador.map(l => ({ id: l.id, nombre: l.nombre, total: Number(l.total) || 0, cantidad: l.cantidad }))
  };
}

/** Comparativo: el período actual contra el período anterior de igual duración. */
async function calcularReporteComparativo(inicio, fin) {
  const anterior = calcularRangoAnterior(inicio, fin);
  const [actual, previo] = await Promise.all([
    calcularReporte(inicio, fin),
    calcularReporte(anterior.inicio, anterior.fin)
  ]);

  const variacion = (actualVal, previoVal) => previoVal > 0 ? Number((((actualVal - previoVal) / previoVal) * 100).toFixed(1)) : null;

  return {
    actual: { rango: actual.rango, totalIngresos: actual.totalIngresos, gananciaNeta: actual.gananciaNeta, serviciosAtendidos: actual.serviciosAtendidos },
    anterior: { rango: previo.rango, totalIngresos: previo.totalIngresos, gananciaNeta: previo.gananciaNeta, serviciosAtendidos: previo.serviciosAtendidos },
    variacionIngresos: variacion(actual.totalIngresos, previo.totalIngresos),
    variacionGanancia: variacion(actual.gananciaNeta, previo.gananciaNeta),
    variacionServicios: variacion(actual.serviciosAtendidos, previo.serviciosAtendidos)
  };
}

/** Operativo: citas por estado y clientes nuevos vs. recurrentes en el período. */
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

  return {
    rango: { inicio, fin },
    porEstadoCitas,
    clientesNuevos: clientesNuevos[0].cantidad || 0,
    clientesRecurrentes: clientesRecurrentes[0].cantidad || 0
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
    `SELECT a.fecha, a.persona_tipo, a.hora_entrada, a.hora_salida, a.horas_trabajadas, a.inasistencia,
            COALESCE(u.nombre, l.nombre) AS nombre
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
    horasTrabajadas: Number(f.horasTrabajadas) || 0
  }));

  return {
    rango: { inicio, fin },
    totalPresentes: porTrabajador.reduce((s, t) => s + t.presentes, 0),
    totalInasistencias: porTrabajador.reduce((s, t) => s + t.inasistencias, 0),
    totalHorasTrabajadas: porTrabajador.reduce((s, t) => s + t.horasTrabajadas, 0),
    porTrabajador,
    detalle: detalleFilas.map(f => ({
      fecha: f.fecha, nombre: f.nombre, tipo: f.persona_tipo,
      horaEntrada: f.hora_entrada, horaSalida: f.hora_salida,
      horasTrabajadas: Number(f.horas_trabajadas) || 0, inasistencia: !!f.inasistencia
    }))
  };
}

// Un cliente sin compras en los últimos 60 días se considera inactivo (foto
// del momento actual, no depende del período de reporte seleccionado).
const DIAS_INACTIVIDAD_CLIENTE = 60;

/** Clientes: activos/inactivos según su última compra (foto del momento, no por período). */
async function calcularReporteClientes() {
  const [filas] = await pool.query(
    `SELECT cl.id, cl.nombre, cl.telefono, cl.correo, cl.creado_en,
            MAX(DATE(p.fecha_pago)) AS ultima_compra,
            COUNT(p.id) AS total_compras,
            SUM(p.monto) AS total_gastado
     FROM clientes cl
     LEFT JOIN ordenes_servicio o ON o.cliente_id = cl.id
     LEFT JOIN pagos p ON p.orden_id = o.id
     GROUP BY cl.id, cl.nombre, cl.telefono, cl.correo, cl.creado_en
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
      ultimaCompra: f.ultima_compra,
      totalCompras: f.total_compras || 0,
      totalGastado: Number(f.total_gastado) || 0,
      estado
    };
  });

  return {
    diasInactividad: DIAS_INACTIVIDAD_CLIENTE,
    totalClientes: clientes.length,
    activos: clientes.filter((c) => c.estado === 'activo').length,
    inactivos: clientes.filter((c) => c.estado === 'inactivo').length,
    nuncaCompraron: clientes.filter((c) => c.estado === 'nunca_compro').length,
    clientes
  };
}

module.exports = {
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
