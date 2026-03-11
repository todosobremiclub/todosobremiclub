(() => {
  const $ = (id) => document.getElementById(id);

  let usersCache = [];
  let clubsCache = [];

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

  function showUserMsg(text, ok = true) {
    const box = $('userMsg');
    if (!box) return;
    box.className = 'msg ' + (ok ? 'ok' : 'err');
    box.textContent = text;
  }

  // =============================
  // ✅ CARGAR CLUBES
  // =============================
  async function loadClubsIntoUserSelect() {
    const sel = $('user_club_id');
    if (!sel) return;

    sel.innerHTML = '<option>Cargando clubes...</option>';

    try {
      const res = await fetchAuth('/admin/clubs');
      const data = await res.json();

      if (!res.ok || !data.ok) {
        sel.innerHTML = '<option>Error cargando clubes</option>';
        return;
      }

      clubsCache = data.clubs || [];
      sel.innerHTML = '';

      if (!clubsCache.length) {
        sel.innerHTML = '<option>No hay clubes</option>';
        return;
      }

      clubsCache.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name}${c.city ? ' - ' + c.city : ''}`;
        sel.appendChild(opt);
      });
    } catch (e) {
      console.error(e);
      sel.innerHTML = '<option>Error cargando clubes</option>';
    }
  }

  // =============================
  // Usuarios
  // =============================
  async function loadUsers() {
    const tbody = $('users-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';

    const res = await fetchAuth('/admin/users');
    const data = await res.json();

    usersCache = data.users || [];
    tbody.innerHTML = '';

    usersCache.forEach(u => {
      const roles = (u.roles ?? [])
        .map(r => `${r.role}${r.club_name ? ' (' + r.club_name + ')' : ''}`)
        .join('<br>');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.email}</td>
        <td>${roles}</td>
        <td>${u.is_active ? 'Activo' : 'Inactivo'}</td>
        <td>
          <button type="button"
                  onclick="toggleUser(${u.id}, ${u.is_active})">
            ${u.is_active ? 'Desactivar' : 'Activar'}
          </button>
          <button type="button"
                  onclick="editUser(${u.id})">
            Editar
          </button>
          <button type="button"
                  onclick="deleteUser(${u.id})">
            Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =============================
  // Crear usuario
  // =============================
  async function createUser(e) {
    e.preventDefault();

    const email = $('user_email').value.trim().toLowerCase();
    const password = $('user_password').value;
    const role = $('user_role').value;
    const clubSelect = $('user_club_id');
    const club_ids = [...clubSelect.selectedOptions].map(o => o.value);

    if (!email || !password || !role || !club_ids.length) {
      showUserMsg('Completá email, contraseña, rol y al menos un club.', false);
      return;
    }

    const payload = {
      email,
      password,
      assignments: club_ids.map(club_id => ({ club_id, role }))
    };

    const res = await fetchAuth('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
      json: true
    });

    const data = await res.json();
    if (!data.ok) {
      showUserMsg(data.error || 'Error creando usuario', false);
      return;
    }

    showUserMsg('✅ Usuario creado', true);
    $('formUser').reset();
    loadUsers();
  }

  // =============================
  // Toggle activo/inactivo
  // =============================
  window.toggleUser = async (id, isActive) => {
    if (!confirm(`¿Seguro que querés ${isActive ? 'desactivar' : 'activar'} este usuario?`)) return;

    const res = await fetchAuth(`/admin/users/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !isActive }),
      json: true
    });

    const data = await res.json();
    if (!data.ok) {
      showUserMsg(data.error || 'Error', false);
      return;
    }

    loadUsers();
  };

  // =============================
  // Editar (lo dejamos vacío por ahora)
  // =============================
  window.editUser = window.editUser || (() => {});

  // =============================
  // Eliminar (implementado)
  // =============================
  window.deleteUser = async (id) => {
    if (!confirm('¿Seguro que querés eliminar este usuario?')) return;

    try {
      const res = await fetchAuth(`/admin/users/${id}`, {
        method: 'DELETE',
        json: true
      });
      const data = await res.json();

      if (!data.ok) {
        showUserMsg(data.error || 'Error eliminando usuario', false);
        return;
      }

      showUserMsg('✅ Usuario eliminado', true);
      await loadUsers();
    } catch (e) {
      console.error(e);
      showUserMsg('Error eliminando usuario', false);
    }
  };

  // =============================
  // Init
  // =============================
  document.addEventListener('DOMContentLoaded', async () => {
    $('formUser')?.addEventListener('submit', createUser);
    await loadClubsIntoUserSelect(); // ✅ Carga clubes
    await loadUsers();               // ✅ Carga usuarios
  });
})();