/**
 * Acceso a datos de la tabla `usuarios` (cuentas con inicio de sesión:
 * administrador o empleado). No contiene lógica de negocio ni de HTTP,
 * solo consultas SQL, para que los controladores queden simples de leer.
 */
const { pool } = require('../config/baseDeDatos');

const COLUMNAS_PUBLICAS = `
  id, nombre, documento, telefono, correo, username, rol, estado,
  fecha_ingreso, salario_fijo, periodicidad_pago, creado_en
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

async function obtenerPorDocumento(documento) {
  const [filas] = await pool.query(`SELECT id FROM usuarios WHERE documento = ?`, [documento]);
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
      (nombre, documento, telefono, correo, username, password_hash, rol, estado, fecha_ingreso, salario_fijo, periodicidad_pago)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'activo', CURDATE(), ?, ?)`,
    [
      datos.nombre, datos.documento, datos.telefono || '', datos.correo, datos.username,
      datos.passwordHash, datos.rol, datos.salarioFijo || null, datos.periodicidadPago || 'quincenal'
    ]
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
  await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerPorId(id);
}

module.exports = {
  buscarPorUsernameOCorreo,
  obtenerPorId,
  obtenerPorDocumento,
  listar,
  crear,
  actualizar
};
