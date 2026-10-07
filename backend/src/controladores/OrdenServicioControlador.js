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
const ClienteRepositorio = require('../repositorios/ClienteRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { obtenerFechaHoy } = require('../utilidades/fechas');
const { exigirServicioParaVehiculo } = require('../utilidades/vehiculos');
const { exigirClienteActivo } = require('../utilidades/clientes');

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
 *
 * Un lavador solo puede atender UN servicio a la vez: si ya tiene una orden
 * "en_proceso" (distinta de `ordenIdExcluir`, la que se está reasignando), no
 * se le puede asignar otra hasta que la termine, ni manual ni automáticamente.
 */
async function calcularAsignacionLavadores(lavadoresIds, precioServicio, ordenIdExcluir = null) {
  if (Array.isArray(lavadoresIds) && lavadoresIds.length > MAX_LAVADORES_POR_ORDEN) {
    throw Object.assign(new Error(`Un servicio admite máximo ${MAX_LAVADORES_POR_ORDEN} lavadores.`), { codigoHttp: 400 });
  }

  const presentesIds = new Set(await AsistenciaRepositorio.listarIdsPresentesHoy('lavador', obtenerFechaHoy()));
  const idsOcupados = new Set(await LavadorRepositorio.obtenerIdsOcupados(ordenIdExcluir));
  let lavadoresElegidos = [];

  if (Array.isArray(lavadoresIds) && lavadoresIds.length > 0) {
    const noDisponibles = [];
    const ocupados = [];
    const yaElegidos = new Set();
    for (const idCrudo of lavadoresIds) {
      const lavador = await LavadorRepositorio.obtenerActivoPorId(parseInt(idCrudo, 10));
      if (!lavador || yaElegidos.has(lavador.id)) continue;
      yaElegidos.add(lavador.id);
      if (!presentesIds.has(lavador.id)) {
        noDisponibles.push(lavador.nombre);
        continue;
      }
      if (idsOcupados.has(lavador.id)) {
        ocupados.push(lavador.nombre);
        continue;
      }
      lavadoresElegidos.push({ lavador, automatica: false });
    }
    if (noDisponibles.length > 0) {
      const verbo = noDisponibles.length > 1 ? 'no han registrado entrada hoy' : 'no ha registrado entrada hoy';
      throw Object.assign(new Error(`${noDisponibles.join(', ')} ${verbo} y no puede ser asignado a un servicio.`), { codigoHttp: 400 });
    }
    if (ocupados.length > 0) {
      const frase = ocupados.length > 1 ? 'ya están atendiendo otro servicio' : 'ya está atendiendo otro servicio';
      throw Object.assign(new Error(`${ocupados.join(', ')} ${frase} y no se puede asignar hasta que lo termine.`), { codigoHttp: 400 });
    }
  } else {
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

  // Si la orden viene de un turno que a su vez venía de una cita (se agregó a
  // la fila en vez de atenderla de inmediato), heredamos su cita_id para que
  // la cita original también quede marcada como atendida. La observación
  // escrita al agendar la cita o al ponerlo en fila pasa a la orden, para
  // que el lavador la vea al trabajar el servicio. Los servicios extra que
  // ya se le hayan agregado al turno mientras esperaba en la fila también
  // se trasladan a la orden (y su valor entra en el total/comisión).
  let citaId = cita_id ? parseInt(cita_id, 10) : null;
  let observacion = null;
  let serviciosExtraTurno = [];
  let turno = null;
  if (turno_id) {
    const turnoIdNum = parseInt(turno_id, 10);
    turno = await AgendaRepositorio.obtenerTurnoPorId(turnoIdNum);
    if (turno) {
      if (!citaId && turno.cita_id) citaId = turno.cita_id;
      observacion = turno.observacion || null;
    }
    const extrasPorTurno = await AgendaRepositorio.obtenerServiciosExtraPorTurnos([turnoIdNum]);
    serviciosExtraTurno = extrasPorTurno[turnoIdNum] || [];
  }

  // Una cita solo se atiende el mismo día para el que fue agendada y mientras
  // siga pendiente: una cita de otro día (o ya cancelada/atendida) no se puede
  // convertir en servicio.
  let cita = null;
  if (citaId) {
    cita = await AgendaRepositorio.obtenerCitaPorId(citaId);
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada.' });
    if (!['agendada', 'reprogramada'].includes(cita.estado)) {
      return res.status(400).json({ error: `Esta cita está ${cita.estado}; ya no se puede atender.` });
    }
    if (cita.fecha !== obtenerFechaHoy()) {
      return res.status(400).json({ error: `Esta cita es del ${cita.fecha}; solo se puede atender el mismo día para el que fue agendada.` });
    }
    if (!observacion) observacion = cita.observacion || null;
  }

  const clienteId = cliente_id ? parseInt(cliente_id, 10) : null;
  const vehiculoId = vehiculo_id ? parseInt(vehiculo_id, 10) : null;
  await exigirClienteActivo({ clienteId, vehiculoId });
  let esVentaAnonima = !!es_venta_anonima;
  let placaAnonima = placa_anonima ? placa_anonima.toUpperCase().trim() : null;
  let tipoVehiculoAnonimo = tipo_vehiculo_anonimo || null;
  // Una cita anónima (sin cliente ni vehículo registrado) se atiende como
  // venta anónima con la placa y el tipo de vehículo con que se agendó.
  if (cita && !clienteId && !vehiculoId && !esVentaAnonima) {
    esVentaAnonima = true;
    placaAnonima = cita.placa_temp ? cita.placa_temp.toUpperCase().trim() : null;
    tipoVehiculoAnonimo = cita.tipo_vehiculo || null;
  }

  // El servicio tiene que ser del tipo de vehículo que se va a atender.
  let tipoVehiculo = null;
  if (vehiculoId) {
    const vehiculo = await ClienteRepositorio.obtenerVehiculoPorId(vehiculoId);
    tipoVehiculo = vehiculo ? vehiculo.tipo : null;
  } else if (esVentaAnonima && tipoVehiculoAnonimo) {
    tipoVehiculo = tipoVehiculoAnonimo;
  } else if (turno) {
    tipoVehiculo = turno.tipo_vehiculo;
  }
  exigirServicioParaVehiculo(servicio, tipoVehiculo);

  const totalExtras = serviciosExtraTurno.reduce((suma, e) => suma + Number(e.precio), 0);
  const totalOrden = Number(servicio.precio) + totalExtras;

  const lavadoresAsignados = await calcularAsignacionLavadores(lavadores_ids, totalOrden);

  const ordenId = await OrdenServicioRepositorio.crearOrdenConAsignacion({
    citaId,
    turnoId: turno_id ? parseInt(turno_id, 10) : null,
    clienteId,
    vehiculoId,
    servicioId: servicio.id,
    esVentaAnonima,
    placaAnonima,
    tipoVehiculoAnonimo,
    total: totalOrden,
    observacion,
    registradoPor: req.usuarioAutenticado.id,
    lavadoresAsignados,
    serviciosExtra: serviciosExtraTurno.map(e => ({ servicioId: e.servicio_id, precio: Number(e.precio) }))
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_orden_pos', `Creada orden #${ordenId} por $${totalOrden} (${servicio.nombre}${totalExtras > 0 ? ` + ${serviciosExtraTurno.length} servicio(s) extra` : ''})`);

  const ordenes = await OrdenServicioRepositorio.listarOrdenes({});
  res.status(201).json(ordenes.find(o => o.id === ordenId));
}

/**
 * Cambia el estado de una orden (RF10).
 */
// A partir de "en_proceso" siempre debe haber al menos un lavador asignado
// a la orden; sin lavador no se permite avanzar en ningún caso.
const ESTADOS_QUE_REQUIEREN_LAVADOR = ['en_proceso', 'terminado', 'entregado'];

async function actualizarEstadoOrden(req, res) {
  const id = Number(req.params.id);
  const { estado } = req.body;
  const estadosValidos = ['recibido', 'en_proceso', 'terminado', 'entregado', 'cancelado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: 'Estado no válido.' });
  }

  const orden = await OrdenServicioRepositorio.obtenerOrdenPorId(id);
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada.' });

  // Un servicio que ya terminó (listo para cobrar) o ya fue entregado no se
  // puede cancelar: el trabajo está hecho y solo falta cobrarlo (o ya se cobró).
  if (estado === 'cancelado' && ['terminado', 'entregado'].includes(orden.estado)) {
    return res.status(400).json({
      error: orden.estado === 'entregado'
        ? 'No se puede cancelar una orden ya entregada y pagada.'
        : 'No se puede cancelar un servicio que ya está listo para cobrar. Cóbrelo (puede aplicar un descuento si corresponde).'
    });
  }

  if (ESTADOS_QUE_REQUIEREN_LAVADOR.includes(estado)) {
    const lavadoresPorOrden = await OrdenServicioRepositorio.obtenerLavadoresPorOrdenes([id]);
    const tieneLavador = (lavadoresPorOrden[id] || []).length > 0;
    if (!tieneLavador) {
      return res.status(400).json({ error: `No se puede pasar la orden a "${estado}" sin un lavador asignado. Asigne un lavador primero.` });
    }
  }

  const estadoAnterior = orden.estado;
  await OrdenServicioRepositorio.actualizarEstado(id, estado);

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_estado_orden', `Orden #${id} cambió de ${estadoAnterior} a ${estado}`);

  const ordenes = await OrdenServicioRepositorio.listarOrdenes({});
  res.json(ordenes.find(o => o.id === id));
}

/**
 * Agrega un servicio adicional a una orden ya activa (RF08): así un mismo
 * vehículo puede recibir varios servicios en una sola visita sin generarle
 * un turno/orden nuevo y duplicado (ver AgendaRepositorio.existeVehiculoConServicioActivo).
 */
async function agregarServicioExtra(req, res) {
  const id = Number(req.params.id);
  const { servicio_id } = req.body;
  if (!servicio_id) {
    return res.status(400).json({ error: 'Debe indicar el servicio a agregar.' });
  }

  const orden = await OrdenServicioRepositorio.obtenerOrdenPorId(id);
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada.' });
  if (!['recibido', 'en_proceso'].includes(orden.estado)) {
    return res.status(400).json({ error: 'Solo se pueden agregar servicios a una orden recibida o en proceso.' });
  }

  const servicio = await ServicioRepositorio.obtenerPorId(parseInt(servicio_id, 10));
  if (!servicio) return res.status(400).json({ error: 'Servicio no válido.' });

  // El servicio adicional debe ser del mismo tipo de vehículo de la orden.
  let tipoVehiculo = orden.tipo_vehiculo_anonimo || null;
  if (orden.vehiculo_id) {
    const vehiculo = await ClienteRepositorio.obtenerVehiculoPorId(orden.vehiculo_id);
    if (vehiculo) tipoVehiculo = vehiculo.tipo;
  }
  exigirServicioParaVehiculo(servicio, tipoVehiculo);

  await OrdenServicioRepositorio.agregarServicioExtra(id, {
    servicioId: servicio.id,
    precio: Number(servicio.precio),
    agregadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(
    req.usuarioAutenticado.id, 'agregar_servicio_extra',
    `Orden #${id}: agregado servicio adicional "${servicio.nombre}" ($${servicio.precio})`
  );

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

  if (!['recibido', 'en_proceso'].includes(orden.estado)) {
    return res.status(400).json({ error: 'Solo se pueden asignar lavadores a una orden recibida o en proceso.' });
  }

  const lavadoresAsignados = await calcularAsignacionLavadores(lavadores_ids, Number(orden.total), id);
  if (lavadoresAsignados.length === 0) {
    return res.status(400).json({ error: 'No hay lavadores disponibles para asignar en este momento (deben haber registrado entrada hoy y estar libres). La orden permanece en "Recibido".' });
  }
  await OrdenServicioRepositorio.reemplazarLavadoresAsignados(id, lavadoresAsignados);

  await AuditoriaRepositorio.registrar(
    req.usuarioAutenticado.id, 'asignar_lavadores',
    `Orden #${id} reasignada a ${lavadoresAsignados.map(l => l.nombre).join(', ') || 'ningún lavador'}`
  );

  const ordenes = await OrdenServicioRepositorio.listarOrdenes({});
  res.json(ordenes.find(o => o.id === id));
}

module.exports = { listarOrdenes, crearOrden, actualizarEstadoOrden, asignarLavadores, agregarServicioExtra };
