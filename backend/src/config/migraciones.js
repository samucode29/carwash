/**
 * Cambios pequeños al esquema que se aplican solos al arrancar el servidor
 * (son idempotentes: si la columna ya existe no hacen nada). Así una base ya
 * desplegada se actualiza sin tener que correr scripts a mano. El modelo
 * completo sigue en database/schema.sql.
 */
const { pool } = require('./baseDeDatos');
const { dividirNombreCompleto, armarNombreCompleto } = require('../utilidades/personas');

async function existeColumna(tabla, columna) {
  const [filas] = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tabla, columna]
  );
  return filas.length > 0;
}

async function existeIndice(tabla, indice) {
  const [filas] = await pool.query(
    `SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [tabla, indice]
  );
  return filas.length > 0;
}

/**
 * Cuentas de administrador adicionales (ver schema.sql, tabla usuarios): una
 * persona ya registrada puede tener además una cuenta de administrador, con
 * el mismo documento, así que el documento deja de ser único por sí solo.
 */
async function permitirCuentasAdicionales() {
  if (!(await existeColumna('usuarios', 'cuenta_adicional'))) {
    await pool.query(`ALTER TABLE usuarios
      ADD COLUMN cuenta_adicional TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN vinculado_tipo ENUM('lavador','empleado') NULL,
      ADD COLUMN vinculado_id INT NULL`);
    console.log('🛠  Migración aplicada: usuarios.cuenta_adicional');
  }
  if (await existeIndice('usuarios', 'documento')) {
    await pool.query(`ALTER TABLE usuarios DROP INDEX documento, ADD UNIQUE KEY uq_usuario_documento (documento, cuenta_adicional)`);
    console.log('🛠  Migración aplicada: documento único por (documento, cuenta_adicional)');
  }
}

async function aplicarMigraciones() {
  // Clientes que se pueden inactivar (sin borrarlos ni perder su historial).
  if (!(await existeColumna('clientes', 'estado'))) {
    await pool.query(`ALTER TABLE clientes ADD COLUMN estado ENUM('activo','inactivo') NOT NULL DEFAULT 'activo'`);
    console.log('🛠  Migración aplicada: clientes.estado');
  }
  await separarNombresYApellidos();
  await permitirCuentasAdicionales();
}

/**
 * Nombre separado en "nombres" y "apellidos" para clientes, empleados y
 * lavadores. A quienes ya estaban registrados se les separa el nombre actual
 * (la parte final es el apellido); si solo tenían una palabra se les asigna un
 * apellido. `nombre` se conserva como nombre completo (nombres + apellidos).
 */
async function separarNombresYApellidos() {
  for (const tabla of ['clientes', 'usuarios', 'lavadores']) {
    if (!(await existeColumna(tabla, 'apellidos'))) {
      await pool.query(`ALTER TABLE ${tabla} ADD COLUMN nombres VARCHAR(100) NOT NULL DEFAULT '' AFTER nombre, ADD COLUMN apellidos VARCHAR(100) NOT NULL DEFAULT '' AFTER nombres`);
    }
    const [pendientes] = await pool.query(`SELECT id, nombre FROM ${tabla} WHERE apellidos = '' OR nombres = ''`);
    for (const fila of pendientes) {
      const { nombres, apellidos } = dividirNombreCompleto(fila.nombre, fila.id);
      await pool.query(`UPDATE ${tabla} SET nombres = ?, apellidos = ?, nombre = ? WHERE id = ?`, [nombres, apellidos, armarNombreCompleto(nombres, apellidos), fila.id]);
    }
    if (pendientes.length) console.log(`🛠  Nombres y apellidos separados en ${tabla}: ${pendientes.length} registros`);
  }
}

module.exports = { aplicarMigraciones };
