/**
 * Acceso a datos de la tabla `auditoria`. Registra quién hizo qué y cuándo:
 * inicios de sesión, creación de registros, pagos, cierres de caja, etc.
 */
const { pool } = require('../config/baseDeDatos');

async function registrar(usuarioId, accion, detalle) {
  await pool.query(
    `INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)`,
    [usuarioId || null, accion, detalle]
  );
}

async function obtenerRecientes(limite = 8) {
  const [filas] = await pool.query(
    `SELECT * FROM auditoria ORDER BY fecha DESC, id DESC LIMIT ?`,
    [limite]
  );
  return filas;
}

module.exports = { registrar, obtenerRecientes };
