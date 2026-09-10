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
      alert('No hay club activo seleccionado. Volvé al panel del club.');
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

  // =============================
  // Debounce (para búsqueda en vivo)
  // =============================
  function debounce(fn, wait = 250) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  async function safeJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: text };
    }
  }

  // =============================
  // Filtro Categoría (toolbar) desde Configuración
  // =============================
  let categoriasToolbarCache = [];

  // Carga desde /config/categorias y llena el select #filtroCategoria
  async function loadCategoriasToolbar() {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/config/categorias`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      console.warn('No se pudieron cargar categorías (toolbar):', data.error);
      categoriasToolbarCache = [];
      fillFiltroCategoria([]); // deja "Todas"
      return;
    }

    categoriasToolbarCache = data.categorias || [];
    fillFiltroCategoria(categoriasToolbarCache);
  }

  // Renderiza options en #filtroCategoria preservando selección si existe
  function fillFiltroCategoria(items) {
    const sel = $('filtroCategoria');
    if (!sel) return;

    const current = sel.value; // preservar selección actual si sigue existiendo

    // Opción default
    sel.innerHTML = `<option value="">Todas las categorías</option>`;

    // Si no hay items, dejamos solo "Todas"
    if (!items || items.length === 0) {
      sel.value = '';
      return;
    }

    // Agregar categorías
    items.forEach((c) => {
      const nombre = String(c.nombre || '').trim();
      if (!nombre) return;
      const opt = document.createElement('option');
      opt.value = nombre;
      opt.textContent = nombre;
      sel.appendChild(opt);
    });

    // Restaurar selección si existe aún
    const exists = [...sel.options].some((o) => o.value === current);
    sel.value = exists ? current : '';
  }

  // =============================
  // Actividades (config) y filtro
  // =============================
  let actividadesConfigCache = [];
let actividadesAdicionalesConfigCache = [];

  async function loadActividadesConfig() {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/config/actividades`);
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      console.warn('No se pudieron cargar actividades:', data.error);
      actividadesConfigCache = [];
      fillActividadSelect([]);
      fillFiltroActividad([]);
      return;
    }
    actividadesConfigCache = data.actividades ?? [];
    fillActividadSelect(actividadesConfigCache);
    fillFiltroActividad(actividadesConfigCache);
  }

async function loadActividadesAdicionalesConfig() {
  const clubId = getActiveClubId();
  const res = await fetchAuth(`/club/${clubId}/config/actividades-adicionales`);
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    console.warn('No se pudieron cargar actividades adicionales:', data.error);
    actividadesAdicionalesConfigCache = [];
    renderActividadesAdicionalesSocio([]);
    return;
  }

  actividadesAdicionalesConfigCache = data.actividades ?? [];
  renderActividadesAdicionalesSocio(actividadesAdicionalesConfigCache);
}


function renderActividadesAdicionalesSocio(items) {
  const cont = $('socioAdicionalesLista');
  if (!cont) return;

  cont.innerHTML = '';

  if (!items || !items.length) {
    cont.innerHTML = '<div class="muted small">Sin actividades</div>';
    return;
  }

  items.forEach(a => {
    const div = document.createElement('div');

    div.innerHTML = `
      <label style="display:flex; gap:8px; align-items:center;">
        <input type="checkbox" class="chk-adicional" value="${a.nombre}">
        ${escapeHtml(a.nombre)} ($${a.precio_mensual || 0})
      </label>
    `;

    cont.appendChild(div);
  });
}

function setActividadesAdicionalesSeleccionadas(values) {
  const seleccionadas = Array.isArray(values) ? values.map(v => String(v)) : [];

  document.querySelectorAll('.chk-adicional').forEach(chk => {
    chk.checked = seleccionadas.includes(String(chk.value));
  });
}

  function fillActividadSelect(items) {
    const sel = $('socioActividad');
    if (!sel) return;
    if (!items || items.length === 0) {
      sel.innerHTML = `<option value="">(No hay actividades cargadas)</option>`;
      return;
    }
    sel.innerHTML =
      `<option value="">Seleccionar...</option>` +
      items.map((a) => `<option value="${String(a.nombre)}">${String(a.nombre)}</option>`).join('');
  }

  function fillFiltroActividad(items) {
    const sel = $('filtroActividad');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Todas las actividades</option>`;
    if (!items || items.length === 0) {
      sel.value = '';
      return;
    }
    items.forEach((a) => {
      const nombre = String(a.nombre ?? '').trim();
      if (!nombre) return;
      const opt = document.createElement('option');
      opt.value = nombre;
      opt.textContent = nombre;
      sel.appendChild(opt);
    });
    const exists = [...sel.options].some((o) => o.value === current);
    sel.value = exists ? current : '';
  }

  // Si al editar viene una actividad que ya no está en config
  function ensureActividadOption(value) {
    const sel = $('socioActividad');
    if (!sel) return;
    const v = (value ?? '').trim();
    if (!v) return;
    const exists = [...sel.options].some((o) => o.value === v);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v + ' (no está en Configuración)';
      sel.appendChild(opt);
    }
  }

// =============================
// Excepciones de cuota (config)
// =============================
let excepcionesCuotaCache = [];

function excepcionesCuotaUrl() {
  const clubId = getActiveClubId();
  return `/club/${clubId}/config/excepciones-cuota`;
}

async function loadExcepcionesCuotaConfig() {
  const res = await fetchAuth(excepcionesCuotaUrl());
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    console.warn('No se pudieron cargar excepciones de cuota:', data.error);
    excepcionesCuotaCache = [];
    fillExcepcionSelect([]);
    return;
  }

  excepcionesCuotaCache = data.excepciones ?? [];
  fillExcepcionSelect(excepcionesCuotaCache);
}

function fillExcepcionSelect(items) {
  const sel = $('socioExcepcionCuota');
  if (!sel) return;

  sel.innerHTML = `<option value="">Seleccionar excepción…</option>`;

  if (!items || items.length === 0) return;

  items.forEach((ex) => {
    const id = String(ex.id || '').trim();
    const nombre = String(ex.nombre || '').trim();
    if (!id || !nombre) return;

    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = nombre;
    sel.appendChild(opt);
  });
}

// Si al editar viene una excepción que ya no está activa/listada
function ensureExcepcionOption(value, labelHint) {
  const sel = $('socioExcepcionCuota');
  if (!sel) return;

  const v = String(value ?? '').trim();
  if (!v) return;

  const exists = [...sel.options].some((o) => o.value === v);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = (labelHint ? `${labelHint} (no está en Configuración)` : 'Excepción (no está en Configuración)');
    sel.appendChild(opt);
  }
}

  // =============================
  // Categorías deportivas (config)
  // =============================
  let categoriasConfigCache = [];

  async function loadCategoriasConfig() {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/config/categorias`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      console.warn('Error cargando categorías:', data.error);
      fillCategoriaSelect([]);
      return;
    }

    fillCategoriaSelect(data.categorias ?? []);
  }

  function fillCategoriaSelect(items) {
    const sel = $('socioCategoria');
    const filtro = $('filtroCategoria');
    if (!sel || !filtro) return;

    // preservar lo que el edit quiso setear antes de que lleguen las categorías
    const pending = sel.dataset.pendingValue || sel.value;

    // llenar modal
    sel.innerHTML = `<option value="">Seleccionar...</option>`;
    items.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.nombre;
      opt.textContent = c.nombre;
      sel.appendChild(opt);
    });

    // aplicar selección pendiente si existe
    if (pending) {
      const exists = [...sel.options].some((o) => o.value === pending);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = pending;
        opt.textContent = pending + ' (no está en Configuración)';
        sel.appendChild(opt);
      }
      sel.value = pending;
    }
    delete sel.dataset.pendingValue;

    // llenar filtro preservando selección previa
    const current = filtro.value;
    filtro.innerHTML = `<option value="">Todas las categorías</option>`;
    items.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.nombre;
      opt.textContent = c.nombre;
      filtro.appendChild(opt);
    });
    filtro.value = current || '';
  }

  // Si al editar viene una categoría que no existe más en config
  function ensureCategoriaOption(value) {
    const sel = $('socioCategoria');
    if (!sel) return;
    const v = (value || '').trim();
    if (!v) return;
    const exists = [...sel.options].some((o) => o.value === v);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v + ' (no está en Configuración)';
      sel.appendChild(opt);
    }
  }

async function fetchGrupoFamiliar(socioId) {
  const clubId = getActiveClubId();
  const res = await fetchAuth(`/club/${clubId}/grupo-familiar/${socioId}`);
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Error cargando grupo familiar');
  }

  return data;
}

async function saveGrupoFamiliar(jefeSocioId, miembros) {
  const clubId = getActiveClubId();
  const res = await fetchAuth(`/club/${clubId}/grupo-familiar`, {
    method: 'POST',
    json: true,
    body: JSON.stringify({
      jefeSocioId,
      miembros
    })
  });

  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Error guardando grupo familiar');
  }

  return data;
}

async function deleteGrupoFamiliar(jefeSocioId) {
  const clubId = getActiveClubId();
  const res = await fetchAuth(`/club/${clubId}/grupo-familiar/${jefeSocioId}`, {
    method: 'DELETE'
  });
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Error eliminando grupo familiar');
  }

  return data;
}


  // =============================
  // Helpers texto / formato
  // =============================
  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function fmtDMY(iso) {
    if (!iso) return '';
    const s = String(iso).slice(0, 10); // YYYY-MM-DD
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}-${m}-${y}`;
  }

  function yearFromISO(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 4);
  }



function fmtDMYShort(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  // dd-mm-aa
  return `${d}-${m}-${String(y).slice(2)}`;
}

  function onlyDigits(v) {
    return String(v ?? '').replace(/\D+/g, '');
  }

function resetGrupoFamiliarState() {
  grupoFamiliarSeleccionados = [];
  grupoFamiliarSeleccionadosDraft = [];
  grupoFamiliarOriginalEraJefe = false;

  const chk = $('socioEsJefePlanFamiliar');
  const wrap = $('socioPlanFamiliarWrap');
  const info = $('socioPlanFamiliarInfo');
  const resumen = $('socioPlanFamiliarListaVisual');

  if (chk) chk.checked = false;
  if (wrap) wrap.classList.add('hidden');
  if (info) info.style.display = 'none';

  if (resumen) {
    resumen.innerHTML = '<div class="muted small">Sin integrantes</div>';
  }
}

function renderGrupoFamiliarResumen() {
  const cont = $('socioPlanFamiliarListaVisual');
  const cant = $('gfCantidad');
  if (!cont) return;

  if (!grupoFamiliarSeleccionados.length) {
    cont.innerHTML = `<div class="muted small">Sin integrantes</div>`;
    if (cant) cant.textContent = '';
    return;
  }

  // ✅ usar el cache completo del modal, no la grilla paginada
  const fuente = sociosGrupoFamiliarCache || [];

  const rows = grupoFamiliarSeleccionados
    .map(id => fuente.find(s => String(s.id) === String(id)))
    .filter(Boolean);

  if (!rows.length) {
    cont.innerHTML = `<div class="muted small">Sin integrantes</div>`;
    if (cant) cant.textContent = `(${grupoFamiliarSeleccionados.length})`;
    return;
  }

  cont.innerHTML = rows.map(s => `
    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:6px 8px;
      border-bottom:1px solid #eee;
    ">
      <span>${escapeHtml(s.apellido || '')} ${escapeHtml(s.nombre || '')}</span>
      <small class="muted">N° ${escapeHtml(String(s.numero_socio || ''))}</small>
    </div>
  `).join('');

  if (cant) cant.textContent = `(${rows.length})`;
}

function syncGrupoFamiliarUI() {
  const chk = $('socioEsJefePlanFamiliar');
  const wrap = $('socioPlanFamiliarWrap');
  const info = $('socioPlanFamiliarInfo');

  const activo = !!chk?.checked;

  if (wrap) wrap.classList.toggle('hidden', !activo);
  if (info) info.style.display = activo ? 'block' : 'none';

  renderGrupoFamiliarResumen();
}

// =============================
// PLAN DE CUOTAS PERSONALIZADO (por socio + actividad)
// =============================
let planCuotasSocioId = null;          // socio para el que está abierto el modal
let planCuotasPlanesSocio = [];        // todos los planes (activos) del socio, cacheados al abrir
let planCuotasPlanIdActual = null;     // id del plan que se está viendo/editando (null = todavía no existe)
let planCuotasCuotasActuales = [];     // cuotas en pantalla (editable)
// ✅ El pago de las cuotas se registra desde Pagos → Registrar Pago (no acá).
// Acá solo se arma/edita el plan y, si hace falta corregir algo, se puede
// deshacer un pago ya cobrado.

function fillPlanCuotasActividadSelect() {
  const sel = $('planCuotasActividad');
  if (!sel) return;
  const valorPrevio = sel.value;
  sel.innerHTML = '<option value="">Seleccionar actividad…</option>' +
    actividadesAdicionalesConfigCache.map(a =>
      `<option value="${escapeHtml(String(a.id))}">${escapeHtml(a.nombre || '')}</option>`
    ).join('');
  if (valorPrevio) sel.value = valorPrevio;
}

async function abrirModalPlanCuotas() {
  if (!editingId) {
    alert('Guardá el socio primero para poder configurar un plan de cuotas.');
    return;
  }

  planCuotasSocioId = editingId;
  planCuotasPlanIdActual = null;
  planCuotasCuotasActuales = [];

  if (!actividadesAdicionalesConfigCache.length) {
    await loadActividadesAdicionalesConfig().catch(() => {});
  }
  fillPlanCuotasActividadSelect();

  $('planCuotasMontoMensual').value = '';
  $('planCuotasCantidad').value = '';
  if ($('planCuotasPeriodicidad')) $('planCuotasPeriodicidad').value = '1';
  $('planCuotasMesInicio').value = '';
  $('planCuotasAnioInicio').value = '';
  $('planCuotasActividad').value = '';

  $('planCuotasEstado').textContent = 'Elegí una actividad.';
  renderPlanCuotasTabla([]);
  $('btnEliminarPlanCuotas').style.display = 'none';

  await cargarPlanesActividadSocio();

  $('modalPlanCuotas').classList.remove('hidden');
}

function cerrarModalPlanCuotas() {
  $('modalPlanCuotas').classList.add('hidden');
}

async function cargarPlanesActividadSocio() {
  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/socios/${planCuotasSocioId}/planes-actividad`);
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los planes.');
    planCuotasPlanesSocio = (data.planes || []).filter(p => p.activo);
    actualizarEstadoPlanCuotasFicha();
  } catch (e) {
    console.error('❌ cargarPlanesActividadSocio', e);
    planCuotasPlanesSocio = [];
  }
}

// Texto resumen que se ve en la ficha del socio (fuera del modal)
function actualizarEstadoPlanCuotasFicha() {
  const el = $('socioPlanCuotasEstado');
  if (!el) return;
  if (!planCuotasPlanesSocio.length) {
    el.textContent = 'Sin plan de cuotas personalizado.';
    return;
  }
  const nombres = planCuotasPlanesSocio.map(p => p.actividad_nombre).join(', ');
  el.textContent = `Tiene plan de cuotas en: ${nombres}.`;
}

function onPlanCuotasActividadChange() {
  const actividadId = $('planCuotasActividad').value;
  const plan = planCuotasPlanesSocio.find(p => String(p.actividad_id) === String(actividadId));

  if (!actividadId) {
    planCuotasPlanIdActual = null;
    planCuotasCuotasActuales = [];
    $('planCuotasEstado').textContent = 'Elegí una actividad.';
    renderPlanCuotasTabla([]);
    $('btnEliminarPlanCuotas').style.display = 'none';
    return;
  }

  if (plan) {
    planCuotasPlanIdActual = plan.id;
    planCuotasCuotasActuales = (plan.cuotas || []).map(c => ({ ...c }));
    const pagadas = planCuotasCuotasActuales.filter(c => c.pagado).length;
    $('planCuotasEstado').textContent =
      `Plan activo: ${planCuotasCuotasActuales.length} cuotas, ${pagadas} pagadas.`;
    $('btnEliminarPlanCuotas').style.display = '';
  } else {
    planCuotasPlanIdActual = null;
    planCuotasCuotasActuales = [];
    $('planCuotasEstado').textContent = 'Sin plan para esta actividad todavía.';
    $('btnEliminarPlanCuotas').style.display = 'none';
  }

  renderPlanCuotasTabla(planCuotasCuotasActuales);
}

const MESES_NOMBRE = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function renderPlanCuotasTabla(cuotas) {
  const body = $('planCuotasTablaBody');
  const totalEl = $('planCuotasTotal');
  if (!body) return;

  if (!cuotas.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted small" style="padding:10px;">Sin cuotas cargadas.</td></tr>';
    if (totalEl) totalEl.textContent = '';
    return;
  }

  // orden visual por año/mes
  const ordenadas = [...cuotas].sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));

  body.innerHTML = ordenadas.map((c, idx) => {
    let colPagada;
    if (c.pagado) {
      // ya se cobró de verdad (quedó asentado en pagos_mensuales) -> mostrar cuenta/fecha + deshacer
      const fecha = c.fecha_pago ? String(c.fecha_pago).slice(0, 10) : '';
      colPagada = `
        <div style="line-height:1.3;">
          <span style="color:#166534; font-weight:700;">✅ Pagada</span><br>
          <span class="muted small">${escapeHtml(c.cuenta || '')}${fecha ? ' · ' + fecha : ''}</span><br>
          <button type="button" class="btn btn-secondary" data-accion="revertir" style="padding:1px 6px; font-size:11px; margin-top:2px;">Deshacer pago</button>
        </div>`;
    } else if (c.id) {
      // pendiente y ya guardada -> se cobra desde Pagos, acá solo se informa
      colPagada = `<span class="muted small">Pendiente</span>`;
    } else {
      // fila nueva, todavía no guardada
      colPagada = `<span class="muted small">Guardá el plan</span>`;
    }

    return `
    <tr data-idx="${idx}">
      <td style="padding:4px 8px;">${idx + 1}</td>
      <td style="padding:4px 8px;">
        <input type="number" min="1" max="12" value="${c.mes ?? ''}" data-field="mes" style="width:60px;" ${c.pagado ? 'disabled' : ''}>
      </td>
      <td style="padding:4px 8px;">
        <input type="number" min="2024" max="2100" value="${c.anio ?? ''}" data-field="anio" style="width:80px;" ${c.pagado ? 'disabled' : ''}>
      </td>
      <td style="padding:4px 8px;">
        <input type="number" min="0" step="0.01" value="${c.monto ?? ''}" data-field="monto" style="width:100px;" ${c.pagado ? 'disabled' : ''}>
      </td>
      <td style="padding:4px 8px; text-align:center;">${colPagada}</td>
      <td style="padding:4px 8px;">
        ${c.pagado ? '' : '<button type="button" class="btn btn-secondary" data-accion="quitar" style="padding:2px 8px;">✕</button>'}
      </td>
    </tr>
  `;
  }).join('');

  planCuotasCuotasActuales = ordenadas;

  const total = ordenadas.reduce((acc, c) => acc + (Number(c.monto) || 0), 0);
  if (totalEl) {
    totalEl.textContent = `Total: $ ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })} — ${ordenadas.length} cuota(s).`;
  }

  // listeners de edición inline
  body.querySelectorAll('tr[data-idx]').forEach(tr => {
    const idx = Number(tr.dataset.idx);

    tr.querySelectorAll('input[data-field="mes"], input[data-field="anio"], input[data-field="monto"]').forEach(inp => {
      inp.addEventListener('input', () => {
        const campo = inp.dataset.field;
        planCuotasCuotasActuales[idx][campo] = inp.value === '' ? '' : Number(inp.value);
      });
    });

    tr.querySelector('[data-accion="revertir"]')?.addEventListener('click', () => {
      revertirPagoCuota(planCuotasCuotasActuales[idx]);
    });

    tr.querySelector('[data-accion="quitar"]')?.addEventListener('click', () => {
      const cuota = planCuotasCuotasActuales[idx];
      planCuotasCuotasActuales.splice(idx, 1);
      renderPlanCuotasTabla(planCuotasCuotasActuales);
    });
  });
}

async function revertirPagoCuota(cuota) {
  if (!confirm('¿Deshacer este pago? Se va a sacar de la recaudación del club y la cuota vuelve a quedar pendiente.')) return;

  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(
      `/club/${clubId}/planes-actividad/${planCuotasPlanIdActual}/cuotas/${cuota.id}/revertir-pago`,
      { method: 'POST' }
    );
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo deshacer el pago.');

    await cargarPlanesActividadSocio();
    onPlanCuotasActividadChange();
  } catch (e) {
    console.error('❌ revertirPagoCuota', e);
    alert(e.message || 'No se pudo deshacer el pago.');
  }
}

async function generarCuotasSugeridasUI() {
  const actividadId = $('planCuotasActividad').value;
  if (!actividadId) {
    alert('Elegí primero la actividad.');
    return;
  }
  if (planCuotasCuotasActuales.some(c => c.pagado)) {
    alert('Este plan ya tiene cuotas pagadas. Para no perderlas, agregá o editá a mano las cuotas que faltan en la tabla, en vez de generar de nuevo.');
    return;
  }

  const montoPorMes = Number($('planCuotasMontoMensual').value);
  const cantidadCuotas = Number($('planCuotasCantidad').value);
  const periodicidadMeses = Number($('planCuotasPeriodicidad')?.value || 1);
  const mesInicio = Number($('planCuotasMesInicio').value);
  const anioInicio = Number($('planCuotasAnioInicio').value);

  if (!montoPorMes || !cantidadCuotas || !mesInicio || !anioInicio) {
    alert('Completá monto por cuota, cantidad de cuotas, mes y año de la primera cuota.');
    return;
  }

  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/planes-actividad/sugerir-cuotas`, {
      method: 'POST',
      body: JSON.stringify({ montoPorMes, cantidadCuotas, periodicidadMeses, mesInicio, anioInicio }),
      json: true
    });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo generar la sugerencia.');
    planCuotasCuotasActuales = data.cuotas.map(c => ({ ...c, pagado: false }));
    renderPlanCuotasTabla(planCuotasCuotasActuales);
  } catch (e) {
    console.error('❌ generarCuotasSugeridasUI', e);
    alert(e.message || 'No se pudo generar la sugerencia.');
  }
}

function agregarCuotaManualUI() {
  planCuotasCuotasActuales.push({ numero_cuota: planCuotasCuotasActuales.length + 1, anio: '', mes: '', monto: '', pagado: false });
  renderPlanCuotasTabla(planCuotasCuotasActuales);
}

async function guardarPlanCuotasUI() {
  const actividadId = $('planCuotasActividad').value;
  if (!actividadId) {
    alert('Elegí la actividad.');
    return;
  }
  if (!planCuotasCuotasActuales.length) {
    alert('Agregá al menos una cuota.');
    return;
  }
  for (const c of planCuotasCuotasActuales) {
    if (!c.mes || !c.anio || c.monto === '' || c.monto == null || Number(c.monto) <= 0) {
      alert('Revisá que todas las cuotas tengan mes, año y monto cargados.');
      return;
    }
  }

  const cuotasPayload = planCuotasCuotasActuales
    .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes))
    .map((c, idx) => ({
      numero_cuota: idx + 1,
      anio: Number(c.anio),
      mes: Number(c.mes),
      monto: Number(c.monto),
      pagado: !!c.pagado
    }));

  const clubId = getActiveClubId();
  try {
    let res;
    if (planCuotasPlanIdActual) {
      res = await fetchAuth(`/club/${clubId}/planes-actividad/${planCuotasPlanIdActual}/cuotas`, {
        method: 'PUT',
        body: JSON.stringify({ cuotas: cuotasPayload }),
        json: true
      });
    } else {
      res = await fetchAuth(`/club/${clubId}/socios/${planCuotasSocioId}/planes-actividad`, {
        method: 'POST',
        body: JSON.stringify({ actividad_id: actividadId, cuotas: cuotasPayload }),
        json: true
      });
    }
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el plan.');

    alert('Plan de cuotas guardado.');
    await cargarPlanesActividadSocio();
    onPlanCuotasActividadChange(); // refresca la tabla con los ids ya asignados
  } catch (e) {
    console.error('❌ guardarPlanCuotasUI', e);
    alert(e.message || 'No se pudo guardar el plan.');
  }
}

async function eliminarPlanCuotasUI() {
  if (!planCuotasPlanIdActual) return;
  if (!confirm('¿Eliminar este plan de cuotas? Esta acción no se puede deshacer.')) return;

  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/planes-actividad/${planCuotasPlanIdActual}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo eliminar el plan.');

    alert('Plan eliminado.');
    await cargarPlanesActividadSocio();
    onPlanCuotasActividadChange();
  } catch (e) {
    console.error('❌ eliminarPlanCuotasUI', e);
    alert(e.message || 'No se pudo eliminar el plan.');
  }
}

// =============================
// PLAN DE CLASES (PAQUETE) — por socio + actividad
// =============================
// Puede aplicarse a la Actividad deportiva del socio (si esa actividad está
// configurada como "por paquete de clases" en Configuración, en cuyo caso
// reemplaza a la cuota social mensual) o a una Actividad adicional marcada
// con la misma modalidad (checkboxes de la ficha). Solo una de las dos
// modalidades se usa a la vez, según cuál esté marcada "por_clases":
// - "deportiva": no hay selector, se gestiona directo el paquete de la
//   actividad deportiva del socio.
// - "adicional": se elige la actividad adicional entre las marcadas
//   "por_clases" (comportamiento anterior, sin cambios).
let planClasesSocioId = null;          // socio para el que está abierto el modal
let planClasesPlanesSocio = [];        // todos los paquetes activos del socio, cacheados al abrir
let planClasesPlanIdActual = null;     // id del paquete que se está viendo/editando (null = todavía no existe)
let planClasesRegistroActual = [];     // clases tomadas del paquete actual
let planClasesPagosActual = [];        // pagos parciales del paquete actual (solo lectura acá; se registran desde Pagos)
let planClasesModoActividad = null;    // 'deportiva' | 'adicional'
let planClasesActividadIdActual = null;    // id de la actividad (deportiva o adicional) en uso
let planClasesActividadNombreActual = '';  // nombre de esa actividad, para mostrar

function fillPlanClasesActividadSelect() {
  const sel = $('planClasesActividad');
  if (!sel) return;
  const valorPrevio = sel.value;
  const actividadesPorClases = actividadesAdicionalesConfigCache.filter(a => a.modalidad_pago === 'por_clases');
  sel.innerHTML = '<option value="">Seleccionar actividad…</option>' +
    actividadesPorClases.map(a =>
      `<option value="${escapeHtml(String(a.id))}">${escapeHtml(a.nombre || '')}</option>`
    ).join('');
  if (valorPrevio) sel.value = valorPrevio;
}

async function abrirModalPlanClases() {
  if (!editingId) {
    alert('Guardá el socio primero para poder configurar un plan de clases.');
    return;
  }

  planClasesSocioId = editingId;
  planClasesPlanIdActual = null;
  planClasesRegistroActual = [];
  planClasesPagosActual = [];
  planClasesModoActividad = null;
  planClasesActividadIdActual = null;
  planClasesActividadNombreActual = '';

  // ✅ Siempre se recargan (no solo "si está vacío"): estos catálogos se
  // pueden haber editado en Configuración (ej: cambiar la modalidad de
  // pago) en otra pestaña/sección sin recargar toda la página, y el modal
  // necesita el dato fresco para decidir en qué modo abrir.
  // Recargar el select de "Actividad" de la ficha (socioActividad) reconstruye
  // sus <option> y pierde la selección actual, así que la guardamos antes y
  // la restauramos después.
  const actividadFichaPrevia = $('socioActividad')?.value ?? '';
  await loadActividadesAdicionalesConfig().catch(() => {});
  await loadActividadesConfig().catch(() => {});
  if ($('socioActividad')) {
    $('socioActividad').value = actividadFichaPrevia;
    ensureActividadOption(actividadFichaPrevia);
    $('socioActividad').value = actividadFichaPrevia;
  }
  $('planClasesCantidad').value = '';
  $('planClasesMonto').value = '';
  $('planClasesFechaInicio').value = '';
  $('planClasesActividad').value = '';

  $('planClasesEstado').textContent = 'Elegí una actividad.';
  renderPlanClasesRegistroTabla([]);
  renderPlanClasesPagosTabla([]);
  $('planClasesSaldo').textContent = '';
  $('btnEliminarPlanClases').style.display = 'none';
  $('btnRegistrarClaseTomada').disabled = true;

  await cargarPlanesClasesSocio();

  // ✅ ¿La actividad deportiva del socio está configurada "por paquete de
  // clases"? Si es así, se gestiona directo (sin selector) porque el socio
  // solo tiene una actividad deportiva.
  const nombreDeportiva = ($('socioActividad')?.value || '').trim();
  const deportivaObj = actividadesConfigCache.find(
    a => String(a.nombre || '').trim() === nombreDeportiva
  );
  const esDeportivaPorClases = !!deportivaObj && deportivaObj.modalidad_pago === 'por_clases';

  const selectWrap = $('planClasesActividadSelectWrap');
  const fijaWrap = $('planClasesActividadFijaWrap');

  const intro = $('planClasesIntro');

  if (esDeportivaPorClases) {
    planClasesModoActividad = 'deportiva';
    if (selectWrap) selectWrap.style.display = 'none';
    if (fijaWrap) fijaWrap.style.display = '';
    if ($('planClasesActividadFija')) {
      $('planClasesActividadFija').textContent = `${deportivaObj.nombre} (actividad deportiva)`;
    }
    if (intro) {
      intro.textContent = `La actividad deportiva "${deportivaObj.nombre}" de este socio se paga por paquete de clases: reemplaza a la cuota social mensual (no genera mora por cuota social). El "quedan disponibles" es solo informativo: no bloquea nada.`;
    }
    aplicarActividadClasesSeleccionada(deportivaObj.id, 'deportiva', deportivaObj.nombre);
  } else {
    planClasesModoActividad = 'adicional';
    if (selectWrap) selectWrap.style.display = '';
    if (fijaWrap) fijaWrap.style.display = 'none';
    if (intro) {
      intro.textContent = 'Para actividades adicionales que se pagan por paquete de clases (ej: clases sueltas, sin fecha fija). Es un paquete aparte, específico de este socio y esta actividad: no modifica la cuota normal del club. El "quedan disponibles" es solo informativo: no bloquea nada.';
    }
    fillPlanClasesActividadSelect();
  }

  $('modalPlanClases').classList.remove('hidden');
}

function cerrarModalPlanClases() {
  $('modalPlanClases').classList.add('hidden');
}

async function cargarPlanesClasesSocio() {
  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/socios/${planClasesSocioId}/planes-clases`);
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los paquetes.');
    planClasesPlanesSocio = (data.planes || []).filter(p => p.activo);
    actualizarEstadoPlanClasesFicha();
  } catch (e) {
    console.error('❌ cargarPlanesClasesSocio', e);
    planClasesPlanesSocio = [];
  }
}

// El "paquete vigente" de una actividad es el más nuevo (por si hubo
// renovaciones); los anteriores quedan en la base como historial pero
// no se muestran acá.
function paqueteVigentePorActividad(actividadId, tipoActividad) {
  const planes = planClasesPlanesSocio
    .filter(p => String(p.actividad_id) === String(actividadId) && p.tipo_actividad === tipoActividad)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return planes[0] || null;
}

// Texto resumen que se ve en la ficha del socio (fuera del modal)
function actualizarEstadoPlanClasesFicha() {
  const el = $('socioPlanClasesEstado');
  if (!el) return;
  if (!planClasesPlanesSocio.length) {
    el.textContent = 'Sin plan de clases.';
    return;
  }
  const claves = [...new Set(planClasesPlanesSocio.map(p => `${p.tipo_actividad}:${p.actividad_id}`))];
  const resumen = claves.map(clave => {
    const [tipo, id] = clave.split(':');
    const p = paqueteVigentePorActividad(id, tipo);
    return `${p.actividad_nombre}: ${p.clases_restantes} de ${p.cantidad_clases} clases restantes`;
  }).join(' · ');
  el.textContent = `Plan de clases — ${resumen}.`;
}

// Lógica común para mostrar el paquete de una actividad (deportiva o
// adicional) puntual, ya sea porque se seleccionó del select (modo
// "adicional") o porque se resolvió automáticamente (modo "deportiva").
function aplicarActividadClasesSeleccionada(actividadId, tipoActividad, nombreActividad) {
  planClasesActividadIdActual = actividadId || null;
  planClasesActividadNombreActual = nombreActividad || '';

  if (!actividadId) {
    planClasesPlanIdActual = null;
    planClasesRegistroActual = [];
    planClasesPagosActual = [];
    $('planClasesEstado').textContent = 'Elegí una actividad.';
    $('planClasesCantidad').value = '';
    $('planClasesMonto').value = '';
    $('planClasesFechaInicio').value = '';
    renderPlanClasesRegistroTabla([]);
    renderPlanClasesPagosTabla([]);
    $('planClasesSaldo').textContent = '';
    $('btnEliminarPlanClases').style.display = 'none';
    $('btnRegistrarClaseTomada').disabled = true;
    return;
  }

  const plan = paqueteVigentePorActividad(actividadId, tipoActividad);

  if (plan) {
    planClasesPlanIdActual = plan.id;
    planClasesRegistroActual = (plan.registro || []).map(r => ({ ...r }));
    planClasesPagosActual = (plan.pagos || []).map(pg => ({ ...pg }));

    $('planClasesCantidad').value = plan.cantidad_clases ?? '';
    $('planClasesMonto').value = plan.monto_total ?? '';
    $('planClasesFechaInicio').value = plan.fecha_inicio ? String(plan.fecha_inicio).slice(0, 10) : '';

    $('planClasesEstado').textContent =
      `Paquete vigente: ${plan.clases_restantes} de ${plan.cantidad_clases} clases restantes. ` +
      `Pagado $ ${Number(plan.monto_pagado || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })} de $ ${Number(plan.monto_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}.`;

    $('btnEliminarPlanClases').style.display = '';
    $('btnRegistrarClaseTomada').disabled = false;
  } else {
    planClasesPlanIdActual = null;
    planClasesRegistroActual = [];
    planClasesPagosActual = [];
    $('planClasesCantidad').value = '';
    $('planClasesMonto').value = '';
    $('planClasesFechaInicio').value = '';
    $('planClasesEstado').textContent = 'Sin paquete para esta actividad todavía.';
    $('btnEliminarPlanClases').style.display = 'none';
    $('btnRegistrarClaseTomada').disabled = true;
  }

  renderPlanClasesRegistroTabla(planClasesRegistroActual);
  renderPlanClasesPagosTabla(planClasesPagosActual);
  actualizarSaldoPlanClases();
}

// Handler del <select> (modo "adicional" únicamente)
function onPlanClasesActividadChange() {
  const sel = $('planClasesActividad');
  const actividadId = sel?.value || '';
  const nombre = sel?.selectedOptions?.[0]?.textContent || '';
  aplicarActividadClasesSeleccionada(actividadId, 'adicional', nombre);
}

function actualizarSaldoPlanClases() {
  const el = $('planClasesSaldo');
  if (!el) return;
  if (!planClasesPlanIdActual) {
    el.textContent = '';
    return;
  }
  const monto = Number($('planClasesMonto').value) || 0;
  const pagado = planClasesPagosActual.reduce((acc, pg) => acc + Number(pg.monto || 0), 0);
  const saldo = Math.round((monto - pagado) * 100) / 100;
  el.textContent = `Pagado $ ${pagado.toLocaleString('es-AR', { minimumFractionDigits: 2 })} — Saldo pendiente $ ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}.`;
}

function renderPlanClasesRegistroTabla(registro) {
  const body = $('planClasesRegistroTablaBody');
  if (!body) return;

  if (!registro.length) {
    body.innerHTML = '<tr><td colspan="3" class="muted small" style="padding:10px;">Sin clases registradas.</td></tr>';
    return;
  }

  const ordenadas = [...registro].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  body.innerHTML = ordenadas.map((r, idx) => `
    <tr data-idx="${idx}">
      <td style="padding:4px 8px;">${idx + 1}</td>
      <td style="padding:4px 8px;">${escapeHtml(String(r.fecha || '').slice(0, 10))}</td>
      <td style="padding:4px 8px;">
        <button type="button" class="btn btn-secondary" data-accion="deshacer" style="padding:2px 8px; font-size:11px;">Deshacer</button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('tr[data-idx]').forEach(tr => {
    const idx = Number(tr.dataset.idx);
    tr.querySelector('[data-accion="deshacer"]')?.addEventListener('click', () => {
      deshacerClaseUI(ordenadas[idx].id);
    });
  });
}

function renderPlanClasesPagosTabla(pagos) {
  const body = $('planClasesPagosTablaBody');
  if (!body) return;

  if (!pagos.length) {
    body.innerHTML = '<tr><td colspan="4" class="muted small" style="padding:10px;">Sin pagos registrados.</td></tr>';
    return;
  }

  const ordenados = [...pagos].sort((a, b) => new Date(a.fecha_pago) - new Date(b.fecha_pago));

  body.innerHTML = ordenados.map((pg, idx) => `
    <tr data-idx="${idx}">
      <td style="padding:4px 8px;">${escapeHtml(String(pg.fecha_pago || '').slice(0, 10))}</td>
      <td style="padding:4px 8px;">${escapeHtml(pg.cuenta || '')}</td>
      <td style="padding:4px 8px;">$ ${Number(pg.monto || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      <td style="padding:4px 8px;">
        <button type="button" class="btn btn-secondary" data-accion="deshacer" style="padding:2px 8px; font-size:11px;">Deshacer</button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('tr[data-idx]').forEach(tr => {
    const idx = Number(tr.dataset.idx);
    tr.querySelector('[data-accion="deshacer"]')?.addEventListener('click', () => {
      deshacerPagoClasesUI(ordenados[idx].id);
    });
  });
}

async function guardarPaqueteClasesUI() {
  const actividadId = planClasesActividadIdActual;
  if (!actividadId) {
    alert('Elegí la actividad.');
    return;
  }
  const cantidad = Number($('planClasesCantidad').value);
  const monto = Number($('planClasesMonto').value);
  const fechaInicio = $('planClasesFechaInicio').value || null;

  if (!cantidad || cantidad <= 0) {
    alert('Ingresá la cantidad de clases del paquete.');
    return;
  }
  if (monto === '' || monto == null || isNaN(monto) || monto < 0) {
    alert('Ingresá el monto del paquete.');
    return;
  }

  const clubId = getActiveClubId();
  try {
    let res;
    if (planClasesPlanIdActual) {
      res = await fetchAuth(`/club/${clubId}/planes-clases/${planClasesPlanIdActual}`, {
        method: 'PUT',
        body: JSON.stringify({ cantidad_clases: cantidad, monto_total: monto, fecha_inicio: fechaInicio }),
        json: true
      });
    } else {
      res = await fetchAuth(`/club/${clubId}/socios/${planClasesSocioId}/planes-clases`, {
        method: 'POST',
        body: JSON.stringify({
          actividad_id: actividadId,
          tipo_actividad: planClasesModoActividad,
          cantidad_clases: cantidad,
          monto_total: monto,
          fecha_inicio: fechaInicio
        }),
        json: true
      });
    }
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el paquete.');

    alert('Paquete guardado.');
    await cargarPlanesClasesSocio();
    aplicarActividadClasesSeleccionada(planClasesActividadIdActual, planClasesModoActividad, planClasesActividadNombreActual);
  } catch (e) {
    console.error('❌ guardarPaqueteClasesUI', e);
    alert(e.message || 'No se pudo guardar el paquete.');
  }
}

function nuevoPaqueteClasesUI() {
  const actividadId = planClasesActividadIdActual;
  if (!actividadId) {
    alert('Elegí primero la actividad.');
    return;
  }
  planClasesPlanIdActual = null;
  planClasesRegistroActual = [];
  planClasesPagosActual = [];
  $('planClasesCantidad').value = '';
  $('planClasesMonto').value = '';
  $('planClasesFechaInicio').value = '';
  $('planClasesEstado').textContent = 'Nuevo paquete (renovación): completá los datos y guardá.';
  $('btnEliminarPlanClases').style.display = 'none';
  $('btnRegistrarClaseTomada').disabled = true;
  renderPlanClasesRegistroTabla([]);
  renderPlanClasesPagosTabla([]);
  $('planClasesSaldo').textContent = '';
}

async function registrarClaseTomadaUI() {
  if (!planClasesPlanIdActual) return;

  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/planes-clases/${planClasesPlanIdActual}/registrar-clase`, {
      method: 'POST',
      body: JSON.stringify({}),
      json: true
    });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo registrar la clase.');

    await cargarPlanesClasesSocio();
    aplicarActividadClasesSeleccionada(planClasesActividadIdActual, planClasesModoActividad, planClasesActividadNombreActual);
  } catch (e) {
    console.error('❌ registrarClaseTomadaUI', e);
    alert(e.message || 'No se pudo registrar la clase.');
  }
}

async function deshacerClaseUI(registroId) {
  if (!planClasesPlanIdActual) return;
  if (!confirm('¿Deshacer esta clase registrada?')) return;

  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/planes-clases/${planClasesPlanIdActual}/registro/${registroId}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo deshacer la clase.');

    await cargarPlanesClasesSocio();
    aplicarActividadClasesSeleccionada(planClasesActividadIdActual, planClasesModoActividad, planClasesActividadNombreActual);
  } catch (e) {
    console.error('❌ deshacerClaseUI', e);
    alert(e.message || 'No se pudo deshacer la clase.');
  }
}

// ✅ El pago del paquete se registra desde Pagos → Registrar Pago (no
// acá), igual que las cuotas del plan de cuotas personalizado. Acá solo
// se puede deshacer un pago ya cargado.
async function deshacerPagoClasesUI(pagoId) {
  if (!planClasesPlanIdActual) return;
  if (!confirm('¿Deshacer este pago? Se va a sacar de la recaudación del club.')) return;

  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/planes-clases/${planClasesPlanIdActual}/pagos/${pagoId}/revertir-pago`, { method: 'POST' });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo deshacer el pago.');

    await cargarPlanesClasesSocio();
    aplicarActividadClasesSeleccionada(planClasesActividadIdActual, planClasesModoActividad, planClasesActividadNombreActual);
  } catch (e) {
    console.error('❌ deshacerPagoClasesUI', e);
    alert(e.message || 'No se pudo deshacer el pago.');
  }
}

async function eliminarPlanClasesUI() {
  if (!planClasesPlanIdActual) return;
  if (!confirm('¿Eliminar este paquete? Esta acción no se puede deshacer.')) return;

  const clubId = getActiveClubId();
  try {
    const res = await fetchAuth(`/club/${clubId}/planes-clases/${planClasesPlanIdActual}`, { method: 'DELETE' });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo eliminar el paquete.');

    alert('Paquete eliminado.');
    await cargarPlanesClasesSocio();
    aplicarActividadClasesSeleccionada(planClasesActividadIdActual, planClasesModoActividad, planClasesActividadNombreActual);
  } catch (e) {
    console.error('❌ eliminarPlanClasesUI', e);
    alert(e.message || 'No se pudo eliminar el paquete.');
  }
}

async function openGrupoFamiliarModal() {
  const modal = $('modalGrupoFamiliar');
  if (!modal) return;

  // ✅ NUEVO: siempre recargamos la lista de socios al abrir el modal, en
  // vez de reusar la caché de la primera vez que se abrió en esta sesión.
  // Antes, si alguien ya quedaba asignado a otro Grupo Familiar después de
  // que se cargó la caché, esta pantalla lo seguía mostrando como
  // disponible y dejaba elegirlo igual — el choque terminaba recién al
  // guardar, como un error de base de datos.
  await loadSociosGrupoFamiliarCache();

  grupoFamiliarSeleccionadosDraft = [...grupoFamiliarSeleccionados];

  const search = $('grupoFamiliarSearch');
  if (search) search.value = '';

  renderGrupoFamiliarLista('');
  modal.classList.remove('hidden');
}
function closeGrupoFamiliarModal() {
  $('modalGrupoFamiliar')?.classList.add('hidden');
}

function socioPuedeSerIntegrante(socio) {
  if (!socio) return false;
  if (!editingId) return true;
  if (String(socio.id) === String(editingId)) return false;

  // si ya pertenece a ESTE jefe en edición, sí lo dejamos
  if (
    socio.es_miembro_plan_familiar === true &&
    String(socio.grupo_familiar_jefe_id || '') === String(editingId)
  ) {
    return true;
  }

  // si es miembro de otro grupo, no
  if (socio.es_miembro_plan_familiar === true) {
    return false;
  }

  // si es jefe de otro grupo, no
  if (socio.es_jefe_plan_familiar === true) {
    return false;
  }

  return true;
}

function renderGrupoFamiliarLista(query = '') {
  const cont = $('grupoFamiliarLista');
  if (!cont) return;

  const q = String(query || '').trim().toLowerCase();

  // 🔥 NO mostrar nada si no escriben
  if (!q) {
    cont.innerHTML = `
      <div class="muted small">
        Escribí para buscar (apellido, DNI o N° de socio)
      </div>
    `;
    return;
  }

  let results = sociosGrupoFamiliarCache.filter(s => socioPuedeSerIntegrante(s));


  results = results.filter(s =>
  String(s.apellido || '').toLowerCase().includes(q) ||
  String(s.nombre || '').toLowerCase().includes(q) ||
  String(s.numero_socio || '').includes(q) ||
  String(s.dni || '').includes(q)
);


  cont.innerHTML = '';

  if (!results.length) {
    cont.innerHTML = `<div class="muted small">Sin resultados</div>`;
    return;
  }

  results.slice(0, 10).forEach(s => {
    const checked = grupoFamiliarSeleccionadosDraft.includes(String(s.id));

const bg = checked ? '#e0f2fe' : '#fff';
const border = checked ? '1px solid #38bdf8' : '1px solid transparent';

    const row = document.createElement('div');
    row.className = 'gf-autocomplete-item';
    row.style = `
  padding:6px 8px;
  border-bottom:1px solid #eee;
  cursor:pointer;
  display:flex;
  justify-content:space-between;
  align-items:center;
  background:${bg};
  border:${border};
  border-radius:6px;
  margin-bottom:4px;
`;

    row.innerHTML = `
      <span><b>${escapeHtml(s.apellido)} ${escapeHtml(s.nombre)}</b></span>
      <small class="muted">N° ${escapeHtml(String(s.numero_socio || ''))}</small>
    `;

   row.addEventListener('click', () => {
  const id = String(s.id);

  if (grupoFamiliarSeleccionadosDraft.includes(id)) {
    grupoFamiliarSeleccionadosDraft =
      grupoFamiliarSeleccionadosDraft.filter(x => x !== id);
  } else {
    grupoFamiliarSeleccionadosDraft = [
      ...grupoFamiliarSeleccionadosDraft,
      id
    ];
  }

  renderGrupoFamiliarLista(q);
  renderGrupoFamiliarResumen();
});

    cont.appendChild(row);
  });
}
  function fmtDni(dni) {
    const d = onlyDigits(dni);
    if (d.length === 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}`;
    if (d.length === 7) return `${d.slice(0, 1)}.${d.slice(1, 4)}.${d.slice(4, 7)}`;
    return String(dni ?? '');
  }

  function phoneToWaE164(phone) {
    let d = onlyDigits(phone);
    if (!d) return null;

    d = d.replace(/^0+/, ''); // quita 0 inicial
    d = d.replace(/^15/, ''); // quita 15 si lo pusieron al inicio

    if (d.startsWith('54')) return d;

    if (d.length >= 10) return '549' + d; // AR típico con 11 dígitos
    return '54' + d;
  }

  function buildWaUrl(phone) {
    const e164 = phoneToWaE164(phone);
    if (!e164) return null;
    return `https://web.whatsapp.com/send?phone=${e164}`;
  }

  const WA_SVG = `
<svg viewBox="0 0 32 32" aria-hidden="true">
  <path fill="#25D366" d="M16 3C9.4 3 4 8.1 4 14.4c0 2.4.8 4.7 2.2 6.6L5 29l7.2-1.9c1.1.3 2.4.5 3.8.5 6.6 0 12-5.1 12-11.4S22.6 3 16 3z"/>
  <path fill="#fff" d="M13.4 10.6c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4-.2.3-.9.9-.9 2.2s1 2.6 1.1 2.8c.2.2 2 3.2 4.9 4.3 2.4.9 2.9.7 3.4.6.5-.1 1.6-.6 1.8-1.2.2-.6.2-1.1.1-1.2-.1-.2-.3-.3-.7-.5-.4-.2-1.6-.8-1.9-.9-.3-.1-.5-.2-.7.2-.2.4-.8.9-1 .9-.2.1-.4.1-.8-.1-.4-.2-1.5-.5-2.9-1.8-1.1-1-1.8-2.2-2-2.6-.2-.4 0-.6.2-.8.2-.2.4-.4.5-.6.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6-.1-.2-.6-1.6-.8-2z"/>
</svg>`;

  // =============================
  // Estado pago (usa backend pago_al_dia)
  // =============================
function pagoEstado(s) {
  if (s.becado) {
    return { ok: true, tipo: 'becado', label: 'Becado' };
  }

  // Si el backend marca parcial, mostrar naranja
  if (s.tiene_pagos_parciales === true) {
    return { ok: false, tipo: 'parcial', label: 'Parcial' };
  }

  // Si el backend dice al día, mostrar verde
  if (s.pago_al_dia === true) {
    return { ok: true, tipo: 'completo', label: 'Al día' };
  }

  // Si no está al día, rojo
  return { ok: false, tipo: 'impago', label: 'Impago' };
}

function renderPagoPill(s) {
  const est = pagoEstado(s);

  let cls = 'pay-bad';

  if (est.tipo === 'completo' || est.tipo === 'becado') {
    cls = 'pay-ok';
  } else if (est.tipo === 'parcial') {
    cls = 'pay-partial';
  }

  let txt = '🔴';

  if (est.tipo === 'completo' || est.tipo === 'becado') {
    txt = '🟢';
  } else if (est.tipo === 'parcial') {
    txt = '🟧';
  }

  return `
    <span
      class="pay-pill ${cls}"
      title="${escapeHtml(est.label)} - Doble click para registrar pago"
      data-act="open-payment"
      data-socio-id="${escapeHtml(s.id)}"
      style="cursor:pointer;"
    >
      ${txt}
    </span>
  `;
}

function getEstadoVisual(s) {
  if (s.activo === true) {
    return {
      dotClass: 'estado-dot--ok',
      badgeClass: 'badge-estado--ok',
      label: 'Activo'
    };
  }

  if (s.activo === false) {
    return {
      dotClass: 'estado-dot--bad',
      badgeClass: 'badge-estado--bad',
      label: 'Inactivo'
    };
  }

  return {
    dotClass: 'estado-dot--warn',
    badgeClass: 'badge-estado--warn',
    label: 'Deuda'
  };
}

function renderBoolBadge(value) {
  return value
    ? '<span class="badge-bool badge-bool--yes">Sí</span>'
    : '<span class="badge-bool badge-bool--no">No</span>';
}

function formatNombreTabla(s) {
  const apellido = String(s?.apellido ?? '').trim();
  const nombre = String(s?.nombre ?? '').trim();

  let full = '';
  if (apellido && nombre) full = `${apellido}, ${nombre}`;
  else if (apellido) full = apellido;
  else full = nombre;

  if (full.length > 30) {
    return full.slice(0, 30).trimEnd() + '…';
  }

  return full;
}

  // =============================
  // Estado
  // =============================
let editingId = null;
let sociosCache = [];
let sociosGrupoFamiliarCache = [];
let draftPhoto = null;
let bienvenidaPendientesCache = []; // ✅ NUEVO: socios pendientes de bienvenida

let grupoFamiliarSeleccionados = [];
let grupoFamiliarSeleccionadosDraft = [];
let grupoFamiliarOriginalEraJefe = false;


  // Estados de adjuntos/comentarios por socio
  // { [socioId]: { tieneAdjuntos: boolean, tieneComentario: boolean } }
  let socioEstados = {};

  function buildSocioEstadosMap(estados) {
    socioEstados = {};
    (estados || []).forEach((e) => {
      if (!e || e.socio_id == null) return;
      const id = String(e.socio_id);
      socioEstados[id] = {
        tieneAdjuntos: !!e.tiene_adjuntos,
        tieneComentario: !!e.tiene_comentario
      };
    });
  }

  function getEstadoIconosForSocio(id) {
    const st = socioEstados[String(id)];
    if (!st) return '';
    const { tieneAdjuntos, tieneComentario } = st;
    if (tieneAdjuntos && tieneComentario) return '📎💬';
    if (tieneAdjuntos) return '📎';
    if (tieneComentario) return '💬';
    return '';
  }

  async function loadSocioEstadosFromBackend() {
    const clubId = getActiveClubId();
    try {
      const res = await fetchAuth(`/club/${clubId}/socios/estados`);
      const data = await safeJson(res);
      if (!res.ok || !data.ok) {
        console.warn('No se pudieron cargar estados de adjuntos/comentarios:', data.error);
        socioEstados = {};
        return;
      }
      buildSocioEstadosMap(data.estados || []);
    } catch (e) {
      console.error('Error cargando estados de socios (adjuntos/comentarios)', e);
      socioEstados = {};
    }
  }

  // ✅ Después de eliminar un adjunto/comentario, actualiza en el momento el
  // ícono 📎/💬 de la fila del socio en la tabla (sin recargar toda la
  // tabla ni perder la página/scroll actual).
  async function refreshSocioFlagsIcon(socioId) {
    await loadSocioEstadosFromBackend();
    const tr = document.querySelector(`tr[data-id="${CSS.escape(String(socioId))}"]`);
    if (!tr) return;
    const icons = getEstadoIconosForSocio(socioId);
    let flagsEl = tr.querySelector('.socio-flags');
    if (icons) {
      if (flagsEl) {
        flagsEl.textContent = icons;
      } else {
        const td = tr.querySelector('td:last-child');
        if (td) {
          const span = document.createElement('span');
          span.className = 'socio-flags';
          span.title = 'Adjuntos / comentarios';
          span.style.marginLeft = '6px';
          span.textContent = icons;
          td.appendChild(span);
        }
      }
    } else if (flagsEl) {
      flagsEl.remove();
    }
  }

  // =============================
  // Orden + paginación
  // =============================
  let sortKey = null; // 'pago' | 'numero' | 'dni' | ...
  let sortDir = 'asc'; // 'asc' | 'desc'
  let currentPage = 1;
  const pageSize = 50;
let totalSociosCache = 0; // total real (del backend) para paginar

  // =============================
  // ADJUNTOS – helpers
  // =============================
  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    const kb = n / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    return mb.toFixed(1) + ' MB';
  }

  async function fetchAdjuntos(clubId, socioId) {
    const res = await fetchAuth(`/club/${clubId}/socios/${socioId}/adjuntos`);
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      console.error('Error cargando adjuntos', data.error);
      return [];
    }
    return data.adjuntos || [];
  }

 async function cargarAdjuntosEnModal(socioId) {
  const cont = $('listaAdjuntos');
  if (!cont) return;

  cont.innerHTML = '<div class="text-muted">Cargando adjuntos...</div>';

  const clubId = getActiveClubId();
  const adjuntos = await fetchAdjuntos(clubId, socioId);

  if (!adjuntos.length) {
    cont.innerHTML = '<div class="text-muted">No hay adjuntos ni comentarios guardados.</div>';
    return;
  }

  cont.innerHTML = '';

  adjuntos.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'd-flex justify-content-between align-items-start border-bottom py-1';

    const fecha = fmtDMYShort(a.created_at); // dd-mm-aa
    const nombreArchivo = a.filename || '(sin archivo)';

    row.innerHTML = `
      <div>
        <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
          <b>${escapeHtml(nombreArchivo)}</b>
        </a><br>
        ${
          a.comentario
            ? `<div><small>${escapeHtml(a.comentario)}</small></div>`
            : ''
        }
        <small>
          ${fecha ? fecha : ''}${fecha && a.size_bytes ? ' · ' : ''}
          ${a.size_bytes ? formatBytes(a.size_bytes) : ''}
        </small>
      </div>
      <button class="btn btn-sm btn-danger">Eliminar</button>
    `;

    row.querySelector('button')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este adjunto/comentario?')) return;

      const res = await fetchAuth(
        `/club/${clubId}/socios/${socioId}/adjuntos/${a.id}`,
        { method: 'DELETE' }
      );
      const data = await safeJson(res);
      if (!res.ok || !data.ok) {
        alert(data.error || 'Error eliminando adjunto');
        return;
      }
      await cargarAdjuntosEnModal(socioId);
      await refreshSocioFlagsIcon(socioId);
    });

    cont.appendChild(row);
  });
}
// =============================
// COMENTARIOS – helpers
// =============================
async function fetchComentarios(clubId, socioId) {
  const res = await fetchAuth(`/club/${clubId}/socios/${socioId}/comentarios`);
  const data = await safeJson(res);
  if (!res.ok || !data.ok) {
    console.error('Error cargando comentarios', data.error);
    return [];
  }
  return data.comentarios || [];
}

async function cargarComentariosEnModal(socioId) {
  const cont = $('listaComentarios');
  if (!cont) return;

  cont.innerHTML = '<div class="text-muted">Cargando comentarios...</div>';

  const clubId = getActiveClubId();
  const comentarios = await fetchComentarios(clubId, socioId);

  if (!comentarios.length) {
    cont.innerHTML = '<div class="text-muted">No hay comentarios guardados.</div>';
    return;
  }

  cont.innerHTML = '';

  comentarios.forEach(c => {
    const row = document.createElement('div');
    row.className = 'd-flex justify-content-between align-items-start border-bottom py-1';

    const fecha = fmtDMYShort(c.created_at);

    row.innerHTML = `
      <div>
        <div><b>${fecha}</b></div>
        <div>${escapeHtml(c.comentario)}</div>
      </div>
      <button class="btn btn-sm btn-danger">Eliminar</button>
    `;

    row.querySelector('button')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este comentario?')) return;

      const res = await fetchAuth(
        `/club/${clubId}/socios/${socioId}/comentarios/${c.id}`,
        { method: 'DELETE' }
      );
      const data = await safeJson(res);
      if (!res.ok || !data.ok) {
        alert(data.error || 'Error eliminando comentario');
        return;
      }
      await cargarComentariosEnModal(socioId);
      await refreshSocioFlagsIcon(socioId);
    });

    cont.appendChild(row);
  });
}

// =============================
  // VISOR SIMPLE DE ADJUNTOS / COMENTARIOS
  // =============================
  // Contexto del visor abierto actualmente (para que los botones "Eliminar"
  // sepan a qué socio/club pertenecen y para poder refrescar el contenido
  // después de borrar, sin cerrar el popup).
  let docsViewerCtx = { clubId: null, socioId: null, showAdjuntos: false, showComentarios: false };

  function ensureDocsViewerModal() {
    let modal = document.getElementById('docsViewerModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'docsViewerModal';
    modal.className = 'modal hidden';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(0,0,0,0.55)';
    modal.style.zIndex = '20000';
    modal.style.display = 'none';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '18px';

    modal.innerHTML = `
      <div class="modal-content" style="max-width:640px; pointer-events:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <h3 id="docsViewerTitle" style="margin:0;"></h3>
          <button type="button" id="docsViewerClose" class="btn btn-secondary">✕</button>
        </div>
        <div id="docsViewerBody" style="margin-top:10px; max-height:60vh; overflow-y:auto;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      const body = document.getElementById('docsViewerBody');
      if (body) body.innerHTML = '';
    };

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });

    const btnClose = modal.querySelector('#docsViewerClose');
    if (btnClose) {
      btnClose.addEventListener('click', (ev) => {
        ev.preventDefault();
        close();
      });
    }

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal.style.display === 'flex') {
        close();
      }
    });

    // Un solo listener delegado (el modal se crea una sola vez) para los
    // botones "Eliminar" de adjuntos y comentarios que arma renderDocsViewerBody().
    const bodyEl = modal.querySelector('#docsViewerBody');
    bodyEl.addEventListener('click', async (ev) => {
      const btnAdj = ev.target.closest('[data-del-adjunto]');
      const btnCom = ev.target.closest('[data-del-comentario]');
      if (!btnAdj && !btnCom) return;

      const { clubId, socioId } = docsViewerCtx;
      if (!clubId || !socioId) return;

      if (btnAdj) {
        if (!confirm('¿Eliminar este adjunto?')) return;
        const res = await fetchAuth(
          `/club/${clubId}/socios/${socioId}/adjuntos/${btnAdj.dataset.delAdjunto}`,
          { method: 'DELETE' }
        );
        const data = await safeJson(res);
        if (!res.ok || !data.ok) {
          alert(data.error || 'Error eliminando adjunto');
          return;
        }
      } else if (btnCom) {
        if (!confirm('¿Eliminar este comentario?')) return;
        const res = await fetchAuth(
          `/club/${clubId}/socios/${socioId}/comentarios/${btnCom.dataset.delComentario}`,
          { method: 'DELETE' }
        );
        const data = await safeJson(res);
        if (!res.ok || !data.ok) {
          alert(data.error || 'Error eliminando comentario');
          return;
        }
      }

      await renderDocsViewerBody();
      await refreshSocioFlagsIcon(socioId);
    });

    return modal;
  }

  async function renderDocsViewerBody() {
    const { clubId, socioId, showAdjuntos, showComentarios } = docsViewerCtx;
    const bodyEl = document.getElementById('docsViewerBody');
    if (!bodyEl) return;

    let html = '';

    // Adjuntos
    if (showAdjuntos) {
      const adjuntos = await fetchAdjuntos(clubId, socioId);
      html += '<h4 style="margin:10px 0 4px;">Adjuntos</h4>';
      if (!adjuntos.length) {
        html += '<div class="text-muted">No hay adjuntos.</div>';
      } else {
        adjuntos.forEach((a) => {
          const fecha = fmtDMYShort(a.created_at);
          const nombreArchivo = a.filename || '(sin archivo)';
          html += `
            <div style="padding:6px 0; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <div>
                <div>
                  <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
                    <b>${escapeHtml(nombreArchivo)}</b>
                  </a>
                </div>
                <div>
                  <small>
                    ${fecha || ''}${fecha && a.size_bytes ? ' · ' : ''}
                    ${a.size_bytes ? formatBytes(a.size_bytes) : ''}
                  </small>
                </div>
                ${a.comentario ? `<div><small>${escapeHtml(a.comentario)}</small></div>` : ''}
              </div>
              <button type="button" class="btn btn-sm btn-danger" data-del-adjunto="${a.id}" style="flex-shrink:0;">Eliminar</button>
            </div>
          `;
        });
      }
    }

    // Comentarios
    if (showComentarios) {
      const comentarios = await fetchComentarios(clubId, socioId);
      html += '<h4 style="margin:14px 0 4px;">Comentarios</h4>';
      if (!comentarios.length) {
        html += '<div class="text-muted">No hay comentarios.</div>';
      } else {
        comentarios.forEach((c) => {
          const fecha = fmtDMYShort(c.created_at);
          html += `
            <div style="padding:6px 0; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <div>
                <div><b>${fecha}</b></div>
                <div>${escapeHtml(c.comentario)}</div>
              </div>
              <button type="button" class="btn btn-sm btn-danger" data-del-comentario="${c.id}" style="flex-shrink:0;">Eliminar</button>
            </div>
          `;
        });
      }
    }

    if (!html) {
      html = '<div class="text-muted">No hay información para mostrar.</div>';
    }

    bodyEl.innerHTML = html;
  }

  async function openDocsViewer({ socioId, showAdjuntos, showComentarios }) {
    const clubId = getActiveClubId();
    const modal = ensureDocsViewerModal();
    if (!modal) return;

    docsViewerCtx = { clubId, socioId, showAdjuntos, showComentarios };

    const titleEl = document.getElementById('docsViewerTitle');
    if (!titleEl) return;

    const partesTitulo = [];
    if (showAdjuntos) partesTitulo.push('Adjuntos');
    if (showComentarios) partesTitulo.push('Comentarios');

    // Si partesTitulo queda vacío, join() devuelve '', así que usamos 'Documentación' por defecto
    titleEl.textContent = partesTitulo.join(' y ') || 'Documentación';

    await renderDocsViewerBody();

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }



  // =============================
  // Photo viewer
  // =============================
  function ensurePhotoViewer() {
    if (document.getElementById('photoViewerModal')) return;

    const modal = document.createElement('div');
    modal.id = 'photoViewerModal';
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.75);
      display:none; align-items:center; justify-content:center;
      z-index:9999; padding:18px;
    `;

    modal.innerHTML = `
      <div style="background:#111827; color:#fff; padding:10px 12px; border-radius:10px; max-width:92vw;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <strong>Foto socio</strong>
          <button id="photoViewerClose" style="border:0; border-radius:8px; padding:6px 10px; cursor:pointer;">✕ Cerrar</button>
        </div>
        <div style="margin-top:10px; display:flex; justify-content:center;">
          <img id="photoViewerImg" style="max-width:86vw; max-height:78vh; border-radius:10px; background:#fff;" alt="Foto"/>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.style.display = 'none';
      const img = document.getElementById('photoViewerImg');
      if (img) img.src = '';
    };

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });
    modal.querySelector('#photoViewerClose').addEventListener('click', close);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal.style.display === 'flex') close();
    });
  }

  function openPhotoViewer(url) {
    ensurePhotoViewer();
    const modal = document.getElementById('photoViewerModal');
    const img = document.getElementById('photoViewerImg');
    if (!modal || !img) return;
    img.src = url;
    modal.style.display = 'flex';
  }

  // =============================
  // Draft photo UI (solo modal socio)
  // =============================
  const draftPhotoInput = document.createElement('input');
  draftPhotoInput.type = 'file';
  draftPhotoInput.accept = 'image/*';
  draftPhotoInput.style.display = 'none';

  function ensureDraftPhotoUI() {
    if (!document.body.contains(draftPhotoInput)) document.body.appendChild(draftPhotoInput);

    const modal = document.getElementById('modalSocio');
    if (!modal) return;

    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) return;

    if (document.getElementById('socioDraftPhotoBox')) return;

    const box = document.createElement('div');
    box.id = 'socioDraftPhotoBox';
    box.style.cssText = `
      margin-top: 10px; padding: 10px;
      border: 1px dashed #ddd; border-radius: 10px; background: #fafafa;
    `;

    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <strong>Foto del socio</strong>
        <div style="display:flex; gap:8px;">
          <button id="btnSocioPickFoto" type="button">Elegir</button>
          <button id="btnSocioClearFoto" type="button">Quitar</button>
        </div>
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; align-items:center;">
        <img id="socioFotoDraftPreview" alt="Preview"
          style="width:70px; height:70px; border-radius:10px; object-fit:cover; display:none; border:1px solid #ddd; background:#fff; cursor:pointer;" />
        <div class="muted" id="socioFotoDraftMeta" style="font-size:12px;">Sin foto seleccionada.</div>
      </div>

      <div class="muted" style="font-size:12px; margin-top:8px;">
        La foto se sube al presionar <b>Guardar</b>.
      </div>
    `;

    const actions = modalContent.querySelector('.modal-actions.footer');

if (actions && actions.parentNode === modalContent) {
  modalContent.insertBefore(box, actions);
} else {
  modalContent.appendChild(box);
}


    box.querySelector('#btnSocioPickFoto').addEventListener('click', () => draftPhotoInput.click());
    box.querySelector('#btnSocioClearFoto').addEventListener('click', () => setDraftPhoto(null));

    box.querySelector('#socioFotoDraftPreview').addEventListener('click', () => {
      if (draftPhoto?.dataUrl) openPhotoViewer(draftPhoto.dataUrl);
    });

    draftPhotoInput.addEventListener('change', async () => {
      const file = draftPhotoInput.files && draftPhotoInput.files[0];
      draftPhotoInput.value = '';
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        alert('La imagen supera 2MB. Elegí una más liviana.');
        return;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Error leyendo archivo'));
        r.readAsDataURL(file);
      });

      const comma = dataUrl.indexOf(',');
      if (comma < 0) {
        alert('No se pudo leer la imagen.');
        return;
      }

      setDraftPhoto({
        dataUrl,
        base64: dataUrl.slice(comma + 1),
        mimetype: file.type || 'image/jpeg',
        filename: file.name || 'socio.jpg'
      });
    });
  }

  function setDraftPhoto(photo) {
    draftPhoto = photo;

    const img = document.getElementById('socioFotoDraftPreview');
    const meta = document.getElementById('socioFotoDraftMeta');
    if (!img || !meta) return;

    if (!draftPhoto) {
      img.style.display = 'none';
      img.src = '';
      meta.textContent = 'Sin foto seleccionada.';
      return;
    }

    img.src = draftPhoto.dataUrl;
    img.style.display = 'inline-block';
    meta.textContent = `${draftPhoto.filename} • ${draftPhoto.mimetype}`;
  }

  async function uploadSocioFotoById(socioId, photoPayload) {
    const clubId = getActiveClubId();
    const payload = {
      base64: photoPayload.base64,
      mimetype: photoPayload.mimetype,
      filename: photoPayload.filename || 'socio.jpg'
    };

    const res = await fetchAuth(`/club/${clubId}/socios/${socioId}/foto`, {
      method: 'POST',
      body: JSON.stringify(payload),
      json: true
    });

    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo subir la foto');
    return data;
  }

// =============================
// UI Excepción de cuota (modal socio)
// =============================
function setExcepcionUI(usa) {
  const chk = $('socioUsaExcepcion');
  const wrap = $('socioExcepcionWrap');
  const sel = $('socioExcepcionCuota');

  if (chk) chk.checked = !!usa;

  if (!wrap) return;

  if (usa) {
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
    if (sel) sel.value = '';
  }
}

  // =============================
  // Modal socio alta/edición
  // =============================
  // ✅ Vuelve siempre a la primera pestaña ("Datos personales") al abrir el
  // modal, sea socio nuevo o edición, para no dejarlo en la última pestaña
  // que se haya visto en el socio anterior.
  function resetSocioTabs() {
    const btns = document.querySelectorAll('.socio-tab-btn');
    const panels = document.querySelectorAll('.socio-tab-panel');
    if (!btns.length || !panels.length) return;
    btns.forEach((b, i) => b.classList.toggle('active', i === 0));
    panels.forEach((p, i) => { p.hidden = i !== 0; });
  }

  async function openModalNew() {
  editingId = null;
  setDraftPhoto(null);

resetGrupoFamiliarState();

  const chkJefe = $('socioEsJefePlanFamiliar');
  if (chkJefe) chkJefe.disabled = false;

  // asegurar combos cargados
  if (!categoriasConfigCache.length) loadCategoriasConfig().catch(() => {});
  if (!actividadesConfigCache.length) loadActividadesConfig().catch(() => {});
  if (!excepcionesCuotaCache.length) loadExcepcionesCuotaConfig().catch(() => {});

  $('modalSocioTitle').textContent = 'Nuevo socio';

  $('socioNumero').value = '';
  $('socioDni').value = '';
  $('socioNombre').value = '';
  $('socioApellido').value = '';

  $('socioActividad').value = '';
  $('socioCategoria').value = '';

  $('socioTelefono').value = '';
  $('socioDireccion').value = '';
$('socioEmail').value = '';


  $('socioNacimiento').value = '';
  $('socioIngreso').value = '';

  $('socioActivo').checked = true;
  $('socioBecado').checked = false;

  // menor/tutor
  $('socioMenor').checked = false;
  $('socioTutorNombre').value = '';
  toggleTutorField(false);

  // ✅ reset excepción SIEMPRE (evita “contagio”)
  $('socioUsaExcepcion').checked = false;
  $('socioExcepcionCuota').value = '';
  setExcepcionUI(false);

$('socioTieneAdicionales').checked = false;

const wrap = $('socioAdicionalesWrap');
if (wrap) {
  wrap.style.display = "none";
}

setActividadesAdicionalesSeleccionadas([]);

  // ✅ Plan de cuotas personalizado: solo tiene sentido con el socio ya guardado
  planCuotasSocioId = null;
  planCuotasPlanesSocio = [];
  const chkPlanCuotas = $('socioTienePlanCuotas');
  if (chkPlanCuotas) chkPlanCuotas.checked = false;
  const wrapPlanCuotas = $('socioPlanCuotasWrap');
  if (wrapPlanCuotas) wrapPlanCuotas.style.display = 'none';
  const btnPlanCuotas = $('btnConfigurarPlanCuotas');
  if (btnPlanCuotas) btnPlanCuotas.disabled = true;
  const estadoPlanCuotas = $('socioPlanCuotasEstado');
  if (estadoPlanCuotas) estadoPlanCuotas.textContent = 'Guardá el socio para poder configurar un plan.';

  // ✅ Plan de clases (paquete): solo tiene sentido con el socio ya guardado
  planClasesSocioId = null;
  planClasesPlanesSocio = [];
  const chkPlanClases = $('socioTienePlanClases');
  if (chkPlanClases) chkPlanClases.checked = false;
  const wrapPlanClases = $('socioPlanClasesWrap');
  if (wrapPlanClases) wrapPlanClases.style.display = 'none';
  const btnPlanClases = $('btnConfigurarPlanClases');
  if (btnPlanClases) btnPlanClases.disabled = true;
  const estadoPlanClases = $('socioPlanClasesEstado');
  if (estadoPlanClases) estadoPlanClases.textContent = 'Guardá el socio para poder configurar un paquete.';

  // ✅ Grupos "Excepciones" y "Planes": reset del check maestro y su wrap
  const chkExcepciones = $('socioTieneExcepciones');
  if (chkExcepciones) chkExcepciones.checked = false;
  const wrapExcepciones = $('socioExcepcionesGrupoWrap');
  if (wrapExcepciones) wrapExcepciones.style.display = 'none';

  const chkPlanes = $('socioTienePlanes');
  if (chkPlanes) chkPlanes.checked = false;
  const wrapPlanes = $('socioPlanesGrupoWrap');
  if (wrapPlanes) wrapPlanes.style.display = 'none';

  resetSocioTabs();
  $('modalSocio').classList.remove('hidden');
}


// ===== Menor + Tutor =====
function toggleTutorField(forceValue) {
  const chk = $('socioMenor');
  const wrap = $('socioTutorWrap');
  const inp = $('socioTutorNombre');
  if (!chk || !wrap || !inp) return;

  const on = (typeof forceValue === 'boolean') ? forceValue : chk.checked;
  chk.checked = on;

  if (on) {
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
    inp.value = '';
  }
}


  async function openModalEdit(socio) {
  editingId = socio.id;
  setDraftPhoto(null);

  resetGrupoFamiliarState();

  // ✅ reset excepción ANTES de cargar datos
  $('socioUsaExcepcion').checked = false;
  $('socioExcepcionCuota').value = '';
  setExcepcionUI(false);

  if (!categoriasConfigCache.length) loadCategoriasConfig().catch(() => {});
  if (!actividadesConfigCache.length) loadActividadesConfig().catch(() => {});
  if (!excepcionesCuotaCache.length) loadExcepcionesCuotaConfig().catch(() => {});

  $('modalSocioTitle').textContent = 'Editar socio';
  $('socioNumero').value = socio.numero_socio ?? '';
  $('socioDni').value = socio.dni ?? '';
  $('socioNombre').value = socio.nombre ?? '';
  $('socioApellido').value = socio.apellido ?? '';

  $('socioActividad').value = socio.actividad ?? '';
  ensureActividadOption(socio.actividad);

  $('socioDireccion').value = socio.direccion ?? '';
  $('socioEmail').value = socio.email ?? '';

  const catSel = $('socioCategoria');
  if (catSel) catSel.dataset.pendingValue = (socio.categoria ?? '').toString();
  $('socioCategoria').value = socio.categoria ?? '';
  ensureCategoriaOption(socio.categoria);

  $('socioTelefono').value = socio.telefono ?? '';
  $('socioNacimiento').value = (socio.fecha_nacimiento || '').slice(0, 10);
  $('socioIngreso').value = (socio.fecha_ingreso || '').slice(0, 10);
  $('socioActivo').checked = !!socio.activo;
  $('socioBecado').checked = !!socio.becado;

  $('socioMenor').checked = !!socio.es_menor;
  $('socioTutorNombre').value = socio.tutor_nombre ?? '';
  toggleTutorField(!!socio.es_menor);

  // ✅ precargar excepción del socio
  const exId = socio.excepcion_cuota_id ?? null;
  const exNombre = socio.excepcion_cuota_nombre ?? '';

  setExcepcionUI(!!exId);

  if (exId) {
    $('socioUsaExcepcion').checked = true;
    ensureExcepcionOption(exId, exNombre || 'Excepción asignada');
    $('socioExcepcionCuota').value = String(exId);
  }

await loadActividadesAdicionalesConfig();

let adicionales = [];
try {
  adicionales = socio.actividades_adicionales
    ? JSON.parse(socio.actividades_adicionales)
    : [];
} catch {
  adicionales = [];
}

$('socioTieneAdicionales').checked = adicionales.length > 0;

const wrapAdic = $('socioAdicionalesWrap');
if (wrapAdic) {
  wrapAdic.style.display = adicionales.length > 0 ? 'block' : 'none';
}

setActividadesAdicionalesSeleccionadas(adicionales);

  // =========================
  // GRUPO FAMILIAR
  // =========================
  const chkJefe = $('socioEsJefePlanFamiliar');
  const infoGF = $('socioPlanFamiliarInfo');

  grupoFamiliarOriginalEraJefe = socio.es_jefe_plan_familiar === true;

  if (chkJefe) {
    chkJefe.checked = socio.es_jefe_plan_familiar === true;
    chkJefe.disabled = false;
  }

  if (infoGF) {
    infoGF.textContent = 'Este socio puede pagar por todo el grupo familiar.';
    infoGF.style.display = 'none';
  }

  // Si el socio YA es miembro de otro grupo, no puede ser jefe
  if (socio.es_miembro_plan_familiar === true) {
    if (chkJefe) chkJefe.disabled = true;
    if (infoGF) {
      infoGF.textContent = 'Este socio ya pertenece al Grupo Familiar de otro jefe/a y no puede ser jefe/a.';
      infoGF.style.display = 'block';
    }
  }

  // Si el socio ya es jefe, traer integrantes actuales
  if (socio.es_jefe_plan_familiar === true) {
    try {
      const dataGF = await fetchGrupoFamiliar(socio.id);
      grupoFamiliarSeleccionados = (dataGF.miembros || []).map(x => String(x.id));
    } catch (e) {
      console.error('Error cargando miembros del grupo familiar', e);
      grupoFamiliarSeleccionados = [];
    }
  }

  syncGrupoFamiliarUI();
  renderGrupoFamiliarResumen();

  // ✅ Plan de cuotas personalizado: ya se puede configurar (el socio existe)
  planCuotasSocioId = socio.id;
  const btnPlanCuotas = $('btnConfigurarPlanCuotas');
  if (btnPlanCuotas) btnPlanCuotas.disabled = false;
  const estadoPlanCuotas = $('socioPlanCuotasEstado');
  if (estadoPlanCuotas) estadoPlanCuotas.textContent = 'Cargando...';

  const chkPlanCuotas = $('socioTienePlanCuotas');
  const wrapPlanCuotas = $('socioPlanCuotasWrap');

  await cargarPlanesActividadSocio().catch(() => {});

  // ✅ Si ya tiene algún plan cargado, el checkbox se tilda solo y se
  // muestra el botón directamente (no hace falta que el admin lo tilde).
  const tienePlan = planCuotasPlanesSocio.length > 0;
  if (chkPlanCuotas) chkPlanCuotas.checked = tienePlan;
  if (wrapPlanCuotas) wrapPlanCuotas.style.display = tienePlan ? 'block' : 'none';

  // ✅ Plan de clases (paquete): ya se puede configurar (el socio existe)
  planClasesSocioId = socio.id;
  const btnPlanClases = $('btnConfigurarPlanClases');
  if (btnPlanClases) btnPlanClases.disabled = false;
  const estadoPlanClases = $('socioPlanClasesEstado');
  if (estadoPlanClases) estadoPlanClases.textContent = 'Cargando...';

  const chkPlanClases = $('socioTienePlanClases');
  const wrapPlanClases = $('socioPlanClasesWrap');

  await cargarPlanesClasesSocio().catch(() => {});

  const tienePlanClases = planClasesPlanesSocio.length > 0;
  if (chkPlanClases) chkPlanClases.checked = tienePlanClases;
  if (wrapPlanClases) wrapPlanClases.style.display = tienePlanClases ? 'block' : 'none';

  // ✅ Grupos "Excepciones" y "Planes": el check maestro se tilda solo (y
  // el grupo se muestra) si el socio ya tiene algo configurado adentro,
  // igual que ya pasa con los checks individuales de plan de cuotas/clases.
  const tieneExcepciones =
    !!$('socioTieneAdicionales')?.checked ||
    !!$('socioUsaExcepcion')?.checked ||
    !!$('socioEsJefePlanFamiliar')?.checked;
  const chkExcepciones = $('socioTieneExcepciones');
  const wrapExcepciones = $('socioExcepcionesGrupoWrap');
  if (chkExcepciones) chkExcepciones.checked = tieneExcepciones;
  if (wrapExcepciones) wrapExcepciones.style.display = tieneExcepciones ? 'block' : 'none';

  const tienePlanes = tienePlan || tienePlanClases;
  const chkPlanes = $('socioTienePlanes');
  const wrapPlanes = $('socioPlanesGrupoWrap');
  if (chkPlanes) chkPlanes.checked = tienePlanes;
  if (wrapPlanes) wrapPlanes.style.display = tienePlanes ? 'block' : 'none';

  resetSocioTabs();
  $('modalSocio').classList.remove('hidden');
}

  function closeModalSocio() {
    $('modalSocio')?.classList.add('hidden');
  }

 
// =============================
// Carnet digital (doble click)
// =============================
let carnetSocioId = null;

function ensureCarnetModal() {
  // Usamos el modal que ya existe en socios.html
  const modal = document.getElementById('modalCarnet');
  if (!modal) return null;

  // Solo bindear una vez
  if (modal.dataset.bound === '1') return modal;
  modal.dataset.bound = '1';

  const btnClose = document.getElementById('btnCarnetClose');
  const btnOk    = document.getElementById('btnCarnetOk');
  const btnEdit  = document.getElementById('btnCarnetEdit');

  const handleClose = (ev) => {
    ev.preventDefault();
    closeCarnet();
  };

  // Cruz ✕
  if (btnClose) {
    btnClose.addEventListener('click', handleClose);
  }

  // Botón “Cerrar”
  if (btnOk) {
    btnOk.addEventListener('click', handleClose);
  }

  // Botón “Editar”
  if (btnEdit) {
    btnEdit.addEventListener('click', (ev) => {
      ev.preventDefault();
      const socio = sociosCache.find((x) => String(x.id) === String(carnetSocioId));
      if (socio) {
        closeCarnet();
        openModalEdit(socio);
      }
    });
  }

  // Cerrar haciendo click fuera del contenido
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) {
      closeCarnet();
    }
  });

  // Esc para cerrar
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeCarnet();
    }
  });

  return modal;
}

// IMPORTANTE: ajustar solo la primera línea de openCarnet
function openCarnet(socio) {
  const modal = ensureCarnetModal();
  if (!modal) return; // por si el HTML no está

  carnetSocioId = socio.id;


    const foto = socio.foto_url || '/img/user-placeholder.png';

    // CABECERA
    modal.querySelector('#carnetFoto').src = foto;
    modal.querySelector('#carnetNombre').textContent =
      `${socio.nombre ?? ''} ${socio.apellido ?? ''}`.trim();
    modal.querySelector('#carnetDni').textContent = `DNI: ${fmtDni(socio.dni)}`;
    modal.querySelector('#carnetCategoria').textContent =
      `Categoría: ${socio.categoria ?? '-'}`;

    const pago = pagoEstado(socio);
    modal.querySelector('#carnetPago').innerHTML =
      `<span class="pay-pill ${pago.ok ? 'pay-ok' : 'pay-bad'}">${escapeHtml(pago.label)}</span>`;

    // FICHA
    const extraEl = modal.querySelector('#carnetExtra');

    const ficha = [
      ['Estado de pago', pago.label],
      ['N° Socio', socio.numero_socio ?? '-'],
      ['Actividad', socio.actividad ?? '-'],
      ['Teléfono', socio.telefono ?? '-'],
      ['Dirección', socio.direccion ?? '-'],
      ['Nacimiento', fmtDMY(socio.fecha_nacimiento)],
      ['Año nacimiento', socio.anio_nacimiento ?? yearFromISO(socio.fecha_nacimiento)],
      ['Ingreso', fmtDMY(socio.fecha_ingreso)],
      ['Activo', socio.activo ? 'Sí' : 'No'],
      ['Becado', socio.becado ? 'Sí' : 'No']
    ];

    let html = '<div class="carnet-section">';
    ficha.forEach(([k, v]) => {
      html += `
        <div class="carnet-item">
          <span class="carnet-label">${escapeHtml(k)}:</span>
          <span class="carnet-value">${escapeHtml(v)}</span>
        </div>
      `;
    });
    html += '</div>';

    // DOCUMENTACIÓN (adjuntos/comentarios)
    const est = socioEstados[String(socio.id)] || {};
    const tieneAdj = est.tieneAdjuntos;
    const tieneCom = est.tieneComentario;

    if (tieneAdj || tieneCom) {
      html += `<hr><div class="carnet-label" style="margin-bottom:6px;">Documentación:</div>`;
      if (tieneAdj) html += `<div class="carnet-doc" data-doc="adjuntos">📎 Ver adjuntos</div>`;
      if (tieneCom) html += `<div class="carnet-doc" data-doc="comentarios">💬 Ver comentario</div>`;
    }

    extraEl.innerHTML = html;

    // Clicks en "Ver adjuntos / Ver comentario"
    extraEl.querySelectorAll('.carnet-doc').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tipo = btn.dataset.doc;
        if (tipo === 'adjuntos') {
          await openDocsViewer({
            socioId: socio.id,
            showAdjuntos: true,
            showComentarios: false
          });
        } else if (tipo === 'comentarios') {
          await openDocsViewer({
            socioId: socio.id,
            showAdjuntos: false,
            showComentarios: true
          });
        }
      });
    });

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeCarnet() {
    const modal = document.getElementById('modalCarnet');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  window.openCarnet = openCarnet;
  window.closeCarnet = closeCarnet;

  function fmtSocioNumero(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    return String(num).padStart(5, '0');
  }

  function getSortValue(s, key) {
    switch (key) {
      case 'pago': {
        return pagoEstado(s).label || '';
      }
      case 'numero':
        return Number(s.numero_socio ?? 0);
      case 'dni':
        return String(s.dni ?? '');
      case 'nombre':
        return String(s.nombre ?? '');
      case 'apellido':
        return String(s.apellido ?? '');
      case 'actividad':
        return String(s.actividad ?? '');
      case 'categoria':
        return String(s.categoria ?? '');
      case 'anio': {
        const y =
          s.anio_nacimiento ??
          (s.fecha_nacimiento ? Number(String(s.fecha_nacimiento).slice(0, 4)) : 0);
        return Number(y ?? 0);
      }
      case 'activo':
        return s.activo ? 1 : 0;
      case 'becado':
        return s.becado ? 1 : 0;
      default:
        return '';
    }
  }

  function sortRows(rows) {
    if (!sortKey) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;

    return rows.slice().sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);

      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      return (
        String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' }) * dir
      );
    });
  }

  function clampPage(p, totalPages) {
    if (totalPages <= 1) return 1;
    return Math.min(Math.max(1, p), totalPages);
  }

  function renderPagination(totalItems) {
    const el = document.getElementById('sociosPagination');
    if (!el) return;

    const totalPages = Math.max(1, Math.ceil(totalSociosCache / pageSize));
    currentPage = clampPage(currentPage, totalPages);

    const mkBtn = (label, page, active = false, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (active) b.classList.add('active');
      if (disabled) b.disabled = true;
      b.addEventListener('click', () => {
  currentPage = page;
  loadSocios(); // ✅ pide esa página al backend
});

      return b;
    };

    el.innerHTML = '';
    el.appendChild(mkBtn('‹', currentPage - 1, false, currentPage === 1));

    const windowSize = 7;
    let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) {
      el.appendChild(mkBtn(String(p), p, p === currentPage));
    }

    el.appendChild(mkBtn('›', currentPage + 1, false, currentPage === totalPages));
  }

  function updateSortIndicators() {
    document.querySelectorAll('th.sortable').forEach((th) => {
      const old = th.querySelector('.sort-ind');
      if (old) old.remove();

      const key = th.dataset.sort;
      if (!key || key !== sortKey) return;

      const ind = document.createElement('span');
      ind.className = 'sort-ind';
      ind.textContent = sortDir === 'asc' ? '▲' : '▼';
      th.appendChild(ind);
    });
  }

  function bindSorting() {
    const root = document.getElementById('socios-section');
    if (!root) return;

    const table = root.querySelector('table');
    if (!table) return;

    if (table.dataset.sortBound === '1') return;
    table.dataset.sortBound = '1';

    table.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (!key) return;

        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDir = 'asc';
        }

        
renderSocios(sociosCache);

      });
    });
  }

  // =============================
  // Render tabla
  // =============================

  function renderSocios(socios) {
    sociosCache = socios || [];
    const tbody = $('sociosTableBody');
    if (!tbody) return;

   const ordered = sortRows(sociosCache); // (opcional: esto ordena SOLO la página actual)
const pageRows = ordered;             // ✅ ya viene paginado desde el backend


    

    tbody.innerHTML = '';

    pageRows.forEach((s) => {
      const fotoUrl = s.foto_url || '/img/user-placeholder.png';
      const fotoHtml = `
        <img
          data-act="viewphoto"
          data-url="${escapeHtml(fotoUrl)}"
          src="${escapeHtml(fotoUrl)}"
          style="width:34px; height:34px; border-radius:10px; object-fit:cover; border:1px solid #ddd; background:#fff; cursor:pointer;"
          onerror="this.src='/img/user-placeholder.png'"
          alt="foto"
        />
      `;

      const waUrl = buildWaUrl(s.telefono);
      const telTxt = (s.telefono ?? '').toString();
      const iconosEstado = getEstadoIconosForSocio(s.id);
const nombreCompleto = formatNombreTabla(s);
const tr = document.createElement('tr');
      tr.dataset.id = s.id;

tr.innerHTML = `
  <td>${renderPagoPill(s)}</td>

  <td>${fmtSocioNumero(s.numero_socio)}</td>

  <td>${escapeHtml(fmtDni(s.dni))}</td>

  <td class="socio-nombre-completo" title="${escapeHtml(`${String(s.apellido ?? '').trim()}, ${String(s.nombre ?? '').trim()}`)}">
    ${escapeHtml(nombreCompleto)}
    ${s.es_jefe_plan_familiar ? ' 👑' : ''}
    ${s.es_miembro_plan_familiar ? ' 👨‍👩‍👧' : ''}
  </td>

  <td>${escapeHtml(s.actividad ?? '')}</td>

  <td>${escapeHtml(s.categoria ?? '')}</td>

  <td>
    <span class="wa-phone wa-action" data-phone="${escapeHtml(telTxt)}">
      ${escapeHtml(telTxt)}
    </span>
    ${
      waUrl
        ? `<a class="wa-link wa-action" href="${waUrl}" target="_blank" rel="noopener" title="WhatsApp Web">${WA_SVG}</a>`
        : ''
    }
  </td>

  <td>${s.anio_nacimiento ?? yearFromISO(s.fecha_nacimiento)}</td>

  <td>${fmtDMY(s.fecha_ingreso)}</td>

  <td>${s.activo ? 'Sí' : 'No'}</td>

  <td>${renderBoolBadge(!!s.becado)}</td>

  <td>${fotoHtml}</td>

  <td style="white-space:nowrap;">
    ${
      window.__clubRole !== 'profesor'
        ? `
          <button title="Editar" class="btn-ico" data-act="edit" data-id="${s.id}">✏️</button>
          <button title="Eliminar" class="btn-ico" data-act="del" data-id="${s.id}">🗑️</button>
          ${
            iconosEstado
              ? `<span class="socio-flags" title="Adjuntos / comentarios" style="margin-left:6px;">${iconosEstado}</span>`
              : ''
          }
        `
        : `
          ${
            iconosEstado
              ? `<span class="socio-flags" title="Adjuntos / comentarios" style="margin-left:6px;">${iconosEstado}</span>`
              : ''
          }
        `
    }
  </td>
`;


      tbody.appendChild(tr);
    });

   const countEl = $('sociosActivosCount');
if (countEl) { 
  countEl.textContent = `Socios activos: ${totalSociosCache}`; 
}


    updateSortIndicators();
  }

  // =============================
  // Filtros dropdown
  // =============================

  function refreshAnioOptions(socios) {
    const sel = $('filtroAnio');
    if (!sel) return;

    const current = sel.value;
    const years = [...new Set(
      (socios || [])
        .map((s) =>
          s.anio_nacimiento ||
          (s.fecha_nacimiento ? Number(String(s.fecha_nacimiento).slice(0, 4)) : null)
        )
        .filter(Boolean)
    )].sort((a, b) => b - a);

    sel.innerHTML = `<option value="">Todos los años</option>`;
    years.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      sel.appendChild(opt);
    });

    if (years.map(String).includes(current)) sel.value = current;
  }

  // =============================
  // Build query
  // =============================

  function buildQueryParams(page = 1) {
  const q = new URLSearchParams();
  const search = $('sociosSearch')?.value?.trim();
  const categoria = $('filtroCategoria')?.value;
  const actividad = $('filtroActividad')?.value;
  const anio = $('filtroAnio')?.value;
  const verInactivos = $('verInactivos')?.checked;

  if (search) q.set('search', search);
  if (categoria) q.set('categoria', categoria);
  if (actividad) q.set('actividad', actividad);
  if (anio) q.set('anio', anio);
  if (!verInactivos) q.set('activo', '1');

  // ✅ PAGINACIÓN REAL (backend)
  q.set('limit', String(pageSize));
  q.set('offset', String((page - 1) * pageSize));

  return q.toString();
}

async function loadSociosGrupoFamiliarCache() {
  const clubId = getActiveClubId();

  const res = await fetchAuth(`/club/${clubId}/socios?activo=1&limit=5000&offset=0`);
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    console.warn('No se pudieron cargar socios para Grupo Familiar:', data.error);
    sociosGrupoFamiliarCache = [];
    return;
  }

  sociosGrupoFamiliarCache = data.socios || [];
}


  async function loadSocios() {
    const clubId = getActiveClubId();
    const qs = buildQueryParams(currentPage);

    

    // socios + estados en paralelo
    const [resSocios, resEstados] = await Promise.all([
      fetchAuth(`/club/${clubId}/socios${qs ? `?${qs}` : ''}`),
      fetchAuth(`/club/${clubId}/socios/estados`).catch((e) => e)
    ]);

    const data = await safeJson(resSocios);
    if (!resSocios.ok || !data.ok) {
      alert(data.error || 'Error cargando socios');
      return;
    }

    if (resEstados && resEstados.ok) {
      const dataEstados = await safeJson(resEstados);
      if (dataEstados.ok && Array.isArray(dataEstados.estados)) {
        buildSocioEstadosMap(dataEstados.estados);
      } else {
        socioEstados = {};
      }
    } else {
      socioEstados = {};
    }

   // ⚠️ OJO: refreshAnioOptions con paginación real deja de ser confiable (ver nota más abajo)
refreshAnioOptions(data.socios ?? []);

totalSociosCache = data.total ?? 0;
const totalPages = Math.max(1, Math.ceil(totalSociosCache / pageSize));
if (currentPage > totalPages) currentPage = totalPages;
if (currentPage < 1) currentPage = 1;

renderSocios(data.socios ?? []);
renderPagination(totalSociosCache);
  }

  async function saveSocio() {
if (window.__clubPerms && !window.__clubPerms.canWrite('socios')) {
  alert('No tenés permisos para modificar socios');
  return;
}

    const clubId = getActiveClubId();

    const numeroRaw = $('socioNumero').value.trim();
    const payload = {
      numero_socio: numeroRaw ? Number(numeroRaw) : null,
      dni: $('socioDni').value.trim(),
      nombre: $('socioNombre').value.trim(),
      apellido: $('socioApellido').value.trim(),
es_menor: $('socioMenor').checked,
tutor_nombre: $('socioTutorNombre').value.trim() || null,
      categoria: $('socioCategoria').value.trim(),
      
actividad: $('socioActividad').value.trim(),
excepcion_cuota_id: $('socioUsaExcepcion')?.checked
  ? ($('socioExcepcionCuota')?.value || null)
  : null,

      
telefono: $('socioTelefono').value.trim() || null,
direccion: $('socioDireccion').value.trim() || null,
email: $('socioEmail').value.trim() || null,
fecha_nacimiento: $('socioNacimiento').value,

      fecha_ingreso: $('socioIngreso').value || null,
      activo: $('socioActivo').checked,
      becado: $('socioBecado').checked
    };

const adicionalesSeleccionadas = $('socioTieneAdicionales')?.checked
  ? Array.from(document.querySelectorAll('.chk-adicional:checked')).map(el => el.value)
  : [];

payload.tiene_actividades_adicionales = !!$('socioTieneAdicionales')?.checked;
payload.actividades_adicionales = JSON.stringify(adicionalesSeleccionadas);


    if (
      !payload.dni ||
      !payload.nombre ||
      !payload.apellido ||
      !payload.categoria ||
      !payload.actividad ||
      !payload.fecha_nacimiento
    ) {
      alert('Completá DNI, Nombre, Apellido, Categoría, Actividad y Fecha de nacimiento.');
      return;
    }

if ($('socioUsaExcepcion')?.checked && !payload.excepcion_cuota_id) {
  alert('Seleccioná una excepción de cuota.');
  return;
}

if (payload.es_menor && !payload.tutor_nombre) {
  alert('Si el socio es menor, completá el nombre del padre/madre/tutor.');
  return;
}

    const creating = !editingId;
    const url = creating ? `/club/${clubId}/socios` : `/club/${clubId}/socios/${editingId}`;
    const method = creating ? 'POST' : 'PUT';

    const btnSave = $('btnGuardarSocio');
    if (btnSave) btnSave.disabled = true;

    try {
      const res = await fetchAuth(url, { method, body: JSON.stringify(payload), json: true });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo guardar el socio');
        return;
      }

      const socioId = creating ? data.socio?.id || data.id : editingId;

      if (draftPhoto && socioId) {
        await uploadSocioFotoById(socioId, draftPhoto);
      }

      // =========================
      // GRUPO FAMILIAR
      // =========================
      const chkJefe = $('socioEsJefePlanFamiliar');
      const quiereSerJefe = chkJefe?.checked === true;

      if (quiereSerJefe && socioId) {
        await saveGrupoFamiliar(socioId, grupoFamiliarSeleccionados);
      }

      if (!quiereSerJefe && grupoFamiliarOriginalEraJefe && socioId) {
        await deleteGrupoFamiliar(socioId);
      }

      setDraftPhoto(null);
      closeModalSocio();
      await loadSocios();
      alert(creating ? '✅ Socio creado' : '✅ Socio actualizado');

    } catch (e) {
      console.error(e);
      alert(e.message || 'Error guardando socio');
    } finally {
      if (btnSave) btnSave.disabled = false;
    }
  }


  async function deleteSocio(id) {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/socios/${id}`, { method: 'DELETE' });
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      alert(data.error || 'No se pudo eliminar el socio');
      return;
    }
    await loadSocios();
  }

  async function exportSocios() {
    const clubId = getActiveClubId();

    try {
      const res = await fetch(`/club/${clubId}/socios/export.xlsx`, {
  headers: { Authorization: 'Bearer ' + getToken() }
});

      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('activeClubId');
        alert('Sesión inválida o expirada.');
        window.location.href = '/admin.html';
        return;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        alert('No se pudo exportar. ' + (txt || `HTTP ${res.status}`));
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `socios_${clubId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Error exportando CSV');
    }
  }

  // =============================
  // QUICK STATS (Impagos del mes / Pendientes)
  // =============================

  // Espera hasta `timeoutMs` a que exista un elemento en el DOM (útil porque
  // las secciones se cargan de forma asíncrona vía loadSection en app.js)
  function waitForElement(selector, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const start = Date.now();
      const interval = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(interval);
          resolve(el);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          resolve(null);
        }
      }, 100);
    });
  }

  async function loadImpagosMesActualCount() {
    const el = $('sociosImpagosMesCount');
    if (!el) return;

    try {
      const clubId = getActiveClubId();
      const now = new Date();
      const anio = now.getFullYear();
      const mesActual = now.getMonth() + 1;

      const res = await fetchAuth(`/club/${clubId}/reportes/impagos-mes?anio=${anio}`);
      const data = await safeJson(res);

      if (!data.ok) {
        el.textContent = 'Impagos del mes: –';
        return;
      }

      const rows = data.rows || [];
      const rowActual = rows.find((r) => Number(r.mes_num) === mesActual);
      const cantidad = rowActual ? Number(rowActual.cantidad) : 0;

      el.textContent = `Impagos del mes: ${cantidad}`;
    } catch (e) {
      console.warn('No se pudo cargar el conteo de impagos del mes:', e);
      el.textContent = 'Impagos del mes: –';
    }
  }

  async function loadPendientesCount() {
    const el = $('sociosPendientesCount');
    if (!el) return;

    try {
      const clubId = getActiveClubId();
      const res = await fetchAuth(`/club/${clubId}/pendientes`);
      const data = await safeJson(res);

      const cantidad = data.ok ? (data.items?.length ?? 0) : 0;
      el.textContent = `Solicitudes pendientes: ${cantidad}`;
    } catch (e) {
      console.warn('No se pudo cargar el conteo de solicitudes pendientes:', e);
      el.textContent = 'Solicitudes pendientes: –';
    }
  }

  async function refreshQuickStatsSocios() {
    await Promise.all([
      loadImpagosMesActualCount(),
      loadPendientesCount()
    ]);
  }

  // Botón "Socios activos" -> Reportes > vista Socios > tarjeta
  // "Socios por Actividad/Categoría"
  async function goToReporteSociosActividad() {
    const btnReportes = document.querySelector('[data-section="reportes"]');
    if (!btnReportes) {
      alert('No se encontró la sección de Reportes.');
      return;
    }
    btnReportes.click();

    const btnSwitchSocios = await waitForElement('#btnSwitchSocios');
    btnSwitchSocios?.click();

    const card = await waitForElement('#card-actividades');
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Botón "Impagos del mes" -> abre un popup propio con el listado de
  // socios impagos del mes en curso (sin salir de la sección Socios)

  // Filtro de Actividad/Categoría propio de este modal (se combinan con AND
  // si se eligen los dos) y mes/año que está mostrando actualmente.
  const impagosMesModalState = {
    anio: new Date().getFullYear(),
    mes: new Date().getMonth() + 1,
    actividad: '',
    categoria: '',
    page: 0,       // página actual (0 = primera)
    limit: 100     // tamaño de página (máx que acepta el backend)
  };

  // Llena los combos de Actividad/Categoría del modal reutilizando el cache
  // que ya usa el filtro de la tabla de Socios (o pidiéndolo si aún no está).
  async function cargarFiltrosModalImpagosMes() {
    if (!actividadesConfigCache.length) {
      try { await loadActividadesConfig(); } catch (_) {}
    }
    if (!categoriasToolbarCache.length) {
      try { await loadCategoriasToolbar(); } catch (_) {}
    }

    const selAct = $('modalImpagosMesFiltroActividad');
    if (selAct) {
      const actual = selAct.value;
      selAct.innerHTML = '<option value="">Todas</option>';
      actividadesConfigCache.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.nombre;
        opt.textContent = a.nombre;
        selAct.appendChild(opt);
      });
      selAct.value = actual || '';
    }

    const selCat = $('modalImpagosMesFiltroCategoria');
    if (selCat) {
      const actual = selCat.value;
      selCat.innerHTML = '<option value="">Todas</option>';
      categoriasToolbarCache.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.nombre;
        opt.textContent = c.nombre;
        selCat.appendChild(opt);
      });
      selCat.value = actual || '';
    }
  }

  function bindModalImpagosMesOnce() {
    const modal = $('modalImpagosMes');
    if (!modal || modal.dataset.bound === '1') return;
    modal.dataset.bound = '1';

    $('btnCloseModalImpagosMes')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) modal.classList.add('hidden');
    });

    $('modalImpagosMesFiltroActividad')?.addEventListener('change', (ev) => {
      impagosMesModalState.actividad = ev.target.value || '';
      impagosMesModalState.page = 0;
      cargarListadoImpagosMesModal();
    });

    $('modalImpagosMesFiltroCategoria')?.addEventListener('change', (ev) => {
      impagosMesModalState.categoria = ev.target.value || '';
      impagosMesModalState.page = 0;
      cargarListadoImpagosMesModal();
    });
  }

  // Dibuja los botones «Anterior / Siguiente» + "Página X de Y" en un
  // contenedor dado. Se usa tanto arriba como abajo del listado.
  function renderImpagosMesPagerInto(container, { page, totalPages, total }) {
    if (!container) return;
    container.innerHTML = '';
    if (totalPages <= 1) return; // 1 sola página -> no hace falta paginar

    const btnPrev = document.createElement('button');
    btnPrev.type = 'button';
    btnPrev.textContent = '‹ Anterior';
    btnPrev.disabled = page <= 0;
    btnPrev.addEventListener('click', () => {
      if (impagosMesModalState.page <= 0) return;
      impagosMesModalState.page -= 1;
      cargarListadoImpagosMesModal();
    });

    const info = document.createElement('span');
    info.className = 'impagos-mes-pager-info';
    info.textContent = `Página ${page + 1} de ${totalPages} · ${total} socios impagos`;

    const btnNext = document.createElement('button');
    btnNext.type = 'button';
    btnNext.textContent = 'Siguiente ›';
    btnNext.disabled = page >= totalPages - 1;
    btnNext.addEventListener('click', () => {
      if (impagosMesModalState.page >= totalPages - 1) return;
      impagosMesModalState.page += 1;
      cargarListadoImpagosMesModal();
    });

    container.appendChild(btnPrev);
    container.appendChild(info);
    container.appendChild(btnNext);
  }

  function renderImpagosMesPager(state) {
    renderImpagosMesPagerInto($('modalImpagosMesPagerTop'), state);
    renderImpagosMesPagerInto($('modalImpagosMesPagerBottom'), state);
  }

  // Trae y renderiza el listado de socios impagos según el mes/año y el
  // filtro de Actividad/Categoría actuales del modal.
  async function cargarListadoImpagosMesModal() {
    const body = $('modalImpagosMesBody');
    if (!body) return;

    body.innerHTML = '<div class="muted small">Cargando socios impagos…</div>';

    try {
      const clubId = getActiveClubId();
      const limit = impagosMesModalState.limit;
      const offset = impagosMesModalState.page * limit;
      const params = new URLSearchParams({
        anio: String(impagosMesModalState.anio),
        mes: String(impagosMesModalState.mes),
        limit: String(limit),
        offset: String(offset)
      });
      if (impagosMesModalState.actividad) params.set('actividad', impagosMesModalState.actividad);
      if (impagosMesModalState.categoria) params.set('categoria', impagosMesModalState.categoria);

      const res = await fetchAuth(`/club/${clubId}/reportes/impagos-mes/detalle?${params.toString()}`);
      const data = await safeJson(res);

      if (!data.ok) {
        body.innerHTML = `<div class="muted" style="color:#b91c1c;">${data.error || 'Error cargando socios impagos'}</div>`;
        $('modalImpagosMesPagerTop').innerHTML = '';
        $('modalImpagosMesPagerBottom').innerHTML = '';
        return;
      }

      const items = data.items || [];
      const total = Number(data.total || items.length);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      // Si al cambiar de filtro la página actual quedó fuera de rango
      // (por ejemplo, había página 2 y el nuevo filtro solo tiene 1 página),
      // volvemos a pedir la última página válida.
      if (items.length === 0 && total > 0 && impagosMesModalState.page > 0) {
        impagosMesModalState.page = totalPages - 1;
        await cargarListadoImpagosMesModal();
        return;
      }

      if (!items.length) {
        body.innerHTML = '<div class="muted">No hay socios impagos con este filtro.</div>';
        $('modalImpagosMesPagerTop').innerHTML = '';
        $('modalImpagosMesPagerBottom').innerHTML = '';
        return;
      }

      body.innerHTML = `
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
            ${items.map((s) => `
              <tr>
                <td>${s.numero_socio ?? ''}</td>
                <td>${s.dni ?? ''}</td>
                <td>${s.apellido ?? ''}</td>
                <td>${s.nombre ?? ''}</td>
                <td>${s.actividad ?? ''}</td>
                <td>${s.categoria ?? ''}</td>
                <td>${s.telefono ?? ''}</td>
                <td>${s.fecha_ingreso ? String(s.fecha_ingreso).substring(0, 10) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      renderImpagosMesPager({ page: impagosMesModalState.page, totalPages, total });
    } catch (e) {
      console.warn('Error abriendo listado de impagos del mes:', e);
      body.innerHTML = '<div class="muted" style="color:#b91c1c;">Error inesperado cargando el listado.</div>';
    }
  }

  async function openImpagosMesModal() {
    const modal = $('modalImpagosMes');
    const body = $('modalImpagosMesBody');
    const title = $('modalImpagosMesTitle');
    const sub = $('modalImpagosMesSub');
    if (!modal || !body) return;

    bindModalImpagosMesOnce();

    const now = new Date();
    impagosMesModalState.anio = now.getFullYear();
    impagosMesModalState.mes = now.getMonth() + 1;
    impagosMesModalState.page = 0;
    // El filtro de Actividad/Categoría se mantiene entre aperturas del modal
    // (no se resetea), para no perder la selección del admin.

    const nombresMes = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    if (title) title.textContent = 'Impagos del mes';
    if (sub) sub.textContent = `${nombresMes[impagosMesModalState.mes - 1]} ${impagosMesModalState.anio} · socios activos sin registro de pago`;
    modal.classList.remove('hidden');

    await cargarFiltrosModalImpagosMes();
    await cargarListadoImpagosMesModal();
  }

// Botón "Solicitudes Pendientes" -> solapa Pendientes
  function goToPendientes() {
    const btnPendientes = document.querySelector('[data-section="pendientes"]');
    if (!btnPendientes) {
      alert('No se encontró la sección de Pendientes.');
      return;
    }
    btnPendientes.click();
  }

  // =============================
  // BIENVENIDA POR EMAIL
  // =============================

  async function loadBienvenidaPendientes() {
    const clubId = getActiveClubId();
    const cont = $('bienvenidaLista');
    if (cont) {
      cont.innerHTML = '<div class="muted small" style="padding:12px;">Cargando socios pendientes…</div>';
    }

    const res = await fetchAuth(`/club/${clubId}/socios/bienvenida/pendientes`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      if (cont) {
        cont.innerHTML = `<div class="muted small" style="padding:12px;">${escapeHtml(data.error || 'Error cargando socios pendientes')}</div>`;
      }
      bienvenidaPendientesCache = [];
      return;
    }

    bienvenidaPendientesCache = data.socios || [];
    renderBienvenidaLista();
  }

  function renderBienvenidaLista() {
    const cont = $('bienvenidaLista');
    if (!cont) return;

    if (!bienvenidaPendientesCache.length) {
      cont.innerHTML = '<div class="muted small" style="padding:12px;">No hay socios pendientes de recibir la bienvenida. 🎉</div>';
      updateBienvenidaContador();
      return;
    }

    cont.innerHTML = bienvenidaPendientesCache.map((s) => `
      <label style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-bottom:1px solid #eee;">
        <input type="checkbox" class="chk-bienvenida-socio" value="${escapeHtml(s.id)}">
        <span style="flex:1;">
          <b>${escapeHtml(s.apellido ?? '')}, ${escapeHtml(s.nombre ?? '')}</b>
          <span class="muted small"> — N° ${escapeHtml(String(s.numero_socio ?? ''))}</span>
        </span>
        <span class="muted small">${s.email ? escapeHtml(s.email) : 'Sin email ⚠️'}</span>
      </label>
    `).join('');

    updateBienvenidaContador();
  }

  function updateBienvenidaContador() {
    const el = $('bienvenidaCantidadSeleccionados');
    if (!el) return;
    const total = document.querySelectorAll('.chk-bienvenida-socio').length;
    const marcados = document.querySelectorAll('.chk-bienvenida-socio:checked').length;
    el.textContent = total ? `${marcados} de ${total} seleccionados` : '';
  }

  async function openModalBienvenida() {
    const modal = $('modalBienvenida');
    if (!modal) return;

    const chkTodos = $('chkBienvenidaSeleccionarTodos');
    if (chkTodos) chkTodos.checked = false;

    const resultado = $('bienvenidaResultado');
    if (resultado) resultado.innerHTML = '';

    modal.classList.remove('hidden');
    await loadBienvenidaPendientes();
  }

  function closeModalBienvenida() {
    $('modalBienvenida')?.classList.add('hidden');
  }

  async function enviarBienvenidaSeleccionados() {
    if (window.__clubPerms && !window.__clubPerms.canWrite('socios')) {
      alert('No tenés permisos para enviar bienvenidas');
      return;
    }

    const seleccionados = Array.from(document.querySelectorAll('.chk-bienvenida-socio:checked'))
      .map((el) => el.value);

    if (!seleccionados.length) {
      alert('Seleccioná al menos un socio.');
      return;
    }

    const clubId = getActiveClubId();
    const btn = $('btnBienvenidaEnviar');
    const resultado = $('bienvenidaResultado');

    if (btn) { btn.disabled = true; btn.textContent = 'Programando...'; }

    try {
      const res = await fetchAuth(`/club/${clubId}/socios/bienvenida/enviar`, {
        method: 'POST',
        json: true,
        body: JSON.stringify({ socioIds: seleccionados })
      });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo programar la bienvenida');
        return;
      }

      if (resultado) {
        if (!data.programados) {
          resultado.innerHTML = `<div class="muted small">${escapeHtml(data.mensaje || 'No había socios nuevos para programar.')}</div>`;
        } else {
          const txt = data.lotes > 1
            ? `📩 Se programaron ${data.programados} envíos en ${data.lotes} tandas (una cada ${data.intervaloMinutos} minutos aprox). La primera tanda sale en los próximos minutos.`
            : `📩 Se programaron ${data.programados} envíos, salen en los próximos minutos.`;
          resultado.innerHTML = `<div class="muted small">${txt}</div>`;
        }
      }

      await loadBienvenidaPendientes();
      await loadSocios();
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error enviando bienvenida');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar bienvenida'; }
    }
  }

  // =============================
  // Bind events
  // =============================
  function bindOnce() {
    const root =
      document.querySelector('.section-socios') || document.getElementById('socios-section');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    ensurePhotoViewer();
    ensureDraftPhotoUI();
    bindSorting();

    // ✅ Pestañas del modal "Editar/Nuevo socio" (Datos personales / Actividad
    // y planes / Adjuntos y comentarios). Un solo listener delegado, se arma
    // una sola vez porque bindOnce() ya está guardado con root.dataset.bound.
    document.querySelectorAll('.socio-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.socio-tab-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        document.querySelectorAll('.socio-tab-panel').forEach((panel) => {
          panel.hidden = panel.dataset.tabPanel !== tab;
        });
      });
    });

    $('btnStatSociosActivos')?.addEventListener('click', goToReporteSociosActividad);
    $('btnStatImpagosMes')?.addEventListener('click', openImpagosMesModal);
    $('btnStatPendientes')?.addEventListener('click', goToPendientes);

$('filtroActividad')?.addEventListener('change', loadSocios);

    // ✅ NUEVO: el campo DNI no admite puntos (ni ningún otro carácter que no
    // sea número) — se limpia a medida que se escribe o se pega, tanto al
    // cargar un socio nuevo como al editar uno existente (mismo input).
    $('socioDni')?.addEventListener('input', (e) => {
      const limpio = onlyDigits(e.target.value);
      if (e.target.value !== limpio) e.target.value = limpio;
    });

    $('btnNuevoSocio')?.addEventListener('click', openModalNew);
    if (window.__clubRole === 'profesor') {
  const btn = $('btnNuevoSocio');
  if (btn) btn.style.display = 'none';
  const btnBienvenida = $('btnEnviarBienvenida');
  if (btnBienvenida) btnBienvenida.style.display = 'none';
}

    // ✅ NUEVO: Enviar bienvenida por email
    $('btnEnviarBienvenida')?.addEventListener('click', openModalBienvenida);
    $('btnBienvenidaClose')?.addEventListener('click', closeModalBienvenida);
    $('btnBienvenidaCancelar')?.addEventListener('click', closeModalBienvenida);
    $('btnBienvenidaEnviar')?.addEventListener('click', enviarBienvenidaSeleccionados);

    $('chkBienvenidaSeleccionarTodos')?.addEventListener('change', (e) => {
      document.querySelectorAll('.chk-bienvenida-socio').forEach((chk) => {
        chk.checked = e.target.checked;
      });
      updateBienvenidaContador();
    });

    $('bienvenidaLista')?.addEventListener('change', (e) => {
      if (e.target.classList.contains('chk-bienvenida-socio')) {
        updateBienvenidaContador();
      }
    });

    $('modalBienvenida')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalBienvenida') closeModalBienvenida();
    });

    $('btnCancelarSocio')?.addEventListener('click', closeModalSocio);
    $('btnGuardarSocio')?.addEventListener('click', saveSocio);
    $('socioMenor')?.addEventListener('change', () => toggleTutorField());
$('socioUsaExcepcion')?.addEventListener('change', () => {
  setExcepcionUI($('socioUsaExcepcion').checked);
});

// ✅ Grupo "Excepciones" (adicionales + excepción de cuota + jefe/a plan
// familiar): el check maestro solo muestra/oculta el grupo. Los checks de
// adentro siguen funcionando exactamente igual que antes.
$('socioTieneExcepciones')?.addEventListener('change', function () {
  const wrap = $('socioExcepcionesGrupoWrap');
  if (wrap) wrap.style.display = this.checked ? 'block' : 'none';
});

// ✅ Grupo "Planes" (plan de cuotas + plan de clases): idem, solo
// muestra/oculta.
$('socioTienePlanes')?.addEventListener('change', function () {
  const wrap = $('socioPlanesGrupoWrap');
  if (wrap) wrap.style.display = this.checked ? 'block' : 'none';
});

$('socioTieneAdicionales')?.addEventListener('change', async function () {
  const wrap = $('socioAdicionalesWrap');
  if (!wrap) return;

  if (this.checked) {
    await loadActividadesAdicionalesConfig();
    wrap.style.display = 'block';
  } else {
    wrap.style.display = 'none';
    setActividadesAdicionalesSeleccionadas([]);
  }
});

$('socioEsJefePlanFamiliar')?.addEventListener('change', () => {
  syncGrupoFamiliarUI();
});

$('btnSeleccionarGrupoFamiliar')?.addEventListener('click', async () => {
  const chk = $('socioEsJefePlanFamiliar');
  if (!chk?.checked) return;
  await openGrupoFamiliarModal();
});

$('btnGrupoFamiliarClose')?.addEventListener('click', closeGrupoFamiliarModal);
$('btnGrupoFamiliarCancel')?.addEventListener('click', closeGrupoFamiliarModal);

// ✅ Plan de cuotas personalizado
$('socioTienePlanCuotas')?.addEventListener('change', function () {
  const wrap = $('socioPlanCuotasWrap');
  if (wrap) wrap.style.display = this.checked ? 'block' : 'none';
});

$('btnConfigurarPlanCuotas')?.addEventListener('click', abrirModalPlanCuotas);
$('btnPlanCuotasClose')?.addEventListener('click', cerrarModalPlanCuotas);
$('btnPlanCuotasCancelar')?.addEventListener('click', cerrarModalPlanCuotas);
$('planCuotasActividad')?.addEventListener('change', onPlanCuotasActividadChange);
$('btnGenerarCuotasSugeridas')?.addEventListener('click', generarCuotasSugeridasUI);
$('btnAgregarCuotaManual')?.addEventListener('click', agregarCuotaManualUI);
$('btnGuardarPlanCuotas')?.addEventListener('click', guardarPlanCuotasUI);
$('btnEliminarPlanCuotas')?.addEventListener('click', eliminarPlanCuotasUI);

// ✅ Plan de clases (paquete)
$('socioTienePlanClases')?.addEventListener('change', function () {
  const wrap = $('socioPlanClasesWrap');
  if (wrap) wrap.style.display = this.checked ? 'block' : 'none';
});

$('btnConfigurarPlanClases')?.addEventListener('click', abrirModalPlanClases);
$('btnPlanClasesClose')?.addEventListener('click', cerrarModalPlanClases);
$('btnPlanClasesCancelar')?.addEventListener('click', cerrarModalPlanClases);
$('planClasesActividad')?.addEventListener('change', onPlanClasesActividadChange);
$('btnGuardarPaqueteClases')?.addEventListener('click', guardarPaqueteClasesUI);
$('btnNuevoPaqueteClases')?.addEventListener('click', nuevoPaqueteClasesUI);
$('btnEliminarPlanClases')?.addEventListener('click', eliminarPlanClasesUI);
$('btnRegistrarClaseTomada')?.addEventListener('click', registrarClaseTomadaUI);
$('planClasesMonto')?.addEventListener('input', actualizarSaldoPlanClases);

$('grupoFamiliarSearch')?.addEventListener('input', (e) => {
  renderGrupoFamiliarLista(e.target.value);
});


$('btnGrupoFamiliarAceptar')?.addEventListener('click', async () => {
  grupoFamiliarSeleccionados = grupoFamiliarSeleccionadosDraft.map(x => String(x));
  renderGrupoFamiliarResumen();
  closeGrupoFamiliarModal();

  // 🔥 Guardado automático si ya existe el socio
  if (editingId && $('socioEsJefePlanFamiliar')?.checked) {
    try {
      await saveGrupoFamiliar(editingId, grupoFamiliarSeleccionados);
      console.log('✅ Grupo familiar guardado automáticamente');
    } catch (e) {
      console.error('Error guardando grupo familiar', e);
      // ✅ NUEVO: mostrar el motivo real que manda el backend (por ejemplo
      // "Ya pertenece a otro Grupo Familiar activo: ...") en vez de un
      // mensaje genérico que no explica qué pasó.
      alert(e.message || 'Error guardando grupo familiar');
    }
  }
});


    $('btnBuscarSocios')?.addEventListener('click', loadSocios);

    const debouncedLoadSocios = debounce(() => { currentPage = 1; loadSocios(); }, 250);
$('sociosSearch')?.addEventListener('input', debouncedLoadSocios);


    $('btnExportSocios')?.addEventListener('click', exportSocios);

    $('socioActividad').value = '';
    $('socioDireccion').value = '';

    $('sociosSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSocios();
    });

    $('filtroCategoria')?.addEventListener('change', () => { currentPage = 1; loadSocios(); });
    $('filtroAnio')?.addEventListener('change', loadSocios);
    $('verInactivos')?.addEventListener('change', loadSocios);

   // SUBIR ADJUNTO (solo archivo, sin comentario)
$('btnSubirAdjunto')?.addEventListener('click', async () => {
  if (!editingId) {
    alert('Primero guardá el socio antes de adjuntar archivos.');
    return;
  }

  const clubId = getActiveClubId();
  const fileInput = $('adjuntoFile');
  const file = fileInput?.files?.[0];

  if (!file) {
    alert('Seleccioná un archivo.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('El archivo supera los 10MB.');
    return;
  }

  const fd = new FormData();
  fd.append('file', file);

  const btn = $('btnSubirAdjunto');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Subiendo...';
  }

  try {
    const res = await fetchAuth(`/club/${clubId}/socios/${editingId}/adjuntos`, {
      method: 'POST',
      body: fd
    });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      alert(data.error || 'Error subiendo adjunto');
      return;
    }

    // limpiamos solo el archivo
    fileInput.value = '';
    await cargarAdjuntosEnModal(editingId);
    // refrescamos estados para el clip 📎
    await loadSocioEstadosFromBackend().catch(() => {});
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📎 Subir adjunto';
    }
  }
});


// SUBIR COMENTARIO (sin archivo)
$('btnSubirComentario')?.addEventListener('click', async () => {
  if (!editingId) {
    alert('Primero guardá el socio antes de agregar comentarios.');
    return;
  }

  const txtArea = $('nuevoComentario');
  const texto = txtArea?.value?.trim();
  if (!texto) {
    alert('Escribí un comentario.');
    return;
  }

  const clubId = getActiveClubId();

  const btn = $('btnSubirComentario');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Subiendo...';
  }

  try {
    const res = await fetchAuth(`/club/${clubId}/socios/${editingId}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ comentario: texto }),
      json: true
    });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      alert(data.error || 'Error guardando comentario');
      return;
    }

    // limpio textarea y recargo histórico
    if (txtArea) txtArea.value = '';
    await cargarComentariosEnModal(editingId);
    await loadSocioEstadosFromBackend().catch(() => {});
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💬 Subir comentario';
    }
  }
});


// CLICK en tabla: foto / editar / eliminar / WhatsApp / flags
$('sociosTableBody')?.addEventListener('click', async (ev) => {
  // Ver foto grande
  const img = ev.target.closest('[data-act="viewphoto"]');
  if (img) {
    const url = img.dataset.url;
    if (url) openPhotoViewer(url);
    return;
  }

  // Click en WhatsApp (no seguir con otras acciones)
  if (ev.target.closest('.wa-action')) {
    return;
  }

  // Click en iconos de adjuntos/comentarios (📎 / 💬)
  const flagsEl = ev.target.closest('.socio-flags');
  if (flagsEl) {
    const tr = flagsEl.closest('tr');
    const id = tr?.dataset.id;
    if (!id) return;

    const socio = sociosCache.find((x) => String(x.id) === String(id));
    if (!socio) return;

    const texto = flagsEl.textContent || '';
    const showAdj = texto.includes('📎');
    const showCom = texto.includes('💬');

    await openDocsViewer({
      socioId: socio.id,
      showAdjuntos: showAdj,
      showComentarios: showCom
    });

    return;
  }

  // Botones Editar / Eliminar
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;

  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (!id) return;

  if (act === 'edit') {
    if (window.__clubPerms && !window.__clubPerms.canWrite('socios')) {
      alert('No tenés permisos para editar socios');
      return;
    }

    const socio = sociosCache.find((x) => String(x.id) === String(id));
    if (socio) {
      await openModalEdit(socio);
    }
    return;
  }

  if (act === 'del') {
    if (window.__clubPerms && !window.__clubPerms.canWrite('socios')) {
      alert('No tenés permisos para eliminar socios');
      return;
    }

if (confirm('¿Eliminar socio? Se borrará de forma PERMANENTE junto con todo su historial (asistencias, pagos, adjuntos, comentarios, etc.). Esta acción no se puede deshacer.')) {
  await deleteSocio(id);
}
    return;
  }
});



    // DOBLE CLICK WhatsApp – abrir WA
    $('sociosTableBody')?.addEventListener('dblclick', (ev) => {
      const waTarget = ev.target.closest('.wa-action');
      if (!waTarget) return;

      if (waTarget.tagName === 'A' && waTarget.href) {
        window.open(waTarget.href, '_blank', 'noopener');
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      const span = ev.target.closest('.wa-phone');
      if (span) {
        const phone = span.dataset.phone;
        const url = buildWaUrl(phone);
        if (url) window.open(url, '_blank', 'noopener');
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    });

    // Carga masiva: plantilla / subir Excel
    $('btnSociosTemplate')?.addEventListener('click', async () => {
      const clubId = getActiveClubId();
      const url = `/club/${clubId}/socios/template.xlsx`;

      const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + getToken() }
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        alert('No se pudo descargar la plantilla. ' + t);
        return;
      }

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `socios_${clubId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    });

    $('btnSociosBulkUpload')?.addEventListener('click', () => {
      const inp = $('inputSociosBulk');
      if (!inp) return;
      inp.value = '';
      inp.click();
    });

    $('inputSociosBulk')?.addEventListener('change', async () => {
      const inp = $('inputSociosBulk');
      const file = inp?.files?.[0];
      if (!file) return;

      const clubId = getActiveClubId();
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(`/club/${clubId}/socios/import.xlsx`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + getToken() },
        body: fd
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, error: text };
      }

      if (!res.ok || !data.ok) {
        alert(data.error || 'Error en carga masiva');
        return;
      }

      await loadSocios();
      showBulkLog(data);
    });

    function showBulkLog(data) {
      const modal = document.getElementById('modalBulkLog');
      const body = document.getElementById('bulkLogBody');
      if (!modal || !body) {
  const ok = Number(data.insertedCount || 0);
  const err = Number(data.errorCount || 0);
  if (err === 0) {
    alert(`✅ Carga masiva OK. Insertados: ${ok}.`);
  } else {
    const first = (data.errors || []).slice(0, 5)
      .map(e => `• DNI ${e.dni || '-'} (fila ${e.row || '-'}) - ${e.error || ''}`)
      .join('\n');
    alert(`⚠️ Carga masiva con errores.\nInsertados: ${ok}\nErrores: ${err}\n\nPrimeros errores:\n${first}`);
  }
  return;
}


      const ok = Number(data.insertedCount || 0);
      const err = Number(data.errorCount || 0);

      let html = `
        <div style="padding:10px; border-radius:10px; background:#f9fafb; border:1px solid #e5e7eb;">
          <b>Insertados:</b> ${ok} &nbsp;&nbsp; <b>Errores:</b> ${err}
        </div>
      `;
      const rows = data.errors || [];
      if (!rows.length) {
  html += `
    <div style="margin-top:10px; padding:10px; border-radius:10px;
                background:#ecfdf5; border:1px solid #10b981; color:#065f46;">
      ✅ <b>Todo subió OK.</b> No se detectaron errores.
    </div>
  `;
} else {
  html += `
    <div style="margin-top:10px; padding:10px; border-radius:10px;
                background:#fffbeb; border:1px solid #f59e0b; color:#92400e;">
      ⚠️ <b>Algunos socios no se pudieron subir.</b> Revisá el detalle:
    </div>
  `;
  html += `
    <div style="margin-top:10px;">
      <table class="socios-table" style="background:#fff;">
        <thead>
          <tr>
            <th>Fila</th>
            <th>DNI</th>
            <th>N° socio</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${r.row ?? '-'}</td>
              <td>${r.dni ?? '-'}</td>
              <td>${r.numero_socio ?? '-'}</td>
              <td>${r.error ?? '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

      body.innerHTML = html;
      modal.classList.remove('hidden');

      const close = () => modal.classList.add('hidden');
      document.getElementById('btnBulkLogClose')?.addEventListener('click', close);
      document.getElementById('btnBulkLogOk')?.addEventListener('click', close);
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) close();
      });
    }

    // Doble click fila -> abrir Carnet
// Doble click en ícono de pago -> abrir formulario de pago para ese socio
root.addEventListener('dblclick', (ev) => {
  const payIcon = ev.target.closest('.pay-pill[data-act="open-payment"]');

  if (payIcon) {
    ev.preventDefault();
    ev.stopPropagation();

    const socioId = payIcon.dataset.socioId;
    if (!socioId) return;

    // Guardamos el socio para que Pagos lo tome al cargar
    localStorage.setItem('pendingOpenPagoSocioId', String(socioId));

    // Cambiamos a la sección Pagos usando el botón del menú
    const btnPagos = document.querySelector('[data-section="pagos"]');

    if (btnPagos) {
      btnPagos.click();
    } else {
      alert('No se encontró la sección Pagos.');
    }

    return;
  }

  if (ev.target.closest('.wa-action')) return;
  if (ev.target.closest('button[data-act]')) return;

  const tr = ev.target.closest('#sociosTableBody tr');
  if (!tr || !tr.dataset.id) return;

  const socio = sociosCache.find((x) => String(x.id) === String(tr.dataset.id));
  if (socio) window.openCarnet(socio);
});

    $('modalSocio')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalSocio') closeModalSocio();
    });
  }

  async function initSociosSection() {
  bindOnce();
  await loadCategoriasConfig().catch(() => {});
  await loadActividadesConfig().catch(() => {});
  await loadExcepcionesCuotaConfig().catch(() => {});
  await loadSociosGrupoFamiliarCache().catch(() => {});
  await loadSocios();
  await refreshQuickStatsSocios().catch(() => {});
}

  window.initSociosSection = initSociosSection;


  
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.section-socios') || $('sociosTableBody')) {
      initSociosSection();
    }
  });
})();