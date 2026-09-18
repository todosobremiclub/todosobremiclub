(() => {
  const $ = (id) => document.getElementById(id);

  let calendar = null;
  let currentRangeKey = null;
  let canWrite = false;

  // ✅ Estado del panel "Periódico" del modal de actividad
  let recurrenteActivo = false;
  let diasSemanaSel = new Set();

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
  // Carga Agenda (por rango visible: semana o mes)
  // =============================
  async function loadAgenda(desde, hasta) {
    const clubId = getActiveClubId();
    if (!clubId) return;

    const data = await fetchAuthJson(`/club/${clubId}/cumples?desde=${desde}&hasta=${hasta}`);

    if (!data.ok) {
      console.error('Error cargando agenda:', data.error);
      return;
    }

    renderHoy(data.hoy || []);

    if (calendar) {
      calendar.setOption('events', data.eventos || []);
    }
  }

  // Recarga usando el rango actualmente visible del calendario (post guardar/eliminar)
  async function reloadVisibleRange() {
    if (!calendar) return;
    const view = calendar.view;
    const desde = view.activeStart.toISOString().slice(0, 10);
    const hasta = view.activeEnd.toISOString().slice(0, 10);
    await loadAgenda(desde, hasta);
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
  // Calendario (FullCalendar)
  // =============================
  function initCalendar() {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    if (!window.FullCalendar || !window.FullCalendar.Calendar) {
      calendarEl.innerHTML =
        '<div style="color:#b91c1c;">FullCalendar no disponible</div>';
      return;
    }

    calendar = new FullCalendar.Calendar(calendarEl, {
      locale: 'es',
      initialView: 'timeGridWeek', // ✅ por defecto: semana (Lunes a Domingo)
      firstDay: 1, // ✅ la semana arranca el Lunes
      height: 'auto',
      slotMinTime: '07:00:00',
      slotMaxTime: '23:00:00',
      slotDuration: '00:30:00',
      allDaySlot: true, // ✅ acá se muestran cumpleaños/actividades de todo el día, arriba (estilo Outlook)
      allDayText: 'Todo el día',
      nowIndicator: true,
      navLinks: true,
      dayMaxEvents: 3,
      moreLinkClick: 'popover',
      expandRows: true,
      eventOrder: 'allDay,start,title',
      eventDisplay: 'block',
      buttonText: {
        today: 'Hoy',
        month: 'Mes',
        week: 'Semana',
        day: 'Día',
      },
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek', // ✅ posibilidad de ver por mes o por semana
      },
      events: [],

      datesSet: (info) => {
        const desde = info.startStr.slice(0, 10);
        const hasta = info.endStr.slice(0, 10);
        const key = `${desde}_${hasta}`;
        if (key === currentRangeKey) return;
        currentRangeKey = key;
        loadAgenda(desde, hasta);
      },

      // Click en un día/horario: alta de actividad
      dateClick: (info) => {
        if (!canWrite) return;

        const fecha = info.dateStr.slice(0, 10);
        let horaDesde = '18:00';
        let horaHasta = '19:00';

        if (!info.allDay && info.dateStr.length > 10) {
          const t = info.dateStr.slice(11, 16);
          horaDesde = t;
          const [hh, mm] = t.split(':').map(Number);
          const finMin = hh * 60 + mm + 60;
          horaHasta = `${String(Math.floor(finMin / 60) % 24).padStart(2, '0')}:${String(
            finMin % 60
          ).padStart(2, '0')}`;
        }

        openActividadModal({ fecha, hora_desde: horaDesde, hora_hasta: horaHasta });
      },

      // Doble click para editar (solo actividades; los cumpleaños no son editables)
      eventDidMount: (info) => {
        if (info.event.extendedProps?.kind !== 'actividad') return;

        info.el.style.cursor = canWrite ? 'pointer' : 'default';
        info.el.addEventListener('dblclick', () => {
          if (!canWrite) return;
          openActividadModal(info.event.extendedProps);
        });
      },
    });

    calendar.render();

    // Debug accesible desde consola
    window.agendaCalendar = calendar;
  }

  // =============================
  // Modal Actividades
  // =============================
  function setRecurrenteUI(activo) {
    recurrenteActivo = activo;
    $('btnActividadPeriodico')?.setAttribute('aria-pressed', activo ? 'true' : 'false');
    $('recurrenciaPanel')?.classList.toggle('hidden', !activo);
  }

  function syncDiasSemanaChips() {
    document.querySelectorAll('#recDiasSemanaRow .dia-chip').forEach((btn) => {
      const dow = Number(btn.dataset.dow);
      btn.classList.toggle('active', diasSemanaSel.has(dow));
    });
  }

  function toggleRecTipoFields() {
    const tipo = $('recTipo')?.value;
    $('recDiasSemanaRow')?.classList.toggle('hidden', tipo !== 'semanal');
  }

  function openActividadModal(data = {}) {
    $('modalActividad').classList.remove('hidden');

    $('actividadId').value = data.id || '';
    $('actividadFecha').value = data.fecha || '';
    $('actividadHoraDesde').value = data.hora_desde || '18:00';
    $('actividadHoraHasta').value = data.hora_hasta || '19:00';
    $('actividadTitulo').value = data.titulo || '';
    $('actividadDescripcion').value = data.descripcion || '';

    // ✅ Si es una serie existente, editamos sobre la fecha ANCLA de la serie
    // (no la fecha de la ocurrencia puntual en la que se hizo doble click),
    // para no correr toda la recurrencia al guardar.
    if (data.id && data.fecha_base) {
      $('actividadFecha').value = data.fecha_base;
    }

    const esRecurrente = !!data.recurrente;
    setRecurrenteUI(esRecurrente);
    $('recIntervalo').value = data.recurrencia_intervalo || 1;
    $('recTipo').value = data.recurrencia_tipo || 'semanal';
    $('recHasta').value = data.recurrencia_hasta || '';

    diasSemanaSel = new Set(
      Array.isArray(data.recurrencia_dias_semana) ? data.recurrencia_dias_semana.map(Number) : []
    );
    if (!diasSemanaSel.size && $('actividadFecha').value) {
      // por defecto, marcar el día de semana de la fecha elegida
      diasSemanaSel.add(new Date(`${$('actividadFecha').value}T00:00:00`).getDay());
    }
    syncDiasSemanaChips();
    toggleRecTipoFields();

    $('btnActividadDelete').style.display = data.id ? '' : 'none';
    $('actividadModalTitle').textContent = data.id ? 'Editar actividad' : 'Cargar actividad';
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
      descripcion: $('actividadDescripcion').value || null,
      recurrente: recurrenteActivo,
    };

    if (recurrenteActivo) {
      body.recurrencia_tipo = $('recTipo').value;
      body.recurrencia_intervalo = Number($('recIntervalo').value) || 1;
      body.recurrencia_hasta = $('recHasta').value || null;

      if (body.recurrencia_tipo === 'semanal') {
        body.recurrencia_dias_semana = Array.from(diasSemanaSel);
        if (!body.recurrencia_dias_semana.length) {
          alert('Elegí al menos un día de la semana para la repetición.');
          return;
        }
      }
    }

    const id = $('actividadId').value;
    const url = id
      ? `/club/${clubId}/agenda/actividades/${id}`
      : `/club/${clubId}/agenda/actividades`;

    const method = id ? 'PUT' : 'POST';

    const res = await fetchAuthJson(url, {
      method,
      json: true,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      alert(res.error || 'Error guardando actividad');
      return;
    }

    closeActividadModal();
    await reloadVisibleRange();
  }

  async function deleteActividad() {
    const esRecurrente = recurrenteActivo;
    const confirmMsg = esRecurrente
      ? '¿Eliminar esta actividad y TODAS sus repeticiones?'
      : '¿Eliminar esta actividad?';
    if (!confirm(confirmMsg)) return;

    const clubId = getActiveClubId();
    const id = $('actividadId').value;

    const res = await fetchAuthJson(`/club/${clubId}/agenda/actividades/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      alert(res.error || 'Error eliminando actividad');
      return;
    }

    closeActividadModal();
    await reloadVisibleRange();
  }

  // =============================
  // Init
  // =============================
  async function initCumplesSection() {
    canWrite =
      window.__clubPerms && typeof window.__clubPerms.canWrite === 'function'
        ? window.__clubPerms.canWrite('cumples')
        : false;

    $('btnActividadAdd')?.addEventListener('click', () =>
      openActividadModal({ fecha: new Date().toISOString().slice(0, 10) })
    );
    $('btnActividadClose')?.addEventListener('click', closeActividadModal);
    $('btnActividadCancel')?.addEventListener('click', closeActividadModal);
    $('btnActividadDelete')?.addEventListener('click', deleteActividad);
    $('formActividad')?.addEventListener('submit', saveActividad);

    // ✅ Panel "Periódico" (recurrencia), estilo Outlook
    $('btnActividadPeriodico')?.addEventListener('click', () => setRecurrenteUI(!recurrenteActivo));
    $('recTipo')?.addEventListener('change', toggleRecTipoFields);
    $('recDiasSemanaRow')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.dia-chip');
      if (!btn) return;
      const dow = Number(btn.dataset.dow);
      if (diasSemanaSel.has(dow)) diasSemanaSel.delete(dow);
      else diasSemanaSel.add(dow);
      syncDiasSemanaChips();
    });

    initCalendar(); // la primera carga de datos la dispara "datesSet" con el rango inicial (semana actual)
  }

  window.initCumplesSection = initCumplesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if ($('calendar')) initCumplesSection();
  });
})();
