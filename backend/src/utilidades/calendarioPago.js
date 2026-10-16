/**
 * Calendario de pago de salarios: cada empleado tiene un "día de pago" y con
 * él se sabe cuándo le toca el próximo pago y si va atrasado. A diferencia de
 * los lavadores (a quienes se liquida cuando se quiera), un empleado solo se
 * paga en su fecha de pago, o después si se atrasó.
 *
 * Significado de `diaPago` según la periodicidad:
 *  - mensual:   ese día de cada mes (si el mes es más corto, el último día).
 *  - quincenal: ese día y 15 días después (16 -> el 1 y el 16; 15 -> el 15 y el 30).
 *  - semanal:   día de la semana, 1 = lunes ... 7 = domingo.
 */
const { formatearFechaLocal, parsearFechaLocal } = require('./fechas');

function sumarDias(fecha, dias) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
}

/** Fechas ('YYYY-MM-DD', ordenadas) en que toca pagar entre `desde` y `hasta` (objetos Date). */
function fechasDePago(periodicidad, diaPago, desde, hasta) {
  const dia = Number(diaPago);
  if (!dia) return [];
  const fechas = new Set();

  if (periodicidad === 'semanal') {
    for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
      if ((d.getDay() || 7) === dia) fechas.add(formatearFechaLocal(d));
    }
    return [...fechas].sort();
  }

  const diasDelMes = periodicidad === 'quincenal' ? [dia > 15 ? dia - 15 : dia, (dia > 15 ? dia - 15 : dia) + 15] : [dia];
  for (let y = desde.getFullYear(), m = desde.getMonth(); y < hasta.getFullYear() || (y === hasta.getFullYear() && m <= hasta.getMonth());) {
    const ultimo = new Date(y, m + 1, 0).getDate();
    diasDelMes.forEach((dm) => {
      const f = new Date(y, m, Math.min(dm, ultimo));
      if (f >= desde && f <= hasta) fechas.add(formatearFechaLocal(f));
    });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return [...fechas].sort();
}

function diasEntre(desdeStr, hastaStr) {
  return Math.round((parsearFechaLocal(hastaStr) - parsearFechaLocal(desdeStr)) / 86400000);
}

/**
 * Día de pago que realmente rige: el que se le definió al empleado o, si no
 * tiene, el del día en que ingresó (mensual/quincenal: el día del mes;
 * semanal: el mismo día de la semana).
 */
function diaPagoEfectivo({ periodicidad, diaPago, fechaIngreso }) {
  if (diaPago) return Number(diaPago);
  if (!fechaIngreso) return null;
  const f = parsearFechaLocal(String(fechaIngreso).substring(0, 10));
  return periodicidad === 'semanal' ? (f.getDay() || 7) : f.getDate();
}

function mas1(fechaStr) {
  return formatearFechaLocal(sumarDias(parsearFechaLocal(fechaStr), 1));
}

/**
 * Cómo va el pago de un empleado. El salario solo se paga en su fecha de pago
 * (o después, si se atrasó): "hoy" y "vencido" son los estados en que se puede pagar.
 *  - vencido: ya pasó un día de pago y no se le ha pagado desde entonces.
 *  - hoy:     hoy le toca y aún no se le ha pagado.
 *  - proximo: le toca más adelante (todavía no se puede pagar).
 *  - al_dia:  ya se le pagó este ciclo.
 * Incluye el período (`periodoInicio`..`periodoFin`) que se paga en cada caso.
 * `fechasPagos`: fechas ('YYYY-MM-DD') en que se le ha pagado.
 */
function estadoDePago({ periodicidad, diaPago, fechaIngreso }, fechasPagos, hoy) {
  const dia = diaPagoEfectivo({ periodicidad, diaPago, fechaIngreso });
  if (!dia) return { estado: 'sin_dia', fecha: null, dias: null, puedePagar: false, texto: 'Sin día de pago definido' };

  const fechaHoy = parsearFechaLocal(hoy);
  const fechas = fechasDePago(periodicidad, dia, sumarDias(fechaHoy, -120), sumarDias(fechaHoy, 120));
  const i = fechas.findIndex((f) => f >= hoy);
  if (i < 2) return { estado: 'sin_dia', fecha: null, dias: null, puedePagar: false, texto: 'Sin día de pago definido' };

  const proxima = fechas[i];
  const anterior = fechas[i - 1];
  const antesDeAnterior = fechas[i - 2];
  const pagos = (fechasPagos || []).filter(Boolean);
  const ingreso = fechaIngreso ? String(fechaIngreso).substring(0, 10) : null;
  const desdeIngreso = (inicio) => (ingreso && ingreso > inicio ? ingreso : inicio);

  // Un pago hecho después del día de pago anterior cubre el ciclo actual.
  const pagadoCicloActual = pagos.some((f) => f > anterior);
  const pagadoCicloAnterior = pagos.some((f) => f > antesDeAnterior);
  // Está atrasado si ya trabajó el ciclo anterior completo (ingresó antes de que empezara) y no se le pagó.
  if (!pagadoCicloAnterior && (!ingreso || ingreso <= antesDeAnterior)) {
    const dias = diasEntre(anterior, hoy);
    return {
      estado: 'vencido', fecha: anterior, dias, puedePagar: true,
      periodoInicio: desdeIngreso(mas1(antesDeAnterior)), periodoFin: anterior,
      texto: `Pago vencido: tocaba el ${anterior} (hace ${dias} ${dias === 1 ? 'día' : 'días'})`
    };
  }
  if (pagadoCicloActual) {
    const siguiente = fechas[i + 1];
    return { estado: 'al_dia', fecha: siguiente, dias: diasEntre(hoy, siguiente), puedePagar: false, texto: `Al día. Próximo pago: ${siguiente}` };
  }
  const dias = diasEntre(hoy, proxima);
  const periodo = { periodoInicio: desdeIngreso(mas1(anterior)), periodoFin: proxima };
  if (dias === 0) return { estado: 'hoy', fecha: proxima, dias, puedePagar: true, ...periodo, texto: 'Hoy toca pagarle' };
  return { estado: 'proximo', fecha: proxima, dias, puedePagar: false, ...periodo, texto: `Próximo pago: ${proxima} (en ${dias} ${dias === 1 ? 'día' : 'días'}). Solo se le puede pagar ese día.` };
}

/** Valida el día de pago según la periodicidad; devuelve el número, null (sin día) o undefined si es inválido. */
function normalizarDiaPago(valor, periodicidad) {
  if (valor === null || valor === '' || valor === undefined) return null;
  const n = parseInt(valor, 10);
  const max = periodicidad === 'semanal' ? 7 : 31;
  if (!Number.isInteger(n) || n < 1 || n > max) return undefined;
  return n;
}

module.exports = { fechasDePago, estadoDePago, diaPagoEfectivo, normalizarDiaPago };
