const express = require('express');
const multer = require('multer');
const NominaControlador = require('../controladores/NominaControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

// Soportes de pago (fotos/PDF de recibos): en memoria, se guardan como BLOB
// en la base de datos (no en disco: en Railway/Render el filesystem no es
// persistente entre despliegues). Límite 5MB por archivo.
const subirSoporte = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Comisiones de lavadores: consultar es de uso diario; liquidar/pagar es
// una decisión financiera exclusiva de administrador.
router.get('/lavadores', envolverAsync(NominaControlador.listarResumenLavadores));
router.get('/lavadores/:id/servicios', envolverAsync(NominaControlador.listarServiciosLavador));
router.post('/liquidar-lavador', permitirRoles('administrador'), envolverAsync(NominaControlador.generarLiquidacion));
router.post('/pagar-liquidacion', permitirRoles('administrador'), subirSoporte.single('soporte'), envolverAsync(NominaControlador.pagarLiquidacion));
router.get('/liquidaciones', envolverAsync(NominaControlador.listarLiquidaciones));
router.get('/liquidaciones/:id/soporte', envolverAsync(NominaControlador.descargarSoporteLiquidacion));

// Salarios fijos de empleados/administradores: exclusivo de administrador.
router.get('/empleados', permitirRoles('administrador'), envolverAsync(NominaControlador.listarEmpleados));
router.get('/empleados/:id/calculo-pago', permitirRoles('administrador'), envolverAsync(NominaControlador.calcularPagoEmpleado));
router.post('/pagar-empleado', permitirRoles('administrador'), subirSoporte.single('soporte'), envolverAsync(NominaControlador.pagarSalarioEmpleado));
router.get('/pagos-salario', permitirRoles('administrador'), envolverAsync(NominaControlador.listarPagosSalario));
router.get('/pagos-salario/:id/soporte', permitirRoles('administrador'), envolverAsync(NominaControlador.descargarSoportePagoSalario));

// Asistencia: administrador y empleado pueden registrarla (RF35).
router.get('/asistencia', envolverAsync(NominaControlador.listarAsistenciaDelDia));
router.post('/asistencia', envolverAsync(NominaControlador.registrarAsistencia));

module.exports = router;
