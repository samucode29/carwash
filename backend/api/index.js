/**
 * Punto de entrada específico para desplegar el backend como función
 * serverless en Vercel. A diferencia de server.js (que llama app.listen()
 * para correr localmente), aquí solo se exporta la app de Express: Vercel
 * se encarga de invocarla por cada petición entrante a /api/*.
 */
require('dotenv').config();
module.exports = require('../src/app');
