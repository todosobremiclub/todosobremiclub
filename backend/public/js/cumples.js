(() => {

  const $ = id => document.getElementById(id);

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) { alert('Sesión expirada'); window.location='/admin.html'; }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) { alert('No hay club seleccionado'); }
    return c;
  }

  async function fetchAuth(url) {
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + getToken() }
    });
    return res.json();
  }

  async function loadCumples(mesYYYYMM) {
    const clubId = getActiveClubId();

    const data = await fetchAuth(`/club/${clubId}/cumples?mes=${mesYYYYMM}`);
    if (!data.ok) {
      console.error(data.error);
      return;
    }

    renderHoy(data.hoy);
    renderCalendar(data.eventos, mesYYYYMM);
  }

  function renderHoy(lista) {
  const cont = document.getElementById('cumplesHoyContainer');
  cont.innerHTML = '';

  if (!lista.length) {
    cont.innerHTML = `<div class="cumple-item"><div class="cumple-info">🟡 No hay cumpleaños hoy</div></div>`;
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
    const calendarEl = document.getElementById('calendar');
    calendarEl.innerHTML = '';

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
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;

    await loadCumples(mes);
  }

  window.initCumplesSection = initCumplesSection;

})();