(() => {
  const $ = (id) => document.getElementById(id);

  let calendar = null;
  let currentRangeKey = null;
  let canWrite = false;

  // ✅ Estado del panel de recurrencia del modal
  let recurrenteActivo = false;
  let diasSemanaSel = new Set();

  const DIAS_LARGOS = [
    'domingo',
    'lunes',
    'martes',
    'miércoles',
    'jueves',
    'viernes',
    'sábado',
  ];

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

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // =============================
  // Helpers de fecha
  // =============================
  function fechaLarga(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
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

  // Recarga usando el rango actualmente visible (post guardar/eliminar)
  async function reloadVisibleRange() {
    if (!calendar) return;
    const view = calendar.view;
    const desde = view.activeStart.toISOString().slice(0, 10);
    const hasta = view.activeEnd.toISOString().slice(0, 10);
    await loadAgenda(desde, hasta);
  }

  // =============================
  // Cumpleaños de HOY
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

    cont.innerHTML = lista
      .map((s) => {
        const foto = s.foto_url || '/img/user-placeholder.png';
        const nombre = `${s.nombre || ''} ${s.apellido || ''}`.trim();
        const meta = [s.categoria || s.actividad || '', s.edad != null ? `${s.edad} años` : '']
          .filter(Boolean)
          .join(' · ');

        return `
          <div class="ag-cumple-chip">
            <img src="${escapeHtml(foto)}" onerror="this.src='/img/user-placeholder.png'" alt="" />
            <div>
              <div class="ag-cumple-nombre">${escapeHtml(nombre)}</div>
              <div class="ag-cumple-meta">${escapeHtml(meta)}</div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // =============================
  // Calendario (FullCalendar)
  // =============================
  function initCalendar() {
    const calendarEl = $('calendar');
    if (!calendarEl) return;

    calendarEl.innerHTML = '';

    if (!window.FullCalendar || !window.FullCalendar.Calendar) {
      calendarEl.innerHTML = '<div style="color:#b91c1c;">FullCalendar no disponible</div>';
      return;
    }

    calendar = new FullCalendar.Calendar(calendarEl, {
      locale: 'es',
      initialView: 'timeGridWeek', // ✅ por defecto: semana (Lunes a Domingo)
      firstDay: 1, // ✅ la semana arranca el Lunes
      height: 'auto',
      slotMinTime: '07:00:00',
      slotMaxTime: '23:00:00',
      slotDuration: '01:00:00', // ✅ una fila por hora: entran todos los horarios sin scroll
      snapDuration: '00:30:00', // ...pero al hacer click sigue tomando media hora
      scrollTime: '07:00:00',
      dayHeaderFormat: { weekday: 'short', day: 'numeric' },
      allDaySlot: true, // ✅ cumpleaños arriba, como en Outlook
      allDayText: 'Todo el día',
      nowIndicator: true,
      navLinks: true,
      dayMaxEvents: 3,
      moreLinkClick: 'popover',
      moreLinkText: (n) => `+${n} más`,
      expandRows: true,
      eventOrder: 'allDay,start,title',
      eventDisplay: 'block',
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      buttonText: {
        today: 'Hoy',
        month: 'Mes',
        week: 'Semana',
        day: 'Día',
      },
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek', // ✅ alternar entre mes y semana
      },
      events: [],

      // ✅ Encabezado de días custom (estilo calendario moderno)
      dayHeaderContent: (arg) => {
        const dow = arg.date
          .toLocaleDateString('es-AR', { weekday: 'short' })
          .replace('.', '');
        const dowCap = dow.charAt(0).toUpperCase() + dow.slice(1);

        if (arg.view.type === 'dayGridMonth') {
          return { html: `<span class="ag-dh-dow">${dowCap}</span>` };
        }

        return {
          html: `
            <div class="ag-dh${arg.isToday ? ' is-today' : ''}">
              <span class="ag-dh-dow">${dowCap}</span>
              <span class="ag-dh-num">${arg.date.getDate()}</span>
            </div>
          `,
        };
      },

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

      // Doble click para editar (solo actividades)
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
    window.agendaCalendar = calendar;
  }

  // =============================
  // Modal Actividades
  // =============================
  function setRecurrenteUI(activo) {
    recurrenteActivo = activo;
    const chk = $('chkPeriodico');
    if (chk) chk.checked = activo;
    $('recurrenciaPanel')?.classList.toggle('hidden', !activo);
    updateResumenRecurrencia();
  }

  function syncDiasSemanaChips() {
    document.querySelectorAll('#recDiasSemanaRow .ag-dia').forEach((btn) => {
      const dow = Number(btn.dataset.dow);
      btn.classList.toggle('active', diasSemanaSel.has(dow));
    });
  }

  function toggleRecTipoFields() {
    const tipo = $('recTipo')?.value;
    $('recDiasSemanaRow')?.classList.toggle('hidden', tipo !== 'semanal');
    updateResumenRecurrencia();
  }

  // ✅ Resumen en vivo, estilo Outlook:
  // "Todos los lunes y miércoles, de 20:00 a 20:30. Desde el 14 de septiembre de 2026 hasta el 8 de marzo de 2027."
  function updateResumenRecurrencia() {
    const el = $('agResumenTexto');
    if (!el) return;

    const fecha = $('actividadFecha')?.value || '';
    const hd = $('actividadHoraDesde')?.value || '';
    const hh = $('actividadHoraHasta')?.value || '';

    if (!fecha || !hd || !hh) {
      el.textContent = 'Elegí la fecha y el horario arriba.';
      return;
    }

    const horario = `de ${hd} a ${hh}`;
    const base = new Date(`${fecha}T00:00:00`);

    if (!recurrenteActivo) {
      el.textContent = `Una sola vez: ${DIAS_LARGOS[base.getDay()]} ${fechaLarga(fecha)}, ${horario}.`;
      return;
    }

    const tipo = $('recTipo')?.value || 'semanal';
    const n = Math.max(1, Number($('recIntervalo')?.value) || 1);
    const hasta = $('recHasta')?.value || '';

    let frase = '';

    if (tipo === 'diario') {
      frase = n === 1 ? 'Todos los días' : `Cada ${n} días`;
    } else if (tipo === 'semanal') {
      const ordenados = Array.from(diasSemanaSel).sort(
        (a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)
      );
      const nombres = (ordenados.length ? ordenados : [base.getDay()]).map((d) => DIAS_LARGOS[d]);
      const lista =
        nombres.length > 1
          ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
          : nombres[0];
      frase = n === 1 ? `Todos los ${lista}` : `Cada ${n} semanas, los ${lista}`;
    } else if (tipo === 'mensual') {
      frase =
        n === 1
          ? `El día ${base.getDate()} de cada mes`
          : `El día ${base.getDate()}, cada ${n} meses`;
    } else {
      const dm = base.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
      frase = n === 1 ? `Cada año el ${dm}` : `Cada ${n} años el ${dm}`;
    }

    let txt = `${frase}, ${horario}. Desde el ${fechaLarga(fecha)}`;
    txt += hasta ? ` hasta el ${fechaLarga(hasta)}.` : ', sin fecha de finalización.';
    el.textContent = txt;
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
    // (no la ocurrencia puntual clickeada), para no correr toda la recurrencia.
    if (data.id && data.fecha_base) {
      $('actividadFecha').value = data.fecha_base;
    }

    $('recIntervalo').value = data.recurrencia_intervalo || 1;
    $('recTipo').value = data.recurrencia_tipo || 'semanal';
    $('recHasta').value = data.recurrencia_hasta || '';

    diasSemanaSel = new Set(
      Array.isArray(data.recurrencia_dias_semana) ? data.recurrencia_dias_semana.map(Number) : []
    );
    if (!diasSemanaSel.size && $('actividadFecha').value) {
      // por defecto, el día de semana de la fecha elegida
      diasSemanaSel.add(new Date(`${$('actividadFecha').value}T00:00:00`).getDay());
    }
    syncDiasSemanaChips();

    setRecurrenteUI(!!data.recurrente);
    toggleRecTipoFields();

    $('btnActividadDelete').style.display = data.id ? '' : 'none';
    $('actividadModalTitle').textContent = data.id ? 'Editar actividad' : 'Nueva actividad';
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

    const btn = $('btnActividadSave');
    if (btn) btn.disabled = true;

    try {
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
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteActividad() {
    const confirmMsg = recurrenteActivo
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

    // ✅ Recurrencia
    $('chkPeriodico')?.addEventListener('change', (ev) => setRecurrenteUI(ev.target.checked));
    $('recTipo')?.addEventListener('change', toggleRecTipoFields);
    $('recDiasSemanaRow')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.ag-dia');
      if (!btn) return;
      const dow = Number(btn.dataset.dow);
      if (diasSemanaSel.has(dow)) diasSemanaSel.delete(dow);
      else diasSemanaSel.add(dow);
      syncDiasSemanaChips();
      updateResumenRecurrencia();
    });

    // ✅ Resumen en vivo
    ['actividadFecha', 'actividadHoraDesde', 'actividadHoraHasta', 'recIntervalo', 'recHasta'].forEach(
      (id) => {
        $(id)?.addEventListener('input', updateResumenRecurrencia);
        $(id)?.addEventListener('change', updateResumenRecurrencia);
      }
    );

    // Cerrar modal con click en el fondo o con Escape
    $('modalActividad')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modalActividad') closeActividadModal();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !$('modalActividad')?.classList.contains('hidden')) {
        closeActividadModal();
      }
    });

    initCalendar(); // la primera carga la dispara "datesSet" con el rango inicial (semana actual)
  }

  window.initCumplesSection = initCumplesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if ($('calendar')) initCumplesSection();
  });
})();
