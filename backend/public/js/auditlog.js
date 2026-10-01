// public/js/auditlog.js
//
// Panel Super Admin: pantalla "Log de actividad de administradores".
// Consume /admin/audit-log (lista con filtros + paginación) y
// /admin/audit-log/acciones (valores distintos para el filtro de Acción).
// Mismo patrón de auth/fetch que clubs.js y users.js.
(() => {
  const $ = (id) => document.getElementById(id);

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers.Authorization = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const { json, ...rest } = options;

    const res = await fetch(url, { ...rest, headers });

    if (res.status === 401 || res.status === 403) {
      localStorage.clear();
      alert(res.status === 403 ? 'No autorizado.' : 'Sesión inválida.');
      window.location.href = '/admin.html';
      throw new Error(String(res.status));
    }
    return res;
  }

  async function safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, error: text }; }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  }

  // =============================
  // Estado
  // =============================
  const PAGE_SIZE = 50;
  let paginaActual = 1;
  let totalRegistros = 0;

  // =============================
  // Poblar filtros (clubes + acciones)
  // =============================
  async function poblarFiltroClubes() {
    const select = $('auditFiltroClub');
    if (!select) return;
    try {
      const res = await fetchAuth('/admin/clubs');
      const data = await safeJson(res);
      const clubes = (res.ok && data.ok) ? (data.clubs || []) : [];
      select.innerHTML = '<option value="">Todos los clubes</option>' +
        clubes.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    } catch (e) {
      console.error('poblarFiltroClubes:', e);
    }
  }

  async function poblarFiltroAcciones() {
    const select = $('auditFiltroAccion');
    if (!select) return;
    try {
      const res = await fetchAuth('/admin/audit-log/acciones');
      const data = await safeJson(res);
      const acciones = (res.ok && data.ok) ? (data.acciones || []) : [];
      select.innerHTML = '<option value="">Todas las acciones</option>' +
        acciones.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    } catch (e) {
      console.error('poblarFiltroAcciones:', e);
    }
  }

  // =============================
  // Cargar + render de la tabla
  // =============================
  function construirQuery() {
    const params = new URLSearchParams();
    const clubId = $('auditFiltroClub')?.value;
    const email = $('auditFiltroEmail')?.value?.trim();
    const accion = $('auditFiltroAccion')?.value;
    const desde = $('auditFiltroDesde')?.value;
    const hasta = $('auditFiltroHasta')?.value;

    if (clubId) params.set('club_id', clubId);
    if (email) params.set('email', email);
    if (accion) params.set('accion', accion);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    params.set('page', String(paginaActual));
    params.set('page_size', String(PAGE_SIZE));
    return params.toString();
  }

  function renderTabla(rows) {
    const tbody = $('auditLogTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);">No hay registros que coincidan con los filtros.</td></tr>`;
      return;
    }

    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const exitoso = r.status_code != null && r.status_code < 400;
      const resultadoTxt = r.accion === 'login_exitoso'
        ? '<span style="color:#11601d;">✅ Login OK</span>'
        : r.accion === 'login_fallido'
          ? '<span style="color:#a11a1a;">❌ Login fallido</span>'
          : exitoso
            ? `<span style="color:#11601d;">✅ ${r.status_code}</span>`
            : `<span style="color:#a11a1a;">⚠️ ${r.status_code ?? '—'}</span>`;

      tr.innerHTML = `
        <td>${formatFecha(r.created_at)}</td>
        <td>${escapeHtml(r.email || '—')}</td>
        <td>${escapeHtml(r.club_name || (r.club_id ? '—' : 'General'))}</td>
        <td>${escapeHtml(r.descripcion || r.accion)}</td>
        <td>${resultadoTxt}</td>
        <td>${escapeHtml(r.ip_address || '—')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderPaginacion() {
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE));
    const txtPagina = $('auditLogPaginaTxt');
    const txtTotal = $('auditLogTotalTxt');
    if (txtPagina) txtPagina.textContent = `Página ${paginaActual} de ${totalPaginas}`;
    if (txtTotal) txtTotal.textContent = `${totalRegistros} registro${totalRegistros === 1 ? '' : 's'}`;

    const btnAnt = $('btnAuditPagAnterior');
    const btnSig = $('btnAuditPagSiguiente');
    if (btnAnt) btnAnt.disabled = paginaActual <= 1;
    if (btnSig) btnSig.disabled = paginaActual >= totalPaginas;
  }

  async function loadAuditLog() {
    const tbody = $('auditLogTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);">Cargando...</td></tr>`;

    try {
      const res = await fetchAuth(`/admin/audit-log?${construirQuery()}`);
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Error cargando el log</td></tr>`;
        return;
      }

      totalRegistros = data.total || 0;
      renderTabla(data.rows || []);
      renderPaginacion();
    } catch (e) {
      console.error('loadAuditLog:', e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Error cargando el log</td></tr>`;
    }
  }

  // =============================
  // Bind eventos
  // =============================
  function bindEvents() {
    $('btnAuditFiltrar')?.addEventListener('click', () => {
      paginaActual = 1;
      loadAuditLog();
    });

    $('btnAuditLimpiar')?.addEventListener('click', () => {
      if ($('auditFiltroClub')) $('auditFiltroClub').value = '';
      if ($('auditFiltroEmail')) $('auditFiltroEmail').value = '';
      if ($('auditFiltroAccion')) $('auditFiltroAccion').value = '';
      if ($('auditFiltroDesde')) $('auditFiltroDesde').value = '';
      if ($('auditFiltroHasta')) $('auditFiltroHasta').value = '';
      paginaActual = 1;
      loadAuditLog();
    });

    $('btnAuditPagAnterior')?.addEventListener('click', () => {
      if (paginaActual > 1) {
        paginaActual -= 1;
        loadAuditLog();
      }
    });

    $('btnAuditPagSiguiente')?.addEventListener('click', () => {
      const totalPaginas = Math.max(1, Math.ceil(totalRegistros / PAGE_SIZE));
      if (paginaActual < totalPaginas) {
        paginaActual += 1;
        loadAuditLog();
      }
    });

    // Enter en el buscador de email también filtra
    $('auditFiltroEmail')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        paginaActual = 1;
        loadAuditLog();
      }
    });
  }

  // =============================
  // Init
  // =============================
  document.addEventListener('DOMContentLoaded', async () => {
    if (!$('auditLogTableBody')) return; // sección no presente en esta página
    bindEvents();
    await Promise.all([poblarFiltroClubes(), poblarFiltroAcciones()]);
    await loadAuditLog();
  });
})();
