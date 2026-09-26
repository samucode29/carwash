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

  // Un mismo vehículo (placa) no puede quedar asociado a dos clientes
  // distintos: se valida antes de crear el cliente para no dejar un
  // cliente huérfano si la placa ya es de otra persona.
  let placaLimpia = null;
  let vehiculoExistente = null;
  if (placa && tipo) {
    placaLimpia = placa.toUpperCase().trim();
    vehiculoExistente = await ClienteRepositorio.obtenerVehiculoPorPlaca(placaLimpia);
    if (vehiculoExistente && vehiculoExistente.cliente_id) {
      const dueño = await ClienteRepositorio.obtenerClientePorId(vehiculoExistente.cliente_id);
      return res.status(400).json({ error: `La placa ${placaLimpia} ya está registrada a otro cliente${dueño ? ` (${dueño.nombre})` : ''}.` });
    }
  }

  const cliente = await ClienteRepositorio.crearCliente({ nombre, telefono, correo, creadoPor: req.usuarioAutenticado.id });

  let vehiculo = null;
  if (placaLimpia) {
    if (vehiculoExistente) {
      // Placa existía pero sin dueño (venta anónima previa): se adopta.
      await ClienteRepositorio.actualizarVehiculoCliente(vehiculoExistente.id, cliente.id);
      vehiculo = { ...vehiculoExistente, cliente_id: cliente.id };
    } else {
      vehiculo = await ClienteRepositorio.crearVehiculo({ clienteId: cliente.id, placa: placaLimpia, tipo, marca, color });
    }
  }

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_cliente', `Registrado cliente ${nombre} con placa ${placa || 'N/A'}`);
  res.status(201).json({ cliente, vehiculo });
}

/** Agrega un vehículo adicional a un cliente ya existente (un cliente puede tener varios). */
async function agregarVehiculo(req, res) {
  const clienteId = Number(req.params.id);
  const { placa, tipo, marca, color } = req.body;
  if (!placa || !tipo) {
    return res.status(400).json({ error: 'Placa y tipo de vehículo son obligatorios.' });
  }

  const cliente = await ClienteRepositorio.obtenerClientePorId(clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const placaLimpia = placa.toUpperCase().trim();
  const existente = await ClienteRepositorio.obtenerVehiculoPorPlaca(placaLimpia);
  if (existente && existente.cliente_id && existente.cliente_id !== clienteId) {
    const dueño = await ClienteRepositorio.obtenerClientePorId(existente.cliente_id);
    return res.status(400).json({ error: `La placa ${placaLimpia} ya está registrada a otro cliente${dueño ? ` (${dueño.nombre})` : ''}.` });
  }

  let vehiculo;
  if (existente) {
    if (!existente.cliente_id) await ClienteRepositorio.actualizarVehiculoCliente(existente.id, clienteId);
    vehiculo = { ...existente, cliente_id: clienteId };
  } else {
    vehiculo = await ClienteRepositorio.crearVehiculo({ clienteId, placa: placaLimpia, tipo, marca, color });
  }

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'agregar_vehiculo', `Vehículo ${placaLimpia} agregado al cliente #${clienteId}`);
  res.status(201).json(vehiculo);
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

const TIPOS_NOTA_VALIDOS = ['lista_negra', 'preferencia'];

/**
 * Nota sobre un cliente: 'lista_negra' para incidentes (no pagó, generó
 * problemas...) y 'preferencia' para cómo le gusta el servicio. Se guardan
 * como historial (varias por cliente), nunca se sobrescriben.
 */
async function agregarNotaCliente(req, res) {
  const clienteId = Number(req.params.id);
  const { tipo, texto } = req.body;
  if (!TIPOS_NOTA_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de nota no válido.' });
  }
  if (!texto || !texto.trim()) {
    return res.status(400).json({ error: 'Escriba el texto de la nota.' });
  }

  const cliente = await ClienteRepositorio.obtenerClientePorId(clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const nota = await ClienteRepositorio.agregarNota({ clienteId, tipo, texto: texto.trim(), creadoPor: req.usuarioAutenticado.id });
  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'agregar_nota_cliente', `Nota (${tipo}) agregada al cliente #${clienteId}: ${texto.trim()}`);
  res.status(201).json(nota);
}

async function eliminarNotaCliente(req, res) {
  await ClienteRepositorio.eliminarNota(Number(req.params.notaId));
  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'eliminar_nota_cliente', `Nota #${req.params.notaId} eliminada del cliente #${req.params.id}`);
  res.status(204).end();
}

module.exports = {
  listarClientes, crearClienteConVehiculo, actualizarCliente, agregarVehiculo, buscarVehiculoPorPlaca,
  agregarNotaCliente, eliminarNotaCliente
};
