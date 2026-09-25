const express = require('express');
const InventarioControlador = require('../controladores/InventarioControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

router.get('/insumos', envolverAsync(InventarioControlador.listarInsumos));
// Crear insumos nuevos en el catálogo es exclusivo de administrador; editar
// stock mínimo/costo también. El movimiento diario de entradas/entregas sí
// lo puede operar cualquier empleado.
router.post('/insumos', permitirRoles('administrador'), envolverAsync(InventarioControlador.crearInsumo));
router.put('/insumos/:id', permitirRoles('administrador'), envolverAsync(InventarioControlador.actualizarInsumo));

router.get('/alertas', envolverAsync(InventarioControlador.listarAlertas));
router.get('/movimientos', envolverAsync(InventarioControlador.listarMovimientos));
router.post('/entradas', envolverAsync(InventarioControlador.registrarEntrada));

router.get('/entregas', envolverAsync(InventarioControlador.listarEntregas));
router.post('/entregas', envolverAsync(InventarioControlador.registrarEntrega));

router.get('/proveedores', envolverAsync(InventarioControlador.listarProveedores));
router.post('/proveedores', permitirRoles('administrador'), envolverAsync(InventarioControlador.crearProveedor));
router.put('/proveedores/:id', permitirRoles('administrador'), envolverAsync(InventarioControlador.actualizarProveedor));

module.exports = router;
