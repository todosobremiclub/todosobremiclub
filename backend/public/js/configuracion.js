// helpers DOM
const $ = (id) => document.getElementById(id);

const MESES = [
  { n: 1, nombre: 'Enero' },
  { n: 2, nombre: 'Febrero' },
  { n: 3, nombre: 'Marzo' },
  { n: 4, nombre: 'Abril' },
  { n: 5, nombre: 'Mayo' },
  { n: 6, nombre: 'Junio' },
  { n: 7, nombre: 'Julio' },
  { n: 8, nombre: 'Agosto' },
  { n: 9, nombre: 'Septiembre' },
  { n: 10, nombre: 'Octubre' },
  { n: 11, nombre: 'Noviembre' },
  { n: 12, nombre: 'Diciembre' }
];

/* ===============================
   Helpers auth (JWT token)
================================ */

function getToken() {
  const t = localStorage.getItem('token');
  if (!t) {
    alert('Tu sesión expiró. Iniciá sesión nuevamente.');
    window.location.href = '/admin.html';
    throw new Error('No token');
  }
  return t;
}

async function fetchJsonAuth(url, options = {}) {
  const headers = options.headers ?? {};
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

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text };
  }
  return { res, data };
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

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('activeClubId');
    alert('Sesión inválida o expirada.');
    window.location.href = '/admin.html';
    throw new Error('401');
  }
  return res;
}

function formatARS(value) {
  const n = Number(value ?? 0);
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ============================================================
   CUOTAS
============================================================ */

async function loadCuotas() {
  const clubId = getActiveClubId();
  const res = await fetchAuth(`/club/${clubId}/config/cuotas`);
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    alert(data.error ?? 'Error cargando cuotas');
    return;
  }

  const map = new Map();
  (data.cuotas ?? []).forEach(c => map.set(Number(c.mes), c.monto));
  renderCuotas(map);
}

function renderCuotas(map) {
  const tbody = $('cuotasTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  MESES.forEach(m => {
    const monto = map.get(m.n);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${m.nombre}</strong></td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          <span>$</span>
          <input type="text" id="cuota_${m.n}" value="${monto ?? ''}" />
        </div>
      </td>
      <td><button class="btn-save" data-mes="${m.n}">Guardar</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveCuota(mes) {
  const clubId = getActiveClubId();
  const input = $(`cuota_${mes}`);
  const val = (input?.value ?? '').trim();
  const monto = val === '' ? null : Number(val);

  const res = await fetchAuth(`/club/${clubId}/config/cuotas/${mes}`, {
    method: 'POST',
    json: true,
    body: JSON.stringify({ monto })
  });

  const data = await safeJson(res);
  if (!res.ok || !data.ok) {
    alert(data.error ?? 'Error guardando cuota');
  }
}

/* ============================================================
   CATEGORÍAS
============================================================ */

function categoriasUrl() {
  return `/club/${getActiveClubId()}/config/categorias`;
}

async function loadCategorias() {
  const res = await fetchAuth(categoriasUrl());
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    alert(data.error ?? 'Error cargando categorías');
    return;
  }

  renderCategorias(data.categorias ?? []);
}

function renderCategorias(items) {
  const tbody = $('categoriasTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  items.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" id="cat_${c.id}" value="${escapeHtml(c.nombre)}" /></td>
      <td style="text-align:center"><button class="btn-save" data-act="save-cat" data-id="${c.id}">💾</button></td>
      <td style="text-align:center"><button class="btn-del" data-act="del-cat" data-id="${c.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function createCategoria(nombre) {
  const res = await fetchAuth(categoriasUrl(), {
    method: 'POST',
    json: true,
    body: JSON.stringify({ nombre })
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error creando categoría');
}

async function updateCategoria(id, nombre) {
  const res = await fetchAuth(`${categoriasUrl()}/${id}`, {
    method: 'PUT',
    json: true,
    body: JSON.stringify({ nombre })
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error guardando categoría');

  // ✅ feedback útil
  if (typeof data.sociosActualizados === 'number') {
    console.log(`Categoría actualizada. Socios actualizados: ${data.sociosActualizados}`);
    // si querés alert:
    // alert(`✅ Categoría actualizada. Socios actualizados: ${data.sociosActualizados}`);
  }
}

/* ============================================================
   ACTIVIDADES (con precio_mensual)
============================================================ */

function actividadesUrl() {
  return `/club/${getActiveClubId()}/config/actividades`;
}

async function loadActividades() {
  const res = await fetchAuth(actividadesUrl());
  const data = await safeJson(res);
  const tbody = document.getElementById('actividadesTableBody');
  if (!tbody) return;

  if (!res.ok || !data.ok) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="muted">Error cargando actividades.</td>
      </tr>`;
    alert(data.error ?? 'Error cargando actividades');
    return;
  }

  renderActividades(data.actividades ?? []);
}

function renderActividades(items) {
  const tbody = document.getElementById('actividadesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const moneyARS = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  items.forEach(a => {
    const tr = document.createElement('tr');

    const precio = (typeof a.precio_mensual === 'number')
      ? a.precio_mensual
      : (a.precio_mensual ? Number(a.precio_mensual) : 0);

    const precioNum = Number.isFinite(precio) ? precio : 0;
    const precioFmt = moneyARS.format(precioNum);

    tr.innerHTML = `
      <td>
        <input
          type="text"
          id="act_${a.id}"
          value="${escapeHtml(a.nombre)}"
        />
      </td>

      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <input
            type="number"
            id="act_precio_${a.id}"
            min="0"
            step="0.01"
            value="${precioNum}"
            style="max-width:140px;"
          />
          <span
            id="act_precio_fmt_${a.id}"
            class="muted"
            style="font-size:12px; font-weight:700; white-space:nowrap;"
            title="${precioFmt}"
          >
            ${precioFmt}
          </span>
        </div>
      </td>

      <td style="text-align:center">
        <button class="btn-save" data-act="save-act" data-id="${a.id}">💾</button>
      </td>
      <td style="text-align:center">
        <button class="btn-del" data-act="del-act" data-id="${a.id}">🗑️</button>
      </td>
    `;

    tbody.appendChild(tr);

    // ✅ Mantener el label formateado actualizado mientras escriben
    const inp = document.getElementById(`act_precio_${a.id}`);
    const lbl = document.getElementById(`act_precio_fmt_${a.id}`);
    if (inp && lbl) {
      const updateLabel = () => {
        const v = Number(inp.value);
        lbl.textContent = moneyARS.format(Number.isFinite(v) ? v : 0);
        lbl.title = lbl.textContent;
      };
      inp.addEventListener('input', updateLabel);
      inp.addEventListener('change', updateLabel);
    }
  });
}
async function createActividad(nombre, precio_mensual) {
  const payload = {
    nombre,
    precio_mensual: (
      precio_mensual === '' ||
      precio_mensual == null
    ) ? null : Number(precio_mensual)
  };

  const res = await fetchAuth(actividadesUrl(), {
    method: 'POST',
    json: true,
    body: JSON.stringify(payload)
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error creando actividad');
}

async function updateActividad(id, nombre, precio_mensual) {
  const payload = {
    nombre,
    precio_mensual: (
      precio_mensual === '' ||
      precio_mensual == null
    ) ? null : Number(precio_mensual)
  };

  const res = await fetchAuth(`${actividadesUrl()}/${id}`, {
    method: 'PUT',
    json: true,
    body: JSON.stringify(payload)
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Error guardando actividad');
  }
}

async function deleteActividad(id) {
  const res = await fetchAuth(`${actividadesUrl()}/${id}`, { method: 'DELETE' });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error eliminando actividad');
}

/* ============================================================
   TIPOS DE GASTO
============================================================ */

function tiposGastoUrl() {
  return `/club/${getActiveClubId()}/config/tipos-gasto`;
}

async function loadTiposGasto() {
  const res = await fetchAuth(tiposGastoUrl());
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    alert(data.error ?? 'Error cargando tipos de gasto');
    return;
  }

  renderTiposGasto(data.tipos ?? []);
}

function renderTiposGasto(items) {
  const tbody = $('tiposGastoTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  items.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" id="tg_${t.id}" value="${escapeHtml(t.nombre)}" /></td>
      <td style="text-align:center"><button class="btn-save" data-act="save-tg" data-id="${t.id}">💾</button></td>
      <td style="text-align:center"><button class="btn-del" data-act="del-tg" data-id="${t.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function createTipoGasto(nombre) {
  const res = await fetchAuth(tiposGastoUrl(), {
    method: 'POST',
    json: true,
    body: JSON.stringify({ nombre })
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error creando tipo de gasto');
}

async function updateTipoGasto(id, nombre) {
  const res = await fetchAuth(`${tiposGastoUrl()}/${id}`, {
    method: 'PUT',
    json: true,
    body: JSON.stringify({ nombre })
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error guardando tipo de gasto');
}

async function deleteTipoGasto(id) {
  const res = await fetchAuth(`${tiposGastoUrl()}/${id}`, { method: 'DELETE' });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error eliminando tipo de gasto');
}

/* ============================================================
   TIPOS DE INGRESO
   (input + botón Agregar + sólo Eliminar)
============================================================ */

function tiposIngresoUrl() {
  const clubId = getActiveClubId();
  return `/club/${clubId}/config/tipos-ingreso`;
}

async function loadTiposIngreso() {
  const res = await fetchAuth(tiposIngresoUrl());
  const data = await safeJson(res);

  const tbody = document.getElementById('tiposIngresoTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!res.ok || !data.ok) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" class="muted">Error cargando tipos de ingreso.</td>
      </tr>`;
    alert(data.error ?? 'Error cargando tipos de ingreso');
    return;
  }

  const items = data.tipos ?? [];
  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" class="muted">No hay tipos de ingreso cargados.</td>
      </tr>`;
    return;
  }

  items.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(t.nombre)}</td>
      <td style="text-align:center">
        <button class="btn-del" data-del="${t.id}">🗑️ Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function createTipoIngreso(nombre) {
  const res = await fetchAuth(tiposIngresoUrl(), {
    method: 'POST',
    json: true,
    body: JSON.stringify({ nombre })
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Error creando tipo de ingreso');
  }
}

async function deleteTipoIngreso(id) {
  const res = await fetchAuth(`${tiposIngresoUrl()}/${id}`, { method: 'DELETE' });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Error eliminando tipo de ingreso');
  }
}

/* ============================================================
   RESPONSABLES
============================================================ */

function responsablesUrl() {
  return `/club/${getActiveClubId()}/config/responsables`;
}

async function loadResponsables() {
  const res = await fetchAuth(responsablesUrl());
  const data = await safeJson(res);

  if (!res.ok || !data.ok) {
    alert(data.error ?? 'Error cargando responsables');
    return;
  }

  renderResponsables(data.responsables ?? []);
}

function renderResponsables(items) {
  const tbody = $('responsablesTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  items.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" id="resp_${r.id}" value="${escapeHtml(r.nombre)}" /></td>
      <td style="text-align:center"><button class="btn-save" data-act="save-resp" data-id="${r.id}">💾</button></td>
      <td style="text-align:center"><button class="btn-del" data-act="del-resp" data-id="${r.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function createResponsable(nombre) {
  const res = await fetchAuth(responsablesUrl(), {
    method: 'POST',
    json: true,
    body: JSON.stringify({ nombre })
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error creando responsable');
}

async function updateResponsable(id, nombre) {
  const res = await fetchAuth(`${responsablesUrl()}/${id}`, {
    method: 'PUT',
    json: true,
    body: JSON.stringify({ nombre })
  });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error guardando responsable');
}

async function deleteResponsable(id) {
  const res = await fetchAuth(`${responsablesUrl()}/${id}`, { method: 'DELETE' });
  const data = await safeJson(res);
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Error eliminando responsable');
}

/* ============================================================
   EVENTOS
============================================================ */

function bindEvents() {
  // cuotas
  $('cuotasTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-mes]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await saveCuota(btn.dataset.mes);
    } finally {
      btn.disabled = false;
    }
  });

  // categorías
  $('categoriasTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'save-cat') {
      const nombre = ($(`cat_${id}`)?.value ?? '').trim();
      if (!nombre) return alert('Nombre vacío');
      btn.disabled = true;
      try {
        await updateCategoria(id, nombre);
        await loadCategorias();
      } catch (err) {
        alert(err.message ?? 'Error');
      } finally {
        btn.disabled = false;
      }
    }

    if (act === 'del-cat') {
      if (!confirm('¿Eliminar categoría?')) return;
      btn.disabled = true;
      try {
        await deleteCategoria(id);
        await loadCategorias();
      } catch (err) {
        alert(err.message ?? 'Error');
      } finally {
        btn.disabled = false;
      }
    }
  });

  $('btnCategoriaAdd')?.addEventListener('click', async () => {
  const input = document.getElementById('newCategoriaNombre');
  const nombre = (input?.value ?? '').trim();

  if (!nombre) {
    alert('Ingresá un nombre de categoría');
    return;
  }

  try {
    await createCategoria(nombre);
    input.value = '';
    await loadCategorias();
  } catch (err) {
    alert(err.message ?? 'Error');
  }
});

  // tipos de gasto
  $('tiposGastoTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'save-tg') {
      const nombre = ($(`tg_${id}`)?.value ?? '').trim();
      if (!nombre) return alert('Nombre vacío');
      btn.disabled = true;
      try {
        await updateTipoGasto(id, nombre);
        await loadTiposGasto();
      } catch (err) {
        alert(err.message ?? 'Error');
      } finally {
        btn.disabled = false;
      }
    }

    if (act === 'del-tg') {
      if (!confirm('¿Eliminar tipo de gasto?')) return;
      btn.disabled = true;
      try {
        await deleteTipoGasto(id);
        await loadTiposGasto();
      } catch (err) {
        alert(err.message ?? 'Error');
      } finally {
        btn.disabled = false;
      }
    }
  });

  $('btnTipoGastoAdd')?.addEventListener('click', async () => {
  const input = document.getElementById('newTipoGastoNombre');
  const nombre = (input?.value ?? '').trim();

  if (!nombre) {
    alert('Ingresá un nombre de tipo de gasto');
    return;
  }

  try {
    await createTipoGasto(nombre);
    input.value = '';
    await loadTiposGasto();
  } catch (err) {
    alert(err.message ?? 'Error');
  }
});


  // TIPOS DE INGRESO: botón Agregar
  $('btnTipoIngresoAdd')?.addEventListener('click', async () => {
    const input = document.getElementById('newTipoIngresoNombre');
    const nombre = (input?.value ?? '').trim();
    if (!nombre) {
      alert('Ingresá un nombre para el tipo de ingreso');
      return;
    }
    try {
      await createTipoIngreso(nombre);
      if (input) input.value = '';
      await loadTiposIngreso();
    } catch (err) {
      alert(err.message ?? 'Error creando tipo de ingreso');
    }
  });

  // TIPOS DE INGRESO: botón Eliminar
  document
    .getElementById('tiposIngresoTableBody')
    ?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-del]');
      if (!btn) return;
      if (!confirm('¿Eliminar este tipo de ingreso?')) return;
      btn.disabled = true;
      try {
        await deleteTipoIngreso(btn.dataset.del);
        await loadTiposIngreso();
      } catch (err) {
        alert(err.message ?? 'Error eliminando tipo de ingreso');
      } finally {
        btn.disabled = false;
      }
    });

  // responsables
  $('responsablesTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'save-resp') {
      const nombre = ($(`resp_${id}`)?.value ?? '').trim();
      if (!nombre) return alert('Nombre vacío');
      btn.disabled = true;
      try {
        await updateResponsable(id, nombre);
        await loadResponsables();
      } catch (err) {
        alert(err.message ?? 'Error');
      } finally {
        btn.disabled = false;
      }
    }

    if (act === 'del-resp') {
      if (!confirm('¿Eliminar responsable?')) return;
      btn.disabled = true;
      try {
        await deleteResponsable(id);
        await loadResponsables();
      } catch (err) {
        alert(err.message ?? 'Error');
      } finally {
        btn.disabled = false;
      }
    }
  });

  $('btnResponsableAdd')?.addEventListener('click', async () => {
  const input = document.getElementById('newResponsableNombre');
  const nombre = (input?.value ?? '').trim();

  if (!nombre) {
    alert('Ingresá un nombre de responsable');
    return;
  }

  try {
    await createResponsable(nombre);
    input.value = '';
    await loadResponsables();
  } catch (err) {
    alert(err.message ?? 'Error');
  }
});

  // ACTIVIDADES: guardar / eliminar
  document
    .getElementById('actividadesTableBody')
    ?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === 'save-act') {
        const nombre = (document.getElementById(`act_${id}`)?.value ?? '').trim();
        const precioStr = document.getElementById(`act_precio_${id}`)?.value ?? '';
        const precioNum = precioStr === '' ? null : Number(precioStr);

        if (!nombre) return alert('Nombre vacío');
        if (precioStr !== '' && (Number.isNaN(precioNum) || precioNum < 0)) {
          return alert('Ingresá un precio mensual válido (>= 0).');
        }

        btn.disabled = true;
        try {
          await updateActividad(id, nombre, precioStr);
          await loadActividades();
        } catch (err) {
          alert(err.message ?? 'Error');
        } finally {
          btn.disabled = false;
        }
      }

      if (act === 'del-act') {
        if (!confirm('¿Eliminar actividad?')) return;
        btn.disabled = true;
        try {
          await deleteActividad(id);
          await loadActividades();
        } catch (err) {
          alert(err.message ?? 'Error');
        } finally {
          btn.disabled = false;
        }
      }
    });

  // ACTIVIDADES: Agregar
  document
    .getElementById('btnActividadAdd')
    ?.addEventListener('click', async () => {
      const inputNombre = document.getElementById('newActividadNombre');
      const inputPrecio = document.getElementById('newActividadPrecio');

      const nombre = (inputNombre?.value ?? '').trim();
      const precioStr = (inputPrecio?.value ?? '').trim();
      const precioNum = precioStr === '' ? null : Number(precioStr);

      if (!nombre) return alert('Ingresá un nombre para la actividad');
      if (precioStr !== '' && (Number.isNaN(precioNum) || precioNum < 0)) {
        return alert('Ingresá un precio mensual válido (>= 0).');
      }

      try {
        await createActividad(nombre, precioStr);
        if (inputNombre) inputNombre.value = '';
        if (inputPrecio) inputPrecio.value = '';
        await loadActividades();
      } catch (err) {
        alert(err.message ?? 'Error creando actividad');
      }
    });
}

/* ============================================================
   INIT
============================================================ */

async function initConfiguracionSection() {
  await loadCuotas();
  await loadCategorias();
  await loadTiposGasto();
  await loadTiposIngreso();   // importante para que se llene la tabla
  await loadResponsables();
  await loadActividades();
  bindEvents();
}

window.initConfiguracionSection = initConfiguracionSection;

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('configuracion-section')) {
    initConfiguracionSection();
  }
});

/* ============================================================
   ACORDEÓN (NUEVO) — AHORA SÍ FUNCIONA SIEMPRE
============================================================ */

document.addEventListener('click', function (e) {
  const header = e.target.closest('.config-header');
  if (!header) return;

  const card = header.closest('.config-collapsible');
  if (!card) return;

  card.classList.toggle('collapsed');
});