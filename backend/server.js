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

const app = require('./src/app');
const { verificarConexion } = require('./src/config/baseDeDatos');

const PUERTO = process.env.PORT || 3000;

// En plataformas como Render, la salida a internet del contenedor a veces
// tarda unos segundos en quedar lista justo después del arranque, y el
// primer intento de conexión a una base de datos externa puede fallar con
// un timeout aunque la base esté perfectamente disponible. Reintentamos
// unas cuantas veces antes de darnos por vencidos.
async function verificarConexionConReintentos(intentos = 5, esperaMs = 3000) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      await verificarConexion();
      return;
    } catch (err) {
      if (intento === intentos) throw err;
      console.warn(`⚠️  Intento ${intento}/${intentos} de conexión a MySQL falló (${err.message}), reintentando en ${esperaMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }
}

async function iniciarServidor() {
  if (!process.env.JWT_SECRET) {
    console.error('❌ Falta JWT_SECRET en el archivo .env. Copia .env.example a .env y complétalo.');
    process.exit(1);
  }

  try {
    await verificarConexionConReintentos();
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
