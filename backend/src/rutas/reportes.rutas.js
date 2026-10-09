const express = require('express');
const ReporteControlador = require('../controladores/ReporteControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);
router.use(permitirRoles('administrador')); // reportes y ganancias son exclusivos de administrador (CU18, CU19)

// Reportes completos (KPIs, hallazgos, gráficos y tablas), idénticos en pantalla y PDF:
//   :tipo = resumen | ventas | compras | inventario | nomina | comparativo | operativo | asistencia | clientes | cliente | lavador
//   ?periodo=dia|semana|mes|ano|personalizado&fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD
//   ventas admite filtros: &cliente_id=&lavador_id=&metodo=efectivo|tarjeta|transferencia|pse
//   cliente exige &cliente_id=  y  lavador exige &lavador_id=  (historial detallado de esa persona)
router.get('/:tipo/vista', envolverAsync(ReporteControlador.obtenerVista));
router.get('/:tipo/pdf', envolverAsync(ReporteControlador.descargarPdf));

// Datos crudos por reporte (se conservan por compatibilidad).
router.get('/dashboard', envolverAsync(ReporteControlador.obtenerReporte));
router.get('/ventas', envolverAsync(ReporteControlador.obtenerReporteVentas));
router.get('/compras', envolverAsync(ReporteControlador.obtenerReporteCompras));
router.get('/inventario', envolverAsync(ReporteControlador.obtenerReporteInventario));
router.get('/nomina', envolverAsync(ReporteControlador.obtenerReporteNomina));
router.get('/comparativo', envolverAsync(ReporteControlador.obtenerReporteComparativo));
router.get('/operativo', envolverAsync(ReporteControlador.obtenerReporteOperativo));
router.get('/asistencia', envolverAsync(ReporteControlador.obtenerReporteAsistencia));
router.get('/clientes', envolverAsync(ReporteControlador.obtenerReporteClientes));

module.exports = router;
