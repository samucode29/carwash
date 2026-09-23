/**
 * Controlador del Punto de Venta (POS) y del tablero Kanban de órdenes de
 * servicio. Aquí vive la regla de negocio de asignación de lavadores
 * (CU02, CU07-CU10 / RF08-RF11, RF21-RF24, RF28). Los insumos se entregan
 * al lavador directamente desde Inventario (entregas), no van asociados a
 * un servicio ni se descuentan automáticamente al terminar una orden.
 */
const OrdenServicioRepositorio = require('../repositorios/OrdenServicioRepositorio');
const ServicioRepositorio = require('../repositorios/ServicioRepositorio');
const LavadorRepositorio = require('../repositorios/LavadorRepositorio');
const AsistenciaRepositorio = require('../repositorios/AsistenciaRepositorio');
const AgendaRepositorio = require('../repositorios/AgendaRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { obtenerFechaHoy } = require('../utilidades/fechas');

async function listarOrdenes(req, res) {
  const { estado, fecha } = req.query;
  res.json(await OrdenServicioRepositorio.listarOrdenes({ estado, fecha }));
}

const MAX_LAVADORES_POR_ORDEN = 3;

/**
 * Decide qué lavador(es) atienden la orden: si el cliente eligió lavadores
 * manualmente se respeta esa elección (máximo 3 por orden); si no, se
 * asigna automáticamente al primer lavador activo que no tenga ninguna
 * orden "en_proceso" (RF23, RF28).
 *
 * En ambos casos solo se considera "disponible" al lavador que ya registró
 * su entrada hoy y no ha marcado salida todavía (RF35): un lavador que no
 * ha llegado no puede quedar asignado a un servicio.
 *
 * Comisión: si atiende un solo lavador, se le paga su propio porcentaje
 * configurado (60% por defecto, o el que el admin le haya asignado). Si
 * atienden varios lavadores el mismo servicio, la comisión total es un
 * 60% plano del precio del servicio, dividido en partes iguales entre
 * todos — no se suman los porcentajes individuales de cada uno.
 */
async function calcularAsignacionLavadores(lavadoresIds, precioServicio) {
  if (Array.isArray(lavadoresIds) && lavadoresIds.length > MAX_LAVADORES_POR_ORDEN) {
    throw Object.assign(new Error(`Un servicio admite máximo ${MAX_LAVADORES_POR_ORDEN} lavadores.`), { codigoHttp: 400 });
  }

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

  const esGrupo = lavadoresElegidos.length > 1;

  return lavadoresElegidos.map(({ lavador, automatica }) => {
    const porcentaje = esGrupo ? 60 : (Number(lavador.porcentaje_comision) || 60);
    const valorComision = (precioServicio * (porcentaje / 100)) / lavadoresElegidos.length;
    return { lavadorId: lavador.id, nombre: lavador.nombre, automatica, porcentajeComision: porcentaje, valorComision };
  });
}

async function crearOrden(req, res) {
  const { cita_id, turno_id, cliente_id, vehiculo_id, servicio_id, es_venta_anonima, placa_anonima, tipo_vehiculo_anonimo, lavadores_ids } = req.body;

  const servicio = await ServicioRepositorio.obtenerPorId(parseInt(servicio_id, 10));
  if (!servicio) return res.status(400).json({ error: 'Servicio no válido.' });

  const lavadoresAsignados = await calcularAsignacionLavadores(lavadores_ids, Number(servicio.precio));

  // Si la orden viene de un turno que a su vez venía de una cita (se agregó a
  // la fila en vez de atenderla de inmediato), heredamos su cita_id para que
  // la cita original también quede marcada como atendida.
  let citaId = cita_id ? parseInt(cita_id, 10) : null;
  if (!citaId && turno_id) {
    const turno = await AgendaRepositorio.obtenerTurnoPorId(parseInt(turno_id, 10));
    if (turno && turno.cita_id) citaId = turno.cita_id;
  }

  const ordenId = await OrdenServicioRepositorio.crearOrdenConAsignacion({
    citaId,
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
 * Cambia el estado de una orden (RF10).
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
  await OrdenServicioRepositorio.actualizarEstado(id, estado);

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
