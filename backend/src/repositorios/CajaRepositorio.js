/**
 * Acceso a datos de pagos de órdenes y cierres de caja diarios
 * (CU10, CU20, CU21 / RF11, RF12, RF22).
 */
const { pool } = require('../config/baseDeDatos');

async function registrarPago({ ordenId, metodoPago, monto }) {
  const [resultado] = await pool.query(
    `INSERT INTO pagos (orden_id, metodo_pago, monto, estado) VALUES (?, ?, ?, 'confirmado')`,
    [ordenId, metodoPago, monto]
  );
  await pool.query(
    `UPDATE ordenes_servicio SET estado = 'entregado', fecha_hora_entrega = NOW() WHERE id = ? AND estado != 'entregado'`,
    [ordenId]
  );
  const [filas] = await pool.query(`SELECT * FROM pagos WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function obtenerResumenPorFecha(fecha) {
  const [filas] = await pool.query(
    `SELECT p.metodo_pago, SUM(p.monto) AS total, COUNT(*) AS cantidad
     FROM pagos p
     WHERE DATE(p.fecha_pago) = ?
     GROUP BY p.metodo_pago`,
    [fecha]
  );

  const resumen = { total_efectivo: 0, total_tarjeta: 0, total_transferencia: 0, total_pse: 0, ordenes_count: 0 };
  const mapaColumnas = { efectivo: 'total_efectivo', tarjeta: 'total_tarjeta', transferencia: 'total_transferencia', pse: 'total_pse' };

  filas.forEach(fila => {
    const columna = mapaColumnas[fila.metodo_pago];
    if (columna) resumen[columna] = Number(fila.total);
    resumen.ordenes_count += fila.cantidad;
  });
  resumen.total_general = resumen.total_efectivo + resumen.total_tarjeta + resumen.total_transferencia + resumen.total_pse;
  return resumen;
}

async function obtenerCierrePorFecha(fecha) {
  const [filas] = await pool.query(`SELECT * FROM cierres_caja WHERE fecha = ?`, [fecha]);
  return filas[0] || null;
}

async function crearCierre({ fecha, usuarioId, resumen, observaciones }) {
  const [resultado] = await pool.query(
    `INSERT INTO cierres_caja
      (fecha, usuario_id, total_efectivo, total_tarjeta, total_transferencia, total_pse, total_general, observaciones)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [fecha, usuarioId, resumen.total_efectivo, resumen.total_tarjeta, resumen.total_transferencia, resumen.total_pse, resumen.total_general, observaciones || '']
  );
  const [filas] = await pool.query(`SELECT * FROM cierres_caja WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function listarHistorialCierres() {
  const [filas] = await pool.query(
    `SELECT c.*, u.nombre AS usuario_nombre
     FROM cierres_caja c
     LEFT JOIN usuarios u ON u.id = c.usuario_id
     ORDER BY c.fecha DESC`
  );
  return filas;
}

module.exports = { registrarPago, obtenerResumenPorFecha, obtenerCierrePorFecha, crearCierre, listarHistorialCierres };
