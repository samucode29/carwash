/**
 * Reportes "de una sola persona": todo lo que compró un cliente específico y
 * todo lo que hizo (y ganó) un lavador específico en un rango de fechas.
 * Alimentan la misma vista en pantalla y PDF que el resto de reportes
 * (ver vistasReporteDetalle.js).
 */
const { pool } = require('../config/baseDeDatos');
const { planSerie, acumularSerie } = require('../utilidades/seriesReporte');
const { agruparVentasPorDia, MAX_FILAS_DETALLE } = require('./ReporteRepositorio');

const redondear = (n) => Number(Number(n || 0).toFixed(2));

function noEncontrado(texto) {
  return Object.assign(new Error(texto), { codigoHttp: 404 });
}

const SQL_LAVADORES_DE_ORDEN = `(SELECT GROUP_CONCAT(l.nombre ORDER BY l.nombre SEPARATOR ', ')
   FROM orden_lavadores ol INNER JOIN lavadores l ON l.id = ol.lavador_id
   WHERE ol.orden_id = o.id)`;

// ---------------------------------------------------------------------------
// CLIENTE
// ---------------------------------------------------------------------------
/**
 * `clienteId` es el id de un cliente o 'anonimo': todas las ventas sin cliente
 * registrado (ventas rápidas) se reportan juntas como si fueran un cliente.
 */
async function calcularReporteCliente(inicio, fin, clienteId) {
  const esAnonimo = clienteId === 'anonimo';
  const condOrden = esAnonimo ? 'o.cliente_id IS NULL' : 'o.cliente_id = ?';
  const condCita = esAnonimo ? 'c.cliente_id IS NULL' : 'c.cliente_id = ?';
  const paramId = esAnonimo ? [] : [clienteId];

  let cliente;
  let vehiculos = [];
  let notas = [];
  if (esAnonimo) {
    cliente = { id: 'anonimo', nombre: 'Venta anónima', telefono: '', correo: '', estado: 'activo', creado_en: null, anonimo: true };
  } else {
    [[cliente]] = await pool.query(`SELECT * FROM clientes WHERE id = ?`, [clienteId]);
    if (!cliente) throw noEncontrado('Cliente no encontrado.');
    [vehiculos] = await pool.query(`SELECT placa, tipo, marca, color FROM vehiculos WHERE cliente_id = ? ORDER BY id`, [clienteId]);
    [notas] = await pool.query(`SELECT tipo, texto, creado_en FROM cliente_notas WHERE cliente_id = ? ORDER BY id DESC`, [clienteId]);
  }

  const [[historico]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(p.monto), 0) AS total, MIN(p.fecha_pago) AS primera, MAX(p.fecha_pago) AS ultima
     FROM pagos p INNER JOIN ordenes_servicio o ON o.id = p.orden_id WHERE ${condOrden}`,
    paramId
  );

  const [pagos] = await pool.query(
    `SELECT p.id AS pago_id, p.fecha_pago, p.metodo_pago, p.monto, p.descuento_negocio, p.descuento_trabajador,
            p.propina, p.observacion, o.id AS orden_id, o.total AS valor_lista, s.nombre AS servicio_nombre,
            COALESCE(v.tipo, o.tipo_vehiculo_anonimo, 'carro') AS tipo_vehiculo,
            COALESCE(v.placa, o.placa_anonima) AS placa,
            ${SQL_LAVADORES_DE_ORDEN} AS lavadores,
            (SELECT f.numero_factura FROM facturas f WHERE f.orden_id = o.id AND f.tipo = 'venta' ORDER BY f.id LIMIT 1) AS factura
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     WHERE ${condOrden} AND DATE(p.fecha_pago) BETWEEN ? AND ?
     ORDER BY p.fecha_pago DESC`,
    [...paramId, inicio, fin]
  );

  const porServicio = {};
  const porVehiculo = {};
  const metodosDetalle = {};
  let total = 0;
  let valorLista = 0;
  let descuentoNegocio = 0;
  let descuentoTrabajador = 0;
  let propinas = 0;
  pagos.forEach(p => {
    const monto = Number(p.monto);
    total += monto;
    valorLista += Number(p.valor_lista);
    descuentoNegocio += Number(p.descuento_negocio || 0);
    descuentoTrabajador += Number(p.descuento_trabajador || 0);
    propinas += Number(p.propina || 0);
    const servicio = p.servicio_nombre || 'Otros';
    const claveServicio = `${servicio}|${p.tipo_vehiculo}`;
    if (!porServicio[claveServicio]) porServicio[claveServicio] = { servicio, tipoVehiculo: p.tipo_vehiculo, cantidad: 0, total: 0 };
    porServicio[claveServicio].cantidad += 1;
    porServicio[claveServicio].total += monto;
    const placa = p.placa || 'Sin placa';
    if (!porVehiculo[placa]) porVehiculo[placa] = { placa, tipoVehiculo: p.tipo_vehiculo, cantidad: 0, total: 0 };
    porVehiculo[placa].cantidad += 1;
    porVehiculo[placa].total += monto;
    if (!metodosDetalle[p.metodo_pago]) metodosDetalle[p.metodo_pago] = { cantidad: 0, total: 0 };
    metodosDetalle[p.metodo_pago].cantidad += 1;
    metodosDetalle[p.metodo_pago].total += monto;
  });

  const [porLavador] = await pool.query(
    `SELECT l.id, l.nombre, COUNT(DISTINCT o.id) AS servicios, COALESCE(SUM(p.monto), 0) AS total, MAX(p.fecha_pago) AS ultima
     FROM orden_lavadores ol
     INNER JOIN ordenes_servicio o ON o.id = ol.orden_id
     INNER JOIN pagos p ON p.orden_id = o.id
     INNER JOIN lavadores l ON l.id = ol.lavador_id
     WHERE ${condOrden} AND DATE(p.fecha_pago) BETWEEN ? AND ?
     GROUP BY l.id, l.nombre ORDER BY servicios DESC, total DESC`,
    [...paramId, inicio, fin]
  );

  const [citas] = await pool.query(
    `SELECT c.fecha, c.hora, c.estado, s.nombre AS servicio_nombre, COALESCE(v.placa, c.placa_temp) AS placa
     FROM citas c
     LEFT JOIN servicios s ON s.id = c.servicio_id
     LEFT JOIN vehiculos v ON v.id = c.vehiculo_id
     WHERE ${condCita} AND c.fecha BETWEEN ? AND ?
     ORDER BY c.fecha DESC, c.hora DESC`,
    [...paramId, inicio, fin]
  );

  // Servicios del cliente que no terminaron en una venta cobrada (cancelados
  // o que siguen abiertos sin cobrar).
  const [noCobrados] = await pool.query(
    `SELECT o.id AS orden_id, o.estado, o.total, o.fecha_hora_registro, s.nombre AS servicio_nombre,
            COALESCE(v.placa, o.placa_anonima) AS placa, ${SQL_LAVADORES_DE_ORDEN} AS lavadores
     FROM ordenes_servicio o
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     WHERE ${condOrden} AND o.estado <> 'entregado' AND DATE(o.fecha_hora_registro) BETWEEN ? AND ?
     ORDER BY o.fecha_hora_registro DESC`,
    [...paramId, inicio, fin]
  );

  const plan = planSerie(inicio, fin);
  return {
    rango: { inicio, fin },
    cliente: {
      id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono, correo: cliente.correo || '',
      estado: cliente.estado, desde: cliente.creado_en, anonimo: !!cliente.anonimo
    },
    vehiculos, notas,
    historico: {
      ventas: historico.ventas, total: Number(historico.total), primera: historico.primera, ultima: historico.ultima
    },
    cantidad: pagos.length,
    total: redondear(total), valorLista: redondear(valorLista),
    ticketPromedio: pagos.length > 0 ? Math.round(total / pagos.length) : 0,
    descuentoNegocio: redondear(descuentoNegocio), descuentoTrabajador: redondear(descuentoTrabajador), propinas: redondear(propinas),
    serie: {
      gran: plan.gran, etiquetas: plan.etiquetas,
      ingresos: acumularSerie(plan, pagos, p => p.fecha_pago, p => p.monto)
    },
    porDia: agruparVentasPorDia(pagos),
    serviciosDetalle: Object.values(porServicio).sort((a, b) => b.total - a.total),
    vehiculosDetalle: Object.values(porVehiculo).sort((a, b) => b.total - a.total),
    metodosDetalle,
    porLavador: porLavador.map(l => ({ id: l.id, nombre: l.nombre, servicios: l.servicios, total: Number(l.total), ultima: l.ultima })),
    citas,
    noCobrados: noCobrados.map(o => ({
      ordenId: o.orden_id, estado: o.estado, total: Number(o.total), fecha: o.fecha_hora_registro,
      servicio: o.servicio_nombre || 'Otros', placa: o.placa || '-', lavadores: o.lavadores || 'Sin asignar'
    })),
    detalleTotal: pagos.length,
    detalle: pagos.slice(0, MAX_FILAS_DETALLE).map(p => ({
      fecha: p.fecha_pago, ordenId: p.orden_id, factura: p.factura || '-', placa: p.placa || '-',
      servicio: p.servicio_nombre || 'Otros', tipoVehiculo: p.tipo_vehiculo, lavadores: p.lavadores || 'Sin asignar',
      metodo: p.metodo_pago, valorLista: Number(p.valor_lista), monto: Number(p.monto),
      descuentoNegocio: Number(p.descuento_negocio || 0), descuentoTrabajador: Number(p.descuento_trabajador || 0),
      propina: Number(p.propina || 0), observacion: p.observacion || ''
    }))
  };
}

// ---------------------------------------------------------------------------
// LAVADOR
// ---------------------------------------------------------------------------
async function calcularReporteLavador(inicio, fin, lavadorId) {
  const [[lavador]] = await pool.query(`SELECT * FROM lavadores WHERE id = ?`, [lavadorId]);
  if (!lavador) throw noEncontrado('Lavador no encontrado.');
  const [[acceso]] = await pool.query(`SELECT username, estado FROM usuarios WHERE lavador_id = ?`, [lavadorId]);

  const [filas] = await pool.query(
    `SELECT o.id AS orden_id, o.fecha_hora_registro, o.fecha_hora_entrega, o.es_venta_anonima, o.total AS valor_servicio,
            p.fecha_pago, p.metodo_pago, p.monto, p.descuento_negocio, p.descuento_trabajador, p.propina, p.observacion,
            ol.porcentaje_comision, ol.valor_comision, s.nombre AS servicio_nombre, cl.nombre AS cliente_nombre,
            COALESCE(v.tipo, o.tipo_vehiculo_anonimo, 'carro') AS tipo_vehiculo,
            COALESCE(v.placa, o.placa_anonima) AS placa,
            (SELECT SUM(x.valor_comision) FROM orden_lavadores x WHERE x.orden_id = o.id) AS comision_total_orden,
            (SELECT COUNT(*) FROM orden_lavadores x WHERE x.orden_id = o.id) AS lavadores_count,
            (SELECT GROUP_CONCAT(l2.nombre ORDER BY l2.nombre SEPARATOR ', ')
             FROM orden_lavadores x INNER JOIN lavadores l2 ON l2.id = x.lavador_id
             WHERE x.orden_id = o.id AND x.lavador_id <> ol.lavador_id) AS companeros
     FROM orden_lavadores ol
     INNER JOIN ordenes_servicio o ON o.id = ol.orden_id
     INNER JOIN pagos p ON p.orden_id = o.id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     LEFT JOIN clientes cl ON cl.id = o.cliente_id
     WHERE ol.lavador_id = ? AND DATE(p.fecha_pago) BETWEEN ? AND ?
     ORDER BY p.fecha_pago DESC`,
    [lavadorId, inicio, fin]
  );

  // Lo que le toca a este lavador de cada venta: su comisión menos la parte del
  // descuento que asumió, más su parte (igual) de la propina.
  const servicios = filas.map(f => {
    const bruta = Number(f.valor_comision);
    const totalOrden = Number(f.comision_total_orden) || 0;
    const compartido = Number(f.lavadores_count) || 1;
    const descuentoAsumido = totalOrden > 0 ? Number(f.descuento_trabajador || 0) * (bruta / totalOrden) : 0;
    const propina = Number(f.propina || 0) / compartido;
    return {
      fecha: f.fecha_pago, inicio: f.fecha_hora_registro, ordenId: f.orden_id,
      cliente: f.cliente_nombre || 'Venta anónima',
      placa: f.placa || '-', tipoVehiculo: f.tipo_vehiculo, servicio: f.servicio_nombre || 'Otros',
      companeros: f.companeros || '', compartido,
      valorServicio: Number(f.valor_servicio), cobrado: Number(f.monto),
      cobradoParte: Number(f.monto) / compartido,
      porcentaje: Number(f.porcentaje_comision), comisionBruta: bruta, descuentoAsumido,
      comisionNeta: bruta - descuentoAsumido, propina, ganado: bruta - descuentoAsumido + propina,
      metodo: f.metodo_pago, observacion: f.observacion || ''
    };
  });

  const suma = (campo) => redondear(servicios.reduce((s, x) => s + x[campo], 0));
  const totales = {
    servicios: servicios.length,
    cobrado: suma('cobradoParte'), valorServicio: suma('valorServicio'),
    comisionBruta: suma('comisionBruta'), descuentos: suma('descuentoAsumido'),
    comisionNeta: suma('comisionNeta'), propinas: suma('propina'), ganado: suma('ganado')
  };

  // Asistencia del período por día.
  const [asistencia] = await pool.query(
    `SELECT fecha, hora_entrada, hora_salida, horas_trabajadas, horas_descanso, inasistencia
     FROM asistencia WHERE persona_tipo = 'lavador' AND persona_id = ? AND fecha BETWEEN ? AND ?
     ORDER BY fecha DESC`,
    [lavadorId, inicio, fin]
  );

  // Día por día: lo que hizo y ganó, junto con sus horas.
  const dias = {};
  const dia = (fecha) => {
    const clave = String(fecha).substring(0, 10);
    if (!dias[clave]) dias[clave] = { fecha: clave, servicios: 0, cobrado: 0, comisionBruta: 0, descuentos: 0, comisionNeta: 0, propinas: 0, ganado: 0, horas: null, estadoAsistencia: null };
    return dias[clave];
  };
  servicios.forEach(x => {
    const d = dia(x.fecha);
    d.servicios += 1;
    d.cobrado += x.cobradoParte;
    d.comisionBruta += x.comisionBruta;
    d.descuentos += x.descuentoAsumido;
    d.comisionNeta += x.comisionNeta;
    d.propinas += x.propina;
    d.ganado += x.ganado;
  });
  asistencia.forEach(a => {
    const d = dia(a.fecha);
    d.horas = Number(a.horas_trabajadas) || 0;
    d.estadoAsistencia = a.inasistencia ? 'Inasistencia' : 'Asistió';
  });
  const porDia = Object.values(dias).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  const agrupar = (clave, extra) => {
    const mapa = {};
    servicios.forEach(x => {
      const k = clave(x);
      if (!mapa[k]) mapa[k] = { ...extra(x), cantidad: 0, cobrado: 0, ganado: 0, descuentos: 0, propinas: 0 };
      mapa[k].cantidad += 1;
      mapa[k].cobrado += x.cobradoParte;
      mapa[k].ganado += x.ganado;
      mapa[k].descuentos += x.descuentoAsumido;
      mapa[k].propinas += x.propina;
    });
    return Object.values(mapa).sort((a, b) => b.ganado - a.ganado);
  };

  // Servicios que tiene asignados y todavía no se cobran (en curso o por cobrar).
  const [abiertos] = await pool.query(
    `SELECT o.id AS orden_id, o.estado, o.fecha_hora_registro, o.total, ol.valor_comision, s.nombre AS servicio_nombre,
            COALESCE(v.placa, o.placa_anonima) AS placa, cl.nombre AS cliente_nombre, o.es_venta_anonima
     FROM orden_lavadores ol
     INNER JOIN ordenes_servicio o ON o.id = ol.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     LEFT JOIN clientes cl ON cl.id = o.cliente_id
     WHERE ol.lavador_id = ? AND o.estado IN ('en_proceso', 'terminado')
     ORDER BY o.fecha_hora_registro DESC`,
    [lavadorId]
  );
  const [[canceladas]] = await pool.query(
    `SELECT COUNT(*) AS cantidad FROM orden_lavadores ol
     INNER JOIN ordenes_servicio o ON o.id = ol.orden_id
     WHERE ol.lavador_id = ? AND o.estado = 'cancelado' AND DATE(o.fecha_hora_registro) BETWEEN ? AND ?`,
    [lavadorId, inicio, fin]
  );

  const [liquidaciones] = await pool.query(
    `SELECT id, creado_en, fecha_pago, periodo_inicio, periodo_fin, total_comision, descuentos, valor_a_pagar, estado
     FROM liquidaciones_lavador
     WHERE lavador_id = ? AND (DATE(creado_en) BETWEEN ? AND ? OR fecha_pago BETWEEN ? AND ? OR estado = 'pendiente')
     ORDER BY id DESC`,
    [lavadorId, inicio, fin, inicio, fin]
  );

  // Saldo de hoy (todo el historial, sin importar el período elegido).
  const NominaRepositorio = require('./NominaRepositorio');
  const saldo = (await NominaRepositorio.resumenComisionesLavadores()).find(l => l.lavador_id === lavadorId) || {};

  const plan = planSerie(inicio, fin);
  return {
    rango: { inicio, fin },
    lavador: {
      id: lavador.id, nombre: lavador.nombre, documento: lavador.documento, telefono: lavador.telefono || '',
      estado: lavador.estado, porcentaje: Number(lavador.porcentaje_comision), ingreso: lavador.fecha_ingreso,
      acceso: acceso ? acceso.username : null
    },
    totales,
    serie: {
      gran: plan.gran, etiquetas: plan.etiquetas,
      ganado: acumularSerie(plan, servicios, x => x.fecha, x => x.ganado),
      servicios: acumularSerie(plan, servicios, x => x.fecha, () => 1)
    },
    porDia: porDia.map(d => ({ ...d, cobrado: redondear(d.cobrado), comisionBruta: redondear(d.comisionBruta), descuentos: redondear(d.descuentos), comisionNeta: redondear(d.comisionNeta), propinas: redondear(d.propinas), ganado: redondear(d.ganado) })),
    porServicio: agrupar(x => `${x.servicio}|${x.tipoVehiculo}`, x => ({ servicio: x.servicio, tipoVehiculo: x.tipoVehiculo })),
    porCliente: agrupar(x => x.cliente, x => ({ cliente: x.cliente })).slice(0, 10),
    porVehiculo: agrupar(x => x.tipoVehiculo, x => ({ tipoVehiculo: x.tipoVehiculo })),
    asistencia: asistencia.map(a => ({
      fecha: a.fecha, entrada: a.hora_entrada, salida: a.hora_salida,
      horas: Number(a.horas_trabajadas) || 0, descanso: Number(a.horas_descanso) || 0, inasistencia: !!a.inasistencia
    })),
    abiertos: abiertos.map(o => ({
      ordenId: o.orden_id, estado: o.estado, fecha: o.fecha_hora_registro, total: Number(o.total), comision: Number(o.valor_comision),
      servicio: o.servicio_nombre || 'Otros', placa: o.placa || '-',
      cliente: o.cliente_nombre || 'Venta anónima'
    })),
    canceladas: canceladas.cantidad || 0,
    liquidaciones: liquidaciones.map(l => ({
      id: l.id, fecha: l.fecha_pago || String(l.creado_en).substring(0, 10), periodoInicio: l.periodo_inicio, periodoFin: l.periodo_fin,
      comision: Number(l.total_comision), descuentos: Number(l.descuentos), neto: Number(l.valor_a_pagar), estado: l.estado
    })),
    saldo: {
      servicios: saldo.servicios_realizados || 0,
      comisionHistorica: Number(saldo.comision_historica_total) || 0,
      propinasHistoricas: Number(saldo.propina_total) || 0,
      descuentosHistoricos: Number(saldo.descuento_trabajador_total) || 0,
      pagado: Number(saldo.comision_pagada) || 0,
      pendiente: Number(saldo.comision_pendiente) || 0
    },
    detalleTotal: servicios.length,
    detalle: servicios.slice(0, MAX_FILAS_DETALLE)
  };
}

module.exports = { calcularReporteCliente, calcularReporteLavador };
