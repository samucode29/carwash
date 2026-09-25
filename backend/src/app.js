/**
 * Configuración de la aplicación Express: middlewares globales y montaje
 * de rutas. No arranca el servidor HTTP (eso lo hace server.js) para poder
 * reutilizar esta misma app en pruebas o en un entorno serverless.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rutasApi = require('./rutas');
const { manejadorErrores } = require('./middlewares/manejadorErrores');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGEN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/salud', (req, res) => res.json({ ok: true, servicio: 'carwash-pro-backend' }));
app.use('/api', rutasApi);

// En desarrollo local, el backend también sirve el frontend estático para
// poder probar todo con un solo comando (npm start) y un solo puerto. En
// producción normalmente el frontend se despliega aparte (ver README).
// Algunas plataformas (Railway) solo empaquetan el directorio raíz del
// proyecto Node (backend/) y descartan carpetas hermanas como frontend/,
// así que ahí el build copia frontend/ dentro de backend/frontend. Se
// prueban ambas ubicaciones para no romper Render/local, donde sí quedan
// como hermanas.
const rutaFrontend = [
  path.join(__dirname, '..', 'frontend'),
  path.join(__dirname, '..', '..', 'frontend')
].find((ruta) => fs.existsSync(path.join(ruta, 'index.html')));

if (rutaFrontend) {
  app.use(express.static(rutaFrontend));
}

app.use(manejadorErrores);

module.exports = app;
