/**
 * Controlador del catálogo de tipos de vehículo. Crear/inactivar es
 * exclusivo de administrador; consultar es de uso diario (POS, servicios,
 * registro de clientes/vehículos).
 */
const TipoVehiculoRepositorio = require('../repositorios/TipoVehiculoRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');

async function listarTiposVehiculo(req, res) {
  res.json(await TipoVehiculoRepositorio.listar({ soloActivos: req.query.activos === 'true' }));
}

async function crearTipoVehiculo(req, res) {
  const nombre = (req.body.nombre || '').trim().toLowerCase();
  if (!nombre) return res.status(400).json({ error: 'El nombre del tipo de vehículo es obligatorio.' });

  const existente = await TipoVehiculoRepositorio.obtenerPorNombre(nombre);
  if (existente) return res.status(400).json({ error: 'Ya existe un tipo de vehículo con ese nombre.' });

  const nuevo = await TipoVehiculoRepositorio.crear(nombre);
  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_tipo_vehiculo', `Creado tipo de vehículo "${nombre}"`);
  res.status(201).json(nuevo);
}

async function actualizarEstadoTipoVehiculo(req, res) {
  const id = Number(req.params.id);
  const { estado } = req.body;
  if (!['activo', 'inactivo'].includes(estado)) {
    return res.status(400).json({ error: "El estado debe ser 'activo' o 'inactivo'." });
  }

  const actualizado = await TipoVehiculoRepositorio.actualizarEstado(id, estado);
  if (!actualizado) return res.status(404).json({ error: 'Tipo de vehículo no encontrado.' });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_tipo_vehiculo', `Tipo de vehículo "${actualizado.nombre}" ahora ${estado}`);
  res.json(actualizado);
}

module.exports = { listarTiposVehiculo, crearTipoVehiculo, actualizarEstadoTipoVehiculo };
