/**
 * Cliente HTTP centralizado del frontend. Todas las llamadas al backend
 * pasan por aquí: agrega automáticamente el token JWT guardado al iniciar
 * sesión y, si el backend responde 401 (sesión vencida o inválida), limpia
 * la sesión local y redirige al login.
 */
const ApiCliente = (function () {
  const LLAVE_TOKEN = 'carwash_token';
  const LLAVE_USUARIO = 'carwash_usuario';

  function obtenerToken() {
    return localStorage.getItem(LLAVE_TOKEN);
  }

  function obtenerUsuario() {
    try {
      return JSON.parse(localStorage.getItem(LLAVE_USUARIO) || 'null');
    } catch {
      return null;
    }
  }

  function guardarSesion(token, usuario) {
    localStorage.setItem(LLAVE_TOKEN, token);
    localStorage.setItem(LLAVE_USUARIO, JSON.stringify(usuario));
  }

  function cerrarSesion() {
    localStorage.removeItem(LLAVE_TOKEN);
    localStorage.removeItem(LLAVE_USUARIO);
    window.location.href = 'login.html';
  }

  /**
   * Envoltorio sobre fetch(): agrega el header Authorization, serializa el
   * body como JSON y centraliza el manejo de sesión vencida (401).
   */
  async function solicitar(ruta, opciones = {}) {
    const token = obtenerToken();
    const encabezados = { ...(opciones.headers || {}) };
    if (token) encabezados['Authorization'] = `Bearer ${token}`;

    let cuerpo = opciones.body;
    if (cuerpo instanceof FormData) {
      // No fijar Content-Type: el navegador arma el boundary multipart solo.
    } else if (cuerpo && typeof cuerpo !== 'string') {
      encabezados['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(cuerpo);
    }

    const respuesta = await fetch(ruta, { ...opciones, headers: encabezados, body: cuerpo });

    if (respuesta.status === 401) {
      cerrarSesion();
      throw new Error('Sesión expirada.');
    }

    const contentType = respuesta.headers.get('content-type') || '';
    const datos = contentType.includes('application/json') ? await respuesta.json() : null;

    if (!respuesta.ok) {
      const error = new Error((datos && datos.error) || 'Ocurrió un error al comunicarse con el servidor.');
      error.datos = datos;
      throw error;
    }
    return datos;
  }

  return {
    get: (ruta) => solicitar(ruta),
    post: (ruta, body) => solicitar(ruta, { method: 'POST', body }),
    postForm: (ruta, formData) => solicitar(ruta, { method: 'POST', body: formData }),
    put: (ruta, body) => solicitar(ruta, { method: 'PUT', body }),
    delete: (ruta) => solicitar(ruta, { method: 'DELETE' }),
    obtenerToken,
    obtenerUsuario,
    guardarSesion,
    cerrarSesion
  };
})();
