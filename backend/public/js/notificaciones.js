// public/js/notificaciones.js
(() => {
  console.log('[notificaciones] script cargado ✅');

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Sesión expirada');
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club activo');
      throw new Error('No club');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers ?? {};
    headers.Authorization = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function sendNotificacion() {
    console.log('[notificaciones] enviando…');

    const titulo = document.getElementById('pushTitulo')?.value?.trim();
    const cuerpo = document.getElementById('pushCuerpo')?.value?.trim();

    if (!titulo || !cuerpo) {
      alert('Completá título y mensaje');
      return;
    }

    const clubId = getActiveClubId();

    const { res, data } = await fetchAuth(
      `/club/${clubId}/notificaciones`,
      {
        method: 'POST',
        json: true,
        body: JSON.stringify({ titulo, cuerpo })
      }
    );

    if (!res.ok || !data.ok) {
      alert(data.error || 'Error enviando');
      return;
    }

    alert('✅ Notificación enviada');
    document.getElementById('pushTitulo').value = '';
    document.getElementById('pushCuerpo').value = '';
  }

  // ✅ EVENT DELEGATION GLOBAL
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btnPushEnviar');
    if (!btn) return;

    e.preventDefault();
    console.log('[notificaciones] click Guardar y enviar ✅');
    sendNotificacion().catch(err => {
      console.error(err);
      alert(err.message || 'Error');
    });
  });

  // opcional: para que club.js no rompa
  window.initNotificacionesSection = async () => {
    console.log('[notificaciones] init sección');
  };
})();