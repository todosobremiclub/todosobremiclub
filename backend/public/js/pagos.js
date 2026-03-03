(() => {
  const $ = (id) => document.getElementById(id);

  const MESES = [
    { n: 1, label: 'Ene' }, { n: 2, label: 'Feb' }, { n: 3, label: 'Mar' }, { n: 4, label: 'Abr' },
    { n: 5, label: 'May' }, { n: 6, label: 'Jun' }, { n: 7, label: 'Jul' }, { n: 8, label: 'Ago' },
    { n: 9, label: 'Sep' }, { n: 10, label: 'Oct' }, { n: 11, label: 'Nov' }, { n: 12, label: 'Dic' }
  ];

  /* =============================
   * Helpers auth / club (TOKEN)
   * ============================= */
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
      alert('No hay club activo');
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

    // Parse robusto (por si el backend devuelve texto ante error)
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { ok: false, error: text }; }

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    return { res, data };
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /* =============================
   * Estado
   * ============================= */
  let sociosCache = [];
  let cuotasMap = new Map(); // mes -> monto
  let selectedSocioId = null;
  let selectedYear = new Date().getFullYear();
  let mesesPagados = new Set();
  let mesesSeleccionados = new Set();

  // Ingresos generales
  let tiposIngresoCache = [];
  let ingresosCache = [];

  /* =============================
 * UI (inyectada): botón + tabla ingresos + modal 
 * ============================= */ 
function ensureIngresosUI() {
  // Ya existe en pagos.html (no inyectar nada)
  return;
}

  function openIngresoModal() {
    const modal = $('modalIngreso');
    if (!modal) return;
    if ($('ingresoFecha')) $('ingresoFecha').value = todayISO();
    if ($('ingresoMonto')) $('ingresoMonto').value = '';
    if ($('ingresoObs')) $('ingresoObs').value = '';
    modal.classList.remove('hidden');
  }

  function closeIngresoModal() {
    $('modalIngreso')?.classList.add('hidden');
  }

  function moneyARS(n) {
    try {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n || 0));
    } catch {
      return `$ ${Number(n || 0).toFixed(2)}`;
    }
  }

  /* =============================
   * Cargas (socios/pagos)
   * ============================= */
  async function loadSociosAll() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/socios?activo=1&limit=2000&offset=0`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando socios');
    sociosCache = data.socios || [];
  }

  async function loadCuotas() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/config/cuotas`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando cuotas');
    cuotasMap = new Map((data.cuotas || []).map(c => [Number(c.mes), Number(c.monto)]));
  }

  async function loadResumen() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/pagos/resumen?anio=${selectedYear}`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando resumen pagos');

    const search = (($('pagosSearch')?.value) || '').trim().toLowerCase();
    const rows = (data.socios || []).filter(s => {
      if (!search) return true;
      const ap = String(s.apellido || '').toLowerCase();
      const dni = String(s.dni || '');
      return ap.includes(search) || dni.includes(search);
    });

    renderTabla(rows);
  }

  function renderTabla(rows) {
    const tbody = $('pagosTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    rows.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.numero_socio ?? ''}</td>
        <td>${s.nombre ?? ''} ${s.apellido ?? ''}</td>
        <td>
          <button class="btn btn-secondary" data-act="details" data-id="${s.socio_id}">
            Ver detalles
          </button>
        </td>
      `;
      tbody.appendChild(tr);
});
}

/* =============================
 * Modal Registrar Pago (socios)
 * ============================= */
function openModal() {
    const modal = $('modalPago');
    if (!modal) return;

    selectedSocioId = null;
    mesesPagados.clear();
    mesesSeleccionados.clear();

    if ($('modalSocioSearch')) $('modalSocioSearch').value = '';
    if ($('modalFechaPago')) $('modalFechaPago').value = todayISO();
    if ($('modalAnioLabel')) $('modalAnioLabel').textContent = String(selectedYear);

    renderSociosList();
    renderMesesGrid();
    modal.classList.remove('hidden');
  }

  function closeModal() {
    $('modalPago')?.classList.add('hidden');
  }

  function renderSociosList() {
    const cont = $('modalSocioList');
    if (!cont) return;

    const q = (($('modalSocioSearch')?.value) || '').trim().toLowerCase();
    const list = sociosCache.filter(s => {
      if (!q) return true;
      return String(s.apellido || '').toLowerCase().includes(q) || String(s.dni || '').includes(q);
    });

    cont.innerHTML = '';
    list.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'navbtn';
      btn.style.margin = '4px 0';
      btn.style.background = String(s.id) === String(selectedSocioId) ? '#2563eb' : '#1f2937';
      btn.textContent = `${s.apellido ?? ''} ${s.nombre ?? ''} - ${s.dni ?? ''}`;

      btn.addEventListener('click', async () => {
        selectedSocioId = s.id;
        await refreshMesesPagados();
        renderSociosList();
        renderMesesGrid();
      });

      cont.appendChild(btn);
    });
  }

  async function refreshMesesPagados() {
    mesesPagados.clear();
    mesesSeleccionados.clear();
    if (!selectedSocioId) return;

    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/pagos/${selectedSocioId}?anio=${selectedYear}`);
    if (!res.ok || !data.ok) {
      console.error(data.error || 'Error cargando pagos del socio');
      return;
    }
    (data.mesesPagados || []).forEach(m => mesesPagados.add(Number(m)));
  }

  function renderMesesGrid() {
    const grid = $('mesesGrid');
    if (!grid) return;

    grid.innerHTML = '';
    MESES.forEach(m => {
      const paid = mesesPagados.has(m.n);
      const selected = mesesSeleccionados.has(m.n);

      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary';
      b.style.padding = '12px 10px';
      b.style.borderRadius = '10px';
      b.style.fontWeight = '700';
      b.style.background = paid ? '#d1d5db' : (selected ? '#16a34a' : '#e5e7eb');
      b.style.color = paid ? '#6b7280' : (selected ? '#fff' : '#111827');
      b.disabled = paid || !selectedSocioId;
      b.innerHTML = paid ? `${m.label} ✅` : m.label;

      b.addEventListener('click', () => {
        if (mesesSeleccionados.has(m.n)) mesesSeleccionados.delete(m.n);
        else mesesSeleccionados.add(m.n);
        renderMesesGrid();
        renderMontoHint();
      });

      grid.appendChild(b);
    });

    renderMontoHint();
  }

  function renderMontoHint() {
    const el = $('montoHint');
    if (!el) return;

    if (!mesesSeleccionados.size) {
      el.textContent = selectedSocioId
        ? 'Seleccioná uno o más meses para ver el total.'
        : 'Seleccioná un socio para habilitar meses.';
      return;
    }

    let total = 0;
    const faltan = [];
    mesesSeleccionados.forEach(m => {
      const monto = cuotasMap.get(m);
      if (monto == null) faltan.push(m);
      else total += Number(monto);
    });

    if (faltan.length) {
      el.textContent = `Falta configurar monto para meses: ${faltan.join(', ')}`;
      return;
    }

    el.textContent = `Total estimado: $ ${total.toFixed(2)} (según Configuración)`;
  }

  async function savePago() {
    if (!selectedSocioId) return alert('Seleccioná un socio');
    if (!mesesSeleccionados.size) return alert('Seleccioná al menos un mes');

    const fecha = $('modalFechaPago')?.value;
    if (!fecha) return alert('Seleccioná fecha de pago');

    const clubId = getActiveClubId();
    const body = {
      socio_id: selectedSocioId,
      anio: selectedYear,
      meses: Array.from(mesesSeleccionados),
      fecha_pago: fecha
    };

    const btn = $('btnPagoSave');
    if (btn) btn.disabled = true;
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/pagos`, {
        method: 'POST',
        body: JSON.stringify(body),
        json: true
      });
      if (!res.ok || !data.ok) {
        alert(data.error || 'Error guardando pago');
        return;
      }
      alert(`✅ Pagos guardados: ${data.insertedCount}`);
      closeModal();
      await loadResumen();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* =============================
   * Modal Detalles (socios)
   * ============================= */
  function mesLabel(num) {
    const m = MESES.find(x => x.n === Number(num));
    return m ? m.label : String(num);
  }

  function openDetallesUI() {
    $('modalPagoDetalles')?.classList.remove('hidden');
  }

  function closeDetallesUI() {
    $('modalPagoDetalles')?.classList.add('hidden');
  }

  async function openDetallesModal(socioId) {
    const clubId = getActiveClubId();
    const socio = sociosCache.find(
      s => String(s.id) === String(socioId) || String(s.socio_id) === String(socioId)
    );

    const nombreSocio = socio
      ? `${socio.apellido ?? ''} ${socio.nombre ?? ''}`.trim()
      : `Socio ${socioId}`;

    $('detTitle').textContent = `Pagos de ${nombreSocio}`;
    $('detSub').textContent = `Año: ${selectedYear}`;
    $('detTableBody').innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';
    $('detTotal').textContent = '';

    openDetallesUI();

    const { res, data } = await fetchAuth(`/club/${clubId}/pagos/${socioId}?anio=${selectedYear}`);
    if (!res.ok || !data.ok) {
      $('detTableBody').innerHTML = `<tr><td colspan="3">Error: ${data.error || 'No se pudo cargar'}</td></tr>`;
      return;
    }

    const pagos = data.pagos || [];
    if (!pagos.length) {
      $('detTableBody').innerHTML = '<tr><td colspan="3">No hay pagos registrados para este año.</td></tr>';
      $('detTotal').textContent = 'Total: $ 0.00';
      return;
    }

    let total = 0;
    $('detTableBody').innerHTML = '';
    pagos.forEach(p => {
      total += Number(p.monto || 0);
      const fecha = String(p.fecha_pago || '').slice(0, 10);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${mesLabel(p.mes)}</strong></td>
        <td>$ ${Number(p.monto || 0).toFixed(2)}</td>
        <td>${fecha || '—'}</td>
      `;
      $('detTableBody').appendChild(tr);
    });

    $('detTotal').textContent = `Total: $ ${total.toFixed(2)}`;
  }

  /* =============================
   * ✅ Ingresos generales (no socios)
   * ============================= */
  function ingresosRangeQS() {
    const desde = `${selectedYear}-01-01`;
    const hasta = `${selectedYear}-12-31`;
    const qs = new URLSearchParams();
    qs.set('desde', desde);
    qs.set('hasta', hasta);
    qs.set('limit', '200');
    qs.set('offset', '0');
    return qs.toString();
  }

  async function loadTiposIngreso() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/config/tipos-ingreso`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando tipos de ingreso');

    tiposIngresoCache = data.tipos || data.items || [];
    const sel = $('ingresoTipo');
    if (sel) {
      if (!tiposIngresoCache.length) {
        sel.innerHTML = `<option value="">(No hay tipos cargados)</option>`;
      } else {
        sel.innerHTML = `<option value="">Seleccionar...</option>` +
          tiposIngresoCache.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
      }
    }
  }

  async function loadIngresos() {
    ensureIngresosUI();
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/ingresos?${ingresosRangeQS()}`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando ingresos');

    ingresosCache = data.ingresos || [];
    renderIngresos(ingresosCache, data.total);
  }

  function renderIngresos(rows, total) {
    const tbody = $('ingresosTableBody');
    const totalEl = $('ingresosTotal');
    if (totalEl) totalEl.textContent = moneyARS(total);

    if (!tbody) return;
    tbody.innerHTML = '';

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">No hay ingresos cargados para este año.</td></tr>`;
      return;
    }

    rows.forEach(r => {
      const fecha = String(r.fecha || '').slice(0, 10);
      const tr = document.createElement('tr');
      tr.innerHTML = `
  <td>${fecha}</td>
  <td><strong>${r.tipo_ingreso || ''}</strong></td>
  <td>${r.observacion || ''}</td>
  <td><strong>${moneyARS(r.monto)}</strong></td>
  <td style="text-align:right;">
    <button class="btn btn-secondary" data-act="del-ingreso" data-id="${r.id}">
      🗑️
    </button>
  </td>
`;
      tbody.appendChild(tr);
    });
  }

async function deleteIngreso(id) {
  const clubId = getActiveClubId();
  if (!id) return;

  if (!confirm('¿Eliminar este ingreso?')) return;

  const { res, data } = await fetchAuth(`/club/${clubId}/ingresos/${id}`, {
    method: 'DELETE'
  });

  if (!res.ok || !data.ok) {
    alert(data.error || 'Error eliminando ingreso');
    return;
  }

  await loadIngresos();
}

  async function saveIngreso() {
    const clubId = getActiveClubId();
    const tipo = $('ingresoTipo')?.value;
    const fecha = $('ingresoFecha')?.value;
    const monto = $('ingresoMonto')?.value;
    const obs = $('ingresoObs')?.value;

    if (!tipo) return alert('Seleccioná un tipo de ingreso');
    if (!fecha) return alert('Seleccioná una fecha');
    if (monto === '' || monto == null) return alert('Ingresá un monto');

    const montoNum = Number(monto);
    if (Number.isNaN(montoNum) || montoNum < 0) return alert('Monto inválido');

    const btn = $('btnIngresoSave');
    if (btn) btn.disabled = true;

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/ingresos`, {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          tipo_ingreso_id: tipo,
          fecha,
          monto: montoNum,
          observacion: (obs || '').trim() || null
        })
      });

      if (!res.ok || !data.ok) {
        alert(data.error || 'Error guardando ingreso');
        return;
      }

      closeIngresoModal();
      await loadIngresos();
      alert('✅ Ingreso registrado');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* =============================
   * Año selector + bind
   * ============================= */
  function fillAnios() {
    const sel = $('pagosAnioSelect');
    if (!sel) return;

    const y = new Date().getFullYear();
    sel.innerHTML = '';
    for (let i = y - 3; i <= y + 1; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      sel.appendChild(opt);
    }
    sel.value = String(selectedYear);
  }

  function setSelectedYear(y) {
    selectedYear = Number(y);
    if ($('modalAnioLabel')) $('modalAnioLabel').textContent = String(selectedYear);
    if ($('pagosAnioSelect')) $('pagosAnioSelect').value = String(selectedYear);
  }

function bindAccordion() {
  const root = document.querySelector('.section-pagos');
  if (!root) return;
  if (root.dataset.accordionBound === '1') return;
  root.dataset.accordionBound = '1';

  root.addEventListener('click', (e) => {
    const header = e.target.closest('.accordion-header');
    if (!header) return;

    // Si clickean un botón dentro del header, NO togglear
    if (e.target.closest('button')) return;

    const targetId = header.dataset.target;
    if (!targetId) return;

    const panel = document.getElementById(targetId);
    const acc = header.closest('.accordion');
    if (!panel || !acc) return;

    const isOpen = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', isOpen);
    acc.classList.toggle('open', !isOpen);
  });
}

  function bindOnce() {
    const root = document.querySelector('.section-pagos');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    

    // Pagos socios
    $('btnPagoAdd')?.addEventListener('click', openModal);
    $('btnPagoClose')?.addEventListener('click', closeModal);
    $('btnPagoCancel')?.addEventListener('click', closeModal);
    $('btnPagoSave')?.addEventListener('click', savePago);
    $('modalSocioSearch')?.addEventListener('input', renderSociosList);
    $('btnRefreshPagos')?.addEventListener('click', async () => { await loadResumen(); await loadIngresos(); });
    $('pagosSearch')?.addEventListener('input', loadResumen);

    // Botón ingreso + modal ingreso
    $('btnIngresoAdd')?.addEventListener('click', async () => {
      await loadTiposIngreso();
      openIngresoModal();
    });
    $('btnIngresoClose')?.addEventListener('click', closeIngresoModal);
    $('btnIngresoCancel')?.addEventListener('click', closeIngresoModal);
    $('formIngreso')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveIngreso();
    });

$('ingresosTableBody')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'del-ingreso') {
    await deleteIngreso(btn.dataset.id);
  }
});

    // Año
    $('btnAnioPrev')?.addEventListener('click', async () => {
      setSelectedYear(selectedYear - 1);
      await refreshMesesPagados();
      renderMesesGrid();
      await loadResumen();
      await loadIngresos();
    });

    $('btnAnioNext')?.addEventListener('click', async () => {
      setSelectedYear(selectedYear + 1);
      await refreshMesesPagados();
      renderMesesGrid();
      await loadResumen();
      await loadIngresos();
    });

    $('pagosAnioSelect')?.addEventListener('change', async (e) => {
      setSelectedYear(e.target.value);
      await refreshMesesPagados();
      renderMesesGrid();
      await loadResumen();
      await loadIngresos();
    });

    // Detalles socios
    $('pagosTableBody')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'details') {
        openDetallesModal(btn.dataset.id);
      }
    });

    $('btnDetClose')?.addEventListener('click', closeDetallesUI);
    $('btnDetOk')?.addEventListener('click', closeDetallesUI);
    $('modalPagoDetalles')?.addEventListener('click', (ev) => {
      if (ev.target?.id === 'modalPagoDetalles') closeDetallesUI();
    });

    // Cerrar modales con click fuera
    $('modalIngreso')?.addEventListener('click', (ev) => {
      if (ev.target?.id === 'modalIngreso') closeIngresoModal();
    });

    // Escape
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (!$('modalPago')?.classList.contains('hidden')) closeModal();
        if (!$('modalPagoDetalles')?.classList.contains('hidden')) closeDetallesUI();
        if (!$('modalIngreso')?.classList.contains('hidden')) closeIngresoModal();
      }
    });
  }

  async function initPagosSection() {
 bindOnce();
 bindAccordion(); // ✅ acordeones (Pagos / Otros ingresos)
 fillAnios(); 
 await Promise.all([loadSociosAll(), loadCuotas()]); 
 await loadResumen(); 
 // Ingresos (debajo) 
 await loadTiposIngreso().catch(() => {}); // no bloquear si aún no hay tipos 
 await loadIngresos().catch(() => {}); 
}

  window.initPagosSection = initPagosSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.section-pagos')) {
      initPagosSection();
    }
  });
})();