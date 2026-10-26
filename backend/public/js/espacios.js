// public/js/espacios.js
//
// Panel admin: módulo "Recursos" (canchas, salones y espacios: reservas y abonos).
// (Las clases / entrenamientos se gestionan desde la Agenda.)
// Por ahora: pestaña "Recursos" (alta/edición/baja de canchas, salones y
// espacios + editor de disponibilidad + vista previa de turnos).
// Pestañas: Calendario / Reservas / Abonos / Recursos
// (ver claude/espacios-y-clases-plan.md).
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // =============================
  // Auth / helpers comunes (mismo patrón que tienda.js)
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
      alert('No hay club activo seleccionado.');
      window.location.href = '/club.html';
      throw new Error('No activeClubId');
    }
    return c;
  }
  async function fetchAuth(url, options = {}) {
    const headers = options.headers ?? {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const { json, ...rest } = options;
    const res = await fetch(url, { ...rest, headers });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text }; }
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }
    return { res, data };
  }
  function esc(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function canWrite() {
    const p = window.__clubPerms;
    return !p || p.canWrite('espacios');
  }

  const TIPOS = { cancha: 'Cancha', salon: 'Salón', espacio: 'Espacio', otro: 'Otro' };
  // Imagen por defecto de un recurso sin foto: genérica (sirve para cancha de fútbol, pádel, salón, etc.)
  const TIPO_ICON = { cancha: '🏟️', salon: '🏟️', espacio: '🏟️', otro: '🏟️' };
  const DIAS_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const MAX_IMG = 3 * 1024 * 1024;

  function fmtDMY(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  function fmtDMcorto(iso) {
    const [, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}`;
  }
  function diaSemanaDeIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  function fmtDuracion(min) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  // =============================
  // Estado
  // =============================
  let recursos = [];
  let editId = null;          // null = nuevo
  let imagenBase64 = null;    // nueva imagen elegida
  let imagenMime = null;
  let quitarImagen = false;
  let imagenActualUrl = null;
  let reglaModo = 'disponible';
  let reglaTipo = 'semanal';

  function base() { return `/club/${getActiveClubId()}/espacios`; }

  // =============================
  // Listado de recursos
  // =============================
  async function cargarRecursos() {
    const cont = $('#espRecursosLista');
    try {
      const { res, data } = await fetchAuth(`${base()}/recursos`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los recursos');
      recursos = data.recursos || [];
      renderRecursos();
    } catch (e) {
      cont.innerHTML = `<div class="esp-msg">${esc(e.message)}</div>`;
    }
  }

  function renderRecursos() {
    poblarSelectsRecurso();
    const cont = $('#espRecursosLista');
    const activos = recursos.filter((r) => r.activo).length;
    const inactivos = recursos.length - activos;
    const verInactivos = !!($('#espVerInactivos') && $('#espVerInactivos').checked);
    $('#espRecursosResumen').textContent = recursos.length
      ? `${activos} recurso${activos === 1 ? '' : 's'} activo${activos === 1 ? '' : 's'}` +
        (inactivos ? ` · ${inactivos} inactivo${inactivos === 1 ? '' : 's'}${verInactivos ? '' : ' (ocultos)'}` : '')
      : '';

    if (!recursos.length) {
      cont.innerHTML = `<div class="muted">Todavía no cargaste ningún recurso. Tocá "➕ Nuevo recurso" para empezar (por ejemplo, una cancha o un salón).</div>`;
      return;
    }
    // Los recursos inactivos no se muestran salvo que se tilde "Ver recursos inactivos"
    const visibles = recursos.filter((r) => r.activo || verInactivos);
    if (!visibles.length) {
      cont.innerHTML = `<div class="muted">No hay recursos activos. Tildá "Ver recursos inactivos" para verlos o creá uno nuevo.</div>`;
      return;
    }

    const w = canWrite();
    cont.innerHTML = visibles.map((r) => {
      const img = r.imagen_url
        ? `<img src="${esc(r.imagen_url)}" alt="" />`
        : (TIPO_ICON[r.tipo] || '📍');
      const badges = [];
      badges.push(`<span class="esp-badge">⏱️ Turnos de ${fmtDuracion(r.duracion_turno_min)}</span>`);
      if (!r.activo) badges.push(`<span class="esp-badge esp-badge--off">Inactivo</span>`);
      if (r.activo && !r.reglas_disponibilidad) badges.push(`<span class="esp-badge esp-badge--warn">⚠️ Sin horarios cargados</span>`);
      if (!r.reservable_app) badges.push(`<span class="esp-badge">Solo carga el club</span>`);
      if (r.reservas_pendientes) badges.push(`<span class="esp-badge esp-badge--warn">${r.reservas_pendientes} pendiente${r.reservas_pendientes === 1 ? '' : 's'}</span>`);
      if (r.abonos_activos) badges.push(`<span class="esp-badge">${r.abonos_activos} abono${r.abonos_activos === 1 ? '' : 's'}</span>`);
      return `
        <div class="esp-rcard ${r.activo ? '' : 'esp-rcard--off'}">
          <div class="esp-rimg">${img}</div>
          <div class="esp-rbody">
            <p class="esp-rname">${esc(r.nombre)}</p>
            <div class="esp-rmeta">${esc(TIPOS[r.tipo] || r.tipo)}${r.capacidad ? ` · hasta ${r.capacidad} personas` : ''}</div>
            ${r.descripcion ? `<div class="esp-rmeta">${esc(r.descripcion)}</div>` : ''}
            <div class="esp-badges">${badges.join('')}</div>
          </div>
          <div class="esp-rfoot">
            <button type="button" class="btn btn-secondary" data-esp-editar="${esc(r.id)}">${w ? '✏️ Editar / horarios' : '👁️ Ver'}</button>
          </div>
        </div>`;
    }).join('');

    $$('[data-esp-editar]').forEach((b) => {
      b.addEventListener('click', () => abrirModal(b.getAttribute('data-esp-editar')));
    });
  }

  // =============================
  // Modal de recurso
  // =============================
  function showMsg(sel, text, ok = false) {
    const el = $(sel);
    if (!el) return;
    if (!text) { el.style.display = 'none'; return; }
    el.textContent = text;
    el.className = 'esp-msg' + (ok ? ' esp-msg--ok' : '');
    el.style.display = '';
  }

  function setImagenUI() {
    const thumb = $('#espImagenThumb');
    const quitar = $('#btnEspImagenQuitar');
    let src = null;
    if (imagenBase64) src = `data:${imagenMime};base64,${imagenBase64}`;
    else if (imagenActualUrl && !quitarImagen) src = imagenActualUrl;
    if (src) { thumb.src = src; thumb.style.display = ''; quitar.style.display = canWrite() ? '' : 'none'; }
    else { thumb.removeAttribute('src'); thumb.style.display = 'none'; quitar.style.display = 'none'; }
  }

  function abrirModal(id) {
    editId = id || null;
    imagenBase64 = null; imagenMime = null; quitarImagen = false;
    const r = id ? recursos.find((x) => x.id === id) : null;
    imagenActualUrl = r?.imagen_url || null;

    $('#espRecursoTitulo').textContent = r ? r.nombre : 'Nuevo recurso';
    $('#espNombre').value = r?.nombre || '';
    $('#espTipo').value = r?.tipo || 'cancha';
    $('#espCapacidad').value = r?.capacidad ?? '';
    $('#espDescripcion').value = r?.descripcion || '';
    $('#espDuracion').value = r?.duracion_turno_min ?? 60;
    $('#espAntMin').value = r?.anticipacion_min_horas ?? 0;
    $('#espAntMax').value = r?.anticipacion_max_dias ?? 30;
    $('#espCancelar').value = r?.cancelar_hasta_horas ?? 12;
    $('#espReservableApp').checked = r ? r.reservable_app !== false : true;
    $('#espActivo').checked = r ? r.activo !== false : true;
    $('#espActivoWrap').style.display = r ? '' : 'none';
    $('#espImagen').value = '';
    setImagenUI();
    showMsg('#espRecursoMsg', '');

    const w = canWrite();
    $('#btnEspRecursoGuardar').style.display = w ? '' : 'none';
    $('#btnEspRecursoEliminar').style.display = (w && r) ? '' : 'none';
    $('#espImagen').disabled = !w;
    ['#espNombre', '#espTipo', '#espCapacidad', '#espDescripcion', '#espDuracion', '#espAntMin',
      '#espAntMax', '#espCancelar', '#espReservableApp', '#espActivo'].forEach((s) => { $(s).disabled = !w; });

    cerrarReglaForm();
    $('#espTurnosBox').style.display = 'none';
    $('#espDispNuevo').style.display = r ? 'none' : '';
    $('#espDispEditor').style.display = r ? '' : 'none';
    $('#btnEspReglaAgregar').style.display = w ? '' : 'none';
    $('#espReglasLista').innerHTML = '';
    if (r) cargarReglas();

    $('#espRecursoOverlay').style.display = 'flex';
  }

  function cerrarModal() {
    $('#espRecursoOverlay').style.display = 'none';
    editId = null;
  }

  function leerFormRecurso() {
    const num = (s) => { const v = $(s).value.trim(); return v === '' ? null : Number(v); };
    const body = {
      nombre: $('#espNombre').value.trim(),
      tipo: $('#espTipo').value,
      capacidad: num('#espCapacidad'),
      descripcion: $('#espDescripcion').value.trim(),
      duracion_turno_min: num('#espDuracion'),
      anticipacion_min_horas: num('#espAntMin'),
      anticipacion_max_dias: num('#espAntMax'),
      cancelar_hasta_horas: num('#espCancelar'),
      reservable_app: $('#espReservableApp').checked
    };
    if (editId) body.activo = $('#espActivo').checked;
    if (imagenBase64) { body.imagen_base64 = imagenBase64; body.imagen_mimetype = imagenMime; }
    else if (editId && quitarImagen) body.quitar_imagen = true;
    return body;
  }

  async function guardarRecurso() {
    const btn = $('#btnEspRecursoGuardar');
    showMsg('#espRecursoMsg', '');
    const body = leerFormRecurso();
    if (!body.nombre) return showMsg('#espRecursoMsg', 'Ingresá el nombre del recurso.');
    if (!body.duracion_turno_min || body.duracion_turno_min < 15 || body.duracion_turno_min > 720) {
      return showMsg('#espRecursoMsg', 'La duración del turno debe estar entre 15 y 720 minutos.');
    }
    btn.disabled = true;
    try {
      const url = editId ? `${base()}/recursos/${editId}` : `${base()}/recursos`;
      const { res, data } = await fetchAuth(url, { method: editId ? 'PUT' : 'POST', json: true, body: JSON.stringify(body) });
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar');
      const nuevo = !editId;
      editId = data.recurso.id;
      await cargarRecursos();
      // Reabrimos en modo edición para que (si es nuevo) ya pueda cargar horarios
      abrirModal(editId);
      let msg = nuevo ? '✅ Recurso creado. Ahora cargá sus horarios disponibles más abajo.' : '✅ Cambios guardados.';
      if (Array.isArray(data.avisos) && data.avisos.length) msg += ' ' + data.avisos.join(' ');
      showMsg('#espRecursoMsg', msg, true);
    } catch (e) {
      showMsg('#espRecursoMsg', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function eliminarRecurso() {
    if (!editId) return;
    const r = recursos.find((x) => x.id === editId);
    if (!confirm(`¿Eliminar "${r?.nombre || 'el recurso'}"?\n\nSi tiene reservas o abonos históricos, se desactiva en lugar de borrarse.`)) return;
    try {
      const { res, data } = await fetchAuth(`${base()}/recursos/${editId}`, { method: 'DELETE' });
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo eliminar');
      if (data.desactivado) {
        let extra = '';
        if (data.reservas_futuras) extra += `\nTiene ${data.reservas_futuras} reserva(s) futura(s) que siguen vigentes.`;
        if (data.abonos_activos) extra += `\nTiene ${data.abonos_activos} abono(s) activo(s).`;
        alert((data.motivo || 'El recurso se desactivó.') + extra);
      }
      cerrarModal();
      await cargarRecursos();
    } catch (e) {
      showMsg('#espRecursoMsg', e.message);
    }
  }

  function onImagenElegida(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      showMsg('#espRecursoMsg', 'La foto debe ser JPG, PNG o WEBP.');
      ev.target.value = '';
      return;
    }
    if (f.size > MAX_IMG) {
      showMsg('#espRecursoMsg', 'La foto supera los 3MB.');
      ev.target.value = '';
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      imagenBase64 = s.slice(s.indexOf(',') + 1);
      imagenMime = f.type;
      quitarImagen = false;
      showMsg('#espRecursoMsg', '');
      setImagenUI();
    };
    fr.readAsDataURL(f);
  }

  // =============================
  // Disponibilidad
  // =============================
  function textoRegla(g) {
    const horas = g.hora_desde && g.hora_hasta ? `${g.hora_desde}–${g.hora_hasta}` : 'todo el día';
    let cuando;
    if (g.tipo === 'semanal') {
      cuando = DIAS_CORTO[g.dia_semana];
      if (g.vigente_desde || g.vigente_hasta) {
        const a = g.vigente_desde ? `desde ${fmtDMY(g.vigente_desde)}` : '';
        const b = g.vigente_hasta ? `hasta ${fmtDMY(g.vigente_hasta)}` : '';
        cuando += ` (${[a, b].filter(Boolean).join(' ')})`;
      }
    } else {
      cuando = `${DIAS_CORTO[diaSemanaDeIso(g.fecha)]} ${fmtDMY(g.fecha)}`;
    }
    if (g.modo === 'bloqueado') {
      return `🚫 ${cuando} · ${horas}${g.motivo ? ` · ${g.motivo}` : ''}`;
    }
    return `${cuando} · ${horas}`;
  }

  async function cargarReglas() {
    const cont = $('#espReglasLista');
    cont.innerHTML = '<div class="muted">Cargando…</div>';
    try {
      const { res, data } = await fetchAuth(`${base()}/recursos/${editId}/disponibilidad`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar la disponibilidad');
      renderReglas(data.reglas || []);
    } catch (e) {
      cont.innerHTML = `<div class="esp-msg">${esc(e.message)}</div>`;
    }
  }

  function renderReglas(reglas) {
    const cont = $('#espReglasLista');
    if (!reglas.length) {
      cont.innerHTML = `<div class="muted">Todavía no hay horarios. Sin horarios, los socios no verán turnos para reservar.</div>`;
      return;
    }
    const w = canWrite();
    const grupos = [
      ['Horarios que se repiten', reglas.filter((g) => g.modo === 'disponible' && g.tipo === 'semanal')],
      ['Días específicos', reglas.filter((g) => g.modo === 'disponible' && g.tipo === 'fecha')],
      ['Bloqueos', reglas.filter((g) => g.modo === 'bloqueado')]
    ];
    cont.innerHTML = grupos.filter(([, l]) => l.length).map(([titulo, lista]) => `
      <div class="esp-reglas-grupo">${titulo}</div>
      ${lista.map((g) => `
        <div class="esp-regla ${g.modo === 'bloqueado' ? 'esp-regla--bloq' : ''}">
          <span>${esc(textoRegla(g))}</span>
          ${w ? `<button type="button" title="Quitar" data-esp-regla-del="${esc(g.id)}">🗑️</button>` : ''}
        </div>`).join('')}
    `).join('');

    $$('[data-esp-regla-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('¿Quitar este horario?')) return;
        try {
          const { res, data } = await fetchAuth(`${base()}/disponibilidad/${b.getAttribute('data-esp-regla-del')}`, { method: 'DELETE' });
          if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo quitar');
          await cargarReglas();
          await cargarRecursos();
        } catch (e) { alert(e.message); }
      });
    });
  }

  function cerrarReglaForm() {
    $('#espReglaForm').style.display = 'none';
    showMsg('#espReglaMsg', '');
  }

  function aplicarModoTipoUI() {
    $$('#espReglaModo .esp-seg').forEach((b) => b.classList.toggle('esp-seg--on', b.dataset.modo === reglaModo));
    $$('#espReglaTipo .esp-seg').forEach((b) => b.classList.toggle('esp-seg--on', b.dataset.tipo === reglaTipo));
    $('#espReglaSemanal').style.display = reglaTipo === 'semanal' ? '' : 'none';
    $('#espReglaFechaWrap').style.display = reglaTipo === 'fecha' ? '' : 'none';
    const bloq = reglaModo === 'bloqueado';
    $('#espReglaBloqueoTodo').style.display = bloq ? '' : 'none';
    $('#espReglaMotivoWrap').style.display = bloq ? '' : 'none';
    $('#espReglaHoras').style.display = (!bloq || !$('#espReglaTodoDia').checked) ? '' : 'none';
  }

  function abrirReglaForm() {
    reglaModo = 'disponible'; reglaTipo = 'semanal';
    $$('#espReglaDias button').forEach((b) => b.classList.remove('on'));
    $('#espReglaVigDesde').value = '';
    $('#espReglaVigHasta').value = '';
    $('#espReglaFecha').value = '';
    $('#espReglaTodoDia').checked = true;
    $('#espReglaDesde').value = '18:00';
    $('#espReglaHasta').value = '23:00';
    $('#espReglaMotivo').value = '';
    showMsg('#espReglaMsg', '');
    aplicarModoTipoUI();
    $('#espReglaForm').style.display = '';
  }

  async function guardarRegla() {
    showMsg('#espReglaMsg', '');
    const bloq = reglaModo === 'bloqueado';
    const todoDia = bloq && $('#espReglaTodoDia').checked;
    const desde = $('#espReglaDesde').value;
    const hasta = $('#espReglaHasta').value;
    if (!todoDia) {
      if (!desde || !hasta) return showMsg('#espReglaMsg', 'Indicá el horario desde y hasta.');
      if (desde >= hasta) return showMsg('#espReglaMsg', 'La hora de inicio debe ser anterior a la de fin.');
    }
    const base0 = {
      modo: reglaModo,
      tipo: reglaTipo,
      hora_desde: todoDia ? null : desde,
      hora_hasta: todoDia ? null : hasta,
      motivo: bloq ? $('#espReglaMotivo').value.trim() : ''
    };
    let reglas = [];
    if (reglaTipo === 'semanal') {
      const dias = $$('#espReglaDias button.on').map((b) => Number(b.dataset.dia));
      if (!dias.length) return showMsg('#espReglaMsg', 'Elegí al menos un día de la semana.');
      const vd = $('#espReglaVigDesde').value, vh = $('#espReglaVigHasta').value;
      if (vd && vh && vh < vd) return showMsg('#espReglaMsg', 'La vigencia "hasta" no puede ser anterior a "desde".');
      reglas = dias.map((d) => ({ ...base0, dia_semana: d, vigente_desde: vd || null, vigente_hasta: vh || null }));
    } else {
      const f = $('#espReglaFecha').value;
      if (!f) return showMsg('#espReglaMsg', 'Elegí la fecha.');
      reglas = [{ ...base0, fecha: f }];
    }
    const btn = $('#btnEspReglaGuardar');
    btn.disabled = true;
    try {
      const { res, data } = await fetchAuth(`${base()}/recursos/${editId}/disponibilidad`, {
        method: 'POST', json: true, body: JSON.stringify({ reglas })
      });
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar');
      cerrarReglaForm();
      await cargarReglas();
      await cargarRecursos();
      if (data.duplicadas) {
        showMsg('#espRecursoMsg', `Se omitieron ${data.duplicadas} horario(s) que ya estaban cargados.`, true);
      }
    } catch (e) {
      showMsg('#espReglaMsg', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // =============================
  // Turnos de ejemplo (lo que vería el socio)
  // =============================
  async function verTurnos() {
    const box = $('#espTurnosBox');
    const cont = $('#espTurnosCont');
    box.style.display = '';
    cont.innerHTML = '<div class="muted">Calculando…</div>';
    try {
      const { res, data } = await fetchAuth(`${base()}/recursos/${editId}/turnos?vista=socio`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron calcular los turnos');
      const dias = data.dias || [];
      if (!dias.length) { cont.innerHTML = '<div class="esp-tnone">No hay turnos en los próximos días.</div>'; return; }
      cont.innerHTML = dias.map((d) => {
        const dow = DIAS_LARGO[diaSemanaDeIso(d.fecha)];
        const chips = (d.turnos || []).length
          ? `<div class="esp-tchips">${d.turnos.map((t) => `<span class="esp-tchip">${esc(t.hora_desde)}–${esc(t.hora_hasta)}</span>`).join('')}</div>`
          : `<div class="esp-tnone">Sin turnos disponibles</div>`;
        return `<div class="esp-tdia"><div class="esp-tdia-fecha">${dow} ${fmtDMcorto(d.fecha)}</div>${chips}</div>`;
      }).join('');
    } catch (e) {
      cont.innerHTML = `<div class="esp-msg">${esc(e.message)}</div>`;
    }
  }

  // =====================================================================
  // PASO 9: Calendario / Reservas / Abonos
  // =====================================================================
  const TZ = 'America/Argentina/Buenos_Aires';
  function ahoraAR() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t).value;
    const h = Number(g('hour')) % 24;
    return { fecha: `${g('year')}-${g('month')}-${g('day')}`, min: h * 60 + Number(g('minute')) };
  }
  function addDaysISO(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  function turnoYaPaso(fecha, horaHasta) {
    const a = ahoraAR();
    if (fecha < a.fecha) return true;
    if (fecha > a.fecha) return false;
    return toMin(horaHasta) <= a.min;
  }
  function fmtFechaLarga(iso) {
    return `${DIAS_CORTO[diaSemanaDeIso(iso)]} ${fmtDMY(iso)}`;
  }
  function showMsgHtml(sel, html) {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = html;
    el.className = 'esp-msg';
    el.style.display = '';
  }
  function abrirOverlay(id) { $('#' + id).style.display = 'flex'; }
  function cerrarOverlay(id) { $('#' + id).style.display = 'none'; }
  function recursosActivos() { return recursos.filter((r) => r.activo); }
  function opcionesRecurso(conTodos) {
    return (conTodos ? '<option value="">Todos</option>' : '') +
      recursosActivos().map((r) => `<option value="${esc(r.id)}">${esc(r.nombre)}</option>`).join('');
  }
  function poblarSelectsRecurso() {
    const cfg = [['#espCalRecurso', false], ['#espResFiltroRecurso', true], ['#espAboFiltroRecurso', true],
      ['#espResNRecurso', false], ['#espAboNRecurso', false]];
    cfg.forEach(([sel, todos]) => {
      const el = $(sel);
      if (!el) return;
      const prev = el.value;
      el.innerHTML = opcionesRecurso(todos);
      if (prev && Array.from(el.options).some((o) => o.value === prev)) el.value = prev;
    });
  }

  // ---------- Selector de titular (socio o no socio) ----------
  function titularHtml(p) {
    return `
      <label class="esp-check" style="margin-top:12px;"><input type="checkbox" id="${p}NoSocio" /> No es socio</label>
      <div id="${p}SocioWrap">
        <label>Socio</label>
        <div class="esp-buscador">
          <input type="text" id="${p}Busqueda" placeholder="Buscá por nombre, apellido, DNI o N° de socio" autocomplete="off" />
          <div id="${p}Resultados" class="esp-resultados" style="display:none;"></div>
        </div>
        <div id="${p}Sel" class="esp-sel" style="display:none;"></div>
      </div>
      <div id="${p}ExtWrap" style="display:none;">
        <div class="esp-row2">
          <div><label>Nombre y apellido</label><input type="text" id="${p}Nombre" maxlength="120" /></div>
          <div><label>Contacto (opcional)</label><input type="text" id="${p}Contacto" maxlength="120" placeholder="Teléfono" /></div>
        </div>
      </div>`;
  }
  function titularInit(p, contenedorSel) {
    $(contenedorSel).innerHTML = titularHtml(p);
    let socio = null, timer = null;
    const ui = {
      noSocio: $(`#${p}NoSocio`), socioWrap: $(`#${p}SocioWrap`), extWrap: $(`#${p}ExtWrap`),
      busqueda: $(`#${p}Busqueda`), resultados: $(`#${p}Resultados`), sel: $(`#${p}Sel`),
      nombre: $(`#${p}Nombre`), contacto: $(`#${p}Contacto`)
    };
    function elegir(s) {
      socio = s;
      ui.resultados.style.display = 'none'; ui.resultados.innerHTML = '';
      ui.busqueda.value = '';
      ui.sel.textContent = `#${s.numero_socio ?? '—'} ${s.apellido ?? ''} ${s.nombre ?? ''}`.trim();
      ui.sel.style.display = '';
    }
    async function buscar(q) {
      if (!q || q.trim().length < 2) { ui.resultados.style.display = 'none'; ui.resultados.innerHTML = ''; return; }
      const { res, data } = await fetchAuth(`/club/${getActiveClubId()}/socios?search=${encodeURIComponent(q.trim())}&limit=8`);
      const items = (res.ok && data.ok) ? (data.socios || []) : [];
      ui.resultados.style.display = '';
      if (!items.length) { ui.resultados.innerHTML = '<div class="item muted">Sin resultados</div>'; return; }
      ui.resultados.innerHTML = items.map((s) =>
        `<div class="item" data-id="${esc(s.id)}">#${esc(s.numero_socio ?? '—')} ${esc(s.apellido ?? '')} ${esc(s.nombre ?? '')}</div>`).join('');
      ui.resultados.querySelectorAll('.item[data-id]').forEach((el) => {
        el.addEventListener('click', () => { const s = items.find((x) => String(x.id) === el.dataset.id); if (s) elegir(s); });
      });
    }
    ui.busqueda.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => buscar(ui.busqueda.value), 250); });
    ui.noSocio.addEventListener('change', () => {
      ui.socioWrap.style.display = ui.noSocio.checked ? 'none' : '';
      ui.extWrap.style.display = ui.noSocio.checked ? '' : 'none';
    });
    return {
      reset() {
        socio = null; ui.noSocio.checked = false; ui.busqueda.value = '';
        ui.resultados.style.display = 'none'; ui.sel.style.display = 'none'; ui.sel.textContent = '';
        ui.nombre.value = ''; ui.contacto.value = '';
        ui.socioWrap.style.display = ''; ui.extWrap.style.display = 'none';
      },
      get() {
        if (ui.noSocio.checked) {
          const n = ui.nombre.value.trim();
          if (!n) return { error: 'Ingresá el nombre de la persona.' };
          return { nombre_externo: n, contacto_externo: ui.contacto.value.trim() || null };
        }
        if (!socio) return { error: 'Buscá y seleccioná el socio, o marcá "No es socio".' };
        return { socio_id: socio.id };
      }
    };
  }
  let pickRes = null, pickAbo = null, pickResPart = null, pickAboPart = null, pickPartEdit = null;

  // ---------- Selector de participantes (varios socios) ----------
  // Los participantes son socios ADICIONALES al titular ("para que vayan todos"):
  // ven la reserva / abono en la app y reciben los avisos.
  function participantesInit(p, contenedorSel, { titulo = '👥 Otros socios que participan (opcional)' } = {}) {
    $(contenedorSel).innerHTML = `
      <label style="margin-top:12px;">${esc(titulo)}</label>
      <div class="esp-buscador">
        <input type="text" id="${p}Busqueda" placeholder="Sumá socios: nombre, apellido, DNI o N° de socio" autocomplete="off" />
        <div id="${p}Resultados" class="esp-resultados" style="display:none;"></div>
      </div>
      <div id="${p}Chips" class="esp-chips"></div>`;
    let lista = []; // [{ id, label }]
    let timer = null;
    const ui = { busqueda: $(`#${p}Busqueda`), resultados: $(`#${p}Resultados`), chips: $(`#${p}Chips`) };
    const etiqueta = (s) => `#${s.numero_socio ?? '—'} ${s.apellido ?? ''} ${s.nombre ?? ''}`.trim();
    function render() {
      ui.chips.innerHTML = lista.length
        ? lista.map((s) => `<span class="esp-chip">${esc(s.label)}<button type="button" data-quitar="${esc(s.id)}" title="Quitar">✕</button></span>`).join('')
        : '<span class="muted" style="font-size:12px;">Solo el titular.</span>';
      ui.chips.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => {
        lista = lista.filter((x) => x.id !== b.dataset.quitar); render();
      }));
    }
    async function buscar(q) {
      if (!q || q.trim().length < 2) { ui.resultados.style.display = 'none'; ui.resultados.innerHTML = ''; return; }
      const { res, data } = await fetchAuth(`/club/${getActiveClubId()}/socios?search=${encodeURIComponent(q.trim())}&limit=8`);
      const items = (res.ok && data.ok) ? (data.socios || []) : [];
      ui.resultados.style.display = '';
      if (!items.length) { ui.resultados.innerHTML = '<div class="item muted">Sin resultados</div>'; return; }
      ui.resultados.innerHTML = items.map((s) => `<div class="item" data-id="${esc(s.id)}">${esc(etiqueta(s))}</div>`).join('');
      ui.resultados.querySelectorAll('.item[data-id]').forEach((el) => el.addEventListener('click', () => {
        const s = items.find((x) => String(x.id) === el.dataset.id);
        if (s && !lista.some((x) => x.id === s.id)) lista.push({ id: s.id, label: etiqueta(s) });
        ui.busqueda.value = ''; ui.resultados.style.display = 'none'; ui.resultados.innerHTML = '';
        render();
      }));
    }
    ui.busqueda.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => buscar(ui.busqueda.value), 250); });
    render();
    return {
      reset() { lista = []; ui.busqueda.value = ''; ui.resultados.style.display = 'none'; ui.resultados.innerHTML = ''; render(); },
      set(items) { lista = (items || []).map((s) => ({ id: s.socio_id, label: s.numero_socio != null ? `#${s.numero_socio} ${s.nombre_completo}` : s.nombre_completo })); render(); },
      get() { return lista.map((s) => s.id); }
    };
  }

  // Texto "👥 Fulano, Mengano" para tablas y detalles
  function participantesTexto(lista) {
    const nombres = (lista || []).map((x) => x.nombre_completo || x).filter(Boolean);
    return nombres.length ? `<div class="esp-part-names">👥 ${esc(nombres.join(', '))}</div>` : '';
  }

  // ---------- Modal: editar participantes de una reserva / abono ----------
  let partCtx = null; // { tipo: 'reserva' | 'abono', id }
  function abrirParticipantes(tipo, item) {
    partCtx = { tipo, id: item.id };
    showMsg('#espPartMsg', '');
    $('#espPartTitulo').textContent = tipo === 'reserva' ? 'Participantes de la reserva' : 'Participantes del abono';
    $('#espPartInfo').textContent = `Titular: ${item.titular || '—'}. Los socios que sumes ven este ${tipo === 'reserva' ? 'turno' : 'abono'} en la app y reciben los avisos.`;
    pickPartEdit.set(item.participantes || []);
    abrirOverlay('espPartOverlay');
  }
  async function guardarParticipantes() {
    if (!partCtx) return;
    showMsg('#espPartMsg', '');
    const btn = $('#btnEspPartGuardar');
    btn.disabled = true;
    try {
      const ruta = partCtx.tipo === 'reserva' ? 'reservas' : 'abonos';
      const { res, data } = await fetchAuth(`${base()}/${ruta}/${partCtx.id}/participantes`, {
        method: 'PUT', json: true, body: JSON.stringify({ socio_ids: pickPartEdit.get() })
      });
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron guardar los participantes');
      cerrarOverlay('espPartOverlay');
      refrescarVistas();
    } catch (e) { showMsg('#espPartMsg', e.message); }
    finally { btn.disabled = false; }
  }

  // ---------- Tabs ----------
  const TABS = ['calendario', 'reservas', 'abonos', 'recursos'];
  function mostrarTab(nombre) {
    TABS.forEach((t) => {
      const pane = $('#espTab' + t.charAt(0).toUpperCase() + t.slice(1));
      if (pane) pane.style.display = t === nombre ? '' : 'none';
    });
    $$('[data-esptab]').forEach((b) => b.classList.toggle('esp-tab--active', b.dataset.esptab === nombre));
    if (nombre === 'calendario') initCalendario();
    if (nombre === 'reservas') cargarReservas();
    if (nombre === 'abonos') cargarAbonos();
    if (nombre === 'recursos') cargarRecursos();
  }

  // ---------- Refresco global ----------
  function refrescarVistas() {
    if (cal) cal.refetchEvents();
    if ($('#espTabReservas') && $('#espTabReservas').style.display !== 'none') cargarReservas();
    if ($('#espTabAbonos') && $('#espTabAbonos').style.display !== 'none') cargarAbonos();
    if (typeof window.actualizarBadgePendientes === 'function') window.actualizarBadgePendientes();
  }

  // ---------- Acción sobre una reserva ----------
  async function accionReserva(id, accion, mensaje) {
    const { res, data } = await fetchAuth(`${base()}/reservas/${id}/${accion}`, {
      method: 'POST', json: true, body: JSON.stringify({ mensaje: mensaje || null })
    });
    if (!res.ok || !data.ok) return { ok: false, error: data.error || 'No se pudo completar la acción' };
    return { ok: true };
  }

  // =====================================================================
  // CALENDARIO
  // =====================================================================
  let cal = null;
  let calRecursoId = null;

  async function configurarSlotsCalendario() {
    const r = recursos.find((x) => x.id === calRecursoId);
    if (!r || !cal) return;
    const dur = Math.min(Math.max(Number(r.duracion_turno_min) || 60, 15), 60);
    const hh = String(Math.floor(dur / 60)).padStart(2, '0'), mm = String(dur % 60).padStart(2, '0');
    cal.setOption('slotDuration', `${hh}:${mm}:00`);
    cal.__rangoKey = null; // fuerza recalcular el rango horario con los turnos de la semana
  }

  // El rango horario del calendario sale de los turnos que trae la semana
  // (los de verdad, libres y ocupados), así siempre refleja los horarios
  // cargados aunque se hayan editado recién. Sin turnos: 08:00 a 22:00.
  function ajustarRangoCalendario(eventos) {
    if (!cal) return;
    let minM = 8 * 60, maxM = 22 * 60;
    if (eventos.length) {
      minM = Infinity; maxM = -Infinity;
      eventos.forEach((e) => {
        const t = e.extendedProps.turno;
        const ini = toMin(t.hora_desde);
        let fin = toMin(t.hora_hasta);
        if (fin <= ini) fin = 24 * 60;
        minM = Math.min(minM, ini); maxM = Math.max(maxM, fin);
      });
    }
    const minH = Math.max(Math.floor(minM / 60), 0);
    const maxH = Math.min(Math.ceil(maxM / 60), 24);
    const key = `${minH}-${maxH}`;
    if (cal.__rangoKey === key) return;
    cal.__rangoKey = key;
    cal.setOption('slotMinTime', `${String(minH).padStart(2, '0')}:00:00`);
    cal.setOption('slotMaxTime', maxH >= 24 ? '24:00:00' : `${String(maxH).padStart(2, '0')}:00:00`);
  }

  const COLORES = {
    // [fondo, borde, texto]. Lo ocupado va con fondo fuerte y texto blanco para que se vea de lejos.
    libre: ['#ecfdf5', '#a7f3d0', '#047857'],
    pendiente: ['#f97316', '#c2410c', '#ffffff'],
    reserva: ['#16a34a', '#14532d', '#ffffff'],
    abono: ['#2563eb', '#1e3a8a', '#ffffff'],
    clase: ['#e9d5ff', '#c084fc', '#581c87'],
    bloqueo: ['#d1d5db', '#6b7280', '#374151']
  };

  function turnoAEvento(fecha, t) {
    const o = (t.ocupado_por || [])[0];
    let kind = 'libre', title = 'Libre';
    const masSocios = o && o.participantes && o.participantes.length ? ` +${o.participantes.length}` : '';
    if (t.estado !== 'libre' && o) {
      if (o.tipo === 'reserva') {
        kind = o.estado === 'pendiente' ? 'pendiente' : 'reserva';
        title = `${o.titular || 'Reserva'}${masSocios}${o.estado === 'pendiente' ? ' · Pendiente' : ''}`;
      } else if (o.tipo === 'abono') { kind = 'abono'; title = `${o.titular || 'Abono'}${masSocios} · Abono`; }
      else if (o.tipo === 'clase') { kind = 'clase'; title = o.nombre || 'Clase'; }
      else { kind = 'bloqueo'; title = o.motivo ? `Bloqueado: ${o.motivo}` : 'Bloqueado'; }
    }
    const [bg, bd, tx] = COLORES[kind];
    const finDia = toMin(t.hora_hasta) <= toMin(t.hora_desde);
    return {
      title, start: `${fecha}T${t.hora_desde}:00`,
      end: finDia ? `${addDaysISO(fecha, 1)}T00:00:00` : `${fecha}T${t.hora_hasta}:00`,
      backgroundColor: bg, borderColor: bd, textColor: tx,
      classNames: kind === 'libre' && turnoYaPaso(fecha, t.hora_hasta) ? ['esp-ev-pasado']
        : (kind === 'reserva' || kind === 'pendiente' || kind === 'abono') ? ['esp-ev-ocupado'] : [],
      extendedProps: { kind, fecha, turno: t, ocupante: o || null }
    };
  }

  async function calEventos(info, ok, fail) {
    try {
      if (!calRecursoId) return ok([]);
      const desde = info.startStr.slice(0, 10);
      const hasta = addDaysISO(info.endStr.slice(0, 10), -1);
      const { res, data } = await fetchAuth(`${base()}/recursos/${calRecursoId}/turnos?desde=${desde}&hasta=${hasta}`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los turnos');
      const ev = [];
      (data.dias || []).forEach((d) => d.turnos.forEach((t) => ev.push(turnoAEvento(d.fecha, t))));
      $('#espCalMsg').textContent = ev.length ? '' : 'Esta semana no hay turnos para este recurso (revisá sus horarios en la pestaña Recursos).';
      ajustarRangoCalendario(ev);
      ok(ev);
    } catch (e) {
      $('#espCalMsg').textContent = e.message;
      fail(e);
    }
  }

  async function calClick(info) {
    const p = info.event.extendedProps;
    if (p.kind === 'libre') {
      if (!canWrite()) return;
      if (turnoYaPaso(p.fecha, p.turno.hora_hasta)) return;
      abrirResNueva({ recursoId: calRecursoId, fecha: p.fecha, horaDesde: p.turno.hora_desde });
    } else if (p.kind === 'pendiente' || p.kind === 'reserva') {
      abrirResDetalle(p.ocupante.reserva_id, p.fecha);
    } else if (p.kind === 'abono') {
      const { res, data } = await fetchAuth(`${base()}/abonos?recurso_id=${calRecursoId}`);
      const ab = (res.ok && data.ok) ? (data.abonos || []).find((a) => a.id === p.ocupante.abono_id) : null;
      if (ab) abrirLiberar(ab, p.fecha);
    }
  }

  async function initCalendario() {
    const msg = $('#espCalMsg');
    if (!recursosActivos().length) {
      msg.textContent = 'Primero cargá un recurso en la pestaña Recursos.';
      return;
    }
    if (!window.FullCalendar) {
      msg.textContent = 'No se pudo cargar el calendario (FullCalendar). Recargá la página.';
      return;
    }
    if (!calRecursoId || !recursosActivos().some((r) => r.id === calRecursoId)) calRecursoId = $('#espCalRecurso').value;
    $('#espCalRecurso').value = calRecursoId;
    if (!cal) {
      cal = new window.FullCalendar.Calendar($('#espCalendar'), {
        initialView: 'timeGridWeek', locale: 'es', firstDay: 1, allDaySlot: false,
        height: 'auto', nowIndicator: true, eventOverlap: false,
        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        buttonText: { today: 'Hoy' },
        slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        events: calEventos, eventClick: calClick
      });
      cal.render();
      await configurarSlotsCalendario();
    } else {
      await configurarSlotsCalendario(); // por si cambiaron la duración o los horarios del recurso
      cal.updateSize();
      cal.refetchEvents();
    }
  }

  // =====================================================================
  // RESERVAS
  // =====================================================================
  function estadoBadge(e) { return `<span class="esp-estado esp-estado--${esc(e)}">${esc(e.charAt(0).toUpperCase() + e.slice(1))}</span>`; }

  function ajustarFiltrosReservas() {
    const est = $('#espResFiltroEstado').value;
    const activas = est === 'pendiente,aceptada' || est === 'pendiente' || est === 'aceptada';
    $('#espResFiltroDesde').value = activas ? ahoraAR().fecha : '';
  }

  let reservasCache = [];
  async function cargarReservas() {
    const tbody = $('#espResBody');
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Cargando…</td></tr>';
    try {
      const q = new URLSearchParams();
      const est = $('#espResFiltroEstado').value; if (est) q.set('estado', est);
      const rec = $('#espResFiltroRecurso').value; if (rec) q.set('recurso_id', rec);
      const d = $('#espResFiltroDesde').value; if (d) q.set('desde', d);
      const h = $('#espResFiltroHasta').value; if (h) q.set('hasta', h);
      const activas = est === 'pendiente,aceptada' || est === 'pendiente' || est === 'aceptada';
      q.set('orden', activas ? 'asc' : 'desc');
      const { res, data } = await fetchAuth(`${base()}/reservas?${q}`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar las reservas');
      const items = data.reservas || [];
      if (!items.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">No hay reservas con esos filtros.</td></tr>'; return; }
      const w = canWrite();
      reservasCache = items;
      tbody.innerHTML = items.map((r) => {
        const titular = (r.socio_id ? `#${esc(r.numero_socio ?? '—')} ${esc(r.titular || '')}` : `${esc(r.titular || '')} <span class="muted">(no socio)</span>`) + participantesTexto(r.participantes);
        const detalle = [r.comentario_socio ? `💬 ${esc(r.comentario_socio)}` : '', r.mensaje_admin ? `📣 ${esc(r.mensaje_admin)}` : ''].filter(Boolean).join('<br>') || '<span class="muted">—</span>';
        let acc = '<span class="muted">—</span>';
        if (w && r.estado === 'pendiente') {
          acc = `<button class="btn-ok" data-esp-res="aceptar">Aceptar</button>
                 <button data-esp-res="rechazar" style="background:#ef4444;border-color:#ef4444;color:#fff;padding:6px 12px;border-radius:8px;">Rechazar</button>`;
        } else if (w && r.estado === 'aceptada' && !turnoYaPaso(r.fecha, r.hora_hasta)) {
          acc = `<button data-esp-res="cancelar" style="color:#b91c1c;">Cancelar reserva</button>`;
        }
        if (w && ['pendiente', 'aceptada'].includes(r.estado) && !turnoYaPaso(r.fecha, r.hora_hasta)) {
          acc = `<button data-esp-res="part" title="Sumar o quitar socios">👥 Socios</button> ` + (acc === '<span class="muted">—</span>' ? '' : acc);
        }
        return `<tr data-id="${esc(r.id)}">
          <td><b>${esc(r.recurso_nombre)}</b></td><td>${fmtFechaLarga(r.fecha)}</td>
          <td>${esc(r.hora_desde)} a ${esc(r.hora_hasta)}</td><td>${titular}</td>
          <td>${estadoBadge(r.estado)}</td><td>${r.origen === 'panel' ? 'Panel' : 'App'}</td>
          <td>${detalle}</td><td style="white-space:nowrap;">${acc}</td></tr>`;
      }).join('');
      tbody.querySelectorAll('[data-esp-res]').forEach((b) => b.addEventListener('click', async () => {
        const id = b.closest('tr').dataset.id; const accion = b.dataset.espRes;
        if (accion === 'part') { const it = reservasCache.find((x) => x.id === id); if (it) abrirParticipantes('reserva', it); return; }
        let mensaje = null;
        if (accion === 'rechazar') {
          mensaje = prompt('Motivo del rechazo (opcional, se le muestra al socio):');
          if (mensaje === null) return;
        } else if (accion === 'cancelar') {
          mensaje = prompt('¿Cancelar esta reserva? Motivo (opcional, se le muestra al socio):');
          if (mensaje === null) return;
        }
        b.disabled = true;
        const r = await accionReserva(id, accion, mensaje);
        b.disabled = false;
        if (!r.ok) alert(r.error);
        refrescarVistas();
      }));
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="esp-msg">${esc(e.message)}</div></td></tr>`;
    }
  }

  // ---------- Detalle de una reserva (desde el calendario) ----------
  async function abrirResDetalle(id, fecha) {
    showMsg('#espResDetMsg', '');
    $('#espResDetInfo').innerHTML = '<div class="muted">Cargando…</div>';
    $('#espResDetAcciones').innerHTML = '';
    $('#espResDetMotivoWrap').style.display = 'none';
    $('#espResDetMensaje').value = '';
    abrirOverlay('espResDetOverlay');
    const { res, data } = await fetchAuth(`${base()}/reservas?recurso_id=${calRecursoId}&desde=${fecha}&hasta=${fecha}`);
    const r = (res.ok && data.ok) ? (data.reservas || []).find((x) => x.id === id) : null;
    if (!r) { $('#espResDetInfo').innerHTML = '<div class="esp-msg">No se encontró la reserva.</div>'; return; }
    $('#espResDetTitulo').textContent = `${r.recurso_nombre} · ${fmtFechaLarga(r.fecha)}`;
    $('#espResDetInfo').innerHTML = `
      <p style="margin:0 0 6px;"><b>${esc(r.hora_desde)} a ${esc(r.hora_hasta)}</b> ${estadoBadge(r.estado)}</p>
      <p style="margin:0 0 6px;">${r.socio_id ? `#${esc(r.numero_socio ?? '—')} ` : ''}${esc(r.titular || '')}${r.socio_id ? '' : ' <span class="muted">(no socio)</span>'}${r.contacto_externo ? ` · ${esc(r.contacto_externo)}` : ''}</p>
      ${participantesTexto(r.participantes)}
      ${r.comentario_socio ? `<p style="margin:0 0 6px;">💬 ${esc(r.comentario_socio)}</p>` : ''}
      <p class="muted" style="margin:0;">Cargada desde ${r.origen === 'panel' ? 'el panel' : 'la app'}.</p>`;
    const acc = $('#espResDetAcciones');
    if (canWrite() && r.estado === 'pendiente') {
      $('#espResDetMotivoWrap').style.display = '';
      acc.innerHTML = `<button type="button" class="btn-ok esp-btn-ok" data-a="aceptar">Aceptar</button>
        <button type="button" class="btn btn-secondary esp-danger" data-a="rechazar">Rechazar</button>`;
    } else if (canWrite() && r.estado === 'aceptada' && !turnoYaPaso(r.fecha, r.hora_hasta)) {
      $('#espResDetMotivoWrap').style.display = '';
      acc.innerHTML = `<button type="button" class="btn btn-secondary esp-danger" data-a="cancelar">Cancelar reserva</button>`;
    }
    if (canWrite() && ['pendiente', 'aceptada'].includes(r.estado) && !turnoYaPaso(r.fecha, r.hora_hasta)) {
      const bp = document.createElement('button');
      bp.type = 'button'; bp.className = 'btn btn-secondary'; bp.textContent = '👥 Socios';
      bp.addEventListener('click', () => { cerrarOverlay('espResDetOverlay'); abrirParticipantes('reserva', r); });
      acc.appendChild(bp);
    }
    acc.querySelectorAll('button[data-a]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const out = await accionReserva(r.id, b.dataset.a, $('#espResDetMensaje').value.trim());
      b.disabled = false;
      if (!out.ok) return showMsg('#espResDetMsg', out.error);
      cerrarOverlay('espResDetOverlay');
      refrescarVistas();
    }));
  }

  // ---------- Reserva manual ----------
  async function cargarTurnosResNueva(preHora) {
    const rid = $('#espResNRecurso').value, fecha = $('#espResNFecha').value;
    const sel = $('#espResNTurno'), info = $('#espResNTurnoInfo');
    sel.innerHTML = ''; info.textContent = '';
    if (!rid || !fecha) return;
    const { res, data } = await fetchAuth(`${base()}/recursos/${rid}/turnos?desde=${fecha}&hasta=${fecha}`);
    if (!res.ok || !data.ok) { info.textContent = data.error || 'No se pudieron cargar los turnos'; return; }
    const dia = (data.dias || []).find((d) => d.fecha === fecha);
    const libres = dia ? dia.turnos.filter((t) => t.estado === 'libre' && !turnoYaPaso(fecha, t.hora_hasta)) : [];
    if (!libres.length) { info.textContent = 'No hay turnos libres para ese día.'; return; }
    sel.innerHTML = libres.map((t) => `<option value="${esc(t.hora_desde)}">${esc(t.hora_desde)} a ${esc(t.hora_hasta)}</option>`).join('');
    if (preHora && libres.some((t) => t.hora_desde === preHora)) sel.value = preHora;
  }

  function abrirResNueva(pre = {}) {
    if (!recursosActivos().length) { alert('Primero cargá un recurso.'); return; }
    pickRes.reset(); pickResPart.reset(); showMsg('#espResNMsg', '');
    $('#espResNComentario').value = '';
    $('#espResNRecurso').value = pre.recursoId || $('#espCalRecurso').value || recursosActivos()[0].id;
    $('#espResNFecha').value = pre.fecha || ahoraAR().fecha;
    $('#espResNFecha').min = ahoraAR().fecha;
    abrirOverlay('espResNuevaOverlay');
    cargarTurnosResNueva(pre.horaDesde);
  }

  async function guardarResNueva() {
    showMsg('#espResNMsg', '');
    const t = pickRes.get();
    if (t.error) return showMsg('#espResNMsg', t.error);
    const hora = $('#espResNTurno').value;
    if (!hora) return showMsg('#espResNMsg', 'Elegí un turno libre.');
    const btn = $('#btnEspResNGuardar');
    btn.disabled = true;
    try {
      const body = {
        recurso_id: $('#espResNRecurso').value, fecha: $('#espResNFecha').value, hora_desde: hora,
        comentario: $('#espResNComentario').value.trim() || undefined,
        participantes_ids: pickResPart.get(), ...t
      };
      const { res, data } = await fetchAuth(`${base()}/reservas`, { method: 'POST', json: true, body: JSON.stringify(body) });
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar');
      cerrarOverlay('espResNuevaOverlay');
      refrescarVistas();
    } catch (e) { showMsg('#espResNMsg', e.message); }
    finally { btn.disabled = false; }
  }

  // =====================================================================
  // ABONOS
  // =====================================================================
  let abonosCache = [];

  async function cargarAbonos() {
    const tbody = $('#espAboBody');
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Cargando…</td></tr>';
    try {
      const q = new URLSearchParams();
      const rec = $('#espAboFiltroRecurso').value; if (rec) q.set('recurso_id', rec);
      const est = $('#espAboFiltroEstado').value; if (est) q.set('estado', est);
      const { res, data } = await fetchAuth(`${base()}/abonos?${q}`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los abonos');
      abonosCache = data.abonos || [];
      if (!abonosCache.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">No hay abonos con esos filtros.</td></tr>'; return; }
      const w = canWrite();
      tbody.innerHTML = abonosCache.map((a) => {
        const lib = (a.excepciones || []).length
          ? a.excepciones.map((e) => `${fmtDMcorto(e.fecha_desde)}${e.fecha_hasta !== e.fecha_desde ? '–' + fmtDMcorto(e.fecha_hasta) : ''}${e.motivo ? ' (' + esc(e.motivo) + ')' : ''}`).join('<br>')
          : '<span class="muted">—</span>';
        const fin = a.estado_calculado === 'finalizado';
        const titular = (a.socio_id ? `#${esc(a.numero_socio ?? '—')} ${esc(a.titular || '')}` : `${esc(a.titular || '')} <span class="muted">(no socio)</span>`) + participantesTexto(a.participantes);
        const acc = (w && !fin)
          ? `<button data-esp-abo="part">👥 Socios</button> <button data-esp-abo="liberar">🌴 Liberar fechas</button> <button data-esp-abo="baja" style="color:#b91c1c;">Dar de baja</button>`
          : (fin ? estadoBadge('finalizado') : '<span class="muted">—</span>');
        return `<tr data-id="${esc(a.id)}">
          <td><b>${esc(a.recurso_nombre)}</b></td>
          <td>${DIAS_LARGO[a.dia_semana]} ${esc(a.hora_desde)}–${esc(a.hora_hasta)}${a.notas ? `<div class="muted">${esc(a.notas)}</div>` : ''}</td>
          <td>${titular}</td><td>${fmtDMY(a.vigente_desde)}</td>
          <td>${a.vigente_hasta ? fmtDMY(a.vigente_hasta) : '<span class="muted">Sin fin</span>'}</td>
          <td>${a.proxima_fecha ? fmtFechaLarga(a.proxima_fecha) : '<span class="muted">—</span>'}</td>
          <td>${lib}</td><td style="white-space:nowrap;">${acc}</td></tr>`;
      }).join('');
      tbody.querySelectorAll('[data-esp-abo]').forEach((b) => b.addEventListener('click', () => {
        const a = abonosCache.find((x) => x.id === b.closest('tr').dataset.id);
        if (!a) return;
        if (b.dataset.espAbo === 'liberar') abrirLiberar(a, null);
        else if (b.dataset.espAbo === 'part') abrirParticipantes('abono', a);
        else abrirBaja(a);
      }));
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="esp-msg">${esc(e.message)}</div></td></tr>`;
    }
  }

  // ---------- Nuevo abono ----------
  async function cargarTurnosAboNuevo() {
    const rid = $('#espAboNRecurso').value, fecha = $('#espAboNFecha').value;
    const sel = $('#espAboNTurno'), info = $('#espAboNTurnoInfo');
    sel.innerHTML = ''; info.textContent = '';
    $('#espAboNDia').value = fecha ? DIAS_LARGO[diaSemanaDeIso(fecha)] : '';
    if (!rid || !fecha) return;
    const { res, data } = await fetchAuth(`${base()}/recursos/${rid}/turnos?desde=${fecha}&hasta=${fecha}`);
    if (!res.ok || !data.ok) { info.textContent = data.error || 'No se pudieron cargar los turnos'; return; }
    const dia = (data.dias || []).find((d) => d.fecha === fecha);
    if (!dia || !dia.turnos.length) { info.textContent = 'Ese día el recurso no tiene turnos. Elegí otra fecha de inicio o revisá sus horarios.'; return; }
    sel.innerHTML = dia.turnos.map((t) => {
      const o = (t.ocupado_por || [])[0];
      const marca = t.estado === 'libre' ? '' : ` — ocupado ese día (${o?.titular || o?.tipo || ''})`;
      return `<option value="${esc(t.hora_desde)}|${esc(t.hora_hasta)}">${esc(t.hora_desde)} a ${esc(t.hora_hasta)}${esc(marca)}</option>`;
    }).join('');
    info.textContent = 'El abono se repite todas las semanas en este mismo día y horario.';
  }

  function abrirAboNuevo() {
    if (!recursosActivos().length) { alert('Primero cargá un recurso.'); return; }
    pickAbo.reset(); pickAboPart.reset(); showMsg('#espAboNMsg', '');
    $('#espAboNNotas').value = '';
    $('#espAboNConFin').checked = false; $('#espAboNFinWrap').style.display = 'none'; $('#espAboNFin').value = '';
    $('#espAboNRecurso').value = $('#espAboFiltroRecurso').value || recursosActivos()[0].id;
    $('#espAboNFecha').value = ahoraAR().fecha;
    $('#espAboNFecha').min = ahoraAR().fecha;
    abrirOverlay('espAboNuevoOverlay');
    cargarTurnosAboNuevo();
  }

  function textoConflicto(c) {
    if (c.tipo === 'reserva') return `Reserva ${fmtFechaLarga(c.fecha)} ${esc(c.desde)}–${esc(c.hasta)} (${esc(c.estado)})${c.titular ? ' · ' + esc(c.titular) : ''}`;
    if (c.tipo === 'abono') return `Abono ${c.fecha ? fmtFechaLarga(c.fecha) + ' ' : ''}${esc(c.desde)}–${esc(c.hasta)}${c.titular ? ' · ' + esc(c.titular) : (c.detalle ? ' · ' + esc(c.detalle) : '')}`;
    if (c.tipo === 'clase') return `Clase "${esc(c.nombre || '')}" ${fmtFechaLarga(c.fecha)}${c.desde ? ' ' + esc(c.desde) + '–' + esc(c.hasta) : ''}`;
    return esc(c.tipo);
  }

  async function guardarAboNuevo() {
    showMsg('#espAboNMsg', '');
    const t = pickAbo.get();
    if (t.error) return showMsg('#espAboNMsg', t.error);
    const turno = $('#espAboNTurno').value;
    if (!turno) return showMsg('#espAboNMsg', 'Elegí un turno.');
    const [hd, hh] = turno.split('|');
    const fecha = $('#espAboNFecha').value;
    const body = {
      recurso_id: $('#espAboNRecurso').value, dia_semana: diaSemanaDeIso(fecha),
      hora_desde: hd, hora_hasta: hh, vigente_desde: fecha,
      notas: $('#espAboNNotas').value.trim() || undefined,
      participantes_ids: pickAboPart.get(), ...t
    };
    if ($('#espAboNConFin').checked) {
      const fin = $('#espAboNFin').value;
      if (!fin) return showMsg('#espAboNMsg', 'Indicá el último día del abono.');
      body.vigente_hasta = fin;
    }
    const btn = $('#btnEspAboNGuardar');
    btn.disabled = true;
    try {
      const { res, data } = await fetchAuth(`${base()}/abonos`, { method: 'POST', json: true, body: JSON.stringify(body) });
      if (res.status === 409 && Array.isArray(data.conflictos)) {
        const lista = data.conflictos.slice(0, 12).map((c) => `<li>${textoConflicto(c)}</li>`).join('');
        const mas = data.conflictos.length > 12 ? `<li>… y ${data.conflictos.length - 12} más</li>` : '';
        return showMsgHtml('#espAboNMsg', `${esc(data.error)}<ul class="esp-confl">${lista}${mas}</ul>`);
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo crear el abono');
      cerrarOverlay('espAboNuevoOverlay');
      refrescarVistas();
    } catch (e) { showMsg('#espAboNMsg', e.message); }
    finally { btn.disabled = false; }
  }

  // ---------- Liberar fechas ----------
  let libAbonoId = null;

  function renderLiberadas(a) {
    const cont = $('#espAboLibLista');
    const w = canWrite();
    cont.innerHTML = (a.excepciones || []).length
      ? '<div class="muted" style="margin-bottom:4px;">Fechas liberadas:</div>' + a.excepciones.map((e) => `
          <div class="esp-lib"><span>${fmtFechaLarga(e.fecha_desde)}${e.fecha_hasta !== e.fecha_desde ? ' → ' + fmtFechaLarga(e.fecha_hasta) : ''}${e.motivo ? ' · ' + esc(e.motivo) : ''}</span>
          ${w ? `<button type="button" title="Volver a ocupar" data-exc="${esc(e.id)}">✖</button>` : ''}</div>`).join('')
      : '<div class="muted">Todavía no hay fechas liberadas.</div>';
    cont.querySelectorAll('[data-exc]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Volver a ocupar esas fechas con el abono?')) return;
      const { res, data } = await fetchAuth(`${base()}/abonos/${libAbonoId}/excepciones/${b.dataset.exc}`, { method: 'DELETE' });
      if (res.status === 409 && Array.isArray(data.conflictos)) {
        return showMsgHtml('#espAboLibMsg', `${esc(data.error)}<ul class="esp-confl">${data.conflictos.slice(0, 10).map((c) => `<li>${textoConflicto(c)}</li>`).join('')}</ul>`);
      }
      if (!res.ok || !data.ok) return showMsg('#espAboLibMsg', data.error || 'No se pudo quitar');
      await recargarLiberar(); refrescarVistas();
    }));
  }

  async function recargarLiberar() {
    const { res, data } = await fetchAuth(`${base()}/abonos`);
    const a = (res.ok && data.ok) ? (data.abonos || []).find((x) => x.id === libAbonoId) : null;
    if (a) renderLiberadas(a);
  }

  function abrirLiberar(a, fechaPre) {
    libAbonoId = a.id;
    showMsg('#espAboLibMsg', '');
    $('#espAboLibTitulo').textContent = `Liberar fechas · ${a.recurso_nombre} ${DIAS_LARGO[a.dia_semana]} ${a.hora_desde}`;
    $('#espAboLibDesde').value = fechaPre || (a.proxima_fecha || ahoraAR().fecha);
    $('#espAboLibHasta').value = '';
    $('#espAboLibMotivo').value = '';
    const w = canWrite();
    $('#btnEspAboLibGuardar').style.display = w ? '' : 'none';
    renderLiberadas(a);
    abrirOverlay('espAboLibOverlay');
  }

  async function guardarLiberar() {
    showMsg('#espAboLibMsg', '');
    const d = $('#espAboLibDesde').value;
    if (!d) return showMsg('#espAboLibMsg', 'Elegí la fecha.');
    const body = { fecha_desde: d, fecha_hasta: $('#espAboLibHasta').value || d, motivo: $('#espAboLibMotivo').value.trim() || undefined };
    const { res, data } = await fetchAuth(`${base()}/abonos/${libAbonoId}/excepciones`, { method: 'POST', json: true, body: JSON.stringify(body) });
    if (!res.ok || !data.ok) return showMsg('#espAboLibMsg', data.error || 'No se pudo liberar');
    $('#espAboLibHasta').value = ''; $('#espAboLibMotivo').value = '';
    await recargarLiberar(); refrescarVistas();
  }

  // ---------- Baja ----------
  let bajaAbonoId = null;
  function abrirBaja(a) {
    bajaAbonoId = a.id; showMsg('#espAboBajaMsg', '');
    $('#espAboBajaInfo').innerHTML = `<b>${esc(a.recurso_nombre)}</b> · ${DIAS_LARGO[a.dia_semana]} ${esc(a.hora_desde)}–${esc(a.hora_hasta)}<br>${esc(a.titular || '')}`;
    $('#espAboBajaFecha').value = ahoraAR().fecha;
    abrirOverlay('espAboBajaOverlay');
  }
  async function confirmarBaja() {
    showMsg('#espAboBajaMsg', '');
    const f = $('#espAboBajaFecha').value;
    if (!f) return showMsg('#espAboBajaMsg', 'Elegí el último día del abono.');
    if (!confirm(`¿Dar de baja el abono? Seguirá ocupando el turno hasta el ${fmtDMY(f)} inclusive.`)) return;
    const { res, data } = await fetchAuth(`${base()}/abonos/${bajaAbonoId}/baja`, { method: 'POST', json: true, body: JSON.stringify({ fecha_hasta: f }) });
    if (!res.ok || !data.ok) return showMsg('#espAboBajaMsg', data.error || 'No se pudo dar de baja');
    cerrarOverlay('espAboBajaOverlay');
    refrescarVistas();
  }

  // =============================
  // Init
  // =============================
  window.initEspaciosSection = async function initEspaciosSection() {
    const w = canWrite();
    const btnNuevo = $('#btnEspNuevoRecurso');
    btnNuevo.style.display = w ? '' : 'none';
    btnNuevo.addEventListener('click', () => abrirModal(null));

    $('#btnEspRecursoCerrar').addEventListener('click', cerrarModal);
    $('#espRecursoOverlay').addEventListener('mousedown', (ev) => {
      if (ev.target.id === 'espRecursoOverlay') cerrarModal();
    });
    $('#btnEspRecursoGuardar').addEventListener('click', guardarRecurso);
    $('#btnEspRecursoEliminar').addEventListener('click', eliminarRecurso);
    $('#espImagen').addEventListener('change', onImagenElegida);
    $('#btnEspImagenQuitar').addEventListener('click', () => {
      imagenBase64 = null; imagenMime = null; quitarImagen = true;
      $('#espImagen').value = '';
      setImagenUI();
    });

    $('#btnEspReglaAgregar').addEventListener('click', abrirReglaForm);
    $('#btnEspReglaCancelar').addEventListener('click', cerrarReglaForm);
    $('#btnEspReglaGuardar').addEventListener('click', guardarRegla);
    $('#btnEspVerTurnos').addEventListener('click', verTurnos);
    $('#btnEspTurnosCerrar').addEventListener('click', () => { $('#espTurnosBox').style.display = 'none'; });
    $$('#espReglaModo .esp-seg').forEach((b) => b.addEventListener('click', () => { reglaModo = b.dataset.modo; aplicarModoTipoUI(); }));
    $$('#espReglaTipo .esp-seg').forEach((b) => b.addEventListener('click', () => { reglaTipo = b.dataset.tipo; aplicarModoTipoUI(); }));
    $('#espReglaTodoDia').addEventListener('change', aplicarModoTipoUI);
    $$('#espReglaDias button').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));

    // ---- Paso 9: tabs, calendario, reservas, abonos ----
    pickRes = titularInit('espResN', '#espResNTitular');
    pickAbo = titularInit('espAboN', '#espAboNTitular');
    pickResPart = participantesInit('espResNPart', '#espResNPart');
    pickAboPart = participantesInit('espAboNPart', '#espAboNPart');
    pickPartEdit = participantesInit('espPartEdit', '#espPartPicker', { titulo: '👥 Socios que participan' });
    $('#btnEspPartGuardar').addEventListener('click', guardarParticipantes);
    $('#espVerInactivos').addEventListener('change', renderRecursos);
    $$('[data-esptab]').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.esptab)));
    $$('[data-esp-cerrar]').forEach((b) => b.addEventListener('click', () => cerrarOverlay(b.dataset.espCerrar)));

    $('#espCalRecurso').addEventListener('change', async () => {
      calRecursoId = $('#espCalRecurso').value;
      if (cal) { await configurarSlotsCalendario(); cal.refetchEvents(); }
    });

    $('#btnEspResNueva').style.display = w ? '' : 'none';
    $('#btnEspResNueva').addEventListener('click', () => abrirResNueva({}));
    ['espResFiltroRecurso', 'espResFiltroDesde', 'espResFiltroHasta'].forEach((id) => $('#' + id).addEventListener('change', cargarReservas));
    $('#espResFiltroEstado').addEventListener('change', () => { ajustarFiltrosReservas(); cargarReservas(); });
    $('#espResNRecurso').addEventListener('change', () => cargarTurnosResNueva());
    $('#espResNFecha').addEventListener('change', () => cargarTurnosResNueva());
    $('#btnEspResNGuardar').addEventListener('click', guardarResNueva);

    $('#btnEspAboNuevo').style.display = w ? '' : 'none';
    $('#btnEspAboNuevo').addEventListener('click', abrirAboNuevo);
    ['espAboFiltroRecurso', 'espAboFiltroEstado'].forEach((id) => $('#' + id).addEventListener('change', cargarAbonos));
    $('#espAboNRecurso').addEventListener('change', cargarTurnosAboNuevo);
    $('#espAboNFecha').addEventListener('change', cargarTurnosAboNuevo);
    $('#espAboNConFin').addEventListener('change', () => { $('#espAboNFinWrap').style.display = $('#espAboNConFin').checked ? '' : 'none'; });
    $('#btnEspAboNGuardar').addEventListener('click', guardarAboNuevo);
    $('#btnEspAboLibGuardar').addEventListener('click', guardarLiberar);
    $('#btnEspAboBajaOk').addEventListener('click', confirmarBaja);

    cal = null;
    ajustarFiltrosReservas();
    await cargarRecursos();
    mostrarTab(recursosActivos().length ? 'calendario' : 'recursos');
  };
})();
