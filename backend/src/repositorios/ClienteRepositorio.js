/**
 * Acceso a datos de `clientes` y `vehiculos` (CU01, CU11 / RF01, RF21).
 */
const { pool } = require('../config/baseDeDatos');

async function listarConVehiculos() {
  const [clientes] = await pool.query(`SELECT * FROM clientes ORDER BY nombre`);
  const [vehiculos] = await pool.query(`SELECT * FROM vehiculos`);
  const [notas] = await pool.query(
    `SELECT n.*, u.nombre AS creado_por_nombre FROM cliente_notas n LEFT JOIN usuarios u ON u.id = n.creado_por ORDER BY n.creado_en DESC`
  );

  return clientes.map(cliente => {
    const notasCliente = notas.filter(n => n.cliente_id === cliente.id);
    return {
      ...cliente,
      vehiculos: vehiculos.filter(v => v.cliente_id === cliente.id),
      notas_lista_negra: notasCliente.filter(n => n.tipo === 'lista_negra'),
      notas_preferencia: notasCliente.filter(n => n.tipo === 'preferencia'),
      en_lista_negra: notasCliente.some(n => n.tipo === 'lista_negra')
    };
  });
}

async function crearCliente(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO clientes (nombre, telefono, correo, creado_por) VALUES (?, ?, ?, ?)`,
    [datos.nombre, datos.telefono, datos.correo || '', datos.creadoPor]
  );
  const [filas] = await pool.query(`SELECT * FROM clientes WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

async function obtenerClientePorId(id) {
  const [filas] = await pool.query(`SELECT * FROM clientes WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function actualizarCliente(id, cambios) {
  const campos = [];
  const valores = [];
  for (const [columna, valor] of Object.entries(cambios)) {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  }
  if (campos.length === 0) return obtenerClientePorId(id);

  valores.push(id);
  await pool.query(`UPDATE clientes SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerClientePorId(id);
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

async function actualizarVehiculoCliente(vehiculoId, clienteId) {
  await pool.query(`UPDATE vehiculos SET cliente_id = ? WHERE id = ?`, [clienteId, vehiculoId]);
}

async function agregarNota({ clienteId, tipo, texto, creadoPor }) {
  const [resultado] = await pool.query(
    `INSERT INTO cliente_notas (cliente_id, tipo, texto, creado_por) VALUES (?, ?, ?, ?)`,
    [clienteId, tipo, texto, creadoPor]
  );
  const [filas] = await pool.query(
    `SELECT n.*, u.nombre AS creado_por_nombre FROM cliente_notas n LEFT JOIN usuarios u ON u.id = n.creado_por WHERE n.id = ?`,
    [resultado.insertId]
  );
  return filas[0];
}

async function eliminarNota(id) {
  await pool.query(`DELETE FROM cliente_notas WHERE id = ?`, [id]);
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
  obtenerClientePorId,
  actualizarCliente,
  obtenerVehiculoPorPlaca,
  crearVehiculo,
  actualizarVehiculoCliente,
  agregarNota,
  eliminarNota,
  obtenerHistorialPorVehiculo
};
