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

/**
 * Contraseña por defecto para cuentas nuevas y para el "reinicio" que hace
 * el administrador cuando alguien olvida su contraseña: "carwash" seguido
 * del número de documento/cédula del usuario, sin espacios.
 */
function generarPasswordPorDefecto(documento) {
  return `carwash${documento}`;
}

module.exports = { hashearContrasena, compararContrasena, generarPasswordPorDefecto };
