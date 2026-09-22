/**
 * CARWASH PRO - LÓGICA PRINCIPAL DEL CLIENTE (JavaScript Vanilla)
 *
 * Consume la API REST del backend (backend/src) usando el cliente
 * centralizado ApiCliente (js/api.js), que ya adjunta el token JWT de la
 * sesión activa. Las secciones están organizadas igual que los módulos del
 * backend para que sea fácil ubicar la lógica de cada pantalla.
 */
const app = {
  currentUser: null,
  activeTab: 'pos',
  activeSubTabNomina: 'lavadores',
  dashboardPeriod: 'dia',
  selectedServiceId: null,
  selectedWashers: [],
  payingOrderId: null,
  liquidatingWasher: null,
  payingLiqId: null,

  // ===========================================================================
  // INICIALIZACIÓN Y SESIÓN
  // ===========================================================================
  init() {
    this.currentUser = exigirSesionActiva();
    if (!this.currentUser) return; // exigirSesionActiva ya redirigió a login.html

    this.pintarBarraSesion();
    this.initTheme();
    this.startClock();
    this.setupDatePickers();
    this.loadInitialData();

    setInterval(() => {
      if (this.activeTab === 'tablero') this.loadOrders();
      if (this.activeTab === 'pos') this.loadTurnos();
    }, 30000);
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
    if (tabId === 'dashboard' && this.currentUser.rol !== 'administrador') {
      this.toast('Acceso denegado: el dashboard financiero es exclusivo para Administrador.', 'error');
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
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    if (icon && text) {
      icon.textContent = isLight ? '🌙' : '☀️';
      text.textContent = isLight ? 'Modo Oscuro' : 'Modo Claro';
    }
  },

  startClock() {
    const clockEl = document.getElementById('liveClock');
    const update = () => { clockEl.textContent = new Date().toLocaleTimeString('es-CO'); };
    update();
    setInterval(update, 1000);
  },

  setupDatePickers() {
    const hoy = new Date().toISOString().split('T')[0];
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
  // MI PERFIL (ver mi propio salario / datos)
  // ===========================================================================
  async abrirMiPerfil() {
    try {
      const perfil = await ApiCliente.get('/api/personal/mi-perfil');
      document.getElementById('miPerfilNombre').textContent = perfil.nombre;
      document.getElementById('miPerfilRol').textContent = perfil.es_admin_principal ? 'ADMINISTRADOR PRINCIPAL' : perfil.rol.toUpperCase();
      document.getElementById('miPerfilDocumento').textContent = perfil.documento;
      document.getElementById('miPerfilIngreso').textContent = perfil.fecha_ingreso;
      document.getElementById('miPerfilSalario').textContent = this.formatMoney(perfil.salario_fijo);
      document.getElementById('miPerfilPeriodicidad').textContent = (perfil.periodicidad_pago || '').toUpperCase();
      this.openModal('modalMiPerfil');
    } catch (err) {
      this.toast('No se pudo cargar tu perfil.', 'error');
    }
  },

  // ===========================================================================
  // TOAST NOTIFICATIONS & MODALS
  // ===========================================================================
  toast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
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
          <span class="service-card-time">⏱️ ${s.duracion_estimada_min} min</span>
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
          <strong>✅ Vehículo Encontrado:</strong> ${data.vehiculo.placa} (${data.vehiculo.marca} - ${data.vehiculo.color})<br>
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
          <strong>ℹ️ Placa no registrada:</strong> "${placa}" es nueva.<br>
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
      this.renderWashersSelection();

      const entregaSelect = document.getElementById('entregaLavadorSelect');
      if (entregaSelect) {
        entregaSelect.innerHTML = this.washers.map(w => `<option value="${w.id}">${w.nombre}</option>`).join('');
      }
    } catch (err) { console.error(err); }
  },

  renderWashersSelection() {
    const list = document.getElementById('posWashersList');
    if (!list) return;
    list.innerHTML = (this.washers || []).map(w => {
      const selected = this.selectedWashers.includes(w.id);
      return `
        <div class="washer-pill ${selected ? 'selected' : ''}" onclick="app.toggleWasherSelection(${w.id})">
          <span class="washer-status-dot"></span>
          <span>${w.nombre.split(' ')[0]} (${w.porcentaje_comision}%)</span>
        </div>
      `;
    }).join('');
  },

  toggleWasherSelection(id) {
    if (this.selectedWashers.includes(id)) {
      this.selectedWashers = this.selectedWashers.filter(wid => wid !== id);
    } else {
      this.selectedWashers.push(id);
    }
    this.renderWashersSelection();
  },

  toggleAutoAssign() {
    const isAuto = document.getElementById('posAutoAssignCheck').checked;
    const manualWrap = document.getElementById('posManualWashersWrapper');
    const autoInd = document.getElementById('posAutoAssignIndicator');
    if (isAuto) {
      manualWrap.classList.add('hidden');
      autoInd.classList.remove('hidden');
      this.selectedWashers = [];
    } else {
      manualWrap.classList.remove('hidden');
      autoInd.classList.add('hidden');
      this.renderWashersSelection();
    }
  },

  async submitPosOrder() {
    if (!this.selectedServiceId) { this.toast('Por favor seleccione un servicio de lavado para continuar.', 'warning'); return; }

    const mode = document.querySelector('input[name="posClientType"]:checked').value;
    let cliente_id = null, vehiculo_id = null, es_venta_anonima = false, placa_anonima = '', tipo_vehiculo_anonimo = 'carro';

    if (mode === 'registrado') {
      cliente_id = document.getElementById('posClienteSelect').value;
      vehiculo_id = document.getElementById('posVehiculoSelect').value;
      if (!cliente_id) { this.toast('Seleccione un cliente registrado o elija Venta Rápida / Anónima.', 'warning'); return; }
    } else {
      es_venta_anonima = true;
      placa_anonima = document.getElementById('posAnonPlaca').value;
      tipo_vehiculo_anonimo = document.getElementById('posAnonTipo').value;
    }

    const payload = { cliente_id, vehiculo_id, servicio_id: this.selectedServiceId, es_venta_anonima, placa_anonima, tipo_vehiculo_anonimo, lavadores_ids: this.selectedWashers };

    try {
      const data = await ApiCliente.post('/api/ordenes', payload);
      this.toast(`¡Orden de Lavado #${data.id} iniciada con éxito!`, 'success');
      this.selectedServiceId = null;
      this.selectedWashers = [];
      this.renderPosServices();
      this.loadOrders();
      setTimeout(() => this.setTab('tablero'), 600);
    } catch (err) {
      this.toast(err.message || 'Error al iniciar la orden.', 'error');
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
            <strong>#${idx + 1} Turno - ${t.placa || 'Sin Placa'} (${t.tipo_vehiculo})</strong>
            <span>${t.servicio_nombre} • Hora: ${t.hora_llegada} • ${this.formatMoney(t.servicio_precio)}</span>
          </div>
          <button class="btn btn-sm btn-primary" onclick="app.atenderTurno(${t.id}, ${t.servicio_id}, '${t.placa}', '${t.tipo_vehiculo}')">Iniciar</button>
        </div>
      `).join('');
    } catch (err) { console.error(err); }
  },

  async atenderTurno(turnoId, servicioId, placa, tipo) {
    try {
      await ApiCliente.post('/api/ordenes', { turno_id: turnoId, servicio_id: servicioId, es_venta_anonima: true, placa_anonima: placa, tipo_vehiculo_anonimo: tipo });
      this.toast('Turno iniciado e ingresado al tablero de lavado.', 'success');
      this.loadTurnos();
      this.loadOrders();
      this.setTab('tablero');
    } catch (err) {
      this.toast('Error al atender el turno.', 'error');
    }
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
      this.toast('Error al registrar turno.', 'error');
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
      actionButtons = `<button class="btn btn-sm btn-primary" style="width: 100%" onclick="app.updateOrderStatus(${o.id}, 'en_proceso')">▶️ Iniciar Lavado</button>`;
    } else if (o.estado === 'en_proceso') {
      actionButtons = `<button class="btn btn-sm btn-success" style="width: 100%" onclick="app.updateOrderStatus(${o.id}, 'terminado')">🏁 Terminar Lavado (Descuenta Insumos)</button>`;
    } else if (o.estado === 'terminado') {
      actionButtons = `<button class="btn btn-sm btn-primary" style="width: 100%" onclick="app.openPayModal(${o.id}, ${o.total})">💳 Cobrar y Entregar Vehículo</button>`;
    } else if (o.estado === 'entregado') {
      const metodo = o.pago ? o.pago.metodo_pago.toUpperCase() : 'PAGADO';
      actionButtons = `<span class="text-sm text-success" style="font-weight: 700">✓ Entregado • Pago: ${metodo}</span>`;
    }

    return `
      <div class="order-card-header">
        <span class="order-id-badge">Orden #${o.id}</span>
        <span class="order-plate-tag">${o.placa || 'SIN PLACA'}</span>
      </div>
      <div class="order-service-title">${o.servicio_nombre}</div>
      <div class="order-meta-info"><span>👤 ${o.cliente_nombre}</span> • <span>${this.formatMoney(o.total)}</span></div>
      <div class="order-washers-info">🚿 Lavador(es): <strong>${lavadoresNombres}</strong></div>
      <div class="order-actions">${actionButtons}</div>
    `;
  },

  async updateOrderStatus(orderId, nuevoEstado) {
    try {
      await ApiCliente.put(`/api/ordenes/${orderId}/estado`, { estado: nuevoEstado });
      if (nuevoEstado === 'terminado') {
        this.toast(`¡Orden #${orderId} terminada! Insumos descontados automáticamente del inventario.`, 'success');
        this.loadInsumos();
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
      this.toast(`¡Pago de orden #${this.payingOrderId} registrado con éxito vía ${metodo.toUpperCase()}!`, 'success');
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

  async iniciarCita(citaId, servicioId, clienteId, vehiculoId) {
    try {
      await ApiCliente.post('/api/ordenes', { cita_id: citaId, servicio_id: servicioId, cliente_id: clienteId, vehiculo_id: vehiculoId });
      this.toast('Cita convertida en orden de servicio activa.', 'success');
      this.loadCitas();
      this.loadOrders();
      this.setTab('tablero');
    } catch (err) {
      this.toast('Error al iniciar atención de la cita.', 'error');
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
          const isLow = i.stock_actual <= i.stock_minimo;
          return `
            <div class="insumo-card ${isLow ? 'critical' : ''}">
              <div class="insumo-header">
                <span class="insumo-name">${i.nombre}</span>
                <span class="role-badge" style="background: ${isLow ? '#ef4444' : '#10b981'}">${isLow ? '⚠️ BAJO STOCK' : 'EN ORDEN'}</span>
              </div>
              <div class="insumo-stock-val">${Number(i.stock_actual).toLocaleString()} <span class="insumo-unit">${i.unidad_medida}</span></div>
              <div class="text-sm text-muted">Stock Mínimo: ${i.stock_minimo} ${i.unidad_medida}</div>
              <div class="stock-meter"><div class="stock-meter-fill ${isLow ? 'low' : 'normal'}" style="width: ${ratio}%"></div></div>
              <div class="text-sm text-dim">Proveedor: ${i.proveedor_nombre || 'Sin proveedor'}</div>
            </div>
          `;
        }).join('');
      }

      ['entradaInsumoSelect', 'entregaInsumoSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = insumos.map(i => `<option value="${i.id}">${i.nombre} (Stock actual: ${i.stock_actual} ${i.unidad_medida})</option>`).join('');
      });

      const provSelect = document.getElementById('entradaProveedorSelect');
      if (provSelect) provSelect.innerHTML = proveedores.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

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
    } catch (err) { console.error(err); }
  },

  async guardarEntradaInsumo() {
    const insumo_id = document.getElementById('entradaInsumoSelect').value;
    const cantidad = document.getElementById('entradaCantidad').value;
    const proveedor_id = document.getElementById('entradaProveedorSelect').value;
    const observacion = document.getElementById('entradaObservacion').value;

    if (!cantidad || cantidad <= 0) { this.toast('Ingrese una cantidad válida mayor a cero.', 'warning'); return; }

    try {
      await ApiCliente.post('/api/inventario/entradas', { insumo_id, cantidad, proveedor_id, observacion });
      this.toast('Entrada registrada. Stock actualizado inmediatamente.', 'success');
      this.closeModal('modalEntradaInsumo');
      this.loadInsumos();
    } catch (err) {
      this.toast('Error al registrar entrada de insumo.', 'error');
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

  // ===========================================================================
  // 5. NÓMINA, LIQUIDACIONES Y ASISTENCIA (CU21-CU27)
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
              <div class="commission-highlight">
                <div>
                  <span class="text-sm text-muted" style="display: block">Por Cobrar (Pendiente):</span>
                  <span class="comm-amount">${this.formatMoney(w.comision_pendiente)}</span>
                </div>
                <div class="text-sm text-muted text-right">${w.servicios_realizados} lavados<br>Total Ganado: ${this.formatMoney(w.comision_historica_total)}</div>
              </div>
              <button class="btn btn-sm btn-primary admin-only" style="width: 100%" onclick="app.abrirModalLiquidar(${w.lavador_id}, '${w.nombre}', ${w.comision_pendiente})">📑 Liquidar Comisión</button>
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
              <td class="text-sm">${l.soporte_pago_url ? `📎 ${l.soporte_pago_url}` : '<span class="text-muted">Pendiente de soporte</span>'}</td>
              <td>${l.estado === 'pendiente' ? `<button class="btn btn-sm btn-success admin-only" onclick="app.abrirModalPagarLiq(${l.id})">Pagar (Adjuntar Soporte)</button>` : '<span class="text-success text-sm">✓ Pagado</span>'}</td>
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
              <td>${e.ultimo_pago ? e.ultimo_pago.fecha_pago_real : 'Sin pagos registrados'}</td>
              <td><button class="btn btn-sm btn-primary" onclick="app.pagarSalarioEmpleado(${e.empleado_id}, '${e.nombre}', ${e.salario_fijo})">Pagar Salario</button></td>
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
              <td>📎 ${p.soporte_pago_url}</td>
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
    const hoy = new Date().toISOString().split('T')[0];
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
  // 6. CONTROL DE CAJA DIARIA (CU20)
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
        btnCerrar.innerHTML = '🔒 Caja de Hoy Ya Cerrada';
      } else {
        btnCerrar.disabled = false;
        btnCerrar.innerHTML = '🔒 Realizar Cierre de Caja';
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
  // 7. DASHBOARD, GANANCIAS Y REPORTES DESCARGABLES (CU18, CU19, CU29)
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

  // Crear Personal (usuario con login o lavador sin login)
  onUsrRolChange() {
    const rol = document.getElementById('usrRol').value;
    const lavFields = document.getElementById('usrLavadorFields');
    const empFields = document.getElementById('usrEmpleadoFields');
    const credencialesFields = document.getElementById('usrCredencialesFields');
    if (rol === 'lavador') {
      lavFields.classList.remove('hidden');
      empFields.classList.add('hidden');
      credencialesFields.classList.add('hidden');
    } else {
      lavFields.classList.add('hidden');
      empFields.classList.remove('hidden');
      credencialesFields.classList.remove('hidden');
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
      } else {
        const username = document.getElementById('usrUsername').value;
        const password = document.getElementById('usrPassword').value;
        const salarioFijo = document.getElementById('usrSalario').value;
        const periodicidadPago = document.getElementById('usrPeriodicidad').value;
        if (!username || !password) { this.toast('Usuario y contraseña son obligatorios para crear un acceso al sistema.', 'warning'); return; }
        await ApiCliente.post('/api/personal/usuarios', { nombre, documento, telefono, rol, username, password, salarioFijo, periodicidadPago });
      }

      this.toast(`Personal ${nombre} creado con éxito.`, 'success');
      this.closeModal('modalNuevoUsuario');
      this.loadWashers();
      this.loadNomina();
    } catch (err) {
      this.toast(err.message || 'Error al crear usuario.', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
