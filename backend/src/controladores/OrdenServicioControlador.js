/**
 * Controlador del Punto de Venta (POS) y del tablero Kanban de órdenes de
 * servicio. Aquí vive la regla de negocio de asignación de lavadores y el
 * descuento automático de insumos al terminar un lavado (CU02, CU07-CU10 /
 * RF08-RF11, RF21-RF24, RF28, RF36).
 */
const { pool } = require('../config/baseDeDatos');
const OrdenServicioRepositorio = require('../repositorios/OrdenServicioRepositorio');
const ServicioRepositorio = require('../repositorios/ServicioRepositorio');
const LavadorRepositorio = require('../repositorios/LavadorRepositorio');
const InsumoRepositorio = require('../repositorios/InsumoRepositorio');
const AsistenciaRepositorio = require('../repositorios/AsistenciaRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { obtenerFechaHoy } = require('../utilidades/fechas');

async function listarOrdenes(req, res) {
  const { estado, fecha } = req.query;
  res.json(await OrdenServicioRepositorio.listarOrdenes({ estado, fecha }));
}

/**
 * Decide qué lavador(es) atienden la orden: si el cliente eligió lavadores
 * manualmente se respeta esa elección; si no, se asigna automáticamente al
 * primer lavador activo que no tenga ninguna orden "en_proceso" (RF23, RF28).
 *
 * En ambos casos solo se considera "disponible" al lavador que ya registró
 * su entrada hoy y no ha marcado salida todavía (RF35): un lavador que no
 * ha llegado no puede quedar asignado a un servicio.
 */
async function calcularAsignacionLavadores(lavadoresIds, precioServicio) {
  const presentesIds = new Set(await AsistenciaRepositorio.listarIdsPresentesHoy('lavador', obtenerFechaHoy()));
  let lavadoresElegidos = [];

  if (Array.isArray(lavadoresIds) && lavadoresIds.length > 0) {
    const noDisponibles = [];
    for (const idCrudo of lavadoresIds) {
      const lavador = await LavadorRepositorio.obtenerActivoPorId(parseInt(idCrudo, 10));
      if (!lavador) continue;
      if (!presentesIds.has(lavador.id)) {
        noDisponibles.push(lavador.nombre);
        continue;
      }
      lavadoresElegidos.push({ lavador, automatica: false });
    }
    if (noDisponibles.length > 0) {
      const verbo = noDisponibles.length > 1 ? 'no han registrado entrada hoy' : 'no ha registrado entrada hoy';
      throw Object.assign(new Error(`${noDisponibles.join(', ')} ${verbo} y no puede ser asignado a un servicio.`), { codigoHttp: 400 });
    }
  } else {
    const idsOcupados = new Set(await LavadorRepositorio.obtenerIdsOcupados());
    const activos = await LavadorRepositorio.listar({ soloActivos: true });
    const libre = activos.find(l => presentesIds.has(l.id) && !idsOcupados.has(l.id));
    if (libre) lavadoresElegidos.push({ lavador: libre, automatica: true });
  }

  return lavadoresElegidos.map(({ lavador, automatica }) => {
    const porcentaje = Number(lavador.porcentaje_comision) || 60;
    const valorComision = (precioServicio * (porcentaje / 100)) / lavadoresElegidos.length;
    return { lavadorId: lavador.id, nombre: lavador.nombre, automatica, porcentajeComision: porcentaje, valorComision };
  });
}

async function crearOrden(req, res) {
  const { cita_id, turno_id, cliente_id, vehiculo_id, servicio_id, es_venta_anonima, placa_anonima, tipo_vehiculo_anonimo, lavadores_ids } = req.body;

  const servicio = await ServicioRepositorio.obtenerPorId(parseInt(servicio_id, 10));
  if (!servicio) return res.status(400).json({ error: 'Servicio no válido.' });

  const lavadoresAsignados = await calcularAsignacionLavadores(lavadores_ids, Number(servicio.precio));

  const ordenId = await OrdenServicioRepositorio.crearOrdenConAsignacion({
    citaId: cita_id ? parseInt(cita_id, 10) : null,
    turnoId: turno_id ? parseInt(turno_id, 10) : null,
    clienteId: cliente_id ? parseInt(cliente_id, 10) : null,
    vehiculoId: vehiculo_id ? parseInt(vehiculo_id, 10) : null,
    servicioId: servicio.id,
    esVentaAnonima: !!es_venta_anonima,
    placaAnonima: placa_anonima ? placa_anonima.toUpperCase().trim() : null,
    tipoVehiculoAnonimo: tipo_vehiculo_anonimo || null,
    total: servicio.precio,
    registradoPor: req.usuarioAutenticado.id,
    lavadoresAsignados
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_orden_pos', `Creada orden #${ordenId} por $${servicio.precio} (${servicio.nombre})`);

  const ordenes = await OrdenServicioRepositorio.listarOrdenes({});
  res.status(201).json(ordenes.find(o => o.id === ordenId));
}

/**
 * Cambia el estado de una orden. Al pasar a "terminado" descuenta
 * automáticamente del inventario los insumos configurados para ese
 * servicio (RF10, RF36), todo dentro de una transacción.
 */
async function actualizarEstadoOrden(req, res) {
  const id = Number(req.params.id);
  const { estado } = req.body;
  const estadosValidos = ['recibido', 'en_proceso', 'terminado', 'entregado', 'cancelado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: 'Estado no válido.' });
  }

  const orden = await OrdenServicioRepositorio.obtenerOrdenPorId(id);
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada.' });

  const estadoAnterior = orden.estado;

  if (estado === 'terminado' && estadoAnterior !== 'terminado') {
    const consumo = await ServicioRepositorio.obtenerConsumoInsumos(orden.servicio_id);
    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      for (const item of consumo) {
        await InsumoRepositorio.registrarSalida(conexion, {
          insumoId: item.insumo_id,
          cantidad: item.cantidad_consumida,
          ordenId: id,
          usuarioId: req.usuarioAutenticado.id,
          observacion: `Consumo automático Orden #${id}`
        });
      }
      await conexion.query(`UPDATE ordenes_servicio SET estado = ? WHERE id = ?`, [estado, id]);
      await conexion.commit();
    } catch (err) {
      await conexion.rollback();
      throw err;
    } finally {
      conexion.release();
    }
  } else {
    await OrdenServicioRepositorio.actualizarEstado(id, estado);
  }

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_estado_orden', `Orden #${id} cambió de ${estadoAnterior} a ${estado}`);

  const ordenes = await OrdenServicioRepositorio.listarOrdenes({});
  res.json(ordenes.find(o => o.id === id));
}

async function asignarLavadores(req, res) {
  const id = Number(req.params.id);
  const { lavadores_ids } = req.body;
  if (!Array.isArray(lavadores_ids)) {
    return res.status(400).json({ error: 'lavadores_ids debe ser un arreglo de IDs.' });
  }

  const orden = await OrdenServicioRepositorio.obtenerOrdenPorId(id);
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada.' });

  const lavadoresAsignados = await calcularAsignacionLavadores(lavadores_ids, Number(orden.total));
  await OrdenServicioRepositorio.reemplazarLavadoresAsignados(id, lavadoresAsignados);

  await AuditoriaRepositorio.registrar(
    req.usuarioAutenticado.id, 'asignar_lavadores',
    `Orden #${id} reasignada a ${lavadoresAsignados.map(l => l.nombre).join(', ') || 'ningún lavador'}`
  );

  const ordenes = await OrdenServicioRepositorio.listarOrdenes({});
  res.json(ordenes.find(o => o.id === id));
}

module.exports = { listarOrdenes, crearOrden, actualizarEstadoOrden, asignarLavadores };
