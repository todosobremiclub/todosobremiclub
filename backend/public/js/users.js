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

      clubsCache.forEach((c) => {
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

    usersCache.forEach((u) => {
      const roles = (u.roles ?? [])
        .map((r) => `${r.role}${r.club_name ? ' (' + r.club_name + ')' : ''}`)
        .join('<br>');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.email}</td>
        <td>${roles}</td>
        <td>${u.is_active ? 'Activo' : 'Inactivo'}</td>
        <td>
          <button
            type="button"
            onclick="toggleUser('${u.id}', ${u.is_active})"
          >
            ${u.is_active ? 'Desactivar' : 'Activar'}
          </button>
          <button
            type="button"
            onclick="editUser('${u.id}')"
          >
            Editar
          </button>
          <button
            type="button"
            onclick="deleteUser('${u.id}')"
          >
            Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =============================
  // Reset form (vuelve a modo "Crear usuario")
  // =============================
  function resetUserForm() {
    const form = $('formUser');
    if (form) form.reset();

    const idInput = $('user_id');
    if (idInput) idInput.value = '';

    const btn = $('userSubmitBtn');
    if (btn) btn.textContent = 'Crear usuario';
  }

function openUserForm(editMode = false) {
  $('userFormCard').style.display = 'block';
  $('userFormTitle').textContent = editMode ? 'Editar usuario' : 'Crear usuario';
}

function closeUserForm() {
  $('userFormCard').style.display = 'none';
  resetUserForm();
}

  // =============================
  // Crear / Actualizar usuario
  // =============================
  async function createOrUpdateUser(e) {
  e.preventDefault();

  const id = $('user_id')?.value?.trim() || ''; // vacío = alta, con valor = edición
  const email = $('user_email').value.trim().toLowerCase();
  const password = $('user_password').value;
  const role = $('user_role').value;
  const fullName = $('user_full_name')?.value?.trim() || null;

  const clubSelect = $('user_club_id');
  const club_ids = [...clubSelect.selectedOptions].map((o) => o.value);

  if (!email || (!id && !password) || !role || !club_ids.length) {
    showUserMsg(
      'Completá email, rol, clubes y contraseña (solo en alta).',
      false
    );
    return;
  }

  // assignments: mismo rol para todos los clubes seleccionados
  const assignments = club_ids.map((club_id) => ({ club_id, role }));

  const payload = {
    email,
    assignments,
  };

  // solo mando password si estoy creando o explícitamente se cargó algo
  if (!id && password) {
    payload.password = password;
  } else if (id && password) {
    // opcional: permitir cambio de password al editar
    payload.password = password;
  }

  // si el backend soporta full_name, lo incluimos
  if (fullName) {
    payload.full_name = fullName;
  }

  // ⚠️ FIX: si estamos editando, mandamos is_active actual
  if (id) {
    const existing = usersCache.find(u => String(u.id) === String(id));
    if (existing && typeof existing.is_active === 'boolean') {
      payload.is_active = existing.is_active;
    }
  }

  let url = '/admin/users';
  let method = 'POST';

  if (id) {
    // edición
    url = `/admin/users/${id}`;
    method = 'PUT'; // si tu API usa PATCH, acá cambiar a 'PATCH'
  }

  const res = await fetchAuth(url, {
    method,
    body: JSON.stringify(payload),
    json: true,
  });

  const data = await res.json();

  if (!data.ok) {
    showUserMsg(data.error || 'Error guardando usuario', false);
    return;
  }

  showUserMsg(id ? '✅ Usuario actualizado' : '✅ Usuario creado', true);

  // reseteamos formulario a modo "alta"
  resetUserForm();
  await loadUsers();
}

  // =============================
  // Toggle activo/inactivo
  // =============================
  window.toggleUser = async (id, isActive) => {
    if (
      !confirm(
        `¿Seguro que querés ${isActive ? 'desactivar' : 'activar'} este usuario?`
      )
    )
      return;

    const res = await fetchAuth(`/admin/users/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !isActive }),
      json: true,
    });

    const data = await res.json();
    if (!data.ok) {
      showUserMsg(data.error || 'Error', false);
      return;
    }

    loadUsers();
  };

  // =============================
  // Editar usuario (rellenar formulario)
  // =============================
  window.editUser = (id) => {
    const user = usersCache.find((u) => String(u.id) === String(id));
    if (!user) {
      showUserMsg('No se encontró el usuario seleccionado.', false);
      return;
    }

    // id oculto
    const idInput = $('user_id');
    if (idInput) idInput.value = user.id;

    // nombre completo (si lo usás)
    if ($('user_full_name')) {
      $('user_full_name').value = user.full_name || '';
    }

    $('user_email').value = user.email || '';

    // rol principal: si tiene varios, tomamos el primero
    const primaryRole =
      user.roles && user.roles.length ? user.roles[0].role : 'staff';
    $('user_role').value = primaryRole;

    // clubes asignados
    const clubSelect = $('user_club_id');
    const assignedClubIds = (user.roles || [])
      .map((r) => String(r.club_id))
      .filter(Boolean);

    [...clubSelect.options].forEach((opt) => {
      opt.selected = assignedClubIds.includes(String(opt.value));
    });

    // password vacío (solo si quieren cambiarla)
    $('user_password').value = '';

    const btn = $('userSubmitBtn');
    if (btn) btn.textContent = 'Guardar cambios';

    showUserMsg(`Editando usuario ${user.email}`, true);
openUserForm(true);
  };

  // =============================
  // Eliminar
  // =============================
  window.deleteUser = async (id) => {
    if (!confirm('¿Seguro que querés eliminar este usuario?')) return;

    try {
      const res = await fetchAuth(`/admin/users/${id}`, {
        method: 'DELETE',
        json: true,
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
  $('formUser')?.addEventListener('submit', createOrUpdateUser);
  resetUserForm();

  // 👇 AGREGAR ESTO AQUÍ
  $('btnOpenUserForm')?.addEventListener('click', () => openUserForm(false));
  $('btnCloseUserForm')?.addEventListener('click', closeUserForm);
  // ☝️ FIN DE LO NUEVO

  await loadClubsIntoUserSelect();
  await loadUsers();
});
})();
