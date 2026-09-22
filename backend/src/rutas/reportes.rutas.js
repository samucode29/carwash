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

module.exports = router;
