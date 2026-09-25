/**
 * Controlador de clientes y vehículos (CU01, CU11 / RF01, RF21).
 */
const ClienteRepositorio = require('../repositorios/ClienteRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { esNombreValido, esTelefonoValido, esCorreoValido } = require('../utilidades/validadores');

async function listarClientes(req, res) {
  const clientes = await ClienteRepositorio.listarConVehiculos();
  res.json(clientes);
}

async function crearClienteConVehiculo(req, res) {
  const { nombre, telefono, correo, placa, tipo, marca, color } = req.body;
  if (!nombre || !telefono) {
    return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
  }
  if (!esNombreValido(nombre)) {
    return res.status(400).json({ error: 'El nombre debe tener solo letras y espacios, mínimo 3 caracteres.' });
  }
  if (!esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  if (correo && !esCorreoValido(correo)) {
    return res.status(400).json({ error: 'El correo electrónico no tiene un formato válido.' });
  }

  const cliente = await ClienteRepositorio.crearCliente({ nombre, telefono, correo, creadoPor: req.usuarioAutenticado.id });

  let vehiculo = null;
  if (placa && tipo) {
    const placaLimpia = placa.toUpperCase().trim();
    const existente = await ClienteRepositorio.obtenerVehiculoPorPlaca(placaLimpia);
    vehiculo = existente || await ClienteRepositorio.crearVehiculo({ clienteId: cliente.id, placa: placaLimpia, tipo, marca, color });
  }

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_cliente', `Registrado cliente ${nombre} con placa ${placa || 'N/A'}`);
  res.status(201).json({ cliente, vehiculo });
}

async function actualizarCliente(req, res) {
  const id = Number(req.params.id);
  const { nombre, telefono, correo } = req.body;
  if (!nombre || !telefono) {
    return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
  }
  if (!esNombreValido(nombre)) {
    return res.status(400).json({ error: 'El nombre debe tener solo letras y espacios, mínimo 3 caracteres.' });
  }
  if (!esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  if (correo && !esCorreoValido(correo)) {
    return res.status(400).json({ error: 'El correo electrónico no tiene un formato válido.' });
  }

  const cliente = await ClienteRepositorio.obtenerClientePorId(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const actualizado = await ClienteRepositorio.actualizarCliente(id, { nombre, telefono, correo: correo || '' });
  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_cliente', `Cliente #${id} actualizado: ${nombre}`);
  res.json(actualizado);
}

async function buscarVehiculoPorPlaca(req, res) {
  const { placa } = req.query;
  if (!placa) return res.status(400).json({ error: 'Debe ingresar una placa a buscar.' });

  const placaBuscada = placa.toUpperCase().trim();
  const vehiculo = await ClienteRepositorio.obtenerVehiculoPorPlaca(placaBuscada);
  if (!vehiculo) return res.json({ encontrado: false });

  const clientes = await ClienteRepositorio.listarConVehiculos();
  const cliente = clientes.find(c => c.id === vehiculo.cliente_id) || null;
  const historial = await ClienteRepositorio.obtenerHistorialPorVehiculo(vehiculo.id);

  res.json({ encontrado: true, vehiculo, cliente, historial });
}

module.exports = { listarClientes, crearClienteConVehiculo, actualizarCliente, buscarVehiculoPorPlaca };
