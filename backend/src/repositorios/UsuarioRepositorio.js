/**
 * Acceso a datos de la tabla `usuarios` (cuentas con inicio de sesión:
 * administrador o empleado). No contiene lógica de negocio ni de HTTP,
 * solo consultas SQL, para que los controladores queden simples de leer.
 */
const { pool } = require('../config/baseDeDatos');

const COLUMNAS_PUBLICAS = `
  id, nombre, nombres, apellidos, documento, telefono, correo, username, rol, es_admin_principal, estado,
  fecha_ingreso, salario_fijo, periodicidad_pago, jornada_horas_dia, dias_descanso_semana, lavador_id, creado_en
`;

async function buscarPorUsernameOCorreo(identificador) {
  const [filas] = await pool.query(
    `SELECT * FROM usuarios WHERE username = ? OR correo = ? LIMIT 1`,
    [identificador, identificador]
  );
  return filas[0] || null;
}

async function obtenerPorId(id) {
  const [filas] = await pool.query(`SELECT ${COLUMNAS_PUBLICAS} FROM usuarios WHERE id = ?`, [id]);
  return filas[0] || null;
}

/** Incluye password_hash; solo para verificar la contraseña actual al cambiarla uno mismo. */
async function obtenerConHashPorId(id) {
  const [filas] = await pool.query(`SELECT id, password_hash FROM usuarios WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function obtenerPorDocumento(documento) {
  const [filas] = await pool.query(`SELECT id FROM usuarios WHERE documento = ?`, [documento]);
  return filas[0] || null;
}

async function obtenerPorUsername(username) {
  const [filas] = await pool.query(`SELECT id FROM usuarios WHERE username = ?`, [username]);
  return filas[0] || null;
}

async function listar(rol) {
  if (rol) {
    const [filas] = await pool.query(`SELECT ${COLUMNAS_PUBLICAS} FROM usuarios WHERE rol = ? ORDER BY nombre`, [rol]);
    return filas;
  }
  const [filas] = await pool.query(`SELECT ${COLUMNAS_PUBLICAS} FROM usuarios ORDER BY nombre`);
  return filas;
}

async function crear(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO usuarios
      (nombre, nombres, apellidos, documento, telefono, correo, username, password_hash, rol, estado, fecha_ingreso, salario_fijo, periodicidad_pago, jornada_horas_dia, dias_descanso_semana, lavador_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', CURDATE(), ?, ?, ?, ?, ?)`,
    [
      datos.nombre, datos.nombres, datos.apellidos, datos.documento, datos.telefono || '', datos.correo, datos.username,
      datos.passwordHash, datos.rol, datos.salarioFijo || null, datos.periodicidadPago || 'quincenal',
      datos.jornadaHorasDia || 8, datos.diasDescansoSemana ?? 1, datos.lavadorId || null
    ]
  );
  return obtenerPorId(resultado.insertId);
}

/** Cuenta de acceso al sistema que tiene un lavador, si la tiene. */
async function obtenerCuentaDeLavador(lavadorId) {
  const [filas] = await pool.query(`SELECT id, username, estado FROM usuarios WHERE lavador_id = ? LIMIT 1`, [lavadorId]);
  return filas[0] || null;
}

/** Si el lavador se inactiva, su acceso al sistema también (no queda un acceso abierto). */
async function inactivarCuentaDeLavador(lavadorId) {
  const [resultado] = await pool.query(`UPDATE usuarios SET estado = 'inactivo' WHERE lavador_id = ? AND estado = 'activo'`, [lavadorId]);
  return resultado.affectedRows;
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
  await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerPorId(id);
}

module.exports = {
  buscarPorUsernameOCorreo,
  obtenerPorId,
  obtenerConHashPorId,
  obtenerPorDocumento,
  obtenerPorUsername,
  obtenerCuentaDeLavador,
  inactivarCuentaDeLavador,
  listar,
  crear,
  actualizar
};
