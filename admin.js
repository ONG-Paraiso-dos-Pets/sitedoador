/**
 * @fileoverview Lógica do Painel Administrativo da ONG Paraíso dos Pets.
 * Por qué esta arquitectura: gestiona el ciclo de vida de autenticación con Neon Auth
 * (Managed Better Auth), la sincronización de donadores desde Lakebase Postgres y el
 * disparador directo de WhatsApp con actualización automática de estado.
 */

(() => {
  'use strict';

  // Por qué constantes configurables: permiten cambiar de entorno de pruebas a producción
  // sin alterar la lógica de negocio ni quemar credenciales en el código.
  const CONFIG = {
    AUTH_URL: 'https://ep-muddy-voice-bcsex1e8.neonauth.c-16.us-east-1.aws.neon.tech/neondb/auth',
    API_URL: 'https://br-dark-sea-bc1s1p2m-doadores.compute.c-16.us-east-1.aws.neon.tech',
    STORAGE_TOKEN_KEY: 'paraiso_admin_jwt',
    STATUS_LABELS: {
      pendente: 'Aguardando',
      contatado: 'Contatado',
      doador_ativo: 'Doador Ativo',
      arquivado: 'Arquivado'
    }
  };

  /** Estado reactivo local del panel. */
  const state = {
    token: sessionStorage.getItem(CONFIG.STORAGE_TOKEN_KEY) || '',
    currentAdminEmail: '',
    donors: [],
    counters: { pendente: 0, contatado: 0, doador_ativo: 0, arquivado: 0 },
    activeStatus: '',
    searchQuery: '',
    page: 1,
    totalPages: 1,
    editingDonor: null
  };

  /**
   * Escapa caracteres especiales para evitar inyecciones XSS al renderizar texto del donador.
   * @param {string} str - Texto plano a sanitizar.
   * @returns {string} Texto seguro para HTML.
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Formatea una fecha ISO a fecha legible brasileña.
   * @param {string} isoString - Fecha en formato ISO.
   * @returns {string} Fecha formateada dd/mm/aaaa às hh:mm.
   */
  function formatDate(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  /**
   * Realiza peticiones autenticadas a la API del backend.
   * @param {string} path - Ruta relativa de la API.
   * @param {RequestInit} [options={}] - Opciones de fetch.
   * @returns {Promise<Response>} Respuesta HTTP.
   */
  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) {
      headers.set('Authorization', `Bearer ${state.token}`);
    }
    const response = await fetch(`${CONFIG.API_URL}${path}`, {
      ...options,
      headers
    });

    if (response.status === 401) {
      // Por qué desconectar en 401: si el token expiró o fue revocado,
      // devolvemos al usuario a la pantalla de login para renovar sesión.
      logout();
    }
    return response;
  }

  /* --------------------------------------------------------------------------
     MÓDULO DE AUTENTICACIÓN (NEON AUTH)
     -------------------------------------------------------------------------- */

  /**
   * Extrae el token JWT devuelto por Neon Auth a través del cuerpo o el endpoint /token.
   * @param {Response} initialResponse - Respuesta de sign-in o sign-up.
   * @returns {Promise<string>} Token JWT firmado.
   */
  async function extractJwtToken(initialResponse) {
    try {
      const data = await initialResponse.clone().json();
      if (data && data.token) return data.token;
      if (data && data.data && data.data.token) return data.data.token;
    } catch {
      // Si la respuesta no tenía JSON de token directo, continúa con /token.
    }

    const headerToken = initialResponse.headers.get('set-auth-jwt');
    if (headerToken) return headerToken;

    // Por qué llamar a /token con credentials: Managed Better Auth fija una cookie
    // de sesión HttpOnly y este endpoint emite el JWT correspondiente para APIs externas.
    const tokenRes = await fetch(`${CONFIG.AUTH_URL}/token`, {
      credentials: 'include'
    });
    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();
      return tokenData.token || (tokenData.data && tokenData.data.token) || '';
    }
    return '';
  }

  /**
   * Valida si el usuario autenticado tiene rol de administrador en el backend.
   * @param {string} token - Token JWT de Neon Auth.
   * @returns {Promise<boolean>} True si es administrador válido.
   */
  async function verifyAdminAccess(token) {
    state.token = token;
    const res = await apiFetch('/admin/eu');
    if (!res.ok) {
      state.token = '';
      sessionStorage.removeItem(CONFIG.STORAGE_TOKEN_KEY);
      return false;
    }
    const data = await res.json();
    state.currentAdminEmail = data.email || '';
    sessionStorage.setItem(CONFIG.STORAGE_TOKEN_KEY, token);
    return true;
  }

  /**
   * Cierra la sesión activa en el navegador y limpia la memoria.
   */
  async function logout() {
    state.token = '';
    state.currentAdminEmail = '';
    sessionStorage.removeItem(CONFIG.STORAGE_TOKEN_KEY);

    try {
      await fetch(`${CONFIG.AUTH_URL}/sign-out`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // Ignora errores de red durante el logout.
    }

    showAuthView();
  }

  /* --------------------------------------------------------------------------
     MÓDULO DE VISTAS (LOGIN VS DASHBOARD)
     -------------------------------------------------------------------------- */

  const authSection = document.getElementById('auth-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const adminUserInfo = document.getElementById('admin-user-info');
  const adminUserEmailEl = document.getElementById('admin-user-email');
  const authFeedback = document.getElementById('auth-feedback');

  function showAuthView() {
    if (authSection) authSection.removeAttribute('hidden');
    if (dashboardSection) dashboardSection.setAttribute('hidden', 'hidden');
    if (adminUserInfo) adminUserInfo.setAttribute('hidden', 'hidden');
  }

  function showDashboardView() {
    if (authSection) authSection.setAttribute('hidden', 'hidden');
    if (dashboardSection) dashboardSection.removeAttribute('hidden');
    if (adminUserInfo) adminUserInfo.removeAttribute('hidden');
    if (adminUserEmailEl) adminUserEmailEl.textContent = state.currentAdminEmail;
    loadDashboard();
  }

  /* --------------------------------------------------------------------------
     MÓDULO DE GESTIÓN DE DONADORES
     -------------------------------------------------------------------------- */

  /**
   * Carga la lista de donadores aplicando filtros de búsqueda y estado.
   */
  async function loadDashboard() {
    const params = new URLSearchParams();
    if (state.activeStatus) params.set('status', state.activeStatus);
    if (state.searchQuery) params.set('busca', state.searchQuery);
    params.set('pagina', String(state.page));

    try {
      const res = await apiFetch(`/admin/doadores?${params.toString()}`);
      if (!res.ok) return;

      const data = await res.json();
      state.donors = data.doadores || [];
      state.counters = data.contadores || state.counters;
      state.page = data.pagina || 1;
      state.totalPages = data.totalPaginas || 1;

      renderMetrics();
      renderDonorsTable();
    } catch (error) {
      console.error('Error cargando donadores:', error);
    }
  }

  function renderMetrics() {
    const total =
      (state.counters.pendente || 0) +
      (state.counters.contatado || 0) +
      (state.counters.doador_ativo || 0) +
      (state.counters.arquivado || 0);

    const elTotal = document.getElementById('metric-total');
    const elPendente = document.getElementById('metric-pendente');
    const elContatado = document.getElementById('metric-contatado');
    const elAtivo = document.getElementById('metric-ativo');

    if (elTotal) elTotal.textContent = String(total);
    if (elPendente) elPendente.textContent = String(state.counters.pendente || 0);
    if (elContatado) elContatado.textContent = String(state.counters.contatado || 0);
    if (elAtivo) elAtivo.textContent = String(state.counters.doador_ativo || 0);
  }

  function renderDonorsTable() {
    const tbody = document.getElementById('donors-tbody');
    const emptyState = document.getElementById('empty-state');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (state.donors.length === 0) {
      if (emptyState) emptyState.removeAttribute('hidden');
      return;
    }
    if (emptyState) emptyState.setAttribute('hidden', 'hidden');

    state.donors.forEach((donor) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', donor.id);

      const statusBadgeClass = `status-badge status-badge--${donor.status_contato}`;
      const statusLabel = CONFIG.STATUS_LABELS[donor.status_contato] || donor.status_contato;

      tr.innerHTML = `
        <td>
          <div class="donor-cell-name">${escapeHtml(donor.nome_completo)}</div>
          <div class="donor-cell-email">
            <span>${escapeHtml(donor.email)}</span>
            <button type="button" class="button-copy-email" data-email="${escapeHtml(donor.email)}" title="Copiar e-mail">📋</button>
          </div>
        </td>
        <td>
          <div class="donor-phone-num">${escapeHtml(donor.telefone_formatado)}</div>
          <div class="donor-phone-region">${escapeHtml(donor.ddd_regiao)}</div>
        </td>
        <td>
          <div class="donor-date">${formatDate(donor.criado_em)}</div>
        </td>
        <td>
          <span class="${statusBadgeClass}">${statusLabel}</span>
          <select class="status-select" data-donor-id="${donor.id}" aria-label="Alterar status de atendimento">
            <option value="pendente" ${donor.status_contato === 'pendente' ? 'selected' : ''}>Aguardando</option>
            <option value="contatado" ${donor.status_contato === 'contatado' ? 'selected' : ''}>Contatado</option>
            <option value="doador_ativo" ${donor.status_contato === 'doador_ativo' ? 'selected' : ''}>Doador Ativo</option>
            <option value="arquivado" ${donor.status_contato === 'arquivado' ? 'selected' : ''}>Arquivado</option>
          </select>
        </td>
        <td>
          <button type="button" class="donor-obs-btn" data-donor-obs="${donor.id}" title="Clique para editar anotações">
            ${donor.observacoes ? escapeHtml(donor.observacoes) : '+ Anotação'}
          </button>
        </td>
        <td class="table-th-actions">
          <button type="button" class="button-whatsapp" data-whatsapp="${donor.id}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.04 20.15C10.56 20.15 9.11 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.81 13.47 3.81 11.91C3.81 7.37 7.5 3.68 12.04 3.68C14.25 3.68 16.31 4.54 17.87 6.11C19.43 7.67 20.28 9.74 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15Z"/></svg>
            <span>WhatsApp</span>
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // Enlaza eventos de la tabla
    tbody.querySelectorAll('.button-copy-email').forEach((btn) => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        if (email && navigator.clipboard) {
          navigator.clipboard.writeText(email);
          btn.textContent = '✓';
          setTimeout(() => (btn.textContent = '📋'), 1500);
        }
      });
    });

    tbody.querySelectorAll('.status-select').forEach((select) => {
      select.addEventListener('change', async (e) => {
        const id = select.getAttribute('data-donor-id');
        const newStatus = e.target.value;
        if (id && newStatus) {
          await updateDonorStatus(id, newStatus);
        }
      });
    });

    tbody.querySelectorAll('.donor-obs-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-donor-obs');
        const donor = state.donors.find((d) => d.id === id);
        if (donor) openObsDialog(donor);
      });
    });

    tbody.querySelectorAll('[data-whatsapp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-whatsapp');
        const donor = state.donors.find((d) => d.id === id);
        if (donor) triggerWhatsApp(donor);
      });
    });
  }

  /**
   * Actualiza el estado de un donador en la API.
   * @param {string} id - UUID del donador.
   * @param {string} newStatus - Nuevo estado (pendente, contatado, doador_ativo, arquivado).
   */
  async function updateDonorStatus(id, newStatus) {
    try {
      const res = await apiFetch(`/admin/doadores/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_contato: newStatus })
      });
      if (res.ok) {
        // Refresca para actualizar contadores métricos y vista sincronizada.
        loadDashboard();
      }
    } catch (err) {
      console.error('Error actualizando status:', err);
    }
  }

  /**
   * Abre WhatsApp con mensaje pre-redactado y cambia automáticamente el estado a 'contatado'.
   * @param {Object} donor - Datos del donador.
   */
  async function triggerWhatsApp(donor) {
    const firstName = donor.nome_completo ? donor.nome_completo.split(' ')[0] : 'amigo(a)';
    const phone = donor.telefone_e164; // E.164: 5516999999999

    // Por qué mensaje consultivo y receptivo: agradece el registro e inicia conversación
    // sin presionar con cobro invasivo en la primera interacción.
    const message = [
      `Olá, ${firstName}! Tudo bem? 😊`,
      ``,
      `Aqui é da equipe da ONG Paraíso dos Pets de Ribeirão Preto. Recebemos seu cadastro como doador no nosso site e ficamos muito felizes pelo seu carinho com os nossos mais de 130 cães resgatados!`,
      ``,
      `Como podemos te ajudar a concluir o seu apoio hoje? 🐶🐾`
    ].join('\n');

    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    // Abre el chat en una pestaña nueva
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');

    // Por qué auto-actualizar a 'contatado': si el estado era 'pendente', se marca automáticamente
    // como atendido en segundo plano para evitar que otro voluntario duplique el contacto.
    if (donor.status_contato === 'pendente') {
      await updateDonorStatus(donor.id, 'contatado');
    }
  }

  /* --------------------------------------------------------------------------
     MÓDULO DE OBSERVACIONES (DIALOG)
     -------------------------------------------------------------------------- */

  const obsDialog = document.getElementById('obs-dialog');
  const obsDonorName = document.getElementById('obs-dialog-donor-name');
  const obsTextarea = document.getElementById('obs-textarea');
  const obsCancelBtn = document.getElementById('obs-cancel-btn');
  const obsForm = document.getElementById('obs-form');

  function openObsDialog(donor) {
    state.editingDonor = donor;
    if (obsDonorName) obsDonorName.textContent = donor.nome_completo;
    if (obsTextarea) obsTextarea.value = donor.observacoes || '';
    if (obsDialog && typeof obsDialog.showModal === 'function') {
      obsDialog.showModal();
    }
  }

  if (obsCancelBtn && obsDialog) {
    obsCancelBtn.addEventListener('click', () => obsDialog.close());
  }

  if (obsForm) {
    obsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.editingDonor) return;

      const newObs = obsTextarea ? obsTextarea.value.trim() : '';
      try {
        const res = await apiFetch(`/admin/doadores/${state.editingDonor.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ observacoes: newObs })
        });
        if (res.ok) {
          if (obsDialog) obsDialog.close();
          loadDashboard();
        }
      } catch (err) {
        console.error('Error guardando observaciones:', err);
      }
    });
  }

  /* --------------------------------------------------------------------------
     MÓDULO DE GESTIÓN DE ADMINISTRADORES
     Por qué: permite que cualquier admin agregue o remueva colaboradores
     sin tener que modificar código ni depender de un único desarrollador.
     -------------------------------------------------------------------------- */

  const adminsPanel = document.getElementById('admins-panel');
  const toggleAdminsBtn = document.getElementById('toggle-admins-btn');
  const closeAdminsBtn = document.getElementById('close-admins-btn');
  const addAdminForm = document.getElementById('add-admin-form');
  const newAdminEmailInput = document.getElementById('new-admin-email');
  const adminsListContainer = document.getElementById('admins-list-container');
  const adminsFeedback = document.getElementById('admins-feedback');

  if (toggleAdminsBtn && adminsPanel) {
    toggleAdminsBtn.addEventListener('click', () => {
      adminsPanel.removeAttribute('hidden');
      loadAdminsList();
    });
  }

  if (closeAdminsBtn && adminsPanel) {
    closeAdminsBtn.addEventListener('click', () => {
      adminsPanel.setAttribute('hidden', 'hidden');
    });
  }

  async function loadAdminsList() {
    if (!adminsListContainer) return;
    try {
      const res = await apiFetch('/admin/administradores');
      if (!res.ok) return;

      const data = await res.json();
      const admins = data.administradores || [];
      const currentEmail = data.voce || '';

      adminsListContainer.innerHTML = '';
      admins.forEach((admin) => {
        const div = document.createElement('div');
        div.className = 'admin-item';

        const isSelf = admin.email === currentEmail;
        div.innerHTML = `
          <div>
            <span class="admin-item__email">${escapeHtml(admin.email)}</span>
            ${isSelf ? '<span class="admin-item__meta">(Você)</span>' : ''}
            <span class="admin-item__meta">· Adicionado ${formatDate(admin.criado_em)}</span>
          </div>
          ${
            !isSelf
              ? `<button type="button" class="admin-item__remove" data-remove-admin="${escapeHtml(admin.email)}">Remover</button>`
              : ''
          }
        `;
        adminsListContainer.appendChild(div);
      });

      adminsListContainer.querySelectorAll('[data-remove-admin]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const email = btn.getAttribute('data-remove-admin');
          if (email && confirm(`Deseja remover o acesso de ${email}?`)) {
            await removeAdmin(email);
          }
        });
      });
    } catch (err) {
      console.error('Error cargando lista de admins:', err);
    }
  }

  async function removeAdmin(email) {
    try {
      const res = await apiFetch(`/admin/administradores/${encodeURIComponent(email)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        loadAdminsList();
      }
    } catch (err) {
      console.error('Error removiendo admin:', err);
    }
  }

  if (addAdminForm && newAdminEmailInput) {
    addAdminForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = newAdminEmailInput.value.trim().toLowerCase();
      if (!email) return;

      try {
        const res = await apiFetch('/admin/administradores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          newAdminEmailInput.value = '';
          if (adminsFeedback) {
            adminsFeedback.textContent = `Administrador ${email} adicionado com sucesso!`;
            adminsFeedback.className = 'auth-feedback is-success';
            setTimeout(() => (adminsFeedback.className = 'auth-feedback'), 3000);
          }
          loadAdminsList();
        } else {
          if (adminsFeedback) {
            adminsFeedback.textContent = data.erro || 'Erro ao adicionar administrador.';
            adminsFeedback.className = 'auth-feedback is-error';
          }
        }
      } catch (err) {
        console.error('Error agregando admin:', err);
      }
    });
  }

  /* --------------------------------------------------------------------------
     EVENTOS DE NAVEGACIÓN Y FILTROS
     -------------------------------------------------------------------------- */

  // Filtros de status (tabs)
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      state.activeStatus = tab.getAttribute('data-status') || '';
      state.page = 1;
      loadDashboard();
    });
  });

  // Búsqueda en tiempo real con debounce
  const searchInput = document.getElementById('search-input');
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchQuery = e.target.value.trim();
        state.page = 1;
        loadDashboard();
      }, 350);
    });
  }

  // Botón de refresco manual
  const refreshBtn = document.getElementById('refresh-donors-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadDashboard());
  }

  // Botón de logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  /* --------------------------------------------------------------------------
     FORMULARIO DE LOGIN / REGISTRO
     -------------------------------------------------------------------------- */

  let isSignUpMode = false;
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const authNameGroup = document.getElementById('auth-name-group');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authForm = document.getElementById('auth-form');
  const authEmailInput = document.getElementById('auth-email');
  const authPasswordInput = document.getElementById('auth-password');
  const authNameInput = document.getElementById('auth-name');

  if (tabLogin && tabSignup) {
    tabLogin.addEventListener('click', () => {
      isSignUpMode = false;
      tabLogin.classList.add('is-active');
      tabSignup.classList.remove('is-active');
      if (authNameGroup) authNameGroup.setAttribute('hidden', 'hidden');
      if (authSubmitBtn) authSubmitBtn.textContent = 'Entrar no Painel';
    });

    tabSignup.addEventListener('click', () => {
      isSignUpMode = true;
      tabSignup.classList.add('is-active');
      tabLogin.classList.remove('is-active');
      if (authNameGroup) authNameGroup.removeAttribute('hidden');
      if (authSubmitBtn) authSubmitBtn.textContent = 'Criar Senha de Acesso';
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = authEmailInput ? authEmailInput.value.trim().toLowerCase() : '';
      const password = authPasswordInput ? authPasswordInput.value : '';
      const name = authNameInput ? authNameInput.value.trim() : '';

      if (!email || !password) return;

      if (authFeedback) {
        authFeedback.textContent = '';
        authFeedback.className = 'auth-feedback';
      }

      if (authSubmitBtn) {
        authSubmitBtn.disabled = true;
        authSubmitBtn.textContent = 'Aguarde...';
      }

      try {
        const endpoint = isSignUpMode ? `${CONFIG.AUTH_URL}/sign-up/email` : `${CONFIG.AUTH_URL}/sign-in/email`;
        const bodyPayload = isSignUpMode ? { email, password, name: name || 'Admin' } : { email, password };

        const authRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(bodyPayload)
        });

        if (!authRes.ok) {
          const errData = await authRes.json().catch(() => ({}));
          const errMsg = errData.message || 'Credenciais inválidas. Verifique seu e-mail e senha.';
          if (authFeedback) {
            authFeedback.textContent = errMsg;
            authFeedback.className = 'auth-feedback is-error';
          }
          return;
        }

        const token = await extractJwtToken(authRes);
        if (!token) {
          if (authFeedback) {
            authFeedback.textContent = 'Não foi possível emitir o token de sessão. Tente novamente.';
            authFeedback.className = 'auth-feedback is-error';
          }
          return;
        }

        const isAuthorized = await verifyAdminAccess(token);
        if (!isAuthorized) {
          if (authFeedback) {
            authFeedback.textContent =
              'Seu e-mail foi autenticado, mas não possui permissão de administrador neste painel. Peça a um administrador para cadastrar seu e-mail.';
            authFeedback.className = 'auth-feedback is-error';
          }
          return;
        }

        // Acceso autorizado con éxito
        showDashboardView();
      } catch (err) {
        console.error('Error de autenticación:', err);
        if (authFeedback) {
          authFeedback.textContent = 'Erro de conexão com o servidor de autenticação.';
          authFeedback.className = 'auth-feedback is-error';
        }
      } finally {
        if (authSubmitBtn) {
          authSubmitBtn.disabled = false;
          authSubmitBtn.textContent = isSignUpMode ? 'Criar Senha de Acesso' : 'Entrar no Painel';
        }
      }
    });
  }

  /* --------------------------------------------------------------------------
     INICIALIZACIÓN AL CARGAR LA PÁGINA
     -------------------------------------------------------------------------- */
  async function init() {
    if (state.token) {
      const isValid = await verifyAdminAccess(state.token);
      if (isValid) {
        showDashboardView();
        return;
      }
    }
    showAuthView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
