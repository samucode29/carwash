/**
 * Acceso a datos de nómina: comisiones de lavadores y salarios fijos de
 * empleados/administradores (CU21-CU26 / RF22, RF25, RF30-RF34).
 */
const { pool } = require('../config/baseDeDatos');

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

async function pagarLiquidacion({ liquidacionId, soportePagoUrl, fechaPago }) {
  const [filas] = await pool.query(`SELECT * FROM liquidaciones_lavador WHERE id = ?`, [liquidacionId]);
  const liquidacion = filas[0];
  if (!liquidacion) return null;

  await pool.query(
    `UPDATE liquidaciones_lavador SET estado = 'pagado', fecha_pago = ?, soporte_pago_url = ? WHERE id = ?`,
    [fechaPago, soportePagoUrl, liquidacionId]
  );
  const [actualizada] = await pool.query(`SELECT * FROM liquidaciones_lavador WHERE id = ?`, [liquidacionId]);
  return actualizada[0];
}

async function listarLiquidaciones() {
  const [filas] = await pool.query(
    `SELECT liq.*, l.nombre AS lavador_nombre, l.documento AS lavador_documento
     FROM liquidaciones_lavador liq
     LEFT JOIN lavadores l ON l.id = liq.lavador_id
     ORDER BY liq.creado_en DESC`
  );
  return filas;
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
      salario_fijo: emp.salario_fijo || 0,
      periodicidad_pago: emp.periodicidad_pago || 'quincenal',
      fecha_ingreso: emp.fecha_ingreso,
      ultimo_pago: pagosDelEmpleado[pagosDelEmpleado.length - 1] || null
    };
  });
}

async function crearPagoSalario({ empleadoId, periodicidad, periodoInicio, periodoFin, salarioBase, descuentos, soportePagoUrl }) {
  const valorAPagar = Math.max(0, salarioBase - descuentos);
  const hoy = new Date().toISOString().split('T')[0];

  const [resultado] = await pool.query(
    `INSERT INTO pagos_salario
      (empleado_id, periodicidad, periodo_inicio, periodo_fin, salario_base, descuentos, valor_a_pagar, estado, fecha_pago_real, soporte_pago_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pagado', ?, ?)`,
    [empleadoId, periodicidad, periodoInicio, periodoFin, salarioBase, descuentos, valorAPagar, hoy, soportePagoUrl]
  );
  const [filas] = await pool.query(`SELECT * FROM pagos_salario WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function listarPagosSalario() {
  const [filas] = await pool.query(
    `SELECT ps.*, u.nombre AS empleado_nombre, u.documento AS empleado_documento
     FROM pagos_salario ps
     LEFT JOIN usuarios u ON u.id = ps.empleado_id
     ORDER BY ps.creado_en DESC`
  );
  return filas;
}

module.exports = {
  resumenComisionesLavadores,
  crearLiquidacion,
  pagarLiquidacion,
  listarLiquidaciones,
  listarEmpleadosConUltimoPago,
  crearPagoSalario,
  listarPagosSalario
};
