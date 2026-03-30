(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // UI helpers
  // =============================
  function showClubMsg(text, ok = true) {
    const box = $('clubMsg');
    if (!box) return;
    box.className = 'msg ' + (ok ? 'ok' : 'err');
    box.textContent = text;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
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

  // Fetch auth SOLO para /admin/clubs
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
  // Estado
  // =============================
  let clubsCache = [];

  // =============================
  // Form helpers
  // =============================
  function validHexColor(v) {
    if (!v) return false;
    return /^#[0-9a-fA-F]{6}$/.test(String(v).trim());
  }

  function setEditMode(on) {
    const title = $('clubFormTitle');
    if (title) title.textContent = on ? 'Editar club' : 'Crear club';

    // En el HTML nuevo el botón submit no tiene id: lo buscamos dentro del form
    const submitBtn = $('formClub')?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = on ? 'Guardar cambios' : 'Guardar club';
  }

  function resetClubForm() {
    $('formClub')?.reset();
    if ($('club_id')) $('club_id').value = '';

    // Defaults de colores
    if ($('club_color_primary') && !$('club_color_primary').value)
      $('club_color_primary').value = '#2563eb';
    if ($('club_color_secondary') && !$('club_color_secondary').value)
      $('club_color_secondary').value = '#1e40af';
    if ($('club_color_accent') && !$('club_color_accent').value)
      $('club_color_accent').value = '#facc15';

    setEditMode(false);
  }

  function openClubForm(editMode = false) {
    const card = $('clubFormCard');
    if (card) card.style.display = 'block';
    setEditMode(editMode);
  }

  function closeClubForm() {
    const card = $('clubFormCard');
    if (card) card.style.display = 'none';
    resetClubForm();
  }

  // =============================
  // Render tabla clubes
  // =============================
  function renderRow(c) {
    const logoHtml = c.logo_url
      ? `<img class="thumb" src="${escapeHtml(c.logo_url)}" alt="logo" />`
      : '—';

    return `
      <td>${logoHtml}</td>
      <td>${escapeHtml(c.name ?? '')}</td>
      <td>${escapeHtml(c.city ?? '')}</td>
      <td>${escapeHtml(c.province ?? '')}</td>
      <td style="white-space:nowrap;">
        <button data-action="users"
                data-id="${escapeHtml(String(c.id))}"
                data-name="${escapeHtml(String(c.name ?? ''))}">
          Usuarios
        </button>
        <button data-action="edit" data-id="${escapeHtml(String(c.id))}">Editar</button>
        <button data-action="delete" data-id="${escapeHtml(String(c.id))}">Eliminar</button>
      </td>
    `;
  }

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

  // =============================
  // Crear / editar club
  // =============================
  async function saveClub(e) {
    e.preventDefault();

    const id = $('club_id')?.value?.trim() || '';
    const name = $('club_name')?.value?.trim() || '';
    if (!name) return showClubMsg('El nombre es obligatorio', false);

    const color_primary = $('club_color_primary')?.value?.trim() || '';
    const color_secondary = $('club_color_secondary')?.value?.trim() || '';
    const color_accent = $('club_color_accent')?.value?.trim() || '';

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

    // contacto
    fd.append('contact_name', $('club_contact_name')?.value?.trim() || '');
    fd.append('contact_phone', $('club_contact_phone')?.value?.trim() || '');
    fd.append('instagram_url', $('club_instagram')?.value?.trim() || '');

    // colores
    fd.append('color_primary', color_primary || '#2563eb');
    fd.append('color_secondary', color_secondary || '#1e40af');
    fd.append('color_accent', color_accent || '#facc15');

    const logoFile = $('club_logo')?.files?.[0];
    const bgFile = $('club_background')?.files?.[0];
    if (logoFile) fd.append('logo', logoFile);
    if (bgFile) fd.append('background', bgFile);

    const url = id ? `/admin/clubs/${id}` : '/admin/clubs';
    const method = id ? 'PUT' : 'POST';

    const submitBtn = $('formClub')?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetchAuthClubs(url, { method, body: fd });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        showClubMsg(data.error || 'No se pudo guardar', false);
        return;
      }

      showClubMsg(id ? '✅ Club actualizado' : '✅ Club creado', true);
      await loadClubs();

      // Si fue alta, abrir panel de usuarios del club recién creado
      if (!id && data?.club?.id) {
        window.openUsersForClub?.(String(data.club.id), String(data.club.name || name));
      }

      closeClubForm();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function startEdit(id) {
    const c = clubsCache.find((x) => String(x.id) === String(id));
    if (!c) return;

    $('club_id').value = c.id;
    $('club_name').value = c.name ?? '';
    $('club_address').value = c.address ?? '';
    $('club_city').value = c.city ?? '';
    $('club_province').value = c.province ?? '';
    $('club_contact_name').value = c.contact_name ?? '';
    $('club_contact_phone').value = c.contact_phone ?? '';
    $('club_instagram').value = c.instagram_url ?? '';

    const p = c.color_primary ?? '#2563eb';
    const s = c.color_secondary ?? '#1e40af';
    const a = c.color_accent ?? '#facc15';

    $('club_color_primary').value = validHexColor(p) ? p : '#2563eb';
    $('club_color_secondary').value = validHexColor(s) ? s : '#1e40af';
    $('club_color_accent').value = validHexColor(a) ? a : '#facc15';

    openClubForm(true);
    showClubMsg('Editando: ' + (c.name ?? ''), true);

    // Opcional: al editar también podés abrir el panel de usuarios del club
    // window.openUsersForClub?.(String(c.id), String(c.name ?? ''));
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
    await loadClubs();
  }

  // =============================
  // Init / Bind
  // =============================
  document.addEventListener('DOMContentLoaded', () => {
    // Defaults colores
    if ($('club_color_primary') && !$('club_color_primary').value)
      $('club_color_primary').value = '#2563eb';
    if ($('club_color_secondary') && !$('club_color_secondary').value)
      $('club_color_secondary').value = '#1e40af';
    if ($('club_color_accent') && !$('club_color_accent').value)
      $('club_color_accent').value = '#facc15';

    $('formClub')?.addEventListener('submit', saveClub);
    $('btnOpenClubForm')?.addEventListener('click', () => openClubForm(false));
    $('btnCloseClubForm')?.addEventListener('click', closeClubForm);

    $('clubs-table')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const name = btn.dataset.name;

      if (action === 'users') {
        window.openUsersForClub?.(id, name);
        return;
      }
      if (action === 'edit') startEdit(id);
      if (action === 'delete') delClub(id);
    });

    loadClubs();
  });
})();