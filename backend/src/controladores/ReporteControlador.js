/**
 * Controlador de reportes y dashboard (CU18, CU19, CU29 / RF19, RF20, RF25,
 * RF26). Cada reporte se puede ver en pantalla (JSON) o descargar en PDF;
 * todos soportan período rápido (día/semana/mes/año) o un rango
 * personalizado, salvo Inventario que es una foto del momento actual.
 */
const ReporteRepositorio = require('../repositorios/ReporteRepositorio');
const { calcularRangoPorPeriodo } = require('../utilidades/fechas');
const { generarPdfReporte, generarPdfGenerico, formatearMoneda } = require('../utilidades/generadorReportePdf');

const ETIQUETAS_PERIODO = {
  dia: 'Hoy', semana: 'Últimos 7 días', mes: 'Mes actual', ano: 'Año actual', personalizado: 'Rango personalizado'
};

function resolverRango(query) {
  const periodo = query.periodo || 'dia';
  const rango = calcularRangoPorPeriodo(periodo, query.fecha_inicio, query.fecha_fin);
  return { periodo, rango };
}

function etiquetaDe(periodo, rango) {
  return periodo === 'personalizado' ? `${rango.inicio} a ${rango.fin}` : (ETIQUETAS_PERIODO[periodo] || periodo);
}

// ---------------------------------------------------------------------------
// Resumen general (el dashboard de siempre)
// ---------------------------------------------------------------------------
async function obtenerReporte(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporte(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

async function descargarReportePdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporte(rango.inicio, rango.fin);
  generarPdfReporte(res, reporte, { etiquetaPeriodo: etiquetaDe(periodo, rango) });
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
async function obtenerReporteVentas(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporteVentas(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

async function descargarReporteVentasPdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const r = await ReporteRepositorio.calcularReporteVentas(rango.inicio, rango.fin);
  generarPdfGenerico(res, {
    titulo: 'Reporte de Ventas', subtitulo: `Período: ${etiquetaDe(periodo, rango)}`,
    nombreArchivo: `reporte_ventas_${rango.inicio}_a_${rango.fin}.pdf`,
    secciones: [
      { titulo: 'Resumen', filas: [
        ['Total Vendido', formatearMoneda(r.totalVentas)],
        ['Cantidad de Ventas', String(r.cantidadVentas)],
        ['Ticket Promedio', formatearMoneda(r.ticketPromedio)]
      ] },
      { titulo: 'Por Servicio', filas: Object.entries(r.porServicio).map(([k, v]) => [k, formatearMoneda(v)]) },
      { titulo: 'Por Método de Pago', filas: Object.entries(r.porMetodoPago).map(([k, v]) => [k.toUpperCase(), formatearMoneda(v)]) },
      { titulo: 'Por Tipo de Vehículo', filas: [['Carros', formatearMoneda(r.porVehiculo.carro)], ['Motos', formatearMoneda(r.porVehiculo.moto)]] },
      { titulo: 'Por Lavador', filas: [], tabla: {
        encabezados: ['Lavador', 'Servicios Atendidos', 'Comisión Generada'],
        filas: r.porLavador.map(l => [l.nombre, String(l.servicios), formatearMoneda(l.comision)])
      } },
      { titulo: 'Top 5 Clientes', tabla: {
        encabezados: ['Cliente', 'Compras', 'Total'],
        filas: r.topClientes.map(c => [c.nombre, String(c.cantidad), formatearMoneda(c.total)])
      } }
    ]
  });
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------
async function obtenerReporteCompras(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporteCompras(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

async function descargarReporteComprasPdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const r = await ReporteRepositorio.calcularReporteCompras(rango.inicio, rango.fin);
  generarPdfGenerico(res, {
    titulo: 'Reporte de Compras', subtitulo: `Período: ${etiquetaDe(periodo, rango)}`,
    nombreArchivo: `reporte_compras_${rango.inicio}_a_${rango.fin}.pdf`,
    secciones: [
      { titulo: 'Resumen', filas: [
        ['Total Comprado', formatearMoneda(r.totalCompras)],
        ['Cantidad de Compras', String(r.cantidadCompras)]
      ] },
      { titulo: 'Por Proveedor', filas: Object.entries(r.porProveedor).map(([k, v]) => [k, formatearMoneda(v)]) },
      { titulo: 'Por Insumo', filas: Object.entries(r.porInsumo).map(([k, v]) => [k, formatearMoneda(v)]) }
    ]
  });
}

// ---------------------------------------------------------------------------
// Inventario (foto del momento, no depende de un rango)
// ---------------------------------------------------------------------------
async function obtenerReporteInventario(req, res) {
  res.json(await ReporteRepositorio.calcularReporteInventario());
}

async function descargarReporteInventarioPdf(req, res) {
  const r = await ReporteRepositorio.calcularReporteInventario();
  generarPdfGenerico(res, {
    titulo: 'Reporte de Inventario Valorizado', subtitulo: `Corte: ${new Date().toLocaleDateString('es-CO')}`,
    nombreArchivo: `reporte_inventario.pdf`,
    secciones: [
      { titulo: 'Resumen', filas: [['Valor Total del Inventario', formatearMoneda(r.valorTotalInventario)], ['Insumos en Bajo Stock', String(r.alertas.length)]] },
      { titulo: 'Detalle por Insumo', tabla: {
        encabezados: ['Insumo', 'Stock', 'Costo Unitario', 'Valor'],
        filas: r.insumos.map(i => [i.nombre, `${i.stock_actual} ${i.unidad_medida}`, formatearMoneda(i.costo_unitario), formatearMoneda(i.valor)])
      } }
    ]
  });
}

// ---------------------------------------------------------------------------
// Nómina
// ---------------------------------------------------------------------------
async function obtenerReporteNomina(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporteNomina(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

async function descargarReporteNominaPdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const r = await ReporteRepositorio.calcularReporteNomina(rango.inicio, rango.fin);
  generarPdfGenerico(res, {
    titulo: 'Reporte de Nómina', subtitulo: `Período: ${etiquetaDe(periodo, rango)}`,
    nombreArchivo: `reporte_nomina_${rango.inicio}_a_${rango.fin}.pdf`,
    secciones: [
      { titulo: 'Salarios y Comisiones Pagados', filas: [
        ['Salarios Pagados', formatearMoneda(r.salariosPagados)],
        ['Cantidad de Pagos de Salario', String(r.salariosCantidad)],
        ['Comisiones Pagadas a Lavadores', formatearMoneda(r.comisionesPagadas)],
        ['Cantidad de Liquidaciones Pagadas', String(r.comisionesCantidad)]
      ] },
      { titulo: 'Pendiente por Pagar', filas: [
        ['Liquidaciones Pendientes', formatearMoneda(r.liquidacionesPendientesTotal)],
        ['Cantidad Pendiente', String(r.liquidacionesPendientesCantidad)]
      ] },
      { titulo: 'Asistencia', filas: [
        ['Días Presentes Registrados', String(r.asistenciasPresentes)],
        ['Inasistencias', String(r.inasistencias)],
        ['Horas Trabajadas Totales', `${r.horasTrabajadasTotal} hrs`]
      ] },
      { titulo: 'Salarios Pagados por Empleado', filas: [],
        tabla: { encabezados: ['Empleado', 'Rol', 'Pagos', 'Total Pagado'],
          filas: r.porEmpleado.map(e => [e.nombre, e.rol, String(e.cantidad), formatearMoneda(e.total)]) } },
      { titulo: 'Comisiones Pagadas por Lavador', filas: [],
        tabla: { encabezados: ['Lavador', 'Liquidaciones', 'Total Pagado'],
          filas: r.porLavador.map(l => [l.nombre, String(l.cantidad), formatearMoneda(l.total)]) } }
    ]
  });
}

// ---------------------------------------------------------------------------
// Comparativo de períodos
// ---------------------------------------------------------------------------
async function obtenerReporteComparativo(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporteComparativo(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

async function descargarReporteComparativoPdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const r = await ReporteRepositorio.calcularReporteComparativo(rango.inicio, rango.fin);
  const fmtVar = v => v === null ? 'N/A' : `${v > 0 ? '+' : ''}${v}%`;
  generarPdfGenerico(res, {
    titulo: 'Reporte Comparativo de Períodos', subtitulo: `${r.actual.rango.inicio} a ${r.actual.rango.fin}  vs.  ${r.anterior.rango.inicio} a ${r.anterior.rango.fin}`,
    nombreArchivo: `reporte_comparativo_${rango.inicio}_a_${rango.fin}.pdf`,
    secciones: [
      { titulo: 'Ingresos', filas: [
        ['Período Actual', formatearMoneda(r.actual.totalIngresos)],
        ['Período Anterior', formatearMoneda(r.anterior.totalIngresos)],
        ['Variación', fmtVar(r.variacionIngresos)]
      ] },
      { titulo: 'Ganancia Neta', filas: [
        ['Período Actual', formatearMoneda(r.actual.gananciaNeta)],
        ['Período Anterior', formatearMoneda(r.anterior.gananciaNeta)],
        ['Variación', fmtVar(r.variacionGanancia)]
      ] },
      { titulo: 'Servicios Atendidos', filas: [
        ['Período Actual', String(r.actual.serviciosAtendidos)],
        ['Período Anterior', String(r.anterior.serviciosAtendidos)],
        ['Variación', fmtVar(r.variacionServicios)]
      ] }
    ]
  });
}

// ---------------------------------------------------------------------------
// Operativo (citas y clientes)
// ---------------------------------------------------------------------------
async function obtenerReporteOperativo(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporteOperativo(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

async function descargarReporteOperativoPdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const r = await ReporteRepositorio.calcularReporteOperativo(rango.inicio, rango.fin);
  generarPdfGenerico(res, {
    titulo: 'Reporte Operativo', subtitulo: `Período: ${etiquetaDe(periodo, rango)}`,
    nombreArchivo: `reporte_operativo_${rango.inicio}_a_${rango.fin}.pdf`,
    secciones: [
      { titulo: 'Citas por Estado', filas: Object.entries(r.porEstadoCitas).map(([k, v]) => [k.toUpperCase(), String(v)]) },
      { titulo: 'Clientes', filas: [
        ['Clientes Nuevos', String(r.clientesNuevos)],
        ['Clientes Recurrentes', String(r.clientesRecurrentes)]
      ] }
    ]
  });
}

// ---------------------------------------------------------------------------
// Asistencia (detalle por trabajador)
// ---------------------------------------------------------------------------
async function obtenerReporteAsistencia(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const reporte = await ReporteRepositorio.calcularReporteAsistencia(rango.inicio, rango.fin);
  res.json({ periodo, ...reporte });
}

async function descargarReporteAsistenciaPdf(req, res) {
  const { periodo, rango } = resolverRango(req.query);
  const r = await ReporteRepositorio.calcularReporteAsistencia(rango.inicio, rango.fin);
  generarPdfGenerico(res, {
    titulo: 'Reporte de Asistencia', subtitulo: `Período: ${etiquetaDe(periodo, rango)}`,
    nombreArchivo: `reporte_asistencia_${rango.inicio}_a_${rango.fin}.pdf`,
    secciones: [
      { titulo: 'Resumen', filas: [
        ['Días Presentes (total)', String(r.totalPresentes)],
        ['Inasistencias (total)', String(r.totalInasistencias)],
        ['Horas Trabajadas (total)', `${r.totalHorasTrabajadas} hrs`]
      ] },
      { titulo: 'Por Trabajador', filas: [], tabla: {
        encabezados: ['Trabajador', 'Rol', 'Presentes', 'Inasistencias', 'Horas Trabajadas'],
        filas: r.porTrabajador.map(t => [t.nombre, t.rol, String(t.presentes), String(t.inasistencias), `${t.horasTrabajadas} hrs`])
      } },
      { titulo: 'Detalle Día a Día', filas: [], tabla: {
        encabezados: ['Fecha', 'Trabajador', 'Entrada', 'Salida', 'Horas', 'Inasistencia'],
        filas: r.detalle.map(d => [d.fecha, d.nombre, d.horaEntrada || '-', d.horaSalida || '-', String(d.horasTrabajadas), d.inasistencia ? 'Sí' : 'No'])
      } }
    ]
  });
}

// ---------------------------------------------------------------------------
// Clientes (activos/inactivos según última compra, foto del momento)
// ---------------------------------------------------------------------------
async function obtenerReporteClientes(req, res) {
  res.json(await ReporteRepositorio.calcularReporteClientes());
}

async function descargarReporteClientesPdf(req, res) {
  const r = await ReporteRepositorio.calcularReporteClientes();
  const ETIQUETA_ESTADO = { activo: 'ACTIVO', inactivo: 'INACTIVO', nunca_compro: 'NUNCA HA COMPRADO' };
  generarPdfGenerico(res, {
    titulo: 'Reporte de Clientes', subtitulo: `Inactivo = sin compras en más de ${r.diasInactividad} días`,
    nombreArchivo: `reporte_clientes.pdf`,
    secciones: [
      { titulo: 'Resumen', filas: [
        ['Total de Clientes', String(r.totalClientes)],
        ['Activos', String(r.activos)],
        ['Inactivos', String(r.inactivos)],
        ['Nunca Han Comprado', String(r.nuncaCompraron)]
      ] },
      { titulo: 'Detalle de Clientes', filas: [], tabla: {
        encabezados: ['Cliente', 'Teléfono', 'Última Compra', 'Compras', 'Total Gastado', 'Estado'],
        filas: r.clientes.map(c => [
          c.nombre, c.telefono || '-', c.ultimaCompra || 'Nunca', String(c.totalCompras),
          formatearMoneda(c.totalGastado), ETIQUETA_ESTADO[c.estado] || c.estado
        ])
      } }
    ]
  });
}

module.exports = {
  obtenerReporte, descargarReportePdf,
  obtenerReporteVentas, descargarReporteVentasPdf,
  obtenerReporteCompras, descargarReporteComprasPdf,
  obtenerReporteInventario, descargarReporteInventarioPdf,
  obtenerReporteNomina, descargarReporteNominaPdf,
  obtenerReporteComparativo, descargarReporteComparativoPdf,
  obtenerReporteOperativo, descargarReporteOperativoPdf,
  obtenerReporteAsistencia, descargarReporteAsistenciaPdf,
  obtenerReporteClientes, descargarReporteClientesPdf
};
