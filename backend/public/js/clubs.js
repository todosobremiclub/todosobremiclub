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

  const isFormData = (options.body instanceof FormData);
  if (!isFormData) headers['Content-Type'] = 'application/json';

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

  if (!data.ok) {
    showClubMsg(data.error || 'Error cargando clubes', false);
    return;
  }

  data.clubs.forEach(c => {
    const logoHtml = c.logo_url
      ? `<img src="${c.logo_url}" class="thumb" />`
      : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${logoHtml}</td>
      <td>${c.name}</td>
      <td>${c.city || ''}</td>
      <td>${c.province || ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function createClub(e) {
  e.preventDefault();

  const formData = new FormData();
  formData.append('name', document.getElementById('club_name').value.trim());
  formData.append('address', document.getElementById('club_address').value.trim());
  formData.append('city', document.getElementById('club_city').value.trim());
  formData.append('province', document.getElementById('club_province').value.trim());

  const logoFile = document.getElementById('club_logo').files[0];
  const bgFile = document.getElementById('club_background').files[0];

  if (logoFile) formData.append('logo', logoFile);
  if (bgFile) formData.append('background', bgFile);

  const res = await fetchAuth('/admin/clubs', { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    showClubMsg(data.error || 'No se pudo crear el club', false);
    return;
  }

  showClubMsg('✅ Club creado (logo y fondo subidos a Firebase)', true);
  document.getElementById('formClub').reset();
  await loadClubs();
}

document.getElementById('formClub').addEventListener('submit', createClub);
loadClubs();