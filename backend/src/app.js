/**
 * Configuración de la aplicación Express: middlewares globales y montaje
 * de rutas. No arranca el servidor HTTP (eso lo hace server.js) para poder
 * reutilizar esta misma app en pruebas o en un entorno serverless.
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const rutasApi = require('./rutas');
const { manejadorErrores } = require('./middlewares/manejadorErrores');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGEN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/salud', (req, res) => res.json({ ok: true, servicio: 'carwash-pro-backend' }));

// TEMPORAL: endpoint de diagnóstico para depurar el "connect ETIMEDOUT" al
// conectar a Aiven desde Render. Prueba primero un socket TCP crudo (sin
// pasar por mysql2) y luego una consulta real, para aislar si el bloqueo
// es de red o de la librería/SSL. Quitar una vez resuelto.
app.get('/api/diagnostico-db', async (req, res) => {
  const net = require('net');
  const resultado = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    ssl: process.env.DB_SSL
  };

  await new Promise((resolve) => {
    const inicio = Date.now();
    const socket = net.createConnection(Number(process.env.DB_PORT), process.env.DB_HOST);
    socket.setTimeout(8000);
    socket.on('connect', () => {
      resultado.tcp = { ok: true, ms: Date.now() - inicio };
      socket.end();
      resolve();
    });
    socket.on('timeout', () => {
      resultado.tcp = { ok: false, error: 'timeout', ms: Date.now() - inicio };
      socket.destroy();
      resolve();
    });
    socket.on('error', (err) => {
      resultado.tcp = { ok: false, error: err.message, ms: Date.now() - inicio };
      resolve();
    });
  });

  try {
    const { pool } = require('./config/baseDeDatos');
    const inicio2 = Date.now();
    await pool.query('SELECT 1');
    resultado.mysql = { ok: true, ms: Date.now() - inicio2 };
  } catch (err) {
    resultado.mysql = { ok: false, error: err.message, code: err.code };
  }

  res.json(resultado);
});

app.use('/api', rutasApi);

// En desarrollo local, el backend también sirve el frontend estático para
// poder probar todo con un solo comando (npm start) y un solo puerto. En
// producción normalmente el frontend se despliega aparte (ver README).
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

app.use(manejadorErrores);

module.exports = app;
