const express = require('express');
const OrdenServicioControlador = require('../controladores/OrdenServicioControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

router.get('/', envolverAsync(OrdenServicioControlador.listarOrdenes));
router.post('/', envolverAsync(OrdenServicioControlador.crearOrden));
router.put('/:id/estado', envolverAsync(OrdenServicioControlador.actualizarEstadoOrden));
router.post('/:id/asignar-lavadores', envolverAsync(OrdenServicioControlador.asignarLavadores));
router.post('/:id/servicios-extra', envolverAsync(OrdenServicioControlador.agregarServicioExtra));

module.exports = router;
