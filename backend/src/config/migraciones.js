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
  // Día de pago del empleado (para saber cuándo le toca el pago de salario).
  if (!(await existeColumna('usuarios', 'dia_pago'))) {
    await pool.query(`ALTER TABLE usuarios ADD COLUMN dia_pago TINYINT NULL AFTER periodicidad_pago`);
    console.log('🛠  Migración aplicada: usuarios.dia_pago');
  }
  // Horas extra escritas a mano en el pago de salario.
  if (!(await existeColumna('pagos_salario', 'horas_extra'))) {
    await pool.query(`ALTER TABLE pagos_salario ADD COLUMN horas_extra DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER salario_base, ADD COLUMN valor_horas_extra DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER horas_extra`);
    console.log('🛠  Migración aplicada: pagos_salario.horas_extra');
  }
  // Pagos de salario parciales: lo adeudado, el saldo que queda y si el pago es un abono.
  if (!(await existeColumna('pagos_salario', 'saldo_pendiente'))) {
    await pool.query(`ALTER TABLE pagos_salario
      ADD COLUMN valor_adeudado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER valor_a_pagar,
      ADD COLUMN saldo_pendiente DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER valor_adeudado,
      ADD COLUMN es_abono BOOLEAN NOT NULL DEFAULT FALSE AFTER saldo_pendiente`);
    await pool.query(`UPDATE pagos_salario SET valor_adeudado = valor_a_pagar`);
    console.log('🛠  Migración aplicada: pagos_salario.saldo_pendiente (pagos parciales)');
  }
  await separarNombresYApellidos();
  await prepararCuentasDeLavador();
  await corregirCitasDeOrdenesCanceladas();
  await quitarCompraDeCepillosErronea();
}

/**
 * Corrección de una sola vez pedida por el administrador: quita la compra de
 * 1.000 cepillos por $10.000.000 (factura COMCE-151026-001) junto con las dos
 * entregas de cepillo (950 y 265) que solo fueron posibles con esa compra, y
 * deja las existencias como estaban antes de ella. Solo actúa si TODOS los
 * registros siguen exactamente como se revisaron (mismos ids y valores); si
 * algo no coincide no toca nada. Es seguro dejarla: después de aplicarse no
 * encuentra la factura y no hace nada.
 */
async function quitarCompraDeCepillosErronea() {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [factura] = await conexion.query(
      `SELECT id FROM facturas WHERE id = 1574 AND numero_factura = 'COMCE-151026-001' AND tipo = 'compra' AND total = 10000000 AND movimiento_id = 36 FOR UPDATE`
    );
    if (factura.length === 0) { await conexion.rollback(); return; }

    const [entrada] = await conexion.query(`SELECT id FROM movimientos_inventario WHERE id = 36 AND insumo_id = 3 AND tipo = 'entrada' AND cantidad = 1000 FOR UPDATE`);
    const [salidas] = await conexion.query(`SELECT id FROM movimientos_inventario WHERE id IN (37, 38) AND insumo_id = 3 AND tipo = 'salida' AND cantidad IN (950, 265) FOR UPDATE`);
    const [entregas] = await conexion.query(`SELECT id FROM insumos_entregados WHERE id IN (3, 4) AND insumo_id = 3 AND cantidad IN (950, 265) FOR UPDATE`);
    if (entrada.length !== 1 || salidas.length !== 2 || entregas.length !== 2) {
      await conexion.rollback();
      console.log('⚠️  Corrección de la compra de cepillos: los registros no coinciden con lo revisado; no se tocó nada.');
      return;
    }

    await conexion.query(`DELETE FROM facturas WHERE id = 1574`);
    await conexion.query(`DELETE FROM movimientos_inventario WHERE id IN (36, 37, 38)`);
    await conexion.query(`DELETE FROM insumos_entregados WHERE id IN (3, 4)`);
    // Se quita la entrada (-1000) y se devuelven las dos entregas (+1215): neto +215 sobre las existencias de hoy.
    const [stock] = await conexion.query(`UPDATE insumos SET stock_actual = stock_actual - 1000 + 1215 WHERE id = 3 AND stock_actual - 1000 + 1215 >= 0`);
    if (stock.affectedRows !== 1) throw new Error('no se pudo ajustar el stock de cepillos');

    await conexion.commit();
    console.log('🛠  Corrección aplicada: se quitó la compra de 1.000 cepillos ($10.000.000) y sus dos entregas; existencias de cepillo ajustadas');
  } catch (err) {
    await conexion.rollback();
    console.error('⚠️  No se pudo aplicar la corrección de la compra de cepillos:', err.message);
  } finally {
    conexion.release();
  }
}

/**
 * Citas que quedaron como "atendidas" porque su orden se canceló después:
 * pasan a "canceladas" (solo si la cita no tiene ninguna otra orden vigente).
 */
async function corregirCitasDeOrdenesCanceladas() {
  const [resultado] = await pool.query(
    `UPDATE citas c SET c.estado = 'cancelada'
     WHERE c.estado = 'atendida'
       AND EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.cita_id = c.id AND o.estado = 'cancelado')
       AND NOT EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.cita_id = c.id AND o.estado <> 'cancelado')`
  );
  if (resultado.affectedRows) console.log(`🛠  Citas con orden cancelada marcadas como canceladas: ${resultado.affectedRows}`);
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
