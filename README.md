# CarWash Pro

Sistema de gestión para lavadero de carros y motos: punto de venta, tablero
de lavado, agenda de citas, inventario perpetuo, nómina (comisiones de
lavadores y salarios fijos), caja diaria y reportes financieros con
descarga en PDF.

Backend y frontend están completamente separados:

```
Carwash/
├── backend/    → API REST en Node.js/Express + MySQL
└── frontend/   → HTML/CSS/JS puro (sin frameworks ni build step)
```

---

## 1. Requisitos

- Node.js 18+ y npm
- MySQL 8+ (local vía MySQL Workbench, o un servicio en la nube)
- Git

---

## 2. Crear la base de datos (MySQL Workbench)

1. Abre **MySQL Workbench** y conéctate a tu servidor MySQL local.
2. Abre el archivo [`backend/database/schema.sql`](backend/database/schema.sql)
   (Archivo → Abrir Script SQL...) o simplemente copia y pega todo su
   contenido en una pestaña de consulta nueva.
3. Ejecuta todo el script (⚡ Execute). Esto crea la base de datos
   `carwash_pro` completa, con todas sus tablas.
4. (Opcional, recomendado para probar el sistema) Ejecuta también
   [`backend/database/datos_semilla.sql`](backend/database/datos_semilla.sql)
   para cargar datos de ejemplo, incluyendo dos usuarios de acceso:

   | Usuario | Contraseña | Rol           |
   |---------|-----------|---------------|
   | `admin` | `admin123`| administrador |
   | `laura` | `laura123`| empleado      |

`schema.sql` es la **única fuente de verdad** del modelo de datos: si
necesitas cambiar una tabla, se cambia ahí y se vuelve a ejecutar.

---

## 3. Levantar el backend en local

```bash
cd backend
cp .env.example .env
```

Edita `backend/.env` y coloca el usuario/contraseña de tu MySQL local
(`DB_USER`, `DB_PASSWORD`) y un valor propio para `JWT_SECRET`.

```bash
npm install
npm start
```

Si todo está bien configurado verás:

```
✅ Conexión a MySQL verificada.
🚀 CarWash Pro backend activo en http://localhost:3000
```

Si falla, el mensaje de error te dirá si el problema es de conexión a
MySQL o si falta `JWT_SECRET` en el `.env`.

---

## 4. Abrir el frontend

El frontend es HTML/CSS/JS puro (sin build step). En desarrollo local, el
propio backend ya sirve la carpeta `frontend/` como sitio estático, así
que con el backend corriendo (paso 3) solo abres en el navegador:

```
http://localhost:3000/login.html
```

Si prefieres servir el frontend por separado (por ejemplo para simular el
despliegue final en dos servicios distintos), puedes hacerlo con cualquier
servidor estático apuntando a `frontend/`:

```bash
cd frontend
npx serve .
```

En ese caso, como el frontend queda en un puerto distinto al backend,
ajusta las rutas de `frontend/js/api.js` para apuntar a la URL completa
del backend en vez de rutas relativas `/api/...`.

---

## 5. Roles y permisos

Hay **dos roles con inicio de sesión**: `administrador` y `empleado`. Los
**lavadores no tienen usuario ni contraseña**: son personal operativo que
el administrador registra para calcular sus comisiones, pero nunca entran
al sistema.

- **Administrador**: acceso total — catálogo de servicios, proveedores,
  gestión de personal (usuarios y lavadores), nómina y salarios, reportes,
  dashboard de ganancias y descarga de PDF.
- **Empleado**: operación diaria — POS, tablero de lavado, agenda de citas
  y turnos, movimientos de inventario (entradas/entregas), caja diaria,
  registro de asistencia, y su propio perfil (botón "Mi Perfil") donde ve
  su salario y periodicidad de pago. No ve el dashboard financiero, no
  gestiona nómina de terceros ni crea usuarios/insumos/proveedores nuevos.
  **No puede crear ni empleados ni administradores** (esa ruta exige rol
  administrador).

### Administrador principal

Dentro de los administradores hay un nivel extra: `es_admin_principal`
(columna `usuarios.es_admin_principal` en la base de datos). Samuel Petro
Avalos (usuario `admin`) es el administrador principal por defecto.

- **Cualquier administrador** puede crear cuentas de **empleado**.
- **Solo el administrador principal** puede crear (o ascender a) otra
  cuenta de **administrador** — un administrador normal que lo intente
  recibe `403 Solo el administrador principal puede crear nuevas cuentas
  de administrador.` Esto se valida en el backend
  (`PersonalControlador.crearUsuario`/`actualizarUsuario`) y además se
  oculta la opción "Administrador" en el formulario del frontend si quien
  tiene la sesión no es el principal.
- No hay ninguna ruta que permita cambiar `es_admin_principal` por API: si
  algún día quieres nombrar a otro administrador principal, se hace
  directamente en la base de datos (`UPDATE usuarios SET
  es_admin_principal = TRUE WHERE id = ...`).

Este reparto sigue el documento de casos de uso original (`CU01`-`CU29`).
Si prefieres que el empleado tenga acceso *solo de consulta* (sin poder
operar el POS ni el tablero), es un cambio acotado: basta con envolver
esas rutas en el backend con `permitirRoles('administrador')` igual que ya
se hizo con catálogo, proveedores y reportes.

### Contraseñas

- **Contraseña por defecto**: toda cuenta nueva (administrador o empleado)
  que se crea sin especificar contraseña recibe automáticamente
  `carwash` + su número de documento (ej. documento `123456` → contraseña
  `carwash123456`).
- **Cambiar mi contraseña**: cualquier usuario, sin importar el rol, puede
  cambiar su propia contraseña desde "Mi Perfil" → "Cambiar Contraseña"
  (pide la contraseña actual).
- **Reiniciar contraseña**: en la pestaña Personal & Nómina → Empleados, el
  administrador tiene un botón "Reiniciar Contraseña" por cada cuenta, que
  la regresa al mismo formato por defecto (`carwash` + documento). La única
  excepción es la cuenta del administrador principal: nadie más que él
  mismo puede reiniciarla (para que otro administrador no pueda
  apropiarse de esa cuenta).

---

## 6. Reportes y PDF

`GET /api/reportes/dashboard?periodo=dia|semana|mes|ano|personalizado`
(agregando `fecha_inicio`/`fecha_fin` para el personalizado) devuelve el
mismo cálculo en JSON. `GET /api/reportes/dashboard/pdf` con los mismos
parámetros devuelve el reporte como archivo PDF descargable. Ambos
exigen sesión de administrador.

---

## 7. Despliegue en Railway

Railway puede alojar tanto la base de datos MySQL como el backend Node
(un servidor persistente de verdad, con `app.listen()` — no serverless),
así que es la opción más simple para este proyecto.

1. **Base de datos**: en tu proyecto de Railway, agrega un plugin/servicio
   de MySQL. Railway te da host, puerto, usuario, contraseña y nombre de
   base ya generados. Conéctate con esos datos desde MySQL Workbench (o
   con el botón "Connect" de Railway) y ejecuta
   [`backend/database/schema.sql`](backend/database/schema.sql) (y opcionalmente
   `datos_semilla.sql`) contra esa base, igual que harías en local.
2. **Backend**: crea un servicio Node a partir de este repositorio, con
   **Root Directory = `backend`**. Railway detecta `npm start`
   automáticamente (usa `backend/package.json`).
3. En la pestaña "Variables" de ese servicio, agrega las mismas variables
   de [`backend/.env.example`](backend/.env.example) (`DB_HOST`, `DB_PORT`,
   `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `JWT_EXPIRA_EN`,
   `CORS_ORIGEN`) usando las credenciales del servicio MySQL del paso 1.
   Railway asigna `PORT` automáticamente, no hace falta declararla.
4. El backend ya sirve `frontend/` como sitio estático (ver
   `backend/src/app.js`), así que con un solo servicio de Railway tienes
   todo funcionando: abre la URL pública que te da Railway y entra por
   `/login.html`.

No hace falta ningún archivo de configuración adicional (Railway detecta
un proyecto Node estándar solo con `package.json`).

---

## 8. Git

```bash
git init
git add .
git commit -m "CarWash Pro: backend/frontend separados, login y MySQL"
```

`.env` nunca se sube (ver `.gitignore`): cada entorno (tu máquina, Railway)
tiene el suyo propio.
