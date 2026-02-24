const $ = (id) => document.getElementById(id);

function showClubMsg(text, ok = true) {
  const box = $('clubMsg');
  if (!box) return;
  box.className = 'msg ' + (ok ? 'ok' : 'err');
  box.textContent = text;
}

function getToken() {
  const t = localStorage.getItem('token');
  if (!t) {
    alert('Sesión expirada');
    window.location.href = '/admin.html';
    throw new Error('No token');
  }
  return t;
}

async function fetchAuth(url, options = {}) {
  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + getToken();
  return fetch(url, { ...options, headers });
}

let clubsCache = [];

async function loadClubs() {
  const tbody = $('clubs-table');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

  const res = await fetchAuth('/admin/clubs');
  const data = await res.json();

  if (!res.ok || !data.ok) {
    showClubMsg(data.error || 'Error cargando clubes', false);
    tbody.innerHTML = '';
    return;
  }

  clubsCache = data.clubs;
  tbody.innerHTML = '';

  if (!clubsCache.length) {
    tbody.innerHTML = `<tr><td colspan="5">No hay clubes</td></tr>`;
    return;
  }

  clubsCache.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.logo_url ? `<img src="${c.logo_url}" height="40">` : '—'}</td>
      <td>${c.name}</td>
      <td>${c.city || ''}</td>
      <td>${c.province || ''}</td>
      <td>
        <button onclick="editClub('${c.id}')">Editar</button>
        <button onclick="deleteClub('${c.id}')">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function saveClub(e) {
  e.preventDefault();

  const id = $('club_id').value;
  const fd = new FormData();
  fd.append('name', $('club_name').value);
  fd.append('address', $('club_address').value);
  fd.append('city', $('club_city').value);
  fd.append('province', $('club_province').value);

  if ($('club_logo').files[0]) fd.append('logo', $('club_logo').files[0]);
  if ($('club_background').files[0]) fd.append('background', $('club_background').files[0]);

  const url = id ? `/admin/clubs/${id}` : '/admin/clubs';
  const method = id ? 'PUT' : 'POST';

  const res = await fetchAuth(url, { method, body: fd });
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); }
  catch { return showClubMsg(text, false); }

  if (!res.ok || !data.ok) {
    showClubMsg(data.error || 'Error guardando club', false);
    return;
  }

  showClubMsg(id ? '✅ Club actualizado' : '✅ Club creado', true);
  resetForm();
  loadClubs();
}

function editClub(id) {
  const c = clubsCache.find(x => x.id === id);
  if (!c) return;
  $('club_id').value = c.id;
  $('club_name').value = c.name;
  $('club_address').value = c.address || '';
  $('club_city').value = c.city || '';
  $('club_province').value = c.province || '';
  $('club_cancel_btn').style.display = 'inline-block';
}

async function deleteClub(id) {
  if (!confirm('¿Eliminar club?')) return;
  const res = await fetchAuth(`/admin/clubs/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.ok) return showClubMsg(data.error, false);
  showClubMsg('✅ Club eliminado', true);
  loadClubs();
}

function resetForm() {
  $('formClub').reset();
  $('club_id').value = '';
  $('club_cancel_btn').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  $('formClub').addEventListener('submit', saveClub);
  $('club_cancel_btn').addEventListener('click', resetForm);
  loadClubs();
});