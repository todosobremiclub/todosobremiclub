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
    if (saved && roles.some(r => String(r.club_id) === String(saved))) sel.value = saved;
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
  }

  let user;
  try {
    user = await fetchMe();

    if (!user.roles || user.roles.length === 0) {
      document.getElementById('msgBox').className = 'msg err';
      document.getElementById('msgBox').textContent =
        'Tu usuario no tiene clubes asignados.';
      return;
    }

    // superadmin no entra acá
    if (user.roles.some(r => r.role === 'superadmin')) {
      window.location.href = '/superadmin.html';
      return;
    }

    fillSelect(user.roles);

    document.getElementById('btnApplyClub')
      .addEventListener('click', () => applySelected(user.roles));

    await applySelected(user.roles);

  } catch (e) {
    console.error(e);
    localStorage.removeItem('token');
    alert('Sesión inválida o expirada.');
    window.location.href = '/admin.html';
  }
})();