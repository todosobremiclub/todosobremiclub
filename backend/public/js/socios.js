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
  // Estado
  // =============================
  let editingId = null;
  let sociosCache = [];

  // Foto “draft” para alta/edición
  let draftPhoto = null; // { dataUrl, base64, mimetype, filename }

  // =============================
  // Util: fecha dd-mm-aaaa
  // =============================
  function fmtDMY(iso) {
    if (!iso) return '';
    const s = String(iso).slice(0, 10); // YYYY-MM-DD
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}-${m}-${y}`;
  }

  // =============================
  // Estado de pago (regla solicitada)
  // =============================
  function getCurrPrevYYYYMM() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const curr = y * 100 + m;
    const prev = (m === 1) ? ((y - 1) * 100 + 12) : (y * 100 + (m - 1));
    return { curr, prev };
  }

  function pagoEstado(s) {
    // Becado siempre al día
    if (s.becado) return { ok: true, label: 'Becado' };

    const last = s.last_pago_yyyymm ? Number(s.last_pago_yyyymm) : 0;
    const { prev, curr } = getCurrPrevYYYYMM();

    // Verde si pagó mes actual o mes anterior (o algo más nuevo)
    const ok = last >= prev && last <= (curr + 100); // tolerancia simple si cargan por adelantado
    return ok ? { ok: true, label: 'Al día' } : { ok: false, label: 'Impago' };
  }

  // =============================
  // Visor de foto (lightbox)
  // =============================
  function ensurePhotoViewer() {
    if (document.getElementById('photoViewerModal')) return;

    const modal = document.createElement('div');
    modal.id = 'photoViewerModal';
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.75);
      display:none; align-items:center; justify-content:center;
      z-index:9999; padding: 18px;
    `;

    modal.innerHTML = `
      <div style="background:#111827; color:#fff; padding:10px 12px; border-radius:10px; max-width: 92vw;">
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
    img.src = url;
    modal.style.display = 'flex';
  }

  // =============================
  // UI extra en modal socio: elegir foto (solo en edición/alta)
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
        <img id="socioFotoDraftPreview" alt="Preview" style="width:70px; height:70px; border-radius:10px; object-fit:cover; display:none; border:1px solid #ddd; background:#fff; cursor:pointer;" />
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
  // Modal socio (alta/edición)
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
  // Carnet digital (doble click)
  // =============================
  let carnetSocioId = null;

  function openCarnet(socio) {
    carnetSocioId = socio.id;

    const foto = socio.foto_url || '/img/user-placeholder.png';
    $('carnetFoto').src = foto;
    $('carnetFoto').onerror = function () { this.src = '/img/user-placeholder.png'; };

    $('carnetNombre').textContent = `${socio.nombre || ''} ${socio.apellido || ''}`.trim();
    $('carnetDni').textContent = `DNI: ${socio.dni || '—'}`;
    $('carnetCategoria').textContent = `Categoría: ${socio.categoria || '—'}`;

    const est = pagoEstado(socio);
    $('carnetPago').innerHTML = `<span class="pay-pill ${est.ok ? 'pay-ok' : 'pay-bad'}">${est¡Perfecto, Leo! Ya con tus `[socios.js](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/socios.js?EntityRepresentationId=55bd6112-01c6-46f3-81fb-b4b31275b283)` y `[club.js](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/club.js?EntityRepresentationId=9f3bbbc0-77d4-4a16-857a-1817eba25600)` completos, más los `[club.html](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%c2%a0Copilot/club.html?web=1&EntityRepresentationId=fefc3c56-a472-41ba-804e-458c9c8accf4)` y `[socios.html](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%c2%a0Copilot/socios.html?web=1&EntityRepresentationId=40ca7347-8258-49ae-b7b9-82669df9bb54)` actuales, armé **todo el pack de cambios** (lógica + UI + comportamiento) para que copies y pegues. Incluye también **un cambio en backend** para que la columna **Pago** se pueda calcular correctamente sin hacer 200 requests desde el frontend. [4](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/socios.js)[2](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/club.js)[1](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/club.html)[3](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/socios.html)[5](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/sociosRoutes.js)

---

# ✅ Archivos involucrados (son 5)
1) `public/club.html`  ✅ (header más chico, nombre de club, logo “contain”, sidebar más angosto, cambio automático de club sin botón) [1](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/club.html)  
2) `public/js/club.js` ✅ (cambio automático al seleccionar club + setear nombre del club en header) [2](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/club.js)  
3) `public/sections/socios.html` ✅ (encabezado más compacto, “Descargar Excel” solo ícono, tabla en una línea, modal carnet) [3](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/socios.html)  
4) `public/js/socios.js` ✅ (botón pago verde/rojo, becado siempre verde, fechas dd-mm-aaaa en tabla, iconos ✏️ 🗑, sin botón 📷 de foto en grilla, carnet digital en doble click) [4](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/socios.js)  
5) `src/routes/sociosRoutes.js` ✅ (**backend** agrega `pago_al_dia` calculado con pagos del mes actual o anterior) [5](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/sociosRoutes.js)  

> No necesitás pasar más archivos para estos cambios.

---

# 1) ✅ `public/club.html` (COMPLETO)

Copiá y pegá todo el archivo:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Panel del Club</title>

  <style>
    body { font-family: Arial, sans-serif; margin:0; padding:0; }

    .layout { display:flex; min-height: 100vh; }

    /* Sidebar más angosto */
    .sidebar { width: 210px; background:#111827; color:#fff; padding:10px; }
    .sidebar h3 { margin: 0 0 10px 0; font-size: 15px; }

    .navbtn {
      width:100%;
      text-align:left;
      padding:9px 10px;
      margin:6px 0;
      border:0;
      border-radius:8px;
      cursor:pointer;
      background:#1f2937;
      color:#fff;
      font-size: 14px;
    }
    .navbtn:hover { background:#374151; }

    .content { flex:1; padding: 12px; }

    /* Header más chico + fondo más visible */
    .topbar {
      display:flex;
      justify-content: space-between;
      align-items:center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(17,24,39,0.90), rgba(31,41,55,0.75));
      border: 1px solid rgba(255,255,255,0.15);
      color: #fff;
    }
    .topbar h2 { margin:0; font-size: 18px; letter-spacing: 0.2px; }
    .muted { color: rgba(255,255,255,0.85); font-size: 0.92rem; }

    /* Logo completo (contain) manteniendo tamaño */
    .logo {
      height: 48px;
      width: 48px;
      object-fit: contain;
      border-radius: 10px;
      border:1px solid rgba(255,255,255,0.25);
      background: rgba(255,255,255,0.95);
      padding: 2px;
      box-sizing: border-box;
    }

    .badge { display:inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(238,238,255,0.95); color:#111827; font-size: 12px; }

    .card {
      border:1px solid #ddd;
      border-radius:12px;
      padding:12px;
      margin-top:12px;
      max-width: 1200px;
      background: rgba(255,255,255,0.90);
    }

    .row { display:flex; gap: 12px; flex-wrap: wrap; align-items:flex-end; }

    label { display:block; font-size: 0.9rem; color:#444; margin-bottom:6px; }
    select, button, input { padding: 8px; }

    .section-header { display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .filters { display:flex; flex-wrap:wrap; gap:10px; margin: 10px 0; }

    .table-wrapper { overflow:auto; border:1px solid #ddd; border-radius:10px; background:#fff; }
    table { width:100%; border-collapse:collapse; }
    th, td { border-bottom:1px solid #eee; padding:8px; font-size: 14px; }
    th { background:#f7f7f7; text-align:left; white-space:nowrap; }
    td { white-space: nowrap; } /* filas en una línea */

    .modal.hidden { display:none; }
    .modal { position:fixed; inset:0; background:rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:999; }
    .modal-content { width:min(780px, 92vw); background:#fff; border-radius:12px; padding:16px; }
    .form-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:12px; }

    @media (max-width: 720px) {
      .form-grid { grid-template-columns: 1fr; }
      .sidebar { width: 180px; }
      .content { padding: 10px; }
      .topbar { padding: 10px; }
    }
  </style>

  <!-- FullCalendar (bundle global) -->
  <script defer src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js"></script>
</head>

<body>

  <div class="layout">
    <aside class="sidebar">
      <h3>☰ Menú</h3>
      <button class="navbtn" data-section="socios">👤 Socios</button>
      <button class="navbtn" data-section="pagos">💰 Pagos</button>
      <button class="navbtn" data-section="gastos">🧾 Gastos</button>
      <button class="navbtn" data-section="noticias">📣 Noticias</button>
      <button class="navbtn" data-section="cumples">🎂 Cumpleaños</button>
      <button class="navbtn" data-section="configuracion">⚙️ Configuración</button>
      <hr style="border-color:#374151;">
      <button class="navbtn" onclick="logout()">Cerrar sesión</button>
    </aside>

    <main class="content">

      <!-- Header -->
      <div class="topbar">
        <div>
          <h2 id="clubTitle">—</h2>
          <div class="muted" id="meLabel"></div>
        </div>

        <div class="row" style="gap:10px; align-items:center;">
          <img id="clubLogo" class="logo" alt="Logo club" />
          <span class="badge" id="roleBadge">Rol: —</span>
        </div>
      </div>

      <div class="card">
        <div class="row" style="align-items:flex-end;">
          <div style="min-width:260px;">
            <label>Seleccionar club (si tenés más de uno)</label>
            <select id="clubSelect"></select>
            <div class="muted" style="margin-top:6px; color:#374151;">
              Cambia automáticamente al seleccionar.
            </div>
          </div>

          <div class="muted" id="clubInfo" style="color:#111827;"></div>
        </div>

        <div id="msgBox" class="msg"></div>
      </div>

      <!-- CONTENEDOR DE SECCIONES -->
      <div class="card" id="sectionContainer">
        <div class="muted" style="color:#111827;">Elegí una sección del menú.</div>
      </div>

    </main>
  </div>

  <script>
    function logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      window.location.href = '/admin.html';
    }
  </script>

  <!-- Scripts principales -->
  <script src="/js/club.js"></script>
  <script src="/js/socios.js"></script>
  <script src="/js/configuracion.js"></script>
  <script src="/js/gastos.js"></script>
  <script src="/js/pagos.js"></script>

  <!-- Cumples -->
  <script defer src="/js/cumples.js"></script>
</body>
</html>