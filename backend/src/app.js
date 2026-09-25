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
app.use('/api', rutasApi);

// El backend también sirve el frontend estático (vive en backend/frontend)
// para poder probar/desplegar todo con un solo comando y un solo puerto.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use(manejadorErrores);

module.exports = app;
