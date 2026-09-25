/**
 * Acceso a datos del catálogo de servicios (CU12 / RF16). Los insumos se
 * entregan al lavador directamente desde Inventario (entregas periódicas o
 * a demanda cuando se le acaban), no van asociados a un servicio en
 * particular.
 */
const { pool } = require('../config/baseDeDatos');

async function listar({ soloActivos = false } = {}) {
  const [servicios] = await pool.query(
    `SELECT * FROM servicios ${soloActivos ? 'WHERE activo = TRUE' : ''} ORDER BY tipo_vehiculo, nombre`
  );
  return servicios;
}

async function obtenerPorId(id) {
  const [filas] = await pool.query(`SELECT * FROM servicios WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function crear(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO servicios (nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min, activo)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [datos.nombre, datos.tipoVehiculo, datos.descripcion || '', datos.precio, datos.duracionEstimadaMin || 30]
  );
  return obtenerPorId(resultado.insertId);
}

async function actualizar(id, cambios) {
  const campos = [];
  const valores = [];
  for (const [columna, valor] of Object.entries(cambios)) {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  }
  if (campos.length === 0) return obtenerPorId(id);

  valores.push(id);
  await pool.query(`UPDATE servicios SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerPorId(id);
}

module.exports = { listar, obtenerPorId, crear, actualizar };
