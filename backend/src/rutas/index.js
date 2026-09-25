/**
 * Punto único donde se agregan todas las rutas de la API bajo /api/...
 * Mantener este archivo como el único lugar que conoce la lista completa
 * de módulos hace que agregar un nuevo dominio (escalabilidad) sea tan
 * simple como una línea nueva aquí.
 */
const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.rutas'));
router.use('/personal', require('./personal.rutas'));
router.use('/clientes', require('./clientes.rutas'));
router.use('/servicios', require('./servicios.rutas'));
router.use('/', require('./agenda.rutas'));          // expone /api/citas y /api/turnos
router.use('/ordenes', require('./ordenes.rutas'));
router.use('/caja', require('./caja.rutas'));
router.use('/inventario', require('./inventario.rutas'));
router.use('/nomina', require('./nomina.rutas'));
router.use('/gastos', require('./gastos.rutas'));
router.use('/reportes', require('./reportes.rutas'));
router.use('/facturas', require('./facturas.rutas'));

module.exports = router;
