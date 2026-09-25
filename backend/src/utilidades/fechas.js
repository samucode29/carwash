/**
 * Helpers de fecha/hora compartidos por controladores y repositorios.
 * Todo el sistema trabaja en hora LOCAL del servidor (Colombia, UTC-5).
 *
 * Importante: nunca usar toISOString() para obtener "la fecha de hoy",
 * porque esa función siempre devuelve la fecha en UTC. En Colombia
 * (UTC-5), entre las 7:00 p.m. y la medianoche locales, UTC ya está en
 * el día siguiente, así que toISOString() adelantaría la fecha un día
 * completo todas las tardes/noches (rompiendo asistencia, nómina, etc.).
 */

function formatearFechaLocal(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function obtenerFechaHoy() {
  return formatearFechaLocal(new Date()); // YYYY-MM-DD en hora local
}

function obtenerFechaHoraActual() {
  return `${obtenerFechaHoy()} ${new Date().toTimeString().substring(0, 8)}`; // YYYY-MM-DD HH:mm:ss local
}

function obtenerHoraActual() {
  return new Date().toTimeString().substring(0, 5); // HH:mm local
}

/** Convierte 'YYYY-MM-DD' a 'DDMMAA' (usado en la numeración de facturas). */
function formatearFechaCorta(fechaYyyyMmDd) {
  const [anio, mes, dia] = fechaYyyyMmDd.split('-');
  return `${dia}${mes}${anio.slice(2)}`;
}

/**
 * Calcula el rango [inicio, fin] (formato YYYY-MM-DD, ambos inclusive) para
 * los períodos de reporte soportados: día, semana, mes, año o un rango
 * personalizado indicado explícitamente por el usuario.
 */
function calcularRangoPorPeriodo(tipoPeriodo, fechaInicioPersonalizada, fechaFinPersonalizada) {
  const hoy = new Date();
  const hoyStr = obtenerFechaHoy();

  switch (tipoPeriodo) {
    case 'dia':
      return { inicio: hoyStr, fin: hoyStr };

    case 'semana': {
      const hace7Dias = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6);
      return { inicio: formatearFechaLocal(hace7Dias), fin: hoyStr };
    }

    case 'mes':
      return { inicio: `${hoyStr.substring(0, 7)}-01`, fin: hoyStr };

    case 'ano':
      return { inicio: `${hoyStr.substring(0, 4)}-01-01`, fin: hoyStr };

    case 'personalizado':
      if (!fechaInicioPersonalizada || !fechaFinPersonalizada) {
        throw new Error('Debe indicar fecha_inicio y fecha_fin para un período personalizado.');
      }
      return { inicio: fechaInicioPersonalizada, fin: fechaFinPersonalizada };

    default:
      return { inicio: hoyStr, fin: hoyStr };
  }
}

module.exports = {
  obtenerFechaHoy,
  obtenerFechaHoraActual,
  obtenerHoraActual,
  formatearFechaCorta,
  calcularRangoPorPeriodo
};
