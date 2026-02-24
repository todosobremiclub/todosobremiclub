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

  async function loadClubsIntoUserSelect() {
    const sel = $('user_club_id');
    if (!sel) return;

    sel.innerHTML = '<option value="">Cargando clubes...</option>';

    try {
      const res = await fetchAuth('/admin/clubs');
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        sel.innerHTML = '<option value="">Error cargando clubes</option>';
        return;
      }

      const clubs = data.clubs || [];
      if (clubs.length === 0) {
        sel.innerHTML = '<option value="">No hay clubes</option>';
        return;
      }

      sel.innerHTML = '<option value="">Seleccionar...</option>';
      clubs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name}${c.city ? ' - ' + c.city : ''}`;
        sel.appendChild(opt);
      });
    } catch {
      sel.innerHTML = '<option value="">Error cargando clubes</option>';
    }
  }

  async function loadUsers() {
    const tbody = $('users-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4">Cargando...</td></tr>';

    const res = await fetchAuth('/admin/users');
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      tbody.innerHTML = '';
      showUserMsg('Error cargando usuarios', false);
      return;
    }

    usersCache = data.users || [];
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

  async function createUser(e) {
    e.preventDefault();

    const full_name = $('user_full_name').value.trim();
    const email = $('user_email').value.trim().toLowerCase();
    const password = $('user_password').value;
    const role = $('user_role').value;
    const club_id = $('user_club_id').value;

    if (!email || !password || !role || !club_id) {
      showUserMsg('Completá email, contraseña, rol y club.', false);
      return;
    }

    const payload = {
      email,
      full_name: full_name || null,
      password,
      assignments: [{ club_id, role }]
    };

    const res = await fetchAuth('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
      json: true
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      showUserMsg(data.error || 'No se pudo crear el usuario', false);
      return;
    }

    showUserMsg('✅ Usuario creado correctamente', true);
    $('formUser').reset();
    loadUsers();
  }

  window.editUser = async (id) => {
    const u = usersCache.find(x => x.id === id);
    if (!u) return;

    const email = prompt('Email:', u.email);
    if (!email) return;

    const full_name = prompt('Nombre completo:', u.full_name || '') || null;
    const is_active = confirm('¿Usuario activo?');

    const clubsList = clubsCache.map(c => `${c.id} - ${c.name}`).join('\n');
    const club_id = prompt(`Club ID:\n${clubsList}`, u.roles?.[0]?.club_id);
    const role = prompt('Rol (staff/admin/superadmin):', u.roles?.[0]?.role);

    const payload = {
      email,
      full_name,
      is_active,
      assignments: club_id && role ? [{ club_id, role }] : []
    };

    const res = await fetchAuth(`/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      json: true
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showUserMsg('Error actualizando usuario', false);
      return;
    }

    showUserMsg('✅ Usuario actualizado', true);
    loadUsers();
  };

  window.deleteUser = async (id) => {
    if (!confirm('¿Eliminar usuario definitivamente?')) return;

    const res = await fetchAuth(`/admin/users/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      showUserMsg('Error eliminando usuario', false);
      return;
    }

    showUserMsg('✅ Usuario eliminado', true);
    loadUsers();
  };

  document.addEventListener('DOMContentLoaded', async () => {
    $('formUser')?.addEventListener('submit', createUser);
    await loadClubsIntoUserSelect();
    await loadUsers();
  });
})();