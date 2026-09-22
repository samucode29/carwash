/**
 * Firma y verificación de los tokens JWT usados para mantener la sesión
 * del usuario autenticado (administrador o empleado).
 */
const jwt = require('jsonwebtoken');

const SECRETO = process.env.JWT_SECRET;
const EXPIRA_EN = process.env.JWT_EXPIRA_EN || '8h';

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, rol: usuario.rol, nombre: usuario.nombre, esAdminPrincipal: !!usuario.es_admin_principal },
    SECRETO,
    { expiresIn: EXPIRA_EN }
  );
}

function verificarToken(token) {
  return jwt.verify(token, SECRETO);
}

module.exports = { firmarToken, verificarToken };
