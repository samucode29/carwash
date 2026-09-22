/**
 * Acceso a datos de órdenes de servicio (POS + tablero Kanban) y su relación
 * con lavadores asignados y pagos. CU02, CU07, CU08, CU09, CU10 / RF08-RF11,
 * RF21-RF24, RF28.
 */
const { pool } = require('../config/baseDeDatos');

const SELECT_BASE = `
  SELECT o.*,
         cl.nombre AS cliente_nombre_reg, cl.telefono AS cliente_telefono_reg,
         v.placa AS placa_reg, v.tipo AS tipo_vehiculo_reg, v.marca AS vehiculo_marca, v.color AS vehiculo_color,
         s.nombre AS servicio_nombre, s.duracion_estimada_min AS servicio_duracion,
         p.metodo_pago, p.monto AS pago_monto, p.fecha_pago
  FROM ordenes_servicio o
  LEFT JOIN clientes cl ON cl.id = o.cliente_id
  LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
  LEFT JOIN servicios s ON s.id = o.servicio_id
  LEFT JOIN pagos p ON p.orden_id = o.id
`;

function mapearOrden(fila, lavadoresPorOrden) {
  return {
    ...fila,
    cliente_nombre: fila.cliente_nombre_reg || (fila.es_venta_anonima ? 'Venta Anónima' : 'Sin registrar'),
    cliente_telefono: fila.cliente_telefono_reg || '',
    placa: fila.placa_reg || fila.placa_anonima || 'N/A',
    tipo_vehiculo: fila.tipo_vehiculo_reg || fila.tipo_vehiculo_anonimo || 'carro',
    vehiculo_marca: fila.vehiculo_marca ? `${fila.vehiculo_marca} (${fila.vehiculo_color || ''})` : '',
    pago: fila.metodo_pago ? { metodo_pago: fila.metodo_pago, monto: fila.pago_monto, fecha_pago: fila.fecha_pago } : null,
    lavadores: lavadoresPorOrden[fila.id] || []
  };
}

async function obtenerLavadoresPorOrdenes(ordenIds) {
  if (ordenIds.length === 0) return {};
  const [filas] = await pool.query(
    `SELECT ol.orden_id, ol.lavador_id, l.nombre, ol.porcentaje_comision, ol.valor_comision
     FROM orden_lavadores ol
     INNER JOIN lavadores l ON l.id = ol.lavador_id
     WHERE ol.orden_id IN (?)`,
    [ordenIds]
  );
  const agrupado = {};
  filas.forEach(f => {
    if (!agrupado[f.orden_id]) agrupado[f.orden_id] = [];
    agrupado[f.orden_id].push(f);
  });
  return agrupado;
}

async function listarOrdenes({ estado, fecha, soloLavadorId } = {}) {
  const condiciones = [];
  const parametros = [];
  if (estado) { condiciones.push('o.estado = ?'); parametros.push(estado); }
  if (fecha) { condiciones.push('DATE(o.fecha_hora_registro) = ?'); parametros.push(fecha); }

  const whereClause = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const [filas] = await pool.query(`${SELECT_BASE} ${whereClause} ORDER BY o.fecha_hora_registro DESC`, parametros);

  const lavadoresPorOrden = await obtenerLavadoresPorOrdenes(filas.map(f => f.id));
  let ordenes = filas.map(f => mapearOrden(f, lavadoresPorOrden));

  if (soloLavadorId) {
    ordenes = ordenes.filter(o => o.lavadores.some(l => l.lavador_id === soloLavadorId));
  }
  return ordenes;
}

async function obtenerOrdenPorId(id, conexion = pool) {
  const [filas] = await conexion.query(`SELECT * FROM ordenes_servicio WHERE id = ?`, [id]);
  return filas[0] || null;
}

/**
 * Crea una nueva orden dentro de una transacción: inserta la orden, marca
 * la cita/turno de origen como atendida (si aplica) y asigna lavador(es)
 * calculando su comisión (RF09, RF23, RF24, RF28).
 */
async function crearOrdenConAsignacion(datos) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [resultadoOrden] = await conexion.query(
      `INSERT INTO ordenes_servicio
        (cita_id, turno_id, cliente_id, vehiculo_id, servicio_id, es_venta_anonima,
         placa_anonima, tipo_vehiculo_anonimo, estado, total, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datos.citaId || null, datos.turnoId || null, datos.clienteId || null, datos.vehiculoId || null,
        datos.servicioId, datos.esVentaAnonima ? 1 : 0, datos.placaAnonima || null, datos.tipoVehiculoAnonimo || null,
        datos.lavadoresAsignados.length > 0 ? 'en_proceso' : 'recibido', datos.total, datos.registradoPor
      ]
    );
    const ordenId = resultadoOrden.insertId;

    if (datos.citaId) {
      await conexion.query(`UPDATE citas SET estado = 'atendida' WHERE id = ?`, [datos.citaId]);
    }
    if (datos.turnoId) {
      await conexion.query(`UPDATE turnos SET estado = 'finalizado' WHERE id = ?`, [datos.turnoId]);
    }

    for (const asignacion of datos.lavadoresAsignados) {
      await conexion.query(
        `INSERT INTO orden_lavadores (orden_id, lavador_id, asignacion_automatica, porcentaje_comision, valor_comision)
         VALUES (?, ?, ?, ?, ?)`,
        [ordenId, asignacion.lavadorId, asignacion.automatica, asignacion.porcentajeComision, asignacion.valorComision]
      );
    }

    await conexion.commit();
    return ordenId;
  } catch (err) {
    await conexion.rollback();
    throw err;
  } finally {
    conexion.release();
  }
}

async function actualizarEstado(id, estado) {
  const campos = ['estado = ?'];
  const valores = [estado];
  if (estado === 'entregado') campos.push('fecha_hora_entrega = NOW()');

  await pool.query(`UPDATE ordenes_servicio SET ${campos.join(', ')} WHERE id = ?`, [...valores, id]);
}

async function reemplazarLavadoresAsignados(ordenId, lavadoresAsignados) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    await conexion.query(`DELETE FROM orden_lavadores WHERE orden_id = ?`, [ordenId]);

    for (const asignacion of lavadoresAsignados) {
      await conexion.query(
        `INSERT INTO orden_lavadores (orden_id, lavador_id, asignacion_automatica, porcentaje_comision, valor_comision)
         VALUES (?, ?, ?, ?, ?)`,
        [ordenId, asignacion.lavadorId, asignacion.automatica, asignacion.porcentajeComision, asignacion.valorComision]
      );
    }
    if (lavadoresAsignados.length > 0) {
      await conexion.query(`UPDATE ordenes_servicio SET estado = 'en_proceso' WHERE id = ? AND estado = 'recibido'`, [ordenId]);
    }
    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    throw err;
  } finally {
    conexion.release();
  }
}

module.exports = {
  listarOrdenes,
  obtenerOrdenPorId,
  obtenerLavadoresPorOrdenes,
  crearOrdenConAsignacion,
  actualizarEstado,
  reemplazarLavadoresAsignados
};
