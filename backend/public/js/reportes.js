// public/js/reportes.js
(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // ESTADO GLOBAL
  // =============================
  let chartActividades = null;
  let chartIGMes = null;

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
    rows: [],                      // [{ anio, mes, cantidad, mes_num }]
    currentIndex: 0
  };

  const igState = {
    anualRows: [],                 // [{ anio, ingresos, gastos }]
    years: [],
    yearIndex: 0,
    mesesRows: [],                 // [{ mes, ingresos, gastos }]
    mesIndex: 0
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
  // PANEL 1 – ACTIVIDADES / CATEGORÍAS
  // =============================
  async function loadActividadesMain() {
    const cardTable = $('tablaActividades');
    const subtitle = $('actividadesSubtitle');
    const resetBtn  = $('btnActividadesReset');
    if (!cardTable) return;

    actividadesState.modo = 'actividades';
    actividadesState.actividadSeleccionada = null;
    actividadesState.categoriasByActividad = {};
    if (resetBtn) resetBtn.classList.add('hidden');
    if (subtitle) {
      subtitle.textContent = 'Distribución de socios activos por actividad.';
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
    const cardTable = $('tablaActividades');
    const subtitle = $('actividadesSubtitle');
    const resetBtn  = $('btnActividadesReset');
    const detailBody = $('detailActividadesBody');
    const canvas = $('chartActividades');
    if (!cardTable || !canvas) return;

    destroyChartActividades();

    const ctx = canvas.getContext('2d');
    let labels = [];
    let dataVals = [];
    let htmlTable = '';
    const modo = actividadesState.modo;

    if (modo === 'actividades') {
      const rows = actividadesState.actividadesRows || [];
      labels = rows.map(r => r.actividad || 'Sin actividad');
      dataVals = rows.map(r => Number(r.cantidad || 0));

      htmlTable = `
        <table class="socios-table" style="font-size:13px;">
          <thead>
            <tr>
              <th>Actividad</th>
              <th style="text-align:right;">Socios</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr class="row-actividad" data-actividad="${r.actividad}">
                <td>${r.actividad}</td>
                <td style="text-align:right;">${r.cantidad}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      if (subtitle) {
        subtitle.textContent = 'Distribución de socios activos por actividad. Hacé clic en una actividad para ver sus categorías.';
      }
      if (resetBtn) resetBtn.classList.add('hidden');
      if (detailBody) {
        detailBody.innerHTML = `<div class="muted small">Hacé clic en una actividad arriba para ver el detalle por categoría y luego los socios.</div>`;
      }

    } else { // modo === 'categorias'
      const actividad = actividadesState.actividadSeleccionada || '';
      const catRows = actividadesState.categoriasByActividad[actividad] || [];

      labels = catRows.map(r => r.categoria || 'Sin categoría');
      dataVals = catRows.map(r => Number(r.cantidad || 0));

      htmlTable = `
        <table class="socios-table" style="font-size:13px;">
          <thead>
            <tr>
              <th>Categoría</th>
              <th style="text-align:right;">Socios</th>
            </tr>
          </thead>
          <tbody>
            ${catRows.map(r => `
              <tr class="row-categoria"
                  data-actividad="${actividad}"
                  data-categoria="${r.categoria}">
                <td>${r.categoria}</td>
                <td style="text-align:right;">${r.cantidad}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      if (subtitle) {
        subtitle.textContent = `Categorías dentro de la actividad "${actividad}". Hacé clic en una categoría para ver los socios.`;
      }
      if (resetBtn) resetBtn.classList.remove('hidden');
      if (detailBody) {
        detailBody.innerHTML = `<div class="muted small">Hacé clic en una categoría arriba para ver el listado de socios.</div>`;
      }
    }

    // Render tabla
    cardTable.innerHTML = htmlTable;

    // Render Chart.js
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
        plugins: {
          legend: { position: 'right' }
        },
        maintainAspectRatio: false
      }
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
    const tableContainer = $('tablaActividades');
    const resetBtn = $('btnActividadesReset');

    if (tableContainer) {
      tableContainer.addEventListener('click', (ev) => {
        const rowAct = ev.target.closest('.row-actividad');
        if (rowAct) {
          const actividad = rowAct.dataset.actividad;
          loadCategoriasForActividad(actividad);
          return;
        }
        const rowCat = ev.target.closest('.row-categoria');
        if (rowCat) {
          const actividad = rowCat.dataset.actividad;
          const categoria = rowCat.dataset.categoria;
          loadSociosForActividadCategoria(actividad, categoria);
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
    const kpi = $('impagosCount');
    const mesLabel = $('impagosMesLabel');
    const yearLabel = $('impagosYearLabel');
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

      // elegir por defecto el mes actual si existe
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      let idx = 0;
      const found = rows.findIndex(r => Number(r.mes_num) === currentMonth);
      if (found >= 0) idx = found;
      impagosState.currentIndex = idx;

      renderImpagosPanel();
      if (detailBody) {
        detailBody.innerHTML = '<div class="muted small">Hacé clic en la cantidad de impagos para ver el listado de socios.</div>';
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

    // Tabla resumen de todos los meses
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

  async function loadImpagosDetalleForCurrent() {
    const rows = impagosState.rows || [];
    const idx = impagosState.currentIndex;
    const detailBody = $('detailImpagosBody');
    if (!detailBody) return;
    if (!rows.length) {
      detailBody.innerHTML = '<div class="muted small">No hay datos para este mes.</div>';
      return;
    }
    const sel = rows[idx];

    showLoading(detailBody, `Cargando socios impagos de ${sel.mes} ${sel.anio}...`);

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({
        anio: String(sel.anio),
        mes: String(sel.mes_num),
        limit: '200',
        offset: '0'
      });
      const url = `/club/${clubId}/reportes/impagos-mes/detalle?${params.toString()}`;
      const { data } = await fetchAuth(url);
      if (!data.ok) {
        showError(detailBody, data.error || 'Error cargando detalle de impagos');
        return;
      }
      const items = data.items || [];
      if (!items.length) {
        detailBody.innerHTML = '<div class="muted small">No hay socios impagos para ese mes.</div>';
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
      detailBody.innerHTML = html;
    } catch (e) {
      console.error(e);
      showError(detailBody, e.message || 'Error inesperado cargando detalle de impagos');
    }
  }

  function bindImpagosInteractions() {
    const kpi = $('impagosCount');
    const btnPrev = $('btnImpagosPrev');
    const btnNext = $('btnImpagosNext');
    const tabela = $('tablaImpagos');

    if (kpi) {
      kpi.style.cursor = 'pointer';
      kpi.addEventListener('click', () => {
        loadImpagosDetalleForCurrent();
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (impagosState.rows.length === 0) return;
        impagosState.currentIndex = (impagosState.currentIndex - 1 + impagosState.rows.length) % impagosState.rows.length;
        renderImpagosPanel();
      });
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (impagosState.rows.length === 0) return;
        impagosState.currentIndex = (impagosState.currentIndex + 1) % impagosState.rows.length;
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
    const card = $('card-ingresos');
    const chartContainer = $('chartIGMes');
    const detailBody = $('detailIngresosBody');

    if (detailBody) {
      detailBody.innerHTML = '<div class="muted small">Seleccioná un mes para ver el detalle de ingresos y gastos.</div>';
    }

    try {
      const clubId = getActiveClubId();
      const { data } = await fetchAuth(`/club/${clubId}/reportes/ingresos-vs-gastos`);
      if (!data.ok) {
        if (card) showError(card, data.error || 'Error cargando ingresos vs gastos');
        return;
      }
      const rows = data.rows || [];
      igState.anualRows = rows;
      igState.years = rows.map(r => r.anio);

      // Elegimos el último año
      if (igState.years.length === 0) return;
      igState.yearIndex = igState.years.length - 1;

      const currentYear = igState.years[igState.yearIndex];
      await loadIGMesesForYear(currentYear);
    } catch (e) {
      console.error(e);
      if (card) showError(card, e.message || 'Error inesperado cargando ingresos vs gastos');
    }
  }

  async function loadIGMesesForYear(anio) {
    const card = $('card-ingresos');
    const canvas = $('chartIGMes');
    if (!canvas) return;

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({ anio: String(anio) });
      const { data } = await fetchAuth(`/club/${clubId}/reportes/ingresos-vs-gastos/meses?${params.toString()}`);
      if (!data.ok) {
        if (card) showError(card, data.error || 'Error cargando detalle mensual');
        return;
      }

      igState.mesesRows = data.rows || [];

      // seleccionar mes actual si existe
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
      if (card) showError(card, e.message || 'Error inesperado cargando detalle mensual');
    }
  }

  function renderIGPanel() {
    const canvas = $('chartIGMes');
    const anioLabel = $('igAnioLabel');
    const mesLabel = $('igMesLabel');
    const anualIng = $('igAnualIngresos');
    const anualGas = $('igAnualGastos');
    const anualRes = $('igAnualResultado');
    const detailBody = $('detailIngresosBody');

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
      return;
    }

    const idx = Math.max(0, Math.min(igState.mesIndex, meses.length - 1));
    igState.mesIndex = idx;
    const rowSel = meses[idx];
    mesLabel.textContent = rowSel.mes;

    const labels = meses.map(r => r.mes);
    const ingVals = meses.map(r => Number(r.ingresos || 0));
    const gasVals = meses.map(r => Number(r.gastos || 0));

    chartIGMes = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ingresos',
            data: ingVals,
            backgroundColor: '#22c55e'
          },
          {
            label: 'Gastos',
            data: gasVals,
            backgroundColor: '#ef4444'
          }
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
          const idxClicked = elements[0].index;
          igState.mesIndex = idxClicked;
          renderIGPanel();
          loadIGDetalleMes(anioActual, idxClicked + 1);
        }
      }
    });

    // Actualizar detalle según mes seleccionado
    loadIGDetalleMes(anioActual, igState.mesIndex + 1);
  }

  async function loadIGDetalleMes(anio, mesNum) {
    const detailBody = $('detailIngresosBody');
    if (!detailBody) return;
    showLoading(detailBody, `Cargando detalle de ${MESES[mesNum - 1]} ${anio}...`);

    try {
      const clubId = getActiveClubId();
      const params = new URLSearchParams({
        anio: String(anio),
        mes: String(mesNum),
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
    const btnAnioPrev = $('btnIGAnioPrev');
    const btnAnioNext = $('btnIGAnioNext');

    if (btnMesPrev) {
      btnMesPrev.addEventListener('click', () => {
        const n = igState.mesesRows.length;
        if (!n) return;
        igState.mesIndex = (igState.mesIndex - 1 + n) % n;
        renderIGPanel();
      });
    }
    if (btnMesNext) {
      btnMesNext.addEventListener('click', () => {
        const n = igState.mesesRows.length;
        if (!n) return;
        igState.mesIndex = (igState.mesIndex + 1) % n;
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
  // INIT DASHBOARD
  // =============================
  async function initReportesSection() {
    // Panel 1 – actividades/categorías
    bindActividadesInteractions();
    await loadActividadesMain();

    // Panel 2 – impagos por mes
    bindImpagosInteractions();
    await loadImpagosData(impagosState.anio);

    // Panel 3 – ingresos vs gastos
    bindIGInteractions();
    await loadIGAnual();
  }

  window.initReportesSection = initReportesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('reportes-section')) {
      initReportesSection();
    }
  });
})();