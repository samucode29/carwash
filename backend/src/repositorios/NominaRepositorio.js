/**
 * Acceso a datos de nómina: comisiones de lavadores y salarios fijos de
 * empleados/administradores (CU21-CU26 / RF22, RF25, RF30-RF34).
 */
const { pool } = require('../config/baseDeDatos');
const { obtenerFechaHoy } = require('../utilidades/fechas');
const { calcularValorHora, calcularHorasEsperadasPorPeriodo, calcularHorasEsperadasSemana } = require('../utilidades/jornada');

// ---------------------------------------------------------------------------
// Comisiones de lavadores
// ---------------------------------------------------------------------------
async function resumenComisionesLavadores() {
  const [lavadores] = await pool.query(`SELECT * FROM lavadores ORDER BY nombre`);
  const [accesos] = await pool.query(`SELECT lavador_id, username, estado FROM usuarios WHERE lavador_id IS NOT NULL`);

  const [comisionesPorOrden] = await pool.query(
    `SELECT ol.lavador_id, ol.valor_comision, ol.orden_id
     FROM orden_lavadores ol
     WHERE EXISTS(SELECT 1 FROM pagos p WHERE p.orden_id = ol.orden_id)`
  );

  const [liquidacionesPagadas] = await pool.query(
    `SELECT lavador_id, SUM(total_comision) AS total FROM liquidaciones_lavador WHERE estado = 'pagado' GROUP BY lavador_id`
  );

  // Descuentos que le tocó asumir al trabajador (ej. cliente no pagó por su
  // culpa): quedan en pagos.descuento_trabajador por orden y se reparten
  // proporcionalmente entre los lavadores de esa orden según su parte de la
  // comisión (lo normal es que haya uno solo). Esto reduce lo pendiente por
  // pagarle, pero el registro original del servicio (valor_comision) no se
  // toca — ver pagos.descuento_trabajador en el esquema.
  const [descuentosPorOrden] = await pool.query(
    `SELECT orden_id, descuento_trabajador AS total FROM pagos WHERE descuento_trabajador > 0`
  );
  const descuentoPorOrdenMap = {};
  descuentosPorOrden.forEach(d => { descuentoPorOrdenMap[d.orden_id] = Number(d.total); });

  const comisionPorOrdenAgrupada = {};
  comisionesPorOrden.forEach(c => {
    if (!comisionPorOrdenAgrupada[c.orden_id]) comisionPorOrdenAgrupada[c.orden_id] = [];
    comisionPorOrdenAgrupada[c.orden_id].push(c);
  });

  const descuentoTrabajadorPorLavador = {};
  Object.entries(comisionPorOrdenAgrupada).forEach(([ordenId, filas]) => {
    const descuentoOrden = descuentoPorOrdenMap[ordenId];
    if (!descuentoOrden) return;
    const totalComisionOrden = filas.reduce((s, f) => s + Number(f.valor_comision), 0);
    if (totalComisionOrden <= 0) return;
    filas.forEach(f => {
      const parte = (Number(f.valor_comision) / totalComisionOrden) * descuentoOrden;
      descuentoTrabajadorPorLavador[f.lavador_id] = (descuentoTrabajadorPorLavador[f.lavador_id] || 0) + parte;
    });
  });

  // Propinas: son 100% del lavador (nunca del negocio), y si atendieron
  // varios se reparten en partes IGUALES entre ellos (no según su % de
  // comisión, como los descuentos): una propina es "para quien atendió",
  // no proporcional a cuánto gana cada uno. Se suman a lo pendiente por
  // pagarle, junto con su comisión.
  const [propinasPorOrden] = await pool.query(`SELECT orden_id, propina AS total FROM pagos WHERE propina > 0`);
  const propinaPorOrdenMap = {};
  propinasPorOrden.forEach(p => { propinaPorOrdenMap[p.orden_id] = Number(p.total); });

  const propinaPorLavador = {};
  Object.entries(comisionPorOrdenAgrupada).forEach(([ordenId, filas]) => {
    const propinaOrden = propinaPorOrdenMap[ordenId];
    if (!propinaOrden) return;
    const parteIgual = propinaOrden / filas.length;
    filas.forEach(f => {
      propinaPorLavador[f.lavador_id] = (propinaPorLavador[f.lavador_id] || 0) + parteIgual;
    });
  });

  return lavadores.map(lavador => {
    const comisionesDeEsteLavador = comisionesPorOrden.filter(c => c.lavador_id === lavador.id);
    const comisionTotalHistorica = comisionesDeEsteLavador.reduce((suma, c) => suma + Number(c.valor_comision), 0);
    const descuentoTrabajadorTotal = Number((descuentoTrabajadorPorLavador[lavador.id] || 0).toFixed(2));
    const propinaTotal = Number((propinaPorLavador[lavador.id] || 0).toFixed(2));
    const comisionPagada = (liquidacionesPagadas.find(l => l.lavador_id === lavador.id) || {}).total || 0;
    const comisionPendiente = Math.max(0, comisionTotalHistorica + propinaTotal - descuentoTrabajadorTotal - Number(comisionPagada));

    return {
      lavador_id: lavador.id,
      nombre: lavador.nombre,
      nombres: lavador.nombres,
      apellidos: lavador.apellidos,
      documento: lavador.documento,
      telefono: lavador.telefono,
      estado: lavador.estado,
      porcentaje_comision: lavador.porcentaje_comision,
      usuario_acceso: (accesos.find(a => a.lavador_id === lavador.id) || {}).username || null,
      servicios_realizados: comisionesDeEsteLavador.length,
      comision_historica_total: comisionTotalHistorica,
      descuento_trabajador_total: descuentoTrabajadorTotal,
      propina_total: propinaTotal,
      comision_pagada: Number(comisionPagada),
      comision_pendiente: comisionPendiente
    };
  });
}

/**
 * Historial de servicios de un lavador, más reciente primero: de qué
 * cliente es, qué servicio, cuánto valía, su comisión, la propina que le
 * tocó, el descuento aplicado (parte negocio / parte trabajador) y la
 * observación escrita al cobrar. Solo incluye órdenes ya cobradas (tienen
 * pago): antes de eso no hay nada que liquidar.
 */
async function obtenerServiciosPorLavador(lavadorId) {
  const [filas] = await pool.query(
    `SELECT o.id AS orden_id, o.fecha_hora_registro AS fecha, s.nombre AS servicio_nombre,
            o.total AS valor_servicio, o.es_venta_anonima, cl.nombre AS cliente_nombre,
            ol.valor_comision AS comision_bruta,
            p.descuento_negocio, p.descuento_trabajador, p.propina, p.observacion,
            (SELECT SUM(ol2.valor_comision) FROM orden_lavadores ol2 WHERE ol2.orden_id = o.id) AS comision_total_orden,
            (SELECT COUNT(*) FROM orden_lavadores ol3 WHERE ol3.orden_id = o.id) AS lavadores_count
     FROM orden_lavadores ol
     INNER JOIN ordenes_servicio o ON o.id = ol.orden_id
     INNER JOIN pagos p ON p.orden_id = o.id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN clientes cl ON cl.id = o.cliente_id
     WHERE ol.lavador_id = ?
     ORDER BY o.fecha_hora_registro DESC`,
    [lavadorId]
  );

  return filas.map(f => {
    const comisionTotalOrden = Number(f.comision_total_orden) || 0;
    const comisionBruta = Number(f.comision_bruta);
    const participacion = comisionTotalOrden > 0 ? comisionBruta / comisionTotalOrden : 1;
    const descuentoNegocioParte = Number(f.descuento_negocio) * participacion;
    const descuentoTrabajadorParte = Number(f.descuento_trabajador) * participacion;
    // La propina se reparte en partes iguales entre los lavadores de la
    // orden (no proporcional a la comisión, ver resumenComisionesLavadores).
    const propinaParte = Number(f.propina) / (Number(f.lavadores_count) || 1);
    return {
      ordenId: f.orden_id,
      fecha: f.fecha,
      cliente: f.cliente_nombre || 'Venta anónima',
      servicio: f.servicio_nombre,
      valorServicio: Number(f.valor_servicio),
      comisionBruta,
      propina: Number(propinaParte.toFixed(2)),
      descuentoNegocio: Number(descuentoNegocioParte.toFixed(2)),
      descuentoTrabajador: Number(descuentoTrabajadorParte.toFixed(2)),
      descuentoTotal: Number((descuentoNegocioParte + descuentoTrabajadorParte).toFixed(2)),
      comisionNeta: Number((comisionBruta - descuentoTrabajadorParte + propinaParte).toFixed(2)),
      observacion: f.observacion || ''
    };
  });
}

const SELECT_LIQUIDACION = `
  SELECT liq.id, liq.lavador_id, liq.periodo_inicio, liq.periodo_fin, liq.total_comision, liq.descuentos,
         liq.valor_a_pagar, liq.estado, liq.fecha_pago, liq.soporte_pago_url, liq.soporte_pago_nombre,
         liq.soporte_pago_tipo, (liq.soporte_pago_datos IS NOT NULL) AS tiene_soporte, liq.creado_en,
         l.nombre AS lavador_nombre, l.documento AS lavador_documento
  FROM liquidaciones_lavador liq
  LEFT JOIN lavadores l ON l.id = liq.lavador_id
  WHERE liq.id = ?`;

/**
 * Se registra directamente como PAGADA: el comprobante se imprime, se firma
 * y se archiva en físico, así que no hay un paso posterior de "adjuntar
 * soporte" que la deje pendiente. Al quedar pagada deja de contar como
 * comisión pendiente del lavador.
 */
async function crearLiquidacion({ lavadorId, periodoInicio, periodoFin, totalComision, descuentos, fechaPago }) {
  const valorAPagar = Math.max(0, totalComision - descuentos);
  const [resultado] = await pool.query(
    `INSERT INTO liquidaciones_lavador (lavador_id, periodo_inicio, periodo_fin, total_comision, descuentos, valor_a_pagar, estado, fecha_pago)
     VALUES (?, ?, ?, ?, ?, ?, 'pagado', ?)`,
    [lavadorId, periodoInicio, periodoFin, totalComision, descuentos, valorAPagar, fechaPago]
  );
  return obtenerLiquidacion(resultado.insertId);
}

async function obtenerLiquidacion(id) {
  const [filas] = await pool.query(SELECT_LIQUIDACION, [id]);
  return filas[0] ? { ...filas[0], tiene_soporte: !!filas[0].tiene_soporte } : null;
}

/** Para liquidaciones antiguas que quedaron pendientes: las marca pagadas. */
async function pagarLiquidacion({ liquidacionId, fechaPago }) {
  const existente = await obtenerLiquidacion(liquidacionId);
  if (!existente) return null;
  await pool.query(
    `UPDATE liquidaciones_lavador SET estado = 'pagado', fecha_pago = ? WHERE id = ?`,
    [fechaPago, liquidacionId]
  );
  return obtenerLiquidacion(liquidacionId);
}

async function listarLiquidaciones() {
  const [filas] = await pool.query(
    `SELECT liq.id, liq.lavador_id, liq.periodo_inicio, liq.periodo_fin, liq.total_comision, liq.descuentos,
            liq.valor_a_pagar, liq.estado, liq.fecha_pago, liq.soporte_pago_url,
            (liq.soporte_pago_datos IS NOT NULL) AS tiene_soporte, liq.creado_en,
            l.nombre AS lavador_nombre, l.documento AS lavador_documento
     FROM liquidaciones_lavador liq
     LEFT JOIN lavadores l ON l.id = liq.lavador_id
     ORDER BY liq.creado_en DESC`
  );
  return filas.map(f => ({ ...f, tiene_soporte: !!f.tiene_soporte }));
}

async function obtenerSoporteLiquidacion(id) {
  const [filas] = await pool.query(
    `SELECT soporte_pago_nombre, soporte_pago_tipo, soporte_pago_datos FROM liquidaciones_lavador WHERE id = ?`,
    [id]
  );
  return filas[0] || null;
}

// ---------------------------------------------------------------------------
// Salarios fijos (empleados y administradores)
// ---------------------------------------------------------------------------
async function listarEmpleadosConUltimoPago() {
  const [empleados] = await pool.query(`SELECT * FROM usuarios ORDER BY nombre`);
  const [lavadoresTodos] = await pool.query(`SELECT id, nombre FROM lavadores`);
  const [pagos] = await pool.query(
    `SELECT id, empleado_id, periodicidad, periodo_inicio, periodo_fin, salario_base, descuentos,
            valor_a_pagar, estado, fecha_pago_real, soporte_pago_url,
            (soporte_pago_datos IS NOT NULL) AS tiene_soporte, creado_en
     FROM pagos_salario ORDER BY creado_en ASC`
  );

  return empleados.map(emp => {
    const pagosDelEmpleado = pagos.filter(p => p.empleado_id === emp.id);
    return {
      empleado_id: emp.id,
      nombre: emp.nombre,
      nombres: emp.nombres,
      apellidos: emp.apellidos,
      rol: emp.rol,
      documento: emp.documento,
      telefono: emp.telefono || '',
      correo: emp.correo || '',
      salario_fijo: emp.salario_fijo || 0,
      periodicidad_pago: emp.periodicidad_pago || 'quincenal',
      jornada_horas_dia: Number(emp.jornada_horas_dia) || 8,
      dias_descanso_semana: emp.dias_descanso_semana ?? 1,
      fecha_ingreso: emp.fecha_ingreso,
      es_admin_principal: !!emp.es_admin_principal,
      username: emp.username,
      // Acceso al sistema de un lavador: no cobra salario ni marca asistencia como empleado (lo suyo son las comisiones).
      lavador_id: emp.lavador_id || null,
      lavador_nombre: emp.lavador_id ? ((lavadoresTodos.find(l => l.id === emp.lavador_id) || {}).nombre || null) : null,
      estado: emp.estado || 'activo',
      ultimo_pago: pagosDelEmpleado[pagosDelEmpleado.length - 1] || null
    };
  });
}

async function crearPagoSalario({ empleadoId, periodicidad, periodoInicio, periodoFin, salarioBase, descuentos, fechaPago }) {
  const valorAPagar = Math.max(0, salarioBase - descuentos);
  const hoy = fechaPago || obtenerFechaHoy();

  const [resultado] = await pool.query(
    `INSERT INTO pagos_salario
      (empleado_id, periodicidad, periodo_inicio, periodo_fin, salario_base, descuentos, valor_a_pagar, estado, fecha_pago_real)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pagado', ?)`,
    [empleadoId, periodicidad, periodoInicio, periodoFin, salarioBase, descuentos, valorAPagar, hoy]
  );
  return obtenerPagoSalario(resultado.insertId);
}

async function obtenerPagoSalario(id) {
  const [filas] = await pool.query(
    `SELECT ps.id, ps.empleado_id, ps.periodicidad, ps.periodo_inicio, ps.periodo_fin, ps.salario_base,
            ps.descuentos, ps.valor_a_pagar, ps.estado, ps.fecha_pago_real, ps.soporte_pago_url,
            ps.soporte_pago_nombre, ps.soporte_pago_tipo,
            (ps.soporte_pago_datos IS NOT NULL) AS tiene_soporte, ps.creado_en,
            u.nombre AS empleado_nombre, u.documento AS empleado_documento
     FROM pagos_salario ps
     LEFT JOIN usuarios u ON u.id = ps.empleado_id
     WHERE ps.id = ?`,
    [id]
  );
  return filas[0] ? { ...filas[0], tiene_soporte: !!filas[0].tiene_soporte } : null;
}

/**
 * El pago no es el salario fijo completo sin importar nada: se calcula un
 * valor-hora (salario_fijo entre las horas esperadas de la jornada) y se
 * multiplica por las horas realmente trabajadas (asistencia) en el rango.
 * Las horas que en una misma semana calendario (lunes a domingo) excedan la
 * jornada semanal esperada del empleado se pagan al doble del valor-hora.
 */
async function calcularPagoEmpleado(empleadoId, periodoInicio, periodoFin) {
  const [empFilas] = await pool.query(`SELECT * FROM usuarios WHERE id = ?`, [empleadoId]);
  const emp = empFilas[0];
  if (!emp) return null;

  const [resumenFilas] = await pool.query(
    `SELECT SUM(CASE WHEN inasistencia = FALSE THEN 1 ELSE 0 END) AS presentes,
            SUM(CASE WHEN inasistencia = TRUE THEN 1 ELSE 0 END) AS inasistencias
     FROM asistencia WHERE persona_tipo = 'usuario' AND persona_id = ? AND fecha BETWEEN ? AND ?`,
    [empleadoId, periodoInicio, periodoFin]
  );

  const [semanas] = await pool.query(
    `SELECT YEARWEEK(fecha, 3) AS semana, MIN(fecha) AS desde, MAX(fecha) AS hasta, SUM(horas_trabajadas) AS horas
     FROM asistencia
     WHERE persona_tipo = 'usuario' AND persona_id = ? AND fecha BETWEEN ? AND ?
     GROUP BY YEARWEEK(fecha, 3)
     ORDER BY semana`,
    [empleadoId, periodoInicio, periodoFin]
  );

  const valorHora = calcularValorHora(emp.salario_fijo, emp.jornada_horas_dia, emp.dias_descanso_semana, emp.periodicidad_pago);
  const horasEsperadasPeriodo = calcularHorasEsperadasPorPeriodo(emp.jornada_horas_dia, emp.dias_descanso_semana, emp.periodicidad_pago);
  const horasEsperadasSemana = calcularHorasEsperadasSemana(emp.jornada_horas_dia, emp.dias_descanso_semana);

  let horasNormales = 0;
  let horasExtra = 0;
  const desgloseSemanas = semanas.map((s) => {
    const horasSemana = Number(s.horas) || 0;
    const normales = Math.min(horasSemana, horasEsperadasSemana);
    const extra = Math.max(0, horasSemana - horasEsperadasSemana);
    horasNormales += normales;
    horasExtra += extra;
    return {
      desde: s.desde,
      hasta: s.hasta,
      horas: Number(horasSemana.toFixed(2)),
      horasNormales: Number(normales.toFixed(2)),
      horasExtra: Number(extra.toFixed(2))
    };
  });

  const horasTrabajadas = Number((horasNormales + horasExtra).toFixed(2));
  const montoNormal = Number((valorHora * horasNormales).toFixed(2));
  const montoExtra = Number((valorHora * 2 * horasExtra).toFixed(2));

  return {
    empleadoId,
    salarioFijo: Number(emp.salario_fijo) || 0,
    jornadaHorasDia: Number(emp.jornada_horas_dia),
    diasDescansoSemana: emp.dias_descanso_semana,
    periodicidadPago: emp.periodicidad_pago,
    valorHora,
    valorHoraExtra: Number((valorHora * 2).toFixed(2)),
    horasEsperadasPeriodo,
    horasEsperadasSemana,
    horasTrabajadas,
    horasNormales: Number(horasNormales.toFixed(2)),
    horasExtra: Number(horasExtra.toFixed(2)),
    montoNormal,
    montoExtra,
    desgloseSemanas,
    diasPresentes: Number(resumenFilas[0].presentes) || 0,
    inasistencias: Number(resumenFilas[0].inasistencias) || 0,
    montoCalculado: Number((montoNormal + montoExtra).toFixed(2))
  };
}

async function listarPagosSalario() {
  const [filas] = await pool.query(
    `SELECT ps.id, ps.empleado_id, ps.periodicidad, ps.periodo_inicio, ps.periodo_fin, ps.salario_base, ps.descuentos,
            ps.valor_a_pagar, ps.estado, ps.fecha_pago_real, ps.soporte_pago_url,
            (ps.soporte_pago_datos IS NOT NULL) AS tiene_soporte, ps.creado_en,
            u.nombre AS empleado_nombre, u.documento AS empleado_documento
     FROM pagos_salario ps
     LEFT JOIN usuarios u ON u.id = ps.empleado_id
     ORDER BY ps.creado_en DESC`
  );
  return filas.map(f => ({ ...f, tiene_soporte: !!f.tiene_soporte }));
}

async function obtenerSoportePagoSalario(id) {
  const [filas] = await pool.query(
    `SELECT soporte_pago_nombre, soporte_pago_tipo, soporte_pago_datos FROM pagos_salario WHERE id = ?`,
    [id]
  );
  return filas[0] || null;
}

module.exports = {
  resumenComisionesLavadores,
  obtenerServiciosPorLavador,
  crearLiquidacion,
  obtenerLiquidacion,
  pagarLiquidacion,
  listarLiquidaciones,
  obtenerSoporteLiquidacion,
  listarEmpleadosConUltimoPago,
  calcularPagoEmpleado,
  crearPagoSalario,
  obtenerPagoSalario,
  listarPagosSalario,
  obtenerSoportePagoSalario
};
