/**
 * Numeración y persistencia de facturas de compra (a proveedores) y de
 * venta (servicios cobrados). El número se genera solo, con el formato
 * CCPP-DDMMAA-NNN (ver comentario en schema.sql).
 */
const { pool } = require('../config/baseDeDatos');
const { formatearFechaCorta } = require('../utilidades/fechas');

const PREFIJO_POR_TIPO = { compra: 'COM', venta: 'VEN', nomina: 'PAG' };

function soloLetras(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]/g, '');
}

/** Primeras 2 letras del nombre del producto/servicio, sin tildes/espacios. */
function iniciales(nombre) {
  const limpio = soloLetras(nombre).toUpperCase();
  return (limpio.substring(0, 2) || 'XX').padEnd(2, 'X');
}

/** Inicial del nombre + inicial del apellido (no las primeras 2 letras del nombre). */
function inicialesPersona(nombreCompleto) {
  const partes = (nombreCompleto || '').trim().split(/\s+/);
  const letra = (palabra) => (soloLetras(palabra).charAt(0).toUpperCase() || 'X');
  return `${letra(partes[0])}${letra(partes[1])}`;
}

async function generarNumeroFactura(tipo, concepto, fecha) {
  // Para pagos de nómina el concepto viene como "Salario - Laura Gómez" o
  // "Comisión - Jorge Martínez": las iniciales deben salir del nombre de la
  // persona, no de la palabra "Salario"/"Comisión".
  const codigo = tipo === 'nomina'
    ? inicialesPersona(concepto.includes(' - ') ? concepto.split(' - ').slice(1).join(' - ') : concepto)
    : iniciales(concepto);
  const prefijo = `${PREFIJO_POR_TIPO[tipo]}${codigo}`;
  const fechaCorta = formatearFechaCorta(fecha);

  const [filas] = await pool.query(
    `SELECT COUNT(*) AS cantidad FROM facturas WHERE tipo = ? AND fecha = ?`,
    [tipo, fecha]
  );
  const consecutivo = String(filas[0].cantidad + 1).padStart(3, '0');
  return `${prefijo}-${fechaCorta}-${consecutivo}`;
}

async function crearFactura({ tipo, ordenId, movimientoId, clienteId, proveedorId, concepto, total, fecha, creadoPor }) {
  const numeroFactura = await generarNumeroFactura(tipo, concepto, fecha);
  const [resultado] = await pool.query(
    `INSERT INTO facturas (numero_factura, tipo, orden_id, movimiento_id, cliente_id, proveedor_id, concepto, total, fecha, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [numeroFactura, tipo, ordenId || null, movimientoId || null, clienteId || null, proveedorId || null, concepto, total, fecha, creadoPor]
  );
  return obtenerFacturaPorId(resultado.insertId);
}

async function obtenerFacturaPorId(id) {
  const [filas] = await pool.query(
    `SELECT f.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
            p.nombre AS proveedor_nombre, u.nombre AS creado_por_nombre,
            o.total AS orden_total, o.placa_anonima, o.tipo_vehiculo_anonimo,
            m.cantidad AS movimiento_cantidad
     FROM facturas f
     LEFT JOIN clientes cl        ON cl.id = f.cliente_id
     LEFT JOIN proveedores p      ON p.id = f.proveedor_id
     LEFT JOIN usuarios u         ON u.id = f.creado_por
     LEFT JOIN ordenes_servicio o ON o.id = f.orden_id
     LEFT JOIN movimientos_inventario m ON m.id = f.movimiento_id
     WHERE f.id = ?`,
    [id]
  );
  return filas[0] || null;
}

async function listarFacturas({ tipo, fechaInicio, fechaFin } = {}) {
  const condiciones = [];
  const parametros = [];
  if (tipo) { condiciones.push('f.tipo = ?'); parametros.push(tipo); }
  if (fechaInicio) { condiciones.push('f.fecha >= ?'); parametros.push(fechaInicio); }
  if (fechaFin) { condiciones.push('f.fecha <= ?'); parametros.push(fechaFin); }
  const whereClause = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const [filas] = await pool.query(
    `SELECT f.*, cl.nombre AS cliente_nombre, p.nombre AS proveedor_nombre
     FROM facturas f
     LEFT JOIN clientes cl   ON cl.id = f.cliente_id
     LEFT JOIN proveedores p ON p.id = f.proveedor_id
     ${whereClause}
     ORDER BY f.creado_en DESC
     LIMIT 200`,
    parametros
  );
  return filas;
}

module.exports = { crearFactura, obtenerFacturaPorId, listarFacturas };
