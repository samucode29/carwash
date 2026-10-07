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
async function calcularPagoEmpleado(req, res) {
  const { periodo_inicio, periodo_fin } = req.query;
  if (!periodo_inicio || !periodo_fin) {
    return res.status(400).json({ error: 'periodo_inicio y periodo_fin son obligatorios.' });
  }
  const calculo = await NominaRepositorio.calcularPagoEmpleado(Number(req.params.id), periodo_inicio, periodo_fin);
  if (!calculo) return res.status(404).json({ error: 'Empleado no encontrado.' });
  res.json(calculo);
}

async function pagarSalarioEmpleado(req, res) {
  const { empleado_id, periodicidad, periodo_inicio, periodo_fin, salario_base, descuentos, fecha_pago } = req.body;
  const beneficiario = await UsuarioRepositorio.obtenerPorId(parseInt(empleado_id, 10));
  if (beneficiario && beneficiario.cuenta_adicional) {
    return res.status(400).json({ error: 'Esta es una cuenta de administrador adicional: el salario se paga a la persona en su registro de empleado.' });
  }

  const hoy = obtenerFechaHoy();
  const pago = await NominaRepositorio.crearPagoSalario({
    empleadoId: parseInt(empleado_id, 10),
    periodicidad: ['semanal', 'quincenal', 'mensual'].includes(periodicidad) ? periodicidad : 'quincenal',
    periodoInicio: periodo_inicio || hoy,
    periodoFin: periodo_fin || hoy,
    salarioBase: parseFloat(salario_base) || 0,
    descuentos: parseFloat(descuentos) || 0,
    fechaPago: fecha_pago || hoy
  });

  const factura = await FacturaRepositorio.crearFactura({
    tipo: 'nomina',
    concepto: `Salario - ${pago.empleado_nombre || 'Empleado'}`,
    total: pago.valor_a_pagar,
    fecha: pago.fecha_pago_real,
    creadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'pago_salario_empleado', `Pago de salario a empleado ID ${empleado_id} ($${pago.valor_a_pagar}) (Factura ${factura.numero_factura})`);
  res.status(201).json({ ...pago, factura });
}

/** Comprobante imprimible del pago de salario, con horas del período y espacio para las firmas. */
async function comprobantePagoSalario(req, res) {
  const pago = await NominaRepositorio.obtenerPagoSalario(Number(req.params.id));
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado.' });
  const inicio = String(pago.periodo_inicio).substring(0, 10);
  const fin = String(pago.periodo_fin).substring(0, 10);
  const calculo = await NominaRepositorio.calcularPagoEmpleado(pago.empleado_id, inicio, fin);
  const descuentos = Number(pago.descuentos) || 0;

  const filas = [];
  if (calculo && calculo.horasTrabajadas > 0) {
    filas.push([`Horas normales (${calculo.horasNormales} hrs a ${formatearMoneda(calculo.valorHora)}/hr)`, formatearMoneda(calculo.montoNormal)]);
    if (calculo.horasExtra > 0) {
      filas.push([`Horas extra (${calculo.horasExtra} hrs a ${formatearMoneda(calculo.valorHoraExtra)}/hr)`, formatearMoneda(calculo.montoExtra)]);
    }
  }
  filas.push(['Salario del período (según horas trabajadas)', formatearMoneda(pago.salario_base)]);
  filas.push(['Descuentos (inasistencias, anticipos, etc.)', descuentos > 0 ? `-${formatearMoneda(descuentos)}` : formatearMoneda(0)]);

  generarPdfComprobanteNomina(res, {
    titulo: 'Comprobante de Pago de Salario',
    numero: `SAL-${String(pago.id).padStart(5, '0')}`,
    nombreArchivo: `comprobante_salario_${pago.id}.pdf`,
    fechaPago: pago.fecha_pago_real || pago.creado_en,
    persona: { etiqueta: 'Empleado', nombre: pago.empleado_nombre || 'Empleado', documento: pago.empleado_documento },
    periodo: `${inicio} al ${fin} (pago ${pago.periodicidad})`,
    concepto: 'Salario por horas trabajadas en el período',
    valorNeto: Number(pago.valor_a_pagar),
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
    if (cuenta && cuenta.cuenta_adicional) {
      return res.status(400).json({ error: 'Esta es una cuenta de administrador adicional: la asistencia se registra en el registro de la persona.' });
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
