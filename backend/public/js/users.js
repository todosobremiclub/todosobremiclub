async function fetchAuthUsers(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + token;
  return fetch(url, { ...options, headers });
}

async function loadUsers() {
  const tbody = document.getElementById('users-table');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="2">Cargando...</td></tr>';

  const res = await fetchAuthUsers('/admin/users');
  const data = await res.json();

  if (!data.ok) {
    tbody.innerHTML = '<tr><td colspan="2">Error cargando usuarios</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  data.users.forEach(u => {
    const roles = (u.roles || []).map(r => `${r.role} (${r.club_name})`).join('<br>');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.email}</td>
      <td>${roles}</td>
    `;
    tbody.appendChild(tr);
  });

  if (data.users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">No hay usuarios</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', loadUsers);