/**
 * Cada servicio es para un tipo de vehículo del catálogo (carro, moto,
 * camioneta...). Estas funciones centralizan la regla para que turnos,
 * citas, órdenes y servicios extra no dejen mezclar, por ejemplo, un
 * lavado de moto en un carro.
 */

function normalizarTipo(tipo) {
  return String(tipo || '').trim().toLowerCase();
}

function servicioAplicaAVehiculo(servicio, tipoVehiculo) {
  return normalizarTipo(servicio.tipo_vehiculo) === normalizarTipo(tipoVehiculo);
}

/** Lanza un error 400 si el servicio no es del tipo de vehículo indicado (o si el tipo se desconoce, no valida). */
function exigirServicioParaVehiculo(servicio, tipoVehiculo) {
  if (!tipoVehiculo) return;
  if (!servicioAplicaAVehiculo(servicio, tipoVehiculo)) {
    throw Object.assign(
      new Error(`El servicio "${servicio.nombre}" es para ${servicio.tipo_vehiculo}, no para ${tipoVehiculo}. Elija un servicio de ese tipo de vehículo.`),
      { codigoHttp: 400 }
    );
  }
}

module.exports = { normalizarTipo, servicioAplicaAVehiculo, exigirServicioParaVehiculo };
