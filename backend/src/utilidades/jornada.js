/**
 * Cálculo del valor-hora y las horas esperadas de la jornada laboral de un
 * empleado, para pagar el salario según lo realmente trabajado (horas de
 * asistencia) en vez de un monto fijo sin importar cuánto se trabajó.
 */
const FACTOR_PERIODICIDAD = { semanal: 1, quincenal: 2, mensual: 30 / 7 };

function calcularHorasEsperadasPorPeriodo(jornadaHorasDia, diasDescansoSemana, periodicidadPago) {
  const diasTrabajadosSemana = Math.max(0, 7 - Number(diasDescansoSemana));
  const horasEsperadasSemana = Number(jornadaHorasDia) * diasTrabajadosSemana;
  const factor = FACTOR_PERIODICIDAD[periodicidadPago] || FACTOR_PERIODICIDAD.quincenal;
  return Number((horasEsperadasSemana * factor).toFixed(2));
}

function calcularValorHora(salarioFijo, jornadaHorasDia, diasDescansoSemana, periodicidadPago) {
  const horasEsperadas = calcularHorasEsperadasPorPeriodo(jornadaHorasDia, diasDescansoSemana, periodicidadPago);
  if (horasEsperadas <= 0) return 0;
  return Number((Number(salarioFijo) / horasEsperadas).toFixed(2));
}

module.exports = { calcularHorasEsperadasPorPeriodo, calcularValorHora };
