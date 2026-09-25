/**
 * Lógica de la pantalla de inicio de sesión y guarda de sesión reutilizable
 * en index.html (redirige a login.html si no hay token guardado).
 */

/** Llamar al comienzo de cualquier página protegida (requiere sesión activa). */
function exigirSesionActiva() {
  if (!ApiCliente.obtenerToken()) {
    window.location.href = 'login.html';
    return null;
  }
  return ApiCliente.obtenerUsuario();
}

async function manejarEnvioLogin(evento) {
  evento.preventDefault();
  const username = document.getElementById('loginUsuario').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorBox = document.getElementById('loginError');
  const boton = document.getElementById('loginBoton');

  errorBox.classList.add('hidden');
  boton.disabled = true;
  boton.textContent = 'Ingresando...';

  try {
    const respuesta = await ApiCliente.post('/api/auth/login', { username, password });
    ApiCliente.guardarSesion(respuesta.token, respuesta.usuario);
    window.location.href = 'index.html';
  } catch (err) {
    errorBox.textContent = err.message || 'No fue posible iniciar sesión.';
    errorBox.classList.remove('hidden');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Iniciar Sesión';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Si ya hay una sesión guardada y estamos en la pantalla de login, saltar directo a la app.
  if (document.getElementById('loginForm')) {
    if (ApiCliente.obtenerToken()) {
      window.location.href = 'index.html';
      return;
    }
    document.getElementById('loginForm').addEventListener('submit', manejarEnvioLogin);
  }
});
