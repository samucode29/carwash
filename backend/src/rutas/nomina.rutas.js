const express = require('express');
const NominaControlador = require('../controladores/NominaControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

// Los pagos ya no piden subir un soporte: se genera un comprobante PDF con
// espacio de firmas que el negocio imprime y archiva en físico. Las rutas
// /soporte quedan solo para consultar soportes subidos antes de este cambio.

// Comisiones de lavadores: consultar es de uso diario; liquidar/pagar es
// una decisión financiera exclusiva de administrador.
router.get('/lavadores', envolverAsync(NominaControlador.listarResumenLavadores));
router.get('/lavadores/:id/servicios', envolverAsync(NominaControlador.listarServiciosLavador));
router.post('/liquidar-lavador', permitirRoles('administrador'), envolverAsync(NominaControlador.generarLiquidacion));
router.post('/pagar-liquidacion', permitirRoles('administrador'), envolverAsync(NominaControlador.pagarLiquidacion));
router.get('/liquidaciones', envolverAsync(NominaControlador.listarLiquidaciones));
router.get('/liquidaciones/:id/pdf', permitirRoles('administrador'), envolverAsync(NominaControlador.comprobanteLiquidacion));
router.get('/liquidaciones/:id/soporte', envolverAsync(NominaControlador.descargarSoporteLiquidacion));

// Salarios fijos de empleados/administradores: exclusivo de administrador.
router.get('/empleados', permitirRoles('administrador'), envolverAsync(NominaControlador.listarEmpleados));
router.get('/empleados/:id/calculo-pago', permitirRoles('administrador'), envolverAsync(NominaControlador.calcularPagoEmpleado));
router.post('/pagar-empleado', permitirRoles('administrador'), envolverAsync(NominaControlador.pagarSalarioEmpleado));
router.get('/pagos-salario', permitirRoles('administrador'), envolverAsync(NominaControlador.listarPagosSalario));
router.get('/pagos-salario/:id/pdf', permitirRoles('administrador'), envolverAsync(NominaControlador.comprobantePagoSalario));
router.get('/pagos-salario/:id/soporte', permitirRoles('administrador'), envolverAsync(NominaControlador.descargarSoportePagoSalario));

// Asistencia: administrador y empleado pueden registrarla (RF35).
router.get('/asistencia', envolverAsync(NominaControlador.listarAsistenciaDelDia));
router.post('/asistencia', envolverAsync(NominaControlador.registrarAsistencia));

module.exports = router;
