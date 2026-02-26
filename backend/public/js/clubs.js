(() => {
  const $ = (id) => document.getElementById(id);

  function showClubMsg(text, ok = true) {
    const box = $('clubMsg');
    if (!box) return;
    box.className = 'msg ' + (ok ? 'ok' : 'err');
    box.textContent = text;
  }

  // =============================
  // Auth (JWT token)
  // =============================
  function getTokenOrRedirect() {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Sesión expirada. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('Sin token');
    }
    return token;
  }

  // ✅ Fetch auth SOLO para /admin/clubs (token Bearer)
  // - No setea Content-Type si mandamos FormData (browser lo arma)
  async function fetchAuthClubs(url, options = {}) {
    const token = getTokenOrRedirect();

    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + token;

    // Si explícitamente mandamos JSON (no es el caso principal acá), seteamos Content-Type
    // pero OJO: si body es FormData, NO hay que setearlo.
    const isFormData = (typeof FormData !== 'undefined') && (options.body instanceof FormData);
    if (options.json && !isFormData) headers['Content-Type'] = 'application/json';

    const { json, ...rest } = options;

    const res = await fetch(url, { ...rest, headers });

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    return res;
  }

  // =============================
  // Estado / UI
  // =============================
  let clubsCache = [];

  function setEditMode(on) {
    const cancelBtn = $('club_cancel_btn');
    const submitBtn = $('club_submit_btn');
    if (cancelBtn) cancelBtn.style.display = on ? 'inline-block' : 'none';
    if (submitBtn) submitBtn.textContent = on ? 'Guardar cambios' : 'Guardar club';
  }

  function resetClubForm() {
    $('formClub')?.reset();
    if ($('club_id')) $('club_id').value = '';
    setEditMode(false);
  }

  function renderRow(c) {
    const logoHtml = c.logo_url
      ? `<img src="${c.logo_url}" alt="logo" style="width:42px;height:42px;object-fit:cover;border-radius:8px;border:1px solid #ddd" />`
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

  // =============================
  // API calls
  // =============================
  async function loadClubs() {
    const tbody = $('clubs-table');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

    const res = await fetchAuthClubs('/admin/clubs');
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'Error cargando clubes', false);
      tbody.innerHTML = '';
      return;
    }

    clubsCache = data.clubs || [];
    tbody.innerHTML = '';

    if (!clubsCache.length) {
      tbody.innerHTML = `<tr><td colspan="5">No hay clubes</td></tr>`;
      return;
    }

    clubsCache.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = renderRow(c);
      tbody.appendChild(tr);
    });
  }

  async function saveClub(e) {
    e.preventDefault();

    const id = $('club_id')?.value?.trim() || '';
    const name = $('club_name')?.value?.trim() || '';

    if (!name) return showClubMsg('El nombre es obligatorio', false);

    const fd = new FormData();
    fd.append('name', name);
    fd.append('address', $('club_address')?.value?.trim() || '');
    fd.append('city', $('club_city')?.value?.trim() || '');
    fd.append('province', $('club_province')?.value?.trim() || '');

    const logoFile = $('club_logo')?.files?.[0];
    const bgFile = $('club_background')?.files?.[0];
    if (logoFile) fd.append('logo', logoFile);
    if (bgFile) fd.append('background', bgFile);

    const url = id ? `/admin/clubs/${id}` : '/admin/clubs';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchAuthClubs(url, { method, body: fd });

    // Si por algún motivo el backend responde HTML ante error, lo capturamos:
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return showClubMsg('Error guardando club: ' + text.slice(0, 120), false); }

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'No se pudo guardar', false);
      return;
    }

    showClubMsg(id ? '✅ Club actualizado' : '✅ Club creado', true);
    resetClubForm();
    await loadClubs();
  }

  function startEdit(id) {
    const c = clubsCache.find(x => String(x.id) === String(id));
    if (!c) return;

    $('club_id').value = c.id;
    $('club_name').value = c.name || '';
    $('club_address').value = c.address || '';
    $('club_city').value = c.city || '';
    $('club_province').value = c.province || '';

    // file inputs no se precargan por seguridad (normal)
    setEditMode(true);
    showClubMsg('Editando: ' + c.name, true);
  }

  async function delClub(id) {
    const c = clubsCache.find(x => String(x.id) === String(id));
    if (!confirm(`¿Eliminar el club "${c?.name || id}"?`)) return;

    const res = await fetchAuthClubs(`/admin/clubs/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'No se pudo eliminar', false);
      return;
    }

    showClubMsg('✅ Club eliminado', true);
    resetClubForm();
    await loadClubs();
  }

  // =============================
  // Bind
  // =============================
  document.addEventListener('DOMContentLoaded', () => {
    $('formClub')?.addEventListener('submit', saveClub);

    $('club_cancel_btn')?.addEventListener('click', () => {
      resetClubForm();
      showClubMsg('Edición cancelada', true);
    });

    $('clubs-table')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'edit') startEdit(id);
      if (action === 'delete') delClub(id);
    });

    loadClubs();
  });
})();