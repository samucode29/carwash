const express = require('express');
const ClienteControlador = require('../controladores/ClienteControlador');
const { exigirAutenticacion } = require('../middlewares/autenticacion');
const { envolverAsync } = require('../middlewares/manejadorErrores');

const router = express.Router();
router.use(exigirAutenticacion);

// Clientes/vehículos: operación diaria, disponible para admin y empleado.
router.get('/', envolverAsync(ClienteControlador.listarClientes));
router.post('/', envolverAsync(ClienteControlador.crearClienteConVehiculo));
router.get('/vehiculos/buscar', envolverAsync(ClienteControlador.buscarVehiculoPorPlaca));

module.exports = router;
