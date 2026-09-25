/**
 * Catálogo editable de tipos de vehículo (antes fijo a carro/moto por un
 * ENUM). No se eliminan, solo se activan/inactivan, igual que insumos y
 * proveedores, para no romper vehículos/servicios que ya los usan.
 */
const { pool } = require('../config/baseDeDatos');

async function listar({ soloActivos = false } = {}) {
  const [filas] = await pool.query(
    `SELECT * FROM tipos_vehiculo ${soloActivos ? "WHERE estado = 'activo'" : ''} ORDER BY nombre`
  );
  return filas;
}

async function obtenerPorNombre(nombre) {
  const [filas] = await pool.query(`SELECT id FROM tipos_vehiculo WHERE nombre = ?`, [nombre]);
  return filas[0] || null;
}

async function crear(nombre) {
  const [resultado] = await pool.query(
    `INSERT INTO tipos_vehiculo (nombre) VALUES (?)`,
    [nombre]
  );
  const [filas] = await pool.query(`SELECT * FROM tipos_vehiculo WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function actualizarEstado(id, estado) {
  await pool.query(`UPDATE tipos_vehiculo SET estado = ? WHERE id = ?`, [estado, id]);
  const [filas] = await pool.query(`SELECT * FROM tipos_vehiculo WHERE id = ?`, [id]);
  return filas[0] || null;
}

module.exports = { listar, obtenerPorNombre, crear, actualizarEstado };
