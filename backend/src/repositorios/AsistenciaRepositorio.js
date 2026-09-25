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

  const [usuarios] = idsUsuarios.length ? await pool.query(`SELECT id, nombre, rol FROM usuarios WHERE id IN (?)`, [idsUsuarios]) : [[]];
  const [lavadores] = idsLavadores.length ? await pool.query(`SELECT id, nombre FROM lavadores WHERE id IN (?)`, [idsLavadores]) : [[]];

  return filas.map(fila => {
    const persona = fila.persona_tipo === 'usuario'
      ? usuarios.find(u => u.id === fila.persona_id)
      : lavadores.find(l => l.id === fila.persona_id);

    return {
      ...fila,
      usuario_id: fila.persona_id, // alias de compatibilidad para el frontend
      usuario_nombre: persona ? persona.nombre : 'Personal',
      usuario_rol: fila.persona_tipo === 'usuario' ? persona?.rol : 'lavador'
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
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [resultado.insertId]);
  return filas[0];
}

// horasTrabajadas ya viene neta (sin las horas de descanso/almuerzo); se
// guarda también horasDescanso para que quede visible en el reporte.
async function marcarSalida(id, horaSalida, horasTrabajadas, horasDescanso) {
  await pool.query(
    `UPDATE asistencia SET hora_salida = ?, horas_trabajadas = ?, horas_descanso = ? WHERE id = ?`,
    [horaSalida, horasTrabajadas, horasDescanso || 0, id]
  );
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
}

// Al volver a marcar entrada (ej. re-registrar el día) hay que limpiar una
// salida/horas anteriores del mismo día; si no, la persona queda marcada
// como "Finalizado" aunque acabe de registrar su entrada de nuevo.
async function marcarEntrada(id, horaEntrada) {
  await pool.query(
    `UPDATE asistencia SET hora_entrada = ?, hora_salida = NULL, horas_trabajadas = 0, horas_descanso = 0, inasistencia = FALSE WHERE id = ?`,
    [horaEntrada, id]
  );
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
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
  marcarInasistencia,
  listarIdsPresentesHoy,
  listarEstadoAsistenciaHoy
};
