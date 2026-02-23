// Base64URL decode para JWT (maneja "-" "_" y padding)
function base64UrlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64);
  // decode unicode safely
  try {
    return decodeURIComponent(Array.prototype.map.call(decoded, c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
  } catch {
    return decoded;
  }
}

function getTokenPayload() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function showMsg(text, ok = false) {
  const box = document.getElementById('msgBox');
  if (!box) return;
  box.className = 'msg ' + (ok ? 'ok' : 'err');
  box.textContent = text;
}

function redirectToLogin(msg) {
  if (msg) alert(msg);
  window.location.href = '/admin.html';
}

function setMeLabel(payload) {
  const el = document.getElementById('meLabel');
  if (!el) return;
  el.textContent = payload?.email ? `Usuario: ${payload.email}` : '';
}

function setRoleBadge(role) {
  const el = document.getElementById('roleBadge');
  if (!el) return;
  el.textContent = `Rol: ${role || '—'}`;
}

function setClubInfo(clubName, clubId) {
  const el = document.getElementById('clubInfo');
  if (!el) return;
  el.innerHTML = clubName
    ? `<strong>${clubName}</strong><br><span class="muted">club_id: ${clubId}</span>`
    : '—';
}

function getRolesFromPayload(payload) {
  const roles = payload?.roles;
  return Array.isArray(roles) ? roles : [];
}

function getPreferredClubId(roles) {
  // Si el usuario ya eligió un club antes, respetarlo:
  const saved = localStorage.getItem('activeClubId');
  if (saved && roles.some(r => String(r.club_id) === String(saved))) return saved;

  // Si no, elegir el primero
  return roles[0]?.club_id || null;
}

function fillClubSelect(roles) {
  const sel = document.getElementById('clubSelect');
  if (!sel) return;

  sel.innerHTML = '';
  roles.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.club_id;
    opt.textContent = `${r.club_name} (${r.role})`;
    sel.appendChild(opt);
  });

  // Selección por defecto
  const preferred = getPreferredClubId(roles);
  if (preferred) sel.value = preferred;
}

function applySelectedClub(roles) {
  const sel = document.getElementById('clubSelect');
  if (!sel) return;

  const clubId = sel.value;
  const match = roles.find(r => String(r.club_id) === String(clubId));
  if (!match) {
    showMsg('No se encontró el club seleccionado en tus permisos.', false);
    return;
  }

  localStorage.setItem('activeClubId', match.club_id);
  setRoleBadge(match.role);
  setClubInfo(match.club_name, match.club_id);
  showMsg('✅ Club activo seleccionado correctamente', true);

  // En el futuro, acá podemos disparar carga de datos del club:
  // loadClubDashboard(match.club_id)
}

(function initClubPage() {
  const token = localStorage.getItem('token');
  if (!token) return redirectToLogin('Tu sesión expiró. Iniciá sesión nuevamente.');

  const payload = getTokenPayload();
  if (!payload) {
    localStorage.removeItem('token');
    return redirectToLogin('Token inválido. Iniciá sesión nuevamente.');
  }

  setMeLabel(payload);

  const roles = getRolesFromPayload(payload);
  if (roles.length === 0) {
    return showMsg('Tu usuario no tiene clubes asignados. Contactá al superadmin.', false);
  }

  // Si es superadmin, NO debería estar acá (lo mandamos a superadmin.html)
  const isSuperadmin = roles.some(r => r.role === 'superadmin');
  if (isSuperadmin) {
    window.location.href = '/superadmin.html';
    return;
  }

  // Llenar selector
  fillClubSelect(roles);

  // Aplicar selección inicial
  applySelectedClub(roles);

  // Botón aplicar
  const btn = document.getElementById('btnApplyClub');
  if (btn) btn.addEventListener('click', () => applySelectedClub(roles));
})();