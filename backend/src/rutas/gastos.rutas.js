const express = require('express');
const GastoControlador = require('../controladores/GastoControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);
router.use(permitirRoles('administrador')); // los gastos operativos son información financiera exclusiva de admin

router.get('/', envolverAsync(GastoControlador.listarGastos));
router.post('/', envolverAsync(GastoControlador.crearGasto));

module.exports = router;
