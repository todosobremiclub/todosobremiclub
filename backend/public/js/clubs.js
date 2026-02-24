// helpers
const $ = (id) => document.getElementById(id);

function showClubMsg(text, ok = true) {
  const box = $('clubMsg');
  if (!box) return console.warn('clubMsg missing:', text);
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

// Fetch auth que NO rompe multipart
async function fetchAuth(url, options = {}) {
  const token = getToken();

  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    alert('Sesión expirada');
    window.location.href = '/admin.html';
    throw new Error('401');
  }
  return res;
}

// Estado UI
let clubsCache = [];
function setEditMode(on) {
  const cancelBtn = $('club_cancel_btn');
  const submitBtn = $('club_submit_btn');
  if (cancelBtn) cancelBtn.style.display = on ? 'inline-block' : 'none';
  if (submitBtn) submitBtn.textContent = on ? 'Guardar cambios' : 'Guardar club';
}

function resetClubForm() {
  const form = $('formClub');
  if (form) form.reset();
  if ($('club_id')) $('club_id').value = '';
  setEditMode(false);
}

// Render tabla
function renderClubRow(c) {
  const logoHtml = c.logo_url ? `<img src="${c.logo_url}" style="width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">` : '—';
  return `
    <td>${logoHtml}</td>
    <td>${c.name}</td>
    <td>${c.city || ''}</td>
    <td>${c.province || ''}</td>
    <td>
      <button data-action="edit" data-id="${c.id}">Editar</button>
      <button data-action="delete" data-id="${c.id}">Eliminar</button>
    </td>
  `;
}

async function loadClubs() {
  const tbody = $('clubs-table');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

  try {
    const res = await fetchAuth('/admin/clubs');
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'Error cargando clubes', false);
      tbody.innerHTML = '';
      return;
    }

    clubsCache = data.clubs || [];
    tbody.innerHTML = '';

    if (clubsCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No hay clubes</td></tr>`;
      return;
    }

    clubsCache.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = renderClubRow(c);
      tbody.appendChild(tr);
    });

  } catch (e) {
    showClubMsg('Error cargando clubes: ' + e.message, false);
    tbody.innerHTML = '';
  }
}

// Crear / Editar (FormData SIEMPRE)
async function saveClub(e) {
  e.preventDefault();

  const id = $('club_id')?.value?.trim() || '';
  const name = $('club_name')?.value?.trim() || '';
  const address = $('club_address')?.value?.trim() || '';
  const city = $('club_city')?.value?.trim() || '';
  const province = $('club_province')?.value?.trim() || '';

  if (!name) return showClubMsg('El nombre es obligatorio', false);

  const formData = new FormData();
  formData.append('name', name);
  formData.append('address', address);
  formData.append('city', city);
  formData.append('province', province);

  const logoFile = $('club_logo')?.files?.[0];
  const bgFile = $('club_background')?.files?.[0];
  if (logoFile) formData.append('logo', logoFile);
  if (bgFile) formData.append('background', bgFile);

  try {
    const url = id ? `/admin/clubs/${id}` : '/admin/clubs';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchAuth(url, { method, body: formData });

    // Si falla body-parser, a veces Render manda HTML. Esto evita el "Unexpected token <"
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0,120) }; }

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'No se pudo guardar', false);
      return;
    }

    showClubMsg(id ? '✅ Club actualizado' : '✅ Club creado', true);
    resetClubForm();
    await loadClubs();

  } catch (err) {
    showClubMsg('Error guardando club: ' + err.message, false);
  }
}

function startEditClub(id) {
  const c = clubsCache.find(x => x.id === id);
  if (!c) return;

  $('club_id').value = c.id;
  $('club_name').value = c.name || '';
  $('club_address').value = c.address || '';
  $('club_city').value = c.city || '';
  $('club_province').value = c.province || '';

  setEditMode(true);
  showClubMsg('Editando: ' + c.name, true);
}

async function deleteClub(id) {
  const c = clubsCache.find(x => x.id === id);
  const name = c?.name || id;

  if (!confirm(`¿Eliminar el club "${name}"?`)) return;

  try {
    const res = await fetchAuth(`/admin/clubs/${id}`, { method: 'DELETE' });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0,120) }; }

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'No se pudo eliminar', false);
      return;
    }

    showClubMsg('✅ Club eliminado', true);
    resetClubForm();
    await loadClubs();

  } catch (err) {
    showClubMsg('Error eliminando: ' + err.message, false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = $('formClub');
  if (form) form.addEventListener('submit', saveClub);

  const cancel = $('club_cancel_btn');
  if (cancel) cancel.addEventListener('click', () => {
    resetClubForm();
    showClubMsg('Edición cancelada', true);
  });

  const tbody = $('clubs-table');
  if (tbody) {
    tbody.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'edit') startEditClub(id);
      if (action === 'delete') deleteClub(id);
    });
  }

  loadClubs();
});