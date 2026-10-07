/**
 * Un cliente inactivo conserva todo su historial (ventas, vehículos, notas)
 * pero ya no se le pueden crear citas, turnos ni servicios nuevos hasta que
 * se vuelva a activar.
 */
const ClienteRepositorio = require('../repositorios/ClienteRepositorio');

/** Lanza un error 400 si el cliente (o el dueño del vehículo indicado) está inactivo. */
async function exigirClienteActivo({ clienteId = null, vehiculoId = null } = {}) {
  let id = clienteId;
  if (!id && vehiculoId) {
    const vehiculo = await ClienteRepositorio.obtenerVehiculoPorId(vehiculoId);
    id = vehiculo ? vehiculo.cliente_id : null;
  }
  if (!id) return;
  const cliente = await ClienteRepositorio.obtenerClientePorId(id);
  if (cliente && cliente.estado === 'inactivo') {
    throw Object.assign(
      new Error(`El cliente "${cliente.nombre}" está inactivo. Actívelo en la pestaña Clientes para poder atenderlo.`),
      { codigoHttp: 400 }
    );
  }
}

module.exports = { exigirClienteActivo };
