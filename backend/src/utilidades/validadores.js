/**
 * Validaciones de formato reutilizadas en los formularios de personas
 * (usuarios, lavadores, clientes): nombre solo letras, documento/teléfono
 * solo números con una longitud mínima razonable, y correo con formato
 * válido. Son las mismas validaciones básicas que se usan en cualquier
 * sistema de gestión de este tipo para evitar datos basura (nombres con
 * números, documentos con letras, etc.).
 */
const REGEX_NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;
const REGEX_SOLO_NUMEROS = /^[0-9]+$/;
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LONGITUD_MINIMA_NOMBRE = 3;
const LONGITUD_MINIMA_DOCUMENTO = 4;
const LONGITUD_MAXIMA_DOCUMENTO = 15;
const LONGITUD_MINIMA_TELEFONO = 7;
const LONGITUD_MAXIMA_TELEFONO = 10;

function esNombreValido(texto) {
  const limpio = (texto || '').trim();
  return limpio.length >= LONGITUD_MINIMA_NOMBRE && REGEX_NOMBRE.test(limpio);
}

function esDocumentoValido(texto) {
  const limpio = (texto || '').trim();
  return (
    limpio.length >= LONGITUD_MINIMA_DOCUMENTO &&
    limpio.length <= LONGITUD_MAXIMA_DOCUMENTO &&
    REGEX_SOLO_NUMEROS.test(limpio)
  );
}

function esTelefonoValido(texto) {
  const limpio = (texto || '').trim();
  return (
    limpio.length >= LONGITUD_MINIMA_TELEFONO &&
    limpio.length <= LONGITUD_MAXIMA_TELEFONO &&
    REGEX_SOLO_NUMEROS.test(limpio)
  );
}

/** El correo casi siempre es opcional en estos formularios: solo se valida el formato si se escribió algo. */
function esCorreoValido(texto) {
  const limpio = (texto || '').trim();
  return limpio === '' || REGEX_CORREO.test(limpio);
}

module.exports = {
  esNombreValido,
  esDocumentoValido,
  esTelefonoValido,
  esCorreoValido,
  LONGITUD_MINIMA_NOMBRE,
  LONGITUD_MINIMA_DOCUMENTO,
  LONGITUD_MINIMA_TELEFONO
};
