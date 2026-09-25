/**
 * Controlador del horario de atención semanal (CU04 / RF04): consultarlo es
 * de uso diario (para validar y mostrar disponibilidad), editarlo es
 * exclusivo de administrador.
 */
const HorarioAtencionRepositorio = require('../repositorios/HorarioAtencionRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { NOMBRES_DIAS_SEMANA } = require('../utilidades/fechas');

async function listarHorario(req, res) {
  res.json(await HorarioAtencionRepositorio.listar());
}

async function actualizarDiaHorario(req, res) {
  const diaSemana = Number(req.params.dia);
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
    return res.status(400).json({ error: 'Día de la semana no válido.' });
  }

  const { abierto, hora_apertura, hora_cierre } = req.body;
  if (abierto && (!hora_apertura || !hora_cierre)) {
    return res.status(400).json({ error: 'Debe indicar hora de apertura y de cierre para un día abierto.' });
  }
  if (abierto && hora_apertura >= hora_cierre) {
    return res.status(400).json({ error: 'La hora de apertura debe ser antes que la hora de cierre.' });
  }

  const actualizado = await HorarioAtencionRepositorio.actualizarDia(diaSemana, {
    abierto: !!abierto,
    horaApertura: hora_apertura,
    horaCierre: hora_cierre
  });

  const descripcion = actualizado.abierto
    ? `${actualizado.hora_apertura.substring(0, 5)} a ${actualizado.hora_cierre.substring(0, 5)}`
    : 'sin atención';
  await AuditoriaRepositorio.registrar(
    req.usuarioAutenticado.id, 'actualizar_horario_atencion',
    `Horario de atención del ${NOMBRES_DIAS_SEMANA[diaSemana]} actualizado: ${descripcion}`
  );
  res.json(actualizado);
}

module.exports = { listarHorario, actualizarDiaHorario };
