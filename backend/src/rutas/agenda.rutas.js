const express = require('express');
const AgendaControlador = require('../controladores/AgendaControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

router.get('/citas', envolverAsync(AgendaControlador.listarCitas));
router.post('/citas', envolverAsync(AgendaControlador.crearCita));
router.put('/citas/:id', envolverAsync(AgendaControlador.actualizarCita));

router.get('/turnos', envolverAsync(AgendaControlador.listarTurnosDeHoy));
router.post('/turnos', envolverAsync(AgendaControlador.crearTurno));
router.put('/turnos/:id', envolverAsync(AgendaControlador.actualizarTurno));
router.post('/turnos/:id/cancelar', envolverAsync(AgendaControlador.cancelarTurno));
router.post('/turnos/:id/servicios-extra', envolverAsync(AgendaControlador.agregarServicioExtraTurno));

module.exports = router;
