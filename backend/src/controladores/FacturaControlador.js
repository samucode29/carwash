/**
 * Consulta de facturas (compra y venta). La creación no pasa por aquí: se
 * dispara automáticamente desde InventarioControlador.registrarEntrada
 * (compra) y CajaControlador.registrarPago (venta).
 */
const FacturaRepositorio = require('../repositorios/FacturaRepositorio');
const { generarPdfFactura } = require('../utilidades/generadorFacturaPdf');

async function listarFacturas(req, res) {
  const { tipo, fecha_inicio, fecha_fin } = req.query;
  res.json(await FacturaRepositorio.listarFacturas({ tipo, fechaInicio: fecha_inicio, fechaFin: fecha_fin }));
}

async function obtenerFactura(req, res) {
  const factura = await FacturaRepositorio.obtenerFacturaPorId(Number(req.params.id));
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada.' });
  res.json(factura);
}

async function descargarFacturaPdf(req, res) {
  const factura = await FacturaRepositorio.obtenerFacturaPorId(Number(req.params.id));
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada.' });
  generarPdfFactura(res, factura);
}

module.exports = { listarFacturas, obtenerFactura, descargarFacturaPdf };
