const express = require('express');
const FacturaControlador = require('../controladores/FacturaControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

// Las facturas se generan solas (compra al registrar entrada, venta al
// cobrar una orden); aquí solo se consultan. ?tipo=compra|venta&fecha_inicio=&fecha_fin=
router.get('/', envolverAsync(FacturaControlador.listarFacturas));
router.get('/:id', envolverAsync(FacturaControlador.obtenerFactura));
router.get('/:id/pdf', envolverAsync(FacturaControlador.descargarFacturaPdf));

module.exports = router;
