/**
 * Punto de arranque del backend de CarWash Pro.
 *
 * Este es el archivo que se ejecuta para levantar el servidor localmente:
 *
 *   cd backend
 *   npm install
 *   npm start
 *
 * Antes de arrancar, verifica que exista un archivo backend/.env (copiado
 * desde .env.example) con las credenciales de tu base de datos MySQL y que
 * ya hayas ejecutado backend/database/schema.sql en tu servidor.
 */
require('dotenv').config();

// El sistema trabaja en hora local de Colombia (ver src/utilidades/fechas.js:
// obtenerFechaHoy/obtenerHoraActual usan new Date() sin conversión manual de
// zona horaria). En Railway/Render el servidor corre en otro país (otro TZ
// del sistema operativo), así que hay que fijar esto explícitamente ANTES de
// cualquier otro require, o "hoy" y "ahora mismo" saldrían mal en asistencia,
// facturas, cierres de caja, etc.
process.env.TZ = 'America/Bogota';

const app = require('./src/app');
const { verificarConexion } = require('./src/config/baseDeDatos');

const PUERTO = process.env.PORT || 3000;

async function iniciarServidor() {
  if (!process.env.JWT_SECRET) {
    console.error('❌ Falta JWT_SECRET en el archivo .env. Copia .env.example a .env y complétalo.');
    process.exit(1);
  }

  try {
    await verificarConexion();
    console.log('✅ Conexión a MySQL verificada.');
  } catch (err) {
    console.error('❌ No se pudo conectar a MySQL. Revisa DB_HOST/DB_USER/DB_PASSWORD/DB_NAME en tu .env.');
    console.error('   Detalle:', err.message);
    process.exit(1);
  }

  app.listen(PUERTO, () => {
    console.log('=======================================================');
    console.log(`🚀 CarWash Pro backend activo en http://localhost:${PUERTO}`);
    console.log('=======================================================');
  });
}

iniciarServidor();
