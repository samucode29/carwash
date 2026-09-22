/**
 * Controlador de gestión de personal (CU16, CU17, CU26 / RF17, RF18, RF27):
 * cuentas de usuario (administrador/empleado) y lavadores (sin login).
 */
const UsuarioRepositorio = require('../repositorios/UsuarioRepositorio');
const LavadorRepositorio = require('../repositorios/LavadorRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { hashearContrasena } = require('../utilidades/contrasenas');

// ---------------------------------------------------------------------------
// Usuarios (administrador / empleado)
// ---------------------------------------------------------------------------
async function listarUsuarios(req, res) {
  const usuarios = await UsuarioRepositorio.listar(req.query.rol);
  res.json(usuarios);
}

/** Perfil propio: usado por el panel de empleado para "ver su salario". */
async function obtenerMiPerfil(req, res) {
  const usuario = await UsuarioRepositorio.obtenerPorId(req.usuarioAutenticado.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(usuario);
}

async function crearUsuario(req, res) {
  const { nombre, documento, telefono, correo, username, password, rol, salarioFijo, periodicidadPago } = req.body;

  if (!nombre || !documento || !rol || !password) {
    return res.status(400).json({ error: 'Nombre, documento, rol y contraseña son obligatorios.' });
  }
  if (!['administrador', 'empleado'].includes(rol)) {
    return res.status(400).json({ error: "El rol debe ser 'administrador' o 'empleado'." });
  }
  // Solo el administrador principal puede crear nuevas cuentas de administrador;
  // cualquier administrador puede crear empleados.
  if (rol === 'administrador' && !req.usuarioAutenticado.esAdminPrincipal) {
    return res.status(403).json({ error: 'Solo el administrador principal puede crear nuevas cuentas de administrador.' });
  }

  const existente = await UsuarioRepositorio.obtenerPorDocumento(documento);
  if (existente) {
    return res.status(400).json({ error: 'Ya existe un usuario con este documento de identidad.' });
  }

  const nombreUsuario = username || (nombre.split(' ')[0].toLowerCase() + Math.floor(Math.random() * 1000));
  const nuevoUsuario = await UsuarioRepositorio.crear({
    nombre,
    documento,
    telefono,
    correo: correo || `${nombreUsuario}@carwash.com`,
    username: nombreUsuario,
    passwordHash: hashearContrasena(password),
    rol,
    salarioFijo: salarioFijo ? parseFloat(salarioFijo) : 1400000,
    periodicidadPago: periodicidadPago || 'quincenal'
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_usuario', `Creado usuario ${nombre} con rol ${rol}`);
  res.status(201).json(nuevoUsuario);
}

async function actualizarUsuario(req, res) {
  const id = Number(req.params.id);
  const { nombre, telefono, correo, rol, estado, salarioFijo, periodicidadPago, password } = req.body;

  if (rol === 'administrador' && !req.usuarioAutenticado.esAdminPrincipal) {
    return res.status(403).json({ error: 'Solo el administrador principal puede otorgar el rol de administrador.' });
  }

  const cambios = {};
  if (nombre) cambios.nombre = nombre;
  if (telefono !== undefined) cambios.telefono = telefono;
  if (correo) cambios.correo = correo;
  if (rol) cambios.rol = rol;
  if (estado) cambios.estado = estado;
  if (salarioFijo !== undefined) cambios.salario_fijo = parseFloat(salarioFijo);
  if (periodicidadPago) cambios.periodicidad_pago = periodicidadPago;
  if (password) cambios.password_hash = hashearContrasena(password);

  const usuario = await UsuarioRepositorio.actualizar(id, cambios);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_usuario', `Actualizado usuario ID ${id}`);
  res.json(usuario);
}

// ---------------------------------------------------------------------------
// Lavadores (personal operativo sin login)
// ---------------------------------------------------------------------------
async function listarLavadores(req, res) {
  const soloActivos = req.query.activos === 'true';
  const lavadores = await LavadorRepositorio.listar({ soloActivos });
  res.json(lavadores);
}

async function crearLavador(req, res) {
  const { nombre, documento, telefono, porcentajeComision } = req.body;
  if (!nombre || !documento) {
    return res.status(400).json({ error: 'Nombre y documento son obligatorios.' });
  }

  const existente = await LavadorRepositorio.obtenerPorDocumento(documento);
  if (existente) {
    return res.status(400).json({ error: 'Ya existe un lavador con este documento de identidad.' });
  }

  const nuevoLavador = await LavadorRepositorio.crear({
    nombre,
    documento,
    telefono,
    porcentajeComision: porcentajeComision ? parseFloat(porcentajeComision) : 60.0,
    creadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_lavador', `Creado lavador ${nombre}`);
  res.status(201).json(nuevoLavador);
}

async function actualizarLavador(req, res) {
  const id = Number(req.params.id);
  const { nombre, telefono, estado, porcentajeComision } = req.body;

  const cambios = {};
  if (nombre) cambios.nombre = nombre;
  if (telefono !== undefined) cambios.telefono = telefono;
  if (estado) cambios.estado = estado;
  if (porcentajeComision !== undefined) cambios.porcentaje_comision = parseFloat(porcentajeComision);

  const lavador = await LavadorRepositorio.actualizar(id, cambios);
  if (!lavador) return res.status(404).json({ error: 'Lavador no encontrado.' });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'actualizar_lavador', `Actualizado lavador ID ${id}`);
  res.json(lavador);
}

module.exports = {
  listarUsuarios,
  obtenerMiPerfil,
  crearUsuario,
  actualizarUsuario,
  listarLavadores,
  crearLavador,
  actualizarLavador
};
