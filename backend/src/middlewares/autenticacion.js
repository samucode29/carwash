/**
 * Middleware de autenticación: exige un token JWT válido en la cabecera
 * "Authorization: Bearer <token>" y adjunta el usuario decodificado en
 * req.usuarioAutenticado para que los controladores lo usen (por ejemplo,
 * para registrar quién hizo una acción en auditoría).
 */
const { verificarToken } = require('../utilidades/tokenJwt');

function exigirAutenticacion(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const [tipo, token] = encabezado.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'No se encontró un token de sesión válido. Inicie sesión nuevamente.' });
  }

  try {
    req.usuarioAutenticado = verificarToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'La sesión expiró o el token no es válido. Inicie sesión nuevamente.' });
  }
}

module.exports = { exigirAutenticacion };
