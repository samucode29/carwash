-- ============================================================================
-- CarWash Pro - Datos de Ejemplo (opcional)
-- ============================================================================
-- Ejecuta este script DESPUÉS de schema.sql si quieres arrancar con datos de
-- prueba (usuarios de acceso, lavadores, catálogo de servicios e inventario)
-- en lugar de una base completamente vacía.
--
-- Usuarios de acceso creados (contraseñas ya en formato bcrypt):
--   Administrador principal -> usuario: admin   contraseña: admin123
--   Empleado                -> usuario: laura   contraseña: laura123
--
-- El administrador principal (es_admin_principal = TRUE) es el único que
-- puede crear otras cuentas de administrador; cualquier admin puede crear
-- empleados.
-- ============================================================================

USE carwash_pro;

INSERT INTO usuarios (nombre, documento, telefono, correo, username, password_hash, rol, es_admin_principal, estado, fecha_ingreso, salario_fijo, periodicidad_pago)
VALUES
 ('Samuel Petro Avalos', '1037120618', '', 'samuelpetroavalos@gmail.com', 'admin', '$2b$10$eX4GBMLIsjIMowuFglQUzegdpVfsZ9ytqswgRIN8b9jEfBxxR5aRy', 'administrador', TRUE, 'activo', CURDATE(), 2500000, 'mensual'),
 ('Laura Gómez', '1098765432', '3123456789', 'laura@carwash.com', 'laura', '$2b$10$0aA8mHN9PojENNxQ2Bao5ergiO9zYGa76EEMinFDHiWt52Rd424Bi', 'empleado', FALSE, 'activo', CURDATE(), 1400000, 'quincenal');

INSERT INTO lavadores (nombre, documento, telefono, estado, fecha_ingreso, porcentaje_comision, creado_por)
VALUES
 ('Jorge Martínez', '1033445566', '3157778899', 'activo', CURDATE(), 60.00, 1);

INSERT INTO proveedores (nombre, contacto, telefono, correo, direccion)
VALUES
 ('Químicos del Caribe S.A.S.', 'Mario Santos', '3005556677', 'ventas@quimicoscaribe.com', 'Calle 45 # 22-10, Zona Industrial');

INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, proveedor_id)
VALUES
 ('Shampoo pH Neutro Concentrado', 'ml', 4500, 1500, 18, 1);

INSERT INTO servicios (nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min, activo)
VALUES
 ('Lavado Básico Carro', 'carro', 'Lavado exterior a presión, enjabonado con shampoo neutro, secado y llantas.', 18000, 25, TRUE),
 ('Lavado Completo Carro', 'carro', 'Exterior + interior profundo, aspirado, silicona en tablero y aplicación de cera.', 32000, 45, TRUE),
 ('Lavado Básico Moto', 'moto', 'Lavado exterior de chasis, plásticos y rines con protección.', 10000, 20, TRUE),
 ('Lavado Especial Moto + Cera', 'moto', 'Lavado detallado, desengrasado de cadena y motor, cera protectora en tanques y carenajes.', 18000, 35, TRUE),
 ('Polichado & Encerado Diamante', NULL, 'Descontaminado de pintura, polichado a máquina y sellado cerámico de cera. Aplica a cualquier tipo de vehículo.', 50000, 60, TRUE);

-- Clientes, vehículos, turnos, citas y órdenes NO se precargan: se crean
-- desde la operación diaria real (POS, agenda, etc.).
