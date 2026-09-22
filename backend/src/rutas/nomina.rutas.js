const express = require('express');
const NominaControlador = require('../controladores/NominaControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

// Comisiones de lavadores: consultar es de uso diario; liquidar/pagar es
// una decisión financiera exclusiva de administrador.
router.get('/lavadores', envolverAsync(NominaControlador.listarResumenLavadores));
router.post('/liquidar-lavador', permitirRoles('administrador'), envolverAsync(NominaControlador.generarLiquidacion));
router.post('/pagar-liquidacion', permitirRoles('administrador'), envolverAsync(NominaControlador.pagarLiquidacion));
router.get('/liquidaciones', envolverAsync(NominaControlador.listarLiquidaciones));

// Salarios fijos de empleados/administradores: exclusivo de administrador.
router.get('/empleados', permitirRoles('administrador'), envolverAsync(NominaControlador.listarEmpleados));
router.post('/pagar-empleado', permitirRoles('administrador'), envolverAsync(NominaControlador.pagarSalarioEmpleado));
router.get('/pagos-salario', permitirRoles('administrador'), envolverAsync(NominaControlador.listarPagosSalario));

// Asistencia: administrador y empleado pueden registrarla (RF35).
router.get('/asistencia', envolverAsync(NominaControlador.listarAsistenciaDelDia));
router.post('/asistencia', envolverAsync(NominaControlador.registrarAsistencia));

module.exports = router;
