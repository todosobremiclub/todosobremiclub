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

    const isFormData =
      typeof FormData !== 'undefined' && options.body instanceof FormData;

    if (options.json && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }

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

    // limpiar campos de contacto
    if ($('club_contact_name')) $('club_contact_name').value = '';
    if ($('club_contact_phone')) $('club_contact_phone').value = '';
    if ($('club_instagram')) $('club_instagram').value = '';

    // Defaults de colores (por si el navegador deja vacío)
    if ($('club_color_primary') && !$('club_color_primary').value)
      $('club_color_primary').value = '#2563eb';
    if ($('club_color_secondary') && !$('club_color_secondary').value)
      $('club_color_secondary').value = '#1e40af';
    if ($('club_color_accent') && !$('club_color_accent').value)
      $('club_color_accent').value = '#facc15';
  }

// =============================
// Abrir / Cerrar formulario de Club
// =============================
function openClubForm(editMode = false) {
  const card = $('clubFormCard');
  if (card) card.style.display = 'block';

  const title = $('clubFormTitle');
  if (title) {
    title.textContent = editMode ? 'Editar club' : 'Crear club';
  }
}

function closeClubForm() {
  const card = $('clubFormCard');
  if (card) card.style.display = 'none';

  resetClubForm();
  showClubMsg('Edición cancelada', true);
}

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderRow(c) {
    // Logo miniatura
    const logoHtml = c.logo_url
      ? `<img class="thumb" src="${escapeHtml(c.logo_url)}" alt="logo" />`
      : '—';

    // Colores (si vienen del backend)
    const p = c.color_primary || c.club_color_primary;
    const s = c.color_secondary || c.club_color_secondary;
    const a = c.color_accent || c.club_color_accent;

    const colorsHtml =
      p || s || a
        ? `
      <div style="display:flex; gap:6px; align-items:center;">
        ${
          p
            ? `<span title="Primario ${escapeHtml(
                p
              )}" style="width:14px;height:14px;border-radius:4px;border:1px solid #ddd;background:${escapeHtml(
                p
              )};"></span>`
            : ''
        }
        ${
          s
            ? `<span title="Secundario ${escapeHtml(
                s
              )}" style="width:14px;height:14px;border-radius:4px;border:1px solid #ddd;background:${escapeHtml(
                s
              )};"></span>`
            : ''
        }
        ${
          a
            ? `<span title="Acento ${escapeHtml(
                a
              )}" style="width:14px;height:14px;border-radius:4px;border:1px solid #ddd;background:${escapeHtml(
                a
              )};"></span>`
            : ''
        }
      </div>
    `
        : '—';

    return `
      <td>${logoHtml}</td>
      <td>
        <div style="font-weight:700;">${escapeHtml(c.name ?? '')}</div>
        <div style="color:#6b7280; font-size:12px; margin-top:4px;">
          Colores: ${colorsHtml}
        </div>
      </td>
      <td>${escapeHtml(c.city ?? '')}</td>
      <td>${escapeHtml(c.province ?? '')}</td>
      <td style="white-space:nowrap;">
  <button data-action="users" data-id="${escapeHtml(String(c.id))}" data-name="${escapeHtml(String(c.name ?? ''))}">
    Usuarios
  </button>
  <button data-action="edit" data-id="${escapeHtml(String(c.id))}">Editar</button>
  <button data-action="delete" data-id="${escapeHtml(String(c.id))}">Eliminar</button>
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

    clubsCache.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = renderRow(c);
      tbody.appendChild(tr);
    });
  }

  function validHexColor(v) {
    if (!v) return false;
    return /^#[0-9a-fA-F]{6}$/.test(String(v).trim());
  }

  async function saveClub(e) {
    e.preventDefault();

    const id = $('club_id')?.value?.trim() || '';
    const name = $('club_name')?.value?.trim() || '';
    if (!name) return showClubMsg('El nombre es obligatorio', false);

    const color_primary = $('club_color_primary')?.value?.trim() || '';
    const color_secondary = $('club_color_secondary')?.value?.trim() || '';
    const color_accent = $('club_color_accent')?.value?.trim() || '';

    const contact_name = $('club_contact_name')?.value?.trim() || '';
    const contact_phone = $('club_contact_phone')?.value?.trim() || '';
    const instagram_url = $('club_instagram')?.value?.trim() || '';

    if ($('club_color_primary') && color_primary && !validHexColor(color_primary)) {
      return showClubMsg('Color primario inválido (use formato #RRGGBB).', false);
    }
    if ($('club_color_secondary') && color_secondary && !validHexColor(color_secondary)) {
      return showClubMsg('Color secundario inválido (use formato #RRGGBB).', false);
    }
    if ($('club_color_accent') && color_accent && !validHexColor(color_accent)) {
      return showClubMsg('Color acento inválido (use formato #RRGGBB).', false);
    }

    const fd = new FormData();
    fd.append('name', name);
    fd.append('address', $('club_address')?.value?.trim() || '');
    fd.append('city', $('club_city')?.value?.trim() || '');
    fd.append('province', $('club_province')?.value?.trim() || '');

    // campos de contacto
    fd.append('contact_name', contact_name);
    fd.append('contact_phone', contact_phone);
    fd.append('instagram_url', instagram_url);

    // colores
    if ($('club_color_primary'))
      fd.append('color_primary', color_primary || '#2563eb');
    if ($('club_color_secondary'))
      fd.append('color_secondary', color_secondary || '#1e40af');
    if ($('club_color_accent'))
      fd.append('color_accent', color_accent || '#facc15');

    const logoFile = $('club_logo')?.files?.[0];
    const bgFile = $('club_background')?.files?.[0];
    if (logoFile) fd.append('logo', logoFile);
    if (bgFile) fd.append('background', bgFile);

    const url = id ? `/admin/clubs/${id}` : '/admin/clubs';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchAuthClubs(url, { method, body: fd });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return showClubMsg('Error guardando club: ' + text.slice(0, 180), false);
    }

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'No se pudo guardar', false);
      return;
    }

    showClubMsg(id ? '✅ Club actualizado' : '✅ Club creado', true);
resetClubForm();
await loadClubs();

// ✅ Si fue ALTA, abrir panel de usuarios del club recién creado
if (!id && data?.club?.id) {
  window.openUsersForClub?.(String(data.club.id), String(data.club.name || name));
}

  function startEdit(id) {
  const c = clubsCache.find((x) => String(x.id) === String(id));
  if (!c) return;
  $('club_id').value = c.id;
  $('club_name').value = c.name ?? '';
  $('club_address').value = c.address ?? '';
  $('club_city').value = c.city ?? '';
  $('club_province').value = c.province ?? '';
  if ($('club_contact_name'))
    $('club_contact_name').value = c.contact_name ?? '';
  if ($('club_contact_phone'))
    $('club_contact_phone').value = c.contact_phone ?? '';
  if ($('club_instagram'))
    $('club_instagram').value = c.instagram_url ?? '';
  const p = c.color_primary ?? c.club_color_primary;
  const s = c.color_secondary ?? c.club_color_secondary;
  const a = c.color_accent ?? c.club_color_accent;
  if ($('club_color_primary'))
    $('club_color_primary').value = validHexColor(p) ? p : '#2563eb';
  if ($('club_color_secondary'))
    $('club_color_secondary').value = validHexColor(s) ? s : '#1e40af';
  if ($('club_color_accent'))
    $('club_color_accent').value = validHexColor(a) ? a : '#facc15';
  setEditMode(true);
  showClubMsg('Editando: ' + c.name, true);
  openClubForm(true); // 👈 NUEVO
}


  async function delClub(id) {
    const c = clubsCache.find((x) => String(x.id) === String(id));
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
  if ($('club_color_primary') && !$('club_color_primary').value)
    $('club_color_primary').value = '#2563eb';
  if ($('club_color_secondary') && !$('club_color_secondary').value)
    $('club_color_secondary').value = '#1e40af';
  if ($('club_color_accent') && !$('club_color_accent').value)
    $('club_color_accent').value = '#facc15';

  $('formClub')?.addEventListener('submit', saveClub);

  // 👇 NUEVO: botones del formulario de Clubes
  $('btnOpenClubForm')?.addEventListener('click', () => openClubForm(false));
  $('btnCloseClubForm')?.addEventListener('click', closeClubForm);
  // ☝️ FIN NUEVO

  $('club_cancel_btn')?.addEventListener('click', () => {
    resetClubForm();
    showClubMsg('Edición cancelada', true);
  });

  $('clubs-table')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const name = btn.dataset.name;

  if (action === 'users') {
    // abre panel de usuarios del club (lo maneja users.js)
    window.openUsersForClub?.(id, name);
    return;
  }
  if (action === 'edit') startEdit(id);
  if (action === 'delete') delClub(id);
});

  loadClubs();
});
})();