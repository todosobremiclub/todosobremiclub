function showClubMsg(text, ok = true) {
  const box = document.getElementById('clubMsg');
  box.className = 'msg ' + (ok ? 'ok' : 'err');
  box.textContent = text;
}

async function fetchAuth(url, options = {}) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Sesión expirada');
    window.location.href = '/admin.html';
    throw new Error('No token');
  }

  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + token;
  headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    alert('Sesión expirada');
    window.location.href = '/admin.html';
    throw new Error('401');
  }

  return res;
}

async function loadClubs() {
  const tbody = document.getElementById('clubs-table');
  tbody.innerHTML = '';

  const res = await fetchAuth('/admin/clubs');
  const data = await res.json();

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

async function createClub(e) {
  e.preventDefault();

  const payload = {
    name: club_name.value,
    address: club_address.value,
    city: club_city.value,
    province: club_province.value
  };

  const res = await fetchAuth('/admin/clubs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!data.ok) return showClubMsg(data.error, false);

  showClubMsg('✅ Club creado');
  e.target.reset();
  loadClubs();
}

document.getElementById('formClub').addEventListener('submit', createClub);
loadClubs();