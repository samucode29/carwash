/**
 * Controlador de gestión de personal (CU16, CU17, CU26 / RF17, RF18, RF27):
 * cuentas de usuario (administrador/empleado) y lavadores (sin login).
 */
const UsuarioRepositorio = require('../repositorios/UsuarioRepositorio');
const LavadorRepositorio = require('../repositorios/LavadorRepositorio');
const AsistenciaRepositorio = require('../repositorios/AsistenciaRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { hashearContrasena, generarPasswordPorDefecto } = require('../utilidades/contrasenas');
const { normalizarParaUsername } = require('../utilidades/texto');
const { obtenerFechaHoy } = require('../utilidades/fechas');
const { esDocumentoValido, esTelefonoValido, esCorreoValido } = require('../utilidades/validadores');
const { interpretarNombre, traeNombre, exigirCelularUnico } = require('../utilidades/personas');

/**
 * Genera un nombre de usuario único: "primernombre.primerapellido", y si ya
 * existe le agrega un número (primernombre.primerapellido2, 3, ...) hasta
 * encontrar uno libre.
 */
async function generarUsernameUnico(nombres, apellidos) {
  const primerNombre = normalizarParaUsername((nombres || '').trim().split(/\s+/)[0]) || 'usuario';
  const primerApellido = normalizarParaUsername((apellidos || '').trim().split(/\s+/)[0]);
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

/**
 * Le da acceso al sistema a un lavador: se crea su cuenta de usuario como la
 * de un empleado (usuario primer nombre.primer apellido y contraseña cédula +
 * "carwash", que se muestran una sola vez). El lavador sigue cobrando por
 * comisión: esa cuenta no entra en la nómina de salarios ni en la asistencia
 * de empleados.
 */
async function darAccesoLavador(req, res) {
  const lavadorId = Number(req.params.id);
  const lavador = await LavadorRepositorio.obtenerPorId(lavadorId);
  if (!lavador) return res.status(404).json({ error: 'Lavador no encontrado.' });
  if (lavador.estado !== 'activo') {
    return res.status(400).json({ error: `${lavador.nombre} está inactivo: actívelo antes de darle acceso al sistema.` });
  }
  const existente = await UsuarioRepositorio.obtenerCuentaDeLavador(lavadorId);
  if (existente) {
    return res.status(400).json({ error: `${lavador.nombre} ya tiene acceso al sistema (usuario: ${existente.username}).` });
  }
  if (await UsuarioRepositorio.obtenerPorDocumento(lavador.documento)) {
    return res.status(400).json({ error: 'Ya existe un usuario con el documento de este lavador.' });
  }

  const username = await generarUsernameUnico(lavador.nombres, lavador.apellidos);
  const passwordAsignada = generarPasswordPorDefecto(lavador.documento);
  const cuenta = await UsuarioRepositorio.crear({
    nombre: lavador.nombre, nombres: lavador.nombres, apellidos: lavador.apellidos, documento: lavador.documento,
    telefono: '', // el celular queda solo en el registro del lavador (no se repite)
    correo: `${username}@carwash.com`, username, passwordHash: hashearContrasena(passwordAsignada),
    rol: 'empleado', salarioFijo: null, lavadorId
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'dar_acceso_lavador', `Acceso al sistema para el lavador ${lavador.nombre} (usuario ${username})`);
  res.status(201).json({ ...cuenta, passwordAsignada });
}

async function crearUsuario(req, res) {
  const { documento, telefono, correo, rol, salarioFijo, periodicidadPago, jornadaHorasDia, diasDescansoSemana } = req.body;

  const persona = interpretarNombre(req.body);
  if (persona.error) return res.status(400).json({ error: persona.error });
  if (!documento || !rol) {
    return res.status(400).json({ error: 'Documento y rol son obligatorios.' });
  }
  if (!esDocumentoValido(documento)) {
    return res.status(400).json({ error: 'El documento debe tener solo números, mínimo 4 dígitos.' });
  }
  if (telefono && !esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  if (correo && !esCorreoValido(correo)) {
    return res.status(400).json({ error: 'El correo electrónico no tiene un formato válido.' });
  }
  if (!['administrador', 'empleado'].includes(rol)) {
    return res.status(400).json({ error: "El rol debe ser 'administrador' o 'empleado'." });
  }
  // Solo el administrador principal puede crear nuevas cuentas de administrador;
  // cualquier administrador puede crear empleados.
  if (rol === 'administrador' && !req.usuarioAutenticado.esAdminPrincipal) {
    return res.status(403).json({ error: 'Solo el administrador principal puede crear nuevas cuentas de administrador.' });
  }

  if (telefono) await exigirCelularUnico(telefono);

  const existente = await UsuarioRepositorio.obtenerPorDocumento(documento);
  if (existente) {
    return res.status(400).json({ error: 'Ya existe un usuario con este documento de identidad.' });
  }
  const existeComoLavador = await LavadorRepositorio.obtenerPorDocumento(documento);
  if (existeComoLavador) {
    return res.status(400).json({ error: 'Ya existe un lavador registrado con este documento de identidad.' });
  }

  // El usuario y la contraseña siempre se asignan automáticamente, no los
  // escribe el administrador: usuario = primernombre.primerapellido (con
  // un número si ya existe), contraseña = documento + "carwash".
  const nombreUsuario = await generarUsernameUnico(persona.nombres, persona.apellidos);
  const passwordAsignada = generarPasswordPorDefecto(documento);

  const nuevoUsuario = await UsuarioRepositorio.crear({
    nombre: persona.nombre,
    nombres: persona.nombres,
    apellidos: persona.apellidos,
    documento,
    telefono,
    correo: correo || `${nombreUsuario}@carwash.com`,
    username: nombreUsuario,
    passwordHash: hashearContrasena(passwordAsignada),
    rol,
    salarioFijo: salarioFijo ? parseFloat(salarioFijo) : 1400000,
    periodicidadPago: periodicidadPago || 'quincenal',
    jornadaHorasDia: jornadaHorasDia ? parseFloat(jornadaHorasDia) : 8,
    diasDescansoSemana: diasDescansoSemana !== undefined ? parseInt(diasDescansoSemana, 10) : 1
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_usuario', `Creado usuario ${persona.nombre} con rol ${rol}`);
  // Se devuelve la contraseña en texto plano SOLO en esta respuesta (no se
  // guarda en ningún lado) para que el administrador se la entregue a la
  // persona; el frontend la muestra una única vez.
  res.status(201).json({ ...nuevoUsuario, passwordAsignada });
}

async function actualizarUsuario(req, res) {
  const id = Number(req.params.id);
  const { telefono, correo, rol, estado, salarioFijo, periodicidadPago, jornadaHorasDia, diasDescansoSemana, password } = req.body;

  if (rol === 'administrador' && !req.usuarioAutenticado.esAdminPrincipal) {
    return res.status(403).json({ error: 'Solo el administrador principal puede otorgar el rol de administrador.' });
  }
  const actual = await UsuarioRepositorio.obtenerPorId(id);
  if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });

  // Cambiar de empleado a administrador (o al revés) lo decide solo el
  // administrador principal; nadie cambia su propio rol ni el del principal.
  if (rol && rol !== actual.rol) {
    if (!['administrador', 'empleado'].includes(rol)) {
      return res.status(400).json({ error: "El rol debe ser 'administrador' o 'empleado'." });
    }
    if (!req.usuarioAutenticado.esAdminPrincipal) {
      return res.status(403).json({ error: 'Solo el administrador principal puede cambiar el rol de una cuenta.' });
    }
    if (id === req.usuarioAutenticado.id) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });
    }
    if (actual.es_admin_principal) {
      return res.status(400).json({ error: 'No se puede cambiar el rol del administrador principal.' });
    }
  }
  const persona = traeNombre(req.body) ? interpretarNombre(req.body) : null;
  if (persona && persona.error) return res.status(400).json({ error: persona.error });
  if (telefono && !esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  if (correo && !esCorreoValido(correo)) {
    return res.status(400).json({ error: 'El correo electrónico no tiene un formato válido.' });
  }
  // El celular solo se valida si cambió (así se puede editar otro dato aunque
  // el número ya estuviera repetido de antes).
  if (telefono && telefono !== actual.telefono) await exigirCelularUnico(telefono, { tipo: 'empleado', id });

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
  if (persona) Object.assign(cambios, { nombre: persona.nombre, nombres: persona.nombres, apellidos: persona.apellidos });
  if (telefono !== undefined) cambios.telefono = telefono;
  if (correo) cambios.correo = correo;
  if (rol) cambios.rol = rol;
  if (estado) cambios.estado = estado;
  if (salarioFijo !== undefined) cambios.salario_fijo = parseFloat(salarioFijo);
  if (periodicidadPago) cambios.periodicidad_pago = periodicidadPago;
  if (jornadaHorasDia !== undefined) cambios.jornada_horas_dia = parseFloat(jornadaHorasDia);
  if (diasDescansoSemana !== undefined) cambios.dias_descanso_semana = parseInt(diasDescansoSemana, 10);
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
  const { telefono, correo } = req.body;
  const username = req.body.username ? String(req.body.username).trim().toLowerCase() : req.body.username;
  const idPropio = req.usuarioAutenticado.id;

  const persona = traeNombre(req.body) ? interpretarNombre(req.body) : null;
  if (persona && persona.error) return res.status(400).json({ error: persona.error });
  if (telefono && !esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  if (correo && !esCorreoValido(correo)) {
    return res.status(400).json({ error: 'El correo electrónico no tiene un formato válido.' });
  }
  const propio = await UsuarioRepositorio.obtenerPorId(idPropio);
  if (telefono && propio && telefono !== propio.telefono) await exigirCelularUnico(telefono, { tipo: 'empleado', id: idPropio });

  if (username) {
    const existente = await UsuarioRepositorio.obtenerPorUsername(username);
    if (existente && existente.id !== idPropio) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
    }
  }

  const cambios = {};
  if (persona) Object.assign(cambios, { nombre: persona.nombre, nombres: persona.nombres, apellidos: persona.apellidos });
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
  const estados = await AsistenciaRepositorio.listarEstadoAsistenciaHoy('lavador', obtenerFechaHoy());
  const idsOcupados = new Set(await LavadorRepositorio.obtenerIdsOcupados());
  res.json(lavadores.map(l => ({
    ...l,
    disponible_hoy: estados[l.id] === 'presente',
    estado_asistencia_hoy: estados[l.id] || 'sin_asistencia',
    ocupado: idsOcupados.has(l.id) // ya atiende un servicio "en proceso"
  })));
}

async function crearLavador(req, res) {
  const { documento, telefono, porcentajeComision } = req.body;
  const persona = interpretarNombre(req.body);
  if (persona.error) return res.status(400).json({ error: persona.error });
  if (!documento) {
    return res.status(400).json({ error: 'El documento es obligatorio.' });
  }
  if (!esDocumentoValido(documento)) {
    return res.status(400).json({ error: 'El documento debe tener solo números, mínimo 4 dígitos.' });
  }
  if (telefono && !esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }

  if (telefono) await exigirCelularUnico(telefono);

  const existente = await LavadorRepositorio.obtenerPorDocumento(documento);
  if (existente) {
    return res.status(400).json({ error: 'Ya existe un lavador con este documento de identidad.' });
  }
  const existeComoUsuario = await UsuarioRepositorio.obtenerPorDocumento(documento);
  if (existeComoUsuario) {
    return res.status(400).json({ error: 'Ya existe un usuario (administrador/empleado) registrado con este documento de identidad.' });
  }

  const nuevoLavador = await LavadorRepositorio.crear({
    nombre: persona.nombre,
    nombres: persona.nombres,
    apellidos: persona.apellidos,
    documento,
    telefono,
    porcentajeComision: porcentajeComision ? parseFloat(porcentajeComision) : 60.0,
    creadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_lavador', `Creado lavador ${persona.nombre}`);
  res.status(201).json(nuevoLavador);
}

async function actualizarLavador(req, res) {
  const id = Number(req.params.id);
  const { telefono, estado, porcentajeComision } = req.body;

  const persona = traeNombre(req.body) ? interpretarNombre(req.body) : null;
  if (persona && persona.error) return res.status(400).json({ error: persona.error });
  if (telefono && !esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  const actual = await LavadorRepositorio.obtenerPorId(id);
  if (!actual) return res.status(404).json({ error: 'Lavador no encontrado.' });
  if (telefono && telefono !== actual.telefono) await exigirCelularUnico(telefono, { tipo: 'lavador', id });

  const cambios = {};
  if (persona) Object.assign(cambios, { nombre: persona.nombre, nombres: persona.nombres, apellidos: persona.apellidos });
  if (telefono !== undefined) cambios.telefono = telefono;
  if (estado) cambios.estado = estado;
  if (porcentajeComision !== undefined) cambios.porcentaje_comision = parseFloat(porcentajeComision);

  const lavador = await LavadorRepositorio.actualizar(id, cambios);
  if (!lavador) return res.status(404).json({ error: 'Lavador no encontrado.' });
  if (estado === 'inactivo') await UsuarioRepositorio.inactivarCuentaDeLavador(id);

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
  actualizarLavador,
  darAccesoLavador
};
