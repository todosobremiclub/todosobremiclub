// public/js/notificaciones.js
(() => {
  console.log('[notificaciones] script cargado ✅');

  const $id = (id) => document.getElementById(id);

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Sesión expirada');
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club activo');
      throw new Error('No club');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers ?? {};
    headers.Authorization = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const { json, ...rest } = options;

    const res = await fetch(url, { ...rest, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&')
      .replaceAll('<', '<')
      .replaceAll('>', '>')
      .replaceAll('"', '"')
      .replaceAll("'", "''");
  }

  function fmtDT(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('es-AR'); }
    catch { return String(iso); }
  }

// =========================
  // HISTORIAL
  // =========================
  let cache = [];

  // Catálogos para el selector de Destino
  let actividadesCache = [];
  let categoriasCache = [];
  let aniosNacimientoCache = [];

  async function loadNotificaciones() {
    const tbody = $id('notificacionesTableBody');
    if (!tbody) return; // si todavía no está la sección cargada

    tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones`);

    if (!res.ok || !data.ok) {
      tbody.innerHTML = `<tr><td colspan="5">Error cargando historial</td></tr>`;
      console.error('[notificaciones] error load', data);
      return;
    }

    cache = data.notificaciones ?? [];
    renderTable();
  }

  function renderTable() {
    const tbody = $id('notificacionesTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!cache.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted">No hay notificaciones.</td></tr>`;
      return;
    }

    cache.forEach(n => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(n.titulo ?? '')}</strong></td>
        <td>${escapeHtml(n.cuerpo ?? '').slice(0, 160)}${(n.cuerpo ?? '').length > 160 ? '…' : ''}</td>
        <td>${escapeHtml(fmtDT(n.created_at))}</td>
        <td>${n.sent_at ? escapeHtml(fmtDT(n.sent_at)) : '—'}</td>
        <td style="white-space:nowrap;">
          <button id="btnNotiDel" class="btn btn-secondary"
            style="background:#ef4444;border-color:#ef4444;"
            data-act="del" data-id="${escapeHtml(n.id)}">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

// =========================
  // CATÁLOGOS PARA EL DESTINO (mismos que usa Noticias)
  // =========================
  async function loadActividades() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/config/actividades`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando actividades');
      actividadesCache = data.actividades || [];
    } catch (e) {
      console.error('loadActividades:', e);
      actividadesCache = [];
    }
  }

  async function loadCategorias() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/config/categorias`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando categorías');
      categoriasCache = data.categorias || [];
    } catch (e) {
      console.error('loadCategorias:', e);
      categoriasCache = [];
    }
  }

  async function loadAniosNacimiento() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/noticias/anios-nacimiento`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando años de nacimiento');
      aniosNacimientoCache = (data.anios || []).map(a => String(a));
    } catch (e) {
      console.error('loadAniosNacimiento:', e);
      aniosNacimientoCache = [];
    }
  }

  // =========================
  // ENVIAR
  // =========================

function renderDestinoExtra() {
  const tipo = $id('notiDestinoTipo')?.value || 'todos';
  const cont = $id('notiDestinoExtra');
  if (!cont) return;
  cont.innerHTML = '';

  if (tipo === 'todos' || tipo === 'falta_pago') return;

  if (tipo === 'actividad') {
    const label = document.createElement('label');
    label.textContent = 'Actividad';

    const sel = document.createElement('select');
    sel.id = 'notiDestinoActividad';
    sel.innerHTML =
      `<option value="">Seleccionar actividad...</option>` +
      actividadesCache
        .map(a => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`)
        .join('');

    label.appendChild(sel);
    cont.appendChild(label);
    return;
  }

  if (tipo === 'categoria') {
    const label = document.createElement('label');
    label.textContent = 'Categoría';

    const sel = document.createElement('select');
    sel.id = 'notiDestinoCategoria';
    sel.innerHTML =
      `<option value="">Seleccionar categoría...</option>` +
      categoriasCache
        .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
        .join('');

    label.appendChild(sel);
    cont.appendChild(label);
    return;
  }

  if (tipo === 'anio_nac') {
    const label = document.createElement('label');
    label.textContent = 'Año de nacimiento';

    const sel = document.createElement('select');
    sel.id = 'notiDestinoAnio';
    sel.innerHTML =
      `<option value="">Seleccionar año...</option>` +
      aniosNacimientoCache
        .map(y => `<option value="${y}">${y}</option>`)
        .join('');

    label.appendChild(sel);
    cont.appendChild(label);
    return;
  }

  if (tipo === 'act_cat') {
    const labelAct = document.createElement('label');
    labelAct.textContent = 'Actividad';

    const selAct = document.createElement('select');
    selAct.id = 'notiDestinoActividad';
    selAct.innerHTML =
      `<option value="">Seleccionar actividad...</option>` +
      actividadesCache
        .map(a => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`)
        .join('');
    labelAct.appendChild(selAct);

    const labelCat = document.createElement('label');
    labelCat.textContent = 'Categoría';

    const selCat = document.createElement('select');
    selCat.id = 'notiDestinoCategoria';
    selCat.innerHTML =
      `<option value="">Seleccionar categoría...</option>` +
      categoriasCache
        .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
        .join('');
    labelCat.appendChild(selCat);

    cont.appendChild(labelAct);
    cont.appendChild(labelCat);
    return;
  }

  if (tipo === 'cat_anio') {
    const labelCat = document.createElement('label');
    labelCat.textContent = 'Categoría';

    const selCat = document.createElement('select');
    selCat.id = 'notiDestinoCategoria';
    selCat.innerHTML =
      `<option value="">Seleccionar categoría...</option>` +
      categoriasCache
        .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
        .join('');
    labelCat.appendChild(selCat);

    const labelAnio = document.createElement('label');
    labelAnio.textContent = 'Año de nacimiento';

    const selAnio = document.createElement('select');
    selAnio.id = 'notiDestinoAnio';
    selAnio.innerHTML =
      `<option value="">Seleccionar año...</option>` +
      aniosNacimientoCache
        .map(y => `<option value="${y}">${y}</option>`)
        .join('');
    labelAnio.appendChild(selAnio);

    cont.appendChild(labelCat);
    cont.appendChild(labelAnio);
    return;
  }
}

function getDestinoPayload() {
  const tipo = $id('notiDestinoTipo')?.value || 'todos';

  let v1 = null;
  let v2 = null;

  if (tipo === 'actividad') {
    v1 = $id('notiDestinoActividad')?.value?.trim() || '';
    if (!v1) throw new Error('Seleccioná una actividad');
  } else if (tipo === 'categoria') {
    v1 = $id('notiDestinoCategoria')?.value?.trim() || '';
    if (!v1) throw new Error('Seleccioná una categoría');
  } else if (tipo === 'anio_nac') {
    v1 = $id('notiDestinoAnio')?.value?.trim() || '';
    if (!v1) throw new Error('Seleccioná un año de nacimiento');
  } else if (tipo === 'cat_anio') {
    v1 = $id('notiDestinoCategoria')?.value?.trim() || '';
    v2 = $id('notiDestinoAnio')?.value?.trim() || '';
    if (!v1 || !v2) throw new Error('Seleccioná categoría y año');
  } else if (tipo === 'act_cat') {
    v1 = $id('notiDestinoActividad')?.value?.trim() || '';
    v2 = $id('notiDestinoCategoria')?.value?.trim() || '';
    if (!v1 || !v2) throw new Error('Seleccioná actividad y categoría');
  } else if (tipo === 'falta_pago') {
    v1 = null;
    v2 = null;
  }

  return { destino_tipo: tipo, destino_valor1: v1, destino_valor2: v2 };
}

 async function sendNotificacion() {
  console.log('[notificaciones] enviando…');

  const titulo = $id('pushTitulo')?.value?.trim();
  const cuerpo = $id('pushCuerpo')?.value?.trim();

  if (!titulo || !cuerpo) {
    alert('Completá título y mensaje');
    return;
  }

  const clubId = getActiveClubId();
  const btn = $id('btnPushEnviar');
  if (btn) btn.disabled = true;

  try {
    const destino = getDestinoPayload();

    const { res, data } = await fetchAuth(
      `/club/${clubId}/notificaciones`,
      {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          titulo,
          cuerpo,
          data: destino
        })
      }
    );

    if (!res.ok || !data.ok) {
      alert(data?.error || 'Error enviando notificación');
      return;
    }

    alert('✅ Notificación enviada');

    if ($id('pushTitulo')) $id('pushTitulo').value = '';
    if ($id('pushCuerpo')) $id('pushCuerpo').value = '';

    await loadNotificaciones();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error enviando notificación');
  } finally {
    if (btn) btn.disabled = false;
  }
}

  // =========================
  // ELIMINAR
  // =========================
  async function deleteNotificacion(id) {
    const clubId = getActiveClubId();
    if (!confirm('¿Eliminar esta notificación?')) return;

    const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok || !data.ok) {
      alert(data.error || 'No se pudo eliminar');
      return;
    }

    await loadNotificaciones();
  }

  // ✅ EVENT DELEGATION GLOBAL
  document.addEventListener('click', (e) => {
    const btnSend = e.target.closest('#btnPushEnviar');
    if (btnSend) {
      e.preventDefault();
      console.log('[notificaciones] click Guardar y enviar ✅');
      sendNotificacion().catch(err => {
        console.error(err);
        alert(err.message || 'Error');
      });
      return;
    }

    const btnDel = e.target.closest('button[data-act="del"][data-id]');
    if (btnDel) {
      e.preventDefault();
      deleteNotificacion(btnDel.dataset.id).catch(err => {
        console.error(err);
        alert(err.message || 'Error');
      });
    }
  });

// ✅ init llamado desde club.js cuando carga la sección
  window.initNotificacionesSection = async () => {
    console.log('[notificaciones] init sección ✅');

    // Catálogos para el selector de Destino (actividad/categoría/año)
    await Promise.all([loadActividades(), loadCategorias(), loadAniosNacimiento()]);
    renderDestinoExtra();

    await loadNotificaciones();
  };

document.addEventListener('change', (e) => {
  if (e.target?.id === 'notiDestinoTipo') {
    const tipo = e.target.value || 'todos';

    (async () => {
      if (tipo === 'actividad') await loadActividades();
      if (tipo === 'categoria') await loadCategorias();
      if (tipo === 'anio_nac') await loadAniosNacimiento();
      if (tipo === 'act_cat') await Promise.all([loadActividades(), loadCategorias()]);
      if (tipo === 'cat_anio') await Promise.all([loadCategorias(), loadAniosNacimiento()]);

      renderDestinoExtra();
    })();
  }
});

})();
