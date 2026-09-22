const express = require('express');
const ServicioControlador = require('../controladores/ServicioControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

router.get('/', envolverAsync(ServicioControlador.listarServicios));
router.post('/', permitirRoles('administrador'), envolverAsync(ServicioControlador.crearServicio));
router.put('/:id', permitirRoles('administrador'), envolverAsync(ServicioControlador.actualizarServicio));

module.exports = router;
