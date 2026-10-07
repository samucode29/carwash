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
const { esDocumentoValido, esTelefonoValido, esCorreoValido, esUsernameValido } = require('../utilidades/validadores');
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
 * Cuenta de ADMINISTRADOR (solo la puede crear el administrador principal). El
 * usuario y la contraseña los escribe él mismo, y puede:
 *  - asignarla a un empleado o lavador ya registrado ({asignarTipo, asignarId}):
 *    la persona conserva lo suyo (su usuario de empleado, su pago por comisión)
 *    y además queda con este acceso de administrador, o
 *  - crearla aparte, sin asignarla a nadie (con sus propios datos).
 */
async function crearCuentaAdministrador(req, res) {
  if (!req.usuarioAutenticado.esAdminPrincipal) {
    return res.status(403).json({ error: 'Solo el administrador principal puede crear cuentas de administrador.' });
  }
  const { password, asignarTipo, asignarId } = req.body;
  const username = String(req.body.username || '').trim().toLowerCase();

  if (!esUsernameValido(username)) {
    return res.status(400).json({ error: 'El usuario debe tener de 4 a 30 caracteres: minúsculas, números, punto, guion o guion bajo (sin espacios ni tildes).' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (await UsuarioRepositorio.obtenerPorUsername(username)) {
    return res.status(400).json({ error: 'Ese usuario ya está en uso. Elija otro.' });
  }
  let correo = `${username}@carwash.com`;
  if (await UsuarioRepositorio.buscarPorUsernameOCorreo(correo)) correo = `${username}.admin@carwash.com`;
  const passwordHash = hashearContrasena(String(password));

  // --- Asignada a una persona ya registrada
  if (asignarTipo) {
    if (!['empleado', 'lavador'].includes(asignarTipo) || !asignarId) {
      return res.status(400).json({ error: 'Indique si la cuenta es para un empleado o un lavador y cuál.' });
    }
    const personaId = Number(asignarId);
    const persona = asignarTipo === 'lavador'
      ? await LavadorRepositorio.obtenerPorId(personaId)
      : await UsuarioRepositorio.obtenerPorId(personaId);
    if (!persona || (asignarTipo === 'empleado' && (persona.rol !== 'empleado' || persona.cuenta_adicional))) {
      return res.status(404).json({ error: 'No se encontró a la persona a la que se quiere asignar la cuenta.' });
    }
    if (persona.estado !== 'activo') {
      return res.status(400).json({ error: `${persona.nombre} está inactivo/a: actívelo antes de darle una cuenta de administrador.` });
    }
    const yaTiene = await UsuarioRepositorio.obtenerCuentaAdicional(asignarTipo, personaId);
    if (yaTiene) {
      return res.status(400).json({ error: `${persona.nombre} ya tiene una cuenta de administrador (usuario: ${yaTiene.username}).` });
    }

    const cuenta = await UsuarioRepositorio.crear({
      nombre: persona.nombre, nombres: persona.nombres, apellidos: persona.apellidos, documento: persona.documento,
      telefono: '', // el celular queda solo en el registro de la persona (no se repite)
      correo, username, passwordHash, rol: 'administrador',
      salarioFijo: null, cuentaAdicional: true, vinculadoTipo: asignarTipo, vinculadoId: personaId
    });
    await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_admin_asignado',
      `Cuenta de administrador "${username}" asignada a ${persona.nombre} (${asignarTipo} #${personaId})`);
    return res.status(201).json(cuenta);
  }

  // --- Cuenta aparte, sin asignar a nadie: lleva sus propios datos
  const { documento, telefono, salarioFijo, periodicidadPago, jornadaHorasDia, diasDescansoSemana } = req.body;
  const persona = interpretarNombre(req.body);
  if (persona.error) return res.status(400).json({ error: persona.error });
  if (!documento || !esDocumentoValido(documento)) {
    return res.status(400).json({ error: 'El documento debe tener solo números, mínimo 4 dígitos.' });
  }
  if (telefono && !esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  if (telefono) await exigirCelularUnico(telefono);
  if (await UsuarioRepositorio.obtenerPorDocumento(documento)) {
    return res.status(400).json({ error: 'Ya existe un usuario con este documento de identidad. Si es la misma persona, asígnele la cuenta en vez de crearla aparte.' });
  }
  if (await LavadorRepositorio.obtenerPorDocumento(documento)) {
    return res.status(400).json({ error: 'Ya existe un lavador con este documento de identidad. Si es la misma persona, asígnele la cuenta en vez de crearla aparte.' });
  }

  const cuenta = await UsuarioRepositorio.crear({
    nombre: persona.nombre, nombres: persona.nombres, apellidos: persona.apellidos, documento, telefono,
    correo, username, passwordHash, rol: 'administrador',
    salarioFijo: salarioFijo ? parseFloat(salarioFijo) : 1400000,
    periodicidadPago: periodicidadPago || 'quincenal',
    jornadaHorasDia: jornadaHorasDia ? parseFloat(jornadaHorasDia) : 8,
    diasDescansoSemana: diasDescansoSemana !== undefined ? parseInt(diasDescansoSemana, 10) : 1
  });
  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'crear_admin_aparte', `Cuenta de administrador "${username}" creada para ${persona.nombre} (sin asignar a un registro previo)`);
  res.status(201).json(cuenta);
}

async function crearUsuario(req, res) {
  if (req.body.rol === 'administrador') return crearCuentaAdministrador(req, res);
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
  const persona = traeNombre(req.body) ? interpretarNombre(req.body) : null;
  if (persona && persona.error) return res.status(400).json({ error: persona.error });
  if (telefono && !esTelefonoValido(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener solo números (7 a 10 dígitos).' });
  }
  if (correo && !esCorreoValido(correo)) {
    return res.status(400).json({ error: 'El correo electrónico no tiene un formato válido.' });
  }
  const actual = await UsuarioRepositorio.obtenerPorId(id);
  if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });
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
  if (estado === 'inactivo' && usuario.rol === 'empleado' && !usuario.cuenta_adicional) {
    await UsuarioRepositorio.inactivarCuentasVinculadas('empleado', id);
  }

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
  if (estado === 'inactivo') await UsuarioRepositorio.inactivarCuentasVinculadas('lavador', id);

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
