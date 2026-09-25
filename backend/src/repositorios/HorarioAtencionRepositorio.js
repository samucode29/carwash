/**
 * Acceso a datos del horario de atención semanal (una fila por día,
 * 0=domingo..6=sábado). Las citas no se pueden agendar fuera de este
 * horario ni en un día marcado como cerrado (CU04 / RF04).
 */
const { pool } = require('../config/baseDeDatos');

async function listar() {
  const [filas] = await pool.query(`SELECT * FROM horario_atencion ORDER BY dia_semana`);
  return filas;
}

async function obtenerPorDia(diaSemana) {
  const [filas] = await pool.query(`SELECT * FROM horario_atencion WHERE dia_semana = ?`, [diaSemana]);
  return filas[0] || null;
}

async function actualizarDia(diaSemana, { abierto, horaApertura, horaCierre }) {
  await pool.query(
    `UPDATE horario_atencion SET abierto = ?, hora_apertura = ?, hora_cierre = ? WHERE dia_semana = ?`,
    [abierto, abierto ? horaApertura : null, abierto ? horaCierre : null, diaSemana]
  );
  return obtenerPorDia(diaSemana);
}

module.exports = { listar, obtenerPorDia, actualizarDia };
