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
  pendingOrdenPayload: null,
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

    switch (tabId) {
      case 'pos': this.loadTurnos(); break;
      case 'tablero': this.loadOrders(); break;
      case 'citas': this.loadCitas(); break;
      case 'inventario': this.loadInsumos(); break;
      case 'servicios': this.loadServicios(); break;
      case 'nomina': this.loadNomina(); break;
      case 'caja': this.loadCaja(); break;
      case 'dashboard': this.loadDashboard(); break;
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
    if (guardado === 'colapsado') {
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
    await Promise.all([
      this.loadServices(),
      this.loadWashers(),
      this.loadClients(),
      this.loadTurnos(),
      this.loadInsumos(),
      this.loadOrders()
    ]);
    this.updateRolePermissions();
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
    return '$' + (num || 0).toLocaleString('es-CO');
  },

  // ===========================================================================
  // 1. MÓDULO POS (CU01, CU02, CU07, CU08)
  // ===========================================================================
  async loadServices() {
    try {
      this.services = await ApiCliente.get('/api/servicios');
      this.renderPosServices();

      ['citaServicioSelect', 'turnoServicioSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.innerHTML = this.services.map(s => `
            <option value="${s.id}">${s.nombre} (${s.tipo_vehiculo}) - ${this.formatMoney(s.precio)}</option>
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
      filtrados = filtrados.filter(s => s.tipo_vehiculo === anonTipo || s.tipo_vehiculo === 'ambos');
    }

    grid.innerHTML = filtrados.map(s => `
      <div class="service-card ${this.selectedServiceId === s.id ? 'selected' : ''}" onclick="app.selectService(${s.id})">
        <span class="service-card-tag">${s.tipo_vehiculo}</span>
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

    const numero_turno = document.getElementById('posNumeroTurno').value || null;
    const payload = { cliente_id, vehiculo_id, servicio_id: this.selectedServiceId, placa_temporal, tipo_vehiculo, numero_turno };

    try {
      const data = await ApiCliente.post('/api/turnos', payload);
      this.toast(`Turno #${data.numero_turno || ''} agregado a la fila.`, 'success');
      this.selectedServiceId = null;
      document.getElementById('posNumeroTurno').value = '';
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
          <button class="btn btn-sm btn-primary" onclick="app.atenderTurno(${t.id}, ${t.servicio_id}, '${t.placa}', '${t.tipo_vehiculo}')">Iniciar</button>
        </div>
      `).join('');
    } catch (err) { console.error(err); }
  },

  atenderTurno(turnoId, servicioId, placa, tipo) {
    this.abrirModalAsignarLavador(
      { turno_id: turnoId, servicio_id: servicioId, es_venta_anonima: true, placa_anonima: placa, tipo_vehiculo_anonimo: tipo },
      () => { this.loadTurnos(); this.loadOrders(); this.setTab('tablero'); }
    );
  },

  async guardarNuevoTurno() {
    const placa = document.getElementById('turnoPlaca').value;
    const tipo = document.getElementById('turnoTipo').value;
    const servicio_id = document.getElementById('turnoServicioSelect').value;
    const numero_turno = document.getElementById('turnoNumeroTurno').value || null;
    try {
      await ApiCliente.post('/api/turnos', { placa_temporal: placa, tipo_vehiculo: tipo, servicio_id, numero_turno });
      this.toast('Turno registrado con éxito.', 'success');
      this.closeModal('modalNuevoTurno');
      document.getElementById('turnoNumeroTurno').value = '';
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
    let actionButtons = '';

    if (o.estado === 'recibido') {
      actionButtons = `<button class="btn btn-sm btn-primary" style="width: 100%" onclick="app.updateOrderStatus(${o.id}, 'en_proceso')">Iniciar Lavado</button>`;
    } else if (o.estado === 'en_proceso') {
      actionButtons = `<button class="btn btn-sm btn-success" style="width: 100%" onclick="app.updateOrderStatus(${o.id}, 'terminado')">Terminar Lavado</button>`;
    } else if (o.estado === 'terminado') {
      actionButtons = `<button class="btn btn-sm btn-primary" style="width: 100%" onclick="app.openPayModal(${o.id}, ${o.total})">Cobrar y Entregar Vehículo</button>`;
    } else if (o.estado === 'entregado') {
      const metodo = o.pago ? o.pago.metodo_pago.toUpperCase() : 'PAGADO';
      actionButtons = `<span class="text-sm text-success" style="font-weight: 700">Entregado • Pago: ${metodo}</span>`;
    }

    return `
      <div class="order-card-header">
        <span class="order-id-badge">Orden #${o.id}</span>
        <span class="order-plate-tag">${o.placa || 'SIN PLACA'}</span>
      </div>
      <div class="order-service-title">${o.servicio_nombre}</div>
      <div class="order-meta-info"><span>Cliente: ${o.cliente_nombre}</span> • <span>${this.formatMoney(o.total)}</span></div>
      <div class="order-washers-info">Lavador(es): <strong>${lavadoresNombres}</strong></div>
      <div class="order-actions">${actionButtons}</div>
    `;
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
      this.toast('Error al actualizar estado de la orden.', 'error');
    }
  },

  openPayModal(orderId, total) {
    this.payingOrderId = orderId;
    document.getElementById('payModalOrdenId').textContent = `#${orderId}`;
    document.getElementById('payModalMonto').textContent = this.formatMoney(total);
    this.openModal('modalPagarOrden');
  },

  async confirmarPagoOrden() {
    if (!this.payingOrderId) return;
    const metodo = document.querySelector('input[name="payMetodo"]:checked').value;
    try {
      await ApiCliente.post('/api/caja/pagos', { orden_id: this.payingOrderId, metodo_pago: metodo });
      this.toast(`Pago de orden #${this.payingOrderId} registrado con éxito vía ${metodo.toUpperCase()}.`, 'success');
      this.closeModal('modalPagarOrden');
      this.payingOrderId = null;
      this.loadOrders();
      this.loadCaja();
    } catch (err) {
      this.toast('Error al registrar el pago.', 'error');
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
    const cid = document.getElementById('citaClienteSelect').value;
    const anonFields = document.getElementById('citaCamposAnonimos');
    anonFields.classList.toggle('hidden', !!cid);
  },

  async guardarNuevaCita() {
    const cliente_id = document.getElementById('citaClienteSelect').value || null;
    const cliente_nombre = document.getElementById('citaAnonNombre').value;
    const placa = document.getElementById('citaAnonPlaca').value;
    const servicio_id = document.getElementById('citaServicioSelect').value;
    const fecha = document.getElementById('citaFechaInput').value;
    const hora = document.getElementById('citaHoraInput').value;

    if (!servicio_id || !fecha || !hora) { this.toast('Complete el servicio, la fecha y la hora.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/citas', { cliente_id, cliente_nombre, placa, servicio_id, fecha, hora });
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
   * cita: en vez de atenderla de inmediato, la pasa a la fila de turnos
   * (con número de turno manual opcional). La cita queda vinculada al
   * turno (cita_id) para que, cuando ese turno se atienda, la cita quede
   * marcada como atendida automáticamente.
   */
  async agregarCitaAFila(citaId, servicioId, clienteId, vehiculoId, placa, tipo) {
    const numero_turno = prompt('Número de turno (opcional, dejar vacío para asignarlo por orden de llegada):', '') || null;
    try {
      await ApiCliente.post('/api/turnos', {
        cliente_id: clienteId, vehiculo_id: vehiculoId, cita_id: citaId,
        placa_temporal: placa, tipo_vehiculo: tipo, servicio_id: servicioId, numero_turno
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

  /**
   * Modal compartido para atender una cita o un turno: al final los dos
   * casos crean una orden (POST /api/ordenes) igual que la venta directa
   * del POS, así que reutilizan la misma elección de lavador(es)
   * automática o manual (1 a 3).
   */
  async abrirModalAsignarLavador(payloadBase, onSuccess) {
    this.pendingOrdenPayload = payloadBase;
    this.pendingOrdenOnSuccess = onSuccess;
    this.selectedWashersAsignacion = [];
    document.getElementById('asignLavAutoCheck').checked = true;
    document.getElementById('asignLavManualWrapper').classList.add('hidden');
    document.getElementById('asignLavAutoIndicator').classList.remove('hidden');
    await this.loadWashers(); // refresca disponible_hoy antes de mostrar el picker
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
    list.innerHTML = (this.washers || []).map(w => {
      const selected = this.selectedWashersAsignacion.includes(w.id);
      const disponible = !!w.disponible_hoy;
      const clases = ['washer-pill'];
      if (selected) clases.push('selected');
      if (!disponible) clases.push('disabled');
      return `
        <div class="${clases.join(' ')}" onclick="app.toggleAsignLavSelection(${w.id}, ${disponible})" title="${disponible ? '' : 'No ha registrado entrada hoy'}">
          <span class="washer-status-dot"></span>
          <span>${w.nombre.split(' ')[0]} (${w.porcentaje_comision}%)${disponible ? '' : ' — sin entrada'}</span>
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
    const payload = { ...this.pendingOrdenPayload, lavadores_ids: isAuto ? [] : this.selectedWashersAsignacion };

    try {
      await ApiCliente.post('/api/ordenes', payload);
      this.toast('Orden de servicio iniciada con éxito.', 'success');
      this.closeModal('modalAsignarLavador');
      if (this.pendingOrdenOnSuccess) this.pendingOrdenOnSuccess();
      this.pendingOrdenPayload = null;
      this.pendingOrdenOnSuccess = null;
    } catch (err) {
      this.toast(err.message || 'Error al iniciar la orden.', 'error');
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
      ['entradaProveedorSelect', 'editInsProveedorSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = proveedoresActivos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
      });

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

    let costo_unitario = precioIngresado;
    if (precioIngresado !== '' && modoPrecio === 'total') {
      costo_unitario = Number(precioIngresado) / Number(cantidad);
    }

    try {
      await ApiCliente.post('/api/inventario/entradas', { insumo_id, cantidad, costo_unitario, proveedor_id, observacion });
      this.toast('Entrada registrada. Stock y costo actualizados inmediatamente.', 'success');
      this.closeModal('modalEntradaInsumo');
      this.loadInsumos();
    } catch (err) {
      this.toast(err.message || 'Error al registrar entrada de insumo.', 'error');
    }
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
          <td>${s.tipo_vehiculo}</td>
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
    document.getElementById('servTipoVehiculo').value = 'carro';
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
    document.getElementById('servTipoVehiculo').value = s.tipo_vehiculo;
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
              <div class="text-sm mt-1">${w.disponible_hoy ? '<span class="role-badge" style="background: #10b981">DISPONIBLE HOY</span>' : '<span class="role-badge" style="background: #ef4444">SIN ENTRADA HOY</span>'}</div>
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
          tbLiq.innerHTML = liquidaciones.map(l => `
            <tr>
              <td>#${l.id}</td>
              <td><strong>${l.lavador_nombre}</strong></td>
              <td>${l.periodo_inicio} al ${l.periodo_fin}</td>
              <td>${this.formatMoney(l.total_comision)}</td>
              <td>${this.formatMoney(l.descuentos)}</td>
              <td><strong class="text-success">${this.formatMoney(l.valor_a_pagar)}</strong></td>
              <td><span class="role-badge" style="background: ${l.estado === 'pagado' ? '#10b981' : '#f59e0b'}">${l.estado.toUpperCase()}</span></td>
              <td class="text-sm">${l.soporte_pago_url ? `Soporte: ${l.soporte_pago_url}` : '<span class="text-muted">Pendiente de soporte</span>'}</td>
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
                <button class="btn btn-sm btn-primary" onclick="app.pagarSalarioEmpleado(${e.empleado_id}, '${e.nombre}', ${e.salario_fijo})">Pagar Salario</button>
                <button class="btn btn-sm btn-outline" onclick="app.abrirModalEditarEmpleado(${e.empleado_id}, '${e.nombre.replace(/'/g, "\\'")}', '${(e.telefono || '').replace(/'/g, "\\'")}', '${(e.correo || '').replace(/'/g, "\\'")}', ${e.salario_fijo}, '${e.periodicidad_pago}')">Editar</button>
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
          tbPagos.innerHTML = pagos.map(p => `
            <tr>
              <td>#${p.id}</td>
              <td><strong>${p.empleado_nombre}</strong></td>
              <td>${p.fecha_pago_real}</td>
              <td><strong>${this.formatMoney(p.valor_a_pagar)}</strong></td>
              <td>${this.formatMoney(p.descuentos)}</td>
              <td>${p.soporte_pago_url}</td>
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
              <td>${a.horas_trabajadas} hrs</td>
              <td>${a.inasistencia ? '<span class="role-badge" style="background: #ef4444">INASISTENCIA (Descuenta)</span>' : '<span class="role-badge" style="background: #10b981">PRESENTE</span>'}</td>
              <td>${!a.hora_salida && !a.inasistencia ? `<button class="btn btn-sm btn-secondary" onclick="app.marcarSalida('${a.persona_tipo}', ${a.persona_id})">Marcar Salida</button>` : '<span class="text-sm text-muted">Jornada finalizada</span>'}</td>
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
    document.getElementById('pagLiqSoporte').value = '';
    this.openModal('modalPagarLiquidacion');
  },

  async confirmarPagoLiquidacion() {
    const soporte = document.getElementById('pagLiqSoporte').value.trim();
    const fecha = document.getElementById('pagLiqFecha').value;
    if (!soporte) { this.toast('El sistema exige adjuntar el soporte de pago.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/nomina/pagar-liquidacion', { liquidacion_id: this.payingLiqId, soporte_pago_url: soporte, fecha_pago: fecha });
      this.toast('Liquidación pagada y registrada con soporte en auditoría.', 'success');
      this.closeModal('modalPagarLiquidacion');
      this.loadNomina();
    } catch (err) {
      this.toast('Error al procesar pago de liquidación.', 'error');
    }
  },

  async pagarSalarioEmpleado(empleadoId, nombre, salarioBase) {
    const soporte = prompt(`Ingrese el soporte o comprobante de pago para ${nombre}:`, `Comprobante_Nomina_${nombre.split(' ')[0]}.pdf`);
    if (!soporte) return;
    const descuentos = prompt('¿Desea aplicar algún descuento por inasistencia u otro motivo? (0 si no aplica):', '0') || '0';

    try {
      await ApiCliente.post('/api/nomina/pagar-empleado', { empleado_id: empleadoId, salario_base: salarioBase, descuentos: parseFloat(descuentos) || 0, soporte_pago_url: soporte });
      this.toast(`Salario pagado a ${nombre} con soporte adjunto.`, 'success');
      this.loadNomina();
    } catch (err) {
      this.toast('Error al registrar pago de salario.', 'error');
    }
  },

  async abrirModalAsistencia() {
    await this.cargarPersonalParaAsistencia();
    this.openModal('modalAsistencia');
  },

  async guardarAsistencia() {
    const [persona_tipo, persona_id] = document.getElementById('asistPersonalSelect').value.split(':');
    const tipo = document.getElementById('asistTipoSelect').value;

    try {
      await ApiCliente.post('/api/nomina/asistencia', {
        persona_tipo, persona_id: parseInt(persona_id, 10),
        tipo: tipo === 'inasistencia' ? null : tipo,
        inasistencia: tipo === 'inasistencia'
      });
      this.toast('Registro de asistencia guardado.', 'success');
      this.closeModal('modalAsistencia');
      this.loadNomina();
    } catch (err) {
      this.toast('Error al registrar asistencia.', 'error');
    }
  },

  async marcarSalida(personaTipo, personaId) {
    try {
      await ApiCliente.post('/api/nomina/asistencia', { persona_tipo: personaTipo, persona_id: personaId, tipo: 'salida' });
      this.toast('Hora de salida registrada y horas laboradas calculadas.', 'success');
      this.loadNomina();
    } catch (err) {
      this.toast('Error al marcar salida.', 'error');
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
      if (data.esta_cerrada) {
        btnCerrar.disabled = true;
        btnCerrar.textContent = 'Caja de Hoy Ya Cerrada';
      } else {
        btnCerrar.disabled = false;
        btnCerrar.textContent = 'Realizar Cierre de Caja';
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
  // 8. REPORTES: GANANCIAS Y DESCARGA EN PDF (CU18, CU19, CU29)
  // ===========================================================================
  setDashboardPeriod(period) {
    this.dashboardPeriod = period;
    document.querySelectorAll('.period-btn').forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-period') === period));
    document.getElementById('reportePersonalizadoBox').classList.toggle('hidden', period !== 'personalizado');
    this.loadDashboard();
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

      const cCount = data.distribucionVehiculos.carro || 0;
      const mCount = data.distribucionVehiculos.moto || 0;
      const totVeh = cCount + mCount || 1;
      document.getElementById('dashCarrosCount').textContent = `${cCount} (${Math.round((cCount / totVeh) * 100)}%)`;
      document.getElementById('dashMotosCount').textContent = `${mCount} (${Math.round((mCount / totVeh) * 100)}%)`;
      document.getElementById('dashCarrosBar').style.width = `${(cCount / totVeh) * 100}%`;
      document.getElementById('dashMotosBar').style.width = `${(mCount / totVeh) * 100}%`;

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
    const url = `/api/reportes/dashboard/pdf?${this.construirQueryPeriodo()}`;
    try {
      const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${ApiCliente.obtenerToken()}` } });
      if (!respuesta.ok) throw new Error('No se pudo generar el PDF.');
      const blob = await respuesta.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.download = 'reporte_carwash.pdf';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
    } catch (err) {
      this.toast('No se pudo descargar el PDF del reporte.', 'error');
    }
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

    try {
      const data = await ApiCliente.post('/api/clientes', { nombre, telefono, correo, placa, tipo, marca, color });
      this.toast(`Cliente ${nombre} y vehículo ${placa} registrados con éxito.`, 'success');
      this.closeModal('modalNuevoCliente');
      await this.loadClients();
      document.getElementById('posClienteSelect').value = data.cliente.id;
      this.onPosClienteChange();
      setTimeout(() => { if (data.vehiculo) document.getElementById('posVehiculoSelect').value = data.vehiculo.id; }, 100);
    } catch (err) {
      this.toast('Error al registrar cliente.', 'error');
    }
  },

  // Crear Personal (usuario con login o lavador sin login). Usuario y
  // contraseña siempre se asignan automáticamente (ver modal).
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

    try {
      if (rol === 'lavador') {
        const porcentajeComision = document.getElementById('usrComision').value;
        await ApiCliente.post('/api/personal/lavadores', { nombre, documento, telefono, porcentajeComision });
        this.toast(`Personal ${nombre} creado con éxito.`, 'success');
      } else {
        const salarioFijo = document.getElementById('usrSalario').value;
        const periodicidadPago = document.getElementById('usrPeriodicidad').value;

        const nuevo = await ApiCliente.post('/api/personal/usuarios', { nombre, documento, telefono, rol, salarioFijo, periodicidadPago });
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
  abrirModalEditarEmpleado(id, nombre, telefono, correo, salarioFijo, periodicidadPago) {
    this.editingEmpleadoId = id;
    document.getElementById('editEmpNombre').value = nombre;
    document.getElementById('editEmpTelefono').value = telefono;
    document.getElementById('editEmpCorreo').value = correo;
    document.getElementById('editEmpSalario').value = salarioFijo;
    document.getElementById('editEmpPeriodicidad').value = periodicidadPago;
    this.openModal('modalEditarEmpleado');
  },

  async guardarEdicionEmpleado() {
    const nombre = document.getElementById('editEmpNombre').value.trim();
    const telefono = document.getElementById('editEmpTelefono').value.trim();
    const correo = document.getElementById('editEmpCorreo').value.trim();
    const salarioFijo = document.getElementById('editEmpSalario').value;
    const periodicidadPago = document.getElementById('editEmpPeriodicidad').value;
    if (!nombre) { this.toast('El nombre es obligatorio.', 'warning'); return; }

    try {
      await ApiCliente.put(`/api/personal/usuarios/${this.editingEmpleadoId}`, { nombre, telefono, correo, salarioFijo, periodicidadPago });
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
