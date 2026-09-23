/**
 * Controlador del catálogo de servicios (CU12 / RF16). Crear/editar es
 * exclusivo de administrador (ver rutas); consultar es de uso diario.
 */
const ServicioRepositorio = require('../repositorios/ServicioRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');

async function listarServicios(req, res) {
  const servicios = await ServicioRepositorio.listar();
  res.json(servicios);
}

async function crearServicio(req, res) {
  const { nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min } = req.body;
  if (!nombre || !precio || !tipo_vehiculo) {
    return res.status(400).json({ error: 'Nombre, tipo de vehículo y precio son obligatorios.' });
  }

  const nuevo = await ServicioRepositorio.crear({
    nombre,
    tipoVehiculo: tipo_vehiculo,
    descripcion,
    precio: parseFloat(precio),
    duracionEstimadaMin: parseInt(duracion_estimada_min, 10)
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_servicio', `Creado servicio ${nombre} ($${precio})`);
  res.status(201).json(nuevo);
}

async function actualizarServicio(req, res) {
  const id = Number(req.params.id);
  const { nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min, activo } = req.body;

  const cambios = {};
  if (nombre) cambios.nombre = nombre;
  if (tipo_vehiculo) cambios.tipo_vehiculo = tipo_vehiculo;
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
