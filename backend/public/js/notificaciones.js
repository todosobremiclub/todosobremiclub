// public/js/notificaciones.js
(() => {
  console.log('[notificaciones] script cargado ✅');

  const $id = (id) => document.getElementById(id);

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Sesión expirada');
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club activo');
      throw new Error('No club');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers ?? {};
    headers.Authorization = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const { json, ...rest } = options;

    const res = await fetch(url, { ...rest, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&')
      .replaceAll('<', '<')
      .replaceAll('>', '>')
      .replaceAll('"', '"')
      .replaceAll("'", "''");
  }

  function fmtDT(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('es-AR'); }
    catch { return String(iso); }
  }

// =========================
  // HISTORIAL
  // =========================
  let cache = [];
  let cacheProgramadas = []; // ✅ NUEVO

  // Catálogos para el selector de Destino
  let actividadesCache = [];
  let categoriasCache = [];
  let aniosNacimientoCache = [];

  // ✅ NUEVO: badge visual de canal, reutilizado en Historial y Programadas
  function canalBadge(canal) {
    if (canal === 'whatsapp') {
      return `<span class="noti-badge noti-badge-wa">💬 WhatsApp</span>`;
    }
    if (canal === 'ambos') {
      return `<span class="noti-badge noti-badge-ambos">📱💬 Ambos</span>`;
    }
    return `<span class="noti-badge noti-badge-app">📱 App</span>`;
  }

  async function loadNotificaciones() {
    const tbody = $id('notificacionesTableBody');
    if (!tbody) return; // si todavía no está la sección cargada

    tbody.innerHTML = `<tr><td colspan="6">Cargando...</td></tr>`;

    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones`);

    if (!res.ok || !data.ok) {
      tbody.innerHTML = `<tr><td colspan="6">Error cargando historial</td></tr>`;
      console.error('[notificaciones] error load', data);
      return;
    }

    cache = data.notificaciones ?? [];
    renderTable();
  }

  function renderTable() {
    const tbody = $id('notificacionesTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!cache.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No hay notificaciones.</td></tr>`;
      return;
    }

    cache.forEach(n => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(n.titulo ?? '')}</strong></td>
        <td>${escapeHtml(n.cuerpo ?? '').slice(0, 160)}${(n.cuerpo ?? '').length > 160 ? '…' : ''}</td>
        <td>${canalBadge(n.canal)}</td>
        <td>${escapeHtml(fmtDT(n.created_at))}</td>
        <td>${n.sent_at ? escapeHtml(fmtDT(n.sent_at)) : '—'}</td>
        <td style="white-space:nowrap;">
          <button id="btnNotiDel" class="btn btn-secondary"
            style="background:#ef4444;border-color:#ef4444;"
            data-act="del" data-id="${escapeHtml(n.id)}">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

// =========================
  // ✅ NUEVO: PROGRAMADAS
  // =========================
  async function loadProgramadas() {
    const tbody = $id('notiProgramadasTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6">Cargando...</td></tr>`;

    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones/programadas`);

    if (!res.ok || !data.ok) {
      tbody.innerHTML = `<tr><td colspan="6">Error cargando programadas</td></tr>`;
      console.error('[notificaciones] error load programadas', data);
      return;
    }

    cacheProgramadas = data.programadas ?? [];
    renderProgramadasTable();
  }

  function fmtRepeticion(p) {
    if (p.tipo_repeticion === 'mensual') {
      return `Todos los meses (día ${p.dia_mes}, ${String(p.hora).slice(0, 5)} hs)`;
    }
    return `Una vez (${String(p.hora).slice(0, 5)} hs)`;
  }

  function renderProgramadasTable() {
    const tbody = $id('notiProgramadasTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!cacheProgramadas.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No hay notificaciones programadas.</td></tr>`;
      return;
    }

    cacheProgramadas.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(p.titulo ?? '')}</strong></td>
        <td>${escapeHtml(p.cuerpo ?? '').slice(0, 160)}${(p.cuerpo ?? '').length > 160 ? '…' : ''}</td>
        <td>${canalBadge(p.canal)}</td>
        <td>${escapeHtml(fmtRepeticion(p))}</td>
        <td>${escapeHtml(fmtDT(p.proxima_ejecucion))}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-secondary"
            style="background:#ef4444;border-color:#ef4444;"
            data-act="del-prog" data-id="${escapeHtml(p.id)}">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function cancelarProgramada(id) {
    const clubId = getActiveClubId();
    if (!confirm('¿Cancelar esta notificación programada?')) return;

    const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones/programadas/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok || !data.ok) {
      alert(data.error || 'No se pudo cancelar');
      return;
    }

    await loadProgramadas();
  }

  // Muestra/oculta los campos según "¿Cuándo enviar?" y "Repetición"
  function actualizarVisibilidadProgramacion() {
    const cuando = $id('notiCuando')?.value || 'ahora';
    const progWrap = $id('notiProgramarWrap');
    if (progWrap) progWrap.style.display = cuando === 'programar' ? 'block' : 'none';

    const btn = $id('btnPushEnviar');
    if (btn) btn.textContent = cuando === 'programar' ? '🗓️ Programar envío' : '📤 Guardar y enviar';

    const rep = $id('notiRepeticion')?.value || 'una_vez';
    const unaVezWrap = $id('notiProgUnaVezWrap');
    const mensualWrap = $id('notiProgMensualWrap');
    if (unaVezWrap) unaVezWrap.style.display = rep === 'una_vez' ? 'flex' : 'none';
    if (mensualWrap) mensualWrap.style.display = rep === 'mensual' ? 'flex' : 'none';
  }

  // =========================
  // ✅ NUEVO: chips de canal ("Enviar por") + vista previa en vivo
  // =========================

  // Marca visualmente el chip que corresponde al valor actual de #notiCanal
  function syncCanalChipsUI() {
    const actual = $id('notiCanal')?.value || 'app';
    document.querySelectorAll('.noti-canal-opt').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.canal === actual);
    });
  }

  // Cambia el canal elegido: actualiza el <select> oculto (lo que lee
  // sendNotificacion()), los chips y la vista previa.
  function setCanal(canal) {
    const sel = $id('notiCanal');
    if (sel) sel.value = canal;
    syncCanalChipsUI();
    updatePreview();
  }

  // Arma la vista previa (app / WhatsApp) en base a lo que se está tipeando
  function updatePreview() {
    const titulo = $id('pushTitulo')?.value?.trim();
    const cuerpo = $id('pushCuerpo')?.value?.trim();
    const clubName = window.currentClub?.name ? String(window.currentClub.name).trim() : '';

    const previewTitulo = $id('previewTitulo');
    const previewCuerpo = $id('previewCuerpo');
    const previewWaTexto = $id('previewWaTexto');

    if (previewTitulo) {
      previewTitulo.textContent = clubName
        ? `${clubName} — ${titulo || 'Título de la notificación'}`
        : (titulo || 'Título de la notificación');
    }
    if (previewCuerpo) {
      previewCuerpo.textContent = cuerpo || 'Acá vas a ver el mensaje a medida que lo escribís…';
    }
    if (previewWaTexto) {
      const partes = [];
      if (clubName) partes.push(clubName);
      if (titulo) partes.push(titulo);
      partes.push(cuerpo || 'Acá vas a ver el mensaje de WhatsApp…');
      previewWaTexto.textContent = partes.join('\n');
    }

    // El canal solo es relevante si la card de "Enviar por" está visible
    // (club con WhatsApp habilitado). Si no, se asume "app".
    const canalWrapVisible = $id('notificaciones-canal-wrap')?.style.display !== 'none';
    const canal = canalWrapVisible ? ($id('notiCanal')?.value || 'app') : 'app';

    const appWrap = $id('previewAppWrap');
    const waWrap = $id('previewWaWrap');
    const hint = $id('previewHint');

    const mostrarApp = canal === 'app' || canal === 'ambos';
    const mostrarWa = canal === 'whatsapp' || canal === 'ambos';

    if (appWrap) appWrap.style.display = mostrarApp ? 'block' : 'none';
    if (waWrap) waWrap.style.display = mostrarWa ? 'block' : 'none';
    if (hint) hint.style.display = (mostrarApp || mostrarWa) ? 'none' : 'block';
  }

  // =========================
  // CATÁLOGOS PARA EL DESTINO (mismos que usa Noticias)
  // =========================
  async function loadActividades() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/config/actividades`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando actividades');
      actividadesCache = data.actividades || [];
    } catch (e) {
      console.error('loadActividades:', e);
      actividadesCache = [];
    }
  }

  async function loadCategorias() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/config/categorias`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando categorías');
      categoriasCache = data.categorias || [];
    } catch (e) {
      console.error('loadCategorias:', e);
      categoriasCache = [];
    }
  }

  async function loadAniosNacimiento() {
    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/noticias/anios-nacimiento`);
      if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando años de nacimiento');
      aniosNacimientoCache = (data.anios || []).map(a => String(a));
    } catch (e) {
      console.error('loadAniosNacimiento:', e);
      aniosNacimientoCache = [];
    }
  }

  // =========================
  // ENVIAR
  // =========================

function renderDestinoExtra() {
  const tipo = $id('notiDestinoTipo')?.value || 'todos';
  const cont = $id('notiDestinoExtra');
  if (!cont) return;
  cont.innerHTML = '';

  if (tipo === 'todos' || tipo === 'falta_pago') return;

  if (tipo === 'actividad') {
    const label = document.createElement('label');
    label.textContent = 'Actividad';

    const sel = document.createElement('select');
    sel.id = 'notiDestinoActividad';
    sel.innerHTML =
      `<option value="">Seleccionar actividad...</option>` +
      actividadesCache
        .map(a => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`)
        .join('');

    label.appendChild(sel);
    cont.appendChild(label);
    return;
  }

  if (tipo === 'categoria') {
    const label = document.createElement('label');
    label.textContent = 'Categoría';

    const sel = document.createElement('select');
    sel.id = 'notiDestinoCategoria';
    sel.innerHTML =
      `<option value="">Seleccionar categoría...</option>` +
      categoriasCache
        .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
        .join('');

    label.appendChild(sel);
    cont.appendChild(label);
    return;
  }

  if (tipo === 'anio_nac') {
    const label = document.createElement('label');
    label.textContent = 'Año de nacimiento';

    const sel = document.createElement('select');
    sel.id = 'notiDestinoAnio';
    sel.innerHTML =
      `<option value="">Seleccionar año...</option>` +
      aniosNacimientoCache
        .map(y => `<option value="${y}">${y}</option>`)
        .join('');

    label.appendChild(sel);
    cont.appendChild(label);
    return;
  }

  if (tipo === 'act_cat') {
    const labelAct = document.createElement('label');
    labelAct.textContent = 'Actividad';

    const selAct = document.createElement('select');
    selAct.id = 'notiDestinoActividad';
    selAct.innerHTML =
      `<option value="">Seleccionar actividad...</option>` +
      actividadesCache
        .map(a => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`)
        .join('');
    labelAct.appendChild(selAct);

    const labelCat = document.createElement('label');
    labelCat.textContent = 'Categoría';

    const selCat = document.createElement('select');
    selCat.id = 'notiDestinoCategoria';
    selCat.innerHTML =
      `<option value="">Seleccionar categoría...</option>` +
      categoriasCache
        .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
        .join('');
    labelCat.appendChild(selCat);

    cont.appendChild(labelAct);
    cont.appendChild(labelCat);
    return;
  }

  if (tipo === 'cat_anio') {
    const labelCat = document.createElement('label');
    labelCat.textContent = 'Categoría';

    const selCat = document.createElement('select');
    selCat.id = 'notiDestinoCategoria';
    selCat.innerHTML =
      `<option value="">Seleccionar categoría...</option>` +
      categoriasCache
        .map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`)
        .join('');
    labelCat.appendChild(selCat);

    const labelAnio = document.createElement('label');
    labelAnio.textContent = 'Año de nacimiento';

    const selAnio = document.createElement('select');
    selAnio.id = 'notiDestinoAnio';
    selAnio.innerHTML =
      `<option value="">Seleccionar año...</option>` +
      aniosNacimientoCache
        .map(y => `<option value="${y}">${y}</option>`)
        .join('');
    labelAnio.appendChild(selAnio);

    cont.appendChild(labelCat);
    cont.appendChild(labelAnio);
    return;
  }
}

function getDestinoPayload() {
  const tipo = $id('notiDestinoTipo')?.value || 'todos';

  let v1 = null;
  let v2 = null;

  if (tipo === 'actividad') {
    v1 = $id('notiDestinoActividad')?.value?.trim() || '';
    if (!v1) throw new Error('Seleccioná una actividad');
  } else if (tipo === 'categoria') {
    v1 = $id('notiDestinoCategoria')?.value?.trim() || '';
    if (!v1) throw new Error('Seleccioná una categoría');
  } else if (tipo === 'anio_nac') {
    v1 = $id('notiDestinoAnio')?.value?.trim() || '';
    if (!v1) throw new Error('Seleccioná un año de nacimiento');
  } else if (tipo === 'cat_anio') {
    v1 = $id('notiDestinoCategoria')?.value?.trim() || '';
    v2 = $id('notiDestinoAnio')?.value?.trim() || '';
    if (!v1 || !v2) throw new Error('Seleccioná categoría y año');
  } else if (tipo === 'act_cat') {
    v1 = $id('notiDestinoActividad')?.value?.trim() || '';
    v2 = $id('notiDestinoCategoria')?.value?.trim() || '';
    if (!v1 || !v2) throw new Error('Seleccioná actividad y categoría');
  } else if (tipo === 'falta_pago') {
    v1 = null;
    v2 = null;
  }

  return { destino_tipo: tipo, destino_valor1: v1, destino_valor2: v2 };
}

 async function sendNotificacion() {
  console.log('[notificaciones] enviando…');

  const titulo = $id('pushTitulo')?.value?.trim();
  const cuerpo = $id('pushCuerpo')?.value?.trim();

  if (!titulo || !cuerpo) {
    alert('Completá título y mensaje');
    return;
  }

  const clubId = getActiveClubId();
  const btn = $id('btnPushEnviar');
  if (btn) btn.disabled = true;

  const cuando = $id('notiCuando')?.value || 'ahora'; // ✅ NUEVO

  try {
    const destino = getDestinoPayload();
    const canal = $id('notiCanal')?.value || 'app';

    // ✅ NUEVO: si eligió "Programar envío", va a un endpoint distinto
    if (cuando === 'programar') {
      const tipo_repeticion = $id('notiRepeticion')?.value || 'una_vez';

      const body = { titulo, cuerpo, data: destino, canal, tipo_repeticion };

      if (tipo_repeticion === 'una_vez') {
        const fecha = $id('notiProgFecha')?.value;
        const hora = $id('notiProgHoraUnaVez')?.value;
        if (!fecha || !hora) throw new Error('Completá la fecha y la hora del envío');
        body.fecha = fecha;
        body.hora = hora;
      } else {
        const dia_mes = $id('notiProgDiaMes')?.value;
        const hora = $id('notiProgHoraMensual')?.value;
        if (!dia_mes || !hora) throw new Error('Completá el día del mes y la hora del envío');
        body.dia_mes = Number(dia_mes);
        body.hora = hora;
      }

      const { res, data } = await fetchAuth(
        `/club/${clubId}/notificaciones/programadas`,
        { method: 'POST', json: true, body: JSON.stringify(body) }
      );

      if (!res.ok || !data.ok) {
        alert(data?.error || 'Error programando notificación');
        return;
      }

      alert('✅ Notificación programada correctamente');

      if ($id('pushTitulo')) $id('pushTitulo').value = '';
      if ($id('pushCuerpo')) $id('pushCuerpo').value = '';
      if ($id('notiProgFecha')) $id('notiProgFecha').value = '';
      if ($id('notiProgHoraUnaVez')) $id('notiProgHoraUnaVez').value = '';
      if ($id('notiProgDiaMes')) $id('notiProgDiaMes').value = '';
      if ($id('notiProgHoraMensual')) $id('notiProgHoraMensual').value = '';
      updatePreview();

      await loadProgramadas();
      return;
    }

    const { res, data } = await fetchAuth(
      `/club/${clubId}/notificaciones`,
      {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          titulo,
          cuerpo,
          data: destino,
          canal
        })
      }
    );

    if (!res.ok || !data.ok) {
      alert(data?.error || 'Error enviando notificación');
      return;
    }

    // ✅ si se mandó por WhatsApp, avisar cuántos salieron
    const wa = data?.whatsappResumen;
    if (wa) {
      let msg = `✅ Notificación enviada. WhatsApp: ${wa.enviados} enviados de ${wa.total}.`;
      if (wa.sinCupo > 0) msg += ' ⚠️ Se alcanzó el límite mensual de WhatsApp del club, no se mandó al resto.';
      // ✅ NUEVO: si hubo fallos que no son por falta de cupo (ej: teléfono
      // inválido, error de Meta), mostrar el motivo en vez de dejarlo mudo.
      if (Array.isArray(wa.errores) && wa.errores.length > 0) {
        const motivos = [...new Set(wa.errores.map((e) => e.error))];
        msg += `\n⚠️ ${wa.errores.length} no se pudieron enviar: ${motivos.join(', ')}`;
      }
      alert(msg);
    } else {
      alert('✅ Notificación enviada');
    }

    if ($id('pushTitulo')) $id('pushTitulo').value = '';
    if ($id('pushCuerpo')) $id('pushCuerpo').value = '';
    updatePreview();

    await loadNotificaciones();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error enviando notificación');
  } finally {
    if (btn) btn.disabled = false;
  }
}

  // =========================
  // ELIMINAR
  // =========================
  async function deleteNotificacion(id) {
    const clubId = getActiveClubId();
    if (!confirm('¿Eliminar esta notificación?')) return;

    const { res, data } = await fetchAuth(`/club/${clubId}/notificaciones/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok || !data.ok) {
      alert(data.error || 'No se pudo eliminar');
      return;
    }

    await loadNotificaciones();
  }

  // ✅ EVENT DELEGATION GLOBAL
  document.addEventListener('click', (e) => {
    const btnSend = e.target.closest('#btnPushEnviar');
    if (btnSend) {
      e.preventDefault();
      console.log('[notificaciones] click Guardar y enviar ✅');
      sendNotificacion().catch(err => {
        console.error(err);
        alert(err.message || 'Error');
      });
      return;
    }

    const btnDel = e.target.closest('button[data-act="del"][data-id]');
    if (btnDel) {
      e.preventDefault();
      deleteNotificacion(btnDel.dataset.id).catch(err => {
        console.error(err);
        alert(err.message || 'Error');
      });
      return;
    }

    // ✅ NUEVO: cancelar una notificación programada
    const btnDelProg = e.target.closest('button[data-act="del-prog"][data-id]');
    if (btnDelProg) {
      e.preventDefault();
      cancelarProgramada(btnDelProg.dataset.id).catch(err => {
        console.error(err);
        alert(err.message || 'Error');
      });
      return;
    }

    // ✅ NUEVO: click en un chip de "Enviar por"
    const chipCanal = e.target.closest('.noti-canal-opt[data-canal]');
    if (chipCanal) {
      e.preventDefault();
      setCanal(chipCanal.dataset.canal);
    }
  });

  // ✅ NUEVO: actualiza la vista previa a medida que se escribe
  document.addEventListener('input', (e) => {
    if (e.target?.id === 'pushTitulo' || e.target?.id === 'pushCuerpo') {
      updatePreview();
    }
  });

// ✅ init llamado desde club.js cuando carga la sección
  window.initNotificacionesSection = async () => {
    console.log('[notificaciones] init sección ✅');

    // ✅ NUEVO: el selector de canal solo se muestra si el club tiene el
    // add-on de WhatsApp contratado (window.currentClub lo carga club.js
    // desde GET /club/:clubId al entrar al panel).
    const wrap = $id('notificaciones-canal-wrap');
    if (wrap) {
      const habilitado = window.currentClub?.whatsapp_habilitado === true;
      wrap.style.display = habilitado ? 'block' : 'none';
      if (!habilitado && $id('notiCanal')) $id('notiCanal').value = 'app';
    }

    // ✅ NUEVO: chips de canal + vista previa en su estado inicial
    syncCanalChipsUI();
    updatePreview();

    // Catálogos para el selector de Destino (actividad/categoría/año)
    await Promise.all([loadActividades(), loadCategorias(), loadAniosNacimiento()]);
    renderDestinoExtra();

    // ✅ NUEVO: estado inicial de los campos de programación + carga de programadas
    actualizarVisibilidadProgramacion();
    await Promise.all([loadNotificaciones(), loadProgramadas()]);
  };

document.addEventListener('change', (e) => {
  // ✅ NUEVO
  if (e.target?.id === 'notiCuando' || e.target?.id === 'notiRepeticion') {
    actualizarVisibilidadProgramacion();
    return;
  }

  if (e.target?.id === 'notiDestinoTipo') {
    const tipo = e.target.value || 'todos';

    (async () => {
      if (tipo === 'actividad') await loadActividades();
      if (tipo === 'categoria') await loadCategorias();
      if (tipo === 'anio_nac') await loadAniosNacimiento();
      if (tipo === 'act_cat') await Promise.all([loadActividades(), loadCategorias()]);
      if (tipo === 'cat_anio') await Promise.all([loadCategorias(), loadAniosNacimiento()]);

      renderDestinoExtra();
    })();
  }
});

})();
