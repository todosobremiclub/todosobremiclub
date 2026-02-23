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

  localStorage.setItem('token', data.token);
  window.location.href = '/superadmin.html';
}
