/**
 * Formatos de texto compartidos por los reportes (pantalla y PDF): el mismo
 * número siempre se escribe igual en los dos lados.
 */
function moneda(valor) {
  const n = Math.round(Number(valor) || 0);
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('es-CO')}`;
}

function entero(valor) {
  return (Math.round(Number(valor) || 0)).toLocaleString('es-CO');
}

function decimal(valor, maxDecimales = 1) {
  return (Number(valor) || 0).toLocaleString('es-CO', { maximumFractionDigits: maxDecimales });
}

function porcentaje(valor, maxDecimales = 1) {
  return `${decimal(valor, maxDecimales)}%`;
}

/** Parte `parte` de `total`, en %, sin dividir entre cero. */
function participacion(parte, total) {
  return total > 0 ? (Number(parte) / total) * 100 : 0;
}

function fecha(valor) {
  return valor ? String(valor).substring(0, 10) : '-';
}

function fechaHora(valor) {
  return valor ? String(valor).substring(0, 16) : '-';
}

function capitalizar(texto) {
  const t = String(texto || '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

const ETIQUETAS_METODO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', pse: 'PSE' };
function etiquetaMetodo(metodo) {
  return ETIQUETAS_METODO[metodo] || capitalizar(metodo);
}

/** "mil", "2,4 M": para ejes de gráficos. */
function monedaCorta(valor) {
  const n = Number(valor) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000000) return `$${decimal(n / 1000000, 1)}M`;
  if (abs >= 1000) return `$${decimal(n / 1000, abs >= 100000 ? 0 : 1)}K`;
  return `$${decimal(n, 0)}`;
}

module.exports = { moneda, entero, decimal, porcentaje, participacion, fecha, fechaHora, capitalizar, etiquetaMetodo, monedaCorta };
