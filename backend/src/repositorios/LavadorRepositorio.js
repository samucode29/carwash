/**
 * Acceso a datos de la tabla `lavadores` (personal operativo sin login,
 * remunerado por comisión sobre cada servicio que realiza).
 */
const { pool } = require('../config/baseDeDatos');

async function listar({ soloActivos } = {}) {
  const condicion = soloActivos ? `WHERE estado = 'activo'` : '';
  const [filas] = await pool.query(`SELECT * FROM lavadores ${condicion} ORDER BY nombre`);
  return filas;
}

async function obtenerPorId(id) {
  const [filas] = await pool.query(`SELECT * FROM lavadores WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function obtenerActivoPorId(id) {
  const [filas] = await pool.query(`SELECT * FROM lavadores WHERE id = ? AND estado = 'activo'`, [id]);
  return filas[0] || null;
}

async function obtenerPorDocumento(documento) {
  const [filas] = await pool.query(`SELECT id FROM lavadores WHERE documento = ?`, [documento]);
  return filas[0] || null;
}

async function crear(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO lavadores (nombre, documento, telefono, estado, fecha_ingreso, porcentaje_comision, creado_por)
     VALUES (?, ?, ?, 'activo', CURDATE(), ?, ?)`,
    [datos.nombre, datos.documento, datos.telefono || '', datos.porcentajeComision || 60.0, datos.creadoPor]
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
  await pool.query(`UPDATE lavadores SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerPorId(id);
}

/**
 * IDs de lavadores activos que en este momento tienen al menos una orden
 * "en_proceso" (se usan para el algoritmo de asignación automática, que
 * prioriza lavadores libres).
 */
async function obtenerIdsOcupados() {
  const [filas] = await pool.query(
    `SELECT DISTINCT ol.lavador_id
     FROM orden_lavadores ol
     INNER JOIN ordenes_servicio o ON o.id = ol.orden_id
     WHERE o.estado = 'en_proceso'`
  );
  return filas.map(f => f.lavador_id);
}

module.exports = {
  listar,
  obtenerPorId,
  obtenerActivoPorId,
  obtenerPorDocumento,
  crear,
  actualizar,
  obtenerIdsOcupados
};
