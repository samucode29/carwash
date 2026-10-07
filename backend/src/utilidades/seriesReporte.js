/**
 * Series de tiempo para los gráficos de los reportes: un solo día se grafica
 * por hora, hasta ~2 meses por día y más que eso por mes. Funciones puras
 * (reciben las filas ya consultadas), compartidas por todos los reportes.
 */
const { parsearFechaLocal } = require('./fechas');

const DIAS_ABREV = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MAX_DIAS_GRAFICO_DIARIO = 62;

function etiquetaHora(h) {
  return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
}

/**
 * Plan de una serie para el rango [inicio, fin]. `forzado` ({gran, n}) sirve
 * para que el período anterior use los mismos "cubos" que el actual y las
 * dos series se puedan superponer.
 */
function planSerie(inicio, fin, forzado = null) {
  const dIni = parsearFechaLocal(inicio);
  const dFin = parsearFechaLocal(fin);
  const dias = Math.round((dFin - dIni) / 86400000) + 1;
  const gran = forzado ? forzado.gran : (dias === 1 ? 'hora' : dias <= MAX_DIAS_GRAFICO_DIARIO ? 'dia' : 'mes');

  if (gran === 'hora') {
    return {
      gran, n: 24,
      etiquetas: Array.from({ length: 24 }, (_, h) => etiquetaHora(h)),
      indice: (fechaHora) => Number(String(fechaHora).substring(11, 13)) || 0
    };
  }

  if (gran === 'dia') {
    const n = forzado ? forzado.n : dias;
    const etiquetas = Array.from({ length: n }, (_, i) => {
      const d = new Date(dIni.getFullYear(), dIni.getMonth(), dIni.getDate() + i);
      const dd = String(d.getDate()).padStart(2, '0');
      return n <= 14 ? `${DIAS_ABREV[d.getDay()]} ${dd}` : `${dd}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    return {
      gran, n, etiquetas,
      indice: (fechaHora) => Math.round((parsearFechaLocal(String(fechaHora).substring(0, 10)) - dIni) / 86400000)
    };
  }

  const mesesEntre = (dFin.getFullYear() * 12 + dFin.getMonth()) - (dIni.getFullYear() * 12 + dIni.getMonth()) + 1;
  const n = forzado ? forzado.n : mesesEntre;
  const etiquetas = Array.from({ length: n }, (_, i) => {
    const d = new Date(dIni.getFullYear(), dIni.getMonth() + i, 1);
    return `${MESES_ABREV[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  });
  return {
    gran, n, etiquetas,
    indice: (fechaHora) => {
      const d = parsearFechaLocal(String(fechaHora).substring(0, 10));
      return (d.getFullYear() * 12 + d.getMonth()) - (dIni.getFullYear() * 12 + dIni.getMonth());
    }
  };
}

/** Suma `valor(fila)` en el cubo que le toca a `fecha(fila)` según el plan. */
function acumularSerie(plan, filas, fecha, valor) {
  const valores = new Array(plan.n).fill(0);
  filas.forEach((f) => {
    const i = plan.indice(fecha(f));
    if (i >= 0 && i < plan.n) valores[i] += Number(valor(f)) || 0;
  });
  return valores.map(v => Number(v.toFixed(2)));
}

/** Total por día de la semana, de lunes a domingo. */
function acumularPorDiaSemana(filas, fecha, valor) {
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const totales = new Array(7).fill(0);
  const cantidades = new Array(7).fill(0);
  filas.forEach((f) => {
    const dia = parsearFechaLocal(String(fecha(f)).substring(0, 10)).getDay();
    const i = orden.indexOf(dia);
    totales[i] += Number(valor(f)) || 0;
    cantidades[i] += 1;
  });
  return {
    etiquetas: orden.map(d => DIAS_ABREV[d]),
    nombresCompletos: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
    totales: totales.map(v => Number(v.toFixed(2))),
    cantidades
  };
}

module.exports = { planSerie, acumularSerie, acumularPorDiaSemana, etiquetaHora, DIAS_ABREV, MESES_ABREV };
