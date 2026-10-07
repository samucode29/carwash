const express = require('express');
const ClienteControlador = require('../controladores/ClienteControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { permitirRoles } = require('../middlewares/autorizacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

// Clientes/vehículos: operación diaria, disponible para admin y empleado.
router.get('/', envolverAsync(ClienteControlador.listarClientes));
router.post('/', envolverAsync(ClienteControlador.crearClienteConVehiculo));
router.put('/:id', envolverAsync(ClienteControlador.actualizarCliente));
// Inactivar/activar un cliente lo decide el administrador.
router.put('/:id/estado', permitirRoles('administrador'), envolverAsync(ClienteControlador.cambiarEstadoCliente));
router.post('/:id/vehiculos', envolverAsync(ClienteControlador.agregarVehiculo));
router.post('/:id/notas', envolverAsync(ClienteControlador.agregarNotaCliente));
router.delete('/:id/notas/:notaId', envolverAsync(ClienteControlador.eliminarNotaCliente));
router.get('/vehiculos/buscar', envolverAsync(ClienteControlador.buscarVehiculoPorPlaca));

module.exports = router;
