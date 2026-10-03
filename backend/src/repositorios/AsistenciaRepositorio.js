/**
 * Acceso a datos de asistencia de personal (CU27 / RF35). Cubre tanto
 * usuarios (empleado/administrador) como lavadores, distinguidos por
 * `persona_tipo` ya que viven en tablas distintas.
 */
const { pool } = require('../config/baseDeDatos');

async function listarPorFecha(fecha) {
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE fecha = ? ORDER BY id DESC`, [fecha]);

  const idsUsuarios = filas.filter(f => f.persona_tipo === 'usuario').map(f => f.persona_id);
  const idsLavadores = filas.filter(f => f.persona_tipo === 'lavador').map(f => f.persona_id);

  const [usuarios] = idsUsuarios.length ? await pool.query(`SELECT id, nombre, rol, jornada_horas_dia FROM usuarios WHERE id IN (?)`, [idsUsuarios]) : [[]];
  const [lavadores] = idsLavadores.length ? await pool.query(`SELECT id, nombre FROM lavadores WHERE id IN (?)`, [idsLavadores]) : [[]];
  const [sesiones] = filas.length
    ? await pool.query(`SELECT * FROM asistencia_sesiones WHERE asistencia_id IN (?) ORDER BY hora_entrada, id`, [filas.map(f => f.id)])
    : [[]];

  return filas.map(fila => {
    const persona = fila.persona_tipo === 'usuario'
      ? usuarios.find(u => u.id === fila.persona_id)
      : lavadores.find(l => l.id === fila.persona_id);

    return {
      ...fila,
      sesiones: sesiones.filter(s => s.asistencia_id === fila.id),
      usuario_id: fila.persona_id, // alias de compatibilidad para el frontend
      usuario_nombre: persona ? persona.nombre : 'Personal',
      usuario_rol: fila.persona_tipo === 'usuario' ? persona?.rol : 'lavador',
      // Solo aplica a empleados/administradores (jornada fija); un lavador
      // no tiene horario fijo, así que aquí siempre queda null para ellos.
      jornada_horas_dia: fila.persona_tipo === 'usuario' && persona ? Number(persona.jornada_horas_dia) : null
    };
  });
}

async function obtenerRegistroDelDia(personaTipo, personaId, fecha) {
  const [filas] = await pool.query(
    `SELECT * FROM asistencia WHERE persona_tipo = ? AND persona_id = ? AND fecha = ?`,
    [personaTipo, personaId, fecha]
  );
  return filas[0] || null;
}

async function crearRegistro({ personaTipo, personaId, fecha, horaEntrada, inasistencia }) {
  const [resultado] = await pool.query(
    `INSERT INTO asistencia (persona_tipo, persona_id, fecha, hora_entrada, inasistencia)
     VALUES (?, ?, ?, ?, ?)`,
    [personaTipo, personaId, fecha, inasistencia ? null : horaEntrada, !!inasistencia]
  );
  if (!inasistencia) {
    await pool.query(`INSERT INTO asistencia_sesiones (asistencia_id, hora_entrada) VALUES (?, ?)`, [resultado.insertId, horaEntrada]);
  }
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

function horasEntre(horaInicio, horaFin) {
  const [h1, m1] = String(horaInicio).split(':').map(Number);
  const [h2, m2] = String(horaFin).split(':').map(Number);
  return Math.max(0, parseFloat(((h2 + m2 / 60) - (h1 + m1 / 60)).toFixed(2)));
}

/**
 * Cierra la sesión abierta del día y la SUMA a lo ya acumulado (nunca
 * reemplaza): si la persona sale al almuerzo y vuelve a entrar, las horas de
 * la mañana siguen contando. El descanso/almuerzo se descuenta una sola vez
 * por día (la primera vez que se registra); después se ignora.
 */
async function marcarSalida(id, horaSalida, horasDescanso) {
  const [regs] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  const registro = regs[0];
  const [abiertas] = await pool.query(
    `SELECT * FROM asistencia_sesiones WHERE asistencia_id = ? AND hora_salida IS NULL ORDER BY id DESC LIMIT 1`,
    [id]
  );

  let horasSesion = 0;
  if (abiertas[0]) {
    horasSesion = horasEntre(abiertas[0].hora_entrada, horaSalida);
    await pool.query(`UPDATE asistencia_sesiones SET hora_salida = ?, horas = ? WHERE id = ?`, [horaSalida, horasSesion, abiertas[0].id]);
  }

  const descansoAplicado = Number(registro.horas_descanso) > 0 ? 0 : (horasDescanso || 0);
  const horasNetas = Math.max(0, parseFloat((horasSesion - descansoAplicado).toFixed(2)));
  await pool.query(
    `UPDATE asistencia
     SET hora_salida = ?, horas_trabajadas = horas_trabajadas + ?, horas_descanso = horas_descanso + ?
     WHERE id = ?`,
    [horaSalida, horasNetas, descansoAplicado, id]
  );
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
}

// Volver a marcar entrada el mismo día abre una sesión nueva y deja la
// persona como "presente" otra vez, pero conserva la primera hora de
// entrada, las horas ya acumuladas y el descanso ya registrado.
async function marcarEntrada(id, horaEntrada) {
  await pool.query(
    `UPDATE asistencia SET hora_entrada = COALESCE(hora_entrada, ?), hora_salida = NULL, inasistencia = FALSE WHERE id = ?`,
    [horaEntrada, id]
  );
  await pool.query(`INSERT INTO asistencia_sesiones (asistencia_id, hora_entrada) VALUES (?, ?)`, [id, horaEntrada]);
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
}

/** ¿Tiene la persona una sesión abierta (entró y todavía no ha salido)? */
async function tieneSesionAbierta(id) {
  const [filas] = await pool.query(`SELECT id FROM asistencia_sesiones WHERE asistencia_id = ? AND hora_salida IS NULL LIMIT 1`, [id]);
  return filas.length > 0;
}

async function marcarInasistencia(id, inasistencia) {
  await pool.query(`UPDATE asistencia SET inasistencia = ? WHERE id = ?`, [!!inasistencia, id]);
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
}

/**
 * IDs de personas que hoy ya registraron entrada, no han marcado salida
 * y no están reportadas como inasistencia: son las "disponibles" para
 * que se les asigne trabajo (CU07-CU10 / RF23, RF35).
 */
async function listarIdsPresentesHoy(personaTipo, fecha) {
  const [filas] = await pool.query(
    `SELECT persona_id FROM asistencia
     WHERE persona_tipo = ? AND fecha = ? AND hora_entrada IS NOT NULL
       AND hora_salida IS NULL AND inasistencia = FALSE`,
    [personaTipo, fecha]
  );
  return filas.map(f => f.persona_id);
}

/**
 * Estado de asistencia de hoy por persona: 'presente' (entrada marcada,
 * sin salida), 'finalizado' (ya marcó salida) o 'inasistencia'. Quien no
 * tiene ningún registro hoy no aparece en el resultado (equivale a "sin
 * asistencia" para quien consuma esto). Solo 'presente' debe poder
 * recibir asignación de un servicio nuevo.
 */
async function listarEstadoAsistenciaHoy(personaTipo, fecha) {
  const [filas] = await pool.query(
    `SELECT persona_id, hora_entrada, hora_salida, inasistencia
     FROM asistencia WHERE persona_tipo = ? AND fecha = ?`,
    [personaTipo, fecha]
  );
  const estados = {};
  filas.forEach((f) => {
    if (f.inasistencia) estados[f.persona_id] = 'inasistencia';
    else if (f.hora_salida) estados[f.persona_id] = 'finalizado';
    else if (f.hora_entrada) estados[f.persona_id] = 'presente';
  });
  return estados;
}

module.exports = {
  listarPorFecha,
  obtenerRegistroDelDia,
  crearRegistro,
  marcarSalida,
  marcarEntrada,
  tieneSesionAbierta,
  marcarInasistencia,
  listarIdsPresentesHoy,
  listarEstadoAsistenciaHoy
};
