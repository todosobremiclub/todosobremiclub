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
  // ENVIAR
  // =========================

function renderDestinoExtra() {
  const tipo = $id('notiDestinoTipo')?.value || 'todos';
  const cont = $id('notiDestinoExtra');
  if (!cont) return;
  cont.innerHTML = '';

  if (tipo === 'todos' || tipo === 'falta_pago') return;

  if (tipo === 'actividad') {
    cont.innerHTML = `<input id="notiDestinoValor1" placeholder="Actividad" />`;
  }
  if (tipo === 'categoria') {
    cont.innerHTML = `<input id="notiDestinoValor1" placeholder="Categoría" />`;
  }
  if (tipo === 'anio_nac') {
    cont.innerHTML = `<input id="notiDestinoValor1" type="number" placeholder="Año nacimiento" />`;
  }
  if (tipo === 'act_cat' || tipo === 'cat_anio') {
    cont.innerHTML = `
      <input id="notiDestinoValor1" placeholder="Valor 1" />
      <input id="notiDestinoValor2" placeholder="Valor 2" />
    `;
  }
}

function getDestinoPayload() {
  const tipo = $id('notiDestinoTipo')?.value || 'todos';
  const v1 = $id('notiDestinoValor1')?.value?.trim() || null;
  const v2 = $id('notiDestinoValor2')?.value?.trim() || null;
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
      const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones`, {
        method: 'POST',
        json: true,
        const destino = getDestinoPayload();

const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones`, {
  method: 'POST',
  json: true,
  body: JSON.stringify({
    titulo,
    cuerpo,
    data: destino
  })
});

      });

      if (!res.ok || !data.ok) {
        alert(data.error || 'Error enviando');
        return;
      }

      alert('✅ Notificación enviada');

      // limpiar
      if ($id('pushTitulo')) $id('pushTitulo').value = '';
      if ($id('pushCuerpo')) $id('pushCuerpo').value = '';

      // ✅ refrescar historial
      await loadNotificaciones();
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
    await loadNotificaciones();
  };

document.addEventListener('change', (e) => {
  if (e.target?.id === 'notiDestinoTipo') {
    renderDestinoExtra();
  }
});

})();
