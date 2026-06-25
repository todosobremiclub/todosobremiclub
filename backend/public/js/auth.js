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

function openForgotPasswordModal() {
  document.getElementById('forgotModal').classList.remove('hidden');
  document.getElementById('forgotMsg').style.display = 'none';
}

function closeForgotPasswordModal() {
  document.getElementById('forgotModal').classList.add('hidden');
}

async function sendResetEmail() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msg = document.getElementById('forgotMsg');

  msg.style.display = 'none';

  if (!email) {
    msg.style.display = 'block';
    msg.textContent = 'Ingresá un email válido';
    return;
  }

  try {
    const res = await fetch('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    msg.style.display = 'block';
    msg.style.color = '#166534';
    msg.textContent =
      'Si el email existe, se enviaron instrucciones.';
  } catch (e) {
    msg.style.display = 'block';
    msg.style.color = '#dc2626';
    msg.textContent = 'Error enviando el mail';
  }
}

