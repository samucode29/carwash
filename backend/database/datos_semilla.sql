-- ============================================================================
-- CarWash Pro - Datos de Ejemplo (opcional)
-- ============================================================================
-- Ejecuta este script DESPUÉS de schema.sql si quieres arrancar con datos de
-- prueba (usuarios de acceso, lavadores, catálogo de servicios e inventario)
-- en lugar de una base completamente vacía.
--
-- Usuarios de acceso creados (contraseñas ya en formato bcrypt):
--   Administrador -> usuario: admin   contraseña: admin123
--   Empleado      -> usuario: laura   contraseña: laura123
-- ============================================================================

USE carwash_pro;

INSERT INTO usuarios (nombre, documento, telefono, correo, username, password_hash, rol, estado, fecha_ingreso, salario_fijo, periodicidad_pago)
VALUES
 ('Carlos Ruiz', '1020304050', '3001234567', 'admin@carwash.com', 'admin', '$2b$10$eX4GBMLIsjIMowuFglQUzegdpVfsZ9ytqswgRIN8b9jEfBxxR5aRy', 'administrador', 'activo', CURDATE(), 2500000, 'mensual'),
 ('Laura Gómez', '1098765432', '3123456789', 'laura@carwash.com', 'laura', '$2b$10$0aA8mHN9PojENNxQ2Bao5ergiO9zYGa76EEMinFDHiWt52Rd424Bi', 'empleado', 'activo', CURDATE(), 1400000, 'quincenal');

INSERT INTO lavadores (nombre, documento, telefono, estado, fecha_ingreso, porcentaje_comision, creado_por)
VALUES
 ('Jorge Martínez', '1033445566', '3157778899', 'activo', CURDATE(), 60.00, 1),
 ('Andrés Castro', '1044556677', '3189991122', 'activo', CURDATE(), 60.00, 1),
 ('Brayan Silva', '1055667788', '3201114433', 'activo', CURDATE(), 60.00, 1);

INSERT INTO proveedores (nombre, contacto, telefono, correo, direccion)
VALUES
 ('Químicos del Caribe S.A.S.', 'Mario Santos', '3005556677', 'ventas@quimicoscaribe.com', 'Calle 45 # 22-10, Zona Industrial'),
 ('Distribuidora AutoLimpio', 'Patricia Díaz', '3109876543', 'autolimpio@gmail.com', 'Carrera 15 # 34-50');

INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, proveedor_id)
VALUES
 ('Shampoo pH Neutro Concentrado', 'ml', 4500, 1500, 18, 1),
 ('Cera Carnauba Premium', 'g', 900, 500, 45, 1),
 ('Desengrasante Motor/Chasis', 'ml', 3200, 1000, 22, 1),
 ('Silicona Emulsionada para Tableros', 'ml', 1400, 800, 28, 2),
 ('Microfibras 40x40 cm', 'unid', 6, 15, 3800, 2),
 ('Ambientador Líquido Aroma Nuevo', 'ml', 450, 600, 20, 2);

INSERT INTO servicios (nombre, tipo_vehiculo, descripcion, precio, duracion_estimada_min, activo)
VALUES
 ('Lavado Básico Carro', 'carro', 'Lavado exterior a presión, enjabonado con shampoo neutro, secado y llantas.', 18000, 25, TRUE),
 ('Lavado Completo Carro', 'carro', 'Exterior + interior profundo, aspirado, silicona en tablero y aplicación de cera.', 32000, 45, TRUE),
 ('Lavado Básico Moto', 'moto', 'Lavado exterior de chasis, plásticos y rines con protección.', 10000, 20, TRUE),
 ('Lavado Especial Moto + Cera', 'moto', 'Lavado detallado, desengrasado de cadena y motor, cera protectora en tanques y carenajes.', 18000, 35, TRUE),
 ('Polichado & Encerado Diamante', 'ambos', 'Descontaminado de pintura, polichado a máquina y sellado cerámico de cera.', 50000, 60, TRUE);

INSERT INTO servicio_insumos (servicio_id, insumo_id, cantidad_consumida)
VALUES
 (1, 1, 80), (1, 6, 10),
 (2, 1, 120), (2, 2, 30), (2, 3, 50), (2, 4, 40), (2, 6, 20),
 (3, 1, 50), (3, 3, 30),
 (4, 1, 70), (4, 2, 20), (4, 3, 50),
 (5, 2, 60), (5, 4, 50);

INSERT INTO clientes (nombre, telefono, correo, creado_por)
VALUES
 ('Samuel Petro Avalos', '3114567890', 'samuel.petro@email.com', 1),
 ('Diana Marcela Morales', '3157774433', 'diana.morales@gmail.com', 2),
 ('Roberto Cárdenas Gil', '3209887766', 'roberto.c@hotmail.com', 2);

INSERT INTO vehiculos (cliente_id, placa, tipo, marca, color)
VALUES
 (1, 'KLS-842', 'carro', 'Toyota Hilux', 'Blanco Perlado'),
 (2, 'DFG-21E', 'moto', 'Yamaha NMax 155', 'Azul Mate'),
 (3, 'MZP-309', 'carro', 'Mazda 3 Grand Touring', 'Rojo Diamante');

INSERT INTO gastos_operativos (concepto, monto, fecha, usuario_id)
VALUES ('Pago de servicio público de agua potable', 85000, CURDATE(), 1);

INSERT INTO auditoria (usuario_id, accion, detalle)
VALUES (1, 'inicio_sistema', 'Carga inicial de datos de ejemplo del sistema CarWash Pro');
