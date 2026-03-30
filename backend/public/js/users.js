(() => {
  const $ = (id) => document.getElementById(id);

  // Cache interno (antes no era accesible desde consola)
  let usersCache = [];
  let activeClubUsersId = null;
  let activeClubUsersName = null;
  let usersLoadedOnce = false;

  // Exponer para debug en consola
  function syncDebugCache() {
    window.usersCache = usersCache; // ahora podés hacer usersCache[0] en consola
  }

  // =============================
  // Auth helpers
  // =============================
  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers.Authorization = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const { json, ...rest } = options;

    const res = await fetch(url, { ...rest, headers });

    if (res.status === 401 || res.status === 403) {
      localStorage.clear();
      alert(res.status === 403 ? 'No autorizado.' : 'Sesión inválida.');
      location.href = '/admin.html';
      throw new Error(String(res.status));
    }
    return res;
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
  // Cargar usuarios SIEMPRE (aunque no exista #users-table)
  // =============================
  async function ensureUsersLoaded(force = false) {
    if (usersLoadedOnce && !force) return;

    const res = await fetchAuth('/admin/users');
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      console.error('❌ Error cargando usuarios:', data.error || data);
      usersCache = [];
      usersLoadedOnce = true;
      syncDebugCache();
      return;
    }

    usersCache = data.users || [];
    usersLoadedOnce = true;
    syncDebugCache();
  }

  // =============================
  // Render panel "Usuarios del club"
  // =============================
  function renderUsersForActiveClub() {
    const card = $('clubUsersCard');
    const title = $('clubUsersTitle');
    const tbody = $('clubUsersTableBody');

    if (!card || !title || !tbody) return;

    if (!activeClubUsersId) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    title.textContent = activeClubUsersName || activeClubUsersId;

    const rows = (usersCache || []).filter((u) =>
      (u.roles || []).some((r) => String(r.club_id) === String(activeClubUsersId))
    );

    tbody.innerHTML = '';

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="color:#6b7280;">
            No hay usuarios asignados a este club.
          </td>
        </tr>
      `;
      return;
    }

    rows.forEach((u) => {
      const roleObj = (u.roles || []).find(
        (r) => String(r.club_id) === String(activeClubUsersId)
      );

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.email || ''}</td>
        <td>${roleObj?.role || '—'}</td>
        <td>${u.is_active ? 'Activo' : 'Inactivo'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =============================
  // API pública para clubs.js
  // =============================
  window.openUsersForClub = async function (clubId, clubName) {
    activeClubUsersId = String(clubId);
    activeClubUsersName = String(clubName || '');

    // clave: cargar usuarios antes de renderizar
    await ensureUsersLoaded(false);
    renderUsersForActiveClub();
  };

  window.closeUsersForClub = function () {
    activeClubUsersId = null;
    activeClubUsersName = null;
    renderUsersForActiveClub();
  };

  // Botones del panel (si existen)
  function bindClubUsersPanelButtons() {
    $('btnClubUsersClose')?.addEventListener('click', () => {
      window.closeUsersForClub?.();
    });

    $('btnClubUsersNew')?.addEventListener('click', () => {
      // Por ahora solo dejamos aviso (hasta armar el modal/form dentro del club)
      alert('Crear usuario dentro del club: próximo paso (form embebido).');
    });
  }

  // =============================
  // Init
  // =============================
  document.addEventListener('DOMContentLoaded', async () => {
    bindClubUsersPanelButtons();

    // Cargamos usuarios una vez al entrar al superadmin (aunque no se vea nada todavía)
    await ensureUsersLoaded(false);
  });
})();