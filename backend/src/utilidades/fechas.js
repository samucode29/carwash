/**
 * Helpers de fecha/hora compartidos por controladores y repositorios.
 * Todo el sistema trabaja en hora local del servidor (Colombia).
 */

function obtenerFechaHoy() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function obtenerFechaHoraActual() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19); // YYYY-MM-DD HH:mm:ss
}

function obtenerHoraActual() {
  return new Date().toTimeString().substring(0, 5); // HH:mm
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
      const hace7Dias = new Date(hoy.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { inicio: hace7Dias.toISOString().split('T')[0], fin: hoyStr };
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
  calcularRangoPorPeriodo
};
