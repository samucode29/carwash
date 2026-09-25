const express = require('express');
const TipoVehiculoControlador = require('../controladores/TipoVehiculoControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

router.get('/', envolverAsync(TipoVehiculoControlador.listarTiposVehiculo));
router.post('/', permitirRoles('administrador'), envolverAsync(TipoVehiculoControlador.crearTipoVehiculo));
router.put('/:id', permitirRoles('administrador'), envolverAsync(TipoVehiculoControlador.actualizarEstadoTipoVehiculo));

module.exports = router;
