// ========== Helpers seguros ==========
function $(id) { return document.getElementById(id); }

function showClubMsg(text, ok = true) {
  const box = $('clubMsg');
  if (!box) {
    console.warn('clubMsg no existe en el DOM:', text);
    return;
  }
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

// ========== Estado edición ==========
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

// ========== Render tabla ==========
function renderClubRow(c) {
  const logoHtml = c.logo_url
    ? `<img src="${c.logo_url}" alt="logo" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1px solid #ddd;">`
    : '—';

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

let clubsCache = [];

// ========== Cargar clubes ==========
async function loadClubs() {
  const tbody = $('clubs-table');
  if (!tbody) {
    console.warn('clubs-table no existe en el DOM');
    return;
  }

  tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

  try {
    const res = await fetchAuth('/admin/clubs');
    const data = await res.json();

    if (!data.ok) {
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

// ========== Crear o editar ==========
async function saveClub(e) {
  e.preventDefault();

  const id = $('club_id')?.value?.trim();
  const name = $('club_name')?.value?.trim();
  const address = $('club_address')?.value?.trim();
  const city = $('club_city')?.value?.trim();
  const province = $('club_province')?.value?.trim();

  if (!name) return showClubMsg('El nombre es obligatorio', false);

  const formData = new FormData();
  formData.append('name', name);
  formData.append('address', address || '');
  formData.append('city', city || '');
  formData.append('province', province || '');

  const logoFile = $('club_logo')?.files?.[0];
  const bgFile = $('club_background')?.files?.[0];
  if (logoFile) formData.append('logo', logoFile);
  if (bgFile) formData.append('background', bgFile);

  try {
    let res, data;

    if (id) {
      // EDIT
      res = await fetchAuth(`/admin/clubs/${id}`, { method: 'PUT', body: formData });
      data = await res.json();
      if (!res.ok || !data.ok) return showClubMsg(data.error || 'No se pudo editar', false);
      showClubMsg('✅ Club actualizado', true);
    } else {
      // CREATE
      res = await fetchAuth('/admin/clubs', { method: 'POST', body: formData });
      data = await res.json();
      if (!res.ok || !data.ok) return showClubMsg(data.error || 'No se pudo crear', false);
      showClubMsg('✅ Club creado', true);
    }

    resetClubForm();
    await loadClubs();

  } catch (err) {
    showClubMsg('Error guardando club: ' + err.message, false);
  }
}

// ========== Editar (llenar form) ==========
function startEditClub(id) {
  const c = clubsCache.find(x => x.id === id);
  if (!c) return;

  $('club_id').value = c.id;
  $('club_name').value = c.name || '';
  $('club_address').value = c.address || '';
  $('club_city').value = c.city || '';
  $('club_province').value = c.province || '';

  // Nota: por seguridad, file inputs no se pueden setear por JS.
  // Si querés cambiar logo/fondo, seleccionás archivo nuevo.
  setEditMode(true);
  showClubMsg('Editando club: ' + c.name, true);
}

// ========== Eliminar ==========
async function deleteClub(id) {
  const c = clubsCache.find(x => x.id === id);
  const name = c?.name || id;

  if (!confirm(`¿Eliminar el club "${name}"?`)) return;

  try {
    const res = await fetchAuth(`/admin/clubs/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      return showClubMsg(data.error || 'No se pudo eliminar', false);
    }

    showClubMsg('✅ Club eliminado', true);
    resetClubForm();
    await loadClubs();

  } catch (err) {
    showClubMsg('Error eliminando club: ' + err.message, false);
  }
}

// ========== Eventos ==========
document.addEventListener('DOMContentLoaded', () => {
  const form = $('formClub');
  if (form) form.addEventListener('submit', saveClub);

  const cancel = $('club_cancel_btn');
  if (cancel) cancel.addEventListener('click', () => {
    resetClubForm();
    showClubMsg('Edición cancelada', true);
  });

  // Delegación de eventos para botones editar/eliminar
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