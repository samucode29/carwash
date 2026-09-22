/**
 * Controlador de reportes y dashboard (CU18, CU19, CU29 / RF19, RF20, RF25,
 * RF26). Soporta período rápido (día/semana/mes/año) o un rango
 * personalizado, en formato JSON o descargado como PDF.
 */
const ReporteRepositorio = require('../repositorios/ReporteRepositorio');
const { calcularRangoPorPeriodo } = require('../utilidades/fechas');
const { generarPdfReporte } = require('../utilidades/generadorReportePdf');

const ETIQUETAS_PERIODO = {
  dia: 'Hoy', semana: 'Últimos 7 días', mes: 'Mes actual', ano: 'Año actual', personalizado: 'Rango personalizado'
};

function resolverRango(query) {
  const periodo = query.periodo || 'dia';
  const rango = calcularRangoPorPeriodo(periodo, query.fecha_inicio, query.fecha_fin);
  return { periodo, rango };
}

/** Reporte en JSON, usado por el dashboard interactivo del frontend. */
async function obtenerReporte(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporte(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

/** Mismo reporte pero entregado como archivo PDF descargable. */
async function descargarReportePdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporte(rango.inicio, rango.fin);
  const etiqueta = periodo === 'personalizado'
    ? `${rango.inicio} a ${rango.fin}`
    : ETIQUETAS_PERIODO[periodo] || periodo;

  generarPdfReporte(res, reporte, { etiquetaPeriodo: etiqueta });
}

module.exports = { obtenerReporte, descargarReportePdf };
