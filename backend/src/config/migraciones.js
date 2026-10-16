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
  await reiniciarDatosDelMes();
}

/**
 * Reinicio de una sola vez pedido por el administrador: borra TODO lo transaccional (ventas, compras, nómina,
 * gastos, caja, asistencia, citas...) y carga de nuevo solo lo mínimo en octubre 2026 (10 ventas y 2 compras,
 * ver reinicioMes.js). Antes de borrar guarda una copia de cada tabla (respaldo_2026_10_16_*), solo actúa si
 * existen los clientes, lavadores, servicios e insumos que usan los datos nuevos, y queda marcado para no
 * repetirse. Si algo falla, la transacción se deshace y no se toca nada.
 */
async function reiniciarDatosDelMes() {
  const CLAVE = 'reinicio_datos_2026_10_16';
  await pool.query(`CREATE TABLE IF NOT EXISTS mantenimientos_unicos (clave VARCHAR(80) PRIMARY KEY, aplicado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const [ya] = await pool.query(`SELECT 1 FROM mantenimientos_unicos WHERE clave = ?`, [CLAVE]);
  if (ya.length > 0) return;

  // Solo en la base que se revisó (mismos clientes, lavadores, servicios e insumos).
  const [[huella]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM clientes WHERE id IN (78, 70, 27, 65, 41, 43, 32)) AS clientes,
            (SELECT COUNT(*) FROM vehiculos WHERE id IN (68, 60, 17, 55, 31, 33, 22)) AS vehiculos,
            (SELECT COUNT(*) FROM lavadores WHERE id IN (1, 4, 5, 6, 10, 13, 14)) AS lavadores,
            (SELECT COUNT(*) FROM servicios WHERE id IN (1, 2, 3, 4, 5, 6, 8, 10)) AS servicios,
            (SELECT COUNT(*) FROM insumos WHERE id IN (1, 2, 3)) AS insumos,
            (SELECT COUNT(*) FROM proveedores WHERE id = 1) AS proveedores,
            (SELECT COUNT(*) FROM usuarios WHERE id = 1) AS usuarios,
            (SELECT COUNT(*) FROM clientes WHERE id = 70 AND nombre = 'Adriana Salazar') AS cliente70,
            (SELECT COUNT(*) FROM lavadores WHERE id = 1 AND nombre = 'Jorge Martínez') AS lavador1`
  );
  const completo = Number(huella.clientes) === 7 && Number(huella.vehiculos) === 7 && Number(huella.lavadores) === 7 && Number(huella.servicios) === 8
    && Number(huella.insumos) === 3 && Number(huella.proveedores) === 1 && Number(huella.usuarios) === 1 && Number(huella.cliente70) === 1 && Number(huella.lavador1) === 1;
  if (!completo) {
    console.log('ℹ️  Reinicio de datos del mes: esta base no es la revisada (faltan clientes/lavadores/servicios); no se tocó nada.');
    return;
  }

  const TABLAS = ['facturas', 'pagos', 'movimientos_inventario', 'insumos_entregados', 'ordenes_servicio', 'orden_lavadores', 'orden_servicios_extra',
    'turno_servicios_extra', 'turnos', 'citas', 'cierres_caja', 'liquidaciones_lavador', 'pagos_salario', 'asistencia_sesiones', 'asistencia', 'gastos_operativos', 'insumos'];
  for (const tabla of TABLAS) {
    await pool.query(`CREATE TABLE IF NOT EXISTS respaldo_2026_10_16_${tabla} AS SELECT * FROM ${tabla}`);
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    for (const sentencia of require('./reinicioMes')) {
      await conexion.query(sentencia);
    }
    await conexion.query(`INSERT INTO mantenimientos_unicos (clave) VALUES (?)`, [CLAVE]);
    await conexion.commit();
    console.log('🛠  Reinicio aplicado: datos transaccionales borrados y cargados de nuevo (10 ventas y 2 compras); copia en las tablas respaldo_2026_10_16_*');
  } catch (err) {
    await conexion.rollback();
    console.error('⚠️  No se pudo aplicar el reinicio de datos (no se cambió nada):', err.message);
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
