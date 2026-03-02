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
          <img src="${foto}" class="cumple-foto" alt="${(s.nombre || '')}"
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
  // Calendario FullCalendar
  // =============================
  function renderCalendar(eventos, mesInicial) {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      initialDate: mesInicial + '-01',
      events: eventos,
      height: 'auto',

      // 🚀 Cargar automáticamente el mes navegado
      datesSet: async (info) => {
        const y = info.start.getFullYear();
        const m = String(info.start.getMonth() + 1).padStart(2, '0');
        await loadCumples(`${y}-${m}`);
      }
    });

    calendar.render();
  }

  // =============================
  // Init Section
  // =============================
  async function initCumplesSection() {
    // Forzar fecha según GMT‑3
    const ahora = new Date();
    const hoy = new Date(
      ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
    );

    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

    await loadCumples(mes);
  }

  window.initCumplesSection = initCumplesSection;

  // Para el caso de abrir cumples.html directo
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar') &&
        document.getElementById('cumplesHoyContainer')) {
      initCumplesSection();
    }
  });
})();