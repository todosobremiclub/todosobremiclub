(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // Auth / helpers (TOKEN)
  // =============================
  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club activo seleccionado. Volvé al panel del club.');
      window.location.href = '/club.html';
      throw new Error('No activeClubId');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

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
    try { return JSON.parse(text); }
    catch { return { ok: false, error: text }; }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function fmtDMY(iso) {
    if (!iso) return '';
    const s = String(iso).slice(0, 10); // YYYY-MM-DD
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}-${m}-${y}`;
  }

  function yearFromISO(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 4);
  }

  // =============================
  // Estado pago (usa backend pago_al_dia)
  // =============================
  function pagoEstado(s) {
    if (s.becado) return { ok: true, label: 'Becado' };
    if (s.pago_al_dia === true) return { ok: true, label: 'Al día' };
    return { ok: false, label: 'Impago' };
  }

  function renderPagoPill(s) {
    const est = pagoEstado(s);
    const cls = est.ok ? 'pay-ok' : 'pay-bad';
    const txt = est.ok ? '🟢' : '🔴';
    return `<span class="pay-pill ${cls}" title="${escapeHtml(est.label)}">${txt}</span>`;
  }

  // =============================
  // Estado
  // =============================
  let editingId = null;
  let sociosCache = [];
  let draftPhoto = null; // { dataUrl, base64, mimetype, filename }

  // =============================
// Photo viewer
// =============================
function ensurePhotoViewer() {
  if (document.getElementById('photoViewerModal')) return;

  const modal = document.createElement('div');
  modal.id = 'photoViewerModal';
  modal.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.75);
    display:none; align-items:center; justify-content:center;
    z-index:9999; padding:18px;
  `;

  modal.innerHTML = `
    <div style="background:#111827; color:#fff; padding:10px 12px; border-radius:10px; max-width:92vw;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <strong>Foto socio</strong>
        <button id="photoViewerClose" style="border:0; border-radius:8px; padding:6px 10px; cursor:pointer;">✕ Cerrar</button>
      </div>
      <div style="margin-top:10px; display:flex; justify-content:center;">
        <img id="photoViewerImg" style="max-width:86vw; max-height:78vh; border-radius:10px; background:#fff;" alt="Foto"/>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    modal.style.display = 'none';
    const img = document.getElementById('photoViewerImg');
    if (img) img.src = '';
  };

  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
  modal.querySelector('#photoViewerClose').addEventListener('click', close);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal.style.display === 'flex') close();
  });
}

function openPhotoViewer(url) {
  ensurePhotoViewer();
  const modal = document.getElementById('photoViewerModal');
  const img = document.getElementById('photoViewerImg');
  if (!modal || !img) return;
  img.src = url;
  modal.style.display = 'flex';
}

  // =============================
  // Draft photo UI (solo modal socio)
  // =============================
  const draftPhotoInput = document.createElement('input');
  draftPhotoInput.type = 'file';
  draftPhotoInput.accept = 'image/*';
  draftPhotoInput.style.display = 'none';

  function ensureDraftPhotoUI() {
    if (!document.body.contains(draftPhotoInput)) document.body.appendChild(draftPhotoInput);

    const modal = document.getElementById('modalSocio');
    if (!modal) return;

    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) return;

    if (document.getElementById('socioDraftPhotoBox')) return;

    const box = document.createElement('div');
    box.id = 'socioDraftPhotoBox';
    box.style.cssText = `
      margin-top: 10px; padding: 10px;
      border: 1px dashed #ddd; border-radius: 10px; background: #fafafa;
    `;

    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <strong>Foto del socio</strong>
        <div style="display:flex; gap:8px;">
          <button id="btnSocioPickFoto" type="button">Elegir</button>
          <button id="btnSocioClearFoto" type="button">Quitar</button>
        </div>
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; align-items:center;">
        <img id="socioFotoDraftPreview" alt="Preview"
          style="width:70px; height:70px; border-radius:10px; object-fit:cover; display:none; border:1px solid #ddd; background:#fff; cursor:pointer;" />
        <div class="muted" id="socioFotoDraftMeta" style="font-size:12px;">Sin foto seleccionada.</div>
      </div>

      <div class="muted" style="font-size:12px; margin-top:8px;">
        La foto se sube al presionar <b>Guardar</b>.
      </div>
    `;

    const actions = modalContent.querySelector('.modal-actions');
    if (actions) modalContent.insertBefore(box, actions);
    else modalContent.appendChild(box);

    box.querySelector('#btnSocioPickFoto').addEventListener('click', () => draftPhotoInput.click());
    box.querySelector('#btnSocioClearFoto').addEventListener('click', () => setDraftPhoto(null));

    box.querySelector('#socioFotoDraftPreview').addEventListener('click', () => {
      if (draftPhoto?.dataUrl) openPhotoViewer(draftPhoto.dataUrl);
    });

    draftPhotoInput.addEventListener('change', async () => {
      const file = draftPhotoInput.files && draftPhotoInput.files[0];
      draftPhotoInput.value = '';
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        alert('La imagen supera 2MB. Elegí una más liviana.');
        return;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Error leyendo archivo'));
        r.readAsDataURL(file);
      });

      const comma = dataUrl.indexOf(',');
      if (comma < 0) {
        alert('No se pudo leer la imagen.');
        return;
      }

      setDraftPhoto({
        dataUrl,
        base64: dataUrl.slice(comma + 1),
        mimetype: file.type || 'image/jpeg',
        filename: file.name || 'socio.jpg'
      });
    });
  }

  function setDraftPhoto(photo) {
    draftPhoto = photo;

    const img = document.getElementById('socioFotoDraftPreview');
    const meta = document.getElementById('socioFotoDraftMeta');
    if (!img || !meta) return;

    if (!draftPhoto) {
      img.style.display = 'none';
      img.src = '';
      meta.textContent = 'Sin foto seleccionada.';
      return;
    }

    img.src = draftPhoto.dataUrl;
    img.style.display = 'inline-block';
    meta.textContent = `${draftPhoto.filename} • ${draftPhoto.mimetype}`;
  }

  async function uploadSocioFotoById(socioId, photoPayload) {
    const clubId = getActiveClubId();
    const payload = {
      base64: photoPayload.base64,
      mimetype: photoPayload.mimetype,
      filename: photoPayload.filename || 'socio.jpg'
    };

    const res = await fetchAuth(`/club/${clubId}/socios/${socioId}/foto`, {
      method: 'POST',
      body: JSON.stringify(payload),
      json: true
    });

    const data = await safeJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo subir la foto');
    return data;
  }

  // =============================
  // Modal socio alta/edición
  // =============================
  function openModalNew() {
    editingId = null;
    setDraftPhoto(null);

    $('modalSocioTitle').textContent = 'Nuevo socio';
    $('socioNumero').value = '';
    $('socioDni').value = '';
    $('socioNombre').value = '';
    $('socioApellido').value = '';
    $('socioCategoria').value = '';
    $('socioTelefono').value = '';
    $('socioNacimiento').value = '';
    $('socioIngreso').value = '';
    $('socioActivo').checked = true;
    $('socioBecado').checked = false;

    $('modalSocio').classList.remove('hidden');
  }

  function openModalEdit(socio) {
    editingId = socio.id;
    setDraftPhoto(null);

    $('modalSocioTitle').textContent = 'Editar socio';
    $('socioNumero').value = socio.numero_socio ?? '';
    $('socioDni').value = socio.dni ?? '';
    $('socioNombre').value = socio.nombre ?? '';
    $('socioApellido').value = socio.apellido ?? '';
    $('socioCategoria').value = socio.categoria ?? '';
    $('socioTelefono').value = socio.telefono ?? '';
    $('socioNacimiento').value = (socio.fecha_nacimiento || '').slice(0, 10);
    $('socioIngreso').value = (socio.fecha_ingreso || '').slice(0, 10);
    $('socioActivo').checked = !!socio.activo;
    $('socioBecado').checked = !!socio.becado;

    $('modalSocio').classList.remove('hidden');
  }

  function closeModalSocio() {
    $('modalSocio')?.classList.add('hidden');
  }

  // =============================
// Carnet digital (doble click)
// =============================
let carnetSocioId = null;

function ensureCarnetModal() {
  let modal = document.getElementById('modalCarnet');

  // Si NO existe, lo creamos como ya hacías
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalCarnet';
    modal.className = 'modal hidden';

    // 🔒 Forzar capa y clicks (evita CSS que bloquee interacción)
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(0,0,0,0.55)';
    modal.style.zIndex = '20000';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '18px';
    modal.style.pointerEvents = 'auto';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 560px; pointer-events:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <h3 style="margin:0;">Carnet digital</h3>
          <button type="button" data-act="close" class="btn btn-secondary">✕</button>
        </div>

        <div style="display:flex; gap:12px; align-items:flex-start; margin-top:12px;">
          <img id="carnetFoto"
            style="width:90px; height:90px; border-radius:12px; object-fit:cover; border:1px solid #ddd; background:#fff;"
            alt="Foto"/>
          <div style="flex:1;">
            <div id="carnetNombre" style="font-size:18px; font-weight:800;"></div>
            <div id="carnetDni" class="muted" style="margin-top:4px;"></div>
            <div id="carnetCategoria" class="muted" style="margin-top:2px;"></div>
            <div id="carnetPago" style="margin-top:8px;"></div>
          </div>
        </div>

        <div id="carnetExtra" class="muted" style="margin-top:10px; font-size:13px; line-height:1.35;"></div>

        <div class="modal-actions">
          <button type="button" data-act="edit" class="btn btn-primary">Editar</button>
          <button type="button" data-act="close" class="btn btn-secondary">Cerrar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  // ✅ SI existe (o recién creado), bindeamos UNA sola vez
  if (modal.dataset.bound === '1') return modal;
  modal.dataset.bound = '1';

  // Click en botones (soporta tanto el modal creado como el del HTML)
  modal.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'close') {
        closeCarnet();
        return;
      }
      if (act === 'edit') {
        const socio = sociosCache.find(x => String(x.id) === String(carnetSocioId));
        if (socio) {
          closeCarnet();
          openModalEdit(socio);
        }
        return;
      }
    }

    // Click afuera (overlay)
    if (ev.target === modal) closeCarnet();
  });

  // Compat: si tu HTML usa ids (btnCarnetClose/Ok/Edit), los soportamos también
  modal.querySelector('#btnCarnetClose')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeCarnet();
  });
  modal.querySelector('#btnCarnetOk')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeCarnet();
  });
  modal.querySelector('#btnCarnetEdit')?.addEventListener('click', (e) => {
    e.preventDefault();
    const socio = sociosCache.find(x => String(x.id) === String(carnetSocioId));
    if (socio) {
      closeCarnet();
      openModalEdit(socio);
    }
  });

  // Escape
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !modal.classList.contains('hidden')) closeCarnet();
  });

  return modal;
}  

// =============================
  // Render tabla (incluye Año)
  // =============================
  function renderSocios(socios) {
    sociosCache = socios || [];
    const tbody = $('sociosTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    let activos = 0;

    sociosCache.forEach(s => {
      if (s.activo) activos++;

      const fotoUrl = s.foto_url || '/img/user-placeholder.png';
      const fotoHtml = `
        <img
          data-act="viewphoto"
          data-url="${escapeHtml(fotoUrl)}"
          src="${escapeHtml(fotoUrl)}"
          style="width:34px; height:34px; border-radius:10px; object-fit:cover; border:1px solid #ddd; background:#fff; cursor:pointer;"
          onerror="this.src='/img/user-placeholder.png'"
          alt="foto"
        />
      `;

      const tr = document.createElement('tr');
      tr.dataset.id = s.id;

      tr.innerHTML = `
        <td>${renderPagoPill(s)}</td>
        <td>${s.numero_socio ?? ''}</td>
        <td>${escapeHtml(s.dni ?? '')}</td>
        <td>${escapeHtml(s.nombre ?? '')}</td>
        <td>${escapeHtml(s.apellido ?? '')}</td>
        <td>${escapeHtml(s.categoria ?? '')}</td>
        <td>${escapeHtml(s.telefono ?? '')}</td>
        <td>${fmtDMY(s.fecha_nacimiento)}</td>
        <td>${s.anio_nacimiento ?? yearFromISO(s.fecha_nacimiento)}</td>
        <td>${fmtDMY(s.fecha_ingreso)}</td>
        <td>${s.activo ? 'Sí' : 'No'}</td>
        <td>${s.becado ? 'Sí' : 'No'}</td>
        <td>${fotoHtml}</td>
        <td style="white-space:nowrap;">
          <button title="Editar" class="btn-ico" data-act="edit" data-id="${s.id}">✏️</button>
          <button title="Eliminar" class="btn-ico" data-act="del" data-id="${s.id}">🗑️</button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    const countEl = $('sociosActivosCount');
    if (countEl) countEl.textContent = `Socios activos: ${activos}`;
  }

  // =============================
  // Filtros dropdown
  // =============================
  function refreshCategoriaOptions(socios) {
    const sel = $('filtroCategoria');
    if (!sel) return;

    const current = sel.value;
    const cats = [...new Set((socios || []).map(s => s.categoria).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));

    sel.innerHTML = `<option value="">Todas las categorías</option>`;
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });

    if (cats.includes(current)) sel.value = current;
  }

  function refreshAnioOptions(socios) {
    const sel = $('filtroAnio');
    if (!sel) return;

    const current = sel.value;
    const years = [...new Set((socios || [])
      .map(s => s.anio_nacimiento || (s.fecha_nacimiento ? Number(String(s.fecha_nacimiento).slice(0, 4)) : null))
      .filter(Boolean))]
      .sort((a, b) => b - a);

    sel.innerHTML = `<option value="">Todos los años</option>`;
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      sel.appendChild(opt);
    });

    if (years.map(String).includes(current)) sel.value = current;
  }

  // =============================
  // API
  // =============================
  function buildQueryParams() {
    const q = new URLSearchParams();
    const search = $('sociosSearch')?.value?.trim();
    const categoria = $('filtroCategoria')?.value;
    const anio = $('filtroAnio')?.value;
    const verInactivos = $('verInactivos')?.checked;

    if (search) q.set('search', search);
    if (categoria) q.set('categoria', categoria);
    if (anio) q.set('anio', anio);
    if (!verInactivos) q.set('activo', '1');

    return q.toString();
  }

  async function loadSocios() {
    const clubId = getActiveClubId();
    const qs = buildQueryParams();

    const res = await fetchAuth(`/club/${clubId}/socios${qs ? `?${qs}` : ''}`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      alert(data.error || 'Error cargando socios');
      return;
    }

    refreshCategoriaOptions(data.socios || []);
    refreshAnioOptions(data.socios || []);
    renderSocios(data.socios || []);
  }

  async function saveSocio() {
    const clubId = getActiveClubId();

    const numeroRaw = $('socioNumero').value.trim();
    const payload = {
      numero_socio: numeroRaw ? Number(numeroRaw) : null,
      dni: $('socioDni').value.trim(),
      nombre: $('socioNombre').value.trim(),
      apellido: $('socioApellido').value.trim(),
      categoria: $('socioCategoria').value.trim(),
      telefono: $('socioTelefono').value.trim() || null,
      fecha_nacimiento: $('socioNacimiento').value,
      fecha_ingreso: $('socioIngreso').value || null,
      activo: $('socioActivo').checked,
      becado: $('socioBecado').checked
    };

    if (!payload.dni || !payload.nombre || !payload.apellido || !payload.categoria || !payload.fecha_nacimiento) {
      alert('Completá DNI, Nombre, Apellido, Categoría y Fecha de nacimiento.');
      return;
    }

    const creating = !editingId;
    const url = creating ? `/club/${clubId}/socios` : `/club/${clubId}/socios/${editingId}`;
    const method = creating ? 'POST' : 'PUT';

    const btnSave = $('btnGuardarSocio');
    if (btnSave) btnSave.disabled = true;

    try {
      const res = await fetchAuth(url, { method, body: JSON.stringify(payload), json: true });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo guardar el socio');
        return;
      }

      const socioId = creating ? (data.socio?.id || data.id) : editingId;
      if (draftPhoto && socioId) {
        await uploadSocioFotoById(socioId, draftPhoto);
      }

      setDraftPhoto(null);
      closeModalSocio();
      await loadSocios();
      alert(creating ? '✅ Socio creado' : '✅ Socio actualizado');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error guardando socio');
    } finally {
      if (btnSave) btnSave.disabled = false;
    }
  }

  async function deleteSocio(id) {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/socios/${id}`, { method: 'DELETE' });
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      alert(data.error || 'No se pudo eliminar el socio');
      return;
    }
    await loadSocios();
  }

  async function exportSocios() {
    const clubId = getActiveClubId();

    try {
      // Descarga con Authorization (para que funcione aunque el endpoint esté protegido)
      const res = await fetch(`/club/${clubId}/socios/export.csv`, {
        headers: { Authorization: 'Bearer ' + getToken() }
      });

      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('activeClubId');
        alert('Sesión inválida o expirada.');
        window.location.href = '/admin.html';
        return;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        alert('No se pudo exportar. ' + (txt || `HTTP ${res.status}`));
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `socios_${clubId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Error exportando CSV');
    }
  }

  // =============================
  // Bind events
  // =============================
  function bindOnce() {
    const root = document.querySelector('.section-socios') || document.getElementById('socios-section');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    ensurePhotoViewer();
    ensureDraftPhotoUI();

    $('btnNuevoSocio')?.addEventListener('click', openModalNew);
    $('btnCancelarSocio')?.addEventListener('click', closeModalSocio);
    $('btnGuardarSocio')?.addEventListener('click', saveSocio);

    $('btnBuscarSocios')?.addEventListener('click', loadSocios);
    $('btnExportSocios')?.addEventListener('click', exportSocios);

    $('sociosSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSocios();
    });

    $('filtroCategoria')?.addEventListener('change', loadSocios);
    $('filtroAnio')?.addEventListener('change', loadSocios);
    $('verInactivos')?.addEventListener('change', loadSocios);

    $('sociosTableBody')?.addEventListener('click', async (ev) => {
      const img = ev.target.closest('[data-act="viewphoto"]');
      if (img) {
        const url = img.dataset.url;
        if (url) openPhotoViewer(url);
        return;
      }

      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;

      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === 'edit') {
        const socio = sociosCache.find(x => String(x.id) === String(id));
        if (socio) openModalEdit(socio);
      }

      if (act === 'del') {
        if (confirm('¿Eliminar socio definitivamente?')) {
          await deleteSocio(id);
        }
      }
    });

    root.addEventListener('dblclick', (ev) => {
  const tr = ev.target.closest('#sociosTableBody tr');
  if (!tr || !tr.dataset.id) return;

  const socio = sociosCache.find(x => String(x.id) === String(tr.dataset.id));
  if (socio) openCarnet(socio);
});

    $('modalSocio')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalSocio') closeModalSocio();
    });
  }

  async function initSociosSection() {
    bindOnce();
    await loadSocios();
  }

  window.initSociosSection = initSociosSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.section-socios') || $('sociosTableBody')) {
      initSociosSection();
    }
  });
})();