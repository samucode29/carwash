/**
 * Acceso a datos del catálogo de servicios y su consumo estándar de insumos
 * (CU12 / RF16).
 */
const { pool } = require('../config/baseDeDatos');

async function listarConInsumos() {
  const [servicios] = await pool.query(`SELECT * FROM servicios ORDER BY tipo_vehiculo, nombre`);
  const [insumosConsumo] = await pool.query(
    `SELECT si.servicio_id, si.insumo_id, si.cantidad_consumida, i.nombre AS nombre_insumo, i.unidad_medida
     FROM servicio_insumos si
     INNER JOIN insumos i ON i.id = si.insumo_id`
  );

  return servicios.map(servicio => ({
    ...servicio,
    insumos_consumo: insumosConsumo.filter(i => i.servicio_id === servicio.id)
  }));
}

async function obtenerPorId(id) {
  const [filas] = await pool.query(`SELECT * FROM servicios WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function obtenerConsumoInsumos(servicioId) {
  const [filas] = await pool.query(`SELECT * FROM servicio_insumos WHERE servicio_id = ?`, [servicioId]);
  return filas;
}

async function crear(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO servicios (nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min, activo)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [datos.nombre, datos.tipoVehiculo, datos.descripcion || '', datos.precio, datos.duracionEstimadaMin || 30]
  );
  const servicioId = resultado.insertId;

  if (Array.isArray(datos.insumosConsumo)) {
    await reemplazarConsumoInsumos(servicioId, datos.insumosConsumo);
  }
  return obtenerPorId(servicioId);
}

async function actualizar(id, cambios, insumosConsumo) {
  const campos = [];
  const valores = [];
  for (const [columna, valor] of Object.entries(cambios)) {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  }
  if (campos.length > 0) {
    valores.push(id);
    await pool.query(`UPDATE servicios SET ${campos.join(', ')} WHERE id = ?`, valores);
  }

  if (Array.isArray(insumosConsumo)) {
    await reemplazarConsumoInsumos(id, insumosConsumo);
  }
  return obtenerPorId(id);
}

async function reemplazarConsumoInsumos(servicioId, insumosConsumo) {
  await pool.query(`DELETE FROM servicio_insumos WHERE servicio_id = ?`, [servicioId]);
  for (const item of insumosConsumo) {
    await pool.query(
      `INSERT INTO servicio_insumos (servicio_id, insumo_id, cantidad_consumida) VALUES (?, ?, ?)`,
      [servicioId, item.insumo_id, item.cantidad]
    );
  }
}

module.exports = { listarConInsumos, obtenerPorId, obtenerConsumoInsumos, crear, actualizar };
