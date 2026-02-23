async function loadUsers() {
  const token = localStorage.getItem('token');

  const res = await fetch('/admin/users', {
    headers: {
      'Authorization': 'Bearer ' + token
    }
  });

  const data = await res.json();
  if (!data.ok) return alert('Error cargando usuarios');

  const tbody = document.getElementById('users-table');
  tbody.innerHTML = '';

  data.users.forEach(u => {
    const roles = u.roles.map(r =>
      `${r.role} (${r.club_name})`
    ).join('<br>');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.email}</td>
      <td>${roles}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', loadUsers);