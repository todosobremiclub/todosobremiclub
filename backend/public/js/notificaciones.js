// public/js/notificaciones.js
(() => {
  const $ = (selector) => document.querySelector(selector);

  // =============================
  // Auth / helpers comunes (igual a noticias.js)
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

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&')
      .replaceAll('<', '<')
      .replaceAll('>', '>')
      .replaceAll('"', '"')
      .replaceAll("'", "''");
  }

  function formatDateISOToDMY(iso) {
    if (!iso) return '';
    const s = String(iso).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}/${m}/${y}`;
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('es-AR');
    } catch {
      return String(iso);
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const dataUrl = String(r.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma < 0) return reject(new Error('No se pudo leer la imagen'));
        resolve({
          base64: dataUrl.slice(comma + 1),
          mimetype: file.type || 'image/jpeg'
        });
      };
      r.onerror = () => reject(new Error('Error leyendo archivo'));
      r.readAsDataURL(file);
    });
  }

  // =============================
  // Carga historial
  // =============================
  let cache = [];

  async function loadNotificaciones() {
    const clubId = getActiveClubId();
    const tbody = $('#notificacionesTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

    const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones`);
    if (!res.ok || !data.ok) {
      tbody.innerHTML = `<tr><td colspan="5">Error cargando</td></tr>`;
      return;
    }
    cache = data.notificaciones ?? [];
    renderTable();
  }

  function renderTable() {
    const tbody = $('#notificacionesTableBody');
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
        <td>${escapeHtml(formatDateISOToDMY(n.created_at))}</td>
        <td>${n.sent_at ? escapeHtml(formatDateTime(n.sent_at)) : '—'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-secondary" style="background:#ef4444;border-color:#ef4444;"
            data-act="del" data-id="${escapeHtml(n.id)}" title="Eliminar">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =============================
  // Enviar (guardar + push automático)
  // =============================
  async function send() {
    const clubId = getActiveClubId();
    const titulo = $('#pushTitulo')?.value?.trim() ?? '';
    const cuerpo = $('#pushCuerpo')?.value?.trim() ?? '';
    if (!titulo || !cuerpo) {
      alert('Completá título y mensaje.');
      return;
    }

    const payload = { titulo, cuerpo };

    const file = $('#pushImagen')?.files?.[0] ?? null;
    if (file) {
      if (file.size > 3 * 1024 * 1024) {
        alert('La imagen supera los 3MB. Elegí una más liviana.');
        return;
      }
      const img = await readFileAsBase64(file);
      payload.imagen_base64 = img.base64;
      payload.imagen_mimetype = img.mimetype;
    }

    const btn = $('#btnPushEnviar');
    if (btn) btn.disabled = true;

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones`, {
        method: 'POST',
        json: true,
        body: JSON.stringify(payload)
      });

      if (!res.ok || !data.ok) {
        alert(data.error || 'Error enviando notificación');
        return;
      }

      alert('✅ Notificación enviada');
      // limpiar
      if ($('#pushTitulo')) $('#pushTitulo').value = '';
      if ($('#pushCuerpo')) $('#pushCuerpo').value = '';
      if ($('#pushImagen')) $('#pushImagen').value = '';
      await loadNotificaciones();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function del(id) {
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

  // =============================
  // Bind
  // =============================
  function bindOnce() {
    const root = document.getElementById('notificaciones-section');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    root.querySelector('#btnPushEnviar')?.addEventListener('click', (e) => {
      e.preventDefault();
      send().catch(err => alert(err.message || 'Error'));
    });

    root.querySelector('#notificacionesTableBody')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'del') del(btn.dataset.id);
    });
  }

  async function initNotificacionesSection() {
    bindOnce();
    await loadNotificaciones();
  }

  window.initNotificacionesSection = initNotificacionesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('notificaciones-section')) {
      initNotificacionesSection();
    }
  });
})();