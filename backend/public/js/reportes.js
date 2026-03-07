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
  // Definición de reportes
  // (claves matchean data-reporte en reportes.html)
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
      titulo: 'Cuota por fecha de pago',
      descripcion: 'Total de cuotas cobradas según la fecha del pago.',
    },
    'ingreso-mes-pagado': {
      titulo: 'Cuota por mes pagado',
      descripcion: 'Total de cuotas cobradas según el mes que corresponde al pago.',
    },
    'ingresos-vs-gastos': {
      titulo: 'Ingresos vs Gastos',
      descripcion: 'Comparativo entre ingresos y gastos.',
    },
    'ingresos-por-tipo': {
      titulo: 'Ingresos Totales',
      descripcion: 'Total de ingresos anuales, con detalle por mes y tipo.',
    },
    'gastos-por-tipo': {
      titulo: 'Gastos',
      descripcion: 'Total de gastos, con detalle por mes y tipo de gasto.',
    },
    'gastos-responsable-mes': {
      titulo: 'Gastos por cuenta',
      descripcion: 'Total de gastos agrupados por cuenta/responsable y mes.',
    },
  };

  // =============================
  // Modal de detalle
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

  function openDetalleModal(reporteId, payload = {}) {
    const meta = REPORTS[reporteId] ?? { titulo: 'Detalle', descripcion: '' };
    const modal = ensureDetalleModal();
    const titleEl = modal.querySelector('#repDetTitle');
    const subEl   = modal.querySelector('#repDetSub');
    const bodyEl  = modal.querySelector('#repDetBody');

    if (titleEl) {
      titleEl.textContent = `Detalle - ${meta.titulo}`;
    }

    if (subEl) {
      const info = [];
      if (payload.label) info.push(payload.label);
      if (payload.extra) info.push(payload.extra);
      subEl.textContent = info.join(' · ');
    }

    if (bodyEl) {
      if (payload.html) {
        bodyEl.innerHTML = payload.html;
      } else {
        bodyEl.innerHTML = `
          <pre style="background:#f9fafb; padding:10px; border-radius:8px; font-size:12px; overflow:auto;">
${JSON.stringify(payload.raw ?? payload ?? {}, null, 2)}
          </pre>
        `;
      }
    }

    modal.classList.remove('hidden');
  }

  // =============================
  // Render de tablas genéricas
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

    const hasChildren = rows.some(r => r._hasChildren);

    let thead = '<tr>';
    if (hasChildren) {
      thead += '<th></th>'; // columna flecha
    }
    cols.forEach(c => { thead += `<th>${c.label}</th>`; });
    thead += '</tr>';

    let tbody = '';

    rows.forEach((row, idx) => {
      const rowId = row.id ?? row.actividad ?? ('row-' + idx);
      const label = row.actividad ?? row.categoria ?? row.mes ?? row.anio ?? '';

      tbody += `
        <tr class="main-row"
            data-id="${rowId}"
            data-reporte="${reporteId}"
            data-label="${label}"
            data-actividad="${row.actividad ?? ''}"
            data-anio="${row.anio ?? ''}"
            data-has-children="${row._hasChildren ? '1' : '0'}">
          ${hasChildren
            ? (row._hasChildren ? `<td class="toggle">▶</td>` : `<td></td>`)
            : ''}
          ${cols.map(c => `<td>${row[c.key] ?? ''}</td>`).join('')}
        </tr>
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
      const url = `/club/${clubId}/reportes/${reporteId}`;
      const { res, data } = await fetchAuth(url);

      if (!res.ok || !data.ok) {
        showError(content, data.error || 'Error al cargar el reporte.');
        return;
      }

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

        chips.forEach(c => c.classList.toggle('active', c === chip));
        loadReporte(id);
      });
    });

    const content = $('reportesContent');
    if (!content) return;

    // =============================
    // Doble click – Detalle
    // =============================
    
content.addEventListener('dblclick', async (ev) => {
  const tr = ev.target.closest('tr[data-reporte]');
  if (!tr) return;

  const reporteId = tr.dataset.reporte;
  const label = tr.dataset.label || '';
  const clubId = getActiveClubId();

  // 🚫 Ignorar doble click sobre el nivel "AÑO" de Socios nuevos
  if (reporteId === 'socios-nuevos-mes') {
    return;
  }


      try {
        // === Detalle REAL para Socios por Actividad / Categoría ===
        if (reporteId === 'socios-actividad-categoria') {
          const actividad = tr.dataset.actividad || label;

          const params = new URLSearchParams({
            actividad,
            activo: '1',
          });

          const url = `/club/${clubId}/reportes/socios-actividad/detalle?${params.toString()}`;
          const { data } = await fetchAuth(url);

          if (!data.ok) {
            alert(data.error || 'Error al cargar el detalle de socios.');
            return;
          }

          const rows = data.rows || [];

          let html;
          if (!rows.length) {
            html = '<div class="muted">No hay socios para esta actividad.</div>';
          } else {
            html = `
              <table class="socios-table" style="background:#fafafa;">
                <thead>
                  <tr>
                    <th>N° Socio</th>
                    <th>DNI</th>
                    <th>Nombre</th>
                    <th>Apellido</th>
                    <th>Actividad</th>
                    <th>Categoría</th>
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
                      <td>${s.actividad ?? ''}</td>
                      <td>${s.categoria ?? ''}</td>
                      <td>${s.telefono ?? ''}</td>
                      <td>${s.fecha_ingreso ? String(s.fecha_ingreso).substring(0,10) : ''}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
          }

          openDetalleModal('socios-actividad-categoria', {
            label: actividad,
            raw: rows,
            html,
          });
          return;
        }

        // === Detalle REAL para Socios nuevos por mes (por MES) ===
        if (reporteId === 'socios-nuevos-mes-mes') {
          const anio = Number(tr.dataset.anio);
          const mes  = Number(tr.dataset.mes);
          const mesLabel = label || tr.children[0]?.textContent || '';

          if (!anio || !mes) {
            alert('No se pudo determinar año o mes para el detalle.');
            return;
          }

          const params = new URLSearchParams({
            anio: String(anio),
            mes: String(mes),
          });

          const url = `/club/${clubId}/reportes/socios-nuevos-mes/detalle?${params.toString()}`;
          const { data } = await fetchAuth(url);

          if (!data.ok) {
            alert(data.error || 'Error al cargar el detalle de socios nuevos.');
            return;
          }

          const rows = data.rows || [];

          let html;
          if (!rows.length) {
            html = '<div class="muted">No hay socios nuevos para este mes.</div>';
          } else {
            html = `
              <table class="socios-table" style="background:#fafafa;">
                <thead>
                  <tr>
                    <th>N° Socio</th>
                    <th>DNI</th>
                    <th>Nombre</th>
                    <th>Apellido</th>
                    <th>Actividad</th>
                    <th>Categoría</th>
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
                      <td>${s.actividad ?? ''}</td>
                      <td>${s.categoria ?? ''}</td>
                      <td>${s.telefono ?? ''}</td>
                      <td>${s.fecha_ingreso ? String(s.fecha_ingreso).substring(0,10) : ''}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
          }

          openDetalleModal('socios-nuevos-mes', {
            label: `Año ${anio} · ${mesLabel}`,
            raw: rows,
            html,
          });
          return;
        }

        // === Fallback genérico para otros reportes (por ahora) ===
        const id    = tr.dataset.id;
        const extra = tr.dataset.extra || '';
        openDetalleModal(reporteId, { id, label, extra });

      } catch (e) {
        console.error(e);
        alert('Error cargando detalle del reporte.');
      }
    });

    // =============================
    // Click en flecha ▶ para desplegar subtabla
    // =============================
    content.addEventListener('click', async (ev) => {
      const toggle = ev.target.closest('.toggle');
      if (!toggle) return;

      const tr = toggle.closest('tr.main-row');
      if (!tr) return;

      const hasChildren = tr.dataset.hasChildren === '1';
      if (!hasChildren) return;

      const rowId     = tr.dataset.id;
      const reporteId = tr.dataset.reporte;
      const actividad = tr.dataset.actividad;
      const anio      = tr.dataset.anio;
      const childRow  = document.getElementById(`child-${rowId}`);
      const childContainer = childRow.querySelector('.child-container');

      const isOpen = !childRow.classList.contains('hidden');
      if (isOpen) {
        childRow.classList.add('hidden');
        toggle.textContent = '▶';
        return;
      }

      toggle.textContent = '▼';
      childRow.classList.remove('hidden');
      childContainer.innerHTML = '<div class="muted">Cargando...</div>';

      const clubId = getActiveClubId();
      let url = '';

      // Elegimos endpoint según el reporte
      if (reporteId === 'socios-actividad-categoria') {
        url = `/club/${clubId}/reportes/socios-actividad-categoria/detalle?actividad=${encodeURIComponent(actividad)}`;
      } else if (reporteId === 'socios-nuevos-mes') {
        url = `/club/${clubId}/reportes/socios-nuevos-mes/meses?anio=${encodeURIComponent(anio)}`;
      } else if (reporteId === 'ingreso-fecha-pago') {
        url = `/club/${clubId}/reportes/ingreso-fecha-pago/meses?anio=${encodeURIComponent(anio)}`;
      } else if (reporteId === 'ingreso-mes-pagado') {
        url = `/club/${clubId}/reportes/ingreso-mes-pagado/meses?anio=${encodeURIComponent(anio)}`;
      } else if (reporteId === 'ingresos-vs-gastos') {
        url = `/club/${clubId}/reportes/ingresos-vs-gastos/meses?anio=${encodeURIComponent(anio)}`;
      } else if (reporteId === 'ingresos-por-tipo') {
        url = `/club/${clubId}/reportes/ingresos-por-tipo/meses?anio=${encodeURIComponent(anio)}`;
      } else if (reporteId === 'gastos-por-tipo') {
        url = `/club/${clubId}/reportes/gastos-por-tipo/meses?anio=${encodeURIComponent(anio)}`;
      } else if (reporteId === 'gastos-responsable-mes') {
        url = `/club/${clubId}/reportes/gastos-responsable-mes/meses?anio=${encodeURIComponent(anio)}`;
      } else {
        childContainer.innerHTML = '<div class="muted">Detalle no disponible para este reporte.</div>';
        return;
      }

      const { data } = await fetchAuth(url);
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
                <tr
                  data-reporte="socios-nuevos-mes-mes"
                  data-anio="${anio}"
                  data-mes="${r.mes_num}"
                  data-label="${r.mes}"
                >
                  <td>${r.mes}</td>
                  <td>${r.cantidad}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      
      } else if (reporteId === 'ingreso-fecha-pago' || reporteId === 'ingreso-mes-pagado') {
        html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Total (ARS)</th>
              </tr>
            </thead>
            <tbody>
              ${data.rows.map(r => `
                <tr>
                  <td>${r.mes}</td>
                  <td>${r.total}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else if (reporteId === 'ingresos-vs-gastos') {
        html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Ingresos (ARS)</th>
                <th>Gastos (ARS)</th>
              </tr>
            </thead>
            <tbody>
              ${data.rows.map(r => `
                <tr>
                  <td>${r.mes}</td>
                  <td>${r.ingresos}</td>
                  <td>${r.gastos}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else if (reporteId === 'ingresos-por-tipo') {
        html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Total (ARS)</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${data.rows.map(r => `
                <tr>
                  <td>${r.mes}</td>
                  <td>${r.total}</td>
                  <td>
                    <button
                      class="btn btn-secondary btn-sm"
                      data-act="ver-tipos-ingreso"
                      data-anio="${anio}"
                      data-mes="${r.mes_num}">
                      Ver por tipo
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else if (reporteId === 'gastos-por-tipo') {
        html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Total (ARS)</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${data.rows.map(r => `
                <tr>
                  <td>${r.mes}</td>
                  <td>${r.total}</td>
                  <td>
                    <button
                      class="btn btn-secondary btn-sm"
                      data-act="ver-tipos-gasto"
                      data-anio="${anio}"
                      data-mes="${r.mes_num}">
                      Ver por tipo
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } else if (reporteId === 'gastos-responsable-mes') {
        html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Total (ARS)</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${data.rows.map(r => `
                <tr>
                  <td>${r.mes}</td>
                  <td>${r.total}</td>
                  <td>
                    <button
                      class="btn btn-secondary btn-sm"
                      data-act="ver-responsables-gasto"
                      data-anio="${anio}"
                      data-mes="${r.mes_num}">
                      Ver responsables
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }

      childContainer.innerHTML = html;
    });

    // Click en "Ver por tipo" - Ingresos por tipo
    content.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act="ver-tipos-ingreso"]');
      if (!btn) return;

      const clubId = getActiveClubId();
      const anio = btn.dataset.anio;
      const mes  = btn.dataset.mes;

      try {
        const url = `/club/${clubId}/reportes/ingresos-por-tipo/tipos?anio=${anio}&mes=${mes}`;
        const { data } = await fetchAuth(url);

        if (!data.ok) {
          alert(data.error || 'Error cargando detalle por tipo');
          return;
        }

        const rows = data.rows;

        const html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Tipo de ingreso</th>
                <th>Total (ARS)</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${r.tipo}</td>
                  <td>${r.total}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;

        openDetalleModal('ingresos-por-tipo', {
          label: `Año ${anio} · Mes ${mes}`,
          raw: {},
          html,
        });
      } catch (e) {
        console.error(e);
        alert('Error cargando detalle');
      }
    });

    // Click en "Ver por tipo" - Gastos por tipo
    content.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act="ver-tipos-gasto"]');
      if (!btn) return;

      const clubId = getActiveClubId();
      const anio = btn.dataset.anio;
      const mes  = btn.dataset.mes;

      try {
        const url = `/club/${clubId}/reportes/gastos-por-tipo/tipos?anio=${anio}&mes=${mes}`;
        const { data } = await fetchAuth(url);

        if (!data.ok) {
          alert(data.error || 'Error cargando detalle por tipo de gasto');
          return;
        }

        const rows = data.rows;

        const html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Tipo de gasto</th>
                <th>Total (ARS)</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${r.tipo_gasto}</td>
                  <td>${r.total}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;

        openDetalleModal('gastos-por-tipo', {
          label: `Año ${anio} · Mes ${mes}`,
          raw: {},
          html,
        });
      } catch (e) {
        console.error(e);
        alert('Error cargando detalle');
      }
    });

    // Click en "Ver responsables" - Gastos por cuenta
    content.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act="ver-responsables-gasto"]');
      if (!btn) return;

      const clubId = getActiveClubId();
      const anio = btn.dataset.anio;
      const mes  = btn.dataset.mes;

      try {
        const url = `/club/${clubId}/reportes/gastos-responsable-mes/responsables?anio=${anio}&mes=${mes}`;
        const { data } = await fetchAuth(url);

        if (!data.ok) {
          alert(data.error || 'Error cargando detalle por responsable');
          return;
        }

        const rows = data.rows;

        const html = `
          <table class="socios-table" style="background:#fafafa;">
            <thead>
              <tr>
                <th>Responsable</th>
                <th>Total (ARS)</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${r.responsable}</td>
                  <td>${r.total}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;

        openDetalleModal('gastos-responsable-mes', {
          label: `Año ${anio} · Mes ${mes}`,
          raw: {},
          html,
        });
      } catch (e) {
        console.error(e);
        alert('Error cargando detalle por responsable');
      }
    });
  }

  // =============================
  // Init
  // =============================
  async function initReportesSection() {
    bindChips();

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

  // Stub por compatibilidad
  async function cargarDetalleDesdeFila(tr) {
    const clubId = getActiveClubId();
    const reporteId = tr.dataset.reporte;
    let url = `/club/${clubId}/reportes/${reporteId}/detalle`;
    const params = new URLSearchParams();

    switch (reporteId) {
      case 'socios-actividad':
        params.set('actividad', tr.dataset.actividad);
        break;
      default:
        break;
    }

    if ([...params].length) {
      url += `?${params.toString()}`;
    }

    await fetchAuth(url);
  }

  window.initReportesSection = initReportesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('reportes-section')) {
      initReportesSection();
    }
  });
})();