async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    // ✅ importante: lanzar error para que doLogin() lo capture
    throw new Error(data.error || 'Login inválido');
  }

  // ✅ Guardar token (JWT)
  if (data.token) localStorage.setItem('token', data.token);

  // ✅ SIEMPRE limpiar club activo previo (evita “pegado” a club borrado)
  localStorage.removeItem('activeClubId');

  const roles = data.user?.roles || [];
  const hasSuperadmin = roles.some(r => r.role === 'superadmin');

  if (hasSuperadmin) {
    window.location.href = '/superadmin.html';
  } else {
    window.location.href = '/club.html';
  }
}

