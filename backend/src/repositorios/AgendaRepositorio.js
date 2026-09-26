/**
 * Acceso a datos de `citas` (agendamiento previo) y `turnos` (fila por
 * orden de llegada / walk-in). CU04, CU05, CU06 / RF04-RF07.
 */
const { pool } = require('../config/baseDeDatos');

const SELECT_CITAS = `
  SELECT c.*, cl.nombre AS cliente_nombre_reg, cl.telefono AS cliente_telefono_reg,
         v.placa AS placa_reg, v.tipo AS tipo_vehiculo_reg,
         s.nombre AS servicio_nombre, s.precio AS servicio_precio
  FROM citas c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  LEFT JOIN vehiculos v ON v.id = c.vehiculo_id
  LEFT JOIN servicios s ON s.id = c.servicio_id
`;

function mapearCita(fila) {
  return {
    ...fila,
    cliente_nombre: fila.cliente_nombre_reg || fila.cliente_nombre_temp || 'Anónimo',
    cliente_telefono: fila.cliente_telefono_reg || fila.cliente_telefono_temp || '',
    placa: fila.placa_reg || fila.placa_temp || 'N/A',
    tipo_vehiculo: fila.tipo_vehiculo_reg || 'carro'
  };
}

async function listarCitas(fecha) {
  const condicion = fecha ? 'WHERE c.fecha = ?' : '';
  const parametros = fecha ? [fecha] : [];
  const [filas] = await pool.query(`${SELECT_CITAS} ${condicion} ORDER BY c.hora`, parametros);
  return filas.map(mapearCita);
}

async function obtenerCitaPorId(id) {
  const [filas] = await pool.query(`SELECT * FROM citas WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function existeCitaEnHorario(fecha, hora) {
  const [filas] = await pool.query(
    `SELECT id FROM citas WHERE fecha = ? AND hora = ? AND estado = 'agendada'`,
    [fecha, hora]
  );
  return filas.length > 0;
}

async function crearCita(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO citas
      (cliente_id, vehiculo_id, servicio_id, fecha, hora, estado,
       cliente_nombre_temp, cliente_telefono_temp, placa_temp, registrado_por)
     VALUES (?, ?, ?, ?, ?, 'agendada', ?, ?, ?, ?)`,
    [
      datos.clienteId || null, datos.vehiculoId || null, datos.servicioId, datos.fecha, datos.hora,
      datos.clienteNombreTemp || '', datos.clienteTelefonoTemp || '', datos.placaTemp || '', datos.registradoPor
    ]
  );
  return obtenerCitaPorId(resultado.insertId);
}

async function actualizarCita(id, cambios) {
  const campos = [];
  const valores = [];
  for (const [columna, valor] of Object.entries(cambios)) {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  }
  if (campos.length === 0) return obtenerCitaPorId(id);

  valores.push(id);
  await pool.query(`UPDATE citas SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerCitaPorId(id);
}

// ---------------------------------------------------------------------------
// Turnos (walk-in)
// ---------------------------------------------------------------------------
/**
 * El número de turno visible NO se guarda fijo: se calcula aquí como la
 * posición de cada turno entre los que siguen "en_espera", ordenados por
 * llegada. Así, si el turno 1 se atiende (cambia de estado), deja de
 * contar y el que era 2 pasa a ser automáticamente el 1, sin huecos ni
 * necesidad de asignación manual.
 */
async function listarTurnosDeHoy(hoy) {
  const [filas] = await pool.query(
    `SELECT t.*, cl.nombre AS cliente_nombre_reg, s.nombre AS servicio_nombre, s.precio AS servicio_precio,
            v.placa AS placa_vehiculo
     FROM turnos t
     LEFT JOIN clientes cl ON cl.id = t.cliente_id
     LEFT JOIN servicios s ON s.id = t.servicio_id
     LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
     WHERE t.fecha = ?
     ORDER BY t.hora_llegada, t.id`,
    [hoy]
  );

  let posicion = 0;
  return filas.map(fila => ({
    ...fila,
    numero_turno: fila.estado === 'en_espera' ? ++posicion : null,
    cliente_nombre: fila.cliente_nombre_reg || 'Venta Rápida / Anónima',
    placa: fila.placa_temporal || fila.placa_vehiculo || 'Sin Placa'
  }));
}

async function obtenerTurnoPorId(id) {
  const [filas] = await pool.query(`SELECT * FROM turnos WHERE id = ?`, [id]);
  return filas[0] || null;
}

/**
 * Un mismo vehículo (registrado o anónimo, identificado por placa) no
 * puede tener dos turnos/servicios activos al mismo tiempo: eso es lo que
 * pasaba antes al generarle dos turnos distintos en vez de agregarle un
 * servicio adicional al que ya estaba en curso.
 */
async function existeVehiculoConServicioActivo({ vehiculoId, placa }) {
  const condiciones = [];
  const parametros = [];
  if (vehiculoId) { condiciones.push('vehiculo_id = ?'); parametros.push(vehiculoId); }
  if (placa) { condiciones.push('placa_temporal = ?'); parametros.push(placa); }
  if (condiciones.length === 0) return false;

  const [turnosActivos] = await pool.query(
    `SELECT id FROM turnos WHERE estado = 'en_espera' AND (${condiciones.join(' OR ')})`,
    parametros
  );
  if (turnosActivos.length > 0) return true;

  const condicionesOrden = [];
  const parametrosOrden = [];
  if (vehiculoId) { condicionesOrden.push('vehiculo_id = ?'); parametrosOrden.push(vehiculoId); }
  if (placa) { condicionesOrden.push('placa_anonima = ?'); parametrosOrden.push(placa); }

  const [ordenesActivas] = await pool.query(
    `SELECT id FROM ordenes_servicio WHERE estado IN ('recibido', 'en_proceso') AND (${condicionesOrden.join(' OR ')})`,
    parametrosOrden
  );
  return ordenesActivas.length > 0;
}

async function crearTurno(datos) {
  const [resultado] = await pool.query(
    `INSERT INTO turnos (cliente_id, vehiculo_id, cita_id, placa_temporal, tipo_vehiculo, servicio_id, fecha, hora_llegada, estado, registrado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en_espera', ?)`,
    [
      datos.clienteId || null, datos.vehiculoId || null, datos.citaId || null,
      datos.placaTemporal || '', datos.tipoVehiculo || 'carro',
      datos.servicioId, datos.fecha, datos.horaLlegada, datos.registradoPor
    ]
  );
  return obtenerTurnoPorId(resultado.insertId);
}

/**
 * Cancela un turno que sigue "en_espera" (el cliente se fue sin ser
 * atendido, cambió de opinión, etc.). Solo se puede cancelar mientras
 * espera: uno ya iniciado o finalizado no se toca desde aquí.
 */
async function cancelarTurno(id) {
  const [resultado] = await pool.query(
    `UPDATE turnos SET estado = 'cancelado' WHERE id = ? AND estado = 'en_espera'`,
    [id]
  );
  if (resultado.affectedRows === 0) return null;
  return obtenerTurnoPorId(id);
}

async function actualizarTurno(id, cambios) {
  const campos = [];
  const valores = [];
  for (const [columna, valor] of Object.entries(cambios)) {
    campos.push(`${columna} = ?`);
    valores.push(valor);
  }
  if (campos.length === 0) return obtenerTurnoPorId(id);

  valores.push(id);
  await pool.query(`UPDATE turnos SET ${campos.join(', ')} WHERE id = ?`, valores);
  return obtenerTurnoPorId(id);
}

module.exports = {
  listarCitas,
  obtenerCitaPorId,
  existeCitaEnHorario,
  crearCita,
  actualizarCita,
  listarTurnosDeHoy,
  obtenerTurnoPorId,
  existeVehiculoConServicioActivo,
  crearTurno,
  actualizarTurno,
  cancelarTurno
};
