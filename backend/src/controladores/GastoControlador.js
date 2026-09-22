/** Controlador de gastos operativos (usado en el dashboard de ganancias). */
const GastoRepositorio = require('../repositorios/GastoRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { obtenerFechaHoy } = require('../utilidades/fechas');

async function listarGastos(req, res) {
  res.json(await GastoRepositorio.listar());
}

async function crearGasto(req, res) {
  const { concepto, monto, fecha } = req.body;
  if (!concepto || !monto) return res.status(400).json({ error: 'Concepto y monto son obligatorios.' });

  const nuevo = await GastoRepositorio.crear({
    concepto, monto: parseFloat(monto), fecha: fecha || obtenerFechaHoy(), usuarioId: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'registrar_gasto', `Gasto registrado: ${concepto} ($${nuevo.monto})`);
  res.status(201).json(nuevo);
}

module.exports = { listarGastos, crearGasto };
