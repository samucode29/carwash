/**
 * Controlador de gestión de personal (CU16, CU17, CU26 / RF17, RF18, RF27):
 * cuentas de usuario (administrador/empleado) y lavadores (sin login).
 */
const UsuarioRepositorio = require('../repositorios/UsuarioRepositorio');
const LavadorRepositorio = require('../repositorios/LavadorRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { hashearContrasena, generarPasswordPorDefecto } = require('../utilidades/contrasenas');
const { normalizarParaUsername } = require('../utilidades/texto');

/**
 * Genera un nombre de usuario único a partir del nombre completo:
 * "primernombre.primerapellido", y si ya existe le agrega un número
 * (primernombre.primerapellido2, 3, ...) hasta encontrar uno libre.
 */
async function generarUsernameUnico(nombreCompleto) {
  const partes = (nombreCompleto || '').trim().split(/\s+/);
  const primerNombre = normalizarParaUsername(partes[0]) || 'usuario';
  const primerApellido = normalizarParaUsername(partes[1]);
  const base = primerApellido ? `${primerNombre}.${primerApellido}` : primerNombre;

  let candidato = base;
  let contador = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await UsuarioRepositorio.obtenerPorUsername(candidato)) {
    contador += 1;
    candidato = `${base}${contador}`;
  }
  return candidato;
}

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
  const { nombre, documento, telefono, correo, rol, salarioFijo, periodicidadPago } = req.body;

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

  // El usuario y la contraseña siempre se asignan automáticamente, no los
  // escribe el administrador: usuario = primernombre.primerapellido (con
  // un número si ya existe), contraseña = documento + "carwash".
  const nombreUsuario = await generarUsernameUnico(nombre);
  const passwordAsignada = generarPasswordPorDefecto(documento);

  const nuevoUsuario = await UsuarioRepositorio.crear({
    nombre,
    documento,
    telefono,
    correo: correo || `${nombreUsuario}@carwash.com`,
    username: nombreUsuario,
    passwordHash: hashearContrasena(passwordAsignada),
    rol,
    salarioFijo: salarioFijo ? parseFloat(salarioFijo) : 1400000,
    periodicidadPago: periodicidadPago || 'quincenal'
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_usuario', `Creado usuario ${nombre} con rol ${rol}`);
  // Se devuelve la contraseña en texto plano SOLO en esta respuesta (no se
  // guarda en ningún lado) para que el administrador se la entregue a la
  // persona; el frontend la muestra una única vez.
  res.status(201).json({ ...nuevoUsuario, passwordAsignada });
}

async function actualizarUsuario(req, res) {
  const id = Number(req.params.id);
  const { nombre, telefono, correo, rol, estado, salarioFijo, periodicidadPago, password } = req.body;

  if (rol === 'administrador' && !req.usuarioAutenticado.esAdminPrincipal) {
    return res.status(403).json({ error: 'Solo el administrador principal puede otorgar el rol de administrador.' });
  }

  // Nadie puede inactivar su propia cuenta (se quedaría sin poder volver a
  // entrar), y al administrador principal solo lo puede inactivar él mismo.
  if (estado === 'inactivo') {
    if (id === req.usuarioAutenticado.id) {
      return res.status(400).json({ error: 'No puedes inactivar tu propia cuenta.' });
    }
    const objetivo = await UsuarioRepositorio.obtenerPorId(id);
    if (objetivo && objetivo.es_admin_principal) {
      return res.status(403).json({ error: 'El administrador principal no puede ser inactivado por otra cuenta.' });
    }
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
 * Autoedición de perfil: el propio administrador cambia su nombre,
 * teléfono, correo o nombre de usuario. Exclusivo de administrador (el
 * empleado solo puede cambiar su contraseña, ver AuthControlador).
 */
async function actualizarMiPerfil(req, res) {
  const { nombre, telefono, correo, username } = req.body;
  const idPropio = req.usuarioAutenticado.id;

  if (username) {
    const existente = await UsuarioRepositorio.obtenerPorUsername(username);
    if (existente && existente.id !== idPropio) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
    }
  }

  const cambios = {};
  if (nombre) cambios.nombre = nombre;
  if (telefono !== undefined) cambios.telefono = telefono;
  if (correo) cambios.correo = correo;
  if (username) cambios.username = username;

  const usuario = await UsuarioRepositorio.actualizar(idPropio, cambios);
  await AuditoriaRepositorio.registrar(idPropio, 'actualizar_mi_perfil', 'El usuario editó los datos de su propio perfil.');
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
  actualizarMiPerfil,
  reiniciarContrasena,
  listarLavadores,
  crearLavador,
  actualizarLavador
};
