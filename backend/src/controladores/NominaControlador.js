/**
 * Controlador de nómina: comisiones de lavadores, salarios fijos y
 * asistencia de personal (CU21-CU27 / RF22, RF25, RF30-RF35).
 */
const NominaRepositorio = require('../repositorios/NominaRepositorio');
const AsistenciaRepositorio = require('../repositorios/AsistenciaRepositorio');
const AuditoriaRepositorio = require('../repositorios/AuditoriaRepositorio');
const FacturaRepositorio = require('../repositorios/FacturaRepositorio');
const { obtenerFechaHoy, obtenerHoraActual } = require('../utilidades/fechas');

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

async function generarLiquidacion(req, res) {
  const { lavador_id, periodo_inicio, periodo_fin, total_comision, descuentos } = req.body;
  const hoy = obtenerFechaHoy();

  const liquidacion = await NominaRepositorio.crearLiquidacion({
    lavadorId: parseInt(lavador_id, 10),
    periodoInicio: periodo_inicio || hoy,
    periodoFin: periodo_fin || hoy,
    totalComision: parseFloat(total_comision) || 0,
    descuentos: parseFloat(descuentos) || 0
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'generar_liquidacion', `Liquidación #${liquidacion.id} para lavador ID ${lavador_id} ($${liquidacion.valor_a_pagar})`);
  res.status(201).json(liquidacion);
}

async function pagarLiquidacion(req, res) {
  const { liquidacion_id, fecha_pago } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'El sistema requiere adjuntar un soporte de pago (foto o PDF) para cambiar a estado Pagado.' });
  }

  const liquidacion = await NominaRepositorio.pagarLiquidacion({
    liquidacionId: parseInt(liquidacion_id, 10),
    soportePagoNombre: req.file.originalname,
    soportePagoTipo: req.file.mimetype,
    soportePagoDatos: req.file.buffer,
    fechaPago: fecha_pago || obtenerFechaHoy()
  });
  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada.' });

  const factura = await FacturaRepositorio.crearFactura({
    tipo: 'nomina',
    concepto: `Comisión - ${liquidacion.lavador_nombre || 'Lavador'}`,
    total: liquidacion.valor_a_pagar,
    fecha: liquidacion.fecha_pago,
    creadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'pagar_liquidacion', `Pagada liquidación #${liquidacion.id} con soporte: ${req.file.originalname} (Factura ${factura.numero_factura})`);
  res.json({ ...liquidacion, factura });
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
  if (!req.file) {
    return res.status(400).json({ error: 'Debe adjuntar el soporte de pago (foto o PDF) para registrar la nómina como pagada.' });
  }

  const hoy = obtenerFechaHoy();
  const pago = await NominaRepositorio.crearPagoSalario({
    empleadoId: parseInt(empleado_id, 10),
    periodicidad: periodicidad || 'quincenal',
    periodoInicio: periodo_inicio || hoy,
    periodoFin: periodo_fin || hoy,
    salarioBase: parseFloat(salario_base) || 0,
    descuentos: parseFloat(descuentos) || 0,
    soportePagoNombre: req.file.originalname,
    soportePagoTipo: req.file.mimetype,
    soportePagoDatos: req.file.buffer,
    fechaPago: fecha_pago || hoy
  });

  const factura = await FacturaRepositorio.crearFactura({
    tipo: 'nomina',
    concepto: `Salario - ${pago.empleado_nombre || 'Empleado'}`,
    total: pago.valor_a_pagar,
    fecha: pago.fecha_pago_real,
    creadoPor: req.usuarioAutenticado.id
  });

  await AuditoriaRepositorio.registrar(req.usuarioAutenticado.id, 'pago_salario_empleado', `Pago de salario a empleado ID ${empleado_id} ($${pago.valor_a_pagar}) con soporte: ${req.file.originalname} (Factura ${factura.numero_factura})`);
  res.status(201).json({ ...pago, factura });
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

  const hoy = obtenerFechaHoy();
  const horaActual = obtenerHoraActual();
  let registro = await AsistenciaRepositorio.obtenerRegistroDelDia(persona_tipo, persona_id, hoy);

  if (!registro) {
    registro = await AsistenciaRepositorio.crearRegistro({ personaTipo: persona_tipo, personaId: persona_id, fecha: hoy, horaEntrada: horaActual, inasistencia });
  } else if (tipo === 'salida') {
    const horasDescanso = parseFloat(req.body.horas_descanso) || 0;
    if (horasDescanso > 0 && horasDescanso < 1) {
      return res.status(400).json({ error: 'Si registra horas de descanso/almuerzo, deben ser de mínimo 1 hora.' });
    }

    let horasTrabajadas = 0;
    if (registro.hora_entrada) {
      const [h1, m1] = registro.hora_entrada.split(':').map(Number);
      const [h2, m2] = horaActual.split(':').map(Number);
      const horasBrutas = Math.max(0, parseFloat(((h2 + m2 / 60) - (h1 + m1 / 60)).toFixed(2)));
      horasTrabajadas = Math.max(0, parseFloat((horasBrutas - horasDescanso).toFixed(2)));
    }
    registro = await AsistenciaRepositorio.marcarSalida(registro.id, horaActual, horasTrabajadas, horasDescanso);
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
  listarResumenLavadores, generarLiquidacion, pagarLiquidacion, listarLiquidaciones, descargarSoporteLiquidacion,
  listarEmpleados, calcularPagoEmpleado, pagarSalarioEmpleado, listarPagosSalario, descargarSoportePagoSalario,
  listarAsistenciaDelDia, registrarAsistencia
};
