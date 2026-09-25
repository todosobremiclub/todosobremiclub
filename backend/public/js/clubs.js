(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // Estado global
  // =============================
  let clubsCache = [];
  let currentComments = [];
  let editingClubId = null;
  let editingClubApplyToken = null;

  // =============================
  // UI helpers
  // =============================
  function showClubMsg(text, ok = true) {
    const box = $('clubMsg');
    if (!box) return;
    box.className = 'msg ' + (ok ? 'ok' : 'err');
    box.textContent = text;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
  // Estado del club (UI badges)
  // =============================
  function normalizeEstado(v) {
  const s = String(v ?? '').trim().toLowerCase();

  if (!s) return 'pendiente';

  if (s === 'sin respuesta') return 'sin_respuesta';

  // Aceptamos ambos textos por seguridad, pero internamente usamos "bajo"
  if (s === 'baja') return 'bajo';
  if (s === 'bajo') return 'bajo';

  if (['productivo', 'avanzado', 'pendiente', 'sin_respuesta', 'bajo'].includes(s)) {
    return s;
  }

  return 'pendiente';
}

  function estadoLabel(key) {
  switch (key) {
    case 'productivo': return 'Productivo';
    case 'avanzado': return 'Avanzado';
    case 'pendiente': return 'Pendiente';
    case 'sin_respuesta': return 'Sin respuesta';
    case 'bajo': return 'Baja';
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

  async function fetchAuthClubs(url, options = {}) {
    const token = getTokenOrRedirect();
    const headers = { ...(options.headers || {}) };
    headers['Authorization'] = 'Bearer ' + token;

    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
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
  // Transferencias (CVU/ALIAS/TITULAR)
  // =============================
  function getTransferPayloadFromForm() {
    const cvu = $('club_transferencia_cvu')?.value?.trim() || null;
    const alias = $('club_transferencia_alias')?.value?.trim() || null;
    const titular = $('club_transferencia_titular')?.value?.trim() || null;
    return {
      transferencia_cvu: cvu,
      transferencia_alias: alias,
      transferencia_titular: titular,
    };
  }

  function setTransferFormFromClub(c) {
    if ($('club_transferencia_cvu')) $('club_transferencia_cvu').value = c?.transferencia_cvu ?? '';
    if ($('club_transferencia_alias')) $('club_transferencia_alias').value = c?.transferencia_alias ?? '';
    if ($('club_transferencia_titular')) $('club_transferencia_titular').value = c?.transferencia_titular ?? '';
  }

  // ✅ NUEVO: 3 modos de pago excluyentes entre sí (reemplaza al viejo
  // checkbox único "club_transferencia_habilitada").
  function getPaymentMode() {
    return $('club_payment_mode')?.value || 'ninguno';
  }

  function syncTransferFieldsVisibility() {
    const box = $('clubTransferBox');
    const modo = getPaymentMode();
    // ✅ 'ambos' también necesita cargar CVU/Alias/Titular (el socio puede
    // elegir informar una transferencia aunque el modo también ofrezca MP).
    if (box) box.style.display = (modo === 'transferencia_manual' || modo === 'ambos') ? 'block' : 'none';
  }

  function setTransferEnabledFromClub(c) {
    if ($('club_payment_mode')) {
      // Compat: si el club todavía no tiene payment_mode seteado (clubes
      // viejos, antes de esta migración), lo derivamos del booleano previo.
      $('club_payment_mode').value =
        c?.payment_mode || (c?.transferencia_habilitada ? 'transferencia_manual' : 'ninguno');
    }
    syncTransferFieldsVisibility();
    syncMpBoxFromClub(c);
  }

  // ✅ NUEVO: estado de conexión de Mercado Pago + botones conectar/desconectar
  function syncMpBoxFromClub(c) {
    const statusEl = $('clubMpStatus');
    const btnConectar = $('btnConectarMp');
    const btnDesconectar = $('btnDesconectarMp');
    const connected = c?.mp_connected === true;

    if (statusEl) {
      statusEl.textContent = connected
        ? '✅ Cuenta de Mercado Pago conectada'
        : '⚠️ Todavía no se conectó ninguna cuenta de Mercado Pago para este club';
      statusEl.style.color = connected ? '#16a34a' : '#d97706';
    }
    if (btnConectar) btnConectar.style.display = connected ? 'none' : 'inline-block';
    if (btnDesconectar) btnDesconectar.style.display = connected ? 'inline-block' : 'none';

    // No dejar elegir "Mercado Pago" ni "Ambos" en el select si la cuenta
    // no está conectada (los dos modos necesitan MP conectado).
    const optAuto = $('club_payment_mode')?.querySelector('option[value="mercadopago_auto"]');
    if (optAuto) optAuto.disabled = !connected;
    const optAmbos = $('club_payment_mode')?.querySelector('option[value="ambos"]');
    if (optAmbos) optAmbos.disabled = !connected;
  }

  // ✅ NUEVO: add-on de WhatsApp (mismo patrón que transferencia_habilitada)
  function syncWhatsappFieldsVisibility() {
    const enabled = $('club_whatsapp_habilitado')?.checked === true;
    const box = $('clubWhatsappBox');
    if (box) box.style.display = enabled ? 'block' : 'none';
  }

  function setWhatsappFormFromClub(c) {
    if ($('club_whatsapp_habilitado')) {
      $('club_whatsapp_habilitado').checked = c?.whatsapp_habilitado === true;
    }
    if ($('club_whatsapp_limite_mensual')) {
      $('club_whatsapp_limite_mensual').value = c?.whatsapp_limite_mensual ?? 300;
    }
    syncWhatsappFieldsVisibility();
  }

  async function saveTransferConfigForClub(clubId) {
    if (!clubId) return;

    // ✅ 'ambos' también guarda CVU/Alias/Titular.
    const modo = getPaymentMode();
    const enabled = modo === 'transferencia_manual' || modo === 'ambos';
    if (!enabled) return;

    const payload = getTransferPayloadFromForm();
    const allEmpty = !payload.transferencia_cvu && !payload.transferencia_alias && !payload.transferencia_titular;
    if (allEmpty) return;

    const res = await fetchAuthClubs(`/club/${clubId}/config/transferencia`, {
      method: 'PATCH',
      json: true,
      body: JSON.stringify(payload),
    });

    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      showClubMsg(data.error || '⚠️ Club guardado, pero no se pudo guardar CVU/Alias/Titular', false);
    }
  }

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

    const submitBtn = $('formClub')?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = on ? 'Guardar cambios' : 'Guardar club';
  }

  function renderClubComments(comments = []) {
    const box = $('clubCommentsList');
    if (!box) return;

    if (!comments || comments.length === 0) {
      box.innerHTML = '<div class="subcard">No hay comentarios.</div>';
      return;
    }

    box.innerHTML = comments.map((c) => `
      <div class="subcard" style="margin-top:8px;">
        <div style="font-size:12px;color:#6b7280;">${escapeHtml(fmtDateTime(c.created_at))}</div>
        <div style="margin-top:6px;white-space:pre-wrap;">${escapeHtml(c.comment)}</div>
      </div>
    `).join('');
  }

  function resetClubForm() {
    $('formClub')?.reset();
    if ($('club_id')) $('club_id').value = '';

    editingClubId = null;
    editingClubApplyToken = null;
    currentComments = [];

    if ($('club_new_comment')) $('club_new_comment').value = '';
    renderClubComments([]);

    if ($('club_color_primary') && !$('club_color_primary').value) $('club_color_primary').value = '#2563eb';
    if ($('club_color_secondary') && !$('club_color_secondary').value) $('club_color_secondary').value = '#1e40af';
    if ($('club_color_accent') && !$('club_color_accent').value) $('club_color_accent').value = '#facc15';

    if ($('club_transferencia_cvu')) $('club_transferencia_cvu').value = '';
    if ($('club_transferencia_alias')) $('club_transferencia_alias').value = '';
    if ($('club_transferencia_titular')) $('club_transferencia_titular').value = '';
    if ($('club_payment_mode')) $('club_payment_mode').value = 'ninguno';
    syncMpBoxFromClub(null); // ✅ NUEVO: club nuevo = sin MP conectado todavía

    // ✅ NUEVO: limpiar el link de conexión de MP del club anterior
    if ($('clubMpLinkInput')) $('clubMpLinkInput').value = '';
    if ($('clubMpLinkBox')) {
      $('clubMpLinkBox').classList.add('hidden');
      $('clubMpLinkBox').style.display = 'none';
    }

    if ($('club_whatsapp_habilitado')) $('club_whatsapp_habilitado').checked = false; // ✅ NUEVO
    if ($('club_whatsapp_limite_mensual')) $('club_whatsapp_limite_mensual').value = '300'; // ✅ NUEVO

if ($('club_payment_due_day')) $('club_payment_due_day').value = '31';

    if ($('club_socios_activos')) $('club_socios_activos').value = '';

    syncTransferFieldsVisibility();
    syncWhatsappFieldsVisibility(); // ✅ NUEVO
    setEditMode(false);
    const msg = $('clubMsg');
    if (msg) {
      msg.textContent = '';
      msg.className = 'msg';
      msg.style.display = 'none';
    }
  }

  function openClubForm(editMode = false) {
    $('clubModal')?.classList.remove('hidden');
    setEditMode(editMode);
  }

  function closeClubForm() {
    $('clubModal')?.classList.add('hidden');
    resetClubForm();
  }

  // =============================
  // Comentarios (histórico)
  // =============================
  async function loadClubComments(clubId) {
    if (!clubId) return;

    const res = await fetchAuthClubs(`/admin/clubs/${clubId}/comments`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
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
      ? `<img src="${escapeHtml(c.logo_url)}" alt="logo club" class="club-logo-thumb">`
      : '—';

    // ✅ NUEVO: refleja los 3 modos de pago en vez de un simple ✅/❌
    const modo = c.payment_mode || (c.transferencia_habilitada ? 'transferencia_manual' : 'ninguno');
    const transferenciaHtml =
      modo === 'ambos' ? '<span title="Mercado Pago + transferencia informada">🟢 MP + Transf.</span>' :
      modo === 'mercadopago_auto' ? '<span title="Pago automático por Mercado Pago">🟢 MP</span>' :
      modo === 'transferencia_manual' ? '<span title="Transferencia informada por el socio">✅ Transf.</span>' :
      '<span title="Sin pago automatizado">❌</span>';

    // ✅ NUEVO: mensajes de WhatsApp usados este mes vs. el límite configurado
    // para el club. Si el club no tiene el add-on habilitado, se muestra "—".
    let whatsappHtml = '<span class="muted" style="color:#9ca3af;">—</span>';
    if (c.whatsapp_habilitado) {
      const usados = Number(c.whatsapp_usados_mes ?? 0);
      const limite = Number(c.whatsapp_limite_mensual ?? 0);
      const pct = limite > 0 ? usados / limite : 0;
      // verde por debajo del 80% del límite, naranja entre 80% y 100%, rojo al llegar/superar el límite
      const color = pct >= 1 ? '#dc2626' : (pct >= 0.8 ? '#d97706' : '#16a34a');
      whatsappHtml = `<span style="color:${color}; font-weight:600;" title="Mensajes de WhatsApp usados este mes / límite mensual del club">${usados} / ${limite}</span>`;
    }

    return `
      <td>${logoHtml}</td>
      <td><strong>${escapeHtml(c.name ?? '')}</strong></td>
      <td>${escapeHtml(c.city ?? '')}</td>
      <td>${escapeHtml(c.province ?? '')}</td>
      <td>${renderEstadoBadge(c.estado)}</td>
      <td>${escapeHtml(String(c.socios_activos ?? '—'))}</td>
      <td>${transferenciaHtml}</td>
      <td>${whatsappHtml}</td>
      <td>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button type="button" title="Ver club" data-action="impersonate_ro" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name ?? '')}">👁️</button>
          <button type="button" title="Usuarios" data-action="users" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name ?? '')}">👥</button>
          <button type="button" title="Editar" data-action="edit" data-id="${escapeHtml(c.id)}">✏️</button>
          <button type="button" title="Eliminar" data-action="delete" data-id="${escapeHtml(c.id)}" style="color:#dc2626;">🗑️</button>
        </div>
      </td>
    `;
  }

  function renderClubsTable(list = []) {
    const tbody = $('clubs-table');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9">No hay resultados</td>
        </tr>
      `;
      return;
    }

    list.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = renderRow(c);
      tbody.appendChild(tr);
    });
  }

  function applyFilters() {
    const q = $('clubSearch')?.value?.trim().toLowerCase() || '';
    const selectedStatus = normalizeEstado($('clubStatusFilter')?.value || '');
    const statusFilterActive = Boolean($('clubStatusFilter')?.value);

    const filtered = clubsCache.filter((c) => {
      const matchesName = !q || String(c.name ?? '').toLowerCase().includes(q);
      const matchesStatus = !statusFilterActive || normalizeEstado(c.estado) === selectedStatus;
      return matchesName && matchesStatus;
    });

    renderClubsTable(filtered);
  }

  async function loadClubs() {
    const tbody = $('clubs-table');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="9">Cargando...</td>
      </tr>
    `;

    const res = await fetchAuthClubs('/admin/clubs');
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'Error cargando clubes', false);
      tbody.innerHTML = '';
      return;
    }

    clubsCache = data.clubs || [];
    applyFilters();
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
      return showClubMsg('Color primario inválido (#RRGGBB).', false);
    }
    if ($('club_color_secondary') && color_secondary && !validHexColor(color_secondary)) {
      return showClubMsg('Color secundario inválido (#RRGGBB).', false);
    }
    if ($('club_color_accent') && color_accent && !validHexColor(color_accent)) {
      return showClubMsg('Color acento inválido (#RRGGBB).', false);
    }

    const fd = new FormData();
    fd.append('name', name);
    fd.append('address', $('club_address')?.value?.trim() || '');
    fd.append('city', $('club_city')?.value?.trim() || '');
    fd.append('province', $('club_province')?.value?.trim() || '');
    fd.append('contact_name', $('club_contact_name')?.value?.trim() || '');
    fd.append('contact_phone', $('club_contact_phone')?.value?.trim() || '');
    fd.append('instagram_url', $('club_instagram')?.value?.trim() || '');
    fd.append('socios_cantidad', $('club_socios_cantidad')?.value?.trim() || '');
    fd.append('valor_mensual', $('club_valor_mensual')?.value?.trim() || '');
    fd.append('payment_due_day', $('club_payment_due_day')?.value?.trim() || '31');
    fd.append('estado', $('club_estado')?.value?.trim() || 'pendiente');
    fd.append('payment_mode', getPaymentMode()); // ✅ NUEVO: reemplaza a transferencia_habilitada
    fd.append('whatsapp_habilitado', $('club_whatsapp_habilitado')?.checked ? 'true' : 'false'); // ✅ NUEVO
    fd.append('whatsapp_limite_mensual', $('club_whatsapp_limite_mensual')?.value?.trim() || '300'); // ✅ NUEVO
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

      const savedClubId = id || data?.club?.id || data?.clubId || data?.id || data?.club_id || null;
      await saveTransferConfigForClub(savedClubId);

      showClubMsg(id ? '✅ Club actualizado' : '✅ Club creado', true);
      await loadClubs();
      closeClubForm();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function startEdit(id) {
    const c = clubsCache.find((x) => String(x.id) === String(id));
    if (!c) return;

    $('club_id').value = c.id;
    editingClubId = String(c.id);
    editingClubApplyToken = c.apply_token || null;

    $('club_name').value = c.name ?? '';
    $('club_address').value = c.address ?? '';
    $('club_city').value = c.city ?? '';
    $('club_province').value = c.province ?? '';
    $('club_contact_name').value = c.contact_name ?? '';
    $('club_contact_phone').value = c.contact_phone ?? '';
    $('club_instagram').value = c.instagram_url ?? '';

    setTransferFormFromClub(c);
    setTransferEnabledFromClub(c);
    setWhatsappFormFromClub(c); // ✅ NUEVO

    if ($('club_socios_cantidad')) $('club_socios_cantidad').value = c.socios_cantidad ?? '';
    if ($('club_valor_mensual')) $('club_valor_mensual').value = c.valor_mensual ?? '';
    if ($('club_payment_due_day')) $('club_payment_due_day').value = c.payment_due_day ?? 31;
    if ($('club_estado')) $('club_estado').value = normalizeEstado(c.estado);
    if ($('club_socios_activos')) $('club_socios_activos').value = c.socios_activos ?? '';

    const p = c.color_primary ?? '#2563eb';
    const s = c.color_secondary ?? '#1e40af';
    const a = c.color_accent ?? '#facc15';

    $('club_color_primary').value = validHexColor(p) ? p : '#2563eb';
    $('club_color_secondary').value = validHexColor(s) ? s : '#1e40af';
    $('club_color_accent').value = validHexColor(a) ? a : '#facc15';

    openClubForm(true);
    showClubMsg('Editando: ' + (c.name ?? ''), true);
    await loadClubComments(String(c.id));
  }

  async function impersonateReadonly(clubId, clubName) {
    if (!clubId) return;

    const currentToken = localStorage.getItem('token');
    if (currentToken && !localStorage.getItem('token_original')) {
      localStorage.setItem('token_original', currentToken);
    }

    const res = await fetchAuthClubs(`/admin/clubs/${clubId}/impersonate`, {
      method: 'POST',
      json: true,
      body: JSON.stringify({ role: 'solo_lectura' }),
    });
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      showClubMsg(data.error || 'No se pudo impersonar', false);
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('activeClubId', String(clubId));
    localStorage.setItem('impersonated', '1');
    localStorage.setItem('impersonatedClubName', String(clubName || data?.club?.name || ''));
    window.location.href = '/club.html';
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
    if ($('club_color_primary') && !$('club_color_primary').value) $('club_color_primary').value = '#2563eb';
    if ($('club_color_secondary') && !$('club_color_secondary').value) $('club_color_secondary').value = '#1e40af';
    if ($('club_color_accent') && !$('club_color_accent').value) $('club_color_accent').value = '#facc15';

    $('formClub')?.addEventListener('submit', saveClub);
    $('btnOpenClubForm')?.addEventListener('click', () => openClubForm(false));
    $('btnCloseClubForm')?.addEventListener('click', closeClubForm);
    $('clubSearch')?.addEventListener('input', applyFilters);
    $('clubStatusFilter')?.addEventListener('change', applyFilters);
    $('btnAddClubComment')?.addEventListener('click', addClubComment);
    $('club_payment_mode')?.addEventListener('change', syncTransferFieldsVisibility); // ✅ NUEVO
    $('club_whatsapp_habilitado')?.addEventListener('change', syncWhatsappFieldsVisibility); // ✅ NUEVO

    // ✅ NUEVO: conectar/desconectar Mercado Pago desde el modal de edición del club
    $('btnConectarMp')?.addEventListener('click', async () => {
      if (!editingClubId) {
        showClubMsg('Guardá el club primero antes de conectar Mercado Pago.', false);
        return;
      }
      try {
        const res = await fetchAuthClubs(`/mp/oauth/connect/${editingClubId}?json=1`);
        const data = await safeJson(res);
        if (!res.ok || !data.ok || !data.oauthUrl) {
          showClubMsg(data.error || 'No se pudo iniciar la conexión con Mercado Pago', false);
          return;
        }
        // Se abre en una pestaña nueva para no perder el modal de edición del club.
        window.open(data.oauthUrl, '_blank');
        showClubMsg('Completá la conexión en la pestaña nueva y volvé a abrir este club para ver el estado.', true);
      } catch (e) {
        showClubMsg('Error iniciando conexión con Mercado Pago', false);
      }
    });

    // ✅ NUEVO: generar (y copiar) el link público para que el club conecte
    // su PROPIA cuenta de Mercado Pago, sin que el superadmin tenga que
    // loguearse con la cuenta de MP del club.
    $('btnGenerarLinkMp')?.addEventListener('click', async () => {
      if (!editingClubId) {
        showClubMsg('Guardá el club primero antes de generar el link de Mercado Pago.', false);
        return;
      }
      const btn = $('btnGenerarLinkMp');
      const box = $('clubMpLinkBox');
      const input = $('clubMpLinkInput');
      if (btn) btn.disabled = true;
      try {
        const res = await fetchAuthClubs(`/admin/clubs/${editingClubId}/mp/public-link`);
        const data = await safeJson(res);
        if (!res.ok || !data.ok || !data.url) {
          showClubMsg(data.error || 'No se pudo generar el link', false);
          return;
        }
        if (input) input.value = data.url;
        if (box) {
          box.classList.remove('hidden');
          box.style.display = 'block';
        }
        // Copiado automático a portapapeles, con fallback manual si el
        // navegador no lo permite (ej: http sin contexto seguro).
        try {
          await navigator.clipboard.writeText(data.url);
          showClubMsg('✅ Link copiado al portapapeles. Pasáselo al club.', true);
        } catch {
          input?.select();
          showClubMsg('Link generado. Copialo manualmente del campo de abajo.', true);
        }
      } catch (e) {
        showClubMsg('Error generando el link de Mercado Pago', false);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $('btnCopiarLinkMp')?.addEventListener('click', async () => {
      const input = $('clubMpLinkInput');
      if (!input?.value) return;
      try {
        await navigator.clipboard.writeText(input.value);
        showClubMsg('✅ Link copiado al portapapeles.', true);
      } catch {
        input.select();
        showClubMsg('No se pudo copiar automáticamente. Usá Ctrl+C con el texto seleccionado.', false);
      }
    });

    $('btnDesconectarMp')?.addEventListener('click', async () => {
      if (!editingClubId) return;
      if (!confirm('¿Desconectar la cuenta de Mercado Pago de este club? Si el club estaba en modo "Mercado Pago", vuelve a "Sin pago automatizado".')) return;

      try {
        const res = await fetchAuthClubs(`/admin/clubs/${editingClubId}/mp/disconnect`, { method: 'POST' });
        const data = await safeJson(res);
        if (!res.ok || !data.ok) {
          showClubMsg(data.error || 'No se pudo desconectar Mercado Pago', false);
          return;
        }
        showClubMsg('✅ Mercado Pago desconectado', true);
        await loadClubs();
        const c = clubsCache.find((x) => String(x.id) === String(editingClubId));
        if (c) {
          setTransferEnabledFromClub(c);
        }
      } catch (e) {
        showClubMsg('Error desconectando Mercado Pago', false);
      }
    });

    $('clubModal')?.addEventListener('click', (ev) => {
      if (ev.target?.id === 'clubModal') closeClubForm();
    });

    $('clubs-table')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const name = btn.dataset.name;

      if (action === 'impersonate_ro') {
        impersonateReadonly(id, name);
        return;
      }
      if (action === 'users') {
        window.openUsersForClub?.(id, name);
        return;
      }
      if (action === 'edit') {
        startEdit(id);
        return;
      }
      if (action === 'delete') {
        delClub(id);
      }
    });

    syncTransferFieldsVisibility();
    loadClubs();
  });
})();
