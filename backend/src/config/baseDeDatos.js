/**
 * Pool de conexiones a MySQL (mysql2/promise).
 *
 * Un "pool" reutiliza un número limitado de conexiones abiertas en vez de
 * crear una conexión nueva por cada consulta: es la forma recomendada de
 * conectar un servidor Express a MySQL en producción.
 */
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'carwash_pro',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true // devuelve DATE/DATETIME como texto 'YYYY-MM-DD HH:mm:ss' en vez de objetos Date con zona horaria
});

/**
 * Verifica que la base de datos responda. Se usa al iniciar el servidor
 * para fallar rápido y con un mensaje claro si el .env está mal configurado.
 */
async function verificarConexion() {
  const conexion = await pool.getConnection();
  try {
    await conexion.ping();
  } finally {
    conexion.release();
  }
}

module.exports = { pool, verificarConexion };
