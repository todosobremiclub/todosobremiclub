(async function init() {
  // ✅ Sesión por cookie: validamos con /auth/me
  async function fetchMe() {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (res.status === 401) throw new Error('No autorizado');
    if (!res.ok) throw new Error('No autorizado');
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || 'No autorizado');
    return data.user;
  }

  async function fetchClubInfo(clubId) {
    const res = await fetch(`/club/${clubId}`, { credentials: 'include' });
    if (res.status === 401) throw new Error('No autorizado');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando club');
    return data.club;
  }

  function fillSelect(roles) {
    const sel = document.getElementById('clubSelect');
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
    const clubId = sel.value;
    const match = roles.find(r => String(r.club_id) === String(clubId));
    if (!match) return;

    localStorage.setItem('activeClubId', match.club_id);

    document.getElementById('meLabel').textContent = `Usuario: ${user.email}`;
    document.getElementById('roleBadge').textContent = `Rol: ${match.role}`;

    const club = await fetchClubInfo(match.club_id);

    // ✅ Título con nombre del club
    const titleEl = document.getElementById('clubTitle');
    if (titleEl) titleEl.textContent = club.name || 'Panel del Club';
    document.title = club.name ? `Club • ${club.name}` : 'Panel del Club';

    document.getElementById('clubInfo').innerHTML = `${club.name}
${club.city || ''} ${club.province || ''}`;

    const logo = document.getElementById('clubLogo');
    if (club.logo_url) logo.src = club.logo_url;
    else logo.removeAttribute('src');

    // Fondo
    if (club.background_url) {
      document.body.style.backgroundImage = `url('${club.background_url}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = 'none';
    }

    // recargar la sección actual si existía
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

      const res = await fetch(`/sections/${sectionName}.html`, { credentials: 'include' });
      if (res.status === 401) throw new Error('No autorizado');
      if (!res.ok) throw new Error('No se pudo cargar la sección');

      const html = await res.text();
      container.innerHTML = html;

      if (sectionName === 'socios' && window.initSociosSection) await window.initSociosSection();
      if (sectionName === 'configuracion' && window.initConfiguracionSection) await window.initConfiguracionSection();
      if (sectionName === 'gastos' && window.initGastosSection) await window.initGastosSection();
      if (sectionName === 'cumples' && window.initCumplesSection) await window.initCumplesSection();
      if (sectionName === 'pagos' && window.initPagosSection) await window.initPagosSection();

    } catch (e) {
      container.innerHTML = `\nError: ${e.message}\n`;
      if (String(e.message).toLowerCase().includes('no autorizado')) {
        alert('Sesión inválida o expirada.');
        localStorage.removeItem('activeClubId');
        window.location.href = '/admin.html';
      }
    }
  }

  // ===============================
  // INIT GENERAL
  // ===============================
  let user;
  try {
    user = await fetchMe();

    if (!user.roles || user.roles.length === 0) {
      document.getElementById('msgBox').className = 'msg err';
      document.getElementById('msgBox').textContent = 'Tu usuario no tiene clubes asignados.';
      return;
    }

    // superadmin no entra al panel de club
    if (user.roles.some(r => r.role === 'superadmin')) {
      window.location.href = '/superadmin.html';
      return;
    }

    fillSelect(user.roles);

    // ✅ Aplica automáticamente al cambiar el select
    document.getElementById('clubSelect').addEventListener('change', () => applySelected(user.roles, user));

    // Aplica el club seleccionado por defecto
    await applySelected(user.roles, user);

    document.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', () => loadSection(btn.dataset.section));
    });

    loadSection('socios');

  } catch (e) {
    console.error(e);
    localStorage.removeItem('activeClubId');
    alert('Sesión inválida o expirada.');
    window.location.href = '/admin.html';
  }
})();