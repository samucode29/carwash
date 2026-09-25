/**
 * Acceso a datos de insumos, proveedores, movimientos de inventario y
 * entregas de dotación a lavadores (CU13, CU14, CU15, CU28 / RF13-RF15, RF36).
 */
const { pool } = require('../config/baseDeDatos');

// ---------------------------------------------------------------------------
// Insumos
// ---------------------------------------------------------------------------
async function listarInsumos({ soloActivos = false } = {}) {
  const [filas] = await pool.query(
    `SELECT i.*, p.nombre AS proveedor_nombre, p.telefono AS proveedor_telefono, p.contacto AS proveedor_contacto
     FROM insumos i
     LEFT JOIN proveedores p ON p.id = i.proveedor_id
     ${soloActivos ? "WHERE i.estado = 'activo'" : ''}
     ORDER BY i.nombre`
  );
  return filas.map(i => ({ ...i, bajo_stock: Number(i.stock_actual) <= Number(i.stock_minimo) }));
}

async function obtenerInsumoPorId(id, conexion = pool) {
  const [filas] = await conexion.query(`SELECT * FROM insumos WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function listarAlertasStockBajo() {
  const insumos = await listarInsumos({ soloActivos: true });
  return insumos.filter(i => i.bajo_stock);
}

async function crearInsumo(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, proveedor_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [datos.nombre, datos.unidadMedida, datos.stockActual || 0, datos.stockMinimo || 0, datos.costoUnitario || 0, datos.proveedorId || null]
  );
  return obtenerInsumoPorId(resultado.insertId);
}

async function actualizarInsumo(id, cambios) {
  const campos = [];
  const valores = [];
  for (const [columna, valor] of Object.entries(cambios)) {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  }
  if (campos.length === 0) return obtenerInsumoPorId(id);

  valores.push(id);
  await pool.query(`UPDATE insumos SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerInsumoPorId(id);
}

/** Descuenta stock dentro de una transacción y registra el movimiento de salida. */
async function registrarSalida(conexion, { insumoId, cantidad, ordenId, usuarioId, observacion }) {
  await conexion.query(`UPDATE insumos SET stock_actual = GREATEST(0, stock_actual - ?) WHERE id = ?`, [cantidad, insumoId]);
  await conexion.query(
    `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, orden_id, usuario_id, observacion)
     VALUES (?, 'salida', ?, ?, ?, ?)`,
    [insumoId, cantidad, ordenId || null, usuarioId, observacion]
  );
}

async function registrarEntrada({ insumoId, cantidad, proveedorId, usuarioId, observacion, costoUnitario }) {
  if (costoUnitario !== null && costoUnitario !== undefined) {
    await pool.query(`UPDATE insumos SET stock_actual = stock_actual + ?, costo_unitario = ? WHERE id = ?`, [cantidad, costoUnitario, insumoId]);
  } else {
    await pool.query(`UPDATE insumos SET stock_actual = stock_actual + ? WHERE id = ?`, [cantidad, insumoId]);
  }
  await pool.query(
    `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, proveedor_id, usuario_id, observacion)
     VALUES (?, 'entrada', ?, ?, ?, ?)`,
    [insumoId, cantidad, proveedorId || null, usuarioId, observacion || 'Entrada manual de inventario']
  );
}

async function listarMovimientos() {
  const [filas] = await pool.query(
    `SELECT m.*, i.nombre AS insumo_nombre, i.unidad_medida, u.nombre AS usuario_nombre, p.nombre AS proveedor_nombre
     FROM movimientos_inventario m
     LEFT JOIN insumos i ON i.id = m.insumo_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN proveedores p ON p.id = m.proveedor_id
     ORDER BY m.fecha DESC, m.id DESC
     LIMIT 100`
  );
  return filas;
}

// ---------------------------------------------------------------------------
// Entregas de dotación a lavadores
// ---------------------------------------------------------------------------
async function listarEntregas() {
  const [filas] = await pool.query(
    `SELECT e.*, l.nombre AS lavador_nombre, i.nombre AS insumo_nombre, i.unidad_medida, u.nombre AS entregado_por_nombre
     FROM insumos_entregados e
     LEFT JOIN lavadores l ON l.id = e.lavador_id
     LEFT JOIN insumos i ON i.id = e.insumo_id
     LEFT JOIN usuarios u ON u.id = e.entregado_por
     ORDER BY e.fecha_entrega DESC
     LIMIT 100`
  );
  return filas;
}

async function registrarEntrega({ lavadorId, insumoId, cantidad, entregadoPor }) {
  const insumo = await obtenerInsumoPorId(insumoId);
  if (!insumo) throw Object.assign(new Error('Insumo no válido.'), { codigoHttp: 400 });
  if (Number(cantidad) > Number(insumo.stock_actual)) {
    throw Object.assign(new Error(`Stock insuficiente. Disponible: ${insumo.stock_actual} ${insumo.unidad_medida}`), { codigoHttp: 400 });
  }

  await pool.query(`UPDATE insumos SET stock_actual = stock_actual - ? WHERE id = ?`, [cantidad, insumoId]);
  const [resultado] = await pool.query(
    `INSERT INTO insumos_entregados (lavador_id, insumo_id, cantidad, estado, entregado_por)
     VALUES (?, ?, ?, 'entregado', ?)`,
    [lavadorId, insumoId, cantidad, entregadoPor]
  );
  await pool.query(
    `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, usuario_id, observacion)
     VALUES (?, 'salida', ?, ?, ?)`,
    [insumoId, cantidad, entregadoPor, `Entrega de dotación a lavador ID ${lavadorId}`]
  );

  const [filas] = await pool.query(`SELECT * FROM insumos_entregados WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------
async function listarProveedores({ soloActivos = false } = {}) {
  const [filas] = await pool.query(
    `SELECT * FROM proveedores ${soloActivos ? "WHERE estado = 'activo'" : ''} ORDER BY nombre`
  );
  return filas;
}

async function obtenerProveedorPorId(id) {
  const [filas] = await pool.query(`SELECT * FROM proveedores WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function crearProveedor(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO proveedores (nombre, contacto, telefono, correo, direccion) VALUES (?, ?, ?, ?, ?)`,
    [datos.nombre, datos.contacto || '', datos.telefono || '', datos.correo || '', datos.direccion || '']
  );
  return obtenerProveedorPorId(resultado.insertId);
}

async function actualizarProveedor(id, cambios) {
  const campos = [];
  const valores = [];
  for (const [columna, valor] of Object.entries(cambios)) {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  }
  if (campos.length === 0) return obtenerProveedorPorId(id);

  valores.push(id);
  await pool.query(`UPDATE proveedores SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerProveedorPorId(id);
}

module.exports = {
  listarInsumos,
  obtenerInsumoPorId,
  listarAlertasStockBajo,
  crearInsumo,
  actualizarInsumo,
  registrarSalida,
  registrarEntrada,
  listarMovimientos,
  listarEntregas,
  registrarEntrega,
  listarProveedores,
  obtenerProveedorPorId,
  crearProveedor,
  actualizarProveedor
};
