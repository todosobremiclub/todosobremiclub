(async function init() {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Tu sesión expiró. Iniciá sesión nuevamente.');
    window.location.href = '/admin.html';
    return;
  }

  async function fetchMe() {
    const res = await fetch('/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('No autorizado');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'No autorizado');
    return data.user;
  }

  async function fetchClubInfo(clubId) {
    const res = await fetch(`/club/${clubId}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
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

  async function applySelected(roles) {
    const sel = document.getElementById('clubSelect');
    const clubId = sel.value;

    const match = roles.find(r => String(r.club_id) === String(clubId));
    if (!match) return;

    localStorage.setItem('activeClubId', match.club_id);

    document.getElementById('meLabel').textContent = `Usuario: ${user.email}`;
    document.getElementById('roleBadge').textContent = `Rol: ${match.role}`;

    const club = await fetchClubInfo(match.club_id);

    document.getElementById('clubInfo').innerHTML =
      `<strong>${club.name}</strong><br>${club.city || ''} ${club.province || ''}`;

    const logo = document.getElementById('clubLogo');
    if (club.logo_url) logo.src = club.logo_url;
    else logo.removeAttribute('src');

    if (club.background_url) {
      document.body.style.backgroundImage = `url('${club.background_url}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = 'none';
    }

    // 👉 cuando cambia el club, recargamos la sección actual
    if (window.currentSection) {
      loadSection(window.currentSection);
    }
  }



  // ===============================
  // SECCIONES (Socios primero)
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

      // init por sección
      // init por sección
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



    } catch (e) {
      container.innerHTML = `<div style="color:red;">Error: ${e.message}</div>`;
    }
  }

  // ===============================
  // INIT
  // ===============================
  let user;
  try {
    user = await fetchMe();

    if (!user.roles || user.roles.length === 0) {
      document.getElementById('msgBox').className = 'msg err';
      document.getElementById('msgBox').textContent =
        'Tu usuario no tiene clubes asignados.';
      return;
    }

    // superadmin no entra al panel de club
    if (user.roles.some(r => r.role === 'superadmin')) {
      window.location.href = '/superadmin.html';
      return;
    }

    fillSelect(user.roles);

    document
      .getElementById('btnApplyClub')
      .addEventListener('click', () => applySelected(user.roles));

    await applySelected(user.roles);

    // menú lateral
    document.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', () => loadSection(btn.dataset.section));
    });

    // sección por defecto
    loadSection('socios');

  } catch (e) {
    console.error(e);
    localStorage.removeItem('token');
    localStorage.removeItem('activeClubId');
    alert('Sesión inválida o expirada.');
    window.location.href = '/admin.html';
  }
})();