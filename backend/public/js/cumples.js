(() => {
  const $ = (id) => document.getElementById(id);

  // =============================
  // Auth / helpers (TOKEN)
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
      // no redirijo acá porque club.html puede estar cargando el selector,
      // pero si preferís, podés mandar a /club.html:
      // window.location.href = '/club.html';
      return null;
    }
    return c;
  }

  async function fetchAuthJson(url) {
    const res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + getToken()
      }
    });

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    return res.json().catch(() => ({ ok: false, error: 'Respuesta inválida del servidor' }));
  }

  // =============================
  // Carga Cumples
  // =============================
  async function loadCumples(mesYYYYMM) {
    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuthJson(`/club/${clubId}/cumples?mes=${mesYYYYMM}`);

    if (!data.ok) {
      console.error('Error cargando cumpleaños:', data.error);
      return;
    }

    renderHoy(data.hoy || []);
    renderCalendar(data.eventos || [], mesYYYYMM);
  }

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
          <img src="${foto}" class="cumple-foto" alt="${(s.nombre || '')}" onerror="this.src='/img/user-placeholder.png'" />
          <div class="cumple-info">
            <span class="cumple-nombre">${s.nombre || ''} ${s.apellido || ''}</span>
            <span class="cumple-detalle">${s.categoria || ''} — ${s.edad ?? ''} años</span>
          </div>
        </div>
      `;
    });
  }

  function renderCalendar(eventos, mes) {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    // ✅ Guard: FullCalendar cargado
    if (!window.FullCalendar || !window.FullCalendar.Calendar) {
      console.error('❌ FullCalendar no está definido. Revisar CDN y orden de scripts.');
      calendarEl.innerHTML = `
        <div class="msg err">
          No se pudo cargar el calendario de cumpleaños.
        </div>
      `;
      return;
    }

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      initialDate: mes + '-01',
      events: eventos,
      height: 'auto'
    });

    calendar.render();
  }

  async function initCumplesSection() {
    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    await loadCumples(mes);
  }

  // ✅ expuesto para club.js
  window.initCumplesSection = initCumplesSection;

  // Si esta sección se usa standalone, inicializa sola
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar') || document.getElementById('cumplesHoyContainer')) {
      // Nota: en el panel club esto se invoca desde club.js al cargar sección,
      // acá solo cubrimos el caso de abrir cumples.html directo.
      // initCumplesSection();
    }
  });
})();