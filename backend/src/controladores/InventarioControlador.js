/**
 * Controlador de inventario perpetuo y proveedores
 * (CU13, CU14, CU15, CU28 / RF13, RF14, RF15, RF36).
 */
const InsumoRepositorio = require('../repositorios/InsumoRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');

async function listarInsumos(req, res) {
  res.json(await InsumoRepositorio.listarInsumos());
}

async function crearInsumo(req, res) {
  const { nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, proveedor_id } = req.body;
  if (!nombre || !unidad_medida) {
    return res.status(400).json({ error: 'Nombre y unidad de medida son requeridos.' });
  }

  const nuevo = await InsumoRepositorio.crearInsumo({
    nombre, unidadMedida: unidad_medida,
    stockActual: parseFloat(stock_actual) || 0,
    stockMinimo: parseFloat(stock_minimo) || 0,
    costoUnitario: parseFloat(costo_unitario) || 0,
    proveedorId: proveedor_id ? parseInt(proveedor_id, 10) : null
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_insumo', `Creado insumo ${nombre} (${unidad_medida})`);
  res.status(201).json(nuevo);
}

async function actualizarInsumo(req, res) {
  const id = Number(req.params.id);
  const { nombre, unidad_medida, stock_minimo, costo_unitario, proveedor_id } = req.body;

  const cambios = {};
  if (nombre) cambios.nombre = nombre;
  if (unidad_medida) cambios.unidad_medida = unidad_medida;
  if (stock_minimo !== undefined) cambios.stock_minimo = parseFloat(stock_minimo);
  if (costo_unitario !== undefined) cambios.costo_unitario = parseFloat(costo_unitario);
  if (proveedor_id !== undefined) cambios.proveedor_id = parseInt(proveedor_id, 10) || null;

  const insumo = await InsumoRepositorio.actualizarInsumo(id, cambios);
  if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado.' });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_insumo', `Actualizado insumo ID ${id}`);
  res.json(insumo);
}

async function registrarEntrada(req, res) {
  const { insumo_id, cantidad, proveedor_id, observacion } = req.body;
  const insumo = await InsumoRepositorio.obtenerInsumoPorId(insumo_id);
  if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado.' });

  const cant = parseFloat(cantidad);
  if (!cant || cant <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a cero.' });

  await InsumoRepositorio.registrarEntrada({
    insumoId: insumo.id, cantidad: cant,
    proveedorId: proveedor_id ? parseInt(proveedor_id, 10) : insumo.proveedor_id,
    usuarioId: req.usuarioAutenticado.id, observacion
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'entrada_inventario', `Entrada de ${cant} ${insumo.unidad_medida} de ${insumo.nombre}`);
  res.status(201).json(await InsumoRepositorio.obtenerInsumoPorId(insumo.id));
}

async function listarAlertas(req, res) {
  res.json(await InsumoRepositorio.listarAlertasStockBajo());
}

async function listarMovimientos(req, res) {
  res.json(await InsumoRepositorio.listarMovimientos());
}

async function listarEntregas(req, res) {
  res.json(await InsumoRepositorio.listarEntregas());
}

async function registrarEntrega(req, res) {
  const { lavador_id, insumo_id, cantidad } = req.body;
  if (!lavador_id || !insumo_id || !cantidad) {
    return res.status(400).json({ error: 'Lavador, insumo y cantidad son obligatorios.' });
  }

  const entrega = await InsumoRepositorio.registrarEntrega({
    lavadorId: parseInt(lavador_id, 10),
    insumoId: parseInt(insumo_id, 10),
    cantidad: parseFloat(cantidad),
    entregadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'entrega_insumo_lavador', `Entrega #${entrega.id} al lavador ID ${lavador_id}`);
  res.status(201).json(entrega);
}

async function listarProveedores(req, res) {
  res.json(await InsumoRepositorio.listarProveedores());
}

async function crearProveedor(req, res) {
  const { nombre, contacto, telefono, correo, direccion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio.' });

  const nuevo = await InsumoRepositorio.crearProveedor({ nombre, contacto, telefono, correo, direccion });
  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_proveedor', `Creado proveedor ${nombre}`);
  res.status(201).json(nuevo);
}

module.exports = {
  listarInsumos, crearInsumo, actualizarInsumo, registrarEntrada,
  listarAlertas, listarMovimientos, listarEntregas, registrarEntrega,
  listarProveedores, crearProveedor
};
