// public/js/noticias.js
(() => {
 
const $ = (selector) => document.querySelector(selector);

  // =============================
  // Auth / helpers comunes
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
      alert('No hay club activo seleccionado.');
      window.location.href = '/club.html';
      throw new Error('No activeClubId');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers ?? {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

    const { json, ...rest } = options;
    const res = await fetch(url, { ...rest, headers });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { ok: false, error: text }; }

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    return { res, data };
  }

  
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}


  function formatDateISOToDMY(iso) {
    if (!iso) return '';
    const s = String(iso).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}/${m}/${y}`;
  }

  // =============================
  // Estado
  // =============================
  let actividadesCache = [];
  let categoriasCache = [];
  let noticiasCache = [];
  let editingId = null;
  let currentImagenUrl = null;
  let pendingImageFile = null;

  // =============================
  // Helpers imagen (base64)
  // =============================
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const dataUrl = String(r.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma < 0) return reject(new Error('No se pudo leer la imagen'));
        resolve({
          base64: dataUrl.slice(comma + 1),
          mimetype: file.type || 'image/jpeg'
        });
      };
      r.onerror = () => reject(new Error('Error leyendo archivo'));
      r.readAsDataURL(file);
    });
  }

  // =============================
  // Carga de actividades / categorías
  // =============================
  async function loadActividades() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/config/actividades`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando actividades');
      actividadesCache = data.actividades || [];
    } catch (e) {
      console.error(e);
      actividadesCache = [];
    }
  }

  async function loadCategorias() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/config/categorias`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando categorías');
      categoriasCache = data.categorias || [];
    } catch (e) {
      console.error(e);
      categoriasCache = [];
    }
  }

  // =============================
  // Render destino extra (según tipo)
  // =============================
  function renderDestinoExtra() {
    const tipo = $('#notiDestinoTipo')?.value || 'todos';
    const cont = $('#notiDestinoExtra');
    if (!cont) return;
    cont.innerHTML = '';

    if (tipo === 'todos') return;

    if (tipo === 'actividad') {
      const sel = document.createElement('select');
      sel.id = 'notiDestinoActividad';
      sel.innerHTML = `<option value="">Seleccionar actividad...</option>` +
        actividadesCache
          .map(a => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`)
          .join('');
      const label = document.createElement('label');
      label.textContent = 'Actividad';
      label.appendChild(sel);
      cont.appendChild(label);
      return;
    }

    if (tipo === 'categoria') {
      const sel = document.createElement('select');
      sel.id = 'notiDestinoCategoria';
      sel.innerHTML = `<option value="">Seleccionar categoría...</option>` +
        categoriasCache
          .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
          .join('');
      const label = document.createElement('label');
      label.textContent = 'Categoría';
      label.appendChild(sel);
      cont.appendChild(label);
      return;
    }

    if (tipo === 'anio_nac') {
      const label = document.createElement('label');
      label.textContent = 'Año de nacimiento';
      label.innerHTML += `
        <input type="number" id="notiDestinoAnio" placeholder="Ej: 2010" min="1900" max="2100" />
      `;
      cont.appendChild(label);
      return;
    }

    if (tipo === 'cat_anio') {
      const labelCat = document.createElement('label');
      const sel = document.createElement('select');
      sel.id = 'notiDestinoCategoria';
      sel.innerHTML = `<option value="">Seleccionar categoría...</option>` +
        categoriasCache
          .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
          .join('');
      labelCat.textContent = 'Categoría';
      labelCat.appendChild(sel);

      const labelAnio = document.createElement('label');
      labelAnio.textContent = 'Año de nacimiento';
      labelAnio.innerHTML += `
        <input type="number" id="notiDestinoAnio" placeholder="Ej: 2012" min="1900" max="2100" />
      `;

      cont.appendChild(labelCat);
      cont.appendChild(labelAnio);
      return;
    }
  }

  function getDestinoPayload() {
    const tipo = $('#notiDestinoTipo')?.value || 'todos';
    let v1 = null;
    let v2 = null;

    if (tipo === 'actividad') {
      v1 = $('#notiDestinoActividad')?.value?.trim() || '';
      if (!v1) throw new Error('Seleccioná una actividad');
    } else if (tipo === 'categoria') {
      v1 = $('#notiDestinoCategoria')?.value?.trim() || '';
      if (!v1) throw new Error('Seleccioná una categoría');
    } else if (tipo === 'anio_nac') {
      v1 = $('#notiDestinoAnio')?.value?.trim() || '';
      if (!v1) throw new Error('Ingresá un año de nacimiento');
    } else if (tipo === 'cat_anio') {
      v1 = $('#notiDestinoCategoria')?.value?.trim() || '';
      v2 = $('#notiDestinoAnio')?.value?.trim() || '';
      if (!v1 || !v2) throw new Error('Seleccioná categoría y año de nacimiento');
    }

    return { destino_tipo: tipo, destino_valor1: v1 || null, destino_valor2: v2 || null };
  }

  function destinoHumanLabel(n) {
    const tipo = n.destino_tipo;
    const v1 = n.destino_valor1;
    const v2 = n.destino_valor2;

    switch (tipo) {
      case 'todos': return 'Todos los socios';
      case 'actividad': return `Actividad: ${v1}`;
      case 'categoria': return `Categoría: ${v1}`;
      case 'anio_nac': return `Año nacimiento: ${v1}`;
      case 'cat_anio': return `Categoría: ${v1} · Año: ${v2}`;
      default: return tipo || '—';
    }
  }

  // =============================
  // Carga / render de noticias
  // =============================
  async function loadNoticias() {
    const clubId = getActiveClubId();
    const tbody = $('#noticiasTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6">Cargando noticias...</td></tr>`;

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/noticias`);
      if (!res.ok || !data.ok) {
        tbody.innerHTML = `<tr><td colspan="6">Error cargando noticias</td></tr>`;
        return;
      }
      noticiasCache = data.noticias || [];
      renderNoticiasTable();
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="6">Error cargando noticias</td></tr>`;
    }
  }

  function renderNoticiasTable() {
    const tbody = $('#noticiasTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!noticiasCache.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No hay noticias publicadas.</td></tr>`;
      return;
    }

    noticiasCache.forEach(n => {
      const tr = document.createElement('tr');
      const img = n.imagen_url || '';
      const fecha = formatDateISOToDMY(n.created_at);

      tr.innerHTML = `
        <td>
          ${img
            ? `<img src="${escapeHtml(img)}" class="noticia-img-mini" alt="imagen noticia"
                  onerror="this.style.display='none';" />`
            : '—'}
        </td>
        <td>${escapeHtml(n.titulo ?? '')}</td>
        <td>${escapeHtml(n.texto ?? '').slice(0, 120)}${(n.texto || '').length > 120 ? '…' : ''}</td>
        <td>${escapeHtml(destinoHumanLabel(n))}</td>
        <td>${escapeHtml(fecha)}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-secondary" data-act="edit" data-id="${n.id}" title="Editar">✏️</button>
          <button class="btn btn-secondary" style="background:#ef4444;border-color:#ef4444;"
                  data-act="del" data-id="${n.id}" title="Eliminar">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =============================
  // Alta / edición de noticia
  // =============================
  function resetForm() {
    editingId = null;
    pendingImageFile = null;
    currentImagenUrl = null;
    $('#notiTitulo') && ($('#notiTitulo').value = '');
    $('#notiTexto') && ($('#notiTexto').value = '');
    $('#notiImagen') && ($('#notiImagen').value = '');
    $('#notiDestinoTipo') && ($('#notiDestinoTipo').value = 'todos');
    renderDestinoExtra();

    const btn = $('#btnNoticiaPublicar');
    if (btn) btn.textContent = '📤 Publicar noticia';
  }

  function fillFormForEdit(n) {
    editingId = n.id;
    currentImagenUrl = n.imagen_url || null;
    pendingImageFile = null;

    $('#notiTitulo').value = n.titulo ?? '';
    $('#notiTexto').value = n.texto ?? '';
    $('#notiImagen').value = '';
    $('#notiDestinoTipo').value = n.destino_tipo || 'todos';

    renderDestinoExtra();

    if (n.destino_tipo === 'actividad' && $('#notiDestinoActividad')) {
      $('#notiDestinoActividad').value = n.destino_valor1 ?? '';
    }
    if ((n.destino_tipo === 'categoria' || n.destino_tipo === 'cat_anio') && $('#notiDestinoCategoria')) {
      $('#notiDestinoCategoria').value = n.destino_valor1 ?? '';
    }
    if ((n.destino_tipo === 'anio_nac' || n.destino_tipo === 'cat_anio') && $('#notiDestinoAnio')) {
      $('#notiDestinoAnio').value = n.destino_valor2 ?? n.destino_valor1 ?? '';
    }

    const btn = $('#btnNoticiaPublicar');
    if (btn) btn.textContent = '💾 Guardar cambios';
  }

  async function saveNoticia() {
    const clubId = getActiveClubId();
    const titulo = $('#notiTitulo')?.value?.trim() || '';
    const texto = $('#notiTexto')?.value?.trim() || '';

    if (!titulo || !texto) {
      alert('Completá Título y Texto.');
      return;
    }

    let destino;
    try {
      destino = getDestinoPayload();
    } catch (e) {
      alert(e.message || 'Destino inválido');
      return;
    }

    const payload = {
      titulo,
      texto,
      destino_tipo: destino.destino_tipo,
      destino_valor1: destino.destino_valor1,
      destino_valor2: destino.destino_valor2
    };

    // si hay imagen nueva, la convertimos a base64
    const fileInput = $('#notiImagen');
    const file = fileInput?.files?.[0] || null;
    if (file) {
      if (file.size > 3 * 1024 * 1024) {
        alert('La imagen supera los 3MB. Elegí una más liviana.');
        return;
      }
      const img = await readFileAsBase64(file);
      payload.imagen_base64 = img.base64;
      payload.imagen_mimetype = img.mimetype;
    }

    const btn = $('#btnNoticiaPublicar');
    if (btn) btn.disabled = true;

    try {
      let url = `/club/${clubId}/noticias`;
      let method = 'POST';

      if (editingId) {
        url = `/club/${clubId}/noticias/${editingId}`;
        method = 'PUT';
      }

      const { res, data } = await fetchAuth(url, {
        method,
        json: true,
        body: JSON.stringify(payload)
      });

      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo guardar la noticia');
        return;
      }

      alert(editingId ? '✅ Noticia actualizada' : '✅ Noticia publicada');
      resetForm();
      await loadNoticias();

    } catch (e) {
      console.error(e);
      alert(e.message || 'Error guardando noticia');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteNoticia(id) {
    const clubId = getActiveClubId();
    if (!confirm('¿Eliminar esta noticia definitivamente?')) return;

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/noticias/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo eliminar la noticia');
        return;
      }
      await loadNoticias();
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error eliminando noticia');
    }
  }

  // =============================
  // Bind de eventos
  // =============================
  
function bindOnce() {
  const root = document.getElementById('noticias-section');
  if (!root) {
    console.log('bindOnce: no hay #noticias-section');
    return;
  }
  if (root.dataset.bound === '1') {
    console.log('bindOnce: ya estaba ligado');
    return;
  }
  root.dataset.bound = '1';
  console.log('bindOnce: inicializando eventos');

  const destinoTipo = root.querySelector('#notiDestinoTipo');
console.log('bindOnce: notiDestinoTipo encontrado?', !!destinoTipo);

const btnPub = root.querySelector('#btnNoticiaPublicar');
console.log('bindOnce: btnNoticiaPublicar encontrado?', !!btnPub);


  if (destinoTipo) {
    destinoTipo.addEventListener('change', renderDestinoExtra);
  }

  if (btnPub) {
    btnPub.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('bindOnce: click en Publicar noticia');
      saveNoticia();
    });
  } else {
    console.warn('bindOnce: NO se encontró el botón #btnNoticiaPublicar');
  }

  const tbody = $('#noticiasTableBody');
  if (tbody) {
    tbody.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;

      if (act === 'edit') {
        const n = noticiasCache.find(x => String(x.id) === String(id));
        if (n) fillFormForEdit(n);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (act === 'del') {
        deleteNoticia(id);
      }
    });
  }
}
  // =============================
  // Init sección
  // =============================
  async function initNoticiasSection() {
  console.log('initNoticiasSection() llamado');
  bindOnce();
  await Promise.all([loadActividades(), loadCategorias()]);
  renderDestinoExtra();
  await loadNoticias();
}

  // Exponer para club.js
  window.initNoticiasSection = initNoticiasSection;

  // Por si abren noticias.html directo
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('noticias-section')) {
      initNoticiasSection();
    }
  });

})();
