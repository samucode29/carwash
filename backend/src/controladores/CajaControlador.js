/**
 * Controlador de pagos y cierre de caja diario (CU10, CU20, CU21 /
 * RF11, RF12, RF22).
 */
const CajaRepositorio = require('../repositorios/CajaRepositorio');
const OrdenServicioRepositorio = require('../repositorios/OrdenServicioRepositorio');
const ServicioRepositorio = require('../repositorios/ServicioRepositorio');
const FacturaRepositorio = require('../repositorios/FacturaRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const { obtenerFechaHoy } = require('../utilidades/fechas');

const METODOS_VALIDOS = ['efectivo', 'tarjeta', 'transferencia', 'pse'];

async function registrarPago(req, res) {
  const { orden_id, metodo_pago, monto } = req.body;
  const orden = await OrdenServicioRepositorio.obtenerOrdenPorId(parseInt(orden_id, 10));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada.' });

  if (!METODOS_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({ error: 'Método de pago no válido.' });
  }

  const montoPagado = parseFloat(monto) || Number(orden.total);
  const pago = await CajaRepositorio.registrarPago({
    ordenId: orden.id,
    metodoPago: metodo_pago,
    monto: montoPagado
  });

  const servicio = await ServicioRepositorio.obtenerPorId(orden.servicio_id);
  const factura = await FacturaRepositorio.crearFactura({
    tipo: 'venta', ordenId: orden.id, clienteId: orden.cliente_id,
    concepto: servicio ? servicio.nombre : 'Servicio de lavado',
    total: montoPagado, fecha: obtenerFechaHoy(), creadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'procesar_pago', `Pago registrado Orden #${orden.id}: $${pago.monto} vía ${metodo_pago} (Factura ${factura.numero_factura})`);
  res.status(201).json({ ordenId: orden.id, pago, factura });
}

async function obtenerResumenCaja(req, res) {
  const fecha = req.query.fecha || obtenerFechaHoy();
  const resumen = await CajaRepositorio.obtenerResumenPorFecha(fecha);
  const cierreExistente = await CajaRepositorio.obtenerCierrePorFecha(fecha);

  res.json({ fecha, ...resumen, esta_cerrada: !!cierreExistente, cierre_detalle: cierreExistente });
}

async function cerrarCaja(req, res) {
  const { fecha, observaciones } = req.body;
  const fechaCierre = fecha || obtenerFechaHoy();

  const yaExiste = await CajaRepositorio.obtenerCierrePorFecha(fechaCierre);
  if (yaExiste) {
    return res.status(400).json({ error: `La caja para la fecha ${fechaCierre} ya fue cerrada previamente.` });
  }

  const resumen = await CajaRepositorio.obtenerResumenPorFecha(fechaCierre);
  const cierre = await CajaRepositorio.crearCierre({ fecha: fechaCierre, usuarioId: req.usuarioAutenticado.id, resumen, observaciones });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'cierre_caja', `Cierre de caja para ${fechaCierre}: Total $${cierre.total_general}`);
  res.status(201).json(cierre);
}

async function listarHistorialCierres(req, res) {
  res.json(await CajaRepositorio.listarHistorialCierres());
}

module.exports = { registrarPago, obtenerResumenCaja, cerrarCaja, listarHistorialCierres };
