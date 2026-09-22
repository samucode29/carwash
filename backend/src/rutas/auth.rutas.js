const express = require('express');
const AuthControlador = require('../controladores/AuthControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();

router.post('/login', envolverAsync(AuthControlador.iniciarSesion));
router.get('/perfil', exigirAutenticacion, envolverAsync(AuthControlador.obtenerPerfilActual));

module.exports = router;
