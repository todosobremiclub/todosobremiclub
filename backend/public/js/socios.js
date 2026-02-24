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

    // Si se venció la sesión
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
    try { return JSON.parse(text); } catch { return { ok:false, error:text }; }
  }

  // =============================
  // Estado interno
  // =============================
  let editingId = null;
  let sociosCache = [];

  // =============================
  // UI: Modal
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
  // Render tabla + contadores
  // =============================
  function pagoDotPlaceholder() {
    // Hasta que conectemos Pagos, dejamos placeholder
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

      const fotoHtml = s.foto_url
        ? `<img src="${s.foto_url}" alt="foto" style="width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid #ddd" />`
        : '—';

      const anioNac = s.anio_nacimiento
        ? s.anio_nacimiento
        : (s.fecha_nacimiento ? String(s.fecha_nacimiento).slice(0,4) : '');

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
        <td style="text-align:center;">${fotoHtml}</td>
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
  // Filtros (categorías / años)
  // =============================
  function refreshCategoriaOptions(socios) {
    const sel = $('filtroCategoria');
    const current = sel.value;

    const cats = [...new Set((socios || [])
      .map(s => s.categoria)
      .filter(Boolean))]
      .sort((a,b) => a.localeCompare(b, 'es'));

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
      .map(s => s.anio_nacimiento || (s.fecha_nacimiento ? Number(String(s.fecha_nacimiento).slice(0,4)) : null))
      .filter(Boolean))]
      .sort((a,b) => b - a);

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

    // por defecto mostramos activos; si tilda "ver inactivos", mostramos todos
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

    // actualizar combos basados en data actual (con filtros)
    refreshCategoriaOptions(data.socios || []);
    refreshAnioOptions(data.socios || []);

    renderSocios(data.socios || []);
  }

  async function saveSocio() {
    const clubId = getActiveClubId();

    const numeroRaw = $('socioNumero').value.trim();
    const payload = {
      // si vacío -> null => backend asigna automático
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

    // Validación mínima (UI) - lo fuerte está en backend/DB
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
      // 409 típico: número o dni duplicado en el club
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
    // CSV (Excel lo abre perfecto). Si tu backend usa otra ruta, la ajustamos.
    window.location.href = `/club/${clubId}/socios/export.csv`;
  }

  // =============================
  // Binds + init
  // =============================
  function bindEvents() {
    $('btnNuevoSocio')?.addEventListener('click', openModalNew);
    $('btnCancelarSocio')?.addEventListener('click', closeModal);
    $('btnGuardarSocio')?.addEventListener('click', saveSocio);
    $('btnBuscarSocios')?.addEventListener('click', loadSocios);
    $('btnExportSocios')?.addEventListener('click', exportSocios);

    // enter en búsqueda
    $('sociosSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSocios();
    });

    // cambios en filtros recargan
    $('filtroCategoria')?.addEventListener('change', loadSocios);
    $('filtroAnio')?.addEventListener('change', loadSocios);
    $('verInactivos')?.addEventListener('change', loadSocios);

    // botones de la tabla
    $('sociosTableBody')?.addEventListener('click', async (ev) => {
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
    });

    // cerrar modal clickeando afuera
    $('modalSocio')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalSocio') closeModal();
    });
  }

  // Esta función se llama cuando el HTML de Socios ya está presente en el DOM.
  async function initSociosSection() {
    bindEvents();
    await loadSocios();
  }

  // Exponemos init para uso desde club.js (cuando inyectás sections/socios.html)
  window.initSociosSection = initSociosSection;

  // Si la sección ya está cargada al abrir la página (sin inyección), inicializa solo.
  document.addEventListener('DOMContentLoaded', () => {
    if ($('socios-section') && $('sociosTableBody')) {
      initSociosSection();
    }
  });
})();
