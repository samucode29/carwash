/**
 * Reglas comunes de las personas del sistema (clientes, empleados/administradores
 * y lavadores): nombre separado en "nombres" y "apellidos", y celular único
 * entre TODAS las personas (dos personas, sean cliente, empleado o lavador,
 * no pueden compartir el mismo número).
 *
 * La columna `nombre` se conserva como el nombre completo ("nombres apellidos")
 * porque reportes, facturas, listas y comprobantes la usan para mostrar a la
 * persona; siempre se arma con armarNombreCompleto() al guardar.
 */
const { pool } = require('../config/baseDeDatos');
const { esNombreValido } = require('./validadores');

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'di', 'van', 'von']);

// Apellidos que se asignan a quien solo tenía un nombre registrado (la persona
// puede corregirlo luego desde "Editar"). Se eligen por el id para que el
// resultado sea siempre el mismo.
const APELLIDOS_POR_DEFECTO = ['García', 'Rodríguez', 'Martínez', 'López', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flórez'];

function limpiarEspacios(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ');
}

/** "andres felipe" -> "Andres Felipe" (solo palabras escritas todas en minúscula; respeta "de", "del"...). */
function capitalizar(texto) {
  return limpiarEspacios(texto).split(' ').map((palabra, i) => {
    if (palabra !== palabra.toLowerCase()) return palabra; // ya trae mayúsculas: no se toca
    if (i > 0 && PARTICULAS.has(palabra)) return palabra;
    return palabra.charAt(0).toUpperCase() + palabra.slice(1);
  }).join(' ');
}

function armarNombreCompleto(nombres, apellidos) {
  return limpiarEspacios(`${nombres} ${apellidos}`);
}

/**
 * Separa un nombre completo ya existente: 2 palabras -> nombre y apellido;
 * 3 -> un nombre y dos apellidos; 4 o más -> dos nombres y el resto apellidos.
 * Si solo tiene una palabra se le asigna un apellido por defecto.
 */
function dividirNombreCompleto(nombreCompleto, semilla = 0) {
  const palabras = limpiarEspacios(nombreCompleto).split(' ').filter(Boolean);
  let nombres;
  let apellidos;
  if (palabras.length <= 1) {
    nombres = palabras[0] || 'Sin nombre';
    apellidos = APELLIDOS_POR_DEFECTO[Math.abs(Number(semilla) || 0) % APELLIDOS_POR_DEFECTO.length];
  } else if (palabras.length === 2 || palabras.length === 3) {
    nombres = palabras[0];
    apellidos = palabras.slice(1).join(' ');
  } else {
    nombres = palabras.slice(0, 2).join(' ');
    apellidos = palabras.slice(2).join(' ');
  }
  return { nombres: capitalizar(nombres), apellidos: capitalizar(apellidos) };
}

/**
 * Lee nombres y apellidos de un cuerpo de petición. Si la petición trae el
 * antiguo campo `nombre` (completo) lo separa solo. Devuelve { error } o
 * { nombres, apellidos, nombre }.
 */
function interpretarNombre(cuerpo) {
  let nombres = cuerpo.nombres;
  let apellidos = cuerpo.apellidos;
  if ((nombres === undefined || nombres === null) && (apellidos === undefined || apellidos === null) && cuerpo.nombre) {
    ({ nombres, apellidos } = dividirNombreCompleto(cuerpo.nombre, 0));
  }
  nombres = limpiarEspacios(nombres);
  apellidos = limpiarEspacios(apellidos);

  if (!nombres) return { error: 'Los nombres son obligatorios.' };
  if (!apellidos) return { error: 'Los apellidos son obligatorios.' };
  if (!esNombreValido(nombres)) return { error: 'Los nombres deben tener solo letras y espacios, mínimo 3 caracteres.' };
  if (!esNombreValido(apellidos)) return { error: 'Los apellidos deben tener solo letras y espacios, mínimo 3 caracteres.' };

  nombres = capitalizar(nombres);
  apellidos = capitalizar(apellidos);
  return { nombres, apellidos, nombre: armarNombreCompleto(nombres, apellidos) };
}

/** ¿La petición intenta cambiar el nombre? (nombres, apellidos o el campo antiguo). */
function traeNombre(cuerpo) {
  return cuerpo.nombres !== undefined || cuerpo.apellidos !== undefined || !!cuerpo.nombre;
}

const ETIQUETA_TIPO = { cliente: 'cliente', empleado: 'empleado', lavador: 'lavador' };

/**
 * Busca a quién pertenece un celular entre clientes, empleados/administradores
 * y lavadores. `excluir` ({tipo, id}) deja fuera a la propia persona al editarla.
 */
async function buscarDuenoDeCelular(telefono, excluir = null) {
  const numero = String(telefono || '').trim();
  if (!numero) return null;
  const [filas] = await pool.query(
    `SELECT 'cliente' AS tipo, id, nombre FROM clientes WHERE telefono = ?
     UNION ALL SELECT 'empleado', id, nombre FROM usuarios WHERE telefono = ?
     UNION ALL SELECT 'lavador', id, nombre FROM lavadores WHERE telefono = ?`,
    [numero, numero, numero]
  );
  return filas.find(f => !(excluir && excluir.tipo === f.tipo && Number(excluir.id) === Number(f.id))) || null;
}

/** Lanza un error 400 si otra persona ya tiene ese celular. */
async function exigirCelularUnico(telefono, excluir = null) {
  const dueno = await buscarDuenoDeCelular(telefono, excluir);
  if (dueno) {
    throw Object.assign(
      new Error(`El celular ${String(telefono).trim()} ya está registrado a ${dueno.nombre} (${ETIQUETA_TIPO[dueno.tipo]}). Dos personas no pueden tener el mismo número.`),
      { codigoHttp: 400 }
    );
  }
}

module.exports = {
  capitalizar, armarNombreCompleto, dividirNombreCompleto, interpretarNombre, traeNombre,
  buscarDuenoDeCelular, exigirCelularUnico
};
