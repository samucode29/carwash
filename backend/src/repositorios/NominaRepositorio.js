/**
 * Acceso a datos de nómina: comisiones de lavadores y salarios fijos de
 * empleados/administradores (CU21-CU26 / RF22, RF25, RF30-RF34).
 */
const { pool } = require('../config/baseDeDatos');
const { obtenerFechaHoy } = require('../utilidades/fechas');
const { calcularValorHora, calcularHorasEsperadasPorPeriodo } = require('../utilidades/jornada');

// ---------------------------------------------------------------------------
// Comisiones de lavadores
// ---------------------------------------------------------------------------
async function resumenComisionesLavadores() {
  const [lavadores] = await pool.query(`SELECT * FROM lavadores ORDER BY nombre`);

  const [comisionesPorOrden] = await pool.query(
    `SELECT ol.lavador_id, ol.valor_comision, ol.orden_id
     FROM orden_lavadores ol
     WHERE EXISTS(SELECT 1 FROM pagos p WHERE p.orden_id = ol.orden_id)`
  );

  const [liquidacionesPagadas] = await pool.query(
    `SELECT lavador_id, SUM(total_comision) AS total FROM liquidaciones_lavador WHERE estado = 'pagado' GROUP BY lavador_id`
  );
  const [liquidacionesPendientesPeriodos] = await pool.query(
    `SELECT lavador_id, periodo_inicio, periodo_fin FROM liquidaciones_lavador`
  );

  return lavadores.map(lavador => {
    const comisionesDeEsteLavador = comisionesPorOrden.filter(c => c.lavador_id === lavador.id);
    const comisionTotalHistorica = comisionesDeEsteLavador.reduce((suma, c) => suma + Number(c.valor_comision), 0);
    const comisionPagada = (liquidacionesPagadas.find(l => l.lavador_id === lavador.id) || {}).total || 0;
    const comisionPendiente = Math.max(0, comisionTotalHistorica - Number(comisionPagada));

    return {
      lavador_id: lavador.id,
      nombre: lavador.nombre,
      documento: lavador.documento,
      telefono: lavador.telefono,
      estado: lavador.estado,
      porcentaje_comision: lavador.porcentaje_comision,
      servicios_realizados: comisionesDeEsteLavador.length,
      comision_historica_total: comisionTotalHistorica,
      comision_pagada: Number(comisionPagada),
      comision_pendiente: comisionPendiente
    };
  });
}

async function crearLiquidacion({ lavadorId, periodoInicio, periodoFin, totalComision, descuentos }) {
  const valorAPagar = Math.max(0, totalComision - descuentos);
  const [resultado] = await pool.query(
    `INSERT INTO liquidaciones_lavador (lavador_id, periodo_inicio, periodo_fin, total_comision, descuentos, valor_a_pagar, estado)
     VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`,
    [lavadorId, periodoInicio, periodoFin, totalComision, descuentos, valorAPagar]
  );
  const [filas] = await pool.query(`SELECT * FROM liquidaciones_lavador WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function pagarLiquidacion({ liquidacionId, soportePagoNombre, soportePagoTipo, soportePagoDatos, fechaPago }) {
  const [filas] = await pool.query(`SELECT * FROM liquidaciones_lavador WHERE id = ?`, [liquidacionId]);
  const liquidacion = filas[0];
  if (!liquidacion) return null;

  await pool.query(
    `UPDATE liquidaciones_lavador
     SET estado = 'pagado', fecha_pago = ?, soporte_pago_url = ?, soporte_pago_nombre = ?, soporte_pago_tipo = ?, soporte_pago_datos = ?
     WHERE id = ?`,
    [fechaPago, soportePagoNombre, soportePagoNombre, soportePagoTipo, soportePagoDatos, liquidacionId]
  );
  const [actualizada] = await pool.query(
    `SELECT liq.*, l.nombre AS lavador_nombre
     FROM liquidaciones_lavador liq
     LEFT JOIN lavadores l ON l.id = liq.lavador_id
     WHERE liq.id = ?`,
    [liquidacionId]
  );
  return actualizada[0];
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
  const [pagos] = await pool.query(`SELECT * FROM pagos_salario ORDER BY creado_en ASC`);

  return empleados.map(emp => {
    const pagosDelEmpleado = pagos.filter(p => p.empleado_id === emp.id);
    return {
      empleado_id: emp.id,
      nombre: emp.nombre,
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
      estado: emp.estado || 'activo',
      ultimo_pago: pagosDelEmpleado[pagosDelEmpleado.length - 1] || null
    };
  });
}

async function crearPagoSalario({ empleadoId, periodicidad, periodoInicio, periodoFin, salarioBase, descuentos, soportePagoNombre, soportePagoTipo, soportePagoDatos, fechaPago }) {
  const valorAPagar = Math.max(0, salarioBase - descuentos);
  const hoy = fechaPago || obtenerFechaHoy();

  const [resultado] = await pool.query(
    `INSERT INTO pagos_salario
      (empleado_id, periodicidad, periodo_inicio, periodo_fin, salario_base, descuentos, valor_a_pagar, estado, fecha_pago_real, soporte_pago_url, soporte_pago_nombre, soporte_pago_tipo, soporte_pago_datos)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pagado', ?, ?, ?, ?, ?)`,
    [empleadoId, periodicidad, periodoInicio, periodoFin, salarioBase, descuentos, valorAPagar, hoy, soportePagoNombre, soportePagoNombre, soportePagoTipo, soportePagoDatos]
  );
  const [filas] = await pool.query(
    `SELECT ps.*, u.nombre AS empleado_nombre
     FROM pagos_salario ps
     LEFT JOIN usuarios u ON u.id = ps.empleado_id
     WHERE ps.id = ?`,
    [resultado.insertId]
  );
  return filas[0];
}

/**
 * El pago no es el salario fijo completo sin importar nada: se calcula un
 * valor-hora (salario_fijo entre las horas esperadas de la jornada) y se
 * multiplica por las horas realmente trabajadas (asistencia) en el rango.
 */
async function calcularPagoEmpleado(empleadoId, periodoInicio, periodoFin) {
  const [empFilas] = await pool.query(`SELECT * FROM usuarios WHERE id = ?`, [empleadoId]);
  const emp = empFilas[0];
  if (!emp) return null;

  const [asistFilas] = await pool.query(
    `SELECT SUM(horas_trabajadas) AS horas,
            SUM(CASE WHEN inasistencia = FALSE THEN 1 ELSE 0 END) AS presentes,
            SUM(CASE WHEN inasistencia = TRUE THEN 1 ELSE 0 END) AS inasistencias
     FROM asistencia WHERE persona_tipo = 'usuario' AND persona_id = ? AND fecha BETWEEN ? AND ?`,
    [empleadoId, periodoInicio, periodoFin]
  );

  const valorHora = calcularValorHora(emp.salario_fijo, emp.jornada_horas_dia, emp.dias_descanso_semana, emp.periodicidad_pago);
  const horasEsperadasPeriodo = calcularHorasEsperadasPorPeriodo(emp.jornada_horas_dia, emp.dias_descanso_semana, emp.periodicidad_pago);
  const horasTrabajadas = Number(asistFilas[0].horas) || 0;

  return {
    empleadoId,
    salarioFijo: Number(emp.salario_fijo) || 0,
    jornadaHorasDia: Number(emp.jornada_horas_dia),
    diasDescansoSemana: emp.dias_descanso_semana,
    periodicidadPago: emp.periodicidad_pago,
    valorHora,
    horasEsperadasPeriodo,
    horasTrabajadas,
    diasPresentes: Number(asistFilas[0].presentes) || 0,
    inasistencias: Number(asistFilas[0].inasistencias) || 0,
    montoCalculado: Number((valorHora * horasTrabajadas).toFixed(2))
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
  crearLiquidacion,
  pagarLiquidacion,
  listarLiquidaciones,
  obtenerSoporteLiquidacion,
  listarEmpleadosConUltimoPago,
  calcularPagoEmpleado,
  crearPagoSalario,
  listarPagosSalario,
  obtenerSoportePagoSalario
};
