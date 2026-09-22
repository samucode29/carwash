/**
 * Manejador de errores centralizado. Cualquier error lanzado (o pasado a
 * next(err)) dentro de un controlador termina aquí, evitando que cada
 * endpoint tenga que repetir su propio try/catch con formato de respuesta.
 */
function manejadorErrores(err, req, res, next) {
  console.error('[ERROR]', err.message);
  const codigo = err.codigoHttp || 500;
  res.status(codigo).json({ error: err.message || 'Error interno del servidor.' });
}

/**
 * Envuelve un controlador async para reenviar cualquier excepción al
 * manejador de errores central en vez de tener que hacer try/catch manual
 * en cada controlador.
 */
function envolverAsync(controlador) {
  return function (req, res, next) {
    Promise.resolve(controlador(req, res, next)).catch(next);
  };
}

module.exports = { manejadorErrores, envolverAsync };
