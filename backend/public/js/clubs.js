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

  function fmtMoney(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    // ARS formato simple
    return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('es-AR');
    } catch {
      return String(iso);
    }
  }

// =============================
// Estado del club (UI)
// =============================
function normalizeEstado(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 'pendiente';
  if (s === 'sin respuesta') return 'sin_respuesta';
  if (['productivo','avanzado','pendiente','sin_respuesta'].includes(s)) return s;
  return 'pendiente';
}
function estadoLabel(key) {
  switch (key) {
    case 'productivo': return 'Productivo';
    case 'avanzado': return 'Avanzado';
    case 'sin_respuesta': return 'Sin respuesta';
    default: return 'Pendiente';
  }
}
function renderEstadoBadge(v) {
  const k = normalizeEstado(v);
  const label = estadoLabel(k);
  return `<span class="status-badge status-${k}">${escapeHtml(label)}</span>`;
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

  // Fetch auth para /admin/clubs (soporta JSON y FormData)
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

  async function safeJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: text };
    }
  }

  // =============================
  // Estado
  // =============================
  let clubsCache = [];
  let currentComments = []; // historial comentarios del club en edición

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

    // El submit no tiene id, lo buscamos dentro del form
    const submitBtn = $('formClub')?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = on ? 'Guardar cambios' : 'Guardar club';
  }

  function resetClubForm() {
    $('formClub')?.reset();
    if ($('club_id')) $('club_id').value = '';

    // limpiar comentarios
    currentComments = [];
    if ($('club_new_comment')) $('club_new_comment').value = '';
    renderClubComments([]);

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
  // Comentarios (histórico)
  // =============================
  function renderClubComments(comments = []) {
    const box = $('clubCommentsList');
    if (!box) return;

    if (!comments || comments.length === 0) {
      box.innerHTML = `<div style="color:#6b7280;">No hay comentarios.</div>`;
      return;
    }

    box.innerHTML = comments
      .map(
        (c) => `
        <div style="border-left:3px solid #2563eb; padding:6px 10px; margin-bottom:8px; background:#fafafa; border-radius:8px;">
          <div style="font-size:12px; color:#6b7280; margin-bottom:4px;">
            ${escapeHtml(fmtDateTime(c.created_at))}
          </div>
          <div>${escapeHtml(c.comment)}</div>
        </div>
      `
      )
      .join('');
  }

  async function loadClubComments(clubId) {
    if (!clubId) return;
    const res = await fetchAuthClubs(`/admin/clubs/${clubId}/comments`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      console.warn('⚠️ No se pudieron cargar comentarios:', data.error || data);
      currentComments = [];
      renderClubComments([]);
      return;
    }

    currentComments = data.comments || [];
    renderClubComments(currentComments);
  }

  async function addClubComment() {
    const clubId = $('club_id')?.value?.trim();
    if (!clubId) {
      showClubMsg('Primero guardá el club para poder agregar comentarios.', false);
      return;
    }

    const txt = $('club_new_comment')?.value?.trim();
    if (!txt) return;

    const btn = $('btnAddClubComment');
    if (btn) btn.disabled = true;

    try {
      const res = await fetchAuthClubs(`/admin/clubs/${clubId}/comments`, {
        method: 'POST',
        json: true,
        body: JSON.stringify({ comment: txt }),
      });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        showClubMsg(data.error || 'Error agregando comentario', false);
        return;
      }

      // limpiar input y refrescar lista (agregamos al inicio)
      $('club_new_comment').value = '';
      currentComments = [data.comment, ...(currentComments || [])];
      renderClubComments(currentComments);
      showClubMsg('✅ Comentario agregado', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // =============================
  // Render tabla clubes
  // =============================
  function renderRow(c) {
    const logoHtml = c.logo_url
  ? `<img src="${escapeHtml(c.logo_url)}" class="club-logo-thumb" alt="logo club">`
  : '—';


    const extra = [
      c.socios_cantidad != null ? `Socios: ${escapeHtml(String(c.socios_cantidad))}` : null,
      c.valor_mensual != null ? `Mensual: ${escapeHtml(fmtMoney(c.valor_mensual))}` : null,
    ].filter(Boolean).join(' · ');

    return `
      <td>${logoHtml}</td>
      <td>
        <div style="font-weight:700;">${escapeHtml(c.name ?? '')}</div>
        ${extra ? `<div style="color:#6b7280; font-size:12px; margin-top:4px;">${extra}</div>` : ''}
      </td>
      <td>${escapeHtml(c.city ?? '')}</td>
      <td>${escapeHtml(c.province ?? '')}</td>
<td>${renderEstadoBadge(c.estado)}</td>
<td style="text-align:right;">${escapeHtml(String(c.socios_act
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

    tbody.innerHTML = `<tr><td colspan="7">Cargando...</td></tr>`;

    const res = await fetchAuthClubs('/admin/clubs');
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'Error cargando clubes', false);
      tbody.innerHTML = '';
      return;
    }

    clubsCache = data.clubs || [];
    tbody.innerHTML = '';

    if (!clubsCache.length) {
      tbody.innerHTML = `<tr><td colspan="7">No hay clubes</td></tr>`;
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

    // ✅ nuevos campos (opcionales)
    fd.append('socios_cantidad', $('club_socios_cantidad')?.value?.trim() || '');
    fd.append('valor_mensual', $('club_valor_mensual')?.value?.trim() || '');
fd.append('estado', $('club_estado')?.value?.trim() || 'pendiente');

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
      const data = await safeJson(res);

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

  async function startEdit(id) {
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

    // ✅ nuevos campos
    if ($('club_socios_cantidad')) $('club_socios_cantidad').value = c.socios_cantidad ?? '';
    if ($('club_valor_mensual')) $('club_valor_mensual').value = c.valor_mensual ?? '';
if ($('club_estado')) $('club_estado').value = (c.estado ?? 'pendiente');
if ($('club_socios_activos')) $('club_socios_activos').value = (c.socios_activos ?? '');

    const p = c.color_primary ?? '#2563eb';
    const s = c.color_secondary ?? '#1e40af';
    const a = c.color_accent ?? '#facc15';

    $('club_color_primary').value = validHexColor(p) ? p : '#2563eb';
    $('club_color_secondary').value = validHexColor(s) ? s : '#1e40af';
    $('club_color_accent').value = validHexColor(a) ? a : '#facc15';

    openClubForm(true);
    showClubMsg('Editando: ' + (c.name ?? ''), true);

    // ✅ cargar comentarios del club
    await loadClubComments(String(c.id));
  }

  async function delClub(id) {
    const c = clubsCache.find((x) => String(x.id) === String(id));
    if (!confirm(`¿Eliminar el club "${c?.name || id}"?`)) return;

    const res = await fetchAuthClubs(`/admin/clubs/${id}`, { method: 'DELETE' });
    const data = await safeJson(res);

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

    $('btnAddClubComment')?.addEventListener('click', addClubComment);

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