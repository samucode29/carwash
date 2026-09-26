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
  const { orden_id, metodo_pago, descuento_negocio, descuento_trabajador, observacion } = req.body;
  const orden = await OrdenServicioRepositorio.obtenerOrdenPorId(parseInt(orden_id, 10));
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada.' });

  if (!METODOS_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({ error: 'Método de pago no válido.' });
  }

  // El total de la orden (y por lo tanto orden_lavadores.valor_comision, ya
  // fijada al crear la orden) nunca cambia por un descuento. Lo que sí
  // puede pasar es que ese descuento lo asuma el negocio (descuento_negocio,
  // sale de la ganancia) o el lavador (descuento_trabajador, ej. el cliente
  // no pagó por su culpa: se le resta de su comisión pendiente más adelante,
  // ver NominaRepositorio.resumenComisionesLavadores). Todo se valida acá,
  // en el backend, en vez de confiar en lo que mande el cliente.
  const totalOrden = Number(orden.total);
  const valorDescNegocio = parseFloat(descuento_negocio) || 0;
  const valorDescTrabajador = parseFloat(descuento_trabajador) || 0;
  if (valorDescNegocio < 0 || valorDescTrabajador < 0) {
    return res.status(400).json({ error: 'Los descuentos no pueden ser negativos.' });
  }
  if (valorDescNegocio + valorDescTrabajador > totalOrden) {
    return res.status(400).json({ error: 'La suma de los descuentos no puede superar el total del servicio.' });
  }
  if (valorDescTrabajador > 0) {
    const lavadoresPorOrden = await OrdenServicioRepositorio.obtenerLavadoresPorOrdenes([orden.id]);
    const comisionTotalOrden = (lavadoresPorOrden[orden.id] || []).reduce((s, l) => s + Number(l.valor_comision), 0);
    if (valorDescTrabajador > comisionTotalOrden) {
      return res.status(400).json({ error: `El descuento al trabajador no puede superar su comisión en este servicio (${comisionTotalOrden}).` });
    }
  }
  const montoPagado = totalOrden - valorDescNegocio - valorDescTrabajador;

  const pago = await CajaRepositorio.registrarPago({
    ordenId: orden.id,
    metodoPago: metodo_pago,
    monto: montoPagado,
    descuentoNegocio: valorDescNegocio,
    descuentoTrabajador: valorDescTrabajador,
    observacion: observacion || null
  });

  const servicio = await ServicioRepositorio.obtenerPorId(orden.servicio_id);
  const factura = await FacturaRepositorio.crearFactura({
    tipo: 'venta', ordenId: orden.id, clienteId: orden.cliente_id,
    concepto: servicio ? servicio.nombre : 'Servicio de lavado',
    total: montoPagado, fecha: obtenerFechaHoy(), creadoPor: req.usuarioAutenticado.id
  });

  const detalles = [];
  if (valorDescNegocio > 0) detalles.push(`descuento negocio $${valorDescNegocio}`);
  if (valorDescTrabajador > 0) detalles.push(`descuento trabajador $${valorDescTrabajador}`);
  const detalleDescuento = detalles.length ? ` (${detalles.join(', ')})` : '';
  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'procesar_pago', `Pago registrado Orden #${orden.id}: $${pago.monto}${detalleDescuento} vía ${metodo_pago} (Factura ${factura.numero_factura})`);
  res.status(201).json({ ordenId: orden.id, pago, factura });
}

async function obtenerResumenCaja(req, res) {
  const fecha = req.query.fecha || obtenerFechaHoy();
  const resumen = await CajaRepositorio.obtenerResumenPorFecha(fecha);
  const cierreExistente = await CajaRepositorio.obtenerCierrePorFecha(fecha);
  const pendientes = await CajaRepositorio.contarPendientesPorFecha(fecha);

  res.json({ fecha, ...resumen, esta_cerrada: !!cierreExistente, cierre_detalle: cierreExistente, pendientes });
}

async function cerrarCaja(req, res) {
  const { fecha, observaciones } = req.body;
  const fechaCierre = fecha || obtenerFechaHoy();

  const yaExiste = await CajaRepositorio.obtenerCierrePorFecha(fechaCierre);
  if (yaExiste) {
    return res.status(400).json({ error: `La caja para la fecha ${fechaCierre} ya fue cerrada previamente.` });
  }

  // No se puede cerrar caja si queda algún servicio en espera, en proceso
  // o terminado-sin-cobrar: solo cuando todo lo del día está finalizado
  // y pagado (o cancelado, que no cuenta) se puede consolidar el arqueo.
  const pendientes = await CajaRepositorio.contarPendientesPorFecha(fechaCierre);
  if (pendientes.total > 0) {
    const partes = [];
    if (pendientes.turnos > 0) partes.push(`${pendientes.turnos} en fila de espera`);
    if (pendientes.ordenes > 0) partes.push(`${pendientes.ordenes} sin finalizar/cobrar`);
    return res.status(400).json({
      error: `No se puede cerrar caja: hay ${pendientes.total} servicio(s) pendiente(s) (${partes.join(', ')}). Atienda, cobre o cancele esos servicios primero.`
    });
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
