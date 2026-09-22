/**
 * Controlador de autenticación (CU03 - Iniciar sesión).
 * Único punto del sistema donde se emite un token JWT.
 */
const UsuarioRepositorio = require('../repositorios/UsuarioRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { compararContrasena } = require('../utilidades/contrasenas');
const { firmarToken } = require('../utilidades/tokenJwt');

async function iniciarSesion(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  const usuario = await UsuarioRepositorio.buscarPorUsernameOCorreo(username.trim().toLowerCase());
  const credencialesValidas = usuario && compararContrasena(password, usuario.password_hash);

  if (!credencialesValidas) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  if (usuario.estado !== 'activo') {
    return res.status(403).json({ error: 'Este usuario está inactivo. Contacte al administrador.' });
  }

  const token = firmarToken(usuario);
  await AuditoriaRepositorio.registrar(usuario.id, 'login', `Inicio de sesión exitoso como ${usuario.rol}`);

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      correo: usuario.correo,
      username: usuario.username,
      esAdminPrincipal: !!usuario.es_admin_principal
    }
  });
}

/** Devuelve los datos públicos del usuario dueño del token actual. */
async function obtenerPerfilActual(req, res) {
  const usuario = await UsuarioRepositorio.obtenerPorId(req.usuarioAutenticado.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(usuario);
}

module.exports = { iniciarSesion, obtenerPerfilActual };
