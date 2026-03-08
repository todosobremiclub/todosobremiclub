(() => {
  const $ = (id) => document.getElementById(id);

  let usersCache = [];
  let clubsCache = [];

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

    const { json, ...rest } = options;
    const res = await fetch(url, { ...rest, headers });

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert(res.status === 403 ? 'No autorizado.' : 'Sesión inválida.');
      window.location.href = '/admin.html';
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

  async function loadUsers() {
    const tbody = $('users-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';

    const res = await fetchAuth('/admin/users');
    const data = await res.json();

    usersCache = data.users || [];
    tbody.innerHTML = '';

    usersCache.forEach(u => {
      const roles = (u.roles || [])
        .map(r => `${r.role}${r.club_name ? ' (' + r.club_name + ')' : ''}`)
        .join('\n');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.email}</td>
        <td style="white-space:pre-line;">${roles}</td>
        <td>${u.is_active ? 'Activo' : 'Inactivo'}</td>
        <td>
          <button onclick="toggleUser('${u.id}', ${u.is_active})">
            ${u.is_active ? 'Desactivar' : 'Activar'}
          </button>
          <button onclick="editUser('${u.id}')">Editar</button>
          <button onclick="deleteUser('${u.id}')">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

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

    showUserMsg('✅ Usuario actualizado', true);
    loadUsers();
  };

  document.addEventListener('DOMContentLoaded', loadUsers);
})();