# CarWash Pro

Sistema de gestión para lavadero de carros y motos: punto de venta, tablero
de lavado, agenda de citas, inventario perpetuo, nómina (comisiones de
lavadores y salarios fijos), caja diaria y reportes financieros con
descarga en PDF.

Backend y frontend están completamente separados:

```
Carwash/
├── backend/    → API REST en Node.js/Express + MySQL (ver backend/README implícito abajo)
├── frontend/   → HTML/CSS/JS puro (sin frameworks ni build step)
└── vercel.json → configuración de despliegue serverless en Vercel
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

Este reparto sigue el documento de casos de uso original (`CU01`-`CU29`).
Si prefieres que el empleado tenga acceso *solo de consulta* (sin poder
operar el POS ni el tablero), es un cambio acotado: basta con envolver
esas rutas en el backend con `permitirRoles('administrador')` igual que ya
se hizo con catálogo, proveedores y reportes.

---

## 6. Reportes y PDF

`GET /api/reportes/dashboard?periodo=dia|semana|mes|ano|personalizado`
(agregando `fecha_inicio`/`fecha_fin` para el personalizado) devuelve el
mismo cálculo en JSON. `GET /api/reportes/dashboard/pdf` con los mismos
parámetros devuelve el reporte como archivo PDF descargable. Ambos
exigen sesión de administrador.

---

## 7. Despliegue

### Railway (recomendado para empezar)
1. Crea un servicio MySQL en Railway (o usa uno externo) y ejecuta
   `backend/database/schema.sql` contra esa base.
2. Crea un servicio Node apuntando a la carpeta `backend/` (Root
   Directory = `backend`). Railway detecta `npm start` automáticamente.
3. Configura las variables de entorno del `.env.example` en el panel de
   Railway (usando las credenciales de tu MySQL de Railway).
4. Sirve `frontend/` como sitio estático (otro servicio en Railway, o
   Vercel/Netlify apuntando solo a esa carpeta) y ajusta la URL base de la
   API en `frontend/js/api.js` si el backend queda en otro dominio.

### Vercel
`vercel.json` ya enruta `/api/*` a `backend/api/index.js` (función
serverless) y el resto a `frontend/`. Como Vercel no aloja bases de datos,
necesitas un MySQL externo (Railway, PlanetScale, Aiven, etc.) y configurar
sus credenciales como variables de entorno del proyecto en Vercel.

---

## 8. Git

```bash
git init
git add .
git commit -m "CarWash Pro: backend/frontend separados, login y MySQL"
```

`.env` nunca se sube (ver `.gitignore`): cada entorno (tu máquina, Railway,
Vercel) tiene el suyo propio.
