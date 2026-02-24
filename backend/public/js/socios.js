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

  // Foto “draft” para alta/edición (se elige antes de guardar)
  let draftPhoto = null; // { dataUrl, base64, mimetype, filename }

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
  }

  function openPhotoViewer(url) {
    ensurePhotoViewer();
    const modal = document.getElementById('photoViewerModal');
    const img = document.getElementById('photoViewerImg');
    img.src = url;
    modal.style.display = 'flex';
  }

  // =============================
  // UI extra dentro del modal de socio: Elegir foto + preview
  // =============================
  const draftPhotoInput = document.createElement('input');
  draftPhotoInput.type = 'file';
  draftPhotoInput.accept = 'image/*';
  draftPhotoInput.style.display = 'none';

  function ensureDraftPhotoUI() {
    // input al body
    if (!document.body.contains(draftPhotoInput)) document.body.appendChild(draftPhotoInput);

    const modal = document.getElementById('modalSocio');
    if (!modal) return;

    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) return;

    if (document.getElementById('socioDraftPhotoBox')) return; // ya insertado

    const box = document.createElement('div');
    box.id = 'socioDraftPhotoBox';
    box.style.cssText = `
      margin-top: 10px;
      padding: 10px;
      border: 1px dashed #ddd;
      border-radius: 10px;
      background: #fafafa;
    `;

    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="font-weight:600;">Foto del socio</div>
        <div style="display:flex; gap:8px;">
          <button type="button" id="btnSocioPickFoto" style="padding:8px 10px; cursor:pointer;">Elegir foto</button>
          <button type="button" id="btnSocioClearFoto" style="padding:8px 10px; cursor:pointer;">Quitar</button>
        </div>
      </div>

      <div style="display:flex; gap:12px; align-items:center; margin-top:10px; flex-wrap:wrap;">
        <img id="socioFotoDraftPreview" alt="Preview foto" style="
          width: 74px; height:74px; border-radius:12px; object-fit:cover;
          border:1px solid #ddd; background:#fff; display:none; cursor:pointer;
        ">
        <div>
          <div id="socioFotoDraftMeta" style="font-size:12px; color:#555;">Sin foto seleccionada.</div>
          <div style="font-size:12px; color:#777; margin-top:4px;">
            La foto se subirá automáticamente al presionar <b>Guardar</b>.
          </div>
        </div>
      </div>
    `;

    // Insertar antes de los botones del modal
    const actions = modalContent.querySelector('.modal-actions');
    if (actions) modalContent.insertBefore(box, actions);
    else modalContent.appendChild(box);

    // Bind botones
    box.querySelector('#btnSocioPickFoto').addEventListener('click', () => {
      draftPhotoInput.click();
    });

    box.querySelector('#btnSocioClearFoto').addEventListener('click', () => {
      setDraftPhoto(null);
    });

    // Click en preview abre visor grande (si hay foto)
    box.querySelector('#socioFotoDraftPreview').addEventListener('click', () => {
      if (draftPhoto?.dataUrl) openPhotoViewer(draftPhoto.dataUrl);
    });

    // Change del input
    draftPhotoInput.addEventListener('change', async () => {
      const file = draftPhotoInput.files && draftPhotoInput.files[0];
      draftPhotoInput.value = ''; // reset

      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        alert('La imagen supera 2MB. Elegí una más liviana.');
        return;
      }

      // dataURL para preview + base64 para envío
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

  // =============================
  // Upload de foto (para socio ya existente)
  // =============================
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
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'No se pudo subir la foto');
    }
    return data;
  }

  // Input oculto para reemplazar foto desde la grilla (📷 por fila)
  const quickPhotoInput = document.createElement('input');
  quickPhotoInput.type = 'file';
  quickPhotoInput.accept = 'image/*';
  quickPhotoInput.style.display = 'none';
  let pendingQuickSocioId = null;

  function ensureQuickPhotoInput() {
    if (!document.body.contains(quickPhotoInput)) document.body.appendChild(quickPhotoInput);
  }

  quickPhotoInput.addEventListener('change', async () => {
    try {
      const file = quickPhotoInput.files && quickPhotoInput.files[0];
      quickPhotoInput.value = '';
      if (!file || !pendingQuickSocioId) return;

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
      if (comma < 0) throw new Error('No se pudo leer la imagen');

      // Preview “rápido” (confirm)
      const ok = confirm('¿Subir esta foto para el socio seleccionado?');
      if (!ok) return;

      await uploadSocioFotoById(pendingQuickSocioId, {
        dataUrl,
        base64: dataUrl.slice(comma + 1),
        mimetype: file.type || 'image/jpeg',
        filename: file.name || 'socio.jpg'
      });

      await loadSocios();
      alert('✅ Foto actualizada');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error subiendo foto');
    } finally {
      pendingQuickSocioId = null;
    }
  });

  function triggerQuickPhotoPick(socioId) {
    ensureQuickPhotoInput();
    pendingQuickSocioId = socioId;
    quickPhotoInput.click();
  }

  // =============================
  // UI: Modal Socio
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

      // Miniatura clickeable + fallback
      const fotoHtml = s.foto_url
        ? `<img data-act="viewphoto" data-url="${s.foto_url}"
              src="${s.foto_url}"
              alt="foto"
              style="width:42px;height:42px;border-radius:10px;object-fit:cover;border:1px solid #ddd;cursor:pointer;">`
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

    const creating = !editingId;
    const url = creating
      ? `/club/${clubId}/socios`
      : `/club/${clubId}/socios/${editingId}`;

    const method = creating ? 'POST' : 'PUT';

    const btnSave = $('btnGuardarSocio');
    if (btnSave) btnSave.disabled = true;

    try {
      // 1) Guardar socio
      const res = await fetchAuth(url, { method, body: JSON.stringify(payload), json: true });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo guardar el socio');
        return;
      }

      // 2) Subir foto si el usuario la eligió ANTES
      const socioId = creating ? (data.socio?.id || data.id) : editingId;

      if (draftPhoto && socioId) {
        await uploadSocioFotoById(socioId, draftPhoto);
      }

      // 3) Reset y refresco
      setDraftPhoto(null);
      closeModal();
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
      alert(data.csv`;
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
      // click miniatura
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
        // reemplazar foto desde la grilla
        triggerQuickPhotoPick(id);
      }
    });

    $('modalSocio')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalSocio') closeModal();
    });
  }

  async function initSociosSection() {
    ensurePhotoViewer();
    ensureDraftPhotoUI();     // ✅ agrega “Elegir foto” dentro del modal
    ensureQuickPhotoInput();  // ✅ input para reemplazo desde grilla
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