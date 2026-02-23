function showClubMsg(text, type) {
  const box = document.getElementById('clubMsg');
  if (!box) return;

  box.className = 'msg ' + (type === 'ok' ? 'ok' : 'err');
  box.textContent = text;
}

// Wrapper: fetch con token + manejo de sesión expirada
async function fetchAuth(url, options = {}) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Tu sesión expiró. Por favor iniciá sesión nuevamente.');
    window.location.href = '/admin.html';
    throw new Error('Sin token');
  }

  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + token;

  // Si mandamos body y no especificamos JSON, lo ponemos
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });

  // Si el backend devuelve 401, sesión expirada / token inválido
  if (res.status === 401) {
    localStorage.removeItem('token');
    alert('Tu sesión expiró. Por favor iniciá sesión nuevamente.');
    window.location.href = '/admin.html';
    throw new Error('Token inválido');
  }

  return res;
}

async function loadClubs() {
  const tbody = document.getElementById('clubs-table');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';

  const res = await fetchAuth('/admin/clubs');
  const data = await res.json();

  if (!data.ok) {
    showClubMsg(data.error || 'Error al cargar clubes', 'err');
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = '';

  // data.clubs viene del endpoint GET /admin/clubs
  data.clubs.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.city || ''}</td>
      <td>${c.province || ''}</td>
    `;
    tbody.appendChild(tr);
  });

  if (data.clubs.length === 0) {
