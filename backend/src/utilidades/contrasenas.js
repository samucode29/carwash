/**
 * Envoltorio delgado sobre bcryptjs para no repetir el número de "salt rounds"
 * en cada archivo que necesite crear o validar contraseñas.
 */
const bcrypt = require('bcryptjs');

const RONDAS_SAL = 10;

function hashearContrasena(textoPlano) {
  return bcrypt.hashSync(textoPlano, RONDAS_SAL);
}

function compararContrasena(textoPlano, hash) {
  return bcrypt.compareSync(textoPlano, hash);
}

module.exports = { hashearContrasena, compararContrasena };
