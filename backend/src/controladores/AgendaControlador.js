/**
 * Controlador de agenda: citas previas y turnos por orden de llegada
 * (CU04, CU05, CU06 / RF04-RF07).
 */
const AgendaRepositorio = require('../repositorios/AgendaRepositorio');
const HorarioAtencionRepositorio = require('../repositorios/HorarioAtencionRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { obtenerFechaHoy, obtenerFechaHoraActual, obtenerHoraActual, obtenerDiaSemana, NOMBRES_DIAS_SEMANA } = require('../utilidades/fechas');

/**
 * Una cita no se puede agendar/reprogramar fuera del horario de atención
 * configurado por el administrador para ese día de la semana (CU04 / RF04).
 */
async function validarDentroDeHorarioAtencion(fecha, hora) {
  const diaSemana = obtenerDiaSemana(fecha);
  const horario = await HorarioAtencionRepositorio.obtenerPorDia(diaSemana);
  const nombreDia = NOMBRES_DIAS_SEMANA[diaSemana];

  if (!horario || !horario.abierto) {
    throw Object.assign(new Error(`No hay atención los días ${nombreDia}. Elija otra fecha para la cita.`), { codigoHttp: 400 });
  }

  const horaComparable = hora.length === 5 ? `${hora}:00` : hora;
  if (horaComparable < horario.hora_apertura || horaComparable > horario.hora_cierre) {
    throw Object.assign(new Error(
      `El horario de atención los ${nombreDia} es de ${horario.hora_apertura.substring(0, 5)} a ${horario.hora_cierre.substring(0, 5)}. Elija una hora dentro de ese rango.`
    ), { codigoHttp: 400 });
  }
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------
async function listarCitas(req, res) {
  const citas = await AgendaRepositorio.listarCitas(req.query.fecha);
  res.json(citas);
}

async function crearCita(req, res) {
  const { cliente_id, vehiculo_id, servicio_id, fecha, hora, cliente_nombre, cliente_telefono, placa } = req.body;
  if (!servicio_id || !fecha || !hora) {
    return res.status(400).json({ error: 'Servicio, fecha y hora son obligatorios.' });
  }

  await validarDentroDeHorarioAtencion(fecha, hora);

  const ocupada = await AgendaRepositorio.existeCitaEnHorario(fecha, hora);
  if (ocupada) {
    return res.status(400).json({ error: 'Ya existe una cita agendada para esa fecha y hora. Elija otro horario.' });
  }

  const nueva = await AgendaRepositorio.crearCita({
    clienteId: cliente_id ? parseInt(cliente_id, 10) : null,
    vehiculoId: vehiculo_id ? parseInt(vehiculo_id, 10) : null,
    servicioId: parseInt(servicio_id, 10),
    fecha,
    hora,
    clienteNombreTemp: cliente_nombre,
    clienteTelefonoTemp: cliente_telefono,
    placaTemp: placa ? placa.toUpperCase().trim() : '',
    registradoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'agendar_cita', `Agendada cita ID ${nueva.id} para ${fecha} ${hora}`);
  res.status(201).json(nueva);
}

async function actualizarCita(req, res) {
  const id = Number(req.params.id);
  const { estado, fecha, hora } = req.body;

  if (fecha || hora) {
    const actual = await AgendaRepositorio.obtenerCitaPorId(id);
    if (!actual) return res.status(404).json({ error: 'Cita no encontrada.' });
    await validarDentroDeHorarioAtencion(fecha || actual.fecha, hora || actual.hora);
  }

  const cambios = {};
  if (estado) cambios.estado = estado;
  if (fecha) cambios.fecha = fecha;
  if (hora) cambios.hora = hora;

  const cita = await AgendaRepositorio.actualizarCita(id, cambios);
  if (!cita) return res.status(404).json({ error: 'Cita no encontrada.' });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'modificar_cita', `Cita ID ${id} actualizada a estado: ${cita.estado}`);
  res.json(cita);
}

// ---------------------------------------------------------------------------
// Turnos (walk-in)
// ---------------------------------------------------------------------------
async function listarTurnosDeHoy(req, res) {
  const turnos = await AgendaRepositorio.listarTurnosDeHoy(obtenerFechaHoy());
  res.json(turnos);
}

async function crearTurno(req, res) {
  const { cliente_id, vehiculo_id, cita_id, placa_temporal, tipo_vehiculo, servicio_id } = req.body;
  if (!servicio_id) {
    return res.status(400).json({ error: 'El servicio es obligatorio para generar un turno.' });
  }

  const placaLimpia = placa_temporal ? placa_temporal.toUpperCase().trim() : null;
  const yaTieneServicioActivo = await AgendaRepositorio.existeVehiculoConServicioActivo({
    vehiculoId: vehiculo_id ? parseInt(vehiculo_id, 10) : null,
    placa: placaLimpia
  });
  if (yaTieneServicioActivo) {
    return res.status(400).json({
      error: 'Este vehículo ya tiene un turno o servicio en curso. Si necesita otro servicio, agréguelo a la orden activa con el botón "+ Servicio" en vez de generar un turno nuevo.'
    });
  }

  const hoy = obtenerFechaHoy();

  // El número de turno ya no se asigna a mano: siempre es automático, por
  // orden de llegada (ver AgendaRepositorio.listarTurnosDeHoy), para evitar
  // duplicados/huecos y que al atender el turno 1 el 2 pase a ser el 1.
  const nuevo = await AgendaRepositorio.crearTurno({
    clienteId: cliente_id ? parseInt(cliente_id, 10) : null,
    vehiculoId: vehiculo_id ? parseInt(vehiculo_id, 10) : null,
    citaId: cita_id ? parseInt(cita_id, 10) : null,
    placaTemporal: placaLimpia || '',
    tipoVehiculo: tipo_vehiculo || 'carro',
    servicioId: parseInt(servicio_id, 10),
    fecha: hoy,
    horaLlegada: obtenerHoraActual(),
    registradoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_turno', `Turno generado #${nuevo.id} (${nuevo.placa_temporal})`);
  res.status(201).json(nuevo);
}

async function actualizarTurno(req, res) {
  const id = Number(req.params.id);
  const turno = await AgendaRepositorio.actualizarTurno(id, req.body.estado ? { estado: req.body.estado } : {});
  if (!turno) return res.status(404).json({ error: 'Turno no encontrado.' });
  res.json(turno);
}

module.exports = { listarCitas, crearCita, actualizarCita, listarTurnosDeHoy, crearTurno, actualizarTurno };
