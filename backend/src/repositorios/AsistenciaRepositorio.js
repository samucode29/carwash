/**
 * Acceso a datos de asistencia de personal (CU27 / RF35). Cubre tanto
 * usuarios (empleado/administrador) como lavadores, distinguidos por
 * `persona_tipo` ya que viven en tablas distintas.
 */
const { pool } = require('../config/baseDeDatos');

async function listarPorFecha(fecha) {
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE fecha = ?`, [fecha]);

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

async function marcarSalida(id, horaSalida, horasTrabajadas) {
  await pool.query(`UPDATE asistencia SET hora_salida = ?, horas_trabajadas = ? WHERE id = ?`, [horaSalida, horasTrabajadas, id]);
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
}

async function marcarEntrada(id, horaEntrada) {
  await pool.query(`UPDATE asistencia SET hora_entrada = ?, inasistencia = FALSE WHERE id = ?`, [horaEntrada, id]);
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
}

async function marcarInasistencia(id, inasistencia) {
  await pool.query(`UPDATE asistencia SET inasistencia = ? WHERE id = ?`, [!!inasistencia, id]);
  const [filas] = await pool.query(`SELECT * FROM asistencia WHERE id = ?`, [id]);
  return filas[0];
}

module.exports = {
  listarPorFecha,
  obtenerRegistroDelDia,
  crearRegistro,
  marcarSalida,
  marcarEntrada,
  marcarInasistencia
};
