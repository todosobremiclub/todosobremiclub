(() => {
  const $ = id => document.getElementById(id);

  const MESES = [
    { n:1,  label:'Ene' }, { n:2,  label:'Feb' }, { n:3,  label:'Mar' }, { n:4,  label:'Abr' },
    { n:5,  label:'May' }, { n:6,  label:'Jun' }, { n:7,  label:'Jul' }, { n:8,  label:'Ago' },
    { n:9,  label:'Sep' }, { n:10, label:'Oct' }, { n:11, label:'Nov' }, { n:12, label:'Dic' },
  ];

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) { alert('Sesión expirada'); window.location.href='/admin.html'; throw new Error('No token'); }
    return t;
  }
  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) { alert('No hay club activo'); throw new Error('No activeClubId'); }
    return c;
  }
  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok:false, error:text }; }
    return { res, data };
  }

  // Estado
  let sociosCache = [];
  let cuotasMap = new Map(); // mes -> monto
  let selectedSocioId = null;
  let selectedYear = new Date().getFullYear();
  let mesesPagados = new Set();
  let mesesSeleccionados = new Set();

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  async function loadSociosAll() {
    const clubId = getActiveClubId();
    // Pedimos muchos para selección; si preferís paginado lo cambiamos después.
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

    const search = ($('pagosSearch')?.value || '').trim().toLowerCase();

    const rows = (data.socios || []).filter(s => {
      if (!search) return true;
      const dni = String(s.dni || '');
      const ap = String(s.apellido || '').toLowerCase();
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
        <td><button class="btn btn-secondary" data-act="details" data-id="${s.socio_id}">Ver detalles</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openModal() {
    const modal = $('modalPago');
    if (!modal) return;
    selectedSocioId = null;
    mesesPagados = new Set();
    mesesSeleccionados = new Set();
    $('modalSocioSearch').value = '';
    $('modalFechaPago').value = todayISO();
    $('modalAnioLabel').textContent = String(selectedYear);
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
    const q = ($('modalSocioSearch')?.value || '').trim().toLowerCase();

    const list = sociosCache.filter(s => {
      if (!q) return true;
      return String(s.apellido || '').toLowerCase().includes(q) ||
             String(s.dni || '').includes(q);
    });

    cont.innerHTML = '';
    list.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'navbtn';
      btn.style.background = (String(s.id) === String(selectedSocioId)) ? '#2563eb' : '#1f2937';
      btn.style.margin = '4px 0';
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
    mesesPagados = new Set();
    mesesSeleccionados = new Set();
    if (!selectedSocioId) return;
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/pagos/${selectedSocioId}?anio=${selectedYear}`);
    if (!res.ok || !data.ok) {
      console.error(data.error);
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
      b.style.background = paid ? '#d1d5db' : (selected ? '#16a34a' : '#e5e7eb');
      b.style.color = paid ? '#6b7280' : (selected ? '#fff' : '#111827');
      b.style.fontWeight = '700';
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
      el.textContent = selectedSocioId ? 'Seleccioná uno o más meses para ver el total.' : 'Seleccioná un socio para habilitar meses.';
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

  function fillAnios() {
    const sel = $('pagosAnioSelect');
    if (!sel) return;
    const y = new Date().getFullYear();
