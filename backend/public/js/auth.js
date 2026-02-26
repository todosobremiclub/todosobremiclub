async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      alert(data.error || 'Login inválido');
      return;
    }

    // ✅ Guardar token (JWT)
    if (data.token) localStorage.setItem('token', data.token);

    // (opcional) limpiar club activo previo
    // localStorage.removeItem('activeClubId');

    const roles = data.user?.roles || [];
    const hasSuperadmin = roles.some(r => r.role === 'superadmin');

    if (hasSuperadmin) {
      window.location.href = '/superadmin.html';
    } else {
      window.location.href = '/club.html';
    }
  } catch (err) {
    console.error(err);
    alert('Error de conexión. Intentá nuevamente.');
  }
}
