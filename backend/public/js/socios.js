(() => {
  // =============================
  // Helpers base
  // =============================
  const $ = (id) => document.getElementById(id);

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

    const res = await fetch(url, { ...options, headers });

    // Sesión vencida
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

  // =============================
  // Estado interno
  // =============================
  let editingId = null;
  let sociosCache = [];

  // =============================
  // Visor de foto (lightbox)
  // =============================
  function ensurePhotoViewer() {
    if (document.getElementById('photoViewerModal')) return;

    const modal = document.createElement('div');
    modal.id = 'photoViewerModal';
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.75);
      display:none; align-items:center; justify-content:center; z-index:9999;
      padding: 18px;
    `;

    modal.innerHTML = `
      <div style="
        position:relative; width:min(980px, 96vw); max-height: 92vh;
        background:#111; border-radius:12px; overflow:hidden;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
      ">
        <button id="photoViewerClose" style="
          position:absolute; top:10px; right:10px; z-index:2;
          border:0; background:rgba(255,255,255,0.12);
          color:#fff; padding:8px 10px; border-radius:10px; cursor:pointer;
          font-size:14px;
        ">✕ Cerrar</button>

        <div style="display:flex; align-items:center; justify-content:center; background:#000;">
          <img id="photoViewerImg" alt="Foto socio" style="
            max-width: 100%; max-height: 92vh; display:block; object-fit:contain;
          ">
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => {
      modal.style.display = 'none';
      const img = document.getElementById('photoViewerImg');
      if (img) img.src = '';
    };

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });
    modal.querySelector('#photoViewerClose').addEventListener('click', close);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal.style.display === 'flex') close();
    });

    window.closePhotoViewer = close;
  }

  function openPhotoViewer(url) {
    ensurePhotoViewer();
    const modal = document.getElementById('photoViewerModal');
    const img = document.getElementById('photoViewerImg');
    img.src = url;
    modal.style.display = 'flex';
  }

  // =============================
  // Preview antes de subir (modal)
  // =============================
  let previewState = {
    socioId: null,
    dataUrl: null,   // para mostrar
    base64: null,    // para enviar
    mimetype: null,
    filename: null
  };

  function ensurePhotoPreviewModal() {
    if (document.getElementById('photoPreviewModal')) return;

    const modal = document.createElement('div');
    modal.id = 'photoPreviewModal';
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.65);
      display:none; align-items:center; justify-content:center; z-index:9998;
      padding: 18px;
    `;

    modal.innerHTML = `
      <div style="
        position:relative; width:min(760px, 96vw);
        background:#fff; border-radius:12px; overflow:hidden;
        box-shadow: 0 10px 40px rgba(0,0,0,0.35);
      ">
        <div style="padding:14px 16px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700;">Preview de foto</div>
            <div id="photoPreviewMeta" style="font-size:12px; color:#666; margin-top:2px;"></div>
          </div>
          <button id="photoPreviewX" style="
            border:0; background:#f1f1f1; padding:8px 10px; border-radius:10px; cursor:pointer;
          ">✕</button>
        </div>

        <div style="background:#111; display:flex; align-items:center; justify-content:center; padding:12px;">
          <img id="photoPreviewImg" alt="Preview" style="max-width:100%; max-height:60vh; object-fit:contain; border-radius:10px;">
        </div>

        <div style="padding:14px 16px; display:flex; justify-content:flex-end; gap:10px;">
          <button id="photoPreviewCancel" style="padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:#fff; cursor:pointer;">
            Cancelar
          </button>
          <button id="photoPreviewUpload" style="padding:10px 14px; border-radius:10px; border:0; background:#111827; color:#fff; cursor:pointer;">
            Subir foto
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => {
      modal.style.display = 'none';
      previewState = { socioId:null, dataUrl:null, base64:null, mimetype:null, filename:null };
      const img = document.getElementById('photoPreviewImg');
      if (img) img.src = '';
    };

    // cerrar con click afuera
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });

    modal.querySelector('#photoPreviewX').addEventListener('click', close);
    modal.querySelector('#photoPreviewCancel').addEventListener('click', close);

    modal.querySelector('#photoPreviewUpload').addEventListener('click', async () => {
      try {
        if (!previewState.socioId || !previewState.base64 || !previewState.mimetype) {
          alert('No hay foto para subir.');
          return;
        }

        const clubId = getActiveClubId();
        const payload = {
          base64: previewState.base64,
          mimetype: previewState.mimetype,
          filename: previewState.filename || 'socio.jpg'
        };

        const res = await fetchAuth(`/club/${clubId}/socios/${previewState.socioId}/foto`, {
          method: 'POST',
          body: JSON.stringify(payload),
          json: true
        });

        const data = await safeJson(res);
        if (!res.ok || !data.ok) {
          alert(data.error || 'No se pudo subir la foto');
          return;
        }

        close();
        await loadSocios();
        alert('✅ Foto subida correctamente');
      } catch (e) {
        console.error(e);
        alert(e.message || 'Error subiendo foto');
      }
    });

    // ESC
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal.style.display === 'flex') close();
    });
  }

  function openPhotoPreview({ socioId, file, dataUrl, base64 }) {
    ensurePhotoPreviewModal();
    previewState = {
      socioId,
      dataUrl,
      base64,
      mimetype: file.type || 'image/jpeg',
      filename: file.name || 'socio.jpg'
    };

    const modal = document.getElementById('photoPreviewModal');
    const img = document.getElementById('photoPreviewImg');
    const meta = document.getElementById('photoPreviewMeta');

    img.src = dataUrl;

    const kb = Math.round((file.size || 0) / 1024);
    meta.textContent = `${previewState.filename} • ${kb} KB • ${previewState.mimetype}`;

    modal.style.display = 'flex';
  }

  // =============================
  // Input oculto para elegir archivo
  // =============================
  const photoInput = document.createElement('input');
  photoInput.type = 'file';
  photoInput.accept = 'image/*';
  photoInput.style.display = 'none';

  function ensurePhotoInput() {
    if (!document.body.contains(photoInput)) document.body.appendChild(photoInput);
  }

  let pendingPhotoSocioId = null;

  photoInput.addEventListener('change', async () => {
    try {
      const file = photoInput.files && photoInput.files[0];
      if (!file || !pendingPhotoSocioId) return;

      // validación de tamaño
      if (file.size > 2 * 1024 * 1024) {
        alert('La imagen supera 2MB. Elegí una más liviana.');
        return;
      }

      // leer como dataURL (sirve para preview)
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Error leyendo archivo'));
        r.readAsDataURL(file);
      });

      const comma = dataUrl.indexOf(',');
      if (comma < 0) throw new Error('No se pudo leer la imagen');

      const base64 = dataUrl.slice(comma + 1);

      // abrir preview (NO sube todavía)
      openPhotoPreview({
        socioId: pendingPhotoSocioId,
        file,
        dataUrl,
        base64
      });
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error preparando preview');
    } finally {
      // reset selector para permitir elegir la misma foto de nuevo
      pendingPhotoSocioId = null;
      photoInput.value = '';
    }
  });

  function triggerPhotoPick(socioId) {
    ensurePhotoInput();
    pendingPhotoSocioId = socioId;
    photoInput.click();
  }

  // =============================
  // UI: Modal Socio
  // =============================
  function openModalNew() {
    editingId = null;
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

  function closeModal() {
    $('modalSocio').classList.add('hidden');
  }

  // =============================
  // Render tabla
  // =============================
  function pagoDotPlaceholder() {
    return `<span title="Estado de pago (pendiente de módulo Pagos)"
      style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#9aa0a6"></span>`;
  }

  function renderSocios(socios) {
    sociosCache = socios || [];
    const tbody = $('sociosTableBody');
    tbody.innerHTML = '';

    let activos = 0;

    sociosCache.forEach(s => {
      if (s.activo) activos++;

      const anioNac = s.anio_nacimiento
        ? s.anio_nacimiento
        : (s.fecha_nacimiento ? String(s.fecha_nacimiento).slice(0, 4) : '');

      // ✅ miniatura clickeable (abre lightbox)
      const fotoHtml = s.foto_url
        ? `<img src="${s.foto_url}" data-act="viewphoto" data-url="${s.foto_url}"
             style="width:42px;height:42px;object-fit:cover;border-radius:8px;border:1px solid #ddd;cursor:zoom-in;" />`
        : `<span style="color:#777;">—</span>`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:center;">${pagoDotPlaceholder()}</td>
        <td>${s.numero_socio ?? ''}</td>
        <td>${s.dni ?? ''}</td>
        <td>${s.nombre ?? ''}</td>
        <td>${s.apellido ?? ''}</td>
        <td>${s.categoria ?? ''}</td>
        <td>${s.telefono ?? ''}</td>
        <td>${(s.fecha_nacimiento || '').slice(0,10)}</td>
        <td>${anioNac}</td>
        <td>${(s.fecha_ingreso || '').slice(0,10)}</td>
        <td style="text-align:center;"><input type="checkbox" disabled ${s.activo ? 'checked':''}></td>
        <td style="text-align:center;"><input type="checkbox" disabled ${s.becado ? 'checked':''}></td>
        <td style="text-align:center;">
          ${fotoHtml}
          <div style="margin-top:6px;">
            <button data-act="photo" data-id="${s.id}" style="padding:4px 8px;">📷</button>
          </div>
        </td>
        <td>
          <button data-act="edit" data-id="${s.id}">Editar</button>
          <button data-act="del" data-id="${s.id}">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    $('sociosActivosCount').textContent = `Socios activos: ${activos}`;
  }

  // =============================
  // Filtros
  // =============================
  function refreshCategoriaOptions(socios) {
    const sel = $('filtroCategoria');
    const current = sel.value;

    const cats = [...new Set((socios || [])
      .map(s => s.categoria)
      .filter(Boolean))]
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
  // API calls
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

    const url = editingId
      ? `/club/${clubId}/socios/${editingId}`
      : `/club/${clubId}/socios`;

    const method = editingId ? 'PUT' : 'POST';

    const res = await fetchAuth(url, { method, body: JSON.stringify(payload), json: true });
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      alert(data.error || 'No se pudo guardar el socio');
      return;
    }

    closeModal();
    await loadSocios();
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

  function exportSocios() {
    const clubId = getActiveClubId();
    window.location.href = `/club/${clubId}/socios/export.csv`;
  }

  // =============================
  // Events + init
  // =============================
  function bindEvents() {
    $('btnNuevoSocio')?.addEventListener('click', openModalNew);
    $('btnCancelarSocio')?.addEventListener('click', closeModal);
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
      // ✅ click en miniatura
      const img = ev.target.closest('[data-act="viewphoto"]');
      if (img) {
        const url = img.dataset.url;
        if (url) openPhotoViewer(url);
        return;
      }

      const btn = ev.target.closest('button');
      if (!btn) return;

      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === 'edit') {
        const socio = sociosCache.find(x => x.id === id);
        if (socio) openModalEdit(socio);
      }

      if (act === 'del') {
        if (confirm('¿Eliminar socio definitivamente?')) {
          await deleteSocio(id);
        }
      }

      if (act === 'photo') {
        triggerPhotoPick(id); // ✅ abre selector y luego preview
      }
    });

    $('modalSocio')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalSocio') closeModal();
    });
  }

  async function initSociosSection() {
    ensurePhotoViewer();
    ensurePhotoPreviewModal();
    ensurePhotoInput();
    bindEvents();
    await loadSocios();
  }

  window.initSociosSection = initSociosSection;

  document.addEventListener('DOMContentLoaded', () => {
    if ($('socios-section') && $('sociosTableBody')) {
      initSociosSection();
    }
  });
})();