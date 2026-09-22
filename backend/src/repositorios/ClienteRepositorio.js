/**
 * Acceso a datos de `clientes` y `vehiculos` (CU01, CU11 / RF01, RF21).
 */
const { pool } = require('../config/baseDeDatos');

async function listarConVehiculos() {
  const [clientes] = await pool.query(`SELECT * FROM clientes ORDER BY nombre`);
  const [vehiculos] = await pool.query(`SELECT * FROM vehiculos`);

  return clientes.map(cliente => ({
    ...cliente,
    vehiculos: vehiculos.filter(v => v.cliente_id === cliente.id)
  }));
}

async function crearCliente(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO clientes (nombre, telefono, correo, creado_por) VALUES (?, ?, ?, ?)`,
    [datos.nombre, datos.telefono, datos.correo || '', datos.creadoPor]
  );
  const [filas] = await pool.query(`SELECT * FROM clientes WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function obtenerVehiculoPorPlaca(placa) {
  const [filas] = await pool.query(`SELECT * FROM vehiculos WHERE placa = ?`, [placa]);
  return filas[0] || null;
}

async function crearVehiculo(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO vehiculos (cliente_id, placa, tipo, marca, color) VALUES (?, ?, ?, ?, ?)`,
    [datos.clienteId || null, datos.placa, datos.tipo, datos.marca || 'Genérica', datos.color || 'No especificado']
  );
  const [filas] = await pool.query(`SELECT * FROM vehiculos WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function obtenerHistorialPorVehiculo(vehiculoId) {
  const [filas] = await pool.query(
    `SELECT o.id AS orden_id, o.fecha_hora_registro AS fecha, s.nombre AS servicio,
            o.total, o.estado, p.metodo_pago, p.monto AS pago_monto, p.fecha_pago
     FROM ordenes_servicio o
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN pagos p ON p.orden_id = o.id
     WHERE o.vehiculo_id = ?
     ORDER BY o.fecha_hora_registro DESC`,
    [vehiculoId]
  );
  return filas;
}

module.exports = {
  listarConVehiculos,
  crearCliente,
  obtenerVehiculoPorPlaca,
  crearVehiculo,
  obtenerHistorialPorVehiculo
};
