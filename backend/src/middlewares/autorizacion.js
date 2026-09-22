/**
 * Middleware de autorización por rol. Se usa DESPUÉS de exigirAutenticacion,
 * porque depende de req.usuarioAutenticado.rol.
 *
 * Uso: router.post('/ruta', exigirAutenticacion, permitirRoles('administrador'), controlador)
 */
function permitirRoles(...rolesPermitidos) {
  return function (req, res, next) {
    const rolActual = req.usuarioAutenticado ? req.usuarioAutenticado.rol : null;
    if (!rolActual || !rolesPermitidos.includes(rolActual)) {
      return res.status(403).json({ error: 'No tiene permisos para realizar esta acción.' });
    }
    next();
  };
}

module.exports = { permitirRoles };
