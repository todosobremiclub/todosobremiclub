async function loadClubs() {
  const token = localStorage.getItem('token');

  const res = await fetch('/admin/clubs', {
    headers: {
      'Authorization': 'Bearer ' + token
    }
  });

  const data = await res.json();
  if (!data.ok) return alert('Error cargando clubes');

  const tbody = document.getElementById('clubs-table');
  tbody.innerHTML = '';

  data.clubs.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.city || ''}</td>
      <td>${c.province || ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', loadClubs);