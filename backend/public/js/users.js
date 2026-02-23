function showUserMsg(text, type) {
  const box = document.getElementById('userMsg');
  if (!box) return;

  box.style.display = 'block';
  box.style.padding = '10px';
  box.style.borderRadius = '6px';
  box.style.marginTop = '10px';

  if (type === 'ok') {
    box.style.background = '#e7f7ea';
    box.style.border = '1px solid #b6e2be';
    box.style.color = '#1f6b2a';
  } else {
    box.style.background = '#fdeaea';
    box.style.border = '1px solid #f3b6b6';
    box.style.color = '#8a1f1f';
  }

  box.textContent = text;
}

// Wrapper fetch con token + manejo 401 (sesión expirada)
async function fetchAuth(url, options = {}) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Tu sesión expiró. Por favor iniciá sesión nuevamente.');
    window.location.href = '/admin.html';
    throw new Error('Sin token');
  }

  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + token;

  // Si enviamos body y no especificamos JSON, lo ponemos
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    alert('Tu sesión expiró. Por favor iniciá sesión nuevamente.');
    window.location.href = '/admin.html';
    throw new Error('Token inválido');
  }

  return res;
}

async function loadClubsIntoUserSelect() {
  const sel = document.getElementById('user_club_id');
  if (!sel) return;

  const res = await fetchAuth('/admin/clubs');
  const data = await res.json();

  if (!data.ok) {
    sel.innerHTML = '<option value="">Error cargando clubes</option>';
    return;
  }

  sel.innerHTML = '<option value="">Seleccionar...</option>';
  data.clubs.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name}${c.city ? ' - ' + c.city : ''}`;
    sel.appendChild(opt);
  });
}

async function loadUsers() {
  const tbody = document.getElementById('users-table');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';

  const res = await fetchAuth('/admin/users');
  const data = await res.json();

  if (!data.ok) {
    tbody.innerHTML = '<tr><td colspan="3">Error cargando usuarios</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  data.users.forEach(u => {
    const rolesHtml = (u.roles || []).map(r => `${r.role} (${r.club_name})`).join('<br>');
    const estado = u.is_active ? 'Activo' : 'Inactivo';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.email}</td>
      <td>${rolesHtml}</td>
      <td>${estado}</td>
    `;
    tbody.appendChild(tr);
  });

  if (data.users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3">No hay usuarios</td></tr>';
  }
}

async function createUser(e) {
  e.preventDefault();

  const full_name = document.getElementById('user_full_name').value.trim();
  const email = document.getElementById('user_email').value.trim().toLowerCase();
  const password = document.getElementById('user_password').value;
  const role = document.getElementById('user_role').value;
  const club_id = document.getElementById('user_club_id').value;

  if (!email || !password || !role || !club_id) {
    showUserMsg('Completá email, contraseña, rol y club.', 'err');
    return;
  }

  const payload = {
    email,
    full_name: full_name || null,
    password,
    assignments: [
      { club_id, role }
    ]
  };

  const res = await fetchAuth('/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    showUserMsg(data.error || 'No se pudo crear el usuario', 'err');
    return;
  }

  showUserMsg('✅ Usuario creado correctamente', 'ok');
  document.getElementById('formUser').reset();

  await loadUsers();
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('formUser');
  if (form) form.addEventListener('submit', createUser);

  await loadClubsIntoUserSelect();
  await loadUsers();
});