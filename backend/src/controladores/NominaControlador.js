/**
 * Controlador de nómina: comisiones de lavadores, salarios fijos y
 * asistencia de personal (CU21-CU27 / RF22, RF25, RF30-RF35).
 */
const NominaRepositorio = require('../repositorios/NominaRepositorio');
const AsistenciaRepositorio = require('../repositorios/AsistenciaRepositorio');
const UsuarioRepositorio = require('../repositorios/UsuarioRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const FacturaRepositorio = require('../repositorios/FacturaRepositorio');
const { obtenerFechaHoy, obtenerHoraActual } = require('../utilidades/fechas');
const { generarPdfComprobanteNomina } = require('../utilidades/generadorComprobanteNomina');
const { formatearMoneda } = require('../utilidades/generadorReportePdf');

// ---------------------------------------------------------------------------
// Comisiones de lavadores
// ---------------------------------------------------------------------------
async function listarResumenLavadores(req, res) {
  const resumen = await NominaRepositorio.resumenComisionesLavadores();
  const estados = await AsistenciaRepositorio.listarEstadoAsistenciaHoy('lavador', obtenerFechaHoy());
  res.json(resumen.map(l => ({
    ...l,
    disponible_hoy: estados[l.lavador_id] === 'presente',
    estado_asistencia_hoy: estados[l.lavador_id] || 'sin_asistencia'
  })));
}

async function listarServiciosLavador(req, res) {
  const servicios = await NominaRepositorio.obtenerServiciosPorLavador(Number(req.params.id));
  res.json(servicios);
}

/**
 * Liquida la comisión pendiente de un lavador: queda registrada como PAGADA
 * y el comprobante (PDF con firmas) se descarga aparte para imprimirlo.
 */
async function generarLiquidacion(req, res) {
  const { lavador_id, periodo_inicio, periodo_fin, total_comision, descuentos } = req.body;
  const hoy = obtenerFechaHoy();
  const lavadorId = parseInt(lavador_id, 10);
  const totalComision = parseFloat(total_comision) || 0;
  const descuentosValor = parseFloat(descuentos) || 0;

  if (descuentosValor < 0 || descuentosValor > totalComision) {
    return res.status(400).json({ error: 'Los descuentos no pueden ser negativos ni mayores que la comisión a liquidar.' });
  }
  // No se confía en el valor que manda el navegador: no se puede liquidar
  // más de lo que realmente tiene pendiente el lavador.
  const resumen = (await NominaRepositorio.resumenComisionesLavadores()).find(l => l.lavador_id === lavadorId);
  if (!resumen) return res.status(404).json({ error: 'Lavador no encontrado.' });
  if (totalComision <= 0 || resumen.comision_pendiente < 1) {
    return res.status(400).json({ error: 'Este lavador no tiene comisión pendiente por liquidar.' });
  }
  if (totalComision > resumen.comision_pendiente + 1) {
    return res.status(400).json({ error: `La comisión a liquidar supera lo pendiente del lavador ($${Math.round(resumen.comision_pendiente).toLocaleString('es-CO')}). Recargue la pantalla e intente de nuevo.` });
  }

  const liquidacion = await NominaRepositorio.crearLiquidacion({
    lavadorId,
    periodoInicio: periodo_inicio || hoy,
    periodoFin: periodo_fin || hoy,
    totalComision,
    descuentos: descuentosValor,
    fechaPago: hoy
  });
  const factura = await registrarFacturaLiquidacion(liquidacion, req.usuarioAutenticado.id);

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'generar_liquidacion', `Liquidación #${liquidacion.id} pagada a lavador ID ${lavador_id} ($${liquidacion.valor_a_pagar}) (Factura ${factura.numero_factura})`);
  res.status(201).json({ ...liquidacion, factura });
}

function registrarFacturaLiquidacion(liquidacion, usuarioId) {
  return FacturaRepositorio.crearFactura({
    tipo: 'nomina',
    concepto: `Comisión - ${liquidacion.lavador_nombre || 'Lavador'}`,
    total: liquidacion.valor_a_pagar,
    fecha: liquidacion.fecha_pago,
    creadoPor: usuarioId
  });
}

/** Solo para liquidaciones antiguas que quedaron en PENDIENTE (antes se exigía subir soporte). */
async function pagarLiquidacion(req, res) {
  const { liquidacion_id, fecha_pago } = req.body;
  const existente = await NominaRepositorio.obtenerLiquidacion(parseInt(liquidacion_id, 10));
  if (!existente) return res.status(404).json({ error: 'Liquidación no encontrada.' });
  if (existente.estado === 'pagado') return res.status(400).json({ error: 'Esta liquidación ya está pagada.' });

  const liquidacion = await NominaRepositorio.pagarLiquidacion({
    liquidacionId: existente.id,
    fechaPago: fecha_pago || obtenerFechaHoy()
  });
  const factura = await registrarFacturaLiquidacion(liquidacion, req.usuarioAutenticado.id);

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'pagar_liquidacion', `Pagada liquidación #${liquidacion.id} (Factura ${factura.numero_factura})`);
  res.json({ ...liquidacion, factura });
}

/** Comprobante imprimible de una liquidación de comisiones, con espacio para las firmas. */
async function comprobanteLiquidacion(req, res) {
  const liq = await NominaRepositorio.obtenerLiquidacion(Number(req.params.id));
  if (!liq) return res.status(404).json({ error: 'Liquidación no encontrada.' });
  const descuentos = Number(liq.descuentos) || 0;
  generarPdfComprobanteNomina(res, {
    titulo: 'Comprobante de Pago de Comisiones',
    numero: `LIQ-${String(liq.id).padStart(5, '0')}`,
    nombreArchivo: `comprobante_comision_${liq.id}.pdf`,
    fechaPago: liq.fecha_pago || liq.creado_en,
    persona: { etiqueta: 'Lavador', nombre: liq.lavador_nombre || 'Lavador', documento: liq.lavador_documento },
    periodo: `${String(liq.periodo_inicio).substring(0, 10)} al ${String(liq.periodo_fin).substring(0, 10)}`,
    concepto: 'Comisiones por servicios de lavado (incluye propinas y descuentos asumidos)',
    valorNeto: Number(liq.valor_a_pagar),
    filas: [
      ['Comisión neta acumulada a liquidar', formatearMoneda(liq.total_comision)],
      ['Descuentos (anticipos, daños, etc.)', descuentos > 0 ? `-${formatearMoneda(descuentos)}` : formatearMoneda(0)]
    ],
    notas: liq.estado === 'pendiente' ? ['Esta liquidación figura como PENDIENTE de pago en el sistema.'] : []
  });
}

async function listarLiquidaciones(req, res) {
  res.json(await NominaRepositorio.listarLiquidaciones());
}

async function descargarSoporteLiquidacion(req, res) {
  const soporte = await NominaRepositorio.obtenerSoporteLiquidacion(Number(req.params.id));
  if (!soporte || !soporte.soporte_pago_datos) return res.status(404).json({ error: 'Soporte no encontrado.' });
  res.setHeader('Content-Type', soporte.soporte_pago_tipo || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${soporte.soporte_pago_nombre || 'soporte'}"`);
  res.send(soporte.soporte_pago_datos);
}

// ---------------------------------------------------------------------------
// Salarios fijos
// ---------------------------------------------------------------------------
async function listarEmpleados(req, res) {
  res.json(await NominaRepositorio.listarEmpleadosConUltimoPago());
}

/** Cuánto le corresponde a un empleado en un rango, según horas realmente trabajadas. */
/** Salario del período + horas extra escritas a mano (vista previa del pago). */
async function calcularPagoEmpleado(req, res) {
  const calculo = await NominaRepositorio.calcularPagoEmpleado(Number(req.params.id), req.query.horas_extra);
  if (!calculo) return res.status(404).json({ error: 'Empleado no encontrado.' });
  res.json(calculo);
}

/**
 * Paga el salario de un empleado. A diferencia de los lavadores (a quienes se
 * liquida cuando se quiera), un empleado solo se paga en su fecha de pago o
 * después si se atrasó. Se debe el salario fijo del período más las horas
 * extra que el administrador escribe; se puede pagar solo una parte (por
 * defecto se paga todo) y lo que falte queda como saldo pendiente, que se
 * abona después. El período lo define el calendario de pago y la fecha de
 * pago siempre es hoy.
 */
async function pagarSalarioEmpleado(req, res) {
  const empleadoId = parseInt(req.body.empleado_id, 10);
  const info = await NominaRepositorio.estadoPagoDeEmpleado(empleadoId);
  if (!info) return res.status(404).json({ error: 'Empleado no encontrado.' });
  if (info.empleado.lavador_id) {
    return res.status(400).json({ error: 'Esta cuenta es el acceso de un lavador: a él se le paga por comisiones (Nómina > Lavadores), no salario.' });
  }

  const { empleado, estado } = info;
  if (!estado.puedePagar) {
    const motivo = estado.estado === 'al_dia'
      ? `${empleado.nombre} ya está al día: su próximo pago es el ${estado.fecha}.`
      : `Todavía no es el día de pago de ${empleado.nombre}: le toca el ${estado.fecha}. Los empleados solo se pagan en su fecha de pago.`;
    return res.status(400).json({ error: motivo });
  }

  // Si quedó un saldo de un pago parcial, este pago es un abono a ese saldo
  // (sin nuevas horas extra ni descuentos); si no, es el pago del período.
  const esAbono = estado.estado === 'parcial';
  let calculo;
  let horasExtra = 0;
  let valorDescuentos = 0;
  let adeudado;
  if (esAbono) {
    adeudado = Number(estado.saldo);
    calculo = await NominaRepositorio.calcularPagoEmpleado(empleadoId, 0);
  } else {
    horasExtra = parseFloat(req.body.horas_extra) || 0;
    if (horasExtra < 0) return res.status(400).json({ error: 'Las horas extra no pueden ser negativas.' });
    valorDescuentos = parseFloat(req.body.descuentos) || 0;
    if (valorDescuentos < 0) return res.status(400).json({ error: 'Los descuentos no pueden ser negativos.' });
    calculo = await NominaRepositorio.calcularPagoEmpleado(empleadoId, horasExtra);
    if (valorDescuentos > calculo.total) {
      return res.status(400).json({ error: 'Los descuentos no pueden superar lo que se le va a pagar.' });
    }
    adeudado = Number((calculo.total - valorDescuentos).toFixed(2));
  }

  // Valor que se paga ahora: por defecto todo lo adeudado; puede ser solo una parte.
  const crudo = req.body.valor_pagado;
  const valorPagado = (crudo === undefined || crudo === null || crudo === '') ? adeudado : Number(parseFloat(crudo).toFixed(2));
  if (!Number.isFinite(valorPagado) || valorPagado <= 0) {
    return res.status(400).json({ error: 'El valor a pagar debe ser mayor que cero.' });
  }
  if (valorPagado > adeudado) {
    return res.status(400).json({ error: `El valor a pagar no puede superar lo que se le debe (${formatearMoneda(adeudado)}).` });
  }

  const pago = await NominaRepositorio.crearPagoSalario({
    empleadoId,
    periodicidad: calculo.periodicidadPago,
    periodoInicio: estado.periodoInicio,
    periodoFin: estado.periodoFin,
    salarioBase: esAbono ? 0 : calculo.salarioBase,
    horasExtra: esAbono ? 0 : calculo.horasExtra,
    valorHorasExtra: esAbono ? 0 : calculo.montoExtra,
    descuentos: valorDescuentos,
    valorAdeudado: adeudado,
    valorPagado,
    esAbono,
    fechaPago: obtenerFechaHoy()
  });

  const factura = await FacturaRepositorio.crearFactura({
    tipo: 'nomina',
    concepto: `${esAbono ? 'Abono a salario' : 'Salario'} - ${pago.empleado_nombre || 'Empleado'}`,
    total: pago.valor_a_pagar,
    fecha: pago.fecha_pago_real,
    creadoPor: req.usuarioAutenticado.id
  });

  const saldo = Number(pago.saldo_pendiente) || 0;
  await AuditoriaRepositorio.registrar(
    req.usuarioAutenticado.id, 'pago_salario_empleado',
    `${esAbono ? 'Abono' : 'Pago'} de salario a empleado ID ${empleadoId} ($${pago.valor_a_pagar}${horasExtra > 0 ? `, con ${horasExtra} h extra` : ''}${saldo > 0 ? `, queda saldo de $${saldo}` : ''}) (Factura ${factura.numero_factura})`
  );
  res.status(201).json({ ...pago, factura });
}

/** Comprobante imprimible del pago de salario, con horas del período y espacio para las firmas. */
async function comprobantePagoSalario(req, res) {
  const pago = await NominaRepositorio.obtenerPagoSalario(Number(req.params.id));
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' });
  const inicio = String(pago.periodo_inicio).substring(0, 10);
  const fin = String(pago.periodo_fin).substring(0, 10);
  const descuentos = Number(pago.descuentos) || 0;
  const horasExtra = Number(pago.horas_extra) || 0;
  const valorExtra = Number(pago.valor_horas_extra) || 0;

  const esAbono = !!pago.es_abono;
  const adeudado = Number(pago.valor_adeudado) || Number(pago.valor_a_pagar);
  const saldo = Number(pago.saldo_pendiente) || 0;

  const filas = [];
  if (esAbono) {
    filas.push([`Saldo pendiente de un pago anterior (período ${inicio} al ${fin})`, formatearMoneda(adeudado)]);
  } else {
    filas.push([`Salario del período (${pago.periodicidad})`, formatearMoneda(pago.salario_base)]);
    if (horasExtra > 0) {
      filas.push([`Horas extra (${horasExtra} hrs a ${formatearMoneda(valorExtra / horasExtra)}/hr)`, formatearMoneda(valorExtra)]);
    }
    filas.push(['Descuentos (inasistencias, anticipos, etc.)', descuentos > 0 ? `-${formatearMoneda(descuentos)}` : formatearMoneda(0)]);
    if (saldo > 0) filas.push(['Total del período (salario + horas extra - descuentos)', formatearMoneda(adeudado)]);
  }
  if (saldo > 0) filas.push(['Saldo que queda pendiente por pagar', formatearMoneda(saldo)]);

  generarPdfComprobanteNomina(res, {
    titulo: 'Comprobante de Pago de Salario',
    numero: `SAL-${String(pago.id).padStart(5, '0')}`,
    nombreArchivo: `comprobante_salario_${pago.id}.pdf`,
    fechaPago: pago.fecha_pago_real || pago.creado_en,
    persona: { etiqueta: 'Empleado', nombre: pago.empleado_nombre || 'Empleado', documento: pago.empleado_documento },
    periodo: `${inicio} al ${fin} (pago ${pago.periodicidad})`,
    concepto: esAbono ? 'Abono al saldo pendiente del salario' : ('Salario del período' + (horasExtra > 0 ? ' con horas extra' : '') + (saldo > 0 ? ' (pago parcial)' : '')),
    valorNeto: Number(pago.valor_a_pagar),
    saldoPendiente: saldo,
    filas
  });
}

async function listarPagosSalario(req, res) {
  res.json(await NominaRepositorio.listarPagosSalario());
}

async function descargarSoportePagoSalario(req, res) {
  const soporte = await NominaRepositorio.obtenerSoportePagoSalario(Number(req.params.id));
  if (!soporte || !soporte.soporte_pago_datos) return res.status(404).json({ error: 'Soporte no encontrado.' });
  res.setHeader('Content-Type', soporte.soporte_pago_tipo || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${soporte.soporte_pago_nombre || 'soporte'}"`);
  res.send(soporte.soporte_pago_datos);
}

// ---------------------------------------------------------------------------
// Asistencia
// ---------------------------------------------------------------------------
async function listarAsistenciaDelDia(req, res) {
  res.json(await AsistenciaRepositorio.listarPorFecha(req.query.fecha || obtenerFechaHoy()));
}

/**
 * Registra entrada, salida o inasistencia de una persona (usuario o
 * lavador). Crea el registro del día si aún no existe.
 */
async function registrarAsistencia(req, res) {
  const { persona_tipo, persona_id, tipo, inasistencia } = req.body;
  if (!['usuario', 'lavador'].includes(persona_tipo) || !persona_id) {
    return res.status(400).json({ error: 'persona_tipo (usuario|lavador) y persona_id son obligatorios.' });
  }

  if (persona_tipo === 'usuario') {
    const cuenta = await UsuarioRepositorio.obtenerPorId(Number(persona_id));
    if (cuenta && cuenta.lavador_id) {
      return res.status(400).json({ error: 'Esta cuenta es el acceso de un lavador: su asistencia se registra como lavador.' });
    }
  }

  const hoy = obtenerFechaHoy();
  const horaActual = obtenerHoraActual();
  let registro = await AsistenciaRepositorio.obtenerRegistroDelDia(persona_tipo, persona_id, hoy);

  if (!registro) {
    if (tipo === 'salida') {
      return res.status(400).json({ error: 'Esta persona no tiene una entrada registrada hoy; marque primero su entrada.' });
    }
    registro = await AsistenciaRepositorio.crearRegistro({ personaTipo: persona_tipo, personaId: persona_id, fecha: hoy, horaEntrada: horaActual, inasistencia });
  } else if (tipo === 'salida') {
    const horasDescanso = parseFloat(req.body.horas_descanso) || 0;
    if (horasDescanso > 0 && horasDescanso < 1) {
      return res.status(400).json({ error: 'Si registra horas de descanso/almuerzo, deben ser de mínimo 1 hora.' });
    }
    // El almuerzo se registra una sola vez al día: las salidas siguientes
    // (ej. después de volver a entrar) ya no lo vuelven a pedir.
    if (horasDescanso > 0 && Number(registro.horas_descanso) > 0) {
      return res.status(400).json({ error: `El descanso/almuerzo de hoy ya fue registrado (${registro.horas_descanso} hrs); solo se registra una vez al día.` });
    }
    if (!(await AsistenciaRepositorio.tieneSesionAbierta(registro.id))) {
      return res.status(400).json({ error: 'Esta persona no tiene una entrada abierta; marque su entrada antes de registrar la salida.' });
    }
    registro = await AsistenciaRepositorio.marcarSalida(registro.id, horaActual, horasDescanso);
  } else if (tipo === 'entrada') {
    const yaPresente = registro.hora_entrada && !registro.hora_salida && !registro.inasistencia;
    if (yaPresente) {
      return res.status(400).json({ error: 'Esta persona ya está presente hoy (tiene entrada marcada y no ha marcado salida). Debe marcar su salida antes de registrar una nueva entrada.' });
    }
    registro = await AsistenciaRepositorio.marcarEntrada(registro.id, horaActual);
  } else if (inasistencia !== undefined) {
    registro = await AsistenciaRepositorio.marcarInasistencia(registro.id, inasistencia);
  }

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'registrar_asistencia', `Asistencia actualizada para ${persona_tipo} ID ${persona_id} (${tipo || 'inasistencia'})`);
  res.json(registro);
}

module.exports = {
  listarResumenLavadores, listarServiciosLavador, generarLiquidacion, pagarLiquidacion, comprobanteLiquidacion, listarLiquidaciones, descargarSoporteLiquidacion,
  listarEmpleados, calcularPagoEmpleado, pagarSalarioEmpleado, comprobantePagoSalario, listarPagosSalario, descargarSoportePagoSalario,
  listarAsistenciaDelDia, registrarAsistencia
};
