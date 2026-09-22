/** Acceso a datos de gastos operativos del lavadero. */
const { pool } = require('../config/baseDeDatos');

async function listar() {
  const [filas] = await pool.query(`SELECT * FROM gastos_operativos ORDER BY fecha DESC, id DESC`);
  return filas;
}

async function crear({ concepto, monto, fecha, usuarioId }) {
  const [resultado] = await pool.query(
    `INSERT INTO gastos_operativos (concepto, monto, fecha, usuario_id) VALUES (?, ?, ?, ?)`,
    [concepto, monto, fecha, usuarioId]
  );
  const [filas] = await pool.query(`SELECT * FROM gastos_operativos WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function listarPorRango(inicio, fin) {
  const [filas] = await pool.query(`SELECT * FROM gastos_operativos WHERE fecha BETWEEN ? AND ?`, [inicio, fin]);
  return filas;
}

module.exports = { listar, crear, listarPorRango };
