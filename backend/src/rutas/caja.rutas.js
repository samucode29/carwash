const express = require('express');
const CajaControlador = require('../controladores/CajaControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

router.post('/pagos', envolverAsync(CajaControlador.registrarPago));
router.get('/resumen', envolverAsync(CajaControlador.obtenerResumenCaja));
router.post('/cerrar', envolverAsync(CajaControlador.cerrarCaja));
router.get('/historial', envolverAsync(CajaControlador.listarHistorialCierres));

module.exports = router;
