/**
 * CARWASH PRO - LÓGICA PRINCIPAL DEL CLIENTE (JavaScript Vanilla)
 *
 * Consume la API REST del backend (backend/src) usando el cliente
 * centralizado ApiCliente (js/api.js), que ya adjunta el token JWT de la
 * sesión activa. Las secciones están organizadas igual que los módulos del
 * backend para que sea fácil ubicar la lógica de cada pantalla.
 */

/**
 * Fecha de hoy en formato YYYY-MM-DD, en hora LOCAL del navegador.
 * OJO: no usar new Date().toISOString() para esto porque esa función
 * siempre da la fecha en UTC; en Colombia (UTC-5), entre las 7 p.m. y
 * medianoche locales, UTC ya está en el día siguiente y el campo de
 * fecha quedaría adelantado un día.
 */
function fechaLocalHoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fechaLocalHaceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Filtros "en vivo" para campos de texto: quitan mientras se escribe
 * cualquier carácter que de todos modos el backend va a rechazar (números
 * en un nombre, letras en un documento/teléfono), para que el usuario vea
 * el error de inmediato en vez de enterarse solo al guardar.
 */
function soloLetras(input) {
  input.value = input.value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]/g, '');
}

function soloNumeros(input) {
  input.value = input.value.replace(/[^0-9]/g, '');
}

// Mismas reglas que backend/src/utilidades/validadores.js, para dar el
// mensaje de error de inmediato sin esperar el viaje al servidor.
const REGEX_NOMBRE_VALIDO = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;
const REGEX_CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esNombreValido(texto) {
  const limpio = (texto || '').trim();
  return limpio.length >= 3 && REGEX_NOMBRE_VALIDO.test(limpio);
}

function esDocumentoValido(texto) {
  const limpio = (texto || '').trim();
  return limpio.length >= 4 && limpio.length <= 15 && /^[0-9]+$/.test(limpio);
}

function esTelefonoValido(texto) {
  const limpio = (texto || '').trim();
  return limpio.length >= 7 && limpio.length <= 10 && /^[0-9]+$/.test(limpio);
}

function esCorreoValido(texto) {
  const limpio = (texto || '').trim();
  return limpio === '' || REGEX_CORREO_VALIDO.test(limpio);
}

const app = {
  currentUser: null,
  activeTab: 'pos',
  activeSubTabNomina: 'lavadores',
  dashboardPeriod: 'dia',
  selectedServiceId: null,
  payingOrderId: null,
  liquidatingWasher: null,
  payingLiqId: null,
  editingServiceId: null,
  editingWasherId: null,
  editingEmpleadoId: null,
  editingClienteId: null,
  pendingOrdenPayload: null,
  pendingOrdenId: null,
  agregandoServicioExtraOrdenId: null,
  pendingOrdenOnSuccess: null,
  selectedWashersAsignacion: [],

  // ===========================================================================
  // INICIALIZACIÓN Y SESIÓN
  // ===========================================================================
  init() {
    this.currentUser = exigirSesionActiva();
    if (!this.currentUser) return; // exigirSesionActiva ya redirigió a login.html

    this.pintarBarraSesion();
    this.initTheme();
    this.initSidebar();
    this.startClock();
    this.setupDatePickers();
    this.loadInitialData();
    this.mostrarAlertaCitasDelDia();
    this.revisarRecordatoriosCitas();

    setInterval(() => {
      if (this.activeTab === 'tablero') this.loadOrders();
      if (this.activeTab === 'pos') this.loadTurnos();
    }, 30000);

    setInterval(() => this.revisarRecordatoriosCitas(), 60000);

    if (this.currentUser.rol === 'administrador') {
      this.revisarAlertasSalidaProxima();
      setInterval(() => this.revisarAlertasSalidaProxima(), 60000);
    }
  },

  pintarBarraSesion() {
    const esAdmin = this.currentUser.rol === 'administrador';
    document.getElementById('sesionNombre').textContent = this.currentUser.nombre;
    document.getElementById('sesionRolBadge').textContent = this.currentUser.esAdminPrincipal ? 'ADMIN PRINCIPAL' : (esAdmin ? 'ADMIN' : 'EMPLEADO');
    document.getElementById('sesionRolBadge').style.background = esAdmin
      ? 'linear-gradient(135deg, #0077b6, #00b4d8)'
      : 'linear-gradient(135deg, #059669, #10b981)';

    // Solo el administrador principal puede crear otras cuentas de administrador.
    const opcionAdmin = document.getElementById('usrRolOpcionAdmin');
    if (opcionAdmin) opcionAdmin.classList.toggle('hidden', !this.currentUser.esAdminPrincipal);

    this.updateRolePermissions();
  },

  cerrarSesion() {
    ApiCliente.cerrarSesion();
  },

  updateRolePermissions() {
    const isAdmin = this.currentUser.rol === 'administrador';
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  },

  // Navegación de pestañas
  setTab(tabId) {
    if ((tabId === 'dashboard' || tabId === 'servicios') && this.currentUser.rol !== 'administrador') {
      this.toast('Acceso denegado: esta sección es exclusiva para Administrador.', 'error');
      return;
    }

    this.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId));
    document.querySelectorAll('.tab-view').forEach(view => view.classList.toggle('active', view.id === `tab-${tabId}`));

    // En celular, el menú lateral tapa la pantalla mientras está abierto:
    // al elegir una sección se cierra solo, en vez de dejarlo ahí tapando.
    if (window.matchMedia('(max-width: 768px)').matches) {
      document.getElementById('appShell').classList.add('sidebar-collapsed');
      localStorage.setItem('carwash_sidebar', 'colapsado');
    }

    switch (tabId) {
      case 'pos': this.loadTurnos(); break;
      case 'tablero': this.loadOrders(); break;
      case 'citas': this.loadCitas(); break;
      case 'inventario': this.loadInsumos(); break;
      case 'servicios': this.loadServicios(); break;
      case 'nomina': this.loadNomina(); break;
      case 'caja': this.loadCaja(); break;
      case 'facturas': this.loadFacturas(); break;
      case 'clientes': this.loadClientesAdmin(); break;
      case 'dashboard': this.loadReporteActivo(); break;
    }
  },

  setSubTabNomina(subtab) {
    this.activeSubTabNomina = subtab;
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(`subtab-${subtab}`);
    if (target) target.classList.add('active');
    this.loadNomina();
  },

  // ===========================================================================
  // BARRA LATERAL (vertical, desplegable) Y TEMA
  // ===========================================================================
  initSidebar() {
    const guardado = localStorage.getItem('carwash_sidebar');
    // En celular el menú es un panel deslizable que tapa la pantalla: si
    // nunca se ha guardado una preferencia, mejor arrancar cerrado (en
    // escritorio, sin preferencia guardada, sigue arrancando abierto).
    const esMobil = window.matchMedia('(max-width: 768px)').matches;
    if (guardado === 'colapsado' || (guardado === null && esMobil)) {
      document.getElementById('appShell').classList.add('sidebar-collapsed');
    }
  },

  toggleSidebar() {
    const colapsado = document.getElementById('appShell').classList.toggle('sidebar-collapsed');
    localStorage.setItem('carwash_sidebar', colapsado ? 'colapsado' : 'expandido');
  },

  initTheme() {
    // Por defecto (sin preferencia guardada) se usa Modo Claro. El usuario
    // puede cambiar a Modo Oscuro con el botón del header; esa elección
    // queda guardada y se respeta en las próximas visitas.
    const saved = localStorage.getItem('carwash_theme');
    const modoOscuro = saved === 'dark';
    document.body.classList.toggle('light-mode', !modoOscuro);
    this.updateThemeButton(!modoOscuro);
  },

  toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('carwash_theme', isLight ? 'light' : 'dark');
    this.updateThemeButton(isLight);
  },

  updateThemeButton(isLight) {
    const text = document.getElementById('themeText');
    if (text) text.textContent = isLight ? 'Modo Oscuro' : 'Modo Claro';
  },

  startClock() {
    const clockEl = document.getElementById('liveClock');
    const update = () => { clockEl.textContent = new Date().toLocaleTimeString('es-CO'); };
    update();
    setInterval(update, 1000);
  },

  setupDatePickers() {
    const hoy = fechaLocalHoy();
    ['citasFechaFiltro', 'citaFechaInput', 'pagLiqFecha', 'reporteFechaInicio', 'reporteFechaFin'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = hoy;
    });
  },

  async loadInitialData() {
    await this.loadTiposVehiculo();
    await Promise.all([
      this.loadServices(),
      this.loadWashers(),
      this.loadClients(),
      this.loadTurnos(),
      this.loadInsumos(),
      this.loadOrders(),
      this.loadHorarioAtencion()
    ]);
    this.updateRolePermissions();
  },

  // ===========================================================================
  // HORARIO DE ATENCIÓN SEMANAL (usado para validar/orientar el agendamiento
  // de citas; la edición vive en la pestaña Servicios, solo administrador)
  // ===========================================================================
  async loadHorarioAtencion() {
    try {
      this.horarioAtencion = await ApiCliente.get('/api/horario-atencion');
      this.renderHorarioAtencionAdmin();
    } catch (err) { console.error(err); }
  },

  renderHorarioAtencionAdmin() {
    const tbody = document.getElementById('horarioAtencionTableBody');
    if (!tbody || !this.horarioAtencion) return;

    const NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const ORDEN = [1, 2, 3, 4, 5, 6, 0]; // mostrar lunes a domingo

    tbody.innerHTML = ORDEN.map(dia => {
      const h = this.horarioAtencion.find(x => x.dia_semana === dia) || { abierto: false, hora_apertura: '', hora_cierre: '' };
      const apertura = (h.hora_apertura || '08:00').substring(0, 5);
      const cierre = (h.hora_cierre || '18:00').substring(0, 5);
      return `
        <tr>
          <td><strong>${NOMBRES[dia]}</strong></td>
          <td>
            <label class="radio-label" style="display:inline-flex">
              <input type="checkbox" id="horarioAbierto${dia}" ${h.abierto ? 'checked' : ''} onchange="app.toggleHorarioDia(${dia})">
              <span>Atiende este día</span>
            </label>
          </td>
          <td><input type="time" id="horarioApertura${dia}" value="${apertura}" ${h.abierto ? '' : 'disabled'}></td>
          <td><input type="time" id="horarioCierre${dia}" value="${cierre}" ${h.abierto ? '' : 'disabled'}></td>
          <td><button class="btn btn-sm btn-secondary" onclick="app.guardarHorarioDia(${dia})">Guardar</button></td>
        </tr>
      `;
    }).join('');
  },

  toggleHorarioDia(dia) {
    const abierto = document.getElementById(`horarioAbierto${dia}`).checked;
    document.getElementById(`horarioApertura${dia}`).disabled = !abierto;
    document.getElementById(`horarioCierre${dia}`).disabled = !abierto;
  },

  async guardarHorarioDia(dia) {
    const abierto = document.getElementById(`horarioAbierto${dia}`).checked;
    const hora_apertura = document.getElementById(`horarioApertura${dia}`).value;
    const hora_cierre = document.getElementById(`horarioCierre${dia}`).value;

    if (abierto && (!hora_apertura || !hora_cierre)) {
      this.toast('Indique hora de apertura y de cierre.', 'warning');
      return;
    }

    try {
      await ApiCliente.put(`/api/horario-atencion/${dia}`, { abierto, hora_apertura, hora_cierre });
      this.toast('Horario de atención actualizado.', 'success');
      await this.loadHorarioAtencion();
    } catch (err) {
      this.toast(err.message || 'Error al actualizar el horario.', 'error');
    }
  },

  /** Muestra el horario de atención del día elegido en el modal de Agendar Cita. */
  actualizarInfoHorarioCita() {
    const info = document.getElementById('citaHorarioInfo');
    if (!info) return;
    const fecha = document.getElementById('citaFechaInput').value;
    if (!fecha || !this.horarioAtencion) { info.textContent = ''; return; }

    const NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const diaSemana = new Date(`${fecha}T00:00:00`).getDay();
    const h = this.horarioAtencion.find(x => x.dia_semana === diaSemana);

    info.textContent = (h && h.abierto)
      ? `Horario de atención los ${NOMBRES[diaSemana]}: ${h.hora_apertura.substring(0, 5)} a ${h.hora_cierre.substring(0, 5)}.`
      : `No hay atención los ${NOMBRES[diaSemana]}. Elija otra fecha.`;
  },

  // ===========================================================================
  // CATÁLOGO DE TIPOS DE VEHÍCULO (usado en Servicios, Vehículos y el POS)
  // ===========================================================================
  async loadTiposVehiculo() {
    try {
      this.tiposVehiculo = await ApiCliente.get('/api/tipos-vehiculo');
      const activos = this.tiposVehiculo.filter(t => t.estado === 'activo');
      const opciones = activos.map(t => `<option value="${t.nombre}">${t.nombre[0].toUpperCase() + t.nombre.slice(1)}</option>`).join('');

      const elServ = document.getElementById('servTipoVehiculo');
      if (elServ) elServ.innerHTML = `<option value="">Todos los tipos</option>${opciones}`;

      ['posAnonTipo', 'newClientTipo', 'turnoTipo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = opciones;
      });

      const elPills = document.getElementById('tiposVehiculoPillList');
      if (elPills) {
        elPills.innerHTML = this.tiposVehiculo.map(t => `
          <div class="washer-pill ${t.estado === 'inactivo' ? 'disabled' : ''}">
            <span>${t.nombre[0].toUpperCase() + t.nombre.slice(1)}</span>
            <button class="btn btn-sm btn-outline admin-only" style="margin-left: 8px" onclick="app.toggleEstadoTipoVehiculo(${t.id}, '${t.estado}')">${t.estado === 'activo' ? 'Inactivar' : 'Activar'}</button>
          </div>
        `).join('');
        this.updateRolePermissions();
      }
    } catch (err) { console.error(err); }
  },

  abrirModalNuevoTipoVehiculo() {
    document.getElementById('nuevoTipoVehiculoNombre').value = '';
    this.openModal('modalNuevoTipoVehiculo');
  },

  async guardarNuevoTipoVehiculo() {
    const nombre = document.getElementById('nuevoTipoVehiculoNombre').value.trim();
    if (!nombre) { this.toast('El nombre es obligatorio.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/tipos-vehiculo', { nombre });
      this.toast(`Tipo de vehículo "${nombre}" creado.`, 'success');
      this.closeModal('modalNuevoTipoVehiculo');
      await this.loadTiposVehiculo();
    } catch (err) {
      this.toast(err.message || 'Error al crear el tipo de vehículo.', 'error');
    }
  },

  async toggleEstadoTipoVehiculo(id, estadoActual) {
    const nuevoEstado = estadoActual === 'activo' ? 'inactivo' : 'activo';
    try {
      await ApiCliente.put(`/api/tipos-vehiculo/${id}`, { estado: nuevoEstado });
      this.toast(`Tipo de vehículo ${nuevoEstado === 'activo' ? 'activado' : 'inactivado'}.`, 'success');
      await this.loadTiposVehiculo();
    } catch (err) {
      this.toast(err.message || 'Error al actualizar el tipo de vehículo.', 'error');
    }
  },

  // ===========================================================================
  // MI PERFIL (ver datos propios) Y AUTOEDICIÓN
  // ===========================================================================
  async abrirMiPerfil() {
    try {
      const perfil = await ApiCliente.get('/api/personal/mi-perfil');
      document.getElementById('miPerfilNombre').textContent = perfil.nombre;
      document.getElementById('miPerfilRol').textContent = perfil.es_admin_principal ? 'ADMINISTRADOR PRINCIPAL' : perfil.rol.toUpperCase();
      document.getElementById('miPerfilUsername').textContent = perfil.username;
      document.getElementById('miPerfilDocumento').textContent = perfil.documento;
      document.getElementById('miPerfilIngreso').textContent = perfil.fecha_ingreso;
      document.getElementById('miPerfilSalario').textContent = this.formatMoney(perfil.salario_fijo);
      document.getElementById('miPerfilPeriodicidad').textContent = (perfil.periodicidad_pago || '').toUpperCase();
      this.openModal('modalMiPerfil');
    } catch (err) {
      this.toast('No se pudo cargar tu perfil.', 'error');
    }
  },

  /** Solo administrador: abre el formulario para editar sus propios datos. */
  async abrirEditarPerfil() {
    this.closeModal('modalMiPerfil');
    try {
      const perfil = await ApiCliente.get('/api/personal/mi-perfil');
      document.getElementById('editPerfilNombre').value = perfil.nombre;
      document.getElementById('editPerfilTelefono').value = perfil.telefono || '';
      document.getElementById('editPerfilCorreo').value = perfil.correo || '';
      document.getElementById('editPerfilUsername').value = perfil.username;
      this.openModal('modalEditarPerfil');
    } catch (err) {
      this.toast('No se pudo cargar tu perfil.', 'error');
    }
  },

  async guardarEdicionPerfil() {
    const nombre = document.getElementById('editPerfilNombre').value;
    const telefono = document.getElementById('editPerfilTelefono').value;
    const correo = document.getElementById('editPerfilCorreo').value;
    const username = document.getElementById('editPerfilUsername').value;

    if (!nombre || !username) { this.toast('Nombre y usuario son obligatorios.', 'warning'); return; }

    try {
      const actualizado = await ApiCliente.put('/api/personal/mi-perfil', { nombre, telefono, correo, username });
      this.toast('Tus datos se actualizaron correctamente.', 'success');
      this.closeModal('modalEditarPerfil');

      // Refresca el nombre visible en la sesión local (usado en la barra superior).
      this.currentUser.nombre = actualizado.nombre;
      ApiCliente.guardarSesion(ApiCliente.obtenerToken(), this.currentUser);
      this.pintarBarraSesion();
    } catch (err) {
      this.toast(err.message || 'No se pudo actualizar tu perfil.', 'error');
    }
  },

  // ===========================================================================
  // TOAST NOTIFICATIONS & MODALS
  // ===========================================================================
  toast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  },

  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('hidden');
  },

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
  },

  formatMoney(num) {
    return '$' + Number(num || 0).toLocaleString('es-CO');
  },

  /** Badge de los 3 estados de asistencia del día (solo 'presente' habilita asignar servicio). */
  etiquetaAsistencia(estado) {
    const MAPA = {
      presente: { color: '#10b981', texto: 'PRESENTE' },
      finalizado: { color: '#64748b', texto: 'FINALIZADO' },
      inasistencia: { color: '#ef4444', texto: 'INASISTENCIA' },
      sin_asistencia: { color: '#f59e0b', texto: 'SIN ASISTENCIA' }
    };
    const e = MAPA[estado] || MAPA.sin_asistencia;
    return `<span class="role-badge" style="background: ${e.color}">${e.texto}</span>`;
  },

  // ===========================================================================
  // 1. MÓDULO POS (CU01, CU02, CU07, CU08)
  // ===========================================================================
  async loadServices() {
    try {
      this.services = await ApiCliente.get('/api/servicios?activos=true');
      this.renderPosServices();

      ['citaServicioSelect', 'turnoServicioSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.innerHTML = this.services.map(s => `
            <option value="${s.id}">${s.nombre} (${s.tipo_vehiculo || 'Todos'}) - ${this.formatMoney(s.precio)}</option>
          `).join('');
        }
      });
    } catch (err) { console.error(err); }
  },

  renderPosServices() {
    const grid = document.getElementById('posServicesGrid');
    if (!grid) return;

    const isAnon = document.querySelector('input[name="posClientType"]:checked').value === 'anonimo';
    const anonTipo = document.getElementById('posAnonTipo') ? document.getElementById('posAnonTipo').value : 'carro';

    let filtrados = (this.services || []).filter(s => s.activo);
    if (isAnon) {
      filtrados = filtrados.filter(s => !s.tipo_vehiculo || s.tipo_vehiculo === anonTipo);
    }

    grid.innerHTML = filtrados.map(s => `
      <div class="service-card ${this.selectedServiceId === s.id ? 'selected' : ''}" onclick="app.selectService(${s.id})">
        <span class="service-card-tag">${s.tipo_vehiculo || 'Todos'}</span>
        <div class="service-card-name">${s.nombre}</div>
        <div class="service-card-desc">${s.descripcion || 'Sin descripción'}</div>
        <div class="service-card-footer">
          <span class="service-card-price">${this.formatMoney(s.precio)}</span>
          <span class="service-card-time">${s.duracion_estimada_min} min</span>
        </div>
      </div>
    `).join('');

    if (this.selectedServiceId && !filtrados.some(s => s.id === this.selectedServiceId)) {
      this.selectedServiceId = null;
    }
    this.updatePosTotal();
  },

  selectService(id) {
    this.selectedServiceId = id;
    this.renderPosServices();
  },

  updatePosTotal() {
    const s = this.services ? this.services.find(item => item.id === this.selectedServiceId) : null;
    const totalEl = document.getElementById('posTotalDisplay');
    if (totalEl) totalEl.textContent = s ? this.formatMoney(s.precio) : '$0';
  },

  filterServicesByVehicleType() {
    this.renderPosServices();
  },

  toggleClientMode() {
    const mode = document.querySelector('input[name="posClientType"]:checked').value;
    const regFields = document.getElementById('posRegisteredFields');
    const anonFields = document.getElementById('posAnonymousFields');
    if (mode === 'anonimo') {
      regFields.classList.add('hidden');
      anonFields.classList.remove('hidden');
    } else {
      regFields.classList.remove('hidden');
      anonFields.classList.add('hidden');
    }
    this.renderPosServices();
  },

  async loadClients() {
    try {
      this.clients = await ApiCliente.get('/api/clientes');
      ['posClienteSelect', 'citaClienteSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const defaultOpt = id === 'citaClienteSelect' ? '<option value="">-- Cita Anónima / Ocasional --</option>' : '<option value="">-- Seleccione un cliente --</option>';
          el.innerHTML = defaultOpt + this.clients.map(c => `<option value="${c.id}">${c.nombre} (${c.telefono})</option>`).join('');
        }
      });
    } catch (err) { console.error(err); }
  },

  onPosClienteChange() {
    const cid = parseInt(document.getElementById('posClienteSelect').value);
    const vSelect = document.getElementById('posVehiculoSelect');
    vSelect.innerHTML = '<option value="">-- Seleccione el vehículo --</option>';
    if (!cid) return;
    const c = this.clients.find(item => item.id === cid);
    if (c && c.vehiculos) {
      vSelect.innerHTML = c.vehiculos.map(v => `<option value="${v.id}" data-tipo="${v.tipo}">${v.placa} - ${v.marca} (${v.color})</option>`).join('');
    }
  },

  async buscarPorPlaca() {
    const placaInput = document.getElementById('posPlacaInput');
    const placa = (placaInput.value || '').trim();
    if (!placa) { this.toast('Ingrese una placa para consultar.', 'warning'); return; }

    try {
      const data = await ApiCliente.get(`/api/clientes/vehiculos/buscar?placa=${encodeURIComponent(placa)}`);
      const banner = document.getElementById('plateSearchResult');
      banner.classList.remove('hidden');

      if (data.encontrado) {
        banner.innerHTML = `
          <strong>Vehículo Encontrado:</strong> ${data.vehiculo.placa} (${data.vehiculo.marca} - ${data.vehiculo.color})<br>
          <strong>Propietario:</strong> ${data.cliente ? data.cliente.nombre : 'Sin propietario registrado'}<br>
          <strong>Historial:</strong> ${data.historial.length} servicios anteriores realizados.
        `;
        if (data.cliente) {
          document.querySelector('input[name="posClientType"][value="registrado"]').checked = true;
          this.toggleClientMode();
          document.getElementById('posClienteSelect').value = data.cliente.id;
          this.onPosClienteChange();
          setTimeout(() => { document.getElementById('posVehiculoSelect').value = data.vehiculo.id; }, 100);
        }
      } else {
        banner.innerHTML = `
          <strong>Placa no registrada:</strong> "${placa}" es nueva.<br>
          Puede registrar al cliente con el botón <em>+ Nuevo Cliente</em> o realizar una <em>Venta Rápida / Anónima</em>.
        `;
        document.getElementById('posAnonPlaca').value = placa;
      }
    } catch (err) {
      this.toast('Error al buscar vehículo.', 'error');
    }
  },

  async loadWashers() {
    try {
      this.washers = await ApiCliente.get('/api/personal/lavadores?activos=true');

      const entregaSelect = document.getElementById('entregaLavadorSelect');
      if (entregaSelect) {
        entregaSelect.innerHTML = this.washers.map(w => `<option value="${w.id}">${w.nombre}</option>`).join('');
      }
    } catch (err) { console.error(err); }
  },

  /**
   * El panel de POS ya no crea la orden directo: genera un turno en la fila
   * de espera, igual que "+ Turno Rápido" pero con selección de cliente
   * registrado / vehículo. El lavador se elige después, al presionar
   * "Iniciar" desde la fila (ver abrirModalAsignarLavador).
   */
  async agregarTurnoPos() {
    if (!this.selectedServiceId) { this.toast('Por favor seleccione un servicio de lavado para continuar.', 'warning'); return; }

    const mode = document.querySelector('input[name="posClientType"]:checked').value;
    let cliente_id = null, vehiculo_id = null, placa_temporal = '', tipo_vehiculo = 'carro';

    if (mode === 'registrado') {
      cliente_id = document.getElementById('posClienteSelect').value;
      vehiculo_id = document.getElementById('posVehiculoSelect').value;
      if (!cliente_id) { this.toast('Seleccione un cliente registrado o elija Venta Rápida / Anónima.', 'warning'); return; }
      const vSelect = document.getElementById('posVehiculoSelect');
      tipo_vehiculo = vSelect.selectedOptions[0] ? (vSelect.selectedOptions[0].dataset.tipo || 'carro') : 'carro';
    } else {
      placa_temporal = document.getElementById('posAnonPlaca').value;
      tipo_vehiculo = document.getElementById('posAnonTipo').value;
    }

    const payload = { cliente_id, vehiculo_id, servicio_id: this.selectedServiceId, placa_temporal, tipo_vehiculo };

    try {
      await ApiCliente.post('/api/turnos', payload);
      this.toast('Turno agregado a la fila.', 'success');
      this.selectedServiceId = null;
      this.renderPosServices();
      this.loadTurnos();
    } catch (err) {
      this.toast(err.message || 'Error al agregar a la fila.', 'error');
    }
  },

  async loadTurnos() {
    try {
      const turnos = await ApiCliente.get('/api/turnos');
      const list = document.getElementById('turnosQueueList');
      if (!list) return;

      const enEspera = turnos.filter(t => t.estado === 'en_espera');
      if (enEspera.length === 0) {
        list.innerHTML = `<p class="text-muted text-sm text-center py-3">No hay vehículos en espera de turno en este momento.</p>`;
        return;
      }

      list.innerHTML = enEspera.map((t, idx) => `
        <div class="queue-item">
          <div class="queue-item-info">
            <strong>#${t.numero_turno || (idx + 1)} Turno - ${t.placa || 'Sin Placa'} (${t.tipo_vehiculo})</strong>
            <span>${t.servicio_nombre} • Hora: ${t.hora_llegada} • ${this.formatMoney(t.servicio_precio)}</span>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-primary" onclick="app.atenderTurno(${t.id}, ${t.servicio_id}, '${t.placa}', '${t.tipo_vehiculo}', ${t.cliente_id || 'null'}, ${t.vehiculo_id || 'null'})">Iniciar</button>
            <button class="btn btn-sm btn-danger" onclick="app.cancelarTurno(${t.id})">Cancelar</button>
          </div>
        </div>
      `).join('');
    } catch (err) { console.error(err); }
  },

  async cancelarTurno(turnoId) {
    if (!confirm('¿Cancelar este turno? El vehículo se retirará de la fila de espera sin generar ningún servicio.')) return;
    try {
      await ApiCliente.post(`/api/turnos/${turnoId}/cancelar`, {});
      this.toast('Turno cancelado.', 'info');
      this.loadTurnos();
    } catch (err) {
      this.toast(err.message || 'No se pudo cancelar el turno.', 'error');
    }
  },

  atenderTurno(turnoId, servicioId, placa, tipo, clienteId, vehiculoId) {
    const payload = clienteId
      ? { turno_id: turnoId, servicio_id: servicioId, cliente_id: clienteId, vehiculo_id: vehiculoId }
      : { turno_id: turnoId, servicio_id: servicioId, es_venta_anonima: true, placa_anonima: placa, tipo_vehiculo_anonimo: tipo };
    this.abrirModalAsignarLavador(
      payload,
      () => { this.loadTurnos(); this.loadOrders(); this.setTab('tablero'); }
    );
  },

  abrirModalNuevoTurno() {
    document.getElementById('turnoPlaca').value = '';
    document.getElementById('turnoTipo').value = 'carro';
    this.openModal('modalNuevoTurno');
  },

  async guardarNuevoTurno() {
    const placa = document.getElementById('turnoPlaca').value;
    const tipo = document.getElementById('turnoTipo').value;
    const servicio_id = document.getElementById('turnoServicioSelect').value;
    try {
      await ApiCliente.post('/api/turnos', { placa_temporal: placa, tipo_vehiculo: tipo, servicio_id });
      this.toast('Turno registrado con éxito.', 'success');
      this.closeModal('modalNuevoTurno');
      this.loadTurnos();
    } catch (err) {
      this.toast(err.message || 'Error al registrar turno.', 'error');
    }
  },

  // ===========================================================================
  // 2. TABLERO KANBAN OPERATIVO (CU08, CU09, CU10)
  // ===========================================================================
  async loadOrders() {
    try {
      const orders = await ApiCliente.get('/api/ordenes');
      this.orders = orders;

      const activas = orders.filter(o => o.estado === 'recibido' || o.estado === 'en_proceso');
      document.getElementById('activeOrdersCount').textContent = activas.length;

      const cols = {
        recibido: document.getElementById('cardsRecibido'),
        en_proceso: document.getElementById('cardsProceso'),
        terminado: document.getElementById('cardsTerminado'),
        entregado: document.getElementById('cardsEntregado')
      };
      const counts = { recibido: 0, en_proceso: 0, terminado: 0, entregado: 0 };
      Object.values(cols).forEach(el => el.innerHTML = '');

      orders.forEach(o => {
        if (cols[o.estado]) {
          counts[o.estado]++;
          const card = document.createElement('div');
          card.className = 'order-card';
          card.innerHTML = this.renderOrderCardHtml(o);
          cols[o.estado].appendChild(card);
        }
      });

      document.getElementById('countRecibido').textContent = counts.recibido;
      document.getElementById('countProceso').textContent = counts.en_proceso;
      document.getElementById('countTerminado').textContent = counts.terminado;
      document.getElementById('countEntregado').textContent = counts.entregado;
    } catch (err) { console.error(err); }
  },

  renderOrderCardHtml(o) {
    const lavadoresNombres = (o.lavadores || []).map(l => l.nombre.split(' ')[0]).join(', ') || 'Sin asignar';
    const puedeAgregarServicio = o.estado === 'recibido' || o.estado === 'en_proceso';
    const puedeCancelar = ['recibido', 'en_proceso', 'terminado'].includes(o.estado);
    let actionButtons = '';

    if (o.estado === 'recibido') {
      // Una orden en "Recibido" siempre llega sin lavador (si tuviera uno,
      // ya estaría en "En Proceso"): no hay botón para saltar de estado sin
      // asignar uno primero. Asignar lavador ya la mueve a "En Proceso".
      actionButtons = `<button class="btn btn-sm btn-primary" style="width: 100%" onclick="app.abrirModalAsignarLavadorParaOrden(${o.id})">Asignar Lavador</button>`;
    } else if (o.estado === 'en_proceso') {
      actionButtons = `<button class="btn btn-sm btn-success" style="width: 100%" onclick="app.updateOrderStatus(${o.id}, 'terminado')">Terminar Lavado</button>`;
    } else if (o.estado === 'terminado') {
      actionButtons = `<button class="btn btn-sm btn-primary" style="width: 100%" onclick="app.openPayModal(${o.id}, ${o.total})">Cobrar y Entregar Vehículo</button>`;
    } else if (o.estado === 'entregado') {
      const metodo = o.pago ? o.pago.metodo_pago.toUpperCase() : 'PAGADO';
      actionButtons = `<span class="text-sm text-success" style="font-weight: 700">Entregado • Pago: ${metodo}</span>`;
    }

    // Si al mismo vehículo se le agregaron más servicios en esta misma
    // visita (en vez de generarle un turno nuevo y duplicado), se listan
    // aquí debajo del servicio principal.
    const serviciosExtraHtml = (o.servicios_extra || []).length > 0
      ? `<div class="text-sm text-muted">+ ${o.servicios_extra.map(s => `${s.servicio_nombre} (${this.formatMoney(s.precio)})`).join(', ')}</div>`
      : '';

    return `
      <div class="order-card-header">
        <span class="order-id-badge">Orden #${o.id}</span>
        <span class="order-plate-tag">${o.placa || 'SIN PLACA'}</span>
      </div>
      <div class="order-service-title">${o.servicio_nombre}</div>
      ${serviciosExtraHtml}
      <div class="order-meta-info"><span>Cliente: ${o.cliente_nombre}</span> • <span>${this.formatMoney(o.total)}</span></div>
      <div class="order-washers-info">Lavador(es): <strong>${lavadoresNombres}</strong></div>
      <div class="order-actions">${actionButtons}</div>
      ${puedeAgregarServicio ? `<button class="btn btn-sm btn-outline mt-2" style="width: 100%" onclick="app.abrirModalServicioExtra(${o.id})">+ Servicio (mismo vehículo)</button>` : ''}
      ${puedeCancelar ? `<button class="btn btn-sm btn-danger mt-2" style="width: 100%" onclick="app.cancelarOrden(${o.id})">Cancelar Servicio</button>` : ''}
    `;
  },

  async cancelarOrden(ordenId) {
    if (!confirm(`¿Cancelar la orden #${ordenId}? Quedará registrada como cancelada (sin ningún valor) y no se cobrará.`)) return;
    try {
      await ApiCliente.put(`/api/ordenes/${ordenId}/estado`, { estado: 'cancelado' });
      this.toast(`Orden #${ordenId} cancelada.`, 'info');
      this.loadOrders();
    } catch (err) {
      this.toast(err.message || 'No se pudo cancelar la orden.', 'error');
    }
  },

  /**
   * Para cuando al mismo vehículo hay que hacerle otro servicio además del
   * que ya tiene en curso: en vez de generarle un turno/orden nuevo (que
   * quedaría duplicado y ya no se permite, ver AgendaControlador), se
   * agrega como servicio adicional a la MISMA orden.
   */
  abrirModalServicioExtra(ordenId) {
    this.agregandoServicioExtraOrdenId = ordenId;
    const select = document.getElementById('servicioExtraSelect');
    if (select) {
      select.innerHTML = (this.services || []).map(s => `<option value="${s.id}">${s.nombre} - ${this.formatMoney(s.precio)}</option>`).join('');
    }
    this.openModal('modalServicioExtra');
  },

  async confirmarServicioExtra() {
    const servicio_id = document.getElementById('servicioExtraSelect').value;
    if (!servicio_id) { this.toast('Seleccione un servicio.', 'warning'); return; }

    try {
      await ApiCliente.post(`/api/ordenes/${this.agregandoServicioExtraOrdenId}/servicios-extra`, { servicio_id });
      this.toast('Servicio adicional agregado a la orden.', 'success');
      this.closeModal('modalServicioExtra');
      this.loadOrders();
    } catch (err) {
      this.toast(err.message || 'No se pudo agregar el servicio.', 'error');
    }
  },

  async updateOrderStatus(orderId, nuevoEstado) {
    try {
      await ApiCliente.put(`/api/ordenes/${orderId}/estado`, { estado: nuevoEstado });
      if (nuevoEstado === 'terminado') {
        this.toast(`Orden #${orderId} terminada.`, 'success');
      } else {
        this.toast(`Orden #${orderId} actualizada a estado: ${nuevoEstado}`, 'info');
      }
      this.loadOrders();
    } catch (err) {
      this.toast(err.message || 'Error al actualizar estado de la orden.', 'error');
    }
  },

  openPayModal(orderId, total) {
    this.payingOrderId = orderId;
    this.payingOrderTotal = Number(total);
    document.getElementById('payModalOrdenId').textContent = `#${orderId}`;
    document.getElementById('payModalMonto').textContent = this.formatMoney(total);
    const descuentoInput = document.getElementById('payModalDescuento');
    if (descuentoInput) descuentoInput.value = '';
    this.actualizarTotalConDescuento();
    this.openModal('modalPagarOrden');
  },

  /** Recalcula el total a cobrar restando el descuento (lo asume el negocio; no toca la comisión del lavador, ya fijada al crear la orden). */
  actualizarTotalConDescuento() {
    const descuentoInput = document.getElementById('payModalDescuento');
    const descuento = descuentoInput ? (parseFloat(descuentoInput.value) || 0) : 0;
    const totalFinal = Math.max(0, (this.payingOrderTotal || 0) - descuento);
    const elFinal = document.getElementById('payModalTotalFinal');
    if (elFinal) elFinal.textContent = this.formatMoney(totalFinal);
  },

  async confirmarPagoOrden() {
    if (!this.payingOrderId) return;
    const metodo = document.querySelector('input[name="payMetodo"]:checked').value;
    const descuentoInput = document.getElementById('payModalDescuento');
    const descuento = descuentoInput ? (parseFloat(descuentoInput.value) || 0) : 0;
    if (descuento < 0 || descuento >= (this.payingOrderTotal || 0)) {
      this.toast('El descuento debe ser mayor o igual a $0 y menor al total de la orden.', 'warning');
      return;
    }
    try {
      const data = await ApiCliente.post('/api/caja/pagos', { orden_id: this.payingOrderId, metodo_pago: metodo, descuento });
      this.toast(`Pago registrado vía ${metodo.toUpperCase()}. Factura ${data.factura.numero_factura}.`, 'success');
      this.closeModal('modalPagarOrden');
      this.payingOrderId = null;
      this.loadOrders();
      this.loadCaja();
    } catch (err) {
      this.toast(err.message || 'Error al registrar el pago.', 'error');
    }
  },

  // ===========================================================================
  // 3. AGENDA DE CITAS (CU04, CU06)
  // ===========================================================================
  async loadCitas() {
    const fecha = document.getElementById('citasFechaFiltro').value;
    try {
      const citas = await ApiCliente.get(`/api/citas?fecha=${fecha}`);
      const tbody = document.getElementById('citasTableBody');
      if (!tbody) return;

      if (citas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No hay citas agendadas para esta fecha.</td></tr>`;
        return;
      }

      tbody.innerHTML = citas.map(c => `
        <tr>
          <td><strong>${c.hora}</strong></td>
          <td><span class="order-plate-tag">${c.placa}</span> (${c.tipo_vehiculo})</td>
          <td>${c.cliente_nombre}<br><span class="text-sm text-muted">${c.cliente_telefono}</span></td>
          <td>${c.servicio_nombre}</td>
          <td><strong>${this.formatMoney(c.servicio_precio)}</strong></td>
          <td><span class="role-badge" style="background: ${c.estado === 'agendada' ? '#0077b6' : (c.estado === 'atendida' ? '#10b981' : '#ef4444')}">${c.estado.toUpperCase()}</span></td>
          <td>
            ${c.estado === 'agendada' ? `
              <button class="btn btn-sm btn-primary" onclick="app.iniciarCita(${c.id}, ${c.servicio_id}, ${c.cliente_id}, ${c.vehiculo_id})">Atender</button>
              <button class="btn btn-sm btn-outline" onclick="app.agregarCitaAFila(${c.id}, ${c.servicio_id}, ${c.cliente_id}, ${c.vehiculo_id}, '${(c.placa || '').replace(/'/g, "\\'")}', '${c.tipo_vehiculo}')">Agregar a la Fila</button>
              <button class="btn btn-sm btn-danger" onclick="app.cancelarCita(${c.id})">Cancelar</button>
            ` : '<span class="text-muted text-sm">--</span>'}
          </td>
        </tr>
      `).join('');
    } catch (err) { console.error(err); }
  },

  onCitaClienteChange() {
    const cid = parseInt(document.getElementById('citaClienteSelect').value, 10);
    const anonFields = document.getElementById('citaCamposAnonimos');
    const vehFields = document.getElementById('citaCampoVehiculo');
    anonFields.classList.toggle('hidden', !!cid);
    vehFields.classList.toggle('hidden', !cid);

    const vSelect = document.getElementById('citaVehiculoSelect');
    vSelect.innerHTML = '<option value="">-- Seleccione el vehículo --</option>';
    if (!cid) return;
    const c = (this.clients || []).find(item => item.id === cid);
    if (c && c.vehiculos) {
      vSelect.innerHTML = c.vehiculos.map(v => `<option value="${v.id}">${v.placa} - ${v.marca} (${v.color})</option>`).join('');
    }
  },

  abrirModalNuevaCita() {
    document.getElementById('citaClienteSelect').value = '';
    document.getElementById('citaAnonNombre').value = '';
    document.getElementById('citaAnonPlaca').value = '';
    document.getElementById('citaServicioSelect').value = '';
    document.getElementById('citaFechaInput').value = '';
    document.getElementById('citaHoraInput').value = '';
    document.getElementById('citaHorarioInfo').textContent = '';
    this.onCitaClienteChange();
    this.openModal('modalNuevaCita');
  },

  async guardarNuevaCita() {
    const cliente_id = document.getElementById('citaClienteSelect').value || null;
    const vehiculo_id = cliente_id ? (document.getElementById('citaVehiculoSelect').value || null) : null;
    const cliente_nombre = document.getElementById('citaAnonNombre').value;
    const placa = document.getElementById('citaAnonPlaca').value;
    const servicio_id = document.getElementById('citaServicioSelect').value;
    const fecha = document.getElementById('citaFechaInput').value;
    const hora = document.getElementById('citaHoraInput').value;

    if (!servicio_id || !fecha || !hora) { this.toast('Complete el servicio, la fecha y la hora.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/citas', { cliente_id, vehiculo_id, cliente_nombre, placa, servicio_id, fecha, hora });
      this.toast('Cita agendada correctamente.', 'success');
      this.closeModal('modalNuevaCita');
      this.loadCitas();
    } catch (err) {
      this.toast(err.message || 'Horario no disponible.', 'error');
    }
  },

  iniciarCita(citaId, servicioId, clienteId, vehiculoId) {
    this.abrirModalAsignarLavador(
      { cita_id: citaId, servicio_id: servicioId, cliente_id: clienteId, vehiculo_id: vehiculoId },
      () => { this.loadCitas(); this.loadOrders(); this.setTab('tablero'); }
    );
  },

  /**
   * Para cuando hay mucha fila o no hay lavador disponible a la hora de la
   * cita: en vez de atenderla de inmediato, la pasa a la fila de turnos. El
   * número de turno se asigna automáticamente por orden de llegada (no es
   * manual). La cita queda vinculada al turno (cita_id) para que, cuando
   * ese turno se atienda, la cita quede marcada como atendida
   * automáticamente.
   */
  async agregarCitaAFila(citaId, servicioId, clienteId, vehiculoId, placa, tipo) {
    try {
      await ApiCliente.post('/api/turnos', {
        cliente_id: clienteId, vehiculo_id: vehiculoId, cita_id: citaId,
        placa_temporal: placa, tipo_vehiculo: tipo, servicio_id: servicioId
      });
      this.toast('Cita agregada a la fila de turnos.', 'success');
      this.loadCitas();
      this.loadTurnos();
    } catch (err) {
      this.toast(err.message || 'Error al agregar la cita a la fila.', 'error');
    }
  },

  async cancelarCita(citaId) {
    if (!confirm('¿Desea cancelar esta cita agendada?')) return;
    try {
      await ApiCliente.put(`/api/citas/${citaId}`, { estado: 'cancelada' });
      this.toast('Cita cancelada.', 'info');
      this.loadCitas();
    } catch (err) {
      this.toast('Error al cancelar cita.', 'error');
    }
  },

  /** Alerta única al abrir la app cada día: cuántas citas hay agendadas para hoy. */
  async mostrarAlertaCitasDelDia() {
    const hoy = fechaLocalHoy();
    const YA_MOSTRADA_KEY = 'carwash_alerta_citas_dia';
    try {
      if (localStorage.getItem(YA_MOSTRADA_KEY) === hoy) return;
    } catch (err) { /* localStorage no disponible: seguimos igual, solo no deduplicamos */ }

    try {
      const citas = await ApiCliente.get(`/api/citas?fecha=${hoy}`);
      const pendientes = citas.filter(c => c.estado === 'agendada' || c.estado === 'reprogramada');
      alert(pendientes.length > 0
        ? `Hoy tienes ${pendientes.length} cita(s) agendada(s).`
        : 'No hay citas agendadas para hoy.');
      try { localStorage.setItem(YA_MOSTRADA_KEY, hoy); } catch (err) { /* ignorar */ }
    } catch (err) { console.error(err); }
  },

  /** Recordatorios ya disparados hoy (para no repetir la misma alerta), persistidos por si se recarga la página. */
  obtenerRecordatoriosCitasDisparados() {
    try {
      const data = JSON.parse(localStorage.getItem('carwash_citas_recordatorios') || '{}');
      return new Set(data[fechaLocalHoy()] || []);
    } catch (err) {
      return new Set();
    }
  },

  guardarRecordatoriosCitasDisparados(set) {
    try {
      localStorage.setItem('carwash_citas_recordatorios', JSON.stringify({ [fechaLocalHoy()]: Array.from(set) }));
    } catch (err) { /* ignorar */ }
  },

  /**
   * Revisa las citas de hoy que todavía no han sido atendidas y lanza una
   * alerta a 1 hora, 30 minutos y 10 minutos antes de la hora agendada.
   * Se llama al iniciar la app y luego cada minuto mientras siga abierta.
   */
  async revisarRecordatoriosCitas() {
    const UMBRALES_MINUTOS = [60, 30, 10];
    try {
      const hoy = fechaLocalHoy();
      const citas = await ApiCliente.get(`/api/citas?fecha=${hoy}`);
      const pendientes = citas.filter(c => c.estado === 'agendada' || c.estado === 'reprogramada');
      if (pendientes.length === 0) return;

      const disparados = this.obtenerRecordatoriosCitasDisparados();
      const ahora = new Date();
      let huboNuevos = false;

      for (const c of pendientes) {
        const horaCita = new Date(`${c.fecha}T${c.hora}`);
        const minutosFaltantes = (horaCita - ahora) / 60000;
        if (minutosFaltantes < 0) continue; // ya pasó la hora, no seguimos avisando

        for (const umbral of UMBRALES_MINUTOS) {
          const clave = `${c.id}:${umbral}`;
          if (minutosFaltantes <= umbral && !disparados.has(clave)) {
            alert(`Recordatorio: la cita de ${c.cliente_nombre} (${c.placa}) es a las ${c.hora.substring(0, 5)} (en ${Math.max(0, Math.round(minutosFaltantes))} min) y todavía no ha sido atendida.`);
            disparados.add(clave);
            huboNuevos = true;
          }
        }
      }

      if (huboNuevos) this.guardarRecordatoriosCitasDisparados(disparados);
    } catch (err) { console.error(err); }
  },

  /** Igual que los recordatorios de citas, pero para el aviso de salida de empleados (ver abajo). */
  obtenerAlertasSalidaDisparadas() {
    try {
      const data = JSON.parse(localStorage.getItem('carwash_alertas_salida') || '{}');
      return new Set(data[fechaLocalHoy()] || []);
    } catch (err) {
      return new Set();
    }
  },

  guardarAlertasSalidaDisparadas(set) {
    try {
      localStorage.setItem('carwash_alertas_salida', JSON.stringify({ [fechaLocalHoy()]: Array.from(set) }));
    } catch (err) { /* ignorar */ }
  },

  /**
   * Avisa cuando a un empleado (con jornada fija, no lavador) le faltan
   * 15 minutos para completar su jornada de hoy, para que el administrador
   * no se olvide de marcarle la salida. La hora esperada de salida se
   * estima como hora_entrada + jornada_horas_dia del empleado.
   */
  async revisarAlertasSalidaProxima() {
    const UMBRAL_MINUTOS = 15;
    try {
      const hoy = fechaLocalHoy();
      const asistencias = await ApiCliente.get(`/api/nomina/asistencia?fecha=${hoy}`);
      const enTurno = asistencias.filter(a =>
        a.persona_tipo === 'usuario' && a.hora_entrada && !a.hora_salida && !a.inasistencia && a.jornada_horas_dia
      );
      if (enTurno.length === 0) return;

      const disparados = this.obtenerAlertasSalidaDisparadas();
      const ahora = new Date();
      let huboNuevos = false;

      for (const a of enTurno) {
        const horaSalidaEsperada = new Date(`${hoy}T${a.hora_entrada}`);
        horaSalidaEsperada.setMinutes(horaSalidaEsperada.getMinutes() + Math.round(a.jornada_horas_dia * 60));
        const minutosFaltantes = (horaSalidaEsperada - ahora) / 60000;
        if (minutosFaltantes < 0) continue; // ya se le pasó la hora, no seguimos avisando

        const clave = `${a.usuario_id}`;
        if (minutosFaltantes <= UMBRAL_MINUTOS && !disparados.has(clave)) {
          alert(`Aviso: a ${a.usuario_nombre} le faltan ${Math.max(0, Math.round(minutosFaltantes))} min para completar su jornada de hoy. Recuerda marcarle la salida.`);
          disparados.add(clave);
          huboNuevos = true;
        }
      }

      if (huboNuevos) this.guardarAlertasSalidaDisparadas(disparados);
    } catch (err) { console.error(err); }
  },

  /**
   * Modal compartido para atender una cita o un turno: al final los dos
   * casos crean una orden (POST /api/ordenes) igual que la venta directa
   * del POS, así que reutilizan la misma elección de lavador(es)
   * automática o manual (1 a 3).
   */
  async abrirModalAsignarLavador(payloadBase, onSuccess) {
    this.pendingOrdenPayload = payloadBase;
    this.pendingOrdenId = null;
    this.pendingOrdenOnSuccess = onSuccess;
    this.selectedWashersAsignacion = [];
    document.getElementById('asignLavAutoCheck').checked = true;
    document.getElementById('asignLavManualWrapper').classList.add('hidden');
    document.getElementById('asignLavAutoIndicator').classList.remove('hidden');
    await this.loadWashers(); // refresca disponible_hoy antes de mostrar el picker
    this.renderAsignLavPills();
    this.openModal('modalAsignarLavador');
  },

  /**
   * Igual que abrirModalAsignarLavador, pero para asignar un lavador a una
   * orden que ya existe y está en "Recibido" (sin lavador todavía), en vez
   * de crear una orden nueva. Al confirmar, la orden pasa automáticamente
   * a "En Proceso" (RF10): sin lavador no puede avanzar de estado.
   */
  async abrirModalAsignarLavadorParaOrden(ordenId) {
    this.pendingOrdenPayload = null;
    this.pendingOrdenId = ordenId;
    this.pendingOrdenOnSuccess = () => this.loadOrders();
    this.selectedWashersAsignacion = [];
    document.getElementById('asignLavAutoCheck').checked = true;
    document.getElementById('asignLavManualWrapper').classList.add('hidden');
    document.getElementById('asignLavAutoIndicator').classList.remove('hidden');
    await this.loadWashers();
    this.renderAsignLavPills();
    this.openModal('modalAsignarLavador');
  },

  toggleAsignLavAuto() {
    const isAuto = document.getElementById('asignLavAutoCheck').checked;
    const manualWrap = document.getElementById('asignLavManualWrapper');
    const autoInd = document.getElementById('asignLavAutoIndicator');
    if (isAuto) {
      manualWrap.classList.add('hidden');
      autoInd.classList.remove('hidden');
      this.selectedWashersAsignacion = [];
    } else {
      manualWrap.classList.remove('hidden');
      autoInd.classList.add('hidden');
      this.renderAsignLavPills();
    }
  },

  renderAsignLavPills() {
    const list = document.getElementById('asignLavPillsList');
    if (!list) return;
    const ETIQUETA_MOTIVO = { finalizado: 'jornada finalizada', inasistencia: 'inasistencia hoy', sin_asistencia: 'sin entrada hoy' };
    list.innerHTML = (this.washers || []).map(w => {
      const selected = this.selectedWashersAsignacion.includes(w.id);
      const disponible = !!w.disponible_hoy;
      const motivo = ETIQUETA_MOTIVO[w.estado_asistencia_hoy] || 'sin entrada hoy';
      const clases = ['washer-pill'];
      if (selected) clases.push('selected');
      if (!disponible) clases.push('disabled');
      return `
        <div class="${clases.join(' ')}" onclick="app.toggleAsignLavSelection(${w.id}, ${disponible})" title="${disponible ? '' : motivo}">
          <span class="washer-status-dot"></span>
          <span>${w.nombre.split(' ')[0]} (${w.porcentaje_comision}%)${disponible ? '' : ` — ${motivo}`}</span>
        </div>
      `;
    }).join('');
  },

  toggleAsignLavSelection(id, disponible) {
    if (!disponible) { this.toast('Este lavador no ha registrado entrada hoy y no puede ser asignado.', 'warning'); return; }
    if (this.selectedWashersAsignacion.includes(id)) {
      this.selectedWashersAsignacion = this.selectedWashersAsignacion.filter(wid => wid !== id);
    } else {
      if (this.selectedWashersAsignacion.length >= 3) { this.toast('Máximo 3 lavadores por servicio.', 'warning'); return; }
      this.selectedWashersAsignacion.push(id);
    }
    this.renderAsignLavPills();
  },

  async confirmarAsignacionLavador() {
    const isAuto = document.getElementById('asignLavAutoCheck').checked;
    const lavadores_ids = isAuto ? [] : this.selectedWashersAsignacion;

    try {
      if (this.pendingOrdenId) {
        await ApiCliente.post(`/api/ordenes/${this.pendingOrdenId}/asignar-lavadores`, { lavadores_ids });
        this.toast('Lavador asignado: la orden pasó a En Proceso.', 'success');
      } else {
        const payload = { ...this.pendingOrdenPayload, lavadores_ids };
        await ApiCliente.post('/api/ordenes', payload);
        this.toast('Orden de servicio iniciada con éxito.', 'success');
      }
      this.closeModal('modalAsignarLavador');
      if (this.pendingOrdenOnSuccess) this.pendingOrdenOnSuccess();
      this.pendingOrdenPayload = null;
      this.pendingOrdenId = null;
      this.pendingOrdenOnSuccess = null;
    } catch (err) {
      this.toast(err.message || 'Error al asignar lavador.', 'error');
    }
  },

  // ===========================================================================
  // 4. INVENTARIO PERPETUO (CU13, CU14, CU15, CU28)
  // ===========================================================================
  async loadInsumos() {
    try {
      const [insumos, alertas, movimientos, entregas, proveedores] = await Promise.all([
        ApiCliente.get('/api/inventario/insumos'),
        ApiCliente.get('/api/inventario/alertas'),
        ApiCliente.get('/api/inventario/movimientos'),
        ApiCliente.get('/api/inventario/entregas'),
        ApiCliente.get('/api/inventario/proveedores')
      ]);

      this.insumos = insumos;
      this.proveedores = proveedores;
      document.getElementById('stockAlertCount').textContent = alertas.length;

      const banner = document.getElementById('bannerStockCritico');
      if (alertas.length > 0) {
        banner.classList.remove('hidden');
        document.getElementById('bannerStockCriticoTexto').textContent =
          `Atención: ${alertas.map(a => `${a.nombre} (${a.stock_actual} / mín ${a.stock_minimo} ${a.unidad_medida})`).join(', ')}`;
      } else {
        banner.classList.add('hidden');
      }

      const grid = document.getElementById('insumosCardsGrid');
      if (grid) {
        grid.innerHTML = insumos.map(i => {
          const ratio = Math.min(100, (i.stock_actual / (i.stock_minimo * 2 || 1)) * 100);
          const isLow = i.bajo_stock;
          const isInactivo = i.estado === 'inactivo';
          return `
            <div class="insumo-card ${isLow ? 'critical' : ''}" style="${isInactivo ? 'opacity: 0.6' : ''}">
              <div class="insumo-header">
                <span class="insumo-name">${i.nombre}</span>
                <span class="role-badge" style="background: ${isInactivo ? '#64748b' : (isLow ? '#ef4444' : '#10b981')}">${isInactivo ? 'INACTIVO' : (isLow ? 'BAJO STOCK' : 'EN ORDEN')}</span>
              </div>
              <div class="insumo-stock-val">${Number(i.stock_actual).toLocaleString()} <span class="insumo-unit">${i.unidad_medida}</span></div>
              <div class="text-sm text-muted">Stock Mínimo: ${i.stock_minimo} ${i.unidad_medida}</div>
              <div class="stock-meter"><div class="stock-meter-fill ${isLow ? 'low' : 'normal'}" style="width: ${ratio}%"></div></div>
              <div class="text-sm text-dim">Proveedor: ${i.proveedor_nombre || 'Sin proveedor'}</div>
              <div class="text-sm text-dim">Último costo: ${this.formatMoney(i.costo_unitario)} / ${i.unidad_medida}</div>
              <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-outline admin-only" style="flex: 1" onclick="app.abrirModalEditarInsumo(${i.id})">Editar</button>
                <button class="btn btn-sm btn-outline admin-only" style="flex: 1" onclick="app.toggleEstadoInsumo(${i.id}, '${i.estado}', '${i.nombre.replace(/'/g, "\\'")}')">${isInactivo ? 'Activar' : 'Inactivar'}</button>
              </div>
            </div>
          `;
        }).join('');
      }

      const insumosActivos = insumos.filter(i => i.estado === 'activo');
      ['entradaInsumoSelect', 'entregaInsumoSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = insumosActivos.map(i => `<option value="${i.id}">${i.nombre} (Stock actual: ${i.stock_actual} ${i.unidad_medida})</option>`).join('');
      });

      const proveedoresActivos = proveedores.filter(p => p.estado === 'activo');
      const opcionesProveedor = proveedoresActivos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
      const elEntradaProv = document.getElementById('entradaProveedorSelect');
      if (elEntradaProv) elEntradaProv.innerHTML = `<option value="">-- Selecciona un proveedor --</option>${opcionesProveedor}`;
      const elEditProv = document.getElementById('editInsProveedorSelect');
      if (elEditProv) elEditProv.innerHTML = opcionesProveedor;

      const tbProv = document.getElementById('proveedoresTableBody');
      if (tbProv) {
        tbProv.innerHTML = proveedores.map(p => `
          <tr>
            <td><strong>${p.nombre}</strong></td>
            <td>${p.contacto || '-'}</td>
            <td>${p.telefono || '-'}</td>
            <td>${p.correo || '-'}</td>
            <td><span class="role-badge" style="background: ${p.estado === 'activo' ? '#10b981' : '#64748b'}">${p.estado.toUpperCase()}</span></td>
            <td class="admin-only">
              <button class="btn btn-sm btn-outline" onclick="app.abrirModalEditarProveedor(${p.id})">Editar</button>
              <button class="btn btn-sm btn-outline" onclick="app.toggleEstadoProveedor(${p.id}, '${p.estado}', '${p.nombre.replace(/'/g, "\\'")}')">${p.estado === 'activo' ? 'Inactivar' : 'Activar'}</button>
            </td>
          </tr>
        `).join('');
      }

      const tbMov = document.getElementById('movimientosTableBody');
      if (tbMov) {
        tbMov.innerHTML = movimientos.slice(0, 10).map(m => `
          <tr>
            <td>${m.fecha.substring(5, 16)}</td>
            <td><strong>${m.insumo_nombre}</strong></td>
            <td><span class="role-badge" style="background: ${m.tipo === 'entrada' ? '#10b981' : '#f59e0b'}">${m.tipo.toUpperCase()}</span></td>
            <td>${m.cantidad} ${m.unidad_medida}</td>
            <td class="text-sm text-muted">${m.observacion || m.usuario_nombre}</td>
          </tr>
        `).join('');
      }

      const tbEnt = document.getElementById('entregasTableBody');
      if (tbEnt) {
        tbEnt.innerHTML = entregas.slice(0, 10).map(e => `
          <tr>
            <td>${e.fecha_entrega.substring(5, 16)}</td>
            <td><strong>${e.lavador_nombre}</strong></td>
            <td>${e.insumo_nombre}</td>
            <td>${e.cantidad} ${e.unidad_medida}</td>
            <td><span class="role-badge" style="background: #10b981">${e.estado.toUpperCase()}</span></td>
          </tr>
        `).join('');
      }

      this.updateRolePermissions();
    } catch (err) { console.error(err); }
  },

  abrirModalEntradaInsumo() {
    document.getElementById('entradaCantidad').value = '';
    document.getElementById('entradaCostoUnitario').value = '';
    document.getElementById('entradaObservacion').value = '';
    const elProv = document.getElementById('entradaProveedorSelect');
    if (elProv) elProv.value = '';
    const radioUnidad = document.querySelector('input[name="entradaModoPrecio"][value="unidad"]');
    if (radioUnidad) radioUnidad.checked = true;
    this.actualizarLabelPrecioEntrada();
    this.openModal('modalEntradaInsumo');
  },

  actualizarLabelPrecioEntrada() {
    const modo = document.querySelector('input[name="entradaModoPrecio"]:checked').value;
    const label = document.getElementById('entradaCostoLabel');
    const input = document.getElementById('entradaCostoUnitario');
    if (modo === 'total') {
      label.textContent = 'Precio Total de la Compra ($):';
      input.placeholder = 'Ej: 90000 por toda la compra';
    } else {
      label.textContent = 'Costo Unitario de esta Compra ($):';
      input.placeholder = 'Precio al que lo compré';
    }
  },

  prefillCostoEntrada() {
    const insumoId = parseInt(document.getElementById('entradaInsumoSelect').value, 10);
    const insumo = (this.insumos || []).find(i => i.id === insumoId);
    const radioUnidad = document.querySelector('input[name="entradaModoPrecio"][value="unidad"]');
    if (radioUnidad) radioUnidad.checked = true;
    this.actualizarLabelPrecioEntrada();
    document.getElementById('entradaCostoUnitario').value = insumo ? insumo.costo_unitario : '';
  },

  async guardarEntradaInsumo() {
    const insumo_id = document.getElementById('entradaInsumoSelect').value;
    const cantidad = document.getElementById('entradaCantidad').value;
    const precioIngresado = document.getElementById('entradaCostoUnitario').value;
    const modoPrecio = document.querySelector('input[name="entradaModoPrecio"]:checked').value;
    const proveedor_id = document.getElementById('entradaProveedorSelect').value;
    const observacion = document.getElementById('entradaObservacion').value;

    if (!cantidad || cantidad <= 0) { this.toast('Ingrese una cantidad válida mayor a cero.', 'warning'); return; }
    if (!proveedor_id) { this.toast('Debe seleccionar un proveedor para registrar la compra.', 'warning'); return; }

    let costo_unitario = precioIngresado;
    if (precioIngresado !== '' && modoPrecio === 'total') {
      costo_unitario = Number(precioIngresado) / Number(cantidad);
    }

    try {
      const data = await ApiCliente.post('/api/inventario/entradas', { insumo_id, cantidad, costo_unitario, proveedor_id, observacion });
      this.toast(`Entrada registrada. Factura ${data.factura.numero_factura}.`, 'success');
      this.closeModal('modalEntradaInsumo');
      this.loadInsumos();
    } catch (err) {
      this.toast(err.message || 'Error al registrar entrada de insumo.', 'error');
    }
  },

  abrirModalEntregaInsumo() {
    document.getElementById('entregaCantidad').value = '';
    this.openModal('modalEntregaInsumo');
  },

  async guardarEntregaInsumo() {
    const lavador_id = document.getElementById('entregaLavadorSelect').value;
    const insumo_id = document.getElementById('entregaInsumoSelect').value;
    const cantidad = document.getElementById('entregaCantidad').value;

    if (!cantidad || cantidad <= 0) { this.toast('Ingrese una cantidad válida.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/inventario/entregas', { lavador_id, insumo_id, cantidad });
      this.toast('Dotación entregada al lavador con éxito.', 'success');
      this.closeModal('modalEntregaInsumo');
      this.loadInsumos();
    } catch (err) {
      this.toast(err.message || 'Stock insuficiente.', 'error');
    }
  },

  abrirModalNuevoInsumo() {
    document.getElementById('newInsNombre').value = '';
    document.getElementById('newInsUnidad').value = 'ml';
    document.getElementById('newInsCosto').value = '';
    document.getElementById('newInsStockActual').value = '';
    document.getElementById('newInsStockMinimo').value = '';
    this.openModal('modalNuevoInsumo');
  },

  async guardarNuevoInsumo() {
    const nombre = document.getElementById('newInsNombre').value;
    const unidad_medida = document.getElementById('newInsUnidad').value;
    const costo_unitario = document.getElementById('newInsCosto').value;
    const stock_actual = document.getElementById('newInsStockActual').value;
    const stock_minimo = document.getElementById('newInsStockMinimo').value;

    if (!nombre) { this.toast('El nombre es obligatorio.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/inventario/insumos', { nombre, unidad_medida, costo_unitario, stock_actual, stock_minimo });
      this.toast('Nuevo insumo creado en el catálogo.', 'success');
      this.closeModal('modalNuevoInsumo');
      this.loadInsumos();
    } catch (err) {
      this.toast('Error al crear insumo.', 'error');
    }
  },

  abrirModalEditarInsumo(id) {
    const i = (this.insumos || []).find(item => item.id === id);
    if (!i) return;
    this.editingInsumoId = id;
    document.getElementById('editInsNombre').value = i.nombre;
    document.getElementById('editInsUnidad').value = i.unidad_medida;
    document.getElementById('editInsStockMinimo').value = i.stock_minimo;
    const provSelect = document.getElementById('editInsProveedorSelect');
    if (provSelect) provSelect.value = i.proveedor_id || '';
    this.openModal('modalEditarInsumo');
  },

  async guardarEdicionInsumo() {
    const nombre = document.getElementById('editInsNombre').value.trim();
    const unidad_medida = document.getElementById('editInsUnidad').value;
    const stock_minimo = document.getElementById('editInsStockMinimo').value;
    const proveedor_id = document.getElementById('editInsProveedorSelect').value;
    if (!nombre) { this.toast('El nombre es obligatorio.', 'warning'); return; }

    try {
      await ApiCliente.put(`/api/inventario/insumos/${this.editingInsumoId}`, { nombre, unidad_medida, stock_minimo, proveedor_id });
      this.toast('Insumo actualizado.', 'success');
      this.closeModal('modalEditarInsumo');
      this.loadInsumos();
    } catch (err) {
      this.toast(err.message || 'No se pudo actualizar el insumo.', 'error');
    }
  },

  /** Los insumos nunca se eliminan: solo se activan o inactivan. */
  async toggleEstadoInsumo(id, estadoActual, nombre) {
    const nuevoEstado = estadoActual === 'activo' ? 'inactivo' : 'activo';
    if (!confirm(`¿${nuevoEstado === 'activo' ? 'Activar' : 'Inactivar'} el insumo "${nombre}"?`)) return;
    try {
      await ApiCliente.put(`/api/inventario/insumos/${id}`, { estado: nuevoEstado });
      this.toast(`Insumo ${nuevoEstado === 'activo' ? 'activado' : 'inactivado'}.`, 'success');
      this.loadInsumos();
    } catch (err) {
      this.toast(err.message || 'No se pudo cambiar el estado.', 'error');
    }
  },

  // Los proveedores son globales (no pertenecen a un insumo en particular):
  // cualquier insumo puede comprarse a cualquier proveedor de esta lista.
  abrirModalNuevoProveedor(returnTo) {
    this.proveedorReturnTo = returnTo || null;
    ['newProvNombre', 'newProvContacto', 'newProvTelefono', 'newProvCorreo', 'newProvDireccion'].forEach(id => {
      document.getElementById(id).value = '';
    });
    this.openModal('modalNuevoProveedor');
  },

  cerrarModalNuevoProveedor() {
    this.closeModal('modalNuevoProveedor');
    this.proveedorReturnTo = null;
  },

  async guardarNuevoProveedor() {
    const nombre = document.getElementById('newProvNombre').value.trim();
    const contacto = document.getElementById('newProvContacto').value.trim();
    const telefono = document.getElementById('newProvTelefono').value.trim();
    const correo = document.getElementById('newProvCorreo').value.trim();
    const direccion = document.getElementById('newProvDireccion').value.trim();
    if (!nombre) { this.toast('El nombre del proveedor es obligatorio.', 'warning'); return; }

    try {
      const nuevo = await ApiCliente.post('/api/inventario/proveedores', { nombre, contacto, telefono, correo, direccion });
      this.toast('Proveedor creado.', 'success');
      this.closeModal('modalNuevoProveedor');
      await this.loadInsumos();
      if (this.proveedorReturnTo === 'entrada') {
        document.getElementById('entradaProveedorSelect').value = nuevo.id;
      } else if (this.proveedorReturnTo === 'editar') {
        document.getElementById('editInsProveedorSelect').value = nuevo.id;
      }
      this.proveedorReturnTo = null;
    } catch (err) {
      this.toast(err.message || 'No se pudo crear el proveedor.', 'error');
    }
  },

  abrirModalEditarProveedor(id) {
    const p = (this.proveedores || []).find(item => item.id === id);
    if (!p) return;
    this.editingProveedorId = id;
    document.getElementById('editProvNombre').value = p.nombre;
    document.getElementById('editProvContacto').value = p.contacto || '';
    document.getElementById('editProvTelefono').value = p.telefono || '';
    document.getElementById('editProvCorreo').value = p.correo || '';
    document.getElementById('editProvDireccion').value = p.direccion || '';
    this.openModal('modalEditarProveedor');
  },

  async guardarEdicionProveedor() {
    const nombre = document.getElementById('editProvNombre').value.trim();
    const contacto = document.getElementById('editProvContacto').value.trim();
    const telefono = document.getElementById('editProvTelefono').value.trim();
    const correo = document.getElementById('editProvCorreo').value.trim();
    const direccion = document.getElementById('editProvDireccion').value.trim();
    if (!nombre) { this.toast('El nombre es obligatorio.', 'warning'); return; }

    try {
      await ApiCliente.put(`/api/inventario/proveedores/${this.editingProveedorId}`, { nombre, contacto, telefono, correo, direccion });
      this.toast('Proveedor actualizado.', 'success');
      this.closeModal('modalEditarProveedor');
      this.loadInsumos();
    } catch (err) {
      this.toast(err.message || 'No se pudo actualizar el proveedor.', 'error');
    }
  },

  /** Los proveedores nunca se eliminan: solo se activan o inactivan. */
  async toggleEstadoProveedor(id, estadoActual, nombre) {
    const nuevoEstado = estadoActual === 'activo' ? 'inactivo' : 'activo';
    if (!confirm(`¿${nuevoEstado === 'activo' ? 'Activar' : 'Inactivar'} al proveedor "${nombre}"?`)) return;
    try {
      await ApiCliente.put(`/api/inventario/proveedores/${id}`, { estado: nuevoEstado });
      this.toast(`Proveedor ${nuevoEstado === 'activo' ? 'activado' : 'inactivado'}.`, 'success');
      this.loadInsumos();
    } catch (err) {
      this.toast(err.message || 'No se pudo cambiar el estado.', 'error');
    }
  },

  // ===========================================================================
  // 5. CATÁLOGO DE SERVICIOS (CU12 / RF16) — solo administrador
  // ===========================================================================
  async loadServicios() {
    try {
      this.servicios = await ApiCliente.get('/api/servicios');
      const tbody = document.getElementById('serviciosTableBody');
      if (!tbody) return;

      tbody.innerHTML = this.servicios.map(s => `
        <tr>
          <td><strong>${s.nombre}</strong>${s.descripcion ? `<br><span class="text-sm text-muted">${s.descripcion}</span>` : ''}</td>
          <td>${s.tipo_vehiculo || 'Todos'}</td>
          <td>${this.formatMoney(s.precio)}</td>
          <td>${s.duracion_estimada_min} min</td>
          <td><span class="role-badge" style="background: ${s.activo ? '#10b981' : '#ef4444'}">${s.activo ? 'ACTIVO' : 'INACTIVO'}</span></td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="app.abrirModalEditarServicio(${s.id})">Editar</button>
            <button class="btn btn-sm btn-secondary" onclick="app.toggleEstadoServicio(${s.id}, ${s.activo ? 1 : 0})">${s.activo ? 'Inactivar' : 'Activar'}</button>
          </td>
        </tr>
      `).join('');
    } catch (err) { console.error(err); }
  },

  abrirModalNuevoServicio() {
    this.editingServiceId = null;
    document.getElementById('modalServicioTitulo').textContent = 'Nuevo Servicio';
    document.getElementById('servNombre').value = '';
    document.getElementById('servTipoVehiculo').value = '';
    document.getElementById('servDuracion').value = 30;
    document.getElementById('servPrecio').value = 0;
    document.getElementById('servDescripcion').value = '';
    this.openModal('modalServicio');
  },

  abrirModalEditarServicio(id) {
    const s = (this.servicios || []).find(item => item.id === id);
    if (!s) return;
    this.editingServiceId = id;
    document.getElementById('modalServicioTitulo').textContent = `Editar Servicio: ${s.nombre}`;
    document.getElementById('servNombre').value = s.nombre;
    document.getElementById('servTipoVehiculo').value = s.tipo_vehiculo || '';
    document.getElementById('servDuracion').value = s.duracion_estimada_min;
    document.getElementById('servPrecio').value = s.precio;
    document.getElementById('servDescripcion').value = s.descripcion || '';
    this.openModal('modalServicio');
  },

  async guardarServicio() {
    const nombre = document.getElementById('servNombre').value;
    const tipo_vehiculo = document.getElementById('servTipoVehiculo').value;
    const duracion_estimada_min = document.getElementById('servDuracion').value;
    const precio = document.getElementById('servPrecio').value;
    const descripcion = document.getElementById('servDescripcion').value;

    if (!nombre || !precio) { this.toast('Nombre y precio son obligatorios.', 'warning'); return; }

    try {
      if (this.editingServiceId) {
        await ApiCliente.put(`/api/servicios/${this.editingServiceId}`, { nombre, tipo_vehiculo, duracion_estimada_min, precio, descripcion });
        this.toast('Servicio actualizado.', 'success');
      } else {
        await ApiCliente.post('/api/servicios', { nombre, tipo_vehiculo, duracion_estimada_min, precio, descripcion });
        this.toast('Servicio creado.', 'success');
      }
      this.closeModal('modalServicio');
      this.loadServicios();
      this.loadServices(); // refresca el catálogo que usa el POS
    } catch (err) {
      this.toast(err.message || 'Error al guardar el servicio.', 'error');
    }
  },

  /** Los servicios nunca se eliminan: solo se activan o inactivan. */
  async toggleEstadoServicio(id, activoActual) {
    try {
      await ApiCliente.put(`/api/servicios/${id}`, { activo: !activoActual });
      this.toast(`Servicio ${activoActual ? 'inactivado' : 'activado'}.`, 'success');
      this.loadServicios();
      this.loadServices();
    } catch (err) {
      this.toast('No se pudo cambiar el estado del servicio.', 'error');
    }
  },

  // ===========================================================================
  // 6. NÓMINA, LIQUIDACIONES Y ASISTENCIA (CU21-CU27)
  // ===========================================================================
  async loadNomina() {
    try {
      if (this.activeSubTabNomina === 'lavadores') {
        const [lavadores, liquidaciones] = await Promise.all([
          ApiCliente.get('/api/nomina/lavadores'),
          ApiCliente.get('/api/nomina/liquidaciones')
        ]);

        const grid = document.getElementById('lavadoresCardsGrid');
        if (grid) {
          grid.innerHTML = lavadores.map(w => `
            <div class="lavador-card">
              <div class="lavador-card-header">
                <span class="lavador-card-name">${w.nombre}</span>
                <span class="role-badge" style="background: ${w.estado === 'activo' ? '#10b981' : '#ef4444'}">${w.estado.toUpperCase()}</span>
              </div>
              <div class="text-sm text-muted">Doc: ${w.documento} • Tel: ${w.telefono}</div>
              <div class="text-sm text-muted">Comisión configurada: <strong>${w.porcentaje_comision}%</strong></div>
              <div class="text-sm mt-1">${this.etiquetaAsistencia(w.estado_asistencia_hoy)}</div>
              <div class="commission-highlight">
                <div>
                  <span class="text-sm text-muted" style="display: block">Por Cobrar (Pendiente):</span>
                  <span class="comm-amount">${this.formatMoney(w.comision_pendiente)}</span>
                </div>
                <div class="text-sm text-muted text-right">${w.servicios_realizados} lavados<br>Total Ganado: ${this.formatMoney(w.comision_historica_total)}</div>
              </div>
              <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-primary admin-only" style="flex: 1" onclick="app.abrirModalLiquidar(${w.lavador_id}, '${w.nombre}', ${w.comision_pendiente})">Liquidar Comisión</button>
                <button class="btn btn-sm btn-outline admin-only" onclick="app.abrirModalEditarLavador(${w.lavador_id}, '${w.nombre.replace(/'/g, "\\'")}', '${(w.telefono || '').replace(/'/g, "\\'")}', ${w.porcentaje_comision})">Editar</button>
                <button class="btn btn-sm btn-outline admin-only" onclick="app.toggleEstadoLavador(${w.lavador_id}, '${w.estado}', '${w.nombre}')">${w.estado === 'activo' ? 'Inactivar' : 'Activar'}</button>
              </div>
            </div>
          `).join('');
        }

        const tbLiq = document.getElementById('liquidacionesTableBody');
        if (tbLiq) {
          tbLiq.innerHTML = liquidaciones.length === 0
            ? `<tr><td colspan="9" class="text-center text-muted">Todavía no se le ha liquidado ninguna comisión a un lavador. Use "Liquidar Comisión" en su tarjeta arriba.</td></tr>`
            : liquidaciones.map(l => `
            <tr>
              <td>#${l.id}</td>
              <td><strong>${l.lavador_nombre}</strong></td>
              <td>${l.periodo_inicio} al ${l.periodo_fin}</td>
              <td>${this.formatMoney(l.total_comision)}</td>
              <td>${this.formatMoney(l.descuentos)}</td>
              <td><strong class="text-success">${this.formatMoney(l.valor_a_pagar)}</strong></td>
              <td><span class="role-badge" style="background: ${l.estado === 'pagado' ? '#10b981' : '#f59e0b'}">${l.estado.toUpperCase()}</span></td>
              <td class="text-sm">${l.tiene_soporte ? `<a href="#" onclick="app.verSoportePago('liquidaciones', ${l.id}); return false;">Ver soporte</a>` : '<span class="text-muted">Pendiente de soporte</span>'}</td>
              <td>${l.estado === 'pendiente' ? `<button class="btn btn-sm btn-success admin-only" onclick="app.abrirModalPagarLiq(${l.id})">Pagar (Adjuntar Soporte)</button>` : '<span class="text-success text-sm">Pagado</span>'}</td>
            </tr>
          `).join('');
        }
        this.updateRolePermissions();
      } else if (this.activeSubTabNomina === 'empleados') {
        const [empleados, pagos] = await Promise.all([
          ApiCliente.get('/api/nomina/empleados'),
          ApiCliente.get('/api/nomina/pagos-salario')
        ]);

        const tbEmp = document.getElementById('empleadosSalarioTableBody');
        if (tbEmp) {
          tbEmp.innerHTML = empleados.map(e => `
            <tr>
              <td><strong>${e.nombre}</strong></td>
              <td>${e.documento}</td>
              <td><span class="role-badge">${e.rol.toUpperCase()}</span></td>
              <td><strong>${this.formatMoney(e.salario_fijo)}</strong></td>
              <td>${(e.periodicidad_pago || '').toUpperCase()}</td>
              <td><span class="role-badge" style="background: ${e.estado === 'activo' ? '#10b981' : '#ef4444'}">${(e.estado || 'activo').toUpperCase()}</span></td>
              <td>${e.ultimo_pago ? e.ultimo_pago.fecha_pago_real : 'Sin pagos registrados'}</td>
              <td>
                <button class="btn btn-sm btn-primary" onclick="app.abrirModalPagarSalario(${e.empleado_id}, '${e.nombre.replace(/'/g, "\\'")}', '${e.periodicidad_pago || 'quincenal'}')">Pagar Salario</button>
                <button class="btn btn-sm btn-outline" onclick="app.abrirModalEditarEmpleado(${e.empleado_id}, '${e.nombre.replace(/'/g, "\\'")}', '${(e.telefono || '').replace(/'/g, "\\'")}', '${(e.correo || '').replace(/'/g, "\\'")}', ${e.salario_fijo}, '${e.periodicidad_pago}', ${e.jornada_horas_dia || 8}, ${e.dias_descanso_semana ?? 1})">Editar</button>
                <button class="btn btn-sm btn-outline" onclick="app.reiniciarContrasenaUsuario(${e.empleado_id}, '${e.nombre}')">Reiniciar Contraseña</button>
                ${(e.empleado_id === this.currentUser.id || e.es_admin_principal)
                  ? ''
                  : `<button class="btn btn-sm btn-outline" onclick="app.toggleEstadoUsuario(${e.empleado_id}, '${e.estado || 'activo'}', '${e.nombre}')">${(e.estado || 'activo') === 'activo' ? 'Inactivar' : 'Activar'}</button>`}
              </td>
            </tr>
          `).join('');
        }

        const tbPagos = document.getElementById('pagosSalarioTableBody');
        if (tbPagos) {
          tbPagos.innerHTML = pagos.length === 0
            ? `<tr><td colspan="7" class="text-center text-muted">Todavía no se le ha pagado el salario a ningún empleado. Use "Pagar Salario" en la tabla de arriba.</td></tr>`
            : pagos.map(p => `
            <tr>
              <td>#${p.id}</td>
              <td><strong>${p.empleado_nombre}</strong></td>
              <td>${p.fecha_pago_real}</td>
              <td><strong>${this.formatMoney(p.valor_a_pagar)}</strong></td>
              <td>${this.formatMoney(p.descuentos)}</td>
              <td>${p.tiene_soporte ? `<a href="#" onclick="app.verSoportePago('pagos-salario', ${p.id}); return false;">Ver soporte</a>` : '<span class="text-muted">Sin soporte</span>'}</td>
              <td><span class="role-badge" style="background: #10b981">PAGADO</span></td>
            </tr>
          `).join('');
        }
      } else if (this.activeSubTabNomina === 'asistencia') {
        await this.cargarPersonalParaAsistencia();
        const asist = await ApiCliente.get('/api/nomina/asistencia');
        const tbAsist = document.getElementById('asistenciaTableBody');
        if (tbAsist) {
          tbAsist.innerHTML = asist.map(a => `
            <tr>
              <td><strong>${a.usuario_nombre}</strong></td>
              <td>${a.usuario_rol}</td>
              <td>${a.hora_entrada || '--:--'}</td>
              <td>${a.hora_salida || '--:--'}</td>
              <td>${a.horas_descanso > 0 ? `${a.horas_descanso} hrs` : '--'}</td>
              <td>${a.horas_trabajadas} hrs</td>
              <td>${a.inasistencia
                ? '<span class="role-badge" style="background: #ef4444">INASISTENCIA (Descuenta)</span>'
                : a.hora_salida
                  ? '<span class="role-badge" style="background: #64748b">FINALIZADO</span>'
                  : '<span class="role-badge" style="background: #10b981">PRESENTE</span>'}</td>
              <td>${!a.hora_salida && !a.inasistencia ? `<button class="btn btn-sm btn-secondary" onclick="app.abrirModalMarcarSalida('${a.persona_tipo}', ${a.persona_id})">Marcar Salida</button>` : '<span class="text-sm text-muted">Jornada finalizada</span>'}</td>
            </tr>
          `).join('');
        }
      }
    } catch (err) { console.error(err); }
  },

  /**
   * Arma el selector de "Registrar Asistencia" combinando lavadores (visible
   * para cualquier rol) con cuentas de usuario (solo visibles para admin;
   * un empleado siempre puede registrar SU PROPIA asistencia).
   */
  async cargarPersonalParaAsistencia() {
    const opciones = [];
    (this.washers || []).forEach(w => opciones.push({ tipo: 'lavador', id: w.id, etiqueta: `${w.nombre} (lavador)` }));

    if (this.currentUser.rol === 'administrador') {
      try {
        const usuarios = await ApiCliente.get('/api/personal/usuarios');
        usuarios.forEach(u => opciones.push({ tipo: 'usuario', id: u.id, etiqueta: `${u.nombre} (${u.rol})` }));
      } catch (err) { /* si falla, seguimos solo con lavadores + el propio usuario */ }
    } else {
      opciones.push({ tipo: 'usuario', id: this.currentUser.id, etiqueta: `${this.currentUser.nombre} (yo)` });
    }

    const select = document.getElementById('asistPersonalSelect');
    if (select) {
      select.innerHTML = opciones.map(o => `<option value="${o.tipo}:${o.id}">${o.etiqueta}</option>`).join('');
    }
  },

  abrirModalLiquidar(lavadorId, nombre, comisionPendiente) {
    this.liquidatingWasher = lavadorId;
    document.getElementById('liqModalLavadorNombre').textContent = nombre;
    document.getElementById('liqTotalComision').value = comisionPendiente;
    document.getElementById('liqDescuentos').value = 0;
    this.recalcLiqTotal();
    const hoy = fechaLocalHoy();
    document.getElementById('liqPeriodoInicio').value = hoy;
    document.getElementById('liqPeriodoFin').value = hoy;
    this.openModal('modalLiquidarLavador');
  },

  recalcLiqTotal() {
    const tot = parseFloat(document.getElementById('liqTotalComision').value) || 0;
    const desc = parseFloat(document.getElementById('liqDescuentos').value) || 0;
    document.getElementById('liqNetoAPagar').textContent = this.formatMoney(Math.max(0, tot - desc));
  },

  async guardarLiquidacionLavador() {
    const total_comision = document.getElementById('liqTotalComision').value;
    const descuentos = document.getElementById('liqDescuentos').value;
    const periodo_inicio = document.getElementById('liqPeriodoInicio').value;
    const periodo_fin = document.getElementById('liqPeriodoFin').value;

    try {
      await ApiCliente.post('/api/nomina/liquidar-lavador', { lavador_id: this.liquidatingWasher, periodo_inicio, periodo_fin, total_comision, descuentos });
      this.toast('Liquidación generada con estado PENDIENTE.', 'success');
      this.closeModal('modalLiquidarLavador');
      this.loadNomina();
    } catch (err) {
      this.toast('Error al generar liquidación.', 'error');
    }
  },

  abrirModalPagarLiq(liqId) {
    this.payingLiqId = liqId;
    document.getElementById('pagLiqSoporteArchivo').value = '';
    document.getElementById('pagLiqFecha').value = fechaLocalHoy();
    this.openModal('modalPagarLiquidacion');
  },

  async confirmarPagoLiquidacion() {
    const archivo = document.getElementById('pagLiqSoporteArchivo').files[0];
    const fecha = document.getElementById('pagLiqFecha').value;
    if (!archivo) { this.toast('El sistema exige adjuntar el soporte de pago (foto o PDF).', 'warning'); return; }

    const formData = new FormData();
    formData.append('liquidacion_id', this.payingLiqId);
    formData.append('fecha_pago', fecha);
    formData.append('soporte', archivo);

    try {
      await ApiCliente.postForm('/api/nomina/pagar-liquidacion', formData);
      this.toast('Liquidación pagada y registrada con soporte en auditoría.', 'success');
      this.closeModal('modalPagarLiquidacion');
      this.loadNomina();
    } catch (err) {
      this.toast(err.message || 'Error al procesar pago de liquidación.', 'error');
    }
  },

  abrirModalPagarSalario(empleadoId, nombre, periodicidadPago) {
    this.payingEmpleadoId = empleadoId;
    document.getElementById('pagSalEmpleadoNombre').textContent = nombre;
    document.getElementById('pagSalDescuentos').value = 0;
    document.getElementById('pagSalSoporteArchivo').value = '';
    document.getElementById('pagSalFecha').value = fechaLocalHoy();

    // Rango por defecto según la periodicidad de pago del empleado; el
    // administrador puede ajustarlo antes de calcular.
    const diasAtras = { semanal: 6, quincenal: 14, mensual: 29 }[periodicidadPago] ?? 14;
    document.getElementById('pagSalPeriodoInicio').value = fechaLocalHaceDias(diasAtras);
    document.getElementById('pagSalPeriodoFin').value = fechaLocalHoy();

    this.openModal('modalPagarSalarioEmpleado');
    this.recalcularPagoPorHoras();
  },

  async recalcularPagoPorHoras() {
    const inicio = document.getElementById('pagSalPeriodoInicio').value;
    const fin = document.getElementById('pagSalPeriodoFin').value;
    if (!inicio || !fin) return;

    try {
      const c = await ApiCliente.get(`/api/nomina/empleados/${this.payingEmpleadoId}/calculo-pago?periodo_inicio=${inicio}&periodo_fin=${fin}`);
      document.getElementById('pagSalValorHora').value = this.formatMoney(c.valorHora);
      document.getElementById('pagSalHorasTrabajadas').value = `${c.horasTrabajadas} hrs (jornada esperada: ${c.horasEsperadasPeriodo} hrs)`;
      document.getElementById('pagSalMontoNormal').value = `${this.formatMoney(c.montoNormal)} (${c.horasNormales} hrs)`;
      document.getElementById('pagSalMontoExtra').value = `${this.formatMoney(c.montoExtra)} (${c.horasExtra} hrs a ${this.formatMoney(c.valorHoraExtra)}/hr)`;
      const infoExtra = document.getElementById('pagSalHorasExtraInfo');
      infoExtra.textContent = c.horasExtra > 0
        ? `⚠ La jornada semanal esperada es de ${c.horasEsperadasSemana} hrs. Este empleado superó ese límite en al menos una semana del período, por eso ${c.horasExtra} hrs se pagan al doble.`
        : `Jornada semanal esperada: ${c.horasEsperadasSemana} hrs. No hubo horas extra en el período.`;
      document.getElementById('pagSalBase').value = c.montoCalculado;
      this.recalcSalarioTotal();
    } catch (err) {
      this.toast(err.message || 'No se pudo calcular el pago por horas.', 'error');
    }
  },

  recalcSalarioTotal() {
    const base = parseFloat(document.getElementById('pagSalBase').value) || 0;
    const desc = parseFloat(document.getElementById('pagSalDescuentos').value) || 0;
    document.getElementById('pagSalNetoAPagar').textContent = this.formatMoney(Math.max(0, base - desc));
  },

  async confirmarPagoSalario() {
    const archivo = document.getElementById('pagSalSoporteArchivo').files[0];
    const salarioBase = document.getElementById('pagSalBase').value;
    const descuentos = document.getElementById('pagSalDescuentos').value;
    const fecha = document.getElementById('pagSalFecha').value;
    if (!archivo) { this.toast('El sistema exige adjuntar el soporte de pago (foto o PDF).', 'warning'); return; }

    const formData = new FormData();
    formData.append('empleado_id', this.payingEmpleadoId);
    formData.append('salario_base', salarioBase);
    formData.append('descuentos', descuentos);
    formData.append('fecha_pago', fecha);
    formData.append('periodo_inicio', document.getElementById('pagSalPeriodoInicio').value);
    formData.append('periodo_fin', document.getElementById('pagSalPeriodoFin').value);
    formData.append('soporte', archivo);

    try {
      await ApiCliente.postForm('/api/nomina/pagar-empleado', formData);
      this.toast('Salario pagado y registrado con soporte en auditoría.', 'success');
      this.closeModal('modalPagarSalarioEmpleado');
      this.loadNomina();
    } catch (err) {
      this.toast(err.message || 'Error al registrar pago de salario.', 'error');
    }
  },

  async verSoportePago(tipo, id) {
    try {
      const respuesta = await fetch(`/api/nomina/${tipo}/${id}/soporte`, { headers: { Authorization: `Bearer ${ApiCliente.obtenerToken()}` } });
      if (!respuesta.ok) throw new Error('No se pudo abrir el soporte de pago.');
      const blob = await respuesta.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.target = '_blank';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
    } catch (err) {
      this.toast(err.message || 'No se pudo abrir el soporte de pago.', 'error');
    }
  },

  async abrirModalAsistencia() {
    await this.cargarPersonalParaAsistencia();
    document.getElementById('asistTipoSelect').value = 'entrada';
    document.getElementById('asistHorasDescanso').value = 0;
    this.actualizarVisibilidadDescanso();
    this.openModal('modalAsistencia');
  },

  async abrirModalMarcarSalida(personaTipo, personaId) {
    await this.cargarPersonalParaAsistencia();
    document.getElementById('asistPersonalSelect').value = `${personaTipo}:${personaId}`;
    document.getElementById('asistTipoSelect').value = 'salida';
    document.getElementById('asistHorasDescanso').value = 0;
    this.actualizarVisibilidadDescanso();
    this.openModal('modalAsistencia');
  },

  actualizarVisibilidadDescanso() {
    const esSalida = document.getElementById('asistTipoSelect').value === 'salida';
    document.getElementById('asistDescansoWrapper').style.display = esSalida ? '' : 'none';
  },

  async guardarAsistencia() {
    const [persona_tipo, persona_id] = document.getElementById('asistPersonalSelect').value.split(':');
    const tipo = document.getElementById('asistTipoSelect').value;
    const horas_descanso = parseFloat(document.getElementById('asistHorasDescanso').value) || 0;

    if (tipo === 'salida' && horas_descanso > 0 && horas_descanso < 1) {
      this.toast('Si registra descanso/almuerzo, debe ser de mínimo 1 hora.', 'warning');
      return;
    }

    try {
      await ApiCliente.post('/api/nomina/asistencia', {
        persona_tipo, persona_id: parseInt(persona_id, 10),
        tipo: tipo === 'inasistencia' ? null : tipo,
        inasistencia: tipo === 'inasistencia',
        horas_descanso
      });
      this.toast('Registro de asistencia guardado.', 'success');
      this.closeModal('modalAsistencia');
      this.loadNomina();
    } catch (err) {
      this.toast(err.message || 'Error al registrar asistencia.', 'error');
    }
  },

  // ===========================================================================
  // ACTIVAR / INACTIVAR PERSONAL (nunca se elimina, solo se inactiva)
  // ===========================================================================
  async toggleEstadoUsuario(id, estadoActual, nombre) {
    const nuevoEstado = estadoActual === 'activo' ? 'inactivo' : 'activo';
    if (!confirm(`¿${nuevoEstado === 'activo' ? 'Activar' : 'Inactivar'} a ${nombre}?`)) return;
    try {
      await ApiCliente.put(`/api/personal/usuarios/${id}`, { estado: nuevoEstado });
      this.toast(`${nombre} ahora está ${nuevoEstado}.`, 'success');
      this.loadNomina();
    } catch (err) {
      this.toast(err.message || 'No se pudo cambiar el estado.', 'error');
    }
  },

  async toggleEstadoLavador(id, estadoActual, nombre) {
    const nuevoEstado = estadoActual === 'activo' ? 'inactivo' : 'activo';
    if (!confirm(`¿${nuevoEstado === 'activo' ? 'Activar' : 'Inactivar'} a ${nombre}?`)) return;
    try {
      await ApiCliente.put(`/api/personal/lavadores/${id}`, { estado: nuevoEstado });
      this.toast(`${nombre} ahora está ${nuevoEstado}.`, 'success');
      this.loadNomina();
      this.loadWashers();
    } catch (err) {
      this.toast('No se pudo cambiar el estado.', 'error');
    }
  },

  abrirModalEditarLavador(id, nombre, telefono, porcentajeComision) {
    this.editingWasherId = id;
    document.getElementById('editLavNombre').value = nombre;
    document.getElementById('editLavTelefono').value = telefono;
    document.getElementById('editLavComision').value = porcentajeComision;
    this.openModal('modalEditarLavador');
  },

  async guardarEdicionLavador() {
    const nombre = document.getElementById('editLavNombre').value.trim();
    const telefono = document.getElementById('editLavTelefono').value.trim();
    const porcentajeComision = document.getElementById('editLavComision').value;
    if (!nombre) { this.toast('El nombre es obligatorio.', 'warning'); return; }
    if (!esNombreValido(nombre)) { this.toast('El nombre debe tener solo letras y espacios, mínimo 3 caracteres.', 'warning'); return; }
    if (telefono && !esTelefonoValido(telefono)) { this.toast('El teléfono debe tener solo números (7 a 10 dígitos).', 'warning'); return; }

    try {
      await ApiCliente.put(`/api/personal/lavadores/${this.editingWasherId}`, { nombre, telefono, porcentajeComision });
      this.toast('Datos del lavador actualizados.', 'success');
      this.closeModal('modalEditarLavador');
      this.loadNomina();
      this.loadWashers();
    } catch (err) {
      this.toast(err.message || 'No se pudo actualizar el lavador.', 'error');
    }
  },

  // ===========================================================================
  // 7. CONTROL DE CAJA DIARIA (CU20)
  // ===========================================================================
  async loadCaja() {
    try {
      const [data, historial] = await Promise.all([
        ApiCliente.get('/api/caja/resumen'),
        ApiCliente.get('/api/caja/historial')
      ]);

      document.getElementById('cajaTotalEfectivo').textContent = this.formatMoney(data.total_efectivo);
      document.getElementById('cajaTotalTarjeta').textContent = this.formatMoney(data.total_tarjeta);
      document.getElementById('cajaTotalTransferencia').textContent = this.formatMoney(data.total_transferencia);
      document.getElementById('cajaTotalPse').textContent = this.formatMoney(data.total_pse);
      document.getElementById('cajaTotalGeneral').textContent = this.formatMoney(data.total_general);
      document.getElementById('cajaTotalOrdenesCount').textContent = `${data.ordenes_count} órdenes pagadas hoy`;

      const btnCerrar = document.getElementById('btnCerrarCaja');
      const avisoPendientes = document.getElementById('cajaAvisoPendientes');
      const pendientes = data.pendientes || { total: 0, turnos: 0, ordenes: 0 };
      if (data.esta_cerrada) {
        btnCerrar.disabled = true;
        btnCerrar.textContent = 'Caja de Hoy Ya Cerrada';
        if (avisoPendientes) avisoPendientes.classList.add('hidden');
      } else if (pendientes.total > 0) {
        btnCerrar.disabled = true;
        btnCerrar.textContent = 'Realizar Cierre de Caja';
        if (avisoPendientes) {
          const partes = [];
          if (pendientes.turnos > 0) partes.push(`${pendientes.turnos} en fila de espera`);
          if (pendientes.ordenes > 0) partes.push(`${pendientes.ordenes} sin finalizar/cobrar`);
          avisoPendientes.textContent = `No se puede cerrar caja: hay ${pendientes.total} servicio(s) pendiente(s) (${partes.join(', ')}). Atiéndalos, cóbrelos o cancélelos primero.`;
          avisoPendientes.classList.remove('hidden');
        }
      } else {
        btnCerrar.disabled = false;
        btnCerrar.textContent = 'Realizar Cierre de Caja';
        if (avisoPendientes) avisoPendientes.classList.add('hidden');
      }
      document.getElementById('modalCierreTotalGeneral').textContent = this.formatMoney(data.total_general);

      const tb = document.getElementById('cierresCajaTableBody');
      if (tb) {
        tb.innerHTML = historial.map(c => `
          <tr>
            <td><strong>${c.fecha}</strong></td>
            <td>${c.usuario_nombre}</td>
            <td>${this.formatMoney(c.total_efectivo)}</td>
            <td>${this.formatMoney(c.total_tarjeta)}</td>
            <td>${this.formatMoney(c.total_transferencia)}</td>
            <td>${this.formatMoney(c.total_pse)}</td>
            <td><strong class="text-success">${this.formatMoney(c.total_general)}</strong></td>
            <td class="text-sm text-muted">${c.observaciones || 'Sin novedad'}</td>
          </tr>
        `).join('');
      }
    } catch (err) { console.error(err); }
  },

  abrirModalCerrarCaja() {
    document.getElementById('cierreObservaciones').value = '';
    this.openModal('modalCerrarCaja');
  },

  async confirmarCierreCaja() {
    const observaciones = document.getElementById('cierreObservaciones').value;
    try {
      const data = await ApiCliente.post('/api/caja/cerrar', { observaciones });
      this.toast(`Cierre de caja completado por ${this.formatMoney(data.total_general)}.`, 'success');
      this.closeModal('modalCerrarCaja');
      this.loadCaja();
    } catch (err) {
      this.toast(err.message || 'Error al cerrar caja.', 'error');
    }
  },

  // ===========================================================================
  // 7B. FACTURAS (numeración automática CCPP-DDMMAA-NNN, ver backend)
  // ===========================================================================
  async loadFacturas() {
    try {
      const tipo = document.getElementById('facturasFiltroTipo').value;
      const query = tipo ? `?tipo=${tipo}` : '';
      const facturas = await ApiCliente.get(`/api/facturas${query}`);

      const tb = document.getElementById('facturasTableBody');
      if (tb) {
        tb.innerHTML = facturas.map(f => `
          <tr>
            <td><strong>${f.numero_factura}</strong></td>
            <td><span class="role-badge" style="background: ${f.tipo === 'venta' ? '#10b981' : '#ef4444'}">${f.tipo.toUpperCase()}</span></td>
            <td>${f.fecha}</td>
            <td>${f.concepto}</td>
            <td>${f.cliente_nombre || f.proveedor_nombre || '-'}</td>
            <td class="${f.tipo === 'venta' ? 'text-success' : 'text-danger'}"><strong>${f.tipo === 'venta' ? '+' : '-'}${this.formatMoney(f.total)}</strong></td>
            <td><button class="btn btn-sm btn-outline" onclick="app.verFacturaPdf(${f.id})">Ver PDF</button></td>
          </tr>
        `).join('');
        if (facturas.length === 0) {
          tb.innerHTML = `<tr><td colspan="7" class="text-center text-muted text-sm py-3">Aún no hay facturas registradas.</td></tr>`;
        }
      }
    } catch (err) { console.error(err); }
  },

  async verFacturaPdf(id) {
    try {
      const respuesta = await fetch(`/api/facturas/${id}/pdf`, { headers: { Authorization: `Bearer ${ApiCliente.obtenerToken()}` } });
      if (!respuesta.ok) throw new Error('No se pudo generar la factura.');
      const blob = await respuesta.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.target = '_blank';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
    } catch (err) {
      this.toast(err.message || 'No se pudo abrir la factura.', 'error');
    }
  },

  // ===========================================================================
  // 8. REPORTES: GANANCIAS Y DESCARGA EN PDF (CU18, CU19, CU29)
  // ===========================================================================
  setDashboardPeriod(period) {
    this.dashboardPeriod = period;
    document.querySelectorAll('#tab-dashboard .period-selector:not(#reporteTipoSelector) .period-btn')
      .forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-period') === period));
    document.getElementById('reportePersonalizadoBox').classList.toggle('hidden', period !== 'personalizado');
    this.loadReporteActivo();
  },

  /** Cambia cuál de los 7 reportes se está viendo en pantalla. */
  setReporteTipo(tipo) {
    this.reporteTipoActivo = tipo;
    document.querySelectorAll('#reporteTipoSelector .period-btn').forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-reporte') === tipo));
    document.querySelectorAll('.reporte-subview').forEach(v => v.classList.toggle('hidden', v.id !== `reporte-${tipo}`));

    // Inventario y Clientes son una foto del momento: no aplica período.
    const sinPeriodo = tipo === 'inventario' || tipo === 'clientes';
    document.querySelector('#tab-dashboard .period-selector:not(#reporteTipoSelector)').classList.toggle('hidden', sinPeriodo);
    document.getElementById('reportePersonalizadoBox').classList.toggle('hidden', sinPeriodo || this.dashboardPeriod !== 'personalizado');

    this.loadReporteActivo();
  },

  loadReporteActivo() {
    const tipo = this.reporteTipoActivo || 'resumen';
    if (tipo === 'personalizado' && this.dashboardPeriod === 'personalizado') return; // guard, no-op
    const cargadores = {
      resumen: () => this.loadDashboard(),
      ventas: () => this.loadReporteVentas(),
      compras: () => this.loadReporteCompras(),
      inventario: () => this.loadReporteInventario(),
      nomina: () => this.loadReporteNomina(),
      comparativo: () => this.loadReporteComparativo(),
      operativo: () => this.loadReporteOperativo(),
      asistencia: () => this.loadReporteAsistencia(),
      clientes: () => this.loadReporteClientes()
    };
    (cargadores[tipo] || cargadores.resumen)();
  },

  /** Barras horizontales simples (sin librerías externas). data = [{label, value}] */
  renderBarChart(elId, data, { color = '#0077b6', money = true } = {}) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!data || data.length === 0) {
      el.innerHTML = '<p class="text-muted text-sm text-center py-3">Sin datos en el período.</p>';
      return;
    }
    const max = Math.max(...data.map(d => d.value), 1);
    el.innerHTML = `<div class="bar-chart-list">${data.map(d => `
      <div class="bar-chart-row">
        <span class="bar-chart-label" title="${d.label}">${d.label}</span>
        <div class="bar-chart-track"><div class="bar-chart-fill" style="width:${Math.max(2, (d.value / max) * 100).toFixed(1)}%; background:${color}"></div></div>
        <span class="bar-chart-value">${money ? this.formatMoney(d.value) : d.value}</span>
      </div>
    `).join('')}</div>`;
  },

  /** Dona SVG simple. data = [{label, value, color}] */
  renderDonutChart(elId, data) {
    const el = document.getElementById(elId);
    if (!el) return;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (!total) {
      el.innerHTML = '<p class="text-muted text-sm text-center py-3">Sin datos en el período.</p>';
      return;
    }
    const radio = 45, circunferencia = 2 * Math.PI * radio;
    let acumulado = 0;
    const circulos = data.filter(d => d.value > 0).map(d => {
      const frac = d.value / total;
      const largo = frac * circunferencia;
      const circle = `<circle r="${radio}" cx="60" cy="60" fill="transparent" stroke="${d.color}" stroke-width="18" stroke-dasharray="${largo} ${circunferencia - largo}" stroke-dashoffset="${-acumulado}" transform="rotate(-90 60 60)"></circle>`;
      acumulado += largo;
      return circle;
    }).join('');
    const leyenda = data.map(d => `<div class="donut-legend-item"><span class="donut-dot" style="background:${d.color}"></span>${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)</div>`).join('');
    el.innerHTML = `<div class="donut-chart-wrapper"><svg width="120" height="120" viewBox="0 0 120 120">${circulos}</svg><div class="donut-legend">${leyenda}</div></div>`;
  },

  async loadReporteVentas() {
    try {
      const r = await ApiCliente.get(`/api/reportes/ventas?${this.construirQueryPeriodo()}`);
      document.getElementById('ventasTotal').textContent = this.formatMoney(r.totalVentas);
      document.getElementById('ventasCantidad').textContent = r.cantidadVentas;
      document.getElementById('ventasTicketProm').textContent = this.formatMoney(r.ticketPromedio);

      this.renderBarChart('ventasPorServicioChart', Object.entries(r.porServicio).map(([label, value]) => ({ label, value })), { color: '#0077b6' });
      this.renderDonutChart('ventasPorMetodoChart', Object.entries(r.porMetodoPago).map(([label, value], i) => ({ label: label.toUpperCase(), value, color: ['#0077b6', '#00b4d8', '#10b981', '#f59e0b'][i % 4] })));
      const coloresVeh = ['#0077b6', '#00b4d8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
      this.renderDonutChart('ventasPorVehiculoChart', Object.entries(r.porVehiculo).map(([tipo, value], i) => ({
        label: tipo[0].toUpperCase() + tipo.slice(1), value, color: coloresVeh[i % coloresVeh.length]
      })));

      const elPorLav = document.getElementById('ventasPorLavadorChart');
      if (elPorLav) {
        elPorLav.innerHTML = (r.porLavador && r.porLavador.length)
          ? '' : '<p class="text-sm text-muted">Sin servicios atendidos por lavadores en el período.</p>';
        if (r.porLavador && r.porLavador.length) {
          this.renderBarChart('ventasPorLavadorChart', r.porLavador.map(l => ({ label: `${l.nombre} (${l.servicios})`, value: l.comision })), { color: '#10b981' });
        }
      }

      document.getElementById('ventasTopClientesBody').innerHTML = r.topClientes.map(c => `
        <tr><td>${c.nombre}</td><td>${c.cantidad}</td><td><strong>${this.formatMoney(c.total)}</strong></td></tr>
      `).join('') || `<tr><td colspan="3" class="text-center text-muted text-sm py-3">Sin clientes registrados con compras en el período.</td></tr>`;
    } catch (err) { console.error(err); }
  },

  async loadReporteCompras() {
    try {
      const r = await ApiCliente.get(`/api/reportes/compras?${this.construirQueryPeriodo()}`);
      document.getElementById('comprasTotal').textContent = this.formatMoney(r.totalCompras);
      document.getElementById('comprasCantidad').textContent = r.cantidadCompras;
      this.renderBarChart('comprasPorProveedorChart', Object.entries(r.porProveedor).map(([label, value]) => ({ label, value })), { color: '#f59e0b' });
      this.renderBarChart('comprasPorInsumoChart', Object.entries(r.porInsumo).map(([label, value]) => ({ label, value })), { color: '#f59e0b' });
    } catch (err) { console.error(err); }
  },

  async loadReporteInventario() {
    try {
      const r = await ApiCliente.get('/api/reportes/inventario');
      document.getElementById('inventarioValorTotal').textContent = this.formatMoney(r.valorTotalInventario);
      document.getElementById('inventarioAlertas').textContent = r.alertas.length;
      this.renderBarChart('inventarioValorChart', r.insumos.map(i => ({ label: i.nombre, value: i.valor })), { color: '#0077b6' });
    } catch (err) { console.error(err); }
  },

  async loadReporteNomina() {
    try {
      const r = await ApiCliente.get(`/api/reportes/nomina?${this.construirQueryPeriodo()}`);
      document.getElementById('nominaSalarios').textContent = this.formatMoney(r.salariosPagados);
      document.getElementById('nominaComisiones').textContent = this.formatMoney(r.comisionesPagadas);
      document.getElementById('nominaPendiente').textContent = this.formatMoney(r.liquidacionesPendientesTotal);
      document.getElementById('nominaHoras').textContent = `${r.horasTrabajadasTotal} hrs`;
      this.renderDonutChart('nominaAsistenciaChart', [
        { label: 'Presentes', value: r.asistenciasPresentes, color: '#10b981' },
        { label: 'Inasistencias', value: r.inasistencias, color: '#ef4444' }
      ]);

      const elEmp = document.getElementById('nominaPorEmpleadoChart');
      if (elEmp) {
        elEmp.innerHTML = (r.porEmpleado && r.porEmpleado.length)
          ? ''
          : '<p class="text-sm text-muted">Sin pagos de salario en este período.</p>';
        if (r.porEmpleado && r.porEmpleado.length) {
          this.renderBarChart('nominaPorEmpleadoChart', r.porEmpleado.map(e => ({ label: e.nombre, value: e.total })), { color: '#0077b6' });
        }
      }

      const elLav = document.getElementById('nominaPorLavadorChart');
      if (elLav) {
        elLav.innerHTML = (r.porLavador && r.porLavador.length)
          ? ''
          : '<p class="text-sm text-muted">Sin comisiones pagadas en este período.</p>';
        if (r.porLavador && r.porLavador.length) {
          this.renderBarChart('nominaPorLavadorChart', r.porLavador.map(l => ({ label: l.nombre, value: l.total })), { color: '#f59e0b' });
        }
      }
    } catch (err) { console.error(err); }
  },

  async loadReporteComparativo() {
    try {
      const r = await ApiCliente.get(`/api/reportes/comparativo?${this.construirQueryPeriodo()}`);
      const fmtVar = v => v === null ? 'Sin datos del período anterior' : `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v)}% vs. período anterior`;

      this.renderBarChart('compIngresosChart', [
        { label: 'Actual', value: r.actual.totalIngresos },
        { label: 'Anterior', value: r.anterior.totalIngresos }
      ], { color: '#0077b6' });
      document.getElementById('compIngresosVar').textContent = fmtVar(r.variacionIngresos);

      this.renderBarChart('compGananciaChart', [
        { label: 'Actual', value: r.actual.gananciaNeta },
        { label: 'Anterior', value: r.anterior.gananciaNeta }
      ], { color: '#10b981' });
      document.getElementById('compGananciaVar').textContent = fmtVar(r.variacionGanancia);

      this.renderBarChart('compServiciosChart', [
        { label: 'Actual', value: r.actual.serviciosAtendidos },
        { label: 'Anterior', value: r.anterior.serviciosAtendidos }
      ], { color: '#f59e0b', money: false });
      document.getElementById('compServiciosVar').textContent = fmtVar(r.variacionServicios);
    } catch (err) { console.error(err); }
  },

  async loadReporteOperativo() {
    try {
      const r = await ApiCliente.get(`/api/reportes/operativo?${this.construirQueryPeriodo()}`);
      document.getElementById('opClientesNuevos').textContent = r.clientesNuevos;
      document.getElementById('opClientesRecurrentes').textContent = r.clientesRecurrentes;
      const cancelados = r.serviciosCancelados || { turnos: 0, ordenes: 0, total: 0 };
      document.getElementById('opServiciosCancelados').textContent = cancelados.total;
      document.getElementById('opServiciosCanceladosDetalle').textContent = `${cancelados.turnos} turnos • ${cancelados.ordenes} órdenes`;
      const coloresEstado = { agendada: '#0077b6', reprogramada: '#f59e0b', atendida: '#10b981', cancelada: '#ef4444' };
      this.renderDonutChart('opCitasChart', Object.entries(r.porEstadoCitas).map(([label, value]) => ({ label: label[0].toUpperCase() + label.slice(1), value, color: coloresEstado[label] || '#64748b' })));
    } catch (err) { console.error(err); }
  },

  async loadReporteAsistencia() {
    try {
      const r = await ApiCliente.get(`/api/reportes/asistencia?${this.construirQueryPeriodo()}`);
      document.getElementById('asistTotalPresentes').textContent = r.totalPresentes;
      document.getElementById('asistTotalInasistencias').textContent = r.totalInasistencias;
      document.getElementById('asistTotalHoras').textContent = `${r.totalHorasTrabajadas} hrs`;

      document.getElementById('asistPorTrabajadorBody').innerHTML = r.porTrabajador.map(t => `
        <tr>
          <td><strong>${t.nombre}</strong></td>
          <td><span class="role-badge">${(t.rol || '').toUpperCase()}</span></td>
          <td class="text-success">${t.presentes}</td>
          <td class="text-danger">${t.inasistencias}</td>
          <td>${t.horasTrabajadas} hrs</td>
        </tr>
      `).join('') || `<tr><td colspan="5" class="text-center text-muted text-sm py-3">Sin registros de asistencia en el período.</td></tr>`;

      document.getElementById('asistDetalleBody').innerHTML = r.detalle.map(d => `
        <tr>
          <td>${d.fecha}</td>
          <td>${d.nombre}</td>
          <td>${d.horaEntrada || '-'}</td>
          <td>${d.horaSalida || '-'}</td>
          <td>${d.horasTrabajadas} hrs</td>
          <td>${d.inasistencia ? '<span class="text-danger">Sí</span>' : 'No'}</td>
        </tr>
      `).join('') || `<tr><td colspan="6" class="text-center text-muted text-sm py-3">Sin registros de asistencia en el período.</td></tr>`;
    } catch (err) { console.error(err); }
  },

  async loadReporteClientes() {
    try {
      const r = await ApiCliente.get('/api/reportes/clientes');
      document.getElementById('clienTotal').textContent = r.totalClientes;
      document.getElementById('clienActivos').textContent = r.activos;
      document.getElementById('clienInactivos').textContent = r.inactivos;
      document.getElementById('clienNuncaCompraron').textContent = r.nuncaCompraron;
      document.getElementById('clienNotaInactividad').textContent = `Un cliente se marca inactivo si no ha comprado en más de ${r.diasInactividad} días.`;

      const ETIQUETA_ESTADO = {
        activo: '<span class="role-badge" style="background: #10b981">ACTIVO</span>',
        inactivo: '<span class="role-badge" style="background: #ef4444">INACTIVO</span>',
        nunca_compro: '<span class="role-badge" style="background: #f59e0b">NUNCA HA COMPRADO</span>'
      };
      document.getElementById('clienTableBody').innerHTML = r.clientes.map(c => `
        <tr>
          <td><strong>${c.nombre}</strong></td>
          <td>${c.telefono || '-'}</td>
          <td>${c.ultimaCompra || 'Nunca'}</td>
          <td>${c.totalCompras}</td>
          <td>${this.formatMoney(c.totalGastado)}</td>
          <td>${ETIQUETA_ESTADO[c.estado] || c.estado}</td>
        </tr>
      `).join('') || `<tr><td colspan="6" class="text-center text-muted text-sm py-3">Sin clientes registrados.</td></tr>`;
    } catch (err) { console.error(err); }
  },

  construirQueryPeriodo() {
    let query = `periodo=${this.dashboardPeriod}`;
    if (this.dashboardPeriod === 'personalizado') {
      const inicio = document.getElementById('reporteFechaInicio').value;
      const fin = document.getElementById('reporteFechaFin').value;
      query += `&fecha_inicio=${inicio}&fecha_fin=${fin}`;
    }
    return query;
  },

  async loadDashboard() {
    if (this.dashboardPeriod === 'personalizado') {
      const inicio = document.getElementById('reporteFechaInicio').value;
      const fin = document.getElementById('reporteFechaFin').value;
      if (!inicio || !fin) return; // esperar a que el usuario complete ambas fechas
    }

    try {
      const [data, gastos] = await Promise.all([
        ApiCliente.get(`/api/reportes/dashboard?${this.construirQueryPeriodo()}`),
        ApiCliente.get('/api/gastos')
      ]);

      document.getElementById('dashIngresos').textContent = this.formatMoney(data.totalIngresos);
      document.getElementById('dashCostoInsumos').textContent = this.formatMoney(data.costoInsumos);
      document.getElementById('dashComisiones').textContent = this.formatMoney(data.totalComisionesLavadores);
      document.getElementById('dashGastos').textContent = this.formatMoney(data.totalGastos);
      document.getElementById('dashGananciaNeta').textContent = this.formatMoney(data.gananciaNeta);
      document.getElementById('dashMargenNeto').textContent = `Margen Rentabilidad: ${data.margenPorcentaje}%`;

      const coloresVehiculo = ['#0077b6', '#00b4d8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
      const entradasVeh = Object.entries(data.distribucionVehiculos || {});
      const totVeh = entradasVeh.reduce((s, [, c]) => s + c, 0) || 1;
      const elRatioBars = document.getElementById('dashVehiculosRatioBars');
      if (elRatioBars) {
        elRatioBars.innerHTML = entradasVeh.map(([tipo, count], i) => `
          <div class="ratio-item ${i > 0 ? 'mt-3' : ''}">
            <div class="d-flex justify-between text-sm mb-1">
              <span>${tipo[0].toUpperCase() + tipo.slice(1)}</span>
              <span>${count} (${Math.round((count / totVeh) * 100)}%)</span>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width: ${(count / totVeh) * 100}%; background: ${coloresVehiculo[i % coloresVehiculo.length]}"></div></div>
          </div>
        `).join('') || '<p class="text-sm text-muted">Sin vehículos atendidos en el período.</p>';
      }

      document.getElementById('dashServiciosList').innerHTML = Object.entries(data.serviciosStats || {}).map(([nombre, stat]) => `
        <div class="stats-row"><span>${nombre}</span><strong>${stat.count} atendidos (${this.formatMoney(stat.total)})</strong></div>
      `).join('') || '<p class="text-sm text-muted">Sin servicios en el período</p>';

      document.getElementById('dashLavadoresList').innerHTML = Object.entries(data.lavadoresStats || {}).map(([nombre, stat]) => `
        <div class="stats-row"><span>${nombre}</span><strong>${stat.servicios} lavados • ${this.formatMoney(stat.comision)}</strong></div>
      `).join('') || '<p class="text-sm text-muted">Sin actividad en el período</p>';

      const tbGastos = document.getElementById('gastosTableBody');
      if (tbGastos) {
        tbGastos.innerHTML = gastos.slice(0, 8).map(g => `
          <tr><td>${g.fecha}</td><td>${g.concepto}</td><td><strong class="text-danger">${this.formatMoney(g.monto)}</strong></td></tr>
        `).join('');
      }

      const tbAuditoria = document.getElementById('auditoriaTableBody');
      if (tbAuditoria) {
        tbAuditoria.innerHTML = (data.auditoriaReciente || []).map(a => `
          <tr><td>${a.fecha.substring(5, 16)}</td><td><span class="role-badge">${a.accion.toUpperCase()}</span></td><td class="text-sm text-muted">${a.detalle}</td></tr>
        `).join('');
      }
    } catch (err) { console.error(err); }
  },

  /**
   * Descarga el reporte del período actualmente seleccionado como PDF.
   * No se puede usar un <a href> directo porque la descarga debe llevar el
   * token JWT en el header Authorization, así que se pide como blob.
   */
  async descargarReportePdf() {
    const tipo = this.reporteTipoActivo || 'resumen';
    const endpoint = tipo === 'resumen' ? 'dashboard' : tipo;
    const query = (tipo === 'inventario' || tipo === 'clientes') ? '' : `?${this.construirQueryPeriodo()}`;
    const url = `/api/reportes/${endpoint}/pdf${query}`;
    try {
      const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${ApiCliente.obtenerToken()}` } });
      if (!respuesta.ok) throw new Error('No se pudo generar el PDF.');
      const blob = await respuesta.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.download = `reporte_${tipo}.pdf`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
    } catch (err) {
      this.toast('No se pudo descargar el PDF del reporte.', 'error');
    }
  },

  abrirModalNuevoGasto() {
    document.getElementById('gastoConcepto').value = '';
    document.getElementById('gastoMonto').value = '';
    this.openModal('modalNuevoGasto');
  },

  async guardarGasto() {
    const concepto = document.getElementById('gastoConcepto').value;
    const monto = document.getElementById('gastoMonto').value;
    if (!concepto || !monto) { this.toast('Concepto y monto son obligatorios.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/gastos', { concepto, monto });
      this.toast('Gasto operativo registrado.', 'success');
      this.closeModal('modalNuevoGasto');
      this.loadDashboard();
    } catch (err) {
      this.toast('Error al guardar gasto.', 'error');
    }
  },

  abrirModalNuevoCliente() {
    document.getElementById('newClientNombre').value = '';
    document.getElementById('newClientTelefono').value = '';
    document.getElementById('newClientCorreo').value = '';
    document.getElementById('newClientPlaca').value = '';
    document.getElementById('newClientTipo').value = 'carro';
    document.getElementById('newClientMarca').value = '';
    document.getElementById('newClientColor').value = '';
    this.openModal('modalNuevoCliente');
  },

  // Crear Cliente desde Modal
  async guardarNuevoCliente() {
    const nombre = document.getElementById('newClientNombre').value;
    const telefono = document.getElementById('newClientTelefono').value;
    const correo = document.getElementById('newClientCorreo').value;
    const placa = document.getElementById('newClientPlaca').value;
    const tipo = document.getElementById('newClientTipo').value;
    const marca = document.getElementById('newClientMarca').value;
    const color = document.getElementById('newClientColor').value;

    if (!nombre || !telefono || !placa) { this.toast('Nombre, teléfono y placa son obligatorios.', 'warning'); return; }
    if (!esNombreValido(nombre)) { this.toast('El nombre debe tener solo letras y espacios, mínimo 3 caracteres.', 'warning'); return; }
    if (!esTelefonoValido(telefono)) { this.toast('El teléfono debe tener solo números (7 a 10 dígitos).', 'warning'); return; }
    if (correo && !esCorreoValido(correo)) { this.toast('El correo electrónico no tiene un formato válido.', 'warning'); return; }

    try {
      const data = await ApiCliente.post('/api/clientes', { nombre, telefono, correo, placa, tipo, marca, color });
      this.toast(`Cliente ${nombre} y vehículo ${placa} registrados con éxito.`, 'success');
      this.closeModal('modalNuevoCliente');
      await this.loadClients();
      document.getElementById('posClienteSelect').value = data.cliente.id;
      this.onPosClienteChange();
      setTimeout(() => { if (data.vehiculo) document.getElementById('posVehiculoSelect').value = data.vehiculo.id; }, 100);
      if (this.activeTab === 'clientes') this.loadClientesAdmin();
    } catch (err) {
      this.toast('Error al registrar cliente.', 'error');
    }
  },

  // ===========================================================================
  // ADMINISTRAR CLIENTES (pestaña "Clientes")
  // ===========================================================================
  async loadClientesAdmin() {
    try {
      await this.loadClients();
      const tbody = document.getElementById('clientesAdminTableBody');
      if (!tbody) return;

      if (this.clients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay clientes registrados todavía.</td></tr>`;
        return;
      }

      tbody.innerHTML = this.clients.map(c => {
        const placas = (c.vehiculos || []).map(v => v.placa).join(', ') || 'Sin vehículos';
        const registrado = c.creado_en ? String(c.creado_en).substring(0, 10) : '--';
        return `
          <tr>
            <td><strong>${c.nombre}</strong></td>
            <td>${c.telefono}</td>
            <td>${c.correo || '--'}</td>
            <td>${placas}</td>
            <td>${registrado}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="app.abrirModalEditarCliente(${c.id}, '${c.nombre.replace(/'/g, "\\'")}', '${c.telefono}', '${(c.correo || '').replace(/'/g, "\\'")}')">Editar</button></td>
          </tr>
        `;
      }).join('');
    } catch (err) { console.error(err); }
  },

  abrirModalEditarCliente(id, nombre, telefono, correo) {
    this.editingClienteId = id;
    document.getElementById('editClienteNombre').value = nombre;
    document.getElementById('editClienteTelefono').value = telefono;
    document.getElementById('editClienteCorreo').value = correo;
    this.openModal('modalEditarCliente');
  },

  async guardarEdicionCliente() {
    const nombre = document.getElementById('editClienteNombre').value;
    const telefono = document.getElementById('editClienteTelefono').value;
    const correo = document.getElementById('editClienteCorreo').value;
    if (!nombre || !telefono) { this.toast('Nombre y teléfono son obligatorios.', 'warning'); return; }
    if (!esNombreValido(nombre)) { this.toast('El nombre debe tener solo letras y espacios, mínimo 3 caracteres.', 'warning'); return; }
    if (!esTelefonoValido(telefono)) { this.toast('El teléfono debe tener solo números (7 a 10 dígitos).', 'warning'); return; }
    if (correo && !esCorreoValido(correo)) { this.toast('El correo electrónico no tiene un formato válido.', 'warning'); return; }

    try {
      await ApiCliente.put(`/api/clientes/${this.editingClienteId}`, { nombre, telefono, correo });
      this.toast('Cliente actualizado con éxito.', 'success');
      this.closeModal('modalEditarCliente');
      this.loadClientesAdmin();
    } catch (err) {
      this.toast(err.message || 'Error al actualizar cliente.', 'error');
    }
  },

  // Crear Personal (usuario con login o lavador sin login). Usuario y
  // contraseña siempre se asignan automáticamente (ver modal).
  abrirModalNuevoUsuario() {
    document.getElementById('usrNombre').value = '';
    document.getElementById('usrDocumento').value = '';
    document.getElementById('usrTelefono').value = '';
    document.getElementById('usrRol').value = 'lavador';
    document.getElementById('usrComision').value = 60;
    document.getElementById('usrSalario').value = 1400000;
    document.getElementById('usrPeriodicidad').value = 'quincenal';
    document.getElementById('usrJornadaHoras').value = 8;
    document.getElementById('usrDiasDescanso').value = 1;
    this.onUsrRolChange();
    this.openModal('modalNuevoUsuario');
  },

  onUsrRolChange() {
    const rol = document.getElementById('usrRol').value;
    const lavFields = document.getElementById('usrLavadorFields');
    const empFields = document.getElementById('usrEmpleadoFields');
    if (rol === 'lavador') {
      lavFields.classList.remove('hidden');
      empFields.classList.add('hidden');
    } else {
      lavFields.classList.add('hidden');
      empFields.classList.remove('hidden');
    }
  },

  async guardarNuevoUsuario() {
    const nombre = document.getElementById('usrNombre').value;
    const documento = document.getElementById('usrDocumento').value;
    const telefono = document.getElementById('usrTelefono').value;
    const rol = document.getElementById('usrRol').value;

    if (!nombre || !documento) { this.toast('Nombre y documento son obligatorios.', 'warning'); return; }
    if (!esNombreValido(nombre)) { this.toast('El nombre debe tener solo letras y espacios, mínimo 3 caracteres.', 'warning'); return; }
    if (!esDocumentoValido(documento)) { this.toast('El documento debe tener solo números, mínimo 4 dígitos.', 'warning'); return; }
    if (telefono && !esTelefonoValido(telefono)) { this.toast('El teléfono debe tener solo números (7 a 10 dígitos).', 'warning'); return; }

    try {
      if (rol === 'lavador') {
        const porcentajeComision = document.getElementById('usrComision').value;
        await ApiCliente.post('/api/personal/lavadores', { nombre, documento, telefono, porcentajeComision });
        this.toast(`Personal ${nombre} creado con éxito.`, 'success');
      } else {
        const salarioFijo = document.getElementById('usrSalario').value;
        const periodicidadPago = document.getElementById('usrPeriodicidad').value;
        const jornadaHorasDia = document.getElementById('usrJornadaHoras').value;
        const diasDescansoSemana = document.getElementById('usrDiasDescanso').value;

        const nuevo = await ApiCliente.post('/api/personal/usuarios', { nombre, documento, telefono, rol, salarioFijo, periodicidadPago, jornadaHorasDia, diasDescansoSemana });
        alert(`Cuenta creada para ${nombre}.\n\nUsuario: ${nuevo.username}\nContraseña temporal: ${nuevo.passwordAsignada}\n\nCompártela con la persona; puede cambiarla desde "Mi Perfil" -> "Cambiar Contraseña".`);
        this.toast(`Personal ${nombre} creado con éxito.`, 'success');
      }

      this.closeModal('modalNuevoUsuario');
      this.loadWashers();
      this.loadNomina();
    } catch (err) {
      this.toast(err.message || 'Error al crear usuario.', 'error');
    }
  },

  // ===========================================================================
  // CONTRASEÑAS: cambio propio (todos los roles) y reinicio por el admin
  // ===========================================================================
  async cambiarMiContrasena() {
    const contrasenaActual = document.getElementById('cambioPassActual').value;
    const contrasenaNueva = document.getElementById('cambioPassNueva').value;
    const contrasenaConfirmar = document.getElementById('cambioPassConfirmar').value;

    if (!contrasenaActual || !contrasenaNueva) { this.toast('Complete la contraseña actual y la nueva.', 'warning'); return; }
    if (contrasenaNueva !== contrasenaConfirmar) { this.toast('La confirmación no coincide con la nueva contraseña.', 'warning'); return; }
    if (contrasenaNueva.length < 6) { this.toast('La nueva contraseña debe tener al menos 6 caracteres.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/auth/cambiar-contrasena', { contrasenaActual, contrasenaNueva });
      this.toast('Contraseña actualizada correctamente.', 'success');
      document.getElementById('cambioPassActual').value = '';
      document.getElementById('cambioPassNueva').value = '';
      document.getElementById('cambioPassConfirmar').value = '';
      this.closeModal('modalCambiarContrasena');
    } catch (err) {
      this.toast(err.message || 'No se pudo cambiar la contraseña.', 'error');
    }
  },

  /** Botón visible solo para admin: reinicia la contraseña de otro usuario al valor por defecto. */
  async reiniciarContrasenaUsuario(id, nombre) {
    if (!confirm(`¿Reiniciar la contraseña de ${nombre} al valor por defecto (cédula + carwash)?`)) return;
    try {
      const data = await ApiCliente.post(`/api/personal/usuarios/${id}/reiniciar-contrasena`, {});
      alert(`Contraseña de ${nombre} reiniciada.\n\nNueva contraseña temporal: ${data.passwordAsignada}`);
      this.toast('Contraseña reiniciada.', 'success');
    } catch (err) {
      this.toast(err.message || 'No se pudo reiniciar la contraseña.', 'error');
    }
  },

  /** Botón visible solo para admin: edita los datos de un empleado (el empleado mismo solo puede cambiar su contraseña). */
  abrirModalEditarEmpleado(id, nombre, telefono, correo, salarioFijo, periodicidadPago, jornadaHorasDia, diasDescansoSemana) {
    this.editingEmpleadoId = id;
    document.getElementById('editEmpNombre').value = nombre;
    document.getElementById('editEmpTelefono').value = telefono;
    document.getElementById('editEmpCorreo').value = correo;
    document.getElementById('editEmpSalario').value = salarioFijo;
    document.getElementById('editEmpPeriodicidad').value = periodicidadPago;
    document.getElementById('editEmpJornadaHoras').value = jornadaHorasDia || 8;
    document.getElementById('editEmpDiasDescanso').value = diasDescansoSemana ?? 1;
    this.openModal('modalEditarEmpleado');
  },

  async guardarEdicionEmpleado() {
    const nombre = document.getElementById('editEmpNombre').value.trim();
    const telefono = document.getElementById('editEmpTelefono').value.trim();
    const correo = document.getElementById('editEmpCorreo').value.trim();
    const salarioFijo = document.getElementById('editEmpSalario').value;
    const periodicidadPago = document.getElementById('editEmpPeriodicidad').value;
    const jornadaHorasDia = document.getElementById('editEmpJornadaHoras').value;
    const diasDescansoSemana = document.getElementById('editEmpDiasDescanso').value;
    if (!nombre) { this.toast('El nombre es obligatorio.', 'warning'); return; }
    if (!esNombreValido(nombre)) { this.toast('El nombre debe tener solo letras y espacios, mínimo 3 caracteres.', 'warning'); return; }
    if (telefono && !esTelefonoValido(telefono)) { this.toast('El teléfono debe tener solo números (7 a 10 dígitos).', 'warning'); return; }
    if (correo && !esCorreoValido(correo)) { this.toast('El correo electrónico no tiene un formato válido.', 'warning'); return; }

    try {
      await ApiCliente.put(`/api/personal/usuarios/${this.editingEmpleadoId}`, { nombre, telefono, correo, salarioFijo, periodicidadPago, jornadaHorasDia, diasDescansoSemana });
      this.toast('Datos del empleado actualizados.', 'success');
      this.closeModal('modalEditarEmpleado');
      this.loadNomina();
    } catch (err) {
      this.toast(err.message || 'No se pudo actualizar el empleado.', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
