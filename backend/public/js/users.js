(() => {
  const $ = (id) => document.getElementById(id);
  let usersCache = [];
  let clubsCache = [];

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Sesión expirada');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    return fetch(url, { ...options, headers });
  }

  function showUserMsg(text, ok = true) {
    const box = $('userMsg');
    if (!box) return;
    box.className = 'msg ' + (ok ? 'ok' : 'err');
    box.textContent = text;
  }

  // ================== LOAD CLUBS ==================
  async function loadClubs() {
    const r = await fetchAuth('/admin/clubs');
    const d = await r.json();
    clubsCache = d.clubs || [];
  }

  // ================== LOAD USERS ==================
  async function loadUsers() {
    const tbody = $('users-table');
    tbody.innerHTML = `<tr><td colspan="4">Cargando...</td></tr>`;

    const r = await fetchAuth('/admin/users');
    const d = await r.json();

    if (!d.ok) {
      tbody.innerHTML = '';
      showUserMsg('Error cargando usuarios', false);
      return;
    }

    usersCache = d.users;
    tbody.innerHTML = '';

    usersCache.forEach(u => {
      const roles = (u.roles || [])
        .map(r => `${r.role} (${r.club_name})`)
        .join('<br>');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.email}</td>
        <td>${roles}</td>
        <td>${u.is_active ? 'Activo' : 'Inactivo'}</td>
        <td>
          <button onclick="editUser('${u.id}')">Editar</button>
          <button onclick="deleteUser('${u.id}')">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ================== EDIT ==================
  window.editUser = async (id) => {
    const u = usersCache.find(x => x.id === id);
    if (!u) return;

    const email = prompt('Email:', u.email);
    if (!email) return;

    const full_name = prompt('Nombre completo:', u.full_name || '') || null;
    const is_active = confirm('¿Usuario activo?');

    const clubOptions = clubsCache
      .map(c => `${c.id} - ${c.name}`)
      .join('\n');

    const club_id = prompt(`Club ID:\n${clubOptions}`, u.roles?.[0]?.club_id);
    const role = prompt('Rol (staff/admin/superadmin):', u.roles?.[0]?.role);

    const payload = {
      email,
      full_name,
      is_active,
      assignments: club_id && role ? [{ club_id, role }] : []
    };

    const r = await fetchAuth(`/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      json: true
    });

    const d = await r.json();
    if (!d.ok) return showUserMsg('Error actualizando usuario', false);

    showUserMsg('✅ Usuario actualizado', true);
    loadUsers();
  };

  // ================== DELETE ==================
  window.deleteUser = async (id) => {
    if (!confirm('¿Eliminar usuario definitivamente?')) return;

    const r = await fetchAuth(`/admin/users/${id}`, { method: 'DELETE' });
    const d = await r.json();

    if (!d.ok) return showUserMsg('Error eliminando usuario', false);

    showUserMsg('✅ Usuario eliminado', true);
    loadUsers();
  };

  document.addEventListener('DOMContentLoaded', async () => {
    await loadClubs();
    await loadUsers();
  });
})();