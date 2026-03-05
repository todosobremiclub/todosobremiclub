// public/js/reportes.js
(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // Auth / helpers
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

  // =============================
  // Definición de reportes
  // (claves deben matchear data-reporte en reportes.html)
  // =============================
  const REPORTS = {
    'socios-actividad': {
      titulo: 'Cantidad de socios por Actividad',
      descripcion: 'Total de socios agrupados por actividad.',
    },
    'socios-actividad-categoria': {
      titulo: 'Socios por Actividad / Categoría',
      descripcion: 'Total de socios por actividad y categoría.',
    },
    'socios-nuevos-mes': {
      titulo: 'Socios nuevos por mes (fecha de ingreso)',
      descripcion: 'Cantidad de socios que ingresan por mes.',
    },
    'ingreso-fecha-pago': {
      titulo: 'Ingreso por fecha de pago',
      descripcion: 'Total de ingresos según la fecha del pago (registro).',
    },
    'ingreso-mes-pagado': {
      titulo: 'Ingreso por mes pagado',
      descripcion: 'Total de ingresos según el mes seleccionado al pagar.',
    },
    'ingresos-vs-gastos': {
      titulo: 'Ingresos vs Gastos por mes',
      descripcion: 'Comparativo mensual entre ingresos y gastos.',
    },
    'ingresos-por-tipo': {
      titulo: 'Ingresos por Tipo de ingreso',
      descripcion: 'Incluye pagos de cuotas y otros tipos de ingreso.',
    },
    'gastos-por-tipo': {
      titulo: 'Gastos por Tipo de gasto',
      descripcion: 'Total de gastos agrupados por tipo.',
    },
    'gastos-responsable-mes': {
      titulo: 'Gastos por Responsable por mes',
      descripcion: 'Total de gastos agrupados por responsable y mes.',
    },
  };

  // =============================
  // Modal de detalle (doble click)
  // =============================
  function ensureDetalleModal() {
    let modal = document.getElementById('reportesDetalleModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'reportesDetalleModal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 900px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <h3 id="repDetTitle" style="margin:0;">Detalle</h3>
          <button id="repDetClose" class="btn btn-secondary">✕</button>
        </div>
        <div class="muted" id="repDetSub" style="margin-top:6px;"></div>
        <div id="repDetBody" style="margin-top:10px; max-height:60vh; overflow:auto;"></div>
        <div class="modal-actions" style="margin-top:12px; text-align:right;">
          <button id="repDetOk" class="btn btn-primary">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.add('hidden');
    };

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });
    modal.querySelector('#repDetClose')?.addEventListener('click', close);
    modal.querySelector('#repDetOk')?.addEventListener('click', close);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !modal.classList.contains('hidden')) {
        close();
      }
    });

    return modal;
  }

  function openDetalleModal(reporteId, payload) {
    const meta = REPORTS[reporteId] ?? { titulo: 'Detalle', descripcion: '' };
    const modal = ensureDetalleModal();
    const titleEl = modal.querySelector('#repDetTitle');
    const subEl = modal.querySelector('#repDetSub');
    const bodyEl = modal.querySelector('#repDetBody');

    if (titleEl) titleEl.textContent = `Detalle - ${meta.titulo}`;
    if (subEl) {
      const info = [];
      if (payload?.label) info.push(payload.label);
      if (payload?.extra) info.push(payload.extra);
      subEl.textContent = info.join(' · ');
    }

    if (bodyEl) {
      // Por ahora mostramos JSON bonito; luego se puede reemplazar por tabla específica
      bodyEl.innerHTML = `
        <pre style="background:#f9fafb; padding:10px; border-radius:8px; font-size:12px; overflow:auto;">
${JSON.stringify(payload?.raw ?? payload ?? {}, null, 2)}
        </pre>
      `;
    }

    modal.classList.remove('hidden');
  }

  // =============================
  // Render de tablas genéricas
  // Espera un shape de API:
  // { ok:true, columns:[{key,label}], rows:[{...}] }
  // Si no vienen columns, se infieren de la primera row.
  // =============================
  function inferColumns(rows) {
    const first = rows && rows[0];
    if (!first) return [];
    return Object.keys(first).map(k => ({ key: k, label: k }));
  }

  function buildTableHTML(reporteId, data) {
  const rows = data.rows ?? [];
  const cols = (data.columns && data.columns.length)
    ? data.columns
    : inferColumns(rows);

  if (!cols.length) {
    return '<div class="muted">No hay datos para mostrar.</div>';
  }

  // Agregamos columna de flecha si hay hijos
  const hasChildren = rows.some(r => r._hasChildren);

  let thead = '<tr>';
  if (hasChildren) {
    thead += '<th></th>';  // columna flecha
  }
  cols.forEach(c => { thead += `<th>${c.label}</th>`; });
  thead += '</tr>';

  let tbody = '';

  rows.forEach((row, idx) => {
    const rowId = row.id ?? row.actividad ?? ('row-' + idx);
    const label = row.actividad ?? row.categoria ?? '';

    tbody += `
      <tr class="main-row"
          data-id="${rowId}" 
          data-reporte="${reporteId}" 
          data-label="${label}"
          data-actividad="${row.actividad ?? ''}"
          data-anio="${row.anio ?? ''}"
          data-has-children="${row._hasChildren ? '1' : '0'}">

        ${hasChildren ? (row._hasChildren ? `<td class="toggle">▶</td>` : `<td></td>`) : ''}
        ${cols.map(c => `<td>${row[c.key] ?? ''}</td>`).join('')}
      </tr>

      <!-- contenedor donde insertaremos el detalle -->
      <tr class="child-row hidden" id="child-${rowId}">
        <td colspan="${cols.length + 1}">
          <div class="child-container"></div>
        </td>
      </tr>
    `;
  });

  return `
    <div class="table-wrapper">
      <table class="socios-table">
        <thead>${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

  function showLoading(container, msg = 'Cargando...') {
    container.innerHTML = `<div class="muted">${msg}</div>`;
  }

  function showError(container, msg) {
    container.innerHTML = `<div class="muted" style="color:#b91c1c;">${msg}</div>`;
  }

  // =============================
  // Carga de reportes
  // =============================
  async function loadReporte(reporteId) {
    const content = $('reportesContent');
    if (!content) return;

    const meta = REPORTS[reporteId];
    if (!meta) {
      showError(content, 'Reporte no reconocido.');
      return;
    }

    showLoading(content, `Cargando "${meta.titulo}"...`);

    try {
      const clubId = getActiveClubId();
      // Endpoint sugerido: /club/:clubId/reportes/:reporteId
      const url = `/club/${clubId}/reportes/${reporteId}`;
      const { res, data } = await fetchAuth(url);

      if (!res.ok || !data.ok) {
        showError(content, data.error || 'Error al cargar el reporte.');
        return;
      }

      // Esperamos algo como:
      // { ok:true, title, description, columns, rows }
      const title = data.title ?? meta.titulo;
      const desc  = data.description ?? meta.descripcion ?? '';

      let html = `<h3 style="margin-top:0;">${title}</h3>`;
      if (desc) {
        html += `<div class="muted" style="margin-bottom:8px;">${desc}</div>`;
      }

      html += buildTableHTML(reporteId, data);
      content.innerHTML = html;

    } catch (e) {
      console.error(e);
      showError(content, e.message ?? 'Error inesperado al cargar el reporte.');
    }
  }

 // =============================
  // Chips / navegación de reportes
  // =============================
  function bindChips() {
    const section = document.getElementById('reportes-section');
    if (!section) return;
    if (section.dataset.bound === '1') return;
    section.dataset.bound = '1';

    const chips = section.querySelectorAll('.chip[data-reporte]');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.reporte;
        if (!id) return;

        // Activar visualmente
        chips.forEach(c => c.classList.toggle('active', c === chip));

        // Cargar reporte
        loadReporte(id);
      });
    });

    // Doble click sobre filas de datos -> detalle
    const content = $('reportesContent');
    if (content) {
      content.addEventListener('dblclick', (ev) => {
        const tr = ev.target.closest('tr[data-id][data-reporte]');
        if (!tr) return;

        const reporteId = tr.dataset.reporte;
        const id = tr.dataset.id;
        const label = tr.dataset.label || '';
        const extra = tr.dataset.extra || '';

        // Podés enriquecer payload con más info si el backend la trae
        const payload = { id, label, extra };

        openDetalleModal(reporteId, payload);
      });

      // 👇👉 PEGÁ ESTE BLOQUE NUEVO ACÁ, DENTRO DEL if (content) { ... }

      content.addEventListener('click', async (ev) => {
        const toggle = ev.target.closest('.toggle');
        if (!toggle) return;

        const tr = toggle.closest('tr.main-row');
        if (!tr) return;

        const hasChildren = tr.dataset.hasChildren === '1';
        if (!hasChildren) return;

        const rowId = tr.dataset.id;
        const reporteId = tr.dataset.reporte;
        const actividad = tr.dataset.actividad;
        const anio = tr.dataset.anio;
        const childRow = document.getElementById(`child-${rowId}`);
        const childContainer = childRow.querySelector('.child-container');

        // Toggle UI
        const isOpen = !childRow.classList.contains('hidden');
        if (isOpen) {
          childRow.classList.add('hidden');
          toggle.textContent = '▶';
          return;
        }

        // Abrir
        toggle.textContent = '▼';
        childRow.classList.remove('hidden');
        childContainer.innerHTML = '<div class="muted">Cargando...</div>';

        const clubId = getActiveClubId();
        let url = '';
        
        if (reporteId === 'socios-actividad-categoria') {
          url = `/club/${clubId}/reportes/socios-actividad-categoria/detalle?actividad=${encodeURIComponent(actividad)}`;
        } else if (reporteId === 'socios-nuevos-mes') {
          url = `/club/${clubId}/reportes/socios-nuevos-mes/meses?anio=${encodeURIComponent(anio)}`;
        } else {
          // Por ahora solo manejamos estos dos reportes
          childContainer.innerHTML = '<div class="muted">Detalle no disponible para este reporte.</div>';
          return;
        }

        const { res, data } = await fetchAuth(url);
        if (!data.ok) {
          childContainer.innerHTML = '<div class="muted" style="color:#b91c1c">Error al cargar detalle</div>';
          return;
        }

        if (!data.rows.length) {
          childContainer.innerHTML = '<div class="muted">Sin datos</div>';
          return;
        }

        let html = '';

        if (reporteId === 'socios-actividad-categoria') {
          html = `
            <table class="socios-table" style="background:#fafafa;">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                ${data.rows.map(r => `
                  <tr>
                    <td>${r.categoria}</td>
                    <td>${r.cantidad}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
        } else if (reporteId === 'socios-nuevos-mes') {
          html = `
            <table class="socios-table" style="background:#fafafa;">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                ${data.rows.map(r => `
                  <tr>
                    <td>${r.mes}</td>
                    <td>${r.cantidad}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
        }

        childContainer.innerHTML = html;
      });
    } // ← cierra if (content)

  } // ← cierra function bindChips()

async function initReportesSection() {
    // Enlazar botones/chips una sola vez
    bindChips();

    // Cargar el primer reporte activo por defecto
    const activeChip =
      document.querySelector('#reportes-section .chip.active') ||
      document.querySelector('#reportes-section .chip[data-reporte]');

    if (activeChip) {
      const id = activeChip.dataset.reporte;
      if (id) {
        await loadReporte(id);
      }
    }
  }

async function cargarDetalleDesdeFila(tr) {
  const clubId = getActiveClubId();
  const reporteId = tr.dataset.reporte;

  let url = `/club/${clubId}/reportes/${reporteId}/detalle`;
  const params = new URLSearchParams();

  switch (reporteId) {
    case 'socios-actividad':
      params.set('actividad', tr.dataset.actividad);
      break;
    // ... resto de casos según reporte
  }

  if ([...params].length) {
    url += `?${params.toString()}`;
  }

  const { res, data } = await fetchAuth(url);
  // luego mostrás data.rows en el modal
}

  // Exponer para club.js
  window.initReportesSection = initReportesSection;

  // Por si abren reportes.html directo
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('reportes-section')) {
      initReportesSection();
    }
  });

})();