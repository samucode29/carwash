/**
 * Middleware de autenticación: exige un token JWT válido en la cabecera
 * "Authorization: Bearer <token>" y adjunta el usuario decodificado en
 * req.usuarioAutenticado para que los controladores lo usen (por ejemplo,
 * para registrar quién hizo una acción en auditoría).
 */
const { verificarToken } = require('../utilidades/tokenJwt');
const UsuarioRepositorio = require('../repositorios/UsuarioRepositorio');

async function exigirAutenticacion(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const [tipo, token] = encabezado.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'No se encontró un token de sesión válido. Inicie sesión nuevamente.' });
  }

  let datos;
  try {
    datos = verificarToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'La sesión expiró o el token no es válido. Inicie sesión nuevamente.' });
  }

  try {
    // El rol y el estado se leen de la base en cada petición (no del token):
    // si a alguien le cambian el rol o lo inactivan, el cambio vale ya, sin
    // esperar a que venza su sesión.
    const usuario = await UsuarioRepositorio.obtenerPorId(datos.id);
    if (!usuario || usuario.estado !== 'activo') {
      return res.status(401).json({ error: 'Esta cuenta ya no está activa. Inicie sesión nuevamente o contacte al administrador.' });
    }
    req.usuarioAutenticado = { ...datos, rol: usuario.rol, nombre: usuario.nombre, esAdminPrincipal: !!usuario.es_admin_principal };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { exigirAutenticacion };
