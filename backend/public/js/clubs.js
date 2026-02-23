async function fetchMe() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/admin.html';
    return null;
  }

  const res = await fetch('/auth/me', {
    headers: {
      'Authorization': 'Bearer ' + token
    }
  });

  if (!res.ok) {
    localStorage.removeItem('token');
    window.location.href = '/admin.html';
    return null;
  }

  const data = await res.json();
  return data.user;
}

async function fetchClubInfo(clubId) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/club/${clubId}`, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  return res.json();
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('activeClubId');
  window.location.href = '/admin.html';
}

function fillClubSelect(roles) {
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

async function applyClub(roles) {
  const sel = document.getElementById('clubSelect');
  const clubId = sel.value;

  const match = roles.find(r => String(r.club_id) === String(clubId));
  if (!match) return;

  localStorage.setItem('activeClubId', match.club_id);

  document.getElementById('roleBadge').textContent = `Rol: ${match.role}`;

  const info = await fetchClubInfo(match.club_id);
  if (!info.ok) return;

  const club = info.club;

  document.getElementById('clubInfo').innerHTML =
    `<strong>${club.name}</strong><br>${club.city || ''} ${club.province || ''}`;

  const logo = document.getElementById('clubLogo');
  if (club.logo_url) logo.src = club.logo_url;

  if (club.background_url) {
    document.body.style.backgroundImage = `url('${club.background_url}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
  }
}

(async function init() {
  const user = await fetchMe();
  if (!user) return;

  document.getElementById('meLabel').textContent = user.email;

  if (!user.roles || user.roles.length === 0) {
    document.getElementById('msgBox').textContent =
      'Tu usuario no tiene clubes asignados.';
    document.getElementById('msgBox').className = 'msg err';
    return;
  }

  // Superadmin no debería estar acá
  if (user.roles.some(r => r.role === 'superadmin')) {
    window.location.href = '/superadmin.html';
    return;
  }

  fillClubSelect(user.roles);
  document.getElementById('btnApplyClub')
    .addEventListener('click', () => applyClub(user.roles));

  applyClub(user.roles);
})();