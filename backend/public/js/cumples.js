(() => {
  const $ = (id) => document.getElementById(id);

  let calendar = null;    // instancia global de FullCalendar
  let currentMes = null;  // YYYY-MM actualmente cargado

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
      // en el panel del club normalmente esto lo setea club.js
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

    return res.json().catch(() => ({
      ok: false,
      error: 'Respuesta inválida del servidor'
    }));
  }

  // =============================
  // Carga Cumples
  // =============================
  async function loadCumples(mesYYYYMM, opts = {}) {
    const { onlyUpdateEvents = false } = opts;

    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuthJson(`/club/${clubId}/cumples?mes=${mesYYYYMM}`);

    if (!data.ok) {
      console.error('Error cargando cumpleaños:', data.error);
      return;
    }

    renderHoy(data.hoy ?? []);

    const eventos = data.eventos ?? [];

    if (!calendar || !onlyUpdateEvents) {
      // primera vez o queremos re-inicializar
      currentMes = mesYYYYMM;
      initCalendar(mesYYYYMM, eventos);
    } else {
      // ya hay calendario -> sólo actualizamos eventos
      calendar.removeAllEvents();
      eventos.forEach(ev => calendar.addEvent(ev));
    }
  }

  // =============================
  // Cumples HOY
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
          <img
            src="${foto}"
            class="cumple-foto"
            alt="${s.nombre || ''} ${s.apellido || ''}"
            onerror="this.src='/img/user-placeholder.png'"
          />
          <div class="cumple-info">
            <span class="cumple-nombre">${s.nombre || ''} ${s.apellido || ''}</span>
            <span class="cumple-detalle">${s.categoria || ''} — ${s.edad ?? ''} años</span>
          </div>
        </div>
      `;
    });
  }

  // =============================
  // Inicializar Calendario (solo UNA vez)
  // =============================
  function initCalendar(mesInicial, eventosIniciales) {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    // Guard: FullCalendar cargado
    if (!window.FullCalendar || !window.FullCalendar.Calendar) {
      console.error('❌ FullCalendar no está definido. Revisar CDN y orden de scripts.');
      calendarEl.innerHTML = `
        <div style="padding:8px; color:#b91c1c;">
          No se pudo cargar el calendario de cumpleaños (FullCalendar no disponible).
        </div>
      `;
      return;
    }

    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      initialDate: mesInicial + '-01',
      height: 'auto',

      events: eventosIniciales,

      // Cuando el usuario cambia de mes
      datesSet: async (info) => {
        // info.start es el inicio del rango de fechas de la vista
        const y = info.start.getFullYear();
        const m = String(info.start.getMonth() + 1).padStart(2, '0');
        const nuevoMes = `${y}-${m}`;

        // Evitar rellamadas innecesarias
        if (nuevoMes === currentMes) return;

        currentMes = nuevoMes;
        await loadCumples(nuevoMes, { onlyUpdateEvents: true });
      }
    });

    calendar.render();
  }

  // =============================
  // Init Section
  // =============================
  async function initCumplesSection() {
    // Tomamos la fecha local del navegador; el GMT-3 ya lo manejamos del lado del backend
    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

    await loadCumples(mes);
  }

  // Expuesto para club.js
  window.initCumplesSection = initCumplesSection;

  // Para el caso de abrir cumples.html directo
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar') &&
        document.getElementById('cumplesHoyContainer')) {
      initCumplesSection();
    }
  });

})();