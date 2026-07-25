(() => {
  const $ = (id) => document.getElementById(id);

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
      throw new Error('No activeClubId');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const { json, ...rest } = options;
    const res = await fetch(url, { ...rest, headers });
    if (res.status === 401) {
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }
    return res;
  }

  async function safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, error: text }; }
  }

  // ===== Estado del modal =====
  let convocados = [];   // [{id, nombre, apellido, numero_socio, categoria}]
  let invitados = [];    // [{id, nombre, apellido, numero_socio, categoria}]

  function resetModal() {
    convocados = [];
    invitados = [];
    $('asistDatosMsg').textContent = '';
    $('asistGuardarMsg').textContent = '';
    $('asistenciaPasoSocios').style.display = 'none';
    $('asistenciaPasoDatos').style.display = 'block';
  }

  async function cargarSelects() {
    const clubId = getActiveClubId();

    const [rAct, rCat, rAdic] = await Promise.all([
      fetchAuth(`/club/${clubId}/config/actividades`).then(safeJson),
      fetchAuth(`/club/${clubId}/config/categorias`).then(safeJson),
      fetchAuth(`/club/${clubId}/config/actividades-adicionales`).then(safeJson)
    ]);

    const selAct = $('asistActividad');
    selAct.innerHTML = '<option value="">Seleccioná...</option>';
    (rAct.actividades || []).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.nombre;
      opt.textContent = a.nombre;
      selAct.appendChild(opt);
    });

    const selCat = $('asistCategoria');
    selCat.innerHTML = '<option value="">Seleccioná...</option>';
    (rCat.categorias || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.nombre;
      opt.textContent = c.nombre;
      selCat.appendChild(opt);
    });

    const selAdic = $('asistActividadAdicional');
    selAdic.innerHTML = '<option value="">Ninguna</option>';
    (rAdic.actividades || []).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.nombre;
      opt.textContent = a.nombre;
      selAdic.appendChild(opt);
    });
  }

  function abrirModal() {
    resetModal();
    $('modalAsistencia').classList.remove('hidden');
    cargarSelects().catch(e => {
      console.error(e);
      $('asistDatosMsg').textContent = 'No se pudieron cargar las listas de actividades/categorías.';
    });
  }

  function cerrarModal() {
    $('modalAsistencia').classList.add('hidden');
  }

  function getDatosEvento() {
    return {
      tipo: $('asistTipo').value,
      actividad: $('asistActividad').value,
      actividadAdicional: $('asistActividadAdicional').value || null,
      categoria: $('asistCategoria').value,
      fecha: $('asistFecha').value
    };
  }

  function renderConvocados() {
    const cont = $('asistListaConvocados');
    if (!convocados.length) {
      cont.innerHTML = '<div class="muted small">No hay socios que coincidan con esos filtros.</div>';
      return;
    }

    const filas = convocados.map(s => `
      <label style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #f0f0f0;">
        <input type="checkbox" class="asist-check-convocado" data-id="${s.id}" />
        <span>${s.apellido}, ${s.nombre} <span class="muted small">(#${s.numero_socio ?? '-'})</span></span>
      </label>
    `).join('');

    cont.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong class="small">Convocados (${convocados.length})</strong>
        <span>
          <button type="button" id="btnAsistTodos" class="navbtn navbtn--top" style="padding:4px 8px; font-size:12px;">Marcar todos</button>
          <button type="button" id="btnAsistNinguno" class="navbtn navbtn--top" style="padding:4px 8px; font-size:12px;">Ninguno</button>
        </span>
      </div>
      <div style="max-height:220px; overflow-y:auto;">${filas}</div>
    `;

    $('btnAsistTodos').addEventListener('click', () => {
      cont.querySelectorAll('.asist-check-convocado').forEach(cb => cb.checked = true);
    });
    $('btnAsistNinguno').addEventListener('click', () => {
      cont.querySelectorAll('.asist-check-convocado').forEach(cb => cb.checked = false);
    });
  }

  function renderInvitados() {
    const wrap = $('asistInvitadosWrap');

    const chips = invitados.map(s => `
      <span class="badge" style="background:#e5e7eb; margin:2px; display:inline-flex; align-items:center; gap:6px;">
        ${s.apellido}, ${s.nombre}
        <button type="button" class="asist-quitar-invitado" data-id="${s.id}" style="border:none; background:none; cursor:pointer; font-weight:bold;">✕</button>
      </span>
    `).join('');

    wrap.innerHTML = `
      <strong class="small">Invitados de otra categoría</strong>
      <div style="display:flex; gap:8px; margin:8px 0;">
        <input id="asistBuscarInvitado" type="text" placeholder="Buscar por nombre o DNI..." style="flex:1; padding:8px;" />
        <button type="button" id="btnAsistBuscarInvitado" class="navbtn navbtn--top">Buscar</button>
      </div>
      <div id="asistResultadosInvitado" class="muted small"></div>
      <div id="asistChipsInvitados" style="margin-top:8px;">${chips}</div>
    `;

    wrap.querySelectorAll('.asist-quitar-invitado').forEach(btn => {
      btn.addEventListener('click', () => {
        invitados = invitados.filter(s => String(s.id) !== String(btn.dataset.id));
        renderInvitados();
      });
    });

    $('btnAsistBuscarInvitado').addEventListener('click', buscarInvitado);
  }

  async function buscarInvitado() {
    const clubId = getActiveClubId();
    const q = $('asistBuscarInvitado').value.trim();
    const cont = $('asistResultadosInvitado');
    if (!q) { cont.textContent = ''; return; }

    cont.textContent = 'Buscando...';
    const res = await fetchAuth(`/club/${clubId}/socios?search=${encodeURIComponent(q)}&activo=1&limit=10`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      cont.textContent = 'Error al buscar socios.';
      return;
    }

    const yaConvocado = new Set(convocados.map(s => String(s.id)));
    const yaInvitado = new Set(invitados.map(s => String(s.id)));
    const resultados = (data.socios || []).filter(s => !yaConvocado.has(String(s.id)) && !yaInvitado.has(String(s.id)));

    if (!resultados.length) {
      cont.innerHTML = '<div class="muted small">Sin resultados.</div>';
      return;
    }

    cont.innerHTML = resultados.map(s => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0;">
        <span>${s.apellido}, ${s.nombre} <span class="muted small">(${s.categoria})</span></span>
        <button type="button" class="asist-agregar-invitado navbtn navbtn--top" data-id="${s.id}" style="padding:2px 8px; font-size:12px;">+ Agregar</button>
      </div>
    `).join('');

    cont.querySelectorAll('.asist-agregar-invitado').forEach(btn => {
      btn.addEventListener('click', () => {
        const socio = resultados.find(s => String(s.id) === btn.dataset.id);
        if (socio) invitados.push(socio);
        renderInvitados();
      });
    });
  }

  async function buscarConvocados() {
    const { tipo, actividad, categoria, fecha } = getDatosEvento();

    if (!tipo || !actividad || !categoria || !fecha) {
      $('asistDatosMsg').textContent = 'Completá Tipo, Actividad, Categoría y Fecha.';
      return;
    }
    $('asistDatosMsg').textContent = '';

    const clubId = getActiveClubId();
    const { actividadAdicional } = getDatosEvento();

    const params = new URLSearchParams({ actividad, categoria });
    if (actividadAdicional) params.set('actividadAdicional', actividadAdicional);

    const res = await fetchAuth(`/club/${clubId}/asistencia/socios-filtrados?${params.toString()}`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      $('asistDatosMsg').textContent = data.error || 'Error al buscar socios.';
      return;
    }

    convocados = data.socios || [];
    invitados = [];

    const { tipo: t2 } = getDatosEvento();
    $('asistResumenEvento').textContent =
      `${t2 === 'partido' ? 'Partido' : 'Entrenamiento'} · ${actividad}${actividadAdicional ? ' + ' + actividadAdicional : ''} · ${categoria} · ${fecha}`;

    renderConvocados();
    renderInvitados();

    $('asistenciaPasoDatos').style.display = 'none';
    $('asistenciaPasoSocios').style.display = 'block';
  }

  async function guardarAsistencia() {
    const { tipo, actividad, actividadAdicional, categoria, fecha } = getDatosEvento();
    const clubId = getActiveClubId();

    const checks = document.querySelectorAll('.asist-check-convocado');
    const convocadosPayload = Array.from(checks).map(cb => ({
      socioId: cb.dataset.id,
      presente: cb.checked
    }));

    const invitadosPayload = invitados.map(s => ({ socioId: s.id }));

    $('asistGuardarMsg').textContent = 'Guardando...';

    try {
      const res = await fetchAuth(`/club/${clubId}/asistencia`, {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          tipo, actividad, actividadAdicional, categoria, fecha,
          convocados: convocadosPayload,
          invitados: invitadosPayload
        })
      });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        $('asistGuardarMsg').textContent = data.error || 'Error al guardar.';
        return;
      }

      alert('✅ Asistencia guardada correctamente.');
      cerrarModal();
    } catch (e) {
      console.error(e);
      $('asistGuardarMsg').textContent = 'Error de conexión al guardar.';
    }
  }

  // ===== Bind de botones (una sola vez) =====
  document.addEventListener('DOMContentLoaded', () => {
    $('btnAsistencia')?.addEventListener('click', abrirModal);
    $('btnAsistCancelarDatos')?.addEventListener('click', cerrarModal);
    $('btnAsistBuscarSocios')?.addEventListener('click', () => buscarConvocados().catch(e => {
      console.error(e);
      $('asistDatosMsg').textContent = 'Error de conexión.';
    }));
    $('btnAsistVolverDatos')?.addEventListener('click', () => {
      $('asistenciaPasoSocios').style.display = 'none';
      $('asistenciaPasoDatos').style.display = 'block';
    });
    $('btnAsistGuardar')?.addEventListener('click', () => guardarAsistencia());

    $('modalAsistencia')?.addEventListener('click', (ev) => {
      if (ev.target.id === 'modalAsistencia') cerrarModal();
    });
  });
})();