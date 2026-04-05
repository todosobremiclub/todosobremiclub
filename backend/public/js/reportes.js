// public/js/reportes.js
(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // ESTADO GLOBAL
  // =============================
  let chartActividades = null;
  let chartIGMes = null;

  // Plugin para texto en el centro de un doughnut
  const centerTextPlugin = {
    id: 'centerText',
    beforeDraw(chart, args, opts) {
      const text = opts && opts.text;
      if (!text) return;

      const { ctx, chartArea: { left, right, top, bottom } } = chart;
      ctx.save();
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;

      ctx.font = '600 18px system-ui, -apple-system, BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.fillStyle = '#111827';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  };

  const MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  const moneyARS = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const actividadesState = {
    modo: 'actividades',           // 'actividades' | 'categorias'
    actividadSeleccionada: null,
    actividadesRows: [],
    categoriasByActividad: {}      // { actividad: [ { categoria, cantidad } ] }
  };

  const impagosState = {
    anio: new Date().getFullYear(),
    rows: [],            // [{ anio, mes, cantidad, mes_num }]
    currentIndex: 0,
    page: 0,
    pageSize: 20,
    totalForCurrent: 0
  };

  const igState = {
    anualRows: [],       // [{ anio, ingresos, gastos }]
    years: [],
    yearIndex: 0,
    mesesRows: [],       // [{ mes, ingresos, gastos }]
    mesIndex: 0
  };

  const nuevosState = {
    anio: new Date().getFullYear(),
    rows: [],            // [{ anio, mes, mes_num, cantidad }]
    mesIndex: 0
  };

  const rankingState = {
    anio: new Date().getFullYear(),
    mes: new Date().getMonth() + 1
  };

  const cuentasState = {
    anio: new Date().getFullYear(),
    mes: new Date().getMonth() + 1
  };

const igRespState = {
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1
};

  // =============================
  // HELPERS AUTH + FETCH
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
    const headers = options.headers ?? {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

    const { json, ...rest } = options;
    const res = await fetch(url, { ...rest, headers });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text };
    }

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    return { res, data };
  }

  // =============================
  // HELPERS GENERALES
  // =============================
  function showLoading(el, msg = 'Cargando...') {
    if (!el) return;
    el.innerHTML = `<div class="muted">${msg}</div>`;
  }

  function showError(el, msg = 'Error') {
    if (!el) return;
    el.innerHTML = `<div class="muted" style="color:#b91c1c;">${msg}</div>`;
  }

  	
    function formatFecha(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// =============================
// MODAL DETALLE (Ranking / Cuentas / IG Responsable)
// =============================
function ensureDetalleModal() {
  const modal = $('detalleModal');
  if (!modal) return null;
  if (modal.dataset.bound === '1') return modal;

  modal.dataset.bound = '1';
  const btnClose = $('detalleModalClose');
  const close = () => modal.classList.add('hidden');

  if (btnClose) btnClose.addEventListener('click', (e) => { e.preventDefault(); close(); });
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });

  return modal;
}

function setDetalleHeader({ title, sub }) {
  const t = $('detalleModalTitle');
  const s = $('detalleModalSub');
  if (t) t.textContent = title || 'Detalle';
  if (s) s.textContent = sub || '';
}

function setDetalleFooter({ info, total }) {
  const i = $('detalleModalInfo');
  const tot = $('detalleModalTotal');
  if (i) i.textContent = info || '';
  if (tot) tot.textContent = total || '';
}

function renderTableGeneric({ columns, rows, moneyKey = 'monto', dateKey = 'fecha' }) {
  if (!rows || !rows.length) {
    return `<div class="muted small">Sin movimientos para este filtro.</div>`;
  }

  const total = rows.reduce((a, r) => a + Number(r[moneyKey] || 0), 0);

  const head = columns.map(c => `<th>${c.label}</th>`).join('');
  const body = rows.map(r => `
    <tr>
      ${columns.map(c => {
        const v = r[c.key];
        if (c.key === moneyKey) return `<td style="text-align:right;">${moneyARS.format(Number(v || 0))}</td>`;
        if (c.key === dateKey) return `<td>${formatFecha(v)}</td>`;
        return `<td>${v ?? ''}</td>`;
      }).join('')}
    </tr>
  `).join('');

  return {
    html: `
      <table class="socios-table" style="font-size:12px;">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    `,
    total
  };
}

async function openDetalleModal({ title, sub, url, columns, moneyKey, dateKey }) {
  const modal = ensureDetalleModal();
  const body = $('detalleModalBody');
  if (!modal || !body) return;

  setDetalleHeader({ title, sub });
  setDetalleFooter({ info: '', total: '' });
  body.innerHTML = `<div class="muted">Cargando detalle...</div>`;
  modal.classList.remove('hidden');

  try {
    const { data } = await fetchAuth(url);
    if (!data.ok) {
      body.innerHTML = `<div class="muted" style="color:#b91c1c;">${data.error || 'Error cargando detalle'}</div>`;
      return;
    }

    // data.rows puede ser array o objeto (en IG Resp)
    const rows = Array.isArray(data.rows) ? data.rows : (data.rows || []);

    const rendered = renderTableGeneric({ columns, rows, moneyKey, dateKey });
    body.innerHTML = rendered.html;
    setDetalleFooter({
      info: `${rows.length} movimientos`,
      total: `Total: ${moneyARS.format(rendered.total)}`
    });

  } catch (e) {
    console.error(e);
    body.innerHTML = `<div class="muted" style="color:#b91c1c;">${e.message || 'Error inesperado'}</div>`;
  }
}

  // =============================
  // PANEL 1 – ACTIVIDADES / CATEGORÍAS
  // =============================
  async function loadActividadesMain() {
    const cardTable = $('tablaActividades');
    const subtitle  = $('actividadesSubtitle');
    const resetBtn  = $('btnActividadesReset');
    if (!cardTable) return;

    actividadesState.modo = 'actividades';
    actividadesState.actividadSeleccionada = null;
    actividadesState.categoriasByActividad = {};
    if (resetBtn) resetBtn.classList.add('hidden');
    if (subtitle) {
      subtitle.textContent = 'Distribución de socios activos por actividad. Hacé click en el gráfico para ver las categorías.';
    }

    showLoading(cardTable, 'Cargando actividades...');

    try {
      const clubId = getActiveClubId();
      const { res, data } = await fetchAuth(`/club/${clubId}/reportes/socios-actividad-categoria`);
      if (!res.ok || !data.ok) {
        showError(cardTable, data.error || 'Error cargando actividades');
        return;
      }
      actividadesState.actividadesRows = data.rows || [];
      renderActividadesView();
    } catch (e) {
      console.error(e);
      showError(cardTable, e.message || 'Error inesperado cargando actividades');
    }
  }

  function destroyChartActividades() {
    if (chartActividades) {
      chartActividades.destroy();
      chartActividades = null;
    }
  }

  function renderActividadesView() {
    const cardTable   = $('tablaActividades');
    const subtitle    = $('actividadesSubtitle');
    const resetBtn    = $('btnActividadesReset');
    const detailBody  = $('detailActividadesBody');
    const canvas      = $('chartActividades');

    if (!canvas) return;

    destroyChartActividades();

    const ctx  = canvas.getContext('2d');
    const modo = actividadesState.modo;

    let labels      = [];
    let dataVals    = [];
    let totalSocios = 0;

    if (modo === 'actividades') {
      const rows = actividadesState.actividadesRows || [];
      labels      = rows.map(r => r.actividad || 'Sin actividad');
      dataVals    = rows.map(r => Number(r.cantidad || 0));
      totalSocios = rows.reduce((acc, r) => acc + Number(r.cantidad || 0), 0);

      if (subtitle) {
        subtitle.textContent = 'Distribución de socios activos por actividad. Hacé click en el gráfico para ver las categorías.';
      }
      if (resetBtn) resetBtn.classList.add('hidden');
      if (detailBody) {
        detailBody.innerHTML = `<div class="muted small">Hacé click en el gráfico para ver categorías. El detalle de socios aparecerá aquí abajo.</div>`;
      }

    } else { // modo === 'categorias'
      const actividad = actividadesState.actividadSeleccionada || '';
      const catRows   = actividadesState.categoriasByActividad[actividad] || [];

      labels      = catRows.map(r => r.categoria || 'Sin categoría');
      dataVals    = catRows.map(r => Number(r.cantidad || 0));
      totalSocios = catRows.reduce((acc, r) => acc + Number(r.cantidad || 0), 0);

      if (subtitle) {
        subtitle.textContent = `Categorías dentro de la actividad "${actividad}".`;
      }
      if (resetBtn) resetBtn.classList.remove('hidden');
      if (detailBody) {
        detailBody.innerHTML = `<div class="muted small">Hacé click en una categoría para ver el listado de socios.</div>`;
      }
    }

    if (cardTable) cardTable.innerHTML = '';

    chartActividades = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: dataVals,
          backgroundColor: [
            '#22c55e','#3b82f6','#f97316',
            '#e11d48','#a855f7','#06b6d4',
            '#facc15','#64748b','#16a34a'
          ],
          borderWidth: 1
        }]
      },
      options: {
        cutout: '60%',
        plugins: {
          legend: { position: 'right' },
          centerText: { text: String(totalSocios) }
        },
        maintainAspectRatio: false
      },
      plugins: [centerTextPlugin]
    });
  }

  async function loadCategoriasForActividad(actividad) {
    const key = actividad || '';
    if (!key) return;

    if (!actividadesState.categoriasByActividad[key]) {
      try {
        const clubId = getActiveClubId();
        const params = new URLSearchParams({ actividad: key });
        const url = `/club/${clubId}/reportes/socios-actividad-categoria/detalle?${params.toString()}`;
        const { data } = await fetchAuth(url);
        if (!data.ok) {
          alert(data.error || 'Error cargando categorías');
          return;
        }
        actividadesState.categoriasByActividad[key] = data.rows || [];
      } catch (e) {
        console.error(e);
        alert(e.message || 'Error cargando categorías');
        return;
      }
    }

    actividadesState.modo = 'categorias';
    actividadesState.actividadSeleccionada = key;
    renderActividadesView();
  }

  async function loadSociosForActividadCategoria(actividad, categoria) {
    const detailBody = $('detailActividadesBody');
    if (!detailBody) return;

    showLoading(detailBody, `Cargando socios de ${actividad} / ${categoria}...`);

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({
        actividad,
        categoria,
        activo: '1'
      });
      const url = `/club/${clubId}/reportes/socios-actividad-categoria/detalle?${params.toString()}`;
      const { data } = await fetchAuth(url);
      if (!data.ok) {
        showError(detailBody, data.error || 'Error cargando socios');
        return;
      }
      const rows = data.rows || [];
      if (!rows.length) {
        showError(detailBody, 'No hay socios en esa categoría.');
        return;
      }

      const html = `
        <table class="socios-table" style="font-size:13px;">
          <thead>
            <tr>
              <th>N° Socio</th>
              <th>DNI</th>
              <th>Nombre</th>
              <th>Apellido</th>
              <th>Teléfono</th>
              <th>Fecha ingreso</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(s => `
              <tr>
                <td>${s.numero_socio ?? ''}</td>
                <td>${s.dni ?? ''}</td>
                <td>${s.nombre ?? ''}</td>
                <td>${s.apellido ?? ''}</td>
                <td>${s.telefono ?? ''}</td>
                <td>${s.fecha_ingreso ? String(s.fecha_ingreso).substring(0,10) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      detailBody.innerHTML = html;
    } catch (e) {
      console.error(e);
      showError(detailBody, e.message || 'Error inesperado cargando socios');
    }
  }

  function bindActividadesInteractions() {
    const resetBtn = $('btnActividadesReset');
    const canvas   = $('chartActividades');

    if (canvas) {
      canvas.addEventListener('click', (evt) => {
        if (!chartActividades) return;

        const points = chartActividades.getElementsAtEventForMode(
          evt,
          'nearest',
          { intersect: true },
          true
        );
        if (!points || !points.length) return;
        const idx = points[0].index;

        if (actividadesState.modo === 'actividades') {
          const rows = actividadesState.actividadesRows || [];
          const row  = rows[idx];
          if (row && row.actividad) {
            loadCategoriasForActividad(row.actividad);
          }
        } else {
          const actividad = actividadesState.actividadSeleccionada;
          const catRows   = actividadesState.categoriasByActividad[actividad] || [];
          const row       = catRows[idx];
          if (row && actividad && row.categoria) {
            loadSociosForActividadCategoria(actividad, row.categoria);
          }
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        actividadesState.modo = 'actividades';
        actividadesState.actividadSeleccionada = null;
        renderActividadesView();
      });
    }
  }

  // =============================
  // PANEL 2 – IMPAGOS POR MES
  // =============================
  async function loadImpagosData(anio) {
    const tabela = $('tablaImpagos');
    const detailBody = $('detailImpagosBody');
    if (anio) impagosState.anio = anio;
    if (tabela) showLoading(tabela, 'Cargando morosidad...');

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({ anio: String(impagosState.anio) });
      const url = `/club/${clubId}/reportes/impagos-mes?${params.toString()}`;
      const { data } = await fetchAuth(url);
      if (!data.ok) {
        if (tabela) showError(tabela, data.error || 'Error cargando impagos');
        return;
      }
      const rows = data.rows || [];
      impagosState.rows = rows;

      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      let idx = 0;
      const found = rows.findIndex(r => Number(r.mes_num) === currentMonth);
      if (found >= 0) idx = found;
      impagosState.currentIndex = idx;

      renderImpagosPanel();
      if (detailBody) {
        detailBody.innerHTML = '<div class="muted small">Hacé click en la cantidad de impagos para ver el listado de socios.</div>';
      }
    } catch (e) {
      console.error(e);
      if (tabela) showError(tabela, e.message || 'Error inesperado cargando impagos');
    }
  }

  function renderImpagosPanel() {
    const tabela = $('tablaImpagos');
    const kpi = $('impagosCount');
    const mesLabel = $('impagosMesLabel');
    const yearLabel = $('impagosYearLabel');

    if (!tabela || !kpi || !mesLabel || !yearLabel) return;

    const rows = impagosState.rows || [];
    if (!rows.length) {
      tabela.innerHTML = '<div class="muted">No hay datos de impagos para este año.</div>';
      kpi.textContent = '–';
      mesLabel.textContent = 'Sin datos';
      yearLabel.textContent = `Año ${impagosState.anio}`;
      return;
    }

    const idx = Math.max(0, Math.min(impagosState.currentIndex, rows.length - 1));
    impagosState.currentIndex = idx;
    const rowSel = rows[idx];

    kpi.textContent = rowSel.cantidad ?? rowSel.cantidad === 0 ? rowSel.cantidad : '0';
    mesLabel.textContent = rowSel.mes;
    yearLabel.textContent = `Año ${rowSel.anio}`;

    const html = `
      <table class="socios-table" style="font-size:13px;">
        <thead>
          <tr>
            <th>Mes</th>
            <th style="text-align:right;">Socios sin pago</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="row-impago ${i === idx ? 'row-selected' : ''}"
                data-index="${i}">
              <td>${r.mes}</td>
              <td style="text-align:right;">${r.cantidad}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tabela.innerHTML = html;
  }

  // MODAL IMPAGOS
  function ensureImpagosModal() {
    const modal = $('impagosModal');
    if (!modal) return null;

    if (modal.dataset.bound === '1') return modal;
    modal.dataset.bound = '1';

    const btnClose = $('impagosModalClose');
    const btnPrev  = $('impagosModalPrev');
    const btnNext  = $('impagosModalNext');

    const close = () => modal.classList.add('hidden');

    if (btnClose) {
      btnClose.addEventListener('click', (e) => { e.preventDefault(); close(); });
    }

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });

    if (btnPrev) {
      btnPrev.addEventListener('click', async () => {
        if (impagosState.page <= 0) return;
        impagosState.page -= 1;
        await loadImpagosPageForCurrent();
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', async () => {
        const maxPage = Math.max(
          0,
          Math.ceil(impagosState.totalForCurrent / impagosState.pageSize) - 1
        );
        if (impagosState.page >= maxPage) return;
        impagosState.page += 1;
        await loadImpagosPageForCurrent();
      });
    }

    return modal;
  }

  async function openImpagosModalForCurrent() {
    const rows = impagosState.rows || [];
    if (!rows.length) return;

    const idx = impagosState.currentIndex;
    const sel = rows[idx];

    const modal   = ensureImpagosModal();
    const titleEl = $('impagosModalTitle');
    const subEl   = $('impagosModalSub');

    if (!modal) return;

    if (titleEl) titleEl.textContent = 'Cuotas impagas';
    if (subEl)   subEl.textContent   = `${sel.mes} ${sel.anio} · socios activos sin registro de pago`;

    impagosState.page = 0;
    modal.classList.remove('hidden');
    await loadImpagosPageForCurrent();
  }

  async function loadImpagosPageForCurrent() {
    const rows = impagosState.rows || [];
    const idx  = impagosState.currentIndex;
    const body = $('impagosModalBody');
    const info = $('impagosModalInfo');

    if (!body || !rows.length) return;

    const sel   = rows[idx];
    const limit = impagosState.pageSize;
    const offset= impagosState.page * impagosState.pageSize;

    body.innerHTML = '<div class="muted">Cargando socios impagos...</div>';
    if (info) info.textContent = '';

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({
        anio:   String(sel.anio),
        mes:    String(sel.mes_num),
        limit:  String(limit),
        offset: String(offset)
      });

      const url = `/club/${clubId}/reportes/impagos-mes/detalle?${params.toString()}`;
      const { data } = await fetchAuth(url);

      if (!data.ok) {
        body.innerHTML = `<div class="muted" style="color:#b91c1c;">${data.error || 'Error cargando socios'}</div>`;
        return;
      }

      const items = data.items || [];
      impagosState.totalForCurrent = Number(data.total || items.length);

      if (!items.length) {
        body.innerHTML = '<div class="muted">No hay socios impagos para este mes.</div>';
        if (info) info.textContent = '';
        return;
      }

      const html = `
        <table class="socios-table" style="font-size:13px;">
          <thead>
            <tr>
              <th>N° Socio</th>
              <th>DNI</th>
              <th>Apellido</th>
              <th>Nombre</th>
              <th>Actividad</th>
              <th>Categoría</th>
              <th>Teléfono</th>
              <th>Fecha ingreso</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(s => `
              <tr>
                <td>${s.numero_socio ?? ''}</td>
                <td>${s.dni ?? ''}</td>
                <td>${s.apellido ?? ''}</td>
                <td>${s.nombre ?? ''}</td>
                <td>${s.actividad ?? ''}</td>
                <td>${s.categoria ?? ''}</td>
                <td>${s.telefono ?? ''}</td>
                <td>${formatFecha(s.fecha_ingreso)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      body.innerHTML = html;

      if (info) {
        const desde = offset + 1;
        const hasta = offset + items.length;
        info.textContent = `Mostrando ${desde}-${hasta} de ${impagosState.totalForCurrent} socios impagos`;
      }

    } catch (e) {
      console.error(e);
      body.innerHTML = `<div class="muted" style="color:#b91c1c;">${e.message || 'Error inesperado cargando socios impagos'}</div>`;
    }
  }

  async function loadImpagosDetalleForCurrent() {
    await openImpagosModalForCurrent();
  }

  function bindImpagosInteractions() {
    const kpi    = $('impagosCount');
    const btnPrev= $('btnImpagosPrev');
    const btnNext= $('btnImpagosNext');
    const tabela = $('tablaImpagos');

    if (kpi) {
      kpi.style.cursor = 'pointer';
      kpi.addEventListener('click', () => {
        loadImpagosDetalleForCurrent();
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (!impagosState.rows.length) return;
        impagosState.currentIndex =
          (impagosState.currentIndex - 1 + impagosState.rows.length) % impagosState.rows.length;
        renderImpagosPanel();
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (!impagosState.rows.length) return;
        impagosState.currentIndex =
          (impagosState.currentIndex + 1) % impagosState.rows.length;
        renderImpagosPanel();
      });
    }

    if (tabela) {
      tabela.addEventListener('click', (ev) => {
        const row = ev.target.closest('.row-impago');
        if (!row) return;
        const idx = Number(row.dataset.index || '0');
        impagosState.currentIndex = idx;
        renderImpagosPanel();
      });
    }
  }

  // =============================
  // PANEL 3 – INGRESOS VS GASTOS
  // =============================
  function destroyChartIG() {
    if (chartIGMes) {
      chartIGMes.destroy();
      chartIGMes = null;
    }
  }

  async function loadIGAnual() {
    const detailBody = $('detailIngresosBody');
    if (detailBody) {
      detailBody.innerHTML = '<div class="muted small">Seleccioná un mes para ver el detalle de ingresos y gastos.</div>';
    }

    try {
      const clubId = getActiveClubId();
      const { data } = await fetchAuth(`/club/${clubId}/reportes/ingresos-vs-gastos`);
      if (!data.ok) {
        showError($('card-ingresos'), data.error || 'Error cargando ingresos vs gastos');
        return;
      }
      const rows = data.rows || [];
      igState.anualRows = rows;
      igState.years = rows.map(r => r.anio);
      if (!igState.years.length) return;

      igState.yearIndex = igState.years.length - 1;
      const currentYear = igState.years[igState.yearIndex];
      await loadIGMesesForYear(currentYear);
    } catch (e) {
      console.error(e);
      showError($('card-ingresos'), e.message || 'Error inesperado cargando ingresos vs gastos');
    }
  }

  async function loadIGMesesForYear(anio) {
    const canvas = $('chartIGMes');
    if (!canvas) return;

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({ anio: String(anio) });
      const { data } = await fetchAuth(`/club/${clubId}/reportes/ingresos-vs-gastos/meses?${params.toString()}`);
      if (!data.ok) {
        showError($('card-ingresos'), data.error || 'Error cargando meses');
        return;
      }
      igState.mesesRows = data.rows || [];

      const now = new Date();
      const currentMonth = now.getFullYear() === anio ? now.getMonth() + 1 : null;
      let idx = 0;
      if (currentMonth) {
        const found = igState.mesesRows.findIndex(r => MESES.indexOf(r.mes) + 1 === currentMonth);
        if (found >= 0) idx = found;
      }
      igState.mesIndex = idx;
      renderIGPanel();
    } catch (e) {
      console.error(e);
      showError($('card-ingresos'), e.message || 'Error inesperado cargando meses');
    }
  }

  function renderIGPanel() {
    const canvas    = $('chartIGMes');
    const anioLabel = $('igAnioLabel');
    const mesLabel  = $('igMesLabel');
    const anualIng  = $('igAnualIngresos');
    const anualGas  = $('igAnualGastos');
    const anualRes  = $('igAnualResultado');
    const mesIngEl  = $('igMesIngresos');
    const mesGasEl  = $('igMesGastos');
    const mesResEl  = $('igMesResultado');
    const detailBody= $('detailIngresosBody');

    if (!canvas || !anioLabel || !mesLabel || !anualIng || !anualGas || !anualRes) return;

    const ctx = canvas.getContext('2d');
    destroyChartIG();

    const anioActual = igState.years[igState.yearIndex];
    anioLabel.textContent = `Año ${anioActual}`;

    const rowAnual = igState.anualRows.find(r => r.anio === anioActual) || { ingresos: 0, gastos: 0 };
    const totalIng = Number(rowAnual.ingresos || 0);
    const totalGas = Number(rowAnual.gastos || 0);
    const totalRes = totalIng - totalGas;

    anualIng.textContent = moneyARS.format(totalIng);
    anualGas.textContent = moneyARS.format(totalGas);
    anualRes.textContent = moneyARS.format(totalRes);

    const meses = igState.mesesRows || [];
    if (!meses.length) {
      mesLabel.textContent = 'Sin datos';
      if (detailBody) {
        detailBody.innerHTML = '<div class="muted small">No hay datos mensuales para este año.</div>';
      }
      if (mesIngEl) mesIngEl.textContent = '–';
      if (mesGasEl) mesGasEl.textContent = '–';
      if (mesResEl) mesResEl.textContent = '–';
      return;
    }

    const idx = Math.max(0, Math.min(igState.mesIndex, meses.length - 1));
    igState.mesIndex = idx;
    const rowSel = meses[idx];

    const ingMes = Number(rowSel.ingresos || 0);
    const gasMes = Number(rowSel.gastos || 0);
    const resMes = ingMes - gasMes;

    mesLabel.textContent = rowSel.mes;
    if (mesIngEl) mesIngEl.textContent = moneyARS.format(ingMes);
    if (mesGasEl) mesGasEl.textContent = moneyARS.format(gasMes);
    if (mesResEl) mesResEl.textContent = moneyARS.format(resMes);

    const labelsFull  = meses.map(r => r.mes);
    const ingValsFull = meses.map(r => Number(r.ingresos || 0));
    const gasValsFull = meses.map(r => Number(r.gastos   || 0));

    // Ventana de 5 meses centrada
    let start = Math.max(0, idx - 2);
    let end   = Math.min(meses.length, idx + 3);

    const labels  = labelsFull.slice(start, end);
    const ingVals = ingValsFull.slice(start, end);
    const gasVals = gasValsFull.slice(start, end);

    chartIGMes = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Ingresos', data: ingVals, backgroundColor: '#22c55e' },
          { label: 'Gastos',   data: gasVals, backgroundColor: '#ef4444' }
        ]
      },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        scales:{
          x:{ beginAtZero:true },
          y:{ beginAtZero:true }
        },
        onClick: (evt, elements) => {
          if (!elements || !elements.length) return;
          const idxLocal = elements[0].index;
          const label    = labels[idxLocal];
          const globalIdx= labelsFull.indexOf(label);
          if (globalIdx >= 0) {
            igState.mesIndex = globalIdx;
            renderIGPanel();
            loadIGDetalleMes(anioActual, globalIdx + 1);
          }
        },
        plugins:{
          tooltip:{
            callbacks:{
              label:(context)=>{
                const valor = context.raw || 0;
                return `${context.dataset.label}: ${moneyARS.format(valor)}`;
              }
            }
          }
        }
      }
    });

    loadIGDetalleMes(anioActual, idx + 1);
  }

  async function loadIGDetalleMes(anio, mesNum) {
    const detailBody = $('detailIngresosBody');
    if (!detailBody) return;
    showLoading(detailBody, `Cargando detalle de ${MESES[mesNum - 1]} ${anio}...`);

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({
        anio: String(anio),
        mes:  String(mesNum),
        tipo: 'todos'
      });
      const { data } = await fetchAuth(`/club/${clubId}/reportes/ingresos-vs-gastos/detalle?${params.toString()}`);
      if (!data.ok) {
        showError(detailBody, data.error || 'Error cargando detalle de ingresos/gastos');
        return;
      }

      const rowsIng = (data.rows && data.rows.ingresos) || [];
      const rowsGas = (data.rows && data.rows.gastos) || [];

      const htmlIng = rowsIng.length
        ? `
          <h4 style="margin:4px 0 6px;">Ingresos</h4>
          <table class="socios-table" style="font-size:12px;">
            <thead>
              <tr>
                <th>Origen</th>
                <th>Fecha</th>
                <th>Monto</th>
                <th>Socio</th>
              </tr>
            </thead>
            <tbody>
              ${rowsIng.map(r => `
                <tr>
                  <td>${r.origen ?? ''}</td>
                  <td>${formatFecha(r.fecha_pago)}</td>
                  <td>${moneyARS.format(Number(r.monto || 0))}</td>
                  <td>${r.apellido ?? ''} ${r.nombre ?? ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
        : '<div class="muted small">Sin ingresos para este mes.</div>';

      const htmlGas = rowsGas.length
        ? `
          <h4 style="margin:10px 0 6px;">Gastos</h4>
          <table class="socios-table" style="font-size:12px;">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Responsable</th>
                <th>Fecha</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              ${rowsGas.map(r => `
                <tr>
                  <td>${r.tipo_gasto ?? ''}</td>
                  <td>${r.responsable ?? ''}</td>
                  <td>${formatFecha(r.fecha_gasto)}</td>
                  <td>${moneyARS.format(Number(r.monto || 0))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
        : '<div class="muted small">Sin gastos para este mes.</div>';

      detailBody.innerHTML = htmlIng + htmlGas;
    } catch (e) {
      console.error(e);
      showError(detailBody, e.message || 'Error inesperado cargando detalle de ingresos/gastos');
    }
  }

  function bindIGInteractions() {
    const btnMesPrev = $('btnIGMesPrev');
    const btnMesNext = $('btnIGMesNext');
    const btnAnioPrev= $('btnIGAnioPrev');
    const btnAnioNext= $('btnIGAnioNext');

    if (btnMesPrev) {
      btnMesPrev.addEventListener('click', () => {
        if (!igState.mesesRows.length) return;
        igState.mesIndex = (igState.mesIndex - 1 + igState.mesesRows.length) % igState.mesesRows.length;
        renderIGPanel();
      });
    }

    if (btnMesNext) {
      btnMesNext.addEventListener('click', () => {
        if (!igState.mesesRows.length) return;
        igState.mesIndex = (igState.mesIndex + 1) % igState.mesesRows.length;
        renderIGPanel();
      });
    }

    if (btnAnioPrev) {
      btnAnioPrev.addEventListener('click', async () => {
        const n = igState.years.length;
        if (!n) return;
        igState.yearIndex = (igState.yearIndex - 1 + n) % n;
        const anio = igState.years[igState.yearIndex];
        await loadIGMesesForYear(anio);
      });
    }

    if (btnAnioNext) {
      btnAnioNext.addEventListener('click', async () => {
        const n = igState.years.length;
        if (!n) return;
        igState.yearIndex = (igState.yearIndex + 1) % n;
        const anio = igState.years[igState.yearIndex];
        await loadIGMesesForYear(anio);
      });
    }
  }

  // =============================
  // SOCIOS NUEVOS POR MES (ABAJO IZQUIERDA)
  // =============================
  async function loadNuevos() {
    const tabela = $('tablaNuevos');
    showLoading(tabela, 'Cargando meses...');

    try {
      const clubId = getActiveClubId();
      const anio   = nuevosState.anio;
      const url    = `/club/${clubId}/reportes/socios-nuevos-mes/meses?anio=${anio}`;
      const { data } = await fetchAuth(url);
      if (!data.ok) {
        showError(tabela, data.error || 'Error cargando socios nuevos');
        return;
      }

      const rows = data.rows || [];
      // agregamos el año a cada fila
      nuevosState.rows = rows.map(r => ({
        ...r,
        anio
      }));

      const now = new Date();
      const mesAct = now.getMonth() + 1;
      let idx = nuevosState.rows.findIndex(r => r.mes_num === mesAct);
      if (idx < 0) idx = 0;
      nuevosState.mesIndex = idx;

      renderNuevos();
    } catch (e) {
      console.error(e);
      showError($('tablaNuevos'), e.message || 'Error inesperado cargando socios nuevos');
    }
  }

  function renderNuevos() {
    const rows = nuevosState.rows;
    const idx  = nuevosState.mesIndex;
    const sel  = rows[idx];

    $('nuevosCount').textContent = sel ? sel.cantidad : '–';

    const labelMes = sel ? `${sel.mes} ${sel.anio}` : '';
    $('nuevosMesLabel').textContent = labelMes;

    const tabela = $('tablaNuevos');
    if (!tabela) return;

    const html = `
      <div class="small-table">
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th style="text-align:right;">Nuevos</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r,i)=>`
              <tr data-index="${i}" class="row-nuevo" style="cursor:pointer;">
                <td>${r.mes}</td>
                <td style="text-align:right;">${r.cantidad}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    tabela.innerHTML = html;
  }

  async function loadNuevosDetalle(idx) {
  const row = nuevosState.rows[idx];
  const modal = $('nuevosModal');
  const body = $('nuevosModalBody');
  const sub  = $('nuevosModalSub');

  if (!row || !modal || !body || !sub) return;

  sub.textContent = `${row.mes} ${row.anio}`;
  showLoading(body, `Cargando socios nuevos de ${row.mes} ${row.anio}...`);
  modal.classList.remove('hidden');

  try {
    const clubId = getActiveClubId();
    const url = `/club/${clubId}/reportes/socios-nuevos-mes/detalle?anio=${row.anio}&mes=${row.mes_num}`;
    const { data } = await fetchAuth(url);

    if (!data.ok) {
      showError(body, data.error || 'Error cargando socios nuevos');
      return;
    }

    const socios = data.rows || [];
    if (!socios.length) {
      showError(body, 'No hay socios nuevos en ese mes.');
      return;
    }

    const html = `
      <table class="socios-table" style="font-size:13px;">
        <thead>
          <tr>
            <th>N°</th>
            <th>DNI</th>
            <th>Apellido</th>
            <th>Nombre</th>
            <th>Actividad</th>
            <th>Fecha ingreso</th>
          </tr>
        </thead>
        <tbody>
          ${socios.map(s => `
            <tr>
              <td>${s.numero_socio ?? ''}</td>
              <td>${s.dni ?? ''}</td>
              <td>${s.apellido ?? ''}</td>
              <td>${s.nombre ?? ''}</td>
              <td>${s.actividad ?? ''}</td>
              <td>${formatFecha(s.fecha_ingreso)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    body.innerHTML = html;
  } catch (e) {
    console.error(e);
    showError(body, e.message || 'Error inesperado cargando socios nuevos');
  }
}



 
// =============================
// RANKING INGRESO / GASTO (ABAJO CENTRO)
// =============================
async function loadRanking() {
  const body = $('rankingBody');
  if (!body) return;
  showLoading(body, 'Cargando ranking...');

  try {
    const clubId = getActiveClubId();
    const { anio, mes } = rankingState;
    $('rankMesLabel').textContent = MESES[mes - 1];

    const urlIng = `/club/${clubId}/reportes/ingresos-por-tipo/tipos?anio=${anio}&mes=${mes}`;
    const urlGas = `/club/${clubId}/reportes/gastos-por-tipo/tipos?anio=${anio}&mes=${mes}`;

    const [{ data: dIng }, { data: dGas }] = await Promise.all([
      fetchAuth(urlIng),
      fetchAuth(urlGas)
    ]);

    if (!dIng.ok || !dGas.ok) {
      showError(body, (dIng.error || dGas.error) || 'Error cargando ranking');
      return;
    }

    const ingresos = dIng.rows || [];
    const gastos = dGas.rows || [];

    const totalIng = ingresos.reduce((a, b) => a + Number(b.total || 0), 0) || 1;
    const totalGas = gastos.reduce((a, b) => a + Number(b.total || 0), 0) || 1;

    const topIng = [...ingresos]
      .sort((a, b) => Number(b.total) - Number(a.total))
      .slice(0, 3);

    const topGas = [...gastos]
      .sort((a, b) => Number(b.total) - Number(a.total))
      .slice(0, 3);

    const html = `
      <h4 class="ranking-title">Top ingresos</h4>
      <div class="small-table">
        <table>
          <tbody>
            ${topIng.map(r => `
              <tr class="row-ranking"
                  data-kind="ingreso-tipo"
                  data-tipo="${encodeURIComponent(r.tipo)}"
                  style="cursor:pointer;">
                <td>${r.tipo}</td>
                <td style="text-align:right;">${moneyARS.format(Number(r.total || 0))}</td>
                <td style="text-align:right;">${((Number(r.total || 0) * 100) / totalIng).toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <h4 class="ranking-title" style="margin-top:10px;">Top gastos</h4>
      <div class="small-table">
        <table>
          <tbody>
            ${topGas.map(r => `
              <tr class="row-ranking"
                  data-kind="gasto-tipo"
                  data-tipo_gasto="${encodeURIComponent(r.tipo_gasto || r.tipo)}"
                  style="cursor:pointer;">
                <td>${r.tipo_gasto || r.tipo}</td>
                <td style="text-align:right;">${moneyARS.format(Number(r.total || 0))}</td>
                <td style="text-align:right;">${((Number(r.total || 0) * 100) / totalGas).toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    body.innerHTML = html;
  } catch (e) {
    console.error(e);
    showError(body, e.message || 'Error inesperado cargando ranking');
  }
}


 
// =============================
// CUENTAS (INGRESOS / GASTOS) – ABAJO DERECHA
// =============================
async function loadCuentas() {
  const body = $('cuentasBody');
  if (!body) return;
  showLoading(body, 'Cargando datos...');

  try {
    const clubId = getActiveClubId();
    const { anio, mes } = cuentasState;
    $('cuentasMesLabel').textContent = MESES[mes - 1];

    const urlGas = `/club/${clubId}/reportes/gastos-responsable-mes/responsables?anio=${anio}&mes=${mes}`;
    const urlIng = `/club/${clubId}/reportes/ingresos-por-responsable?anio=${anio}&mes=${mes}`;

    const [{ data: dGas }, { data: dIng }] = await Promise.all([
      fetchAuth(urlGas),
      fetchAuth(urlIng)
    ]);

    if (!dGas.ok || !dIng.ok) {
      showError(body, (dGas.error || dIng.error) || 'Error cargando cuentas');
      return;
    }

    const gastos = dGas.rows || [];
    const ingresos = dIng.rows || [];

    const html = `
      <h4 class="ranking-title">Ingresos por responsable</h4>
      <div class="small-table">
        <table>
          <tbody>
            ${ingresos.map(r => `
              <tr class="row-cuentas"
                  data-kind="ingreso-cuenta"
                  data-cuenta="${encodeURIComponent(r.responsable)}"
                  style="cursor:pointer;">
                <td>${r.cuenta || r.responsable || r.tipo}</td>
                <td style="text-align:right;">${moneyARS.format(Number(r.total || 0))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <h4 class="ranking-title" style="margin-top:10px;">Gastos por responsable</h4>
      <div class="small-table">
        <table>
          <tbody>
            ${gastos.map(r => `
              <tr class="row-cuentas"
                  data-kind="gasto-responsable"
                  data-responsable="${encodeURIComponent(r.responsable)}"
                  style="cursor:pointer;">
                <td>${r.responsable}</td>
                <td style="text-align:right;">${moneyARS.format(Number(r.total || 0))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    body.innerHTML = html;
  } catch (e) {
    console.error(e);
    showError(body, e.message || 'Error inesperado cargando cuentas');
  }
}


// =============================
// INGRESOS VS GASTOS POR RESPONSABLE
// =============================
async function loadIGResp() {
  const body = $('igRespBody');
  if (!body) return;

  showLoading(body, 'Cargando datos...');

  try {
    const clubId = getActiveClubId();
    const { anio, mes } = igRespState;

    $('igRespMesLabel').textContent = `${MESES[mes - 1]} ${anio}`;

    const url =
      `/club/${clubId}/reportes/ingresos-vs-gastos-por-responsable?anio=${anio}&mes=${mes}`;

    const { data } = await fetchAuth(url);

    if (!data.ok) {
      showError(body, data.error || 'Error cargando reporte');
      return;
    }

    if (!data.rows || !data.rows.length) {
      body.innerHTML = `<div class="muted small">Sin datos para este mes.</div>`;
      return;
    }

    body.innerHTML = `
      <div class="small-table">
        <table>
          <thead>
            <tr>
              <th class="col-resp">Responsable</th>
              <th class="col-ing col-num">Ingresos</th>
              <th class="col-gas col-num">Gastos</th>
              <th class="col-res col-num">Resultado</th>
            </tr>
          </thead>
          <tbody>
            ${data.rows.map(r => {
              const ing = Number(r.ingresos || 0);
              const gas = Number(r.gastos || 0);
              const res = ing - gas;
              const color = res < 0 ? '#b91c1c' : '#111827';

              return `
                <tr class="row-igresp"
                    data-responsable="${encodeURIComponent(r.responsable)}">
                  <td class="col-resp">${r.responsable}</td>

                  <td class="col-ing col-num cell-igresp"
                      data-click="ingresos"
                      style="cursor:pointer; text-decoration:underline;">
                    ${moneyARS.format(ing)}
                  </td>

                  <td class="col-gas col-num cell-igresp"
                      data-click="gastos"
                      style="cursor:pointer; text-decoration:underline;">
                    ${moneyARS.format(gas)}
                  </td>

                  <td class="col-res col-num"
                      style="font-weight:600; color:${color};">
                    ${moneyARS.format(res)}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    console.error(e);
    showError(body, 'Error inesperado cargando reporte');
  }
}

// =============================
// DETALLE – LISTENERS DE CLICK (POPUP)
// =============================

// 1) Ranking por Gastos / Ingresos
function bindRankingDetalleClicks() {
  const body = $('rankingBody');
  if (!body || body.dataset.boundDetalle === '1') return;
  body.dataset.boundDetalle = '1';

  body.addEventListener('click', (ev) => {
    const tr = ev.target.closest('.row-ranking');
    if (!tr) return;

    const clubId = getActiveClubId();
    const { anio, mes } = rankingState;
    const mesLabel = `${MESES[mes - 1]} ${anio}`;

    // Ingresos por tipo
    if (tr.dataset.kind === 'ingreso-tipo') {
      const tipo = decodeURIComponent(tr.dataset.tipo || '');
      openDetalleModal({
        title: `Ingresos · ${tipo}`,
        sub: mesLabel,
        url: `/club/${clubId}/reportes/ingresos-por-tipo/detalle-mes?anio=${anio}&mes=${mes}&tipo=${encodeURIComponent(tipo)}`,
        columns: [
          { key: 'fecha', label: 'Fecha' },
          { key: 'descripcion', label: 'Descripción' },
          { key: 'cuenta', label: 'Cuenta' },
          { key: 'monto', label: 'Monto' }
        ],
        moneyKey: 'monto',
        dateKey: 'fecha'
      });
    }

    // Gastos por tipo
    if (tr.dataset.kind === 'gasto-tipo') {
      const tipoGasto = decodeURIComponent(tr.dataset.tipo_gasto || '');
      openDetalleModal({
        title: `Gastos · ${tipoGasto}`,
        sub: mesLabel,
        url: `/club/${clubId}/reportes/gastos-por-tipo/detalle-mes?anio=${anio}&mes=${mes}&tipo_gasto=${encodeURIComponent(tipoGasto)}`,
        columns: [
          { key: 'fecha_gasto', label: 'Fecha' },
          { key: 'descripcion', label: 'Descripción' },
          { key: 'responsable', label: 'Responsable' },
          { key: 'monto', label: 'Monto' }
        ],
        moneyKey: 'monto',
        dateKey: 'fecha_gasto'
      });
    }
  });
}

// 2) Ingresos / Gastos por Responsable
function bindCuentasDetalleClicks() {
  const body = $('cuentasBody');
  if (!body || body.dataset.boundDetalle === '1') return;
  body.dataset.boundDetalle = '1';

  body.addEventListener('click', (ev) => {
    const tr = ev.target.closest('.row-cuentas');
    if (!tr) return;

    const clubId = getActiveClubId();
    const { anio, mes } = cuentasState;
    const mesLabel = `${MESES[mes - 1]} ${anio}`;

    if (tr.dataset.kind === 'ingreso-cuenta') {
      const cuenta = decodeURIComponent(tr.dataset.cuenta || '');
      openDetalleModal({
        title: `Ingresos · ${cuenta}`,
        sub: mesLabel,
        url: `/club/${clubId}/reportes/ingresos-por-responsable/detalle?anio=${anio}&mes=${mes}&cuenta=${encodeURIComponent(cuenta)}`,
        columns: [
          { key: 'fecha', label: 'Fecha' },
          { key: 'descripcion', label: 'Descripción' },
          { key: 'origen', label: 'Origen' },
          { key: 'monto', label: 'Monto' }
        ],
        moneyKey: 'monto',
        dateKey: 'fecha'
      });
    }

    if (tr.dataset.kind === 'gasto-responsable') {
      const responsable = decodeURIComponent(tr.dataset.responsable || '');
      openDetalleModal({
        title: `Gastos · ${responsable}`,
        sub: mesLabel,
        url: `/club/${clubId}/reportes/gastos-responsable-mes/detalle?anio=${anio}&mes=${mes}&responsable=${encodeURIComponent(responsable)}`,
        columns: [
          { key: 'fecha_gasto', label: 'Fecha' },
          { key: 'descripcion', label: 'Descripción' },
          { key: 'tipo_gasto', label: 'Tipo' },
          { key: 'monto', label: 'Monto' }
        ],
        moneyKey: 'monto',
        dateKey: 'fecha_gasto'
      });
    }
  });
}

// 3) Ingresos vs Gastos por Responsable
function bindIGRespDetalleClicks() {
  const body = $('igRespBody');
  if (!body || body.dataset.boundDetalle === '1') return;
  body.dataset.boundDetalle = '1';

  body.addEventListener('click', (ev) => {
    const cell = ev.target.closest('.cell-igresp');
    if (!cell) return;

    const tr = ev.target.closest('.row-igresp');
    if (!tr) return;

    const clubId = getActiveClubId();
    const { anio, mes } = igRespState;
    const responsable = decodeURIComponent(tr.dataset.responsable || '');
    const tipo = cell.dataset.click; // ingresos | gastos
    const mesLabel = `${MESES[mes - 1]} ${anio}`;

    openDetalleModal({
      title: `${tipo === 'ingresos' ? 'Ingresos' : 'Gastos'} · ${responsable}`,
      sub: mesLabel,
      url: `/club/${clubId}/reportes/ingresos-vs-gastos-por-responsable/detalle?anio=${anio}&mes=${mes}&responsable=${encodeURIComponent(responsable)}&tipo=${tipo}`,
      columns: [
        { key: 'fecha', label: 'Fecha' },
        { key: 'descripcion', label: 'Descripción' },
        { key: 'monto', label: 'Monto' }
      ],
      moneyKey: 'monto',
      dateKey: 'fecha'
    });
  });
}

 // =============================
// INIT DASHBOARD
// =============================
async function initReportesSection() {
  // Panel 1 – actividades / categorías
  bindActividadesInteractions();
  await loadActividadesMain();

  // Panel 2 – impagos
  bindImpagosInteractions();
  await loadImpagosData(impagosState.anio);

  // Panel 3 – ingresos vs gastos
  bindIGInteractions();
  await loadIGAnual();

  // =============================
  // ABAJO IZQUIERDA – SOCIOS NUEVOS
  // =============================
  await loadNuevos();
  const tablaNuevos = $('tablaNuevos');
  if (tablaNuevos) {
    tablaNuevos.addEventListener('click', (e) => {
      const row = e.target.closest('.row-nuevo');
      if (!row) return;

      const idx = Number(row.dataset.index || '0');
      nuevosState.mesIndex = idx;

      renderNuevos();
      loadNuevosDetalle(idx); // abre el modal con el detalle
    });
  }

  const btnNPrev = $('btnNuevosMesPrev');
  const btnNNext = $('btnNuevosMesNext');

  if (btnNPrev) {
    btnNPrev.addEventListener('click', () => {
      if (!nuevosState.rows.length) return;
      nuevosState.mesIndex =
        (nuevosState.mesIndex - 1 + nuevosState.rows.length) % nuevosState.rows.length;
      renderNuevos();
    });
  }

  if (btnNNext) {
    btnNNext.addEventListener('click', () => {
      if (!nuevosState.rows.length) return;
      nuevosState.mesIndex =
        (nuevosState.mesIndex + 1) % nuevosState.rows.length;
      renderNuevos();
    });
  }

  // =============================
  // CIERRE MODAL SOCIOS NUEVOS
  // =============================
  const nuevosModal = $('nuevosModal');
  const btnNuevosClose = $('nuevosModalClose');

  if (nuevosModal && btnNuevosClose) {
    // Cerrar con la X
    btnNuevosClose.addEventListener('click', () => {
      nuevosModal.classList.add('hidden');
    });

    // Cerrar haciendo click en el fondo oscuro
    nuevosModal.addEventListener('click', (ev) => {
      if (ev.target === nuevosModal) {
        nuevosModal.classList.add('hidden');
      }
    });
  }

  // =============================
  // ABAJO CENTRO – RANKING
  // =============================
  const btnRankPrev = $('btnRankMesPrev');
  const btnRankNext = $('btnRankMesNext');

  if (btnRankPrev) {
    btnRankPrev.addEventListener('click', () => {
      rankingState.mes = rankingState.mes === 1 ? 12 : rankingState.mes - 1;
      loadRanking();
    });
  }

  if (btnRankNext) {
    btnRankNext.addEventListener('click', () => {
      rankingState.mes = rankingState.mes === 12 ? 1 : rankingState.mes + 1;
      loadRanking();
    });
  }

  // carga inicial ranking
  loadRanking();
  bindRankingDetalleClicks();


  // =============================
  // FILA 2 CENTRO – INGRESOS VS GASTOS POR RESPONSABLE
  // =============================
  const btnIGRespPrev = $('btnIGRespMesPrev');
  const btnIGRespNext = $('btnIGRespMesNext');

  if (btnIGRespPrev) {
    btnIGRespPrev.addEventListener('click', () => {
      igRespState.mes = igRespState.mes === 1 ? 12 : igRespState.mes - 1;
      loadIGResp();
    });
  }

  if (btnIGRespNext) {
    btnIGRespNext.addEventListener('click', () => {
      igRespState.mes = igRespState.mes === 12 ? 1 : igRespState.mes + 1;
      loadIGResp();
    });
  }

  // carga inicial IG por responsable
  loadIGResp();
  bindIGRespDetalleClicks();


  // =============================
  // ABAJO DERECHA – CUENTAS
  // =============================
  const btnCPrev = $('btnCuentasMesPrev');
  const btnCNext = $('btnCuentasMesNext');

  if (btnCPrev) {
    btnCPrev.addEventListener('click', () => {
      cuentasState.mes = cuentasState.mes === 1 ? 12 : cuentasState.mes - 1;
      loadCuentas();
    });
  }

  if (btnCNext) {
    btnCNext.addEventListener('click', () => {
      cuentasState.mes = cuentasState.mes === 12 ? 1 : cuentasState.mes + 1;
      loadCuentas();
    });
  }

  // carga inicial cuentas
  loadCuentas();
  bindCuentasDetalleClicks();
}

window.initReportesSection = initReportesSection;

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('reportes-section')) {
    initReportesSection();
  }
});
})();