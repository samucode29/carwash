/**
 * Cálculo del reporte financiero/operativo para un rango de fechas
 * (CU18, CU19, CU29 / RF19, RF20, RF25, RF26). Se usa tanto para el
 * dashboard como para los reportes descargables (semanal/mensual/anual/
 * personalizado) y su versión en PDF.
 */
const { pool } = require('../config/baseDeDatos');
const InsumoRepositorio = require('./InsumoRepositorio');
const AuditoriaRepositorio = require('./AuditoriaRepositorio');

async function calcularReporte(inicio, fin) {
  // 1. Órdenes pagadas dentro del rango, con su servicio y tipo de vehículo.
  const [ordenesPagadas] = await pool.query(
    `SELECT o.id, o.total, p.monto AS pago_monto, s.nombre AS servicio_nombre,
            COALESCE(v.tipo, o.tipo_vehiculo_anonimo, 'carro') AS tipo_vehiculo
     FROM pagos p
     INNER JOIN ordenes_servicio o ON o.id = p.orden_id
     LEFT JOIN servicios s ON s.id = o.servicio_id
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     WHERE DATE(p.fecha_pago) BETWEEN ? AND ?`,
    [inicio, fin]
  );

  const totalIngresos = ordenesPagadas.reduce((suma, o) => suma + Number(o.pago_monto || o.total), 0);
  const ordenIds = ordenesPagadas.map(o => o.id);

  // 2. Comisiones de lavadores generadas por esas órdenes.
  let totalComisionesLavadores = 0;
  const lavadoresStats = {};
  if (ordenIds.length > 0) {
    const [comisiones] = await pool.query(
      `SELECT ol.valor_comision, l.nombre
       FROM orden_lavadores ol
       INNER JOIN lavadores l ON l.id = ol.lavador_id
       WHERE ol.orden_id IN (?)`,
      [ordenIds]
    );
    comisiones.forEach(c => {
      totalComisionesLavadores += Number(c.valor_comision);
      if (!lavadoresStats[c.nombre]) lavadoresStats[c.nombre] = { servicios: 0, comision: 0 };
      lavadoresStats[c.nombre].servicios += 1;
      lavadoresStats[c.nombre].comision += Number(c.valor_comision);
    });
  }

  // 3. Costo de insumos consumidos (salidas de inventario ligadas a esas órdenes).
  let costoInsumos = 0;
  if (ordenIds.length > 0) {
    const [salidas] = await pool.query(
      `SELECT m.cantidad, i.costo_unitario
       FROM movimientos_inventario m
       INNER JOIN insumos i ON i.id = m.insumo_id
       WHERE m.tipo = 'salida' AND m.orden_id IN (?)`,
      [ordenIds]
    );
    costoInsumos = salidas.reduce((suma, m) => suma + Number(m.cantidad) * Number(m.costo_unitario), 0);
  }

  // 4. Gastos operativos del período.
  const [gastos] = await pool.query(`SELECT SUM(monto) AS total FROM gastos_operativos WHERE fecha BETWEEN ? AND ?`, [inicio, fin]);
  const totalGastos = Number(gastos[0].total) || 0;

  // 5. Ganancia neta (RF20 / CU19): Ingresos - (Insumos + Gastos + Comisiones)
  const gananciaNeta = totalIngresos - (costoInsumos + totalGastos + totalComisionesLavadores);
  const margenPorcentaje = totalIngresos > 0 ? Number(((gananciaNeta / totalIngresos) * 100).toFixed(1)) : 0;

  // 6. Distribución por tipo de vehículo y por servicio.
  const distribucionVehiculos = { carro: 0, moto: 0 };
  const serviciosStats = {};
  ordenesPagadas.forEach(o => {
    if (o.tipo_vehiculo === 'moto') distribucionVehiculos.moto += 1;
    else distribucionVehiculos.carro += 1;

    const nombreServicio = o.servicio_nombre || 'Otros';
    if (!serviciosStats[nombreServicio]) serviciosStats[nombreServicio] = { count: 0, total: 0 };
    serviciosStats[nombreServicio].count += 1;
    serviciosStats[nombreServicio].total += Number(o.pago_monto || o.total);
  });

  // 7. Estado actual del inventario (snapshot, no depende del rango de fechas).
  const alertasStock = await InsumoRepositorio.listarAlertasStockBajo();
  const auditoriaReciente = await AuditoriaRepositorio.obtenerRecientes(8);

  return {
    rango: { inicio, fin },
    totalIngresos,
    totalComisionesLavadores,
    costoInsumos,
    totalGastos,
    gananciaNeta,
    margenPorcentaje,
    serviciosAtendidos: ordenesPagadas.length,
    distribucionVehiculos,
    serviciosStats,
    lavadoresStats,
    alertasStockCount: alertasStock.length,
    auditoriaReciente
  };
}

module.exports = { calcularReporte };
