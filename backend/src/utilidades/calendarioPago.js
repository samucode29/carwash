/**
 * Calendario de pago de salarios: cada empleado tiene un "día de pago" y con
 * él se sabe cuándo le toca el próximo pago y si va atrasado. Esto SOLO
 * informa: el pago se puede registrar en cualquier momento, no únicamente el
 * día que toca.
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
 * Cómo va el pago de un empleado:
 *  - sin_dia: no tiene día de pago definido.
 *  - vencido: ya pasó un día de pago y no se le ha pagado desde entonces.
 *  - hoy:     hoy le toca y aún no se le ha pagado.
 *  - proximo: le toca más adelante (también se le puede pagar ya).
 *  - al_dia:  ya se le pagó este ciclo.
 * `fechasPagos`: fechas ('YYYY-MM-DD') en que se le ha pagado.
 */
function estadoDePago({ periodicidad, diaPago, fechaIngreso }, fechasPagos, hoy) {
  if (!diaPago) return { estado: 'sin_dia', fecha: null, dias: null, texto: 'Sin día de pago definido' };

  const fechaHoy = parsearFechaLocal(hoy);
  const fechas = fechasDePago(periodicidad, diaPago, sumarDias(fechaHoy, -120), sumarDias(fechaHoy, 120));
  const i = fechas.findIndex((f) => f >= hoy);
  if (i < 2) return { estado: 'sin_dia', fecha: null, dias: null, texto: 'Sin día de pago definido' };

  const proxima = fechas[i];
  const anterior = fechas[i - 1];
  const antesDeAnterior = fechas[i - 2];
  const pagos = (fechasPagos || []).filter(Boolean);
  const ingreso = fechaIngreso ? String(fechaIngreso).substring(0, 10) : null;

  // Un pago hecho después del día de pago anterior cubre el ciclo actual (aunque sea adelantado).
  const pagadoCicloActual = pagos.some((f) => f > anterior);
  const pagadoCicloAnterior = pagos.some((f) => f > antesDeAnterior);
  if (!pagadoCicloAnterior && (!ingreso || ingreso <= anterior)) {
    const dias = diasEntre(anterior, hoy);
    return { estado: 'vencido', fecha: anterior, dias, texto: `Pago vencido: tocaba el ${anterior} (hace ${dias} ${dias === 1 ? 'día' : 'días'})` };
  }
  if (pagadoCicloActual) {
    const siguiente = fechas[i + 1];
    return { estado: 'al_dia', fecha: siguiente, dias: diasEntre(hoy, siguiente), texto: `Al día. Próximo pago: ${siguiente}` };
  }
  const dias = diasEntre(hoy, proxima);
  if (dias === 0) return { estado: 'hoy', fecha: proxima, dias, texto: 'Hoy toca pagarle' };
  return { estado: 'proximo', fecha: proxima, dias, texto: `Próximo pago: ${proxima} (en ${dias} ${dias === 1 ? 'día' : 'días'})` };
}

/** Valida el día de pago según la periodicidad; devuelve el número, null (sin día) o undefined si es inválido. */
function normalizarDiaPago(valor, periodicidad) {
  if (valor === null || valor === '' || valor === undefined) return null;
  const n = parseInt(valor, 10);
  const max = periodicidad === 'semanal' ? 7 : 31;
  if (!Number.isInteger(n) || n < 1 || n > max) return undefined;
  return n;
}

module.exports = { fechasDePago, estadoDePago, normalizarDiaPago };
