// public/js/espacios.js
//
// Panel admin: módulo "Espacios y Clases" (Release A).
// Por ahora: pestaña "Recursos" (alta/edición/baja de canchas, salones y
// espacios + editor de disponibilidad + vista previa de turnos).
// Las pestañas Calendario / Reservas / Abonos / Clases se suman en pasos
// siguientes (ver claude/espacios-y-clases-plan.md).
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
  const TIPO_ICON = { cancha: '⚽', salon: '🏛️', espacio: '🏟️', otro: '📍' };
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
    const cont = $('#espRecursosLista');
    const activos = recursos.filter((r) => r.activo).length;
    $('#espRecursosResumen').textContent = recursos.length
      ? `${activos} recurso${activos === 1 ? '' : 's'} activo${activos === 1 ? '' : 's'}` +
        (recursos.length > activos ? ` · ${recursos.length - activos} inactivo${recursos.length - activos === 1 ? '' : 's'}` : '')
      : '';

    if (!recursos.length) {
      cont.innerHTML = `<div class="muted">Todavía no cargaste ningún recurso. Tocá "➕ Nuevo recurso" para empezar (por ejemplo, una cancha o un salón).</div>`;
      return;
    }

    const w = canWrite();
    cont.innerHTML = recursos.map((r) => {
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

    await cargarRecursos();
  };
})();
