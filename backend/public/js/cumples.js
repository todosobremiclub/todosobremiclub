(() => {

  const $ = id => document.getElementById(id);

  function getToken() { return null; } // cookie session

async function fetchAuth(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 401) {
    localStorage.removeItem('activeClubId');
    alert('Sesión inválida o expirada.');
    window.location.href = '/admin.html';
    throw new Error('401');
  }
  return res.json();
}


  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club seleccionado');
    }
    return c;
  }

  async function fetchAuth(url) {
    const res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + getToken()
      }
    });
    return res.json();
  }

  async function loadCumples(mesYYYYMM) {
    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuth(`/club/${clubId}/cumples?mes=${mesYYYYMM}`);

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

    lista.forEach(s => {
      const foto = s.foto_url || '/img/user-placeholder.png';

      cont.innerHTML += `
        <div class="cumple-item">
          <img src="${foto}" class="cumple-foto" alt="${s.nombre}" />
          <div class="cumple-info">
            <span class="cumple-nombre">${s.nombre} ${s.apellido}</span>
            <span class="cumple-detalle">${s.categoria} — ${s.edad} años</span>
          </div>
        </div>
      `;
    });
  }

  function renderCalendar(eventos, mes) {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    // ✅ GUARD CLAVE
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

})();