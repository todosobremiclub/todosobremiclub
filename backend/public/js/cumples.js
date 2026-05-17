(() => {
  const $ = (id) => document.getElementById(id);

  let calendar = null;
  let currentMes = null;
  let canWrite = false;

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

  async function fetchAuthJson(url, options = {}) {
    const headers = options.headers || {};
    headers.Authorization = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    try {
      return await res.json();
    } catch {
      return { ok: false, error: 'Respuesta inválida del servidor' };
    }
  }

  // =============================
  // Carga Agenda
  // =============================
  async function loadAgenda(mesYYYYMM, opts = {}) {
    const { onlyUpdateEvents = false } = opts;
    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuthJson(
      `/club/${clubId}/cumples?mes=${mesYYYYMM}`
    );

    if (!data.ok) {
      console.error('Error cargando agenda:', data.error);
      return;
    }

    renderHoy(data.hoy || []);
    const eventos = data.eventos || [];

    if (!calendar || !onlyUpdateEvents) {
      currentMes = mesYYYYMM;
      initCalendar(mesYYYYMM, eventos);
    } else {
      calendar.removeAllEvents();
      eventos.forEach(ev => calendar.addEvent(ev));
    }
  }

  // =============================
  // Cumpleaños HOY
  // =============================
  function renderHoy(lista) {
    const cont = $('cumplesHoyContainer');
    const banner = $('cumplesHoyBanner');
    if (!cont) return;

    cont.innerHTML = '';

    if (!lista.length) {
      banner?.classList.add('hidden');
      return;
    }

    banner?.classList.remove('hidden');

    lista.forEach(s => {
      const foto = s.foto_url || '/img/user-placeholder.png';
      cont.innerHTML += `
        <div class="cumple-card">
          <img src="${foto}" onerror="this.src='/img/user-placeholder.png'"/>
          <div>
            <div class="cumple-nombre">
              ${s.nombre || ''} ${s.apellido || ''}
            </div>
            <div class="cumple-categoria">
              ${s.categoria || s.actividad || ''} — ${s.edad ?? ''} años
            </div>
          </div>
        </div>
      `;
    });
  }

  // =============================
  // Calendario
  // =============================
  function initCalendar(mesInicial, eventosIniciales) {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    if (!window.FullCalendar || !window.FullCalendar.Calendar) {
      calendarEl.innerHTML =
        '<div style="color:#b91c1c;">FullCalendar no disponible</div>';
      return;
    }

    calendar = new FullCalendar.Calendar(calendarEl, {
  initialView: 'dayGridMonth',
  initialDate: mesInicial + '-01',
  height: 'auto',
  events: eventosIniciales,

  // ✅ Si hay varios eventos en el mismo día, muestra “+ más” (popover)
  dayMaxEvents: true,
  moreLinkClick: 'popover',

  // ✅ Orden: primero cumpleaños allDay, luego actividades por horario
  eventOrder: 'allDay,start,title',

  eventDisplay: 'block',
  displayEventTime: true,
  eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },

  dateClick: (info) => {
    if (!canWrite) return;
    openActividadModal({ fecha: info.dateStr });
  },

  datesSet: async (info) => {
    const y = info.start.getFullYear();
    const m = String(info.start.getMonth() + 1).padStart(2, '0');
    const nuevoMes = `${y}-${m}`;
    if (nuevoMes === currentMes) return;
    currentMes = nuevoMes;
    await loadAgenda(nuevoMes, { onlyUpdateEvents: true });
  },

  eventDidMount: (info) => {
    if (info.event.extendedProps?.kind !== 'actividad') return;

    info.el.style.cursor = canWrite ? 'pointer' : 'default';
    info.el.addEventListener('dblclick', () => {
      if (!canWrite) return;
      openActividadModal(info.event.extendedProps);
    });
  }
});

    calendar.render();
  }

  // =============================
  // Modal Actividades
  // =============================
  function openActividadModal(data = {}) {
    $('modalActividad').classList.remove('hidden');
    $('actividadId').value = data.id || '';
    $('actividadFecha').value = data.fecha || '';
    $('actividadHoraDesde').value = data.hora_desde || '18:00';
    $('actividadHoraHasta').value = data.hora_hasta || '19:00';
    $('actividadTitulo').value = data.titulo || '';
    $('actividadDescripcion').value = data.descripcion || '';
    $('btnActividadDelete').style.display = data.id ? '' : 'none';
    $('actividadModalTitle').textContent =
      data.id ? 'Editar actividad' : 'Cargar actividad';
  }

  function closeActividadModal() {
    $('modalActividad').classList.add('hidden');
  }

  async function saveActividad(e) {
    e.preventDefault();
    const clubId = getActiveClubId();

    const body = {
      fecha: $('actividadFecha').value,
      hora_desde: $('actividadHoraDesde').value,
      hora_hasta: $('actividadHoraHasta').value,
      titulo: $('actividadTitulo').value,
      descripcion: $('actividadDescripcion').value || null
    };

    const id = $('actividadId').value;
    const url = id
      ? `/club/${clubId}/agenda/actividades/${id}`
      : `/club/${clubId}/agenda/actividades`;

    const method = id ? 'PUT' : 'POST';

    const res = await fetchAuthJson(url, {
      method,
      json: true,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      alert(res.error || 'Error guardando actividad');
      return;
    }

    closeActividadModal();
    await loadAgenda(currentMes, { onlyUpdateEvents: true });
  }

  async function deleteActividad() {
    if (!confirm('¿Eliminar esta actividad?')) return;

    const clubId = getActiveClubId();
    const id = $('actividadId').value;

    const res = await fetchAuthJson(
      `/club/${clubId}/agenda/actividades/${id}`,
      { method: 'DELETE' }
    );

    if (!res.ok) {
      alert(res.error || 'Error eliminando actividad');
      return;
    }

    closeActividadModal();
    await loadAgenda(currentMes, { onlyUpdateEvents: true });
  }

  // =============================
  // Init
  // =============================
  async function initCumplesSection() {
    canWrite =
      window.__clubPerms &&
      typeof window.__clubPerms.canWrite === 'function'
        ? window.__clubPerms.canWrite('cumples')
        : false;

    $('btnActividadAdd')?.addEventListener('click', () =>
      openActividadModal({ fecha: new Date().toISOString().slice(0, 10) })
    );
    $('btnActividadClose')?.addEventListener('click', closeActividadModal);
    $('btnActividadCancel')?.addEventListener('click', closeActividadModal);
    $('btnActividadDelete')?.addEventListener('click', deleteActividad);
    $('formActividad')?.addEventListener('submit', saveActividad);

    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    await loadAgenda(mes);
  }

  window.initCumplesSection = initCumplesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if ($('calendar')) initCumplesSection();
  });
})();