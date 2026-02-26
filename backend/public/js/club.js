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

    const club = await fetchClubInfo(match.club_id);

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

    root.style.setProperty(
      '--color-primary',
      club.color_primary || '#2563eb'
    );
    root.style.setProperty(
      '--color-secondary',
      club.color_secondary || '#1e40af'
    );
    root.style.setProperty(
      '--color-accent',
      club.color_accent || '#facc15'
    );

    // ===============================
    // Recargar sección actual
    // ===============================
    if (window.currentSection) {
      loadSection(window.currentSection);
    }
  }

  // ===============================
  // CONTROL DE SECCIONES
  // ===============================
  window.currentSection = null;

  async function loadSection(sectionName) {
    const container = document.getElementById('sectionContainer');
    if (!container) return;

    try {
      window.currentSection = sectionName;

      const res = await fetch(`/sections/${sectionName}.html`);
      if (!res.ok) throw new Error('No se pudo cargar la sección');

      const html = await res.text();
      container.innerHTML = html;

      if (sectionName === 'socios' && window.initSociosSection) {
        await window.initSociosSection();
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

    if (!user.roles || user.roles.length === 0) {
      const msgBox = document.getElementById('msgBox');
      if (msgBox) {
        msgBox.className = 'msg err';
        msgBox.textContent = 'Tu usuario no tiene clubes asignados.';
      }
      return;
    }

    if (user.roles.some(r => r.role === 'superadmin')) {
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

    loadSection('socios');
  } catch (e) {
    console.error(e);
    localStorage.removeItem('token');
    localStorage.removeItem('activeClubId');
    alert('Sesión inválida o expirada.');
    window.location.href = '/admin.html';
  }
})();