/**
 * Normaliza texto para usarlo en identificadores (nombres de usuario):
 * minúsculas y sin tildes/diacríticos, para que "Gómez" y "Petro Ávalos"
 * generen usuarios limpios como "laura.gomez" o "samuel.petro".
 */
function normalizarParaUsername(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes/diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // solo letras/números, sin espacios ni signos
}

module.exports = { normalizarParaUsername };
