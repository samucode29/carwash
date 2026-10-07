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

async function aplicarMigraciones() {
  // Clientes que se pueden inactivar (sin borrarlos ni perder su historial).
  if (!(await existeColumna('clientes', 'estado'))) {
    await pool.query(`ALTER TABLE clientes ADD COLUMN estado ENUM('activo','inactivo') NOT NULL DEFAULT 'activo'`);
    console.log('🛠  Migración aplicada: clientes.estado');
  }
  await separarNombresYApellidos();
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
