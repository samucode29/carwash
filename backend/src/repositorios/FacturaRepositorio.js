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

/**
 * Información completa para imprimir una factura: según su tipo se trae la
 * orden (cliente, vehículo, servicios, lavadores, pago), la compra
 * (proveedor, insumo, cantidad, costo unitario) o el pago de nómina (persona,
 * período, descuentos). Si algún dato ya no existe, ese bloque simplemente no se muestra.
 */
async function obtenerDetalleFactura(factura) {
  if (factura.tipo === 'venta') return detalleVenta(factura);
  if (factura.tipo === 'compra') return detalleCompra(factura);
  return detalleNomina(factura);
}

async function detalleVenta(factura) {
  if (!factura.orden_id) return {};
  const [ordenes] = await pool.query(
    `SELECT o.id, o.estado, o.fecha_hora_registro, o.fecha_hora_entrega, o.observacion, o.total,
            o.es_venta_anonima, o.placa_anonima, o.tipo_vehiculo_anonimo,
            s.nombre AS servicio_nombre,
            v.placa, v.tipo AS vehiculo_tipo, v.marca, v.color,
            cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono, cl.correo AS cliente_correo,
            u.nombre AS registrado_por
     FROM ordenes_servicio o
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     LEFT JOIN clientes cl ON cl.id = o.cliente_id
     LEFT JOIN usuarios u ON u.id = o.registrado_por
     WHERE o.id = ?`,
    [factura.orden_id]
  );
  const orden = ordenes[0];
  if (!orden) return {};

  const [extras] = await pool.query(
    `SELECT s.nombre, ose.precio
     FROM orden_servicios_extra ose
     INNER JOIN servicios s ON s.id = ose.servicio_id
     WHERE ose.orden_id = ? ORDER BY ose.id`,
    [orden.id]
  );
  const [lavadores] = await pool.query(
    `SELECT l.nombre FROM orden_lavadores ol INNER JOIN lavadores l ON l.id = ol.lavador_id WHERE ol.orden_id = ? ORDER BY l.nombre`,
    [orden.id]
  );
  const [pagos] = await pool.query(
    `SELECT metodo_pago, monto, descuento_negocio, descuento_trabajador, propina, fecha_pago
     FROM pagos WHERE orden_id = ? ORDER BY id DESC LIMIT 1`,
    [orden.id]
  );
  const pago = pagos[0] || null;

  const totalExtras = extras.reduce((s, e) => s + Number(e.precio), 0);
  const items = [{ descripcion: orden.servicio_nombre || factura.concepto, cantidad: 1, valor: Number(orden.total) - totalExtras }];
  extras.forEach(e => items.push({ descripcion: `${e.nombre} (servicio adicional)`, cantidad: 1, valor: Number(e.precio) }));

  return {
    orden: {
      id: orden.id,
      ingreso: orden.fecha_hora_registro,
      entrega: orden.fecha_hora_entrega,
      observacion: orden.observacion || '',
      registradoPor: orden.registrado_por || ''
    },
    cliente: orden.cliente_nombre
      ? { nombre: orden.cliente_nombre, telefono: orden.cliente_telefono, correo: orden.cliente_correo }
      : null,
    vehiculo: {
      placa: orden.placa || orden.placa_anonima || '',
      tipo: orden.vehiculo_tipo || orden.tipo_vehiculo_anonimo || '',
      marca: orden.marca && orden.marca !== 'Genérica' ? orden.marca : '',
      color: orden.color && orden.color !== 'No especificado' ? orden.color : ''
    },
    items,
    subtotal: Number(orden.total),
    lavadores: lavadores.map(l => l.nombre),
    pago: pago && {
      metodo: pago.metodo_pago,
      monto: Number(pago.monto),
      descuento: Number(pago.descuento_negocio || 0) + Number(pago.descuento_trabajador || 0),
      propina: Number(pago.propina || 0),
      fecha: pago.fecha_pago
    }
  };
}

async function detalleCompra(factura) {
  const detalle = {};
  if (factura.proveedor_id) {
    const [proveedores] = await pool.query(`SELECT nombre, contacto, telefono, correo, direccion FROM proveedores WHERE id = ?`, [factura.proveedor_id]);
    detalle.proveedor = proveedores[0] || null;
  }
  if (factura.movimiento_id) {
    const [movimientos] = await pool.query(
      `SELECT m.cantidad, m.fecha, m.observacion, i.nombre AS insumo, i.unidad_medida, u.nombre AS registrado_por
       FROM movimientos_inventario m
       INNER JOIN insumos i ON i.id = m.insumo_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.id = ?`,
      [factura.movimiento_id]
    );
    const m = movimientos[0];
    if (m) {
      const cantidad = Number(m.cantidad) || 0;
      detalle.compra = { fecha: m.fecha, observacion: m.observacion || '', registradoPor: m.registrado_por || '' };
      detalle.items = [{
        descripcion: m.insumo,
        cantidad,
        unidad: m.unidad_medida,
        valorUnitario: cantidad > 0 ? Number(factura.total) / cantidad : Number(factura.total),
        valor: Number(factura.total)
      }];
    }
  }
  return detalle;
}

/** Los pagos de nómina no guardan un vínculo con la factura: se busca el pago por persona, fecha y valor. */
async function detalleNomina(factura) {
  const partes = String(factura.concepto || '').split(' - ');
  const tipoPago = partes[0];
  const nombre = partes.slice(1).join(' - ');
  if (!nombre) return {};

  if (/^Salario/i.test(tipoPago)) {
    const [filas] = await pool.query(
      `SELECT u.nombre, u.documento, u.rol, ps.periodicidad, ps.periodo_inicio, ps.periodo_fin, ps.salario_base, ps.descuentos, ps.valor_a_pagar
       FROM pagos_salario ps INNER JOIN usuarios u ON u.id = ps.empleado_id
       WHERE u.nombre = ? AND ps.fecha_pago_real = ? AND ps.valor_a_pagar = ?
       ORDER BY ps.id DESC LIMIT 1`,
      [nombre, factura.fecha, factura.total]
    );
    const f = filas[0];
    return f ? {
      persona: { etiqueta: 'Empleado', nombre: f.nombre, documento: f.documento, rol: f.rol },
      periodo: `${String(f.periodo_inicio).substring(0, 10)} al ${String(f.periodo_fin).substring(0, 10)} (pago ${f.periodicidad})`,
      concepto: 'Salario por horas trabajadas',
      bruto: Number(f.salario_base), descuentos: Number(f.descuentos), neto: Number(f.valor_a_pagar)
    } : { persona: { etiqueta: 'Empleado', nombre } };
  }

  const [filas] = await pool.query(
    `SELECT l.nombre, l.documento, ll.periodo_inicio, ll.periodo_fin, ll.total_comision, ll.descuentos, ll.valor_a_pagar
     FROM liquidaciones_lavador ll INNER JOIN lavadores l ON l.id = ll.lavador_id
     WHERE l.nombre = ? AND ll.fecha_pago = ? AND ll.valor_a_pagar = ?
     ORDER BY ll.id DESC LIMIT 1`,
    [nombre, factura.fecha, factura.total]
  );
  const f = filas[0];
  return f ? {
    persona: { etiqueta: 'Lavador', nombre: f.nombre, documento: f.documento, rol: 'lavador' },
    periodo: `${String(f.periodo_inicio).substring(0, 10)} al ${String(f.periodo_fin).substring(0, 10)}`,
    concepto: 'Comisiones por servicios de lavado (incluye propinas)',
    bruto: Number(f.total_comision), descuentos: Number(f.descuentos), neto: Number(f.valor_a_pagar)
  } : { persona: { etiqueta: 'Lavador', nombre } };
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

module.exports = { crearFactura, obtenerFacturaPorId, obtenerDetalleFactura, listarFacturas };
