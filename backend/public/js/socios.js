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

  // =============================
  // Debounce (para búsqueda en vivo)
  // =============================
  function debounce(fn, wait = 250) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
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
  // Filtro Categoría (toolbar) desde Configuración
  // =============================
  let categoriasToolbarCache = [];

  // Carga desde /config/categorias y llena el select #filtroCategoria
  async function loadCategoriasToolbar() {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/config/categorias`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      console.warn('No se pudieron cargar categorías (toolbar):', data.error);
      categoriasToolbarCache = [];
      fillFiltroCategoria([]); // deja "Todas"
      return;
    }

    categoriasToolbarCache = data.categorias || [];
    fillFiltroCategoria(categoriasToolbarCache);
  }

  // Renderiza options en #filtroCategoria preservando selección si existe
  function fillFiltroCategoria(items) {
    const sel = $('filtroCategoria');
    if (!sel) return;

    const current = sel.value; // preservar selección actual si sigue existiendo

    // Opción default
    sel.innerHTML = `<option value="">Todas las categorías</option>`;

    // Si no hay items, dejamos solo "Todas"
    if (!items || items.length === 0) {
      sel.value = '';
      return;
    }

    // Agregar categorías
    items.forEach((c) => {
      const nombre = String(c.nombre || '').trim();
      if (!nombre) return;
      const opt = document.createElement('option');
      opt.value = nombre;
      opt.textContent = nombre;
      sel.appendChild(opt);
    });

    // Restaurar selección si existe aún
    const exists = [...sel.options].some((o) => o.value === current);
    sel.value = exists ? current : '';
  }

  // =============================
  // Actividades (config) y filtro
  // =============================
  let actividadesConfigCache = [];

  async function loadActividadesConfig() {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/config/actividades`);
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      console.warn('No se pudieron cargar actividades:', data.error);
      actividadesConfigCache = [];
      fillActividadSelect([]);
      fillFiltroActividad([]);
      return;
    }
    actividadesConfigCache = data.actividades ?? [];
    fillActividadSelect(actividadesConfigCache);
    fillFiltroActividad(actividadesConfigCache);
  }

  function fillActividadSelect(items) {
    const sel = $('socioActividad');
    if (!sel) return;
    if (!items || items.length === 0) {
      sel.innerHTML = `<option value="">(No hay actividades cargadas)</option>`;
      return;
    }
    sel.innerHTML =
      `<option value="">Seleccionar...</option>` +
      items.map((a) => `<option value="${String(a.nombre)}">${String(a.nombre)}</option>`).join('');
  }

  function fillFiltroActividad(items) {
    const sel = $('filtroActividad');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Todas las actividades</option>`;
    if (!items || items.length === 0) {
      sel.value = '';
      return;
    }
    items.forEach((a) => {
      const nombre = String(a.nombre ?? '').trim();
      if (!nombre) return;
      const opt = document.createElement('option');
      opt.value = nombre;
      opt.textContent = nombre;
      sel.appendChild(opt);
    });
    const exists = [...sel.options].some((o) => o.value === current);
    sel.value = exists ? current : '';
  }

  // Si al editar viene una actividad que ya no está en config
  function ensureActividadOption(value) {
    const sel = $('socioActividad');
    if (!sel) return;
    const v = (value ?? '').trim();
    if (!v) return;
    const exists = [...sel.options].some((o) => o.value === v);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v + ' (no está en Configuración)';
      sel.appendChild(opt);
    }
  }

  // =============================
  // Categorías deportivas (config)
  // =============================
  let categoriasConfigCache = [];

  async function loadCategoriasConfig() {
    const clubId = getActiveClubId();
    const res = await fetchAuth(`/club/${clubId}/config/categorias`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      console.warn('Error cargando categorías:', data.error);
      fillCategoriaSelect([]);
      return;
    }

    fillCategoriaSelect(data.categorias ?? []);
  }

  function fillCategoriaSelect(items) {
    const sel = $('socioCategoria');
    const filtro = $('filtroCategoria');
    if (!sel || !filtro) return;

    // preservar lo que el edit quiso setear antes de que lleguen las categorías
    const pending = sel.dataset.pendingValue || sel.value;

    // llenar modal
    sel.innerHTML = `<option value="">Seleccionar...</option>`;
    items.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.nombre;
      opt.textContent = c.nombre;
      sel.appendChild(opt);
    });

    // aplicar selección pendiente si existe
    if (pending) {
      const exists = [...sel.options].some((o) => o.value === pending);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = pending;
        opt.textContent = pending + ' (no está en Configuración)';
        sel.appendChild(opt);
      }
      sel.value = pending;
    }
    delete sel.dataset.pendingValue;

    // llenar filtro preservando selección previa
    const current = filtro.value;
    filtro.innerHTML = `<option value="">Todas las categorías</option>`;
    items.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.nombre;
      opt.textContent = c.nombre;
      filtro.appendChild(opt);
    });
    filtro.value = current || '';
  }

  // Si al editar viene una categoría que no existe más en config
  function ensureCategoriaOption(value) {
    const sel = $('socioCategoria');
    if (!sel) return;
    const v = (value || '').trim();
    if (!v) return;
    const exists = [...sel.options].some((o) => o.value === v);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v + ' (no está en Configuración)';
      sel.appendChild(opt);
    }
  }

  // =============================
  // Helpers texto / formato
  // =============================
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



function fmtDMYShort(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  // dd-mm-aa
  return `${d}-${m}-${String(y).slice(2)}`;
}

  function onlyDigits(v) {
    return String(v ?? '').replace(/\D+/g, '');
  }

  function fmtDni(dni) {
    const d = onlyDigits(dni);
    if (d.length === 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}`;
    if (d.length === 7) return `${d.slice(0, 1)}.${d.slice(1, 4)}.${d.slice(4, 7)}`;
    return String(dni ?? '');
  }

  function phoneToWaE164(phone) {
    let d = onlyDigits(phone);
    if (!d) return null;

    d = d.replace(/^0+/, ''); // quita 0 inicial
    d = d.replace(/^15/, ''); // quita 15 si lo pusieron al inicio

    if (d.startsWith('54')) return d;

    if (d.length >= 10) return '549' + d; // AR típico con 11 dígitos
    return '54' + d;
  }

  function buildWaUrl(phone) {
    const e164 = phoneToWaE164(phone);
    if (!e164) return null;
    return `https://web.whatsapp.com/send?phone=${e164}`;
  }

  const WA_SVG = `
<svg viewBox="0 0 32 32" aria-hidden="true">
  <path fill="#25D366" d="M16 3C9.4 3 4 8.1 4 14.4c0 2.4.8 4.7 2.2 6.6L5 29l7.2-1.9c1.1.3 2.4.5 3.8.5 6.6 0 12-5.1 12-11.4S22.6 3 16 3z"/>
  <path fill="#fff" d="M13.4 10.6c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4-.2.3-.9.9-.9 2.2s1 2.6 1.1 2.8c.2.2 2 3.2 4.9 4.3 2.4.9 2.9.7 3.4.6.5-.1 1.6-.6 1.8-1.2.2-.6.2-1.1.1-1.2-.1-.2-.3-.3-.7-.5-.4-.2-1.6-.8-1.9-.9-.3-.1-.5-.2-.7.2-.2.4-.8.9-1 .9-.2.1-.4.1-.8-.1-.4-.2-1.5-.5-2.9-1.8-1.1-1-1.8-2.2-2-2.6-.2-.4 0-.6.2-.8.2-.2.4-.4.5-.6.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6-.1-.2-.6-1.6-.8-2z"/>
</svg>`;

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

  // Estados de adjuntos/comentarios por socio
  // { [socioId]: { tieneAdjuntos: boolean, tieneComentario: boolean } }
  let socioEstados = {};

  function buildSocioEstadosMap(estados) {
    socioEstados = {};
    (estados || []).forEach((e) => {
      if (!e || e.socio_id == null) return;
      const id = String(e.socio_id);
      socioEstados[id] = {
        tieneAdjuntos: !!e.tiene_adjuntos,
        tieneComentario: !!e.tiene_comentario
      };
    });
  }

  function getEstadoIconosForSocio(id) {
    const st = socioEstados[String(id)];
    if (!st) return '';
    const { tieneAdjuntos, tieneComentario } = st;
    if (tieneAdjuntos && tieneComentario) return '📎💬';
    if (tieneAdjuntos) return '📎';
    if (tieneComentario) return '💬';
    return '';
  }

  async function loadSocioEstadosFromBackend() {
    const clubId = getActiveClubId();
    try {
      const res = await fetchAuth(`/club/${clubId}/socios/estados`);
      const data = await safeJson(res);
      if (!res.ok || !data.ok) {
        console.warn('No se pudieron cargar estados de adjuntos/comentarios:', data.error);
        socioEstados = {};
        return;
      }
      buildSocioEstadosMap(data.estados || []);
    } catch (e) {
      console.error('Error cargando estados de socios (adjuntos/comentarios)', e);
      socioEstados = {};
    }
  }

  // =============================
  // Orden + paginación
  // =============================
  let sortKey = null; // 'pago' | 'numero' | 'dni' | ...
  let sortDir = 'asc'; // 'asc' | 'desc'
  let currentPage = 1;
  const pageSize = 50;

  // =============================
  // ADJUNTOS – helpers
  // =============================
  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    const kb = n / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    return mb.toFixed(1) + ' MB';
  }

  async function fetchAdjuntos(clubId, socioId) {
    const res = await fetchAuth(`/club/${clubId}/socios/${socioId}/adjuntos`);
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      console.error('Error cargando adjuntos', data.error);
      return [];
    }
    return data.adjuntos || [];
  }

 async function cargarAdjuntosEnModal(socioId) {
  const cont = $('listaAdjuntos');
  if (!cont) return;

  cont.innerHTML = '<div class="text-muted">Cargando adjuntos...</div>';

  const clubId = getActiveClubId();
  const adjuntos = await fetchAdjuntos(clubId, socioId);

  if (!adjuntos.length) {
    cont.innerHTML = '<div class="text-muted">No hay adjuntos ni comentarios guardados.</div>';
    return;
  }

  cont.innerHTML = '';

  adjuntos.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'd-flex justify-content-between align-items-start border-bottom py-1';

    const fecha = fmtDMYShort(a.created_at); // dd-mm-aa
    const nombreArchivo = a.filename || '(sin archivo)';

    row.innerHTML = `
      <div>
        <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
          <b>${escapeHtml(nombreArchivo)}</b>
        </a><br>
        ${
          a.comentario
            ? `<div><small>${escapeHtml(a.comentario)}</small></div>`
            : ''
        }
        <small>
          ${fecha ? fecha : ''}${fecha && a.size_bytes ? ' · ' : ''}
          ${a.size_bytes ? formatBytes(a.size_bytes) : ''}
        </small>
      </div>
      <button class="btn btn-sm btn-danger">Eliminar</button>
    `;

    row.querySelector('button')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este adjunto/comentario?')) return;

      const res = await fetchAuth(
        `/club/${clubId}/socios/${socioId}/adjuntos/${a.id}`,
        { method: 'DELETE' }
      );
      const data = await safeJson(res);
      if (!res.ok || !data.ok) {
        alert(data.error || 'Error eliminando adjunto');
        return;
      }
      await cargarAdjuntosEnModal(socioId);
    });

    cont.appendChild(row);
  });
}
// =============================
// COMENTARIOS – helpers
// =============================
async function fetchComentarios(clubId, socioId) {
  const res = await fetchAuth(`/club/${clubId}/socios/${socioId}/comentarios`);
  const data = await safeJson(res);
  if (!res.ok || !data.ok) {
    console.error('Error cargando comentarios', data.error);
    return [];
  }
  return data.comentarios || [];
}

async function cargarComentariosEnModal(socioId) {
  const cont = $('listaComentarios');
  if (!cont) return;

  cont.innerHTML = '<div class="text-muted">Cargando comentarios...</div>';

  const clubId = getActiveClubId();
  const comentarios = await fetchComentarios(clubId, socioId);

  if (!comentarios.length) {
    cont.innerHTML = '<div class="text-muted">No hay comentarios guardados.</div>';
    return;
  }

  cont.innerHTML = '';

  comentarios.forEach(c => {
    const row = document.createElement('div');
    row.className = 'border-bottom py-1';

    const fecha = fmtDMYShort(c.created_at);

    row.innerHTML = `
      <div><b>${fecha}</b></div>
      <div>${escapeHtml(c.comentario)}</div>
    `;

    cont.appendChild(row);
  });
}

// =============================
  // VISOR SIMPLE DE ADJUNTOS / COMENTARIOS
  // =============================
  function ensureDocsViewerModal() {
    let modal = document.getElementById('docsViewerModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'docsViewerModal';
    modal.className = 'modal hidden';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(0,0,0,0.55)';
    modal.style.zIndex = '20000';
    modal.style.display = 'none';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '18px';

    modal.innerHTML = `
      <div class="modal-content" style="max-width:640px; pointer-events:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <h3 id="docsViewerTitle" style="margin:0;"></h3>
          <button type="button" id="docsViewerClose" class="btn btn-secondary">✕</button>
        </div>
        <div id="docsViewerBody" style="margin-top:10px; max-height:60vh; overflow-y:auto;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      const body = document.getElementById('docsViewerBody');
      if (body) body.innerHTML = '';
    };

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });

    const btnClose = modal.querySelector('#docsViewerClose');
    if (btnClose) {
      btnClose.addEventListener('click', (ev) => {
        ev.preventDefault();
        close();
      });
    }

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal.style.display === 'flex') {
        close();
      }
    });

    return modal;
  }

  async function openDocsViewer({ socioId, showAdjuntos, showComentarios }) {
    const clubId = getActiveClubId();
    const modal = ensureDocsViewerModal();
    if (!modal) return;

    const titleEl = document.getElementById('docsViewerTitle');
    const bodyEl = document.getElementById('docsViewerBody');
    if (!titleEl || !bodyEl) return;

    const partesTitulo = [];
if (showAdjuntos) partesTitulo.push('Adjuntos');
if (showComentarios) partesTitulo.push('Comentarios');

// Si partesTitulo queda vacío, join() devuelve '', así que usamos 'Documentación' por defecto
titleEl.textContent = partesTitulo.join(' y ') || 'Documentación';


    let html = '';

    // Adjuntos
    if (showAdjuntos) {
      const adjuntos = await fetchAdjuntos(clubId, socioId);
      html += '<h4 style="margin:10px 0 4px;">Adjuntos</h4>';
      if (!adjuntos.length) {
        html += '<div class="text-muted">No hay adjuntos.</div>';
      } else {
        adjuntos.forEach((a) => {
          const fecha = fmtDMYShort(a.created_at);
          const nombreArchivo = a.filename || '(sin archivo)';
          html += `
            <div style="padding:6px 0; border-bottom:1px solid #eee;">
              <div>
                <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
                  <b>${escapeHtml(nombreArchivo)}</b>
                </a>
              </div>
              <div>
                <small>
                  ${fecha || ''}${fecha && a.size_bytes ? ' · ' : ''}
                  ${a.size_bytes ? formatBytes(a.size_bytes) : ''}
                </small>
              </div>
              ${a.comentario ? `<div><small>${escapeHtml(a.comentario)}</small></div>` : ''}
            </div>
          `;
        });
      }
    }

    // Comentarios
    if (showComentarios) {
      const comentarios = await fetchComentarios(clubId, socioId);
      html += '<h4 style="margin:14px 0 4px;">Comentarios</h4>';
      if (!comentarios.length) {
        html += '<div class="text-muted">No hay comentarios.</div>';
      } else {
        comentarios.forEach((c) => {
          const fecha = fmtDMYShort(c.created_at);
          html += `
            <div style="padding:6px 0; border-bottom:1px solid #eee;">
              <div><b>${fecha}</b></div>
              <div>${escapeHtml(c.comentario)}</div>
            </div>
          `;
        });
      }
    }

    if (!html) {
      html = '<div class="text-muted">No hay información para mostrar.</div>';
    }

    bodyEl.innerHTML = html;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }



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

    if (!categoriasConfigCache.length) loadCategoriasConfig().catch(() => {});

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
    if (!categoriasConfigCache.length) loadCategoriasConfig().catch(() => {});

    $('modalSocioTitle').textContent = 'Editar socio';
    $('socioNumero').value = socio.numero_socio ?? '';
    $('socioDni').value = socio.dni ?? '';
    $('socioNombre').value = socio.nombre ?? '';
    $('socioApellido').value = socio.apellido ?? '';

    $('socioActividad').value = socio.actividad ?? '';
    ensureActividadOption(socio.actividad);
    $('socioDireccion').value = socio.direccion ?? '';

    const catSel = $('socioCategoria');
    if (catSel) catSel.dataset.pendingValue = (socio.categoria ?? '').toString();
    $('socioCategoria').value = socio.categoria ?? '';
    ensureCategoriaOption(socio.categoria);

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
  // Usamos el modal que ya existe en socios.html
  const modal = document.getElementById('modalCarnet');
  if (!modal) return null;

  // Solo bindear una vez
  if (modal.dataset.bound === '1') return modal;
  modal.dataset.bound = '1';

  const btnClose = document.getElementById('btnCarnetClose');
  const btnOk    = document.getElementById('btnCarnetOk');
  const btnEdit  = document.getElementById('btnCarnetEdit');

  const handleClose = (ev) => {
    ev.preventDefault();
    closeCarnet();
  };

  // Cruz ✕
  if (btnClose) {
    btnClose.addEventListener('click', handleClose);
  }

  // Botón “Cerrar”
  if (btnOk) {
    btnOk.addEventListener('click', handleClose);
  }

  // Botón “Editar”
  if (btnEdit) {
    btnEdit.addEventListener('click', (ev) => {
      ev.preventDefault();
      const socio = sociosCache.find((x) => String(x.id) === String(carnetSocioId));
      if (socio) {
        closeCarnet();
        openModalEdit(socio);
      }
    });
  }

  // Cerrar haciendo click fuera del contenido
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) {
      closeCarnet();
    }
  });

  // Esc para cerrar
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeCarnet();
    }
  });

  return modal;
}

// IMPORTANTE: ajustar solo la primera línea de openCarnet
function openCarnet(socio) {
  const modal = ensureCarnetModal();
  if (!modal) return; // por si el HTML no está

  carnetSocioId = socio.id;


    const foto = socio.foto_url || '/img/user-placeholder.png';

    // CABECERA
    modal.querySelector('#carnetFoto').src = foto;
    modal.querySelector('#carnetNombre').textContent =
      `${socio.nombre ?? ''} ${socio.apellido ?? ''}`.trim();
    modal.querySelector('#carnetDni').textContent = `DNI: ${fmtDni(socio.dni)}`;
    modal.querySelector('#carnetCategoria').textContent =
      `Categoría: ${socio.categoria ?? '-'}`;

    const pago = pagoEstado(socio);
    modal.querySelector('#carnetPago').innerHTML =
      `<span class="pay-pill ${pago.ok ? 'pay-ok' : 'pay-bad'}">${escapeHtml(pago.label)}</span>`;

    // FICHA
    const extraEl = modal.querySelector('#carnetExtra');

    const ficha = [
      ['Estado de pago', pago.label],
      ['N° Socio', socio.numero_socio ?? '-'],
      ['Actividad', socio.actividad ?? '-'],
      ['Teléfono', socio.telefono ?? '-'],
      ['Dirección', socio.direccion ?? '-'],
      ['Nacimiento', fmtDMY(socio.fecha_nacimiento)],
      ['Año nacimiento', socio.anio_nacimiento ?? yearFromISO(socio.fecha_nacimiento)],
      ['Ingreso', fmtDMY(socio.fecha_ingreso)],
      ['Activo', socio.activo ? 'Sí' : 'No'],
      ['Becado', socio.becado ? 'Sí' : 'No']
    ];

    let html = '<div class="carnet-section">';
    ficha.forEach(([k, v]) => {
      html += `
        <div class="carnet-item">
          <span class="carnet-label">${escapeHtml(k)}:</span>
          <span class="carnet-value">${escapeHtml(v)}</span>
        </div>
      `;
    });
    html += '</div>';

    // DOCUMENTACIÓN (adjuntos/comentarios)
    const est = socioEstados[String(socio.id)] || {};
    const tieneAdj = est.tieneAdjuntos;
    const tieneCom = est.tieneComentario;

    if (tieneAdj || tieneCom) {
      html += `<hr><div class="carnet-label" style="margin-bottom:6px;">Documentación:</div>`;
      if (tieneAdj) html += `<div class="carnet-doc" data-doc="adjuntos">📎 Ver adjuntos</div>`;
      if (tieneCom) html += `<div class="carnet-doc" data-doc="comentarios">💬 Ver comentario</div>`;
    }

    extraEl.innerHTML = html;

    // Clicks en "Ver adjuntos / Ver comentario"
    extraEl.querySelectorAll('.carnet-doc').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tipo = btn.dataset.doc;
        if (tipo === 'adjuntos') {
          await openDocsViewer({
            socioId: socio.id,
            showAdjuntos: true,
            showComentarios: false
          });
        } else if (tipo === 'comentarios') {
          await openDocsViewer({
            socioId: socio.id,
            showAdjuntos: false,
            showComentarios: true
          });
        }
      });
    });

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeCarnet() {
    const modal = document.getElementById('modalCarnet');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  window.openCarnet = openCarnet;
  window.closeCarnet = closeCarnet;

  function fmtSocioNumero(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    return String(num).padStart(5, '0');
  }

  function getSortValue(s, key) {
    switch (key) {
      case 'pago': {
        return pagoEstado(s).label || '';
      }
      case 'numero':
        return Number(s.numero_socio ?? 0);
      case 'dni':
        return String(s.dni ?? '');
      case 'nombre':
        return String(s.nombre ?? '');
      case 'apellido':
        return String(s.apellido ?? '');
      case 'actividad':
        return String(s.actividad ?? '');
      case 'categoria':
        return String(s.categoria ?? '');
      case 'anio': {
        const y =
          s.anio_nacimiento ??
          (s.fecha_nacimiento ? Number(String(s.fecha_nacimiento).slice(0, 4)) : 0);
        return Number(y ?? 0);
      }
      case 'activo':
        return s.activo ? 1 : 0;
      case 'becado':
        return s.becado ? 1 : 0;
      default:
        return '';
    }
  }

  function sortRows(rows) {
    if (!sortKey) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;

    return rows.slice().sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);

      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * dir;
      }
      return (
        String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' }) * dir
      );
    });
  }

  function clampPage(p, totalPages) {
    if (totalPages <= 1) return 1;
    return Math.min(Math.max(1, p), totalPages);
  }

  function renderPagination(totalItems) {
    const el = document.getElementById('sociosPagination');
    if (!el) return;

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    currentPage = clampPage(currentPage, totalPages);

    const mkBtn = (label, page, active = false, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (active) b.classList.add('active');
      if (disabled) b.disabled = true;
      b.addEventListener('click', () => {
        currentPage = page;
        renderSocios(sociosCache);
      });
      return b;
    };

    el.innerHTML = '';
    el.appendChild(mkBtn('‹', currentPage - 1, false, currentPage === 1));

    const windowSize = 7;
    let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) {
      el.appendChild(mkBtn(String(p), p, p === currentPage));
    }

    el.appendChild(mkBtn('›', currentPage + 1, false, currentPage === totalPages));
  }

  function updateSortIndicators() {
    document.querySelectorAll('th.sortable').forEach((th) => {
      const old = th.querySelector('.sort-ind');
      if (old) old.remove();

      const key = th.dataset.sort;
      if (!key || key !== sortKey) return;

      const ind = document.createElement('span');
      ind.className = 'sort-ind';
      ind.textContent = sortDir === 'asc' ? '▲' : '▼';
      th.appendChild(ind);
    });
  }

  function bindSorting() {
    const root = document.getElementById('socios-section');
    if (!root) return;

    const table = root.querySelector('table');
    if (!table) return;

    if (table.dataset.sortBound === '1') return;
    table.dataset.sortBound = '1';

    table.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (!key) return;

        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDir = 'asc';
        }

        currentPage = 1;
        renderSocios(sociosCache);
      });
    });
  }

  // =============================
  // Render tabla
  // =============================

  function renderSocios(socios) {
    sociosCache = socios || [];
    const tbody = $('sociosTableBody');
    if (!tbody) return;

    const ordered = sortRows(sociosCache);

    const totalItems = ordered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    currentPage = clampPage(currentPage, totalPages);

    const startIdx = (currentPage - 1) * pageSize;
    const pageRows = ordered.slice(startIdx, startIdx + pageSize);

    const activos = ordered.filter((s) => s.activo).length;

    tbody.innerHTML = '';

    pageRows.forEach((s) => {
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

      const waUrl = buildWaUrl(s.telefono);
      const telTxt = (s.telefono ?? '').toString();
      const iconosEstado = getEstadoIconosForSocio(s.id);

      const tr = document.createElement('tr');
      tr.dataset.id = s.id;

      tr.innerHTML = `
        <td>${renderPagoPill(s)}</td>
        <td>${fmtSocioNumero(s.numero_socio)}</td>
        <td>${escapeHtml(fmtDni(s.dni))}</td>
        <td>${escapeHtml(s.nombre ?? '')}</td>
        <td>${escapeHtml(s.apellido ?? '')}</td>
        <td>${escapeHtml(s.actividad ?? '')}</td>
        <td>${escapeHtml(s.categoria ?? '')}</td>
        <td>
          <span class="wa-phone wa-action" data-phone="${escapeHtml(telTxt)}">
            ${escapeHtml(telTxt)}
          </span>
          ${
            waUrl
              ? `<a class="wa-link wa-action" href="${waUrl}" target="_blank" rel="noopener" title="WhatsApp Web">${WA_SVG}</a>`
              : ''
          }
        </td>
        <td>${s.anio_nacimiento ?? yearFromISO(s.fecha_nacimiento)}</td>
        <td>${fmtDMY(s.fecha_ingreso)}</td>
        <td>${s.activo ? 'Sí' : 'No'}</td>
        <td>${s.becado ? 'Sí' : 'No'}</td>
        <td>${fotoHtml}</td>
        <td style="white-space:nowrap;">
  <button title="Editar" class="btn-ico" data-act="edit" data-id="${s.id}">✏️</button>
  <button title="Eliminar" class="btn-ico" data-act="del" data-id="${s.id}">🗑️</button>
  ${
    iconosEstado
      ? `<span class="socio-flags" title="Adjuntos / comentarios" style="margin-left:6px;">${iconosEstado}</span>`
      : ''
  }
</td>
      `;

      tbody.appendChild(tr);
    });

    const countEl = $('sociosActivosCount');
    if (countEl) countEl.textContent = `Socios activos: ${activos}`;

    renderPagination(totalItems);
    updateSortIndicators();
  }

  // =============================
  // Filtros dropdown
  // =============================

  function refreshAnioOptions(socios) {
    const sel = $('filtroAnio');
    if (!sel) return;

    const current = sel.value;
    const years = [...new Set(
      (socios || [])
        .map((s) =>
          s.anio_nacimiento ||
          (s.fecha_nacimiento ? Number(String(s.fecha_nacimiento).slice(0, 4)) : null)
        )
        .filter(Boolean)
    )].sort((a, b) => b - a);

    sel.innerHTML = `<option value="">Todos los años</option>`;
    years.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      sel.appendChild(opt);
    });

    if (years.map(String).includes(current)) sel.value = current;
  }

  // =============================
  // Build query
  // =============================

  function buildQueryParams() {
    const q = new URLSearchParams();
    const search = $('sociosSearch')?.value?.trim();
    const categoria = $('filtroCategoria')?.value;
    const actividad = $('filtroActividad')?.value;
    const anio = $('filtroAnio')?.value;
    const verInactivos = $('verInactivos')?.checked;

    if (search) q.set('search', search);
    if (categoria) q.set('categoria', categoria);
    if (actividad) q.set('actividad', actividad);
    if (anio) q.set('anio', anio);
    if (!verInactivos) q.set('activo', '1');

    return q.toString();
  }

  async function loadSocios() {
    const clubId = getActiveClubId();
    const qs = buildQueryParams();

    currentPage = 1;

    // socios + estados en paralelo
    const [resSocios, resEstados] = await Promise.all([
      fetchAuth(`/club/${clubId}/socios${qs ? `?${qs}` : ''}`),
      fetchAuth(`/club/${clubId}/socios/estados`).catch((e) => e)
    ]);

    const data = await safeJson(resSocios);
    if (!resSocios.ok || !data.ok) {
      alert(data.error || 'Error cargando socios');
      return;
    }

    if (resEstados && resEstados.ok) {
      const dataEstados = await safeJson(resEstados);
      if (dataEstados.ok && Array.isArray(dataEstados.estados)) {
        buildSocioEstadosMap(dataEstados.estados);
      } else {
        socioEstados = {};
      }
    } else {
      socioEstados = {};
    }

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
      actividad: $('socioActividad').value.trim(),
      telefono: $('socioTelefono').value.trim() || null,
      direccion: $('socioDireccion').value.trim() || null,
      fecha_nacimiento: $('socioNacimiento').value,
      fecha_ingreso: $('socioIngreso').value || null,
      activo: $('socioActivo').checked,
      becado: $('socioBecado').checked
    };

    if (
      !payload.dni ||
      !payload.nombre ||
      !payload.apellido ||
      !payload.categoria ||
      !payload.actividad ||
      !payload.fecha_nacimiento
    ) {
      alert('Completá DNI, Nombre, Apellido, Categoría, Actividad y Fecha de nacimiento.');
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

      const socioId = creating ? data.socio?.id || data.id : editingId;
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
    const root =
      document.querySelector('.section-socios') || document.getElementById('socios-section');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    ensurePhotoViewer();
    ensureDraftPhotoUI();
    bindSorting();

    $('filtroActividad')?.addEventListener('change', loadSocios);
    $('btnNuevoSocio')?.addEventListener('click', openModalNew);
    $('btnCancelarSocio')?.addEventListener('click', closeModalSocio);
    $('btnGuardarSocio')?.addEventListener('click', saveSocio);

    $('btnBuscarSocios')?.addEventListener('click', loadSocios);

    const debouncedLoadSocios = debounce(loadSocios, 250);
    $('sociosSearch')?.addEventListener('input', debouncedLoadSocios);

    $('btnExportSocios')?.addEventListener('click', exportSocios);

    $('socioActividad').value = '';
    $('socioDireccion').value = '';

    $('sociosSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSocios();
    });

    $('filtroCategoria')?.addEventListener('change', loadSocios);
    $('filtroAnio')?.addEventListener('change', loadSocios);
    $('verInactivos')?.addEventListener('change', loadSocios);

   // SUBIR ADJUNTO (solo archivo, sin comentario)
$('btnSubirAdjunto')?.addEventListener('click', async () => {
  if (!editingId) {
    alert('Primero guardá el socio antes de adjuntar archivos.');
    return;
  }

  const clubId = getActiveClubId();
  const fileInput = $('adjuntoFile');
  const file = fileInput?.files?.[0];

  if (!file) {
    alert('Seleccioná un archivo.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('El archivo supera los 10MB.');
    return;
  }

  const fd = new FormData();
  fd.append('file', file);

  const btn = $('btnSubirAdjunto');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Subiendo...';
  }

  try {
    const res = await fetchAuth(`/club/${clubId}/socios/${editingId}/adjuntos`, {
      method: 'POST',
      body: fd
    });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      alert(data.error || 'Error subiendo adjunto');
      return;
    }

    // limpiamos solo el archivo
    fileInput.value = '';
    await cargarAdjuntosEnModal(editingId);
    // refrescamos estados para el clip 📎
    await loadSocioEstadosFromBackend().catch(() => {});
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📎 Subir adjunto';
    }
  }
});


// SUBIR COMENTARIO (sin archivo)
$('btnSubirComentario')?.addEventListener('click', async () => {
  if (!editingId) {
    alert('Primero guardá el socio antes de agregar comentarios.');
    return;
  }

  const txtArea = $('nuevoComentario');
  const texto = txtArea?.value?.trim();
  if (!texto) {
    alert('Escribí un comentario.');
    return;
  }

  const clubId = getActiveClubId();

  const btn = $('btnSubirComentario');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Subiendo...';
  }

  try {
    const res = await fetchAuth(`/club/${clubId}/socios/${editingId}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ comentario: texto }),
      json: true
    });
    const data = await safeJson(res);
    if (!res.ok || !data.ok) {
      alert(data.error || 'Error guardando comentario');
      return;
    }

    // limpio textarea y recargo histórico
    if (txtArea) txtArea.value = '';
    await cargarComentariosEnModal(editingId);
    await loadSocioEstadosFromBackend().catch(() => {});
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💬 Subir comentario';
    }
  }
});


         // CLICK en tabla: foto / editar / eliminar / WhatsApp / flags
$('sociosTableBody')?.addEventListener('click', async (ev) => {
  // Ver foto grande
  const img = ev.target.closest('[data-act="viewphoto"]');
  if (img) {
    const url = img.dataset.url;
    if (url) openPhotoViewer(url);
    return;
  }

  // Click en WhatsApp (no seguir con otras acciones)
  if (ev.target.closest('.wa-action')) {
    return;
  }

  // click en iconos de adjuntos/comentarios (📎 / 💬)
  const flagsEl = ev.target.closest('.socio-flags');
  if (flagsEl) {
    const tr = flagsEl.closest('tr');
    const id = tr?.dataset.id;
    if (!id) return;

    const socio = sociosCache.find((x) => String(x.id) === String(id));
    if (!socio) return;

    const texto = flagsEl.textContent || '';
    const showAdj = texto.includes('📎');
    const showCom = texto.includes('💬');

    await openDocsViewer({
      socioId: socio.id,
      showAdjuntos: showAdj,
      showComentarios: showCom
    });

    return;
  }

  // Botones Editar / Eliminar
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;

  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (!id) return;

  if (act === 'edit') {
    const socio = sociosCache.find((x) => String(x.id) === String(id));
    if (socio) openModalEdit(socio);
    return;
  }

  if (act === 'del') {
    if (confirm('¿Eliminar socio definitivamente?')) {
      await deleteSocio(id);
    }
    return;
  }
});


    // DOBLE CLICK WhatsApp – abrir WA
    $('sociosTableBody')?.addEventListener('dblclick', (ev) => {
      const waTarget = ev.target.closest('.wa-action');
      if (!waTarget) return;

      if (waTarget.tagName === 'A' && waTarget.href) {
        window.open(waTarget.href, '_blank', 'noopener');
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      const span = ev.target.closest('.wa-phone');
      if (span) {
        const phone = span.dataset.phone;
        const url = buildWaUrl(phone);
        if (url) window.open(url, '_blank', 'noopener');
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    });

    // Carga masiva: plantilla / subir Excel
    $('btnSociosTemplate')?.addEventListener('click', async () => {
      const clubId = getActiveClubId();
      const url = `/club/${clubId}/socios/template.xlsx`;

      const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + getToken() }
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        alert('No se pudo descargar la plantilla. ' + t);
        return;
      }

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `socios_${clubId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    });

    $('btnSociosBulkUpload')?.addEventListener('click', () => {
      const inp = $('inputSociosBulk');
      if (!inp) return;
      inp.value = '';
      inp.click();
    });

    $('inputSociosBulk')?.addEventListener('change', async () => {
      const inp = $('inputSociosBulk');
      const file = inp?.files?.[0];
      if (!file) return;

      const clubId = getActiveClubId();
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(`/club/${clubId}/socios/import.xlsx`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + getToken() },
        body: fd
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, error: text };
      }

      if (!res.ok || !data.ok) {
        alert(data.error || 'Error en carga masiva');
        return;
      }

      await loadSocios();
      showBulkLog(data);
    });

    function showBulkLog(data) {
      const modal = document.getElementById('modalBulkLog');
      const body = document.getElementById('bulkLogBody');
      if (!modal || !body) return;

      const ok = Number(data.insertedCount || 0);
      const err = Number(data.errorCount || 0);

      let html = `
        <div style="padding:10px; border-radius:10px; background:#f9fafb; border:1px solid #e5e7eb;">
          <b>Insertados:</b> ${ok} &nbsp;&nbsp; <b>Errores:</b> ${err}
        </div>
      `;
      const rows = data.errors || [];
      if (!rows.length) {
        html += `<div class="muted" style="margin-top:10px;">Sin errores.</div>`;
      } else {
        html += `
          <div style="margin-top:10px;">
            <table class="socios-table" style="background:#fff;">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>DNI</th>
                  <th>N° socio</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (r) => `
                  <tr>
                    <td>${r.row ?? '-'}</td>
                    <td>${r.dni ?? '-'}</td>
                    <td>${r.numero_socio ?? '-'}</td>
                    <td>${r.error ?? '-'}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      body.innerHTML = html;
      modal.classList.remove('hidden');

      const close = () => modal.classList.add('hidden');
      document.getElementById('btnBulkLogClose')?.addEventListener('click', close);
      document.getElementById('btnBulkLogOk')?.addEventListener('click', close);
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) close();
      });
    }

    // Doble click fila -> abrir Carnet (pero NO si fue WA o Acciones)
    root.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('.wa-action')) return;
      if (ev.target.closest('button[data-act]')) return;

      const tr = ev.target.closest('#sociosTableBody tr');
      if (!tr || !tr.dataset.id) return;

      const socio = sociosCache.find((x) => String(x.id) === String(tr.dataset.id));
      if (socio) window.openCarnet(socio);
    });

    $('modalSocio')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalSocio') closeModalSocio();
    });
  }

  async function initSociosSection() {
    bindOnce();
    await loadCategoriasConfig().catch(() => {});
    await loadActividadesConfig().catch(() => {});
    await loadSocios();
  }

  window.initSociosSection = initSociosSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.section-socios') || $('sociosTableBody')) {
      initSociosSection();
    }
  });
})();