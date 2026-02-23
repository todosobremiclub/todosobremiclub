async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();

  if (!data.ok) {
    alert(data.error || 'Login inválido');
    return;
  }

  // Guardar token
  localStorage.setItem('token', data.token);

  // Leer rol desde la respuesta
  const roles = data.user.roles || [];
  const hasSuperadmin = roles.some(r => r.role === 'superadmin');

  if (hasSuperadmin) {
    // ✅ Superadmin → consola global
    window.location.href = '/superadmin.html';
  } else {
    // ✅ Admin / Staff → web del club
    // Por ahora usamos una genérica
    window.location.href = '/club.html';
  }
}