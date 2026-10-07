/**
 * Controlador de reportes y dashboard (CU18, CU19, CU29 / RF19, RF20, RF25,
 * RF26). Cada reporte se arma UNA sola vez como "documento" (vistasReporte.js)
 * y de ahí se muestra en pantalla (JSON) o se descarga en PDF, así los
 * números y el diseño son idénticos en los dos lados. Todos soportan período
 * rápido (día/semana/mes/año) o un rango personalizado, salvo Inventario y
 * Clientes que son una foto del momento actual.
 */
const ReporteRepositorio = require('../repositorios/ReporteRepositorio');
const VistasReporte = require('../utilidades/vistasReporte');
const { calcularRangoPorPeriodo, obtenerFechaHoy } = require('../utilidades/fechas');
const { generarPdfDocumento } = require('../utilidades/generadorReportePdf');

const ETIQUETAS_PERIODO = {
  dia: 'Hoy', semana: 'Últimos 7 días', mes: 'Mes actual', ano: 'Año actual', personalizado: 'Rango personalizado'
};

// Reportes que son una foto del momento (no usan período).
const SIN_PERIODO = new Set(['inventario', 'clientes']);

function resolverRango(query) {
  const periodo = query.periodo || 'dia';
  const rango = calcularRangoPorPeriodo(periodo, query.fecha_inicio, query.fecha_fin);
  return { periodo, rango };
}

/**
 * Calcula los datos del reporte `tipo` y devuelve su documento (para pantalla o PDF).
 * Devuelve null si el tipo no existe.
 */
async function construirDocumento(tipoPedido, query) {
  const tipo = tipoPedido === 'dashboard' ? 'resumen' : tipoPedido;
  const hoy = obtenerFechaHoy();

  if (tipo === 'inventario') {
    return VistasReporte.vistaInventario(await ReporteRepositorio.calcularReporteInventario(), hoy);
  }
  if (tipo === 'clientes') {
    return VistasReporte.vistaClientes(await ReporteRepositorio.calcularReporteClientes(), hoy);
  }

  const { periodo, rango } = resolverRango(query);
  const etiqueta = periodo === 'personalizado' ? 'Rango personalizado' : (ETIQUETAS_PERIODO[periodo] || periodo);
  const per = { etiqueta, inicio: rango.inicio, fin: rango.fin };

  switch (tipo) {
    case 'resumen': {
      const actual = await ReporteRepositorio.calcularReporte(rango.inicio, rango.fin);
      const anterior = ReporteRepositorio.calcularRangoAnterior(rango.inicio, rango.fin);
      const previo = await ReporteRepositorio.calcularReporte(anterior.inicio, anterior.fin);
      return VistasReporte.vistaResumen(actual, previo, per);
    }
    case 'ventas': return VistasReporte.vistaVentas(await ReporteRepositorio.calcularReporteVentas(rango.inicio, rango.fin), per);
    case 'compras': return VistasReporte.vistaCompras(await ReporteRepositorio.calcularReporteCompras(rango.inicio, rango.fin), per);
    case 'nomina': return VistasReporte.vistaNomina(await ReporteRepositorio.calcularReporteNomina(rango.inicio, rango.fin), per);
    case 'comparativo': return VistasReporte.vistaComparativo(await ReporteRepositorio.calcularReporteComparativo(rango.inicio, rango.fin), per);
    case 'operativo': return VistasReporte.vistaOperativo(await ReporteRepositorio.calcularReporteOperativo(rango.inicio, rango.fin), per);
    case 'asistencia': return VistasReporte.vistaAsistencia(await ReporteRepositorio.calcularReporteAsistencia(rango.inicio, rango.fin), per);
    default: return null;
  }
}

/** GET /api/reportes/:tipo/vista — documento del reporte para dibujarlo en pantalla. */
async function obtenerVista(req, res) {
  const documento = await construirDocumento(req.params.tipo, req.query);
  if (!documento) return res.status(404).json({ error: 'Reporte no encontrado.' });
  res.json(documento);
}

/** GET /api/reportes/:tipo/pdf — el mismo documento descargado como PDF. */
async function descargarPdf(req, res) {
  const documento = await construirDocumento(req.params.tipo, req.query);
  if (!documento) return res.status(404).json({ error: 'Reporte no encontrado.' });
  const sufijo = documento.periodo && documento.periodo.inicio
    ? `_${documento.periodo.inicio}_a_${documento.periodo.fin}`
    : `_${obtenerFechaHoy()}`;
  generarPdfDocumento(res, documento, `reporte_${documento.tipo}${sufijo}.pdf`);
}

// ---------------------------------------------------------------------------
// Datos crudos (JSON) de cada reporte: se conservan por compatibilidad.
// ---------------------------------------------------------------------------
function crudo(funcion) {
  return async (req, res) => {
    const { periodo, rango } = resolverRango(req.query);
    res.json({ periodo, ...(await funcion(rango.inicio, rango.fin)) });
  };
}

module.exports = {
  SIN_PERIODO,
  obtenerVista, descargarPdf,
  obtenerReporte: crudo(ReporteRepositorio.calcularReporte),
  obtenerReporteVentas: crudo(ReporteRepositorio.calcularReporteVentas),
  obtenerReporteCompras: crudo(ReporteRepositorio.calcularReporteCompras),
  obtenerReporteNomina: crudo(ReporteRepositorio.calcularReporteNomina),
  obtenerReporteComparativo: crudo(ReporteRepositorio.calcularReporteComparativo),
  obtenerReporteOperativo: crudo(ReporteRepositorio.calcularReporteOperativo),
  obtenerReporteAsistencia: crudo(ReporteRepositorio.calcularReporteAsistencia),
  obtenerReporteInventario: async (req, res) => res.json(await ReporteRepositorio.calcularReporteInventario()),
  obtenerReporteClientes: async (req, res) => res.json(await ReporteRepositorio.calcularReporteClientes())
};
