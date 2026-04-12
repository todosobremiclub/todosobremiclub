(() => {
  const $ = (id) => document.getElementById(id);

// Roles soportados (club)
const CLUB_ROLE_OPTIONS = ['admin','solo_lectura','comunicacion','finanzas','staff'];


  // =============================
  // Estado
  // =============================
  let usersCache = [];
  let activeClubUsersId = null;
  let activeClubUsersName = null;
  let usersLoadedOnce = false;

  // Debug en consola
  function syncDebugCache() {
    window.usersCache = usersCache;
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

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // =============================
  // Mensajes
  // =============================
  function showMsg(elId, text, ok = true) {
    const box = $(elId);
    if (!box) return;
    box.className = 'msg ' + (ok ? 'ok' : 'err');
    box.textContent = text;
  }

  // =============================
  // Cargar usuarios SIEMPRE
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
  // Render: Usuarios del club
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
          <td colspan="4" style="color:#6b7280;">
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

      const roleTxt = roleObj?.role || '—';
      const estadoTxt = u.is_active ? 'Activo' : 'Inactivo';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(u.email || '')}</td>
        <td>${escapeHtml(roleTxt)}</td>
        <td>${escapeHtml(estadoTxt)}</td>
        <td style="white-space:nowrap;">
          <button data-act="edit" data-id="${escapeHtml(String(u.id))}">Editar</button>
          <button data-act="toggle" data-id="${escapeHtml(String(u.id))}" data-active="${u.is_active ? '1' : '0'}">
            ${u.is_active ? 'Desactivar' : 'Activar'}
          </button>
          <button data-act="del" data-id="${escapeHtml(String(u.id))}" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:4px 8px;">
            Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =============================
  // Form usuario del club
  // =============================
  function openClubUserForm(editMode = false) {
    const card = $('clubUserFormCard');
    if (card) card.style.display = 'block';

    const title = $('clubUserFormTitle');
    const pass = $('clubUser_password');
    const passLabel = $('clubUser_pass_label');

    if (title) title.textContent = editMode ? 'Editar usuario del club' : 'Crear usuario del club';

    // En edición: password no obligatorio
    if (passLabel) passLabel.textContent = editMode ? 'Contraseña (opcional)' : 'Contraseña *';
    if (pass) pass.placeholder = editMode ? '(dejar vacío para no cambiar)' : '••••••••';

    showMsg('clubUserMsg', '', true);
  }

  function closeClubUserForm() {
    const card = $('clubUserFormCard');
    if (card) card.style.display = 'none';
    resetClubUserForm();
  }

  function resetClubUserForm() {
    $('clubUserForm')?.reset();
    if ($('clubUser_id')) $('clubUser_id').value = '';
    if ($('clubUser_role')) $('clubUser_role').value = 'admin';
    showMsg('clubUserMsg', '', true);
  }

  function fillFormForEdit(userId) {
    const u = (usersCache || []).find((x) => String(x.id) === String(userId));
    if (!u) return;

    const roleObj = (u.roles || []).find(
      (r) => String(r.club_id) === String(activeClubUsersId)
    );

    $('clubUser_id').value = u.id;
    $('clubUser_full_name').value = u.full_name || '';
    $('clubUser_email').value = u.email || '';
    $('clubUser_password').value = '';
    $('clubUser_role').value = roleObj?.role || 'staff';

    openClubUserForm(true);
  }

  async function submitClubUserForm(ev) {
    ev.preventDefault();

    if (!activeClubUsersId) {
      alert('No hay club seleccionado.');
      return;
    }

    const id = $('clubUser_id')?.value?.trim() || '';
    const email = $('clubUser_email')?.value?.trim().toLowerCase() || '';
    const full_name = $('clubUser_full_name')?.value?.trim() || '';
    const password = $('clubUser_password')?.value || '';
    const role = ($('clubUser_role')?.value?.trim() || 'staff');
if (!CLUB_ROLE_OPTIONS.includes(role)) {
  return showMsg('clubUserMsg', 'Rol inválido.', false);
}

    if (!email) return showMsg('clubUserMsg', 'Completá el email.', false);
    if (!id && !password) return showMsg('clubUserMsg', 'Completá la contraseña.', false);

    const payload = {
  email,
  is_active: true, // ✅ por defecto activo
  assignments: [{ club_id: activeClubUsersId, role }],
};

    if (full_name) payload.full_name = full_name;
    if (password) payload.password = password;

    const url = id ? `/admin/users/${id}` : `/admin/users`;
    const method = id ? 'PUT' : 'POST';

    const btn = $('clubUserSubmitBtn');
    if (btn) btn.disabled = true;

    try {
      const res = await fetchAuth(url, {
        method,
        json: true,
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        showMsg('clubUserMsg', data.error || 'Error guardando usuario', false);
        return;
      }

      showMsg('clubUserMsg', id ? '✅ Usuario actualizado' : '✅ Usuario creado', true);

      // refrescar cache y tabla
      await ensureUsersLoaded(true);
      renderUsersForActiveClub();

      // cerrar form luego de guardar
      closeClubUserForm();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // =============================
  // Acciones (activar/desactivar/eliminar)
  // =============================
  async function toggleUser(userId, isActive) {
    const res = await fetchAuth(`/admin/users/${userId}/active`, {
      method: 'PATCH',
      json: true,
      body: JSON.stringify({ is_active: !isActive }),
    });
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      alert(data.error || 'Error cambiando estado');
      return;
    }

    await ensureUsersLoaded(true);
    renderUsersForActiveClub();
  }

  async function deleteUser(userId) {
    if (!confirm('¿Seguro que querés eliminar este usuario?')) return;

    const res = await fetchAuth(`/admin/users/${userId}`, { method: 'DELETE', json: true });
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      alert(data.error || 'Error eliminando usuario');
      return;
    }

    await ensureUsersLoaded(true);
    renderUsersForActiveClub();
  }

  // =============================
  // API pública para clubs.js
  // =============================
  window.openUsersForClub = async function (clubId, clubName) {
    activeClubUsersId = String(clubId);
    activeClubUsersName = String(clubName || '');

    await ensureUsersLoaded(false);
    renderUsersForActiveClub();
    closeClubUserForm();
  };

  window.closeUsersForClub = function () {
    activeClubUsersId = null;
    activeClubUsersName = null;
    renderUsersForActiveClub();
    closeClubUserForm();
  };

  // =============================
  // Bind botones y tabla
  // =============================
  function bindClubUsersPanelButtons() {
    $('btnClubUsersClose')?.addEventListener('click', () => {
      window.closeUsersForClub?.();
    });

    $('btnClubUsersNew')?.addEventListener('click', () => {
      if (!activeClubUsersId) return alert('Seleccioná un club primero.');
      resetClubUserForm();
      openClubUserForm(false);
    });

    $('clubUserCancelBtn')?.addEventListener('click', () => {
      closeClubUserForm();
    });

    $('clubUserForm')?.addEventListener('submit', submitClubUserForm);

    // Acciones en la tabla (editar / toggle / delete)
    $('clubUsersTableBody')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;

      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === 'edit') {
        fillFormForEdit(id);
        return;
      }
      if (act === 'toggle') {
        const isActive = btn.dataset.active === '1';
        await toggleUser(id, isActive);
        return;
      }
      if (act === 'del') {
        await deleteUser(id);
        return;
      }
    });
  }

  // =============================
  // Init
  // =============================
  document.addEventListener('DOMContentLoaded', async () => {
    bindClubUsersPanelButtons();
    await ensureUsersLoaded(false);
  });
})();