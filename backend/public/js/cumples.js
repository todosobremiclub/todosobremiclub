(() => {
  const $ = (id) => document.getElementById(id);
  let calendar = null;

  // =============================
  // Auth helpers
  // =============================
  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club seleccionado');
      return null;
    }
    return c;
  }

  async function fetchAuthJson(url) {
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + getToken() }
    });

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    return res.json().catch(() => ({
      ok: false,
      error: 'Respuesta inválida del servidor'
    }));
  }

  // =============================
  // Carga Cumples (1 sola vez)
  // =============================
  async function loadCumplesInicial() {
    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuthJson(`/club/${clubId}/cumples`);
    if (!data.ok) {
      console.error('Error cargando cumpleaños:', data.error);
      return;
    }

    renderHoy(data.hoy ?? []);
    initCalendar(data.eventos ?? []);
  }

  // =============================
  // Cumples de HOY
  // =============================
  function renderHoy(lista) {
    const cont = $('cumplesHoyContainer');
    if (!cont) return;
    cont.innerHTML = '';

    if (!lista.length) {
      cont.innerHTML = `
        <div class="cumple-item">
          <div class="cumple-info">🟡 No hay cumpleaños hoy</div>
        </div>
      `;
      return;
    }

    lista.forEach((s) => {
      const foto = s.foto_url || '/img/user-placeholder.png';

      cont.innerHTML += `
        <div class="cumple-item">
          <img src="${foto}" class="cumple-foto"
               alt="${s.nombre || ''}"
               onerror="this.src='/img/user-placeholder.png'" />
          <div class="cumple-info">
            <span class="cumple-nombre">${s.nombre || ''} ${s.apellido || ''}</span>
            <span class="cumple-detalle">${s.categoria || ''} — ${s.edad ?? ''} años</span>
          </div>
        </div>
      `;
    });
  }

  // =============================
  // Calendario (solo una vez)
  // =============================
  function initCalendar(eventos) {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    // GMT-3 para la fecha inicial
    const ahora = new Date();
    const hoy = new Date(
      ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
    );
    const fechaInicial = hoy.toISOString().slice(0, 10); // YYYY-MM-DD

    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      initialDate: fechaInicial,
      height: 'auto',
      events
      // NOTA: no usamos datesSet, dejamos que el calendario navegue solo
    });

    calendar.render();
  }

  // =============================
  // Init Section
  // =============================
  async function initCumplesSection() {
    await loadCumplesInicial();
  }

  window.initCumplesSection = initCumplesSection;

  // Para cumples.html standalone
  document.addEventListener('DOMContentLoaded', () => {
    if ($('calendar') && $('cumplesHoyContainer')) {
      initCumplesSection();
    }
  });
})();