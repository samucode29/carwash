/**
 * Controlador del catálogo de servicios (CU12 / RF16). Crear/editar es
 * exclusivo de administrador (ver rutas); consultar es de uso diario.
 *
 * Cada servicio pertenece a UN tipo de vehículo del catálogo de tipos
 * (carro, moto, camioneta...): así el POS, las citas, los servicios extra y
 * los reportes pueden discriminar siempre por tipo de vehículo.
 */
const ServicioRepositorio = require('../repositorios/ServicioRepositorio');
const TipoVehiculoRepositorio = require('../repositorios/TipoVehiculoRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');

async function listarServicios(req, res) {
  const servicios = await ServicioRepositorio.listar({ soloActivos: req.query.activos === 'true' });
  res.json(servicios);
}

/** Devuelve el tipo normalizado si existe y está activo en el catálogo; si no, lanza un 400. */
async function validarTipoVehiculo(tipoVehiculo) {
  const nombre = String(tipoVehiculo || '').trim().toLowerCase();
  if (!nombre) {
    throw Object.assign(new Error('Debe elegir el tipo de vehículo al que aplica el servicio.'), { codigoHttp: 400 });
  }
  const tipo = await TipoVehiculoRepositorio.obtenerActivoPorNombre(nombre);
  if (!tipo) {
    throw Object.assign(new Error(`El tipo de vehículo "${nombre}" no existe o está inactivo. Elija uno de la lista de tipos que atiende el lavadero.`), { codigoHttp: 400 });
  }
  return tipo.nombre;
}

async function crearServicio(req, res) {
  const { nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min } = req.body;
  if (!nombre || !precio) {
    return res.status(400).json({ error: 'Nombre y precio son obligatorios.' });
  }
  const tipoVehiculo = await validarTipoVehiculo(tipo_vehiculo);

  const nuevo = await ServicioRepositorio.crear({
    nombre,
    tipoVehiculo,
    descripcion,
    precio: parseFloat(precio),
    duracionEstimadaMin: parseInt(duracion_estimada_min, 10)
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_servicio', `Creado servicio ${nombre} (${tipoVehiculo}, $${precio})`);
  res.status(201).json(nuevo);
}

async function actualizarServicio(req, res) {
  const id = Number(req.params.id);
  const { nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min, activo } = req.body;

  const cambios = {};
  if (nombre) cambios.nombre = nombre;
  if (tipo_vehiculo !== undefined) cambios.tipo_vehiculo = await validarTipoVehiculo(tipo_vehiculo);
  if (descripcion !== undefined) cambios.descripcion = descripcion;
  if (precio !== undefined) cambios.precio = parseFloat(precio);
  if (duracion_estimada_min !== undefined) cambios.duracion_estimada_min = parseInt(duracion_estimada_min, 10);
  if (activo !== undefined) cambios.activo = !!activo;

  const servicio = await ServicioRepositorio.actualizar(id, cambios);
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado.' });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_servicio', `Actualizado servicio ID ${id}`);
  res.json(servicio);
}

module.exports = { listarServicios, crearServicio, actualizarServicio };
