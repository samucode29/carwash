-- ============================================================================
-- CarWash Pro - Esquema de Base de Datos Relacional (MySQL 8+)
-- ============================================================================
-- Cómo usar este archivo en MySQL Workbench:
--   1. Abre MySQL Workbench y conéctate a tu servidor local (MySQL80).
--   2. Archivo > Abrir Script SQL... y selecciona este archivo
--      (o copia y pega todo el contenido en una pestaña de consulta nueva).
--   3. Ejecuta todo el script con el botón del rayo (Execute).
--   4. Verifica en el panel "Schemas" que aparezca la base "carwash_pro".
--
-- Este script reemplaza cualquier base de datos anterior con el mismo nombre.
-- Es la única fuente de verdad del modelo de datos: todo el backend
-- (backend/src/repositorios) asume exactamente estas tablas y columnas.
-- ============================================================================

DROP DATABASE IF EXISTS carwash_pro;

CREATE DATABASE carwash_pro
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE carwash_pro;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- 1. USUARIOS DEL SISTEMA (con inicio de sesión: administrador o empleado)
-- ============================================================================
-- Solo estos dos roles pueden autenticarse. Los lavadores NO tienen usuario
-- ni contraseña: son personal operativo registrado en la tabla `lavadores`.
CREATE TABLE usuarios (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    nombre              VARCHAR(150) NOT NULL,
    documento           VARCHAR(30)  NOT NULL UNIQUE,
    telefono            VARCHAR(20),
    correo              VARCHAR(150) UNIQUE,
    username            VARCHAR(50)  NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,          -- hash bcrypt, nunca texto plano
    rol                 ENUM('administrador','empleado') NOT NULL,
    -- Solo el administrador principal (normalmente el primero, dueño del
    -- negocio) puede crear u otorgar el rol de 'administrador' a otra
    -- cuenta. Un administrador normal puede crear empleados, pero no otros
    -- administradores.
    es_admin_principal  BOOLEAN NOT NULL DEFAULT FALSE,
    estado              ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
    fecha_ingreso       DATE NOT NULL,
    salario_fijo        DECIMAL(12,2),
    periodicidad_pago   ENUM('semanal','quincenal','mensual') DEFAULT 'quincenal',
    -- Jornada laboral y descanso: el pago de nómina se calcula por hora
    -- (salario_fijo entre las horas esperadas de la jornada) multiplicado
    -- por las horas realmente trabajadas (ver asistencia), no como un
    -- monto fijo sin importar cuánto se trabajó.
    jornada_horas_dia      DECIMAL(4,2) NOT NULL DEFAULT 8,
    dias_descanso_semana   TINYINT NOT NULL DEFAULT 1,
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================================
-- 2. LAVADORES (personal operativo SIN acceso al sistema, ganan comisión)
-- ============================================================================
CREATE TABLE lavadores (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    nombre              VARCHAR(150) NOT NULL,
    documento           VARCHAR(30)  NOT NULL UNIQUE,
    telefono            VARCHAR(20),
    estado              ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
    fecha_ingreso        DATE NOT NULL,
    porcentaje_comision DECIMAL(5,2) NOT NULL DEFAULT 60.00,
    creado_por          INT NULL,                        -- admin que lo registró
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_lavador_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 3. CLIENTES Y VEHÍCULOS
-- ============================================================================
-- Catálogo editable de tipos de vehículo (antes era un ENUM fijo a
-- carro/moto): el administrador puede agregar más desde un pequeño menú.
CREATE TABLE tipos_vehiculo (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(30) NOT NULL UNIQUE,
    estado      ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO tipos_vehiculo (nombre) VALUES ('carro'), ('moto');

CREATE TABLE clientes (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    telefono    VARCHAR(20)  NOT NULL,
    correo      VARCHAR(150),
    creado_por  INT NOT NULL,
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cliente_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE vehiculos (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id  INT NULL,
    placa       VARCHAR(15),
    tipo        VARCHAR(30) NOT NULL, -- nombre de tipos_vehiculo (no es FK dura para no romper si se inactiva un tipo con vehículos ya registrados)
    marca       VARCHAR(50),
    color       VARCHAR(30),
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vehiculo_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
    UNIQUE KEY uq_placa (placa)
) ENGINE=InnoDB;

-- Notas por cliente: 'lista_negra' registra incidentes (no pagó, generó
-- problemas, etc. — permite marcar al cliente como lista negra sin
-- eliminar el historial de lo ocurrido) y 'preferencia' registra cómo le
-- gusta que le hagan el servicio. Un cliente puede tener varias de cada una.
CREATE TABLE cliente_notas (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id  INT NOT NULL,
    tipo        ENUM('lista_negra','preferencia') NOT NULL,
    texto       VARCHAR(500) NOT NULL,
    creado_por  INT NOT NULL,
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notacliente_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    CONSTRAINT fk_notacliente_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 4. CATÁLOGO DE SERVICIOS
-- ============================================================================
CREATE TABLE servicios (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    nombre                  VARCHAR(100) NOT NULL,
    tipo_vehiculo           VARCHAR(30) NULL, -- NULL = aplica a todos los tipos (reemplaza al antiguo valor fijo 'ambos')
    descripcion             VARCHAR(255),
    precio                  DECIMAL(12,2) NOT NULL,
    duracion_estimada_min   INT NOT NULL,
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================================
-- 5. PROVEEDORES E INVENTARIO
-- ============================================================================
-- Los proveedores son globales (no pertenecen a un insumo en particular) y,
-- como el resto del personal/catálogo del sistema, nunca se eliminan: solo
-- se inactivan (estado).
CREATE TABLE proveedores (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    contacto    VARCHAR(100),
    telefono    VARCHAR(20),
    correo      VARCHAR(150),
    direccion   VARCHAR(200),
    estado      ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE insumos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL,
    unidad_medida   VARCHAR(20)  NOT NULL,
    stock_actual    DECIMAL(12,2) NOT NULL DEFAULT 0,
    stock_minimo    DECIMAL(12,2) NOT NULL DEFAULT 0,
    costo_unitario  DECIMAL(12,2) NOT NULL DEFAULT 0,
    proveedor_id    INT NULL,
    estado          ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_insumo_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 5B. HORARIO DE ATENCIÓN SEMANAL (editable por el administrador)
-- ============================================================================
-- Una fila por día (0=domingo..6=sábado, igual a Date.getDay() en JS). Las
-- citas (CU04/RF04) no se pueden agendar fuera de este horario ni en un día
-- marcado como cerrado (abierto=FALSE).
CREATE TABLE horario_atencion (
    dia_semana    TINYINT PRIMARY KEY,
    abierto       BOOLEAN NOT NULL DEFAULT TRUE,
    hora_apertura TIME NULL,
    hora_cierre   TIME NULL
) ENGINE=InnoDB;

INSERT INTO horario_atencion (dia_semana, abierto, hora_apertura, hora_cierre) VALUES
    (1, TRUE, '08:00:00', '18:00:00'),  -- lunes
    (2, TRUE, '08:00:00', '18:00:00'),  -- martes
    (3, TRUE, '08:00:00', '18:00:00'),  -- miércoles
    (4, TRUE, '08:00:00', '18:00:00'),  -- jueves
    (5, TRUE, '08:00:00', '18:00:00'),  -- viernes
    (6, TRUE, '08:00:00', '17:00:00'),  -- sábado
    (0, FALSE, NULL, NULL);             -- domingo: sin atención por defecto

-- ============================================================================
-- 6. AGENDAMIENTO: CITAS Y TURNOS (orden de llegada)
-- ============================================================================
CREATE TABLE citas (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id      INT NULL,
    vehiculo_id     INT NULL,
    servicio_id     INT NOT NULL,
    fecha           DATE NOT NULL,
    hora            TIME NOT NULL,
    estado          ENUM('agendada','reprogramada','cancelada','atendida') NOT NULL DEFAULT 'agendada',
    cliente_nombre_temp    VARCHAR(150),
    cliente_telefono_temp  VARCHAR(20),
    placa_temp             VARCHAR(15),
    -- Nota libre al agendar (ej. "recién pintado, no polichar"): se pasa a
    -- la orden cuando la cita se atiende, para que el lavador la vea.
    observacion     VARCHAR(500),
    registrado_por  INT NOT NULL,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cita_cliente   FOREIGN KEY (cliente_id)     REFERENCES clientes(id)  ON DELETE SET NULL,
    CONSTRAINT fk_cita_vehiculo  FOREIGN KEY (vehiculo_id)    REFERENCES vehiculos(id) ON DELETE SET NULL,
    CONSTRAINT fk_cita_servicio  FOREIGN KEY (servicio_id)    REFERENCES servicios(id),
    CONSTRAINT fk_cita_registro  FOREIGN KEY (registrado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE turnos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id      INT NULL,
    vehiculo_id     INT NULL,
    cita_id         INT NULL,        -- si esta fila viene de una cita agendada que se pasó a la fila
    numero_turno    INT NULL,        -- ya no se usa (el número visible se calcula por orden de llegada); columna sin uso, se deja NULL
    placa_temporal  VARCHAR(15),
    tipo_vehiculo   VARCHAR(30) NOT NULL DEFAULT 'carro',
    servicio_id     INT NOT NULL,
    fecha           DATE NOT NULL,
    hora_llegada    TIME NOT NULL,
    estado          ENUM('en_espera','en_proceso','finalizado','cancelado') NOT NULL DEFAULT 'en_espera',
    -- Nota libre al poner el vehículo en la fila (ej. "recién pintado, no
    -- polichar"): se pasa a la orden cuando se atiende (ver "Iniciar").
    observacion     VARCHAR(500),
    registrado_por  INT NOT NULL,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_turno_cliente   FOREIGN KEY (cliente_id)     REFERENCES clientes(id)  ON DELETE SET NULL,
    CONSTRAINT fk_turno_vehiculo  FOREIGN KEY (vehiculo_id)    REFERENCES vehiculos(id) ON DELETE SET NULL,
    CONSTRAINT fk_turno_cita      FOREIGN KEY (cita_id)        REFERENCES citas(id),
    CONSTRAINT fk_turno_servicio  FOREIGN KEY (servicio_id)    REFERENCES servicios(id),
    CONSTRAINT fk_turno_registro  FOREIGN KEY (registrado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 7. PUNTO DE VENTA (POS): ÓRDENES DE SERVICIO
-- ============================================================================
CREATE TABLE ordenes_servicio (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    cita_id                 INT NULL,
    turno_id                INT NULL,
    cliente_id              INT NULL,
    vehiculo_id             INT NULL,
    servicio_id             INT NOT NULL,
    es_venta_anonima        BOOLEAN NOT NULL DEFAULT FALSE,
    placa_anonima           VARCHAR(15),
    tipo_vehiculo_anonimo   VARCHAR(30),
    estado                  ENUM('recibido','en_proceso','terminado','entregado','cancelado') NOT NULL DEFAULT 'recibido',
    total                   DECIMAL(12,2) NOT NULL,
    -- Nota de entrada heredada del turno/cita de origen (o escrita directo
    -- en una venta anónima/rápida): contexto para el lavador ("recién
    -- pintado, no polichar").
    observacion             VARCHAR(500),
    registrado_por          INT NOT NULL,
    fecha_hora_registro     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_hora_entrega      DATETIME NULL,
    CONSTRAINT fk_orden_cita       FOREIGN KEY (cita_id)        REFERENCES citas(id),
    CONSTRAINT fk_orden_turno      FOREIGN KEY (turno_id)       REFERENCES turnos(id),
    CONSTRAINT fk_orden_cliente    FOREIGN KEY (cliente_id)     REFERENCES clientes(id)  ON DELETE SET NULL,
    CONSTRAINT fk_orden_vehiculo   FOREIGN KEY (vehiculo_id)    REFERENCES vehiculos(id) ON DELETE SET NULL,
    CONSTRAINT fk_orden_servicio   FOREIGN KEY (servicio_id)    REFERENCES servicios(id),
    CONSTRAINT fk_orden_registro   FOREIGN KEY (registrado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- Lavador(es) asignados a una orden, con su comisión calculada
CREATE TABLE orden_lavadores (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    orden_id                INT NOT NULL,
    lavador_id              INT NOT NULL,
    asignacion_automatica   BOOLEAN NOT NULL DEFAULT TRUE,
    porcentaje_comision     DECIMAL(5,2) NOT NULL DEFAULT 60.00,
    valor_comision          DECIMAL(12,2) NOT NULL DEFAULT 0,
    asignado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ol_orden   FOREIGN KEY (orden_id)   REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
    CONSTRAINT fk_ol_lavador FOREIGN KEY (lavador_id) REFERENCES lavadores(id),
    UNIQUE KEY uq_orden_lavador (orden_id, lavador_id)
) ENGINE=InnoDB;

-- Servicios adicionales agregados a una orden ya en curso (RF08): así un
-- mismo vehículo puede recibir varios servicios en una sola visita sin
-- generarle un turno/orden nuevo y duplicado.
CREATE TABLE orden_servicios_extra (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    orden_id      INT NOT NULL,
    servicio_id   INT NOT NULL,
    precio        DECIMAL(12,2) NOT NULL,
    agregado_por  INT NOT NULL,
    creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ose_orden      FOREIGN KEY (orden_id)     REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
    CONSTRAINT fk_ose_servicio   FOREIGN KEY (servicio_id)  REFERENCES servicios(id),
    CONSTRAINT fk_ose_agregado   FOREIGN KEY (agregado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 8. PAGOS Y CAJA
-- ============================================================================
CREATE TABLE pagos (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    orden_id     INT NOT NULL,
    metodo_pago  ENUM('efectivo','tarjeta','transferencia','pse') NOT NULL,
    monto        DECIMAL(12,2) NOT NULL,
    -- Descuento otorgado al cliente al momento de cobrar, dividido según
    -- quién lo asume (nunca cambia orden_lavadores.valor_comision, que
    -- queda igual como registro del servicio; el descuento_trabajador se
    -- resta aparte al calcular lo que se le liquida al lavador, ver
    -- NominaRepositorio.resumenComisionesLavadores):
    --   descuento_negocio:    lo pierde el negocio (ganancia neta).
    --   descuento_trabajador: lo pierde el lavador (se descuenta de su
    --                         comisión pendiente), ej. cliente no pagó por
    --                         su culpa.
    descuento_negocio    DECIMAL(12,2) NOT NULL DEFAULT 0,
    descuento_trabajador DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- Nota libre al cobrar (ej. "cliente se negó a pagar, es amigo del
    -- lavador, él respondió por el servicio").
    observacion  VARCHAR(500),
    estado       ENUM('confirmado','rechazado','pendiente') NOT NULL DEFAULT 'confirmado',
    fecha_pago   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pago_orden FOREIGN KEY (orden_id) REFERENCES ordenes_servicio(id)
) ENGINE=InnoDB;

CREATE TABLE cierres_caja (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    fecha               DATE NOT NULL,
    usuario_id          INT NOT NULL,
    total_efectivo      DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_tarjeta       DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_transferencia DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_pse           DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_general       DECIMAL(12,2) NOT NULL DEFAULT 0,
    observaciones       VARCHAR(500),
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cierre_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    UNIQUE KEY uq_cierre_fecha (fecha)
) ENGINE=InnoDB;

-- ============================================================================
-- 9. MOVIMIENTOS DE INVENTARIO Y ENTREGAS A LAVADORES
-- ============================================================================
CREATE TABLE movimientos_inventario (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    insumo_id    INT NOT NULL,
    tipo         ENUM('entrada','salida') NOT NULL,
    cantidad     DECIMAL(12,2) NOT NULL,
    orden_id     INT NULL,
    proveedor_id INT NULL,
    usuario_id   INT NOT NULL,
    observacion  VARCHAR(255),
    fecha        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mov_insumo    FOREIGN KEY (insumo_id)    REFERENCES insumos(id),
    CONSTRAINT fk_mov_orden     FOREIGN KEY (orden_id)     REFERENCES ordenes_servicio(id),
    CONSTRAINT fk_mov_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
    CONSTRAINT fk_mov_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE insumos_entregados (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    lavador_id     INT NOT NULL,
    insumo_id      INT NOT NULL,
    cantidad       DECIMAL(12,2) NOT NULL,
    estado         ENUM('pendiente','entregado') NOT NULL DEFAULT 'entregado',
    entregado_por  INT NOT NULL,
    fecha_entrega  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ie_lavador    FOREIGN KEY (lavador_id)    REFERENCES lavadores(id),
    CONSTRAINT fk_ie_insumo     FOREIGN KEY (insumo_id)     REFERENCES insumos(id),
    CONSTRAINT fk_ie_entregador FOREIGN KEY (entregado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 10. NÓMINA: COMISIONES DE LAVADORES, SALARIOS Y ASISTENCIA
-- ============================================================================
CREATE TABLE liquidaciones_lavador (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    lavador_id        INT NOT NULL,
    periodo_inicio    DATE NOT NULL,
    periodo_fin       DATE NOT NULL,
    total_comision    DECIMAL(12,2) NOT NULL DEFAULT 0,
    descuentos        DECIMAL(12,2) NOT NULL DEFAULT 0,
    valor_a_pagar     DECIMAL(12,2) NOT NULL DEFAULT 0,
    estado            ENUM('pendiente','pagado') NOT NULL DEFAULT 'pendiente',
    fecha_pago        DATE NULL,
    soporte_pago_url    VARCHAR(255) NULL,
    soporte_pago_nombre VARCHAR(255) NULL,
    soporte_pago_tipo   VARCHAR(100) NULL,
    soporte_pago_datos  LONGBLOB NULL,
    creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_liq_lavador FOREIGN KEY (lavador_id) REFERENCES lavadores(id)
) ENGINE=InnoDB;

CREATE TABLE pagos_salario (
    id                     INT AUTO_INCREMENT PRIMARY KEY,
    empleado_id            INT NOT NULL,
    periodicidad           ENUM('semanal','quincenal','mensual') NOT NULL,
    periodo_inicio         DATE NOT NULL,
    periodo_fin            DATE NOT NULL,
    salario_base           DECIMAL(12,2) NOT NULL,
    descuentos             DECIMAL(12,2) NOT NULL DEFAULT 0,
    valor_a_pagar          DECIMAL(12,2) NOT NULL,
    estado                 ENUM('pendiente','pagado') NOT NULL DEFAULT 'pendiente',
    fecha_pago_real        DATE NULL,
    soporte_pago_url    VARCHAR(255) NULL,
    soporte_pago_nombre VARCHAR(255) NULL,
    soporte_pago_tipo   VARCHAR(100) NULL,
    soporte_pago_datos  LONGBLOB NULL,
    creado_en              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ps_empleado FOREIGN KEY (empleado_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- Asistencia de CUALQUIER tipo de personal (empleado/admin O lavador).
-- `persona_tipo` indica en cuál tabla buscar `persona_id` (no se usa FK
-- compuesta a dos tablas distintas porque MySQL no lo permite de forma nativa).
CREATE TABLE asistencia (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    persona_tipo      ENUM('usuario','lavador') NOT NULL,
    persona_id        INT NOT NULL,
    fecha             DATE NOT NULL,
    hora_entrada      TIME NULL,
    hora_salida       TIME NULL,
    horas_trabajadas  DECIMAL(5,2) NULL DEFAULT 0,
    horas_descanso    DECIMAL(4,2) NOT NULL DEFAULT 0, -- almuerzo/descanso; no cuenta en horas_trabajadas
    inasistencia      BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE KEY uq_asistencia_persona_fecha (persona_tipo, persona_id, fecha)
) ENGINE=InnoDB;

-- ============================================================================
-- 11. GASTOS OPERATIVOS
-- ============================================================================
CREATE TABLE gastos_operativos (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    concepto    VARCHAR(200) NOT NULL,
    monto       DECIMAL(12,2) NOT NULL,
    fecha       DATE NOT NULL,
    usuario_id  INT NOT NULL,
    creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_gasto_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 12. AUDITORÍA (inicios de sesión, cambios de estado, pagos, etc.)
-- ============================================================================
CREATE TABLE auditoria (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id  INT NULL,
    accion      VARCHAR(100) NOT NULL,
    detalle     VARCHAR(500),
    fecha       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ============================================================================
-- 13. FACTURACIÓN (numeración automática de compras y ventas)
-- ============================================================================
-- numero_factura se genera solo, con el formato CCPP-DDMMAA-NNN:
--   CC  = categoría: COM (compra a proveedor) o VEN (venta/servicio)
--   PP  = primeras 2 letras del insumo (compra) o del servicio (venta)
--   DDMMAA = fecha del día en que se emite
--   NNN = consecutivo del día para ese tipo (compra o venta), reinicia
--         en 001 cada día
CREATE TABLE facturas (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    numero_factura  VARCHAR(30) NOT NULL UNIQUE,
    tipo            ENUM('compra','venta','nomina') NOT NULL,
    orden_id        INT NULL,        -- factura de venta -> ordenes_servicio
    movimiento_id   INT NULL,        -- factura de compra -> movimientos_inventario
    cliente_id      INT NULL,
    proveedor_id    INT NULL,
    concepto        VARCHAR(150) NOT NULL,   -- nombre del servicio o insumo facturado
    total           DECIMAL(12,2) NOT NULL DEFAULT 0,
    fecha           DATE NOT NULL,
    creado_por      INT NOT NULL,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_factura_orden      FOREIGN KEY (orden_id)      REFERENCES ordenes_servicio(id),
    CONSTRAINT fk_factura_movimiento FOREIGN KEY (movimiento_id) REFERENCES movimientos_inventario(id),
    CONSTRAINT fk_factura_cliente    FOREIGN KEY (cliente_id)    REFERENCES clientes(id),
    CONSTRAINT fk_factura_proveedor  FOREIGN KEY (proveedor_id)  REFERENCES proveedores(id),
    CONSTRAINT fk_factura_usuario    FOREIGN KEY (creado_por)    REFERENCES usuarios(id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- ÍNDICES ADICIONALES PARA CONSULTAS FRECUENTES (dashboard, reportes, historial)
-- ============================================================================
CREATE INDEX idx_orden_fecha         ON ordenes_servicio (fecha_hora_registro);
CREATE INDEX idx_orden_estado        ON ordenes_servicio (estado);
CREATE INDEX idx_pago_fecha          ON pagos (fecha_pago);
CREATE INDEX idx_cita_fecha          ON citas (fecha);
CREATE INDEX idx_turno_fecha         ON turnos (fecha);
CREATE INDEX idx_vehiculo_placa      ON vehiculos (placa);
CREATE INDEX idx_movinv_fecha        ON movimientos_inventario (fecha);
CREATE INDEX idx_factura_fecha_tipo  ON facturas (fecha, tipo);
CREATE INDEX idx_liq_lavador_estado  ON liquidaciones_lavador (estado);
CREATE INDEX idx_pago_salario_estado ON pagos_salario (estado);
CREATE INDEX idx_gasto_fecha         ON gastos_operativos (fecha);
CREATE INDEX idx_asistencia_fecha    ON asistencia (fecha);
CREATE INDEX idx_notacliente_cliente ON cliente_notas (cliente_id, tipo);
