/**
 * Controlador de gestión de personal (CU16, CU17, CU26 / RF17, RF18, RF27):
 * cuentas de usuario (administrador/empleado) y lavadores (sin login).
 */
const UsuarioRepositorio = require('../repositorios/UsuarioRepositorio');
const LavadorRepositorio = require('../repositorios/LavadorRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { hashearContrasena, generarPasswordPorDefecto } = require('../utilidades/contrasenas');

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

  if (!nombre || !documento || !rol) {
    return res.status(400).json({ error: 'Nombre, documento y rol son obligatorios.' });
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

  // Si no se indica contraseña, la cuenta se crea con la contraseña por
  // defecto del sistema: "carwash" + número de documento.
  const passwordUsada = password || generarPasswordPorDefecto(documento);
  const nombreUsuario = username || (nombre.split(' ')[0].toLowerCase() + Math.floor(Math.random() * 1000));
  const nuevoUsuario = await UsuarioRepositorio.crear({
    nombre,
    documento,
    telefono,
    correo: correo || `${nombreUsuario}@carwash.com`,
    username: nombreUsuario,
    passwordHash: hashearContrasena(passwordUsada),
    rol,
    salarioFijo: salarioFijo ? parseFloat(salarioFijo) : 1400000,
    periodicidadPago: periodicidadPago || 'quincenal'
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_usuario', `Creado usuario ${nombre} con rol ${rol}`);
  // Se devuelve la contraseña en texto plano SOLO en esta respuesta (no se
  // guarda en ningún lado) para que el administrador se la pueda entregar
  // a la persona; si fue autogenerada, el frontend la muestra una vez.
  res.status(201).json({ ...nuevoUsuario, passwordAsignada: password ? null : passwordUsada });
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

/**
 * Reinicia la contraseña de un usuario al valor por defecto del sistema
 * ("carwash" + su número de documento). Cualquier administrador puede
 * reiniciar la contraseña de empleados o de otros administradores, EXCEPTO
 * la del administrador principal, que solo él mismo puede cambiar (evita
 * que un administrador normal se apropie de esa cuenta reiniciándola).
 */
async function reiniciarContrasena(req, res) {
  const id = Number(req.params.id);
  const usuario = await UsuarioRepositorio.obtenerPorId(id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

  if (usuario.es_admin_principal && req.usuarioAutenticado.id !== usuario.id) {
    return res.status(403).json({ error: 'La contraseña del administrador principal solo la puede cambiar él mismo (usar "Cambiar mi Contraseña").' });
  }

  const passwordPorDefecto = generarPasswordPorDefecto(usuario.documento);
  await UsuarioRepositorio.actualizar(id, { password_hash: hashearContrasena(passwordPorDefecto) });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'reiniciar_contrasena', `Contraseña reiniciada al valor por defecto para ${usuario.nombre} (ID ${id})`);
  res.json({ mensaje: 'Contraseña reiniciada al valor por defecto.', passwordAsignada: passwordPorDefecto });
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
  reiniciarContrasena,
  listarLavadores,
  crearLavador,
  actualizarLavador
};
