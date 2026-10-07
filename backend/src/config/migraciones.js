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
 * Cuentas de usuario de lavadores: `usuarios.lavador_id` marca la cuenta que
 * le da acceso al sistema a un lavador (sin nómina de salarios). Además deja
 * el documento de `usuarios` otra vez como único, quitando un cambio anterior
 * (cuentas "adicionales" con documento repetido) que ya no se usa.
 */
async function prepararCuentasDeLavador() {
  if (await existeColumna('usuarios', 'cuenta_adicional')) {
    const [[{ cantidad }]] = await pool.query(`SELECT COUNT(*) AS cantidad FROM usuarios WHERE cuenta_adicional = 1`);
    if (Number(cantidad) === 0) {
      if (await existeIndice('usuarios', 'uq_usuario_documento')) {
        await pool.query(`ALTER TABLE usuarios DROP INDEX uq_usuario_documento, ADD UNIQUE KEY documento (documento)`);
      }
      await pool.query(`ALTER TABLE usuarios DROP COLUMN cuenta_adicional, DROP COLUMN vinculado_tipo, DROP COLUMN vinculado_id`);
      console.log('🛠  Migración aplicada: se quitaron las cuentas adicionales y el documento vuelve a ser único');
    } else {
      console.warn(`⚠️  Hay ${cantidad} cuentas "adicionales" antiguas: no se tocó el esquema de usuarios. Revíselas a mano.`);
    }
  }
  if (!(await existeColumna('usuarios', 'lavador_id'))) {
    await pool.query(`ALTER TABLE usuarios ADD COLUMN lavador_id INT NULL`);
    console.log('🛠  Migración aplicada: usuarios.lavador_id');
  }
}

async function aplicarMigraciones() {
  // Clientes que se pueden inactivar (sin borrarlos ni perder su historial).
  if (!(await existeColumna('clientes', 'estado'))) {
    await pool.query(`ALTER TABLE clientes ADD COLUMN estado ENUM('activo','inactivo') NOT NULL DEFAULT 'activo'`);
    console.log('🛠  Migración aplicada: clientes.estado');
  }
  await separarNombresYApellidos();
  await prepararCuentasDeLavador();
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
