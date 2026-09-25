const express = require('express');
const HorarioAtencionControlador = require('../controladores/HorarioAtencionControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

router.get('/', envolverAsync(HorarioAtencionControlador.listarHorario));
router.put('/:dia', permitirRoles('administrador'), envolverAsync(HorarioAtencionControlador.actualizarDiaHorario));

module.exports = router;
