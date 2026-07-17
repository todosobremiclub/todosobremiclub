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
  // Normalizar eventos para vista mensual
  // - Cumples: ya vienen como {date, allDay:true}
  // - Actividades: convertir a allDay para que SIEMPRE se rendericen en dayGridMonth
  //   y poner el horario en el título.
  // =============================
  function normalizeEventsForMonthView(rawEvents = []) {
    return rawEvents.map((ev) => {
      const kind = ev?.extendedProps?.kind;

      // Actividad: la convertimos a allDay con "date" (sin start/end)
      if (kind === 'actividad') {
        const fecha = ev.extendedProps?.fecha || (ev.start ? String(ev.start).slice(0, 10) : null);
        const hd = ev.extendedProps?.hora_desde || '';
        const hh = ev.extendedProps?.hora_hasta || '';
        const rango = (hd && hh) ? `${hd}-${hh}` : '';
        const titulo = ev.extendedProps?.titulo || ev.title || 'Actividad';

        return {
          // mantenemos el id
          id: ev.id,
          // IMPORTANTE: usar "date" para que month view lo trate como allDay
          date: fecha,
          allDay: true,
          // mostramos horario en el título
          title: `🟩 ${titulo}${rango ? ` (${rango})` : ''}`,
          classNames: ['evento-actividad'],
          extendedProps: ev.extendedProps || { kind: 'actividad' }
        };
      }

      // Cumple u otros: devolvemos tal cual
      return ev;
    }).filter(Boolean);
  }

  // =============================
  // Carga Agenda
  // =============================
  async function loadAgenda(mesYYYYMM, opts = {}) {
    const { onlyUpdateEvents = false } = opts;
    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuthJson(`/club/${clubId}/cumples?mes=${mesYYYYMM}`);

    if (!data.ok) {
      console.error('Error cargando agenda:', data.error);
      return;
    }

    renderHoy(data.hoy || []);

    // ✅ NORMALIZAMOS PARA MES (clave del fix)
    const eventos = normalizeEventsForMonthView(data.eventos || []);

    if (!calendar) {
  currentMes = mesYYYYMM;
  initCalendar(mesYYYYMM, eventos);
} else {
  currentMes = mesYYYYMM;
  calendar.setOption('events', eventos);
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

    lista.forEach((s) => {
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

      // Para que no “desaparezcan” cuando hay muchos
      dayMaxEvents: 2,           // fuerza "+X más"
      moreLinkClick: 'popover',
      expandRows: true,
      eventOrder: 'allDay,start,title',
      eventDisplay: 'block',

datesSet: async (info) => {

  const visibleDate = calendar.getDate();

  const nuevoMes =
    `${visibleDate.getFullYear()}-${String(visibleDate.getMonth() + 1).padStart(2, '0')}`;

  if (nuevoMes === currentMes) {
    return;
  }

  currentMes = nuevoMes;

  console.log('[agenda] cargando mes real', nuevoMes);

  await loadAgenda(nuevoMes, {
    onlyUpdateEvents: true
  });
},
      // Click en un día: alta actividad
      dateClick: (info) => {
        if (!canWrite) return;
        openActividadModal({ fecha: info.dateStr });
      },

      
      // Doble click para editar (solo actividades)
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

    // Debug accesible desde consola
    window.agendaCalendar = calendar;
    const evs = calendar.getEvents();
    console.log('[agenda] eventos totales:', evs.length);
    console.log('[agenda] actividades:', evs.filter(e => e.extendedProps?.kind === 'actividad').length);
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
