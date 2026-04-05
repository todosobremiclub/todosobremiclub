// public/js/gastos.js
(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // Auth / helpers (TOKEN)
  // =============================
  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club activo seleccionado.');
      window.location.href = '/club.html';
      throw new Error('No activeClubId');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

    const { json, ...rest } = options;

    const res = await fetch(url, { ...rest, headers });

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
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

  // =============================
  // Formato / helpers UI
  // =============================
  const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

  function todayYYYYMM() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function setDefaultFilters() {
  const ym = todayYYYYMM();
  if ($('filtroPeriodo') && !$('filtroPeriodo').value) $('filtroPeriodo').value = ym;
}

  function openModal() {
    const modal = $('modalGasto');
    if (!modal) return;

    $('formGasto')?.reset();
    if ($('gastoFecha')) $('gastoFecha').value = todayISO();

    modal.classList.remove('hidden');
  }

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

  function closeModal() {
    const modal = $('modalGasto');
    if (!modal) return;
    modal.classList.add('hidden');
  }

  function renderGastos(gastos = []) {
    const tbody = $('gastosTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    gastos.forEach(g => {
      const tr = document.createElement('tr');

      const periodo = (g.periodo ?? '').toString();
      const tipo = g.tipo_gasto ?? g.tipo_nombre ?? g.tipo ?? '';
      const responsable = g.responsable ?? g.responsable_nombre ?? '';
      const monto = Number(g.monto ?? 0);

      tr.innerHTML = `
        <td>${escapeHtml(periodo)}</td>
        <td>${escapeHtml(tipo)}</td>
        <td>${escapeHtml(responsable)}</td>
        <td><strong>${money.format(monto)}</strong></td>
        <td>
          <button class="btn-del" data-act="del" data-id="${g.id}" title="Eliminar">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function setTotal(total) {
    const el = $('totalPeriodo');
    if (!el) return;
    el.textContent = money.format(Number(total || 0));
  }

  // =============================
  // Loads
  // =============================
  async function loadTipos() {
    const clubId = getActiveClubId();
    const sel = $('gastoTipo');
    if (!sel) return;

    sel.innerHTML = `<option value="">Cargando...</option>`;

    const res = await fetchAuth(`/club/${clubId}/config/tipos-gasto`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      sel.innerHTML = `<option value="">Error cargando</option>`;
      return;
    }

    const items = data.tipos || [];
    sel.innerHTML = `<option value="">Seleccionar...</option>`;
    items.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.nombre;
      sel.appendChild(opt);
    });
  }

  async function loadResponsables() {
    const clubId = getActiveClubId();
    const sel = $('gastoResponsable');
    if (!sel) return;

    sel.innerHTML = `<option value="">Cargando...</option>`;

    const res = await fetchAuth(`/club/${clubId}/config/responsables`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      sel.innerHTML = `<option value="">Error cargando</option>`;
      return;
    }

    const items = data.responsables || [];
    sel.innerHTML = `<option value="">Seleccionar...</option>`;
    items.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.nombre;
      sel.appendChild(opt);
    });

// También llenar selector de cuenta/medio
  const selCuenta = $('gastoCuenta');
  if (selCuenta) {
    selCuenta.innerHTML = `<option value="">Seleccionar...</option>`;
    items.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.nombre;      // guardamos el nombre como texto (igual que pagos/ingresos)
      opt.textContent = r.nombre;
      selCuenta.appendChild(opt);
    });
  }
  }

  async function loadGastos() {
  const clubId = getActiveClubId();
  const periodo = ($('filtroPeriodo')?.value || '').trim(); // YYYY-MMloadGastos

  const qs = new URLSearchParams();
  if (periodo) {
    qs.set('desde', periodo);
    qs.set('hasta', periodo);
  }
  const url = `/club/${clubId}/gastos${qs.toString() ? `?${qs.toString()}` : ''}`;

  const res = await fetchAuth(url);
  const data = await safeJson(res);
  if (!res.ok || !data.ok) {
    alert(data.error || 'Error cargando gastos');
    return;
  }

  renderGastosGrouped(data.gastos || []);
}

function renderGastosGrouped(gastos = []) {
  const cont = $('gastosAccordions');
  if (!cont) return;
  cont.innerHTML = '';

  // agrupar por periodo (YYYY-MM)
  const groups = new Map();
  gastos.forEach(g => {
    const p = (g.periodo || '').toString() || 'Sin período';
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(g);
  });

  // ordenar desc por periodo (YYYY-MM)
  const periodos = Array.from(groups.keys()).sort((a,b) => b.localeCompare(a));

  let totalGlobal = 0;

  periodos.forEach((p, idx) => {
    const items = groups.get(p) || [];
    const totalMes = items.reduce((acc, x) => acc + Number(x.monto || 0), 0);
    totalGlobal += totalMes;

    const accId = `acc_${p.replace('-', '')}`;

    const rowsHtml = items.map(g => `
      <tr>
  <td>${escapeHtml(g.tipo_gasto ?? g.tipo ?? '')}</td>
  <td>${escapeHtml(g.responsable ?? '')}</td>
  <td><strong>${money.format(Number(g.monto || 0))}</strong></td>
  <td style="text-align:right;">
    <button class="btn-del" data-act="del" data-id="${g.id}" title="Eliminar">🗑️</button>
  </td>
</tr>
    `).join('');

    cont.insertAdjacentHTML('beforeend', `
      <div class="accordion ${idx === 0 ? 'open' : ''}">
        <div class="accordion-header" data-target="${accId}">
          <div class="accordion-left">
            <span class="accordion-arrow">▶</span>
            <span>${escapeHtml(p)}</span>
          </div>
          <div style="font-weight:800;">Total: ${money.format(totalMes)}</div>
        </div>

        <div id="${accId}" class="accordion-body ${idx === 0 ? '' : 'hidden'}">
          <div class="table-container">
            <table class="table">
              <thead>
                <tr>
                  <th>Tipo de gasto</th>
<th>Responsable de cuenta</th>
<th>Monto</th>
<th>Acción</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || `<tr>
  <td colspan="3" class="muted">Sin gastos</td>
</tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `);
  });

  setTotal(totalGlobal);
}

  // =============================
  // Actions
  // =============================
  async function createGasto() {
    const clubId = getActiveClubId();

    const tipo_gasto_id = $('gastoTipo')?.value;
    const responsable_id = $('gastoResponsable')?.value;
const cuenta = ($('gastoCuenta')?.value || '').trim();
    const fecha_gasto = ($('gastoFecha')?.value || '').trim(); // YYYY-MM-DD
const periodo = fecha_gasto ? fecha_gasto.slice(0, 7) : ''; // YYYY-MM
    const monto = ($('gastoMonto')?.value || '').trim();
    const descripcion = ($('gastoDescripcion')?.value || '').trim();

    if (!tipo_gasto_id || !responsable_id || !cuenta || !fecha_gasto || !monto) {
  alert('Completá Tipo de gasto, Fecha, Quién lo hizo, Cuenta y Monto.');
  return;
}

    const montoNum = Number(monto);
    if (Number.isNaN(montoNum) || montoNum < 0) {
      alert('Monto inválido.');
      return;
    }

    const payload = {
  periodo,
  fecha_gasto,              // ✅ fecha real seleccionada
  tipo_gasto_id,
  responsable_id,
  cuenta,
  monto: montoNum,
  descripcion: descripcion || null
};

    const btn = document.querySelector('#formGasto button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
      const res = await fetchAuth(`/club/${clubId}/gastos`, {
        method: 'POST',
        body: JSON.stringify(payload),
        json: true
      });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        alert(data.error || 'Error guardando gasto');
        return;
      }

      closeModal();
      await loadGastos();
      alert('✅ Gasto registrado');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteGasto(id) {
    const clubId = getActiveClubId();

    const res = await fetchAuth(`/club/${clubId}/gastos/${id}`, { method: 'DELETE' });
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      alert(data.error || 'Error eliminando gasto');
      return;
    }
    await loadGastos();
  }

  // =============================
  // Bind
  // =============================
  function bindOnce() {
    const root = document.querySelector('.section-gastos');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    $('btnGastoAdd')?.addEventListener('click', openModal);
    $('btnGastoCancel')?.addEventListener('click', closeModal);

    $('btnFiltrarGastos')?.addEventListener('click', loadGastos);

    $('formGasto')?.addEventListener('submit', (e) => {
      e.preventDefault();
      createGasto();
    });

    $('gastosAccordions')?.addEventListener('click', async (ev) => {
  // toggle acordeón (si clickean header)
  const header = ev.target.closest('.accordion-header');
  if (header && !ev.target.closest('button')) {
    const acc = header.closest('.accordion');
    const targetId = header.dataset.target;
    const panel = targetId ? document.getElementById(targetId) : null;
    if (acc && panel) {
      const isOpen = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden', isOpen);
      acc.classList.toggle('open', !isOpen);
    }
    return;
  }

  // delete
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'del') {
    const id = btn.dataset.id;
    if (!id) return;
    if (!confirm('¿Eliminar gasto definitivamente?')) return;
    await deleteGasto(id);
  }
});

    $('modalGasto')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalGasto') closeModal();
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !$('modalGasto')?.classList.contains('hidden')) closeModal();
    });
  }

  async function initGastosSection() {
    bindOnce();
    setDefaultFilters();
    await Promise.all([loadTipos(), loadResponsables()]);
    await loadGastos();
  }

  window.initGastosSection = initGastosSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.section-gastos')) {
      initGastosSection();
    }
  });
})();