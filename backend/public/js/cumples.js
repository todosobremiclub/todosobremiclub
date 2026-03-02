(() => {
  const $ = (id) => document.getElementById(id);
  let calendar = null;   // <<--- CALENDARIO GLOBAL (muy importante)

  // =============================
  // Auth
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
    if (!c) return null;
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
      throw new Error("401");
    }

    return res.json().catch(() => ({ ok:false, error:"JSON inválido" }));
  }

  // =============================
  // Carga Cumples
  // =============================
  async function loadCumples(mesYYYYMM) {
    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuthJson(`/club/${clubId}/cumples?mes=${mesYYYYMM}`);

    if (!data.ok) {
      console.error("Error:", data.error);
      return;
    }

    renderHoy(data.hoy ?? []);

    // Si el calendario todavía NO existe -> crearlo
    if (!calendar) {
      initCalendar(mesYYYYMM, data.eventos ?? []);
    } else {
      // Si YA existe -> solo actualizar eventos
      calendar.removeAllEvents();
      (data.eventos ?? []).forEach(ev => calendar.addEvent(ev));
    }
  }

  // =============================
  // Cumples HOY
  // =============================
  function renderHoy(lista) {
    const cont = $("cumplesHoyContainer");
    if (!cont) return;
    cont.innerHTML = "";

    if (!lista.length) {
      cont.innerHTML = `<div class="cumple-info">🟡 No hay cumpleaños hoy</div>`;
      return;
    }

    lista.forEach(s => {
      const foto = s.foto_url || "/img/user-placeholder.png";

      cont.innerHTML += `
        <div class="cumple-item">
          <img src="${foto}"
               onerror="this.src='/img/user-placeholder.png'"
               class="cumple-foto" />
          <div class="cumple-info">
            <span class="cumple-nombre">${s.nombre} ${s.apellido}</span>
            <span class="cumple-detalle">${s.categoria || ''} — ${s.edad} años</span>
          </div>
        </div>
      `;
    });
  }

  // =============================
  // Inicializar Calendario (SOLO UNA VEZ)
  // =============================
  function initCalendar(mesInicial, eventosIniciales) {
    const calendarEl = $("calendar");
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      initialDate: mesInicial + "-01",
      height: "auto",

      events: eventosIniciales,

      // ⬇️ CUANDO CAMBIO DE MES
      datesSet: async (info) => {
        const y = info.start.getFullYear();
        const m = String(info.start.getMonth() + 1).padStart(2, "0");
        await loadCumples(`${y}-${m}`); // <<-- SOLO carga eventos, NO reinicia el calendario
      }
    });

    calendar.render();
  }

  // =============================
  // Init section
  // =============================
  async function initCumplesSection() {
    // GMT-3
    const ahora = new Date();
    const hoy = new Date(
      ahora.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })
    );

    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2,'0')}`;

    await loadCumples(mes);
  }

  window.initCumplesSection = initCumplesSection;

  document.addEventListener("DOMContentLoaded", () => {
    if ($("calendar") && $("cumplesHoyContainer")) {
      initCumplesSection();
    }
  });

})();