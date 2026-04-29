(async function init() {
  // ===============================
  // Helpers auth (JWT token)
  // ===============================
  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  async function fetchJsonAuth(url, options = {}) {
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

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text };
    }

    return { res, data };
  }

  // ===============================
  // API helpers
  // ===============================
  async function fetchMe() {
    const { res, data } = await fetchJsonAuth('/auth/me');
    if (!res.ok || !data.ok) throw new Error(data.error || 'No autorizado');
    return data.user;
  }

  async function fetchClubInfo(clubId) {
    const { res, data } = await fetchJsonAuth(`/club/${clubId}`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando club');
    return data.club;
  }

function setupImpersonationBanner() {
  const isImp = localStorage.getItem('impersonated') === '1';
  const banner = document.getElementById('impersonationBanner');
  const nameEl = document.getElementById('impersonationClubName');
  const btnExit = document.getElementById('btnExitImpersonation');

  if (!banner) return;

  if (!isImp) {
    banner.style.display = 'none';
    return;
  }

  const clubName = localStorage.getItem('impersonatedClubName') || '';
  if (nameEl && clubName) nameEl.textContent = `— ${clubName}`;

  banner.style.display = 'flex';

  btnExit?.addEventListener('click', () => {
    const original = localStorage.getItem('token_original');
    if (original) {
      localStorage.setItem('token', original);
    }
    localStorage.removeItem('token_original');
    localStorage.removeItem('impersonated');
    localStorage.removeItem('impersonatedClubName');
    localStorage.removeItem('activeClubId');

    // Volver a Super Admin
    window.location.href = '/superadmin.html';
  });
}

  // ===============================
  // QR (Postulación) - botón global
  // ===============================
  let currentClub = null; // se setea cuando se carga el club seleccionado

  function buildApplyLink(club) {
    const token = club?.apply_token;
    if (!token) return null;
    return `${window.location.origin}/postularse.html?clubId=${encodeURIComponent(club.id)}&t=${encodeURIComponent(token)}`;
  }

  function openQRModal() {
    const modal = document.getElementById('modalQR');
    if (!modal) return;
    modal.classList.remove('hidden');
  }

  function closeQRModal() {
    const modal = document.getElementById('modalQR');
    if (!modal) return;
    modal.classList.add('hidden');
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }

  function renderQR(link) {
    const qrContainer = document.getElementById('qrContainer');
    const qrLink = document.getElementById('qrLink');
    if (!qrContainer || !qrLink) return;

    qrLink.value = link || '';
    qrContainer.innerHTML = '';

    if (!link) {
      qrContainer.innerHTML = `<div class="muted">No se pudo generar el QR (falta apply_token del club).</div>`;
      return;
    }

    const img = document.createElement('img');
    img.alt = 'QR Postulación';
    img.style.width = '250px';
    img.style.height = '250px';
    img.style.borderRadius = '12px';
    img.style.border = '2px solid var(--color-primary)';
    img.style.background = '#fff';
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}`;

    qrContainer.appendChild(img);
  }

  function bindQROnce() {
    const btn = document.getElementById('btnVerQR');
    const modal = document.getElementById('modalQR');
    if (!btn || !modal) return;

    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', () => {
      if (!currentClub) {
        alert('No hay club activo cargado todavía.');
        return;
      }
      const link = buildApplyLink(currentClub);
      renderQR(link);
      openQRModal();
    });

    document.getElementById('btnCloseQR')?.addEventListener('click', closeQRModal);

    document.getElementById('btnCopyQR')?.addEventListener('click', async () => {
      const link = document.getElementById('qrLink')?.value || '';
      if (!link) return alert('No hay link para copiar.');
      const ok = await copyTextToClipboard(link);
      alert(ok ? '✅ Link copiado' : 'No se pudo copiar el link.');
    });

    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) closeQRModal();
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeQRModal();
      }
    });
  }

  // ===============================
  // UI helpers
  // ===============================
  function fillSelect(roles) {
    const sel = document.getElementById('clubSelect');
    if (!sel) return;

    sel.innerHTML = '';
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.club_id;
      opt.textContent = `${r.club_name} (${r.role})`;
      sel.appendChild(opt);
    });

    const saved = localStorage.getItem('activeClubId');
    if (saved && roles.some(r => String(r.club_id) === String(saved))) {
      sel.value = saved;
    }
  }

  async function applySelected(roles, user) {
    const sel = document.getElementById('clubSelect');
    if (!sel) return;

    const clubId = sel.value;
    const match = roles.find(r => String(r.club_id) === String(clubId));
    if (!match) return;

    localStorage.setItem('activeClubId', match.club_id);

    const meLabel = document.getElementById('meLabel');
    if (meLabel) meLabel.textContent = `Usuario: ${user.email}`;

    const roleBadge = document.getElementById('roleBadge');
    if (roleBadge) roleBadge.textContent = `Rol: ${match.role}`;

// Permisos del rol para este club
const __p = buildPermissions(match.role);
window.__clubPerms = __p;
window.__clubRole = __p.role;
applyNavVisibility(__p);

    let club;
try {
  club = await fetchClubInfo(match.club_id);
} catch (e) {
  // club inexistente o borrado
  localStorage.removeItem('activeClubId');
  alert('El club seleccionado ya no existe.');
  window.location.reload();
  return;
}

currentClub = club; // ✅ guardamos para el QR
window.currentClub = club; // ✅ para el onclick global
bindQROnce(); // (puede quedar, no molesta)


    // ===============================
    // Título / info
    // ===============================
    const titleEl = document.getElementById('clubTitle');
    if (titleEl) titleEl.textContent = club.name || 'Panel del Club';
    document.title = club.name ? `Club • ${club.name}` : 'Panel del Club';

    const infoEl = document.getElementById('clubInfo');
    if (infoEl) {
      infoEl.innerHTML = `${club.name}<br>${club.city || ''} ${club.province || ''}`;
    }

    // ===============================
    // Logo
    // ===============================
    const logo = document.getElementById('clubLogo');
    if (logo) {
      if (club.logo_url) logo.src = club.logo_url;
      else logo.removeAttribute('src');
    }

    // ===============================
    // Fondo
    // ===============================
    if (club.background_url) {
      document.body.style.backgroundImage = `url('${club.background_url}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = 'none';
    }

    // ===============================
    // ✅ COLORES DEL CLUB (THEME)
    // ===============================
    const root = document.documentElement;
    root.style.setProperty('--color-primary', club.color_primary || '#2563eb');
    root.style.setProperty('--color-secondary', club.color_secondary || '#1e40af');
    root.style.setProperty('--color-accent', club.color_accent || '#facc15');

    // ===============================
    // Recargar sección actual
    // ===============================
    if (window.currentSection) {
  const perms = window.__clubPerms;
  if (perms && perms.canAccess(window.currentSection)) loadSection(window.currentSection);
  else loadSection(pickDefaultSection(perms || buildPermissions(match.role)));
}
  }

// ===============================
// PERMISOS POR ROL (cliente)
// ===============================
const ALL_SECTIONS = [
  'socios','pendientes','pagos','gastos',
  'noticias','notificaciones','cumples',
  'configuracion','reportes','acceso'
];

function normalizeRole(role){
  const r = String(role || '').toLowerCase();
  if (r === 'read' || r === 'readonly' || r === 'solo lectura' || r === 'solo_lectura') return 'solo_lectura';
  if (r === 'comunicacion' || r === 'comunicación' || r === 'comms') return 'comunicacion';
  if (r === 'finanzas' || r === 'finance') return 'finanzas';
  if (r === 'staff') return 'admin'; // compat: staff se trata como admin
  return r;
}

function buildPermissions(role){
  const r = normalizeRole(role);
  return {
    role: r,
    // Acceso a secciones (qué puede ver)
    canAccess(section){
      if (r === 'comunicacion') return ['noticias','notificaciones','cumples'].includes(section);
      return ALL_SECTIONS.includes(section);
    },
    // Escritura / ejecutar acciones (mutaciones)
    canWrite(section){
      if (r === 'admin') return true;
      if (r === 'finanzas') return ['pagos','gastos','reportes'].includes(section);
      if (r === 'comunicacion') return ['noticias','notificaciones','cumples'].includes(section);
      return false; // solo_lectura u otros
    }
  };
}

// Oculta/mostrar botones del menú según canAccess
function applyNavVisibility(perms){
  document.querySelectorAll('[data-section]').forEach(btn => {
    const sec = btn.dataset.section;
    if (!sec) return;
    btn.style.display = perms.canAccess(sec) ? '' : 'none';
  });
}

// Sección inicial según rol
function pickDefaultSection(perms){
  return (perms.role === 'comunicacion') ? 'noticias' : 'socios';
}

// Guard de mutaciones: bloquea fetch no-GET cuando la sección actual no permite escribir.
// ⚠️ No reemplaza validación en backend, pero evita “ejecutar” desde la UI.
(function wrapFetchOnce(){
  if (window.__tsmcFetchWrapped) return;
  window.__tsmcFetchWrapped = true;

  const _fetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    try{
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const method = String((init && init.method) || 'GET').toUpperCase();
      const isSameOrigin = !/^https?:\/\//i.test(url) || url.startsWith(window.location.origin);

      if (isSameOrigin && method !== 'GET' && method !== 'HEAD'){
        const sec = window.currentSection || 'socios';
        const p = window.__clubPerms;
        if (p && !p.canWrite(sec)){
          const body = JSON.stringify({ ok:false, error:'No autorizado para modificar en esta sección.'});
          return new Response(body, { status: 403, headers: { 'Content-Type':'application/json' } });
        }
      }
    }catch(e){}
    return _fetch(input, init);
  };
})();

  // ===============================
  // CONTROL DE SECCIONES
  // ===============================
  window.currentSection = null;

  async function loadSection(sectionName) {
    const container = document.getElementById('sectionContainer');
    if (!container) return;

// Si veníamos de Control de acceso, apagamos cámara antes de cambiar de sección
if (window.currentSection === 'acceso' && window.cleanupAccesoSection) {
  try { window.cleanupAccesoSection(); } catch {}
}

    try {
// Permiso de acceso a la sección
const perms = window.__clubPerms;
if (perms && !perms.canAccess(sectionName)) {
  container.innerHTML = `<div class="muted">⛔ No tenés permiso para acceder a esta sección.</div>`;
  return;
}
      window.currentSection = sectionName;

      const res = await fetch(`/sections/${sectionName}.html?v=20260331-1`);
      if (!res.ok) throw new Error('No se pudo cargar la sección');

      const html = await res.text();
      container.innerHTML = html;

      if (sectionName === 'socios' && window.initSociosSection) {
        await window.initSociosSection();
      }

if (sectionName === 'acceso' && window.initAccesoSection) {
  await window.initAccesoSection();
}


      if (sectionName === 'pendientes' && window.initPendientesSection) {
        await window.initPendientesSection();
      }

      if (sectionName === 'configuracion' && window.initConfiguracionSection) {
        await window.initConfiguracionSection();
      }

      if (sectionName === 'gastos' && window.initGastosSection) {
        await window.initGastosSection();
      }

      if (sectionName === 'cumples' && window.initCumplesSection) {
        await window.initCumplesSection();
      }

      if (sectionName === 'pagos' && window.initPagosSection) {
        await window.initPagosSection();
      }

      if (sectionName === 'reportes' && window.initReportesSection) {
        await window.initReportesSection();
      }

      if (sectionName === 'noticias' && window.initNoticiasSection) {
        await window.initNoticiasSection();
      }
if (sectionName === 'notificaciones' && window.initNotificacionesSection) {
  await window.initNotificacionesSection();
}
    } catch (e) {
      container.innerHTML = `<pre>Error: ${e.message}</pre>`;
    }
  }

  // ===============================
  // INIT GENERAL
  // ===============================
  let user;
  try {
    user = await fetchMe();

setupImpersonationBanner();


    if (!user.roles || user.roles.length === 0) {
      const msgBox = document.getElementById('msgBox');
      if (msgBox) {
        msgBox.className = 'msg err';
        msgBox.textContent = 'Tu usuario no tiene clubes asignados.';
      }
      return;
    }



    if (user.roles.some(r => r.role === 'superadmin')) {
  localStorage.removeItem('activeClubId');
  window.location.href = '/superadmin.html';
  return;
}

    fillSelect(user.roles);

    const clubSelect = document.getElementById('clubSelect');
    if (clubSelect) {
      clubSelect.addEventListener('change', () =>
        applySelected(user.roles, user)
      );
    }

    await applySelected(user.roles, user);

    document.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', () =>
        loadSection(btn.dataset.section)
      );
    });

    loadSection(pickDefaultSection(window.__clubPerms || buildPermissions('admin')));
  } catch (e) {
    console.error(e);
    localStorage.removeItem('token');
    localStorage.removeItem('activeClubId');
    alert('Sesión inválida o expirada.');
    window.location.href = '/admin.html';
  }
})();

// ===============================
// QR GLOBAL – handler directo
// ===============================
window.openClubQR = function () {
  try {
    // ✅ usa el club que ya cargaste al seleccionar
    // (vamos a setear window.currentClub dentro de applySelected)
    if (!window.currentClub) {
      alert('No hay club activo cargado todavía.');
      return;
    }

    const token = window.currentClub.apply_token;
    if (!token) {
      alert('Este club no tiene habilitado el QR de postulación (falta apply_token).');
      return;
    }

    const link =
      `${window.location.origin}/postularse.html?clubId=${encodeURIComponent(window.currentClub.id)}&t=${encodeURIComponent(token)}`;

    const qrContainer = document.getElementById('qrContainer');
    const qrLink = document.getElementById('qrLink');
    const modal = document.getElementById('modalQR');

    if (!qrContainer || !qrLink || !modal) {
      alert('No se pudo abrir el QR (falta el modalQR/qrContainer/qrLink en club.html).');
      return;
    }

    qrLink.value = link;
    qrContainer.innerHTML = '';

    const img = document.createElement('img');
    img.alt = 'QR Postulación';
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}`;
    img.style.width = '250px';
    img.style.height = '250px';
    img.style.borderRadius = '12px';
    img.style.border = '2px solid var(--color-primary)';
    img.style.background = '#fff';

    qrContainer.appendChild(img);
    modal.classList.remove('hidden');
  } catch (e) {
    console.error(e);
    alert('Error al generar el QR.');
  }
};
