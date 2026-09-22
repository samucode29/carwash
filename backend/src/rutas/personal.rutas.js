const express = require('express');
const PersonalControlador = require('../controladores/PersonalControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

// Cuentas de usuario (administrador/empleado) - gestión exclusiva de admin
router.get('/usuarios', permitirRoles('administrador'), envolverAsync(PersonalControlador.listarUsuarios));
router.post('/usuarios', permitirRoles('administrador'), envolverAsync(PersonalControlador.crearUsuario));
router.put('/usuarios/:id', permitirRoles('administrador'), envolverAsync(PersonalControlador.actualizarUsuario));

// Perfil propio (cualquier usuario autenticado ve su propio salario/datos)
router.get('/mi-perfil', envolverAsync(PersonalControlador.obtenerMiPerfil));

// Lavadores: cualquier usuario autenticado puede listarlos (se necesitan
// para asignar servicios en el POS); solo admin los crea o edita.
router.get('/lavadores', envolverAsync(PersonalControlador.listarLavadores));
router.post('/lavadores', permitirRoles('administrador'), envolverAsync(PersonalControlador.crearLavador));
router.put('/lavadores/:id', permitirRoles('administrador'), envolverAsync(PersonalControlador.actualizarLavador));

module.exports = router;
