const express = require('express');
const ReporteControlador = require('../controladores/ReporteControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);
router.use(permitirRoles('administrador')); // reportes y ganancias son exclusivos de administrador (CU18, CU19)

// ?periodo=dia|semana|mes|ano|personalizado&fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD
router.get('/dashboard', envolverAsync(ReporteControlador.obtenerReporte));
router.get('/dashboard/pdf', envolverAsync(ReporteControlador.descargarReportePdf));

router.get('/ventas', envolverAsync(ReporteControlador.obtenerReporteVentas));
router.get('/ventas/pdf', envolverAsync(ReporteControlador.descargarReporteVentasPdf));

router.get('/compras', envolverAsync(ReporteControlador.obtenerReporteCompras));
router.get('/compras/pdf', envolverAsync(ReporteControlador.descargarReporteComprasPdf));

router.get('/inventario', envolverAsync(ReporteControlador.obtenerReporteInventario));
router.get('/inventario/pdf', envolverAsync(ReporteControlador.descargarReporteInventarioPdf));

router.get('/nomina', envolverAsync(ReporteControlador.obtenerReporteNomina));
router.get('/nomina/pdf', envolverAsync(ReporteControlador.descargarReporteNominaPdf));

router.get('/comparativo', envolverAsync(ReporteControlador.obtenerReporteComparativo));
router.get('/comparativo/pdf', envolverAsync(ReporteControlador.descargarReporteComparativoPdf));

router.get('/operativo', envolverAsync(ReporteControlador.obtenerReporteOperativo));
router.get('/operativo/pdf', envolverAsync(ReporteControlador.descargarReporteOperativoPdf));

module.exports = router;
