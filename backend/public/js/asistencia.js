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

  // ✅ NUEVO: categorías/años adicionales para ampliar la búsqueda de convocados
  let categoriasAdicionalesSeleccionadas = new Set();
  let aniosAdicionalesSeleccionados = []; // array de strings, en orden de agregado

  // ✅ NUEVO: texto de filtro para acotar la lista de convocados sin
  // volver a pegarle al servidor (filtra el array ya traído).
  let filtroConvocadosTexto = '';

  function resetModal() {
    convocados = [];
    invitados = [];
    filtroConvocadosTexto = '';
    $('asistDatosMsg').textContent = '';
    $('asistGuardarMsg').textContent = '';
    $('asistAnioNacimiento').value = '';
    if ($('asistBuscarConvocado')) $('asistBuscarConvocado').value = '';

    // ✅ NUEVO: resetear categorías/años adicionales (ahora en el formulario principal)
    categoriasAdicionalesSeleccionadas = new Set();
    aniosAdicionalesSeleccionados = [];
    if ($('asistAnioAdicionalInput')) $('asistAnioAdicionalInput').value = '';
    renderAniosAdicionalesChips();

    mostrarPaso(1);
  }

  // ✅ NUEVO: alterna entre el paso 1 (datos) y el paso 2 (convocados),
  // moviendo en un solo lugar los paneles, los pies de página con sus
  // botones y el resaltado de los "pills" del stepper de arriba.
  function mostrarPaso(paso) {
    const esPaso2 = paso === 2;

    $('asistenciaPasoSocios').style.display = esPaso2 ? 'block' : 'none';
    $('asistenciaPasoDatos').style.display = esPaso2 ? 'none' : 'block';
    $('asistFooterSocios').style.display = esPaso2 ? 'flex' : 'none';
    $('asistFooterDatos').style.display = esPaso2 ? 'none' : 'flex';

    $('asistStepPill1')?.classList.toggle('active', !esPaso2);
    $('asistStepPill2')?.classList.toggle('active', esPaso2);

    const subtitle = $('asistPasoSubtitle');
    if (subtitle) {
      subtitle.textContent = esPaso2
        ? 'Marcá quién estuvo presente'
        : 'Completá los datos del entrenamiento o partido';
    }
  }

  // ✅ NUEVO: iniciales para el avatar circular de cada fila
  function iniciales(nombre, apellido) {
    const a = (apellido || '').trim().charAt(0);
    const n = (nombre || '').trim().charAt(0);
    return (a + n).toUpperCase() || '?';
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

    // ✅ NUEVO: chips seleccionables de categorías adicionales (mismo catálogo
    // que la categoría principal), para poder tocar más de una a la hora de
    // buscar convocados. Se re-generan cada vez que se abre el modal, así que
    // arrancan siempre "sin tocar" (todas deseleccionadas).
    categoriasAdicionalesSeleccionadas = new Set();
    renderCategoriasAdicionalesChips(rCat.categorias || []);
  }

  // ✅ NUEVO: dibuja los chips de categorías adicionales y bindea el toggle
  // (tocar un chip lo prende/apaga, como un filtro).
  function renderCategoriasAdicionalesChips(categoriasList) {
    const wrap = $('asistCategoriasAdicionalesWrap');
    if (!wrap) return;

    if (!categoriasList.length) {
      wrap.innerHTML = '<span class="muted small">No hay categorías configuradas.</span>';
      return;
    }

    wrap.innerHTML = categoriasList.map(c => {
      const seleccionada = categoriasAdicionalesSeleccionadas.has(c.nombre);
      return `
        <button type="button" class="asist-chip-cat-adicional" data-value="${c.nombre}"
          style="padding:6px 12px; border-radius:999px; font-size:13px; cursor:pointer;
                 border:1px solid ${seleccionada ? 'var(--color-primary,#2563eb)' : '#d1d5db'};
                 background:${seleccionada ? 'var(--color-primary,#2563eb)' : '#fff'};
                 color:${seleccionada ? '#fff' : '#374151'};
                 transition:all .12s ease;">
          ${seleccionada ? '✓ ' : ''}${c.nombre}
        </button>
      `;
    }).join('');

    wrap.querySelectorAll('.asist-chip-cat-adicional').forEach(btn => {
      btn.addEventListener('click', () => {
        const valor = btn.dataset.value;
        if (categoriasAdicionalesSeleccionadas.has(valor)) {
          categoriasAdicionalesSeleccionadas.delete(valor);
        } else {
          categoriasAdicionalesSeleccionadas.add(valor);
        }
        renderCategoriasAdicionalesChips(categoriasList);
      });
    });
  }

  // ✅ NUEVO: agrega un año a la lista de "años adicionales" desde el input
  function agregarAnioAdicional() {
    const input = $('asistAnioAdicionalInput');
    if (!input) return;
    const valor = String(input.value || '').trim();

    if (!valor) return;
    if (!/^\d{4}$/.test(valor)) {
      $('asistDatosMsg').textContent = 'El año adicional debe tener 4 dígitos (ej: 2011).';
      return;
    }
    $('asistDatosMsg').textContent = '';

    if (!aniosAdicionalesSeleccionados.includes(valor)) {
      aniosAdicionalesSeleccionados.push(valor);
      renderAniosAdicionalesChips();
    }
    input.value = '';
    input.focus();
  }

  // ✅ NUEVO: dibuja los chips (removibles con ✕) de años adicionales agregados
  function renderAniosAdicionalesChips() {
    const wrap = $('asistAniosAdicionalesChips');
    if (!wrap) return;

    wrap.innerHTML = aniosAdicionalesSeleccionados.map(anio => `
      <span style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
                    border-radius:999px; background:var(--color-primary,#2563eb); color:#fff; font-size:13px;">
        ${anio}
        <button type="button" class="asist-quitar-anio-adicional" data-value="${anio}"
                style="border:none; background:none; color:#fff; cursor:pointer; font-weight:bold; line-height:1; padding:0;">✕</button>
      </span>
    `).join('');

    wrap.querySelectorAll('.asist-quitar-anio-adicional').forEach(btn => {
      btn.addEventListener('click', () => {
        aniosAdicionalesSeleccionados = aniosAdicionalesSeleccionados.filter(a => a !== btn.dataset.value);
        renderAniosAdicionalesChips();
      });
    });
  }

  // ✅ NUEVO: categorías adicionales tildadas para ampliar la búsqueda
  function getCategoriasAdicionalesSeleccionadas() {
    return Array.from(categoriasAdicionalesSeleccionadas);
  }

  // ✅ NUEVO: años adicionales agregados para ampliar la búsqueda
  function getAniosAdicionales() {
    return [...aniosAdicionalesSeleccionados];
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
      fecha: $('asistFecha').value,
      anioNacimiento: $('asistAnioNacimiento').value || null
    };
  }

  // ✅ NUEVO: aplica el texto del buscador (nombre, apellido o N° de socio)
  // sobre el array ya traído del servidor, sin volver a pedir nada.
  function convocadosFiltrados() {
    const q = filtroConvocadosTexto.trim().toLowerCase();
    if (!q) return convocados;
    return convocados.filter(s => {
      const texto = `${s.apellido || ''} ${s.nombre || ''} ${s.numero_socio ?? ''}`.toLowerCase();
      return texto.includes(q);
    });
  }

  function renderConvocados() {
    const cont = $('asistListaConvocados');

    if (!convocados.length) {
      cont.innerHTML = '<div class="asist2-empty">No hay socios que coincidan con esos filtros.</div>';
      actualizarContadorConvocados();
      return;
    }

    const visibles = convocadosFiltrados();

    if (!visibles.length) {
      cont.innerHTML = '<div class="asist2-empty">Ningún convocado coincide con esa búsqueda.</div>';
      actualizarContadorConvocados();
      return;
    }

    const filas = visibles.map(s => `
      <label class="asist2-row" data-id="${s.id}">
        <input type="checkbox" class="asist-check-convocado" data-id="${s.id}" />
        <span class="asist2-avatar">${iniciales(s.nombre, s.apellido)}</span>
        <span>
          <div class="asist2-row-name">${s.apellido}, ${s.nombre}</div>
          <div class="asist2-row-meta">N° ${s.numero_socio ?? '-'}${s.categoria ? ' · ' + s.categoria : ''}</div>
        </span>
      </label>
    `).join('');

    cont.innerHTML = `<div class="asist2-lista">${filas}</div>`;

    cont.querySelectorAll('.asist-check-convocado').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('.asist2-row')?.classList.toggle('is-checked', cb.checked);
        actualizarContadorConvocados();
      });
    });

    actualizarContadorConvocados();
  }

  // ✅ NUEVO: "X de Y presentes" — cuenta sobre TODOS los convocados
  // (no solo los que quedaron visibles tras el filtro de texto), para que
  // el número no "baje" al filtrar.
  function actualizarContadorConvocados() {
    const badge = $('asistContadorConvocados');
    if (!badge) return;
    const checks = document.querySelectorAll('.asist-check-convocado');
    const marcados = Array.from(checks).filter(cb => cb.checked).length;
    badge.textContent = `${marcados} de ${convocados.length} presentes`;
  }

  function renderInvitados() {
    const wrap = $('asistInvitadosWrap');

    const chips = invitados.map(s => `
      <span class="asist2-chip-invitado">
        ${s.apellido}, ${s.nombre}
        <button type="button" class="asist-quitar-invitado" data-id="${s.id}">✕</button>
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
    const { actividadAdicional, anioNacimiento } = getDatosEvento();

    // ✅ NUEVO: categorías/años adicionales tildados, para ampliar la búsqueda
    // (no cambian la categoría/año "principal" del evento).
    const categoriasAdicionales = getCategoriasAdicionalesSeleccionadas();
    const aniosAdicionales = getAniosAdicionales();

    const params = new URLSearchParams({ actividad, categoria });
    if (actividadAdicional) params.set('actividadAdicional', actividadAdicional);
    if (anioNacimiento) params.set('anioNacimiento', anioNacimiento);
    if (categoriasAdicionales.length) params.set('categoriasAdicionales', categoriasAdicionales.join(','));
    if (aniosAdicionales.length) params.set('aniosAdicionales', aniosAdicionales.join(','));

    const res = await fetchAuth(`/club/${clubId}/asistencia/socios-filtrados?${params.toString()}`);
    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      $('asistDatosMsg').textContent = data.error || 'Error al buscar socios.';
      return;
    }

    convocados = data.socios || [];
    invitados = [];

    const { tipo: t2 } = getDatosEvento();

    const extraTxt = [
      categoriasAdicionales.length ? `+ ${categoriasAdicionales.join(', ')}` : '',
      aniosAdicionales.length ? `+ años ${aniosAdicionales.join(', ')}` : ''
    ].filter(Boolean).join(' · ');

    $('asistResumenEvento').textContent =
      `${t2 === 'partido' ? 'Partido' : 'Entrenamiento'} · ${actividad}${actividadAdicional ? ' + ' + actividadAdicional : ''} · ${categoria}${extraTxt ? ' (' + extraTxt + ')' : ''}${anioNacimiento ? ' · Nacidos en ' + anioNacimiento : ''} · ${fecha}`;

    filtroConvocadosTexto = '';
    if ($('asistBuscarConvocado')) $('asistBuscarConvocado').value = '';

    renderConvocados();
    renderInvitados();

    mostrarPaso(2);
  }

  async function guardarAsistencia() {
    const { tipo, actividad, actividadAdicional, categoria, fecha, anioNacimiento } = getDatosEvento();
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
          tipo, actividad, actividadAdicional, categoria, fecha, anioNacimiento,
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
    $('btnAsistVolverDatos')?.addEventListener('click', () => mostrarPaso(1));
    $('btnAsistGuardar')?.addEventListener('click', () => guardarAsistencia());

    // ✅ NUEVO: buscador de convocados (filtra sin refetch) y los botones
    // "Marcar todos" / "Ninguno", ahora fijos en el HTML del paso 2.
    $('asistBuscarConvocado')?.addEventListener('input', (ev) => {
      filtroConvocadosTexto = ev.target.value || '';
      renderConvocados();
    });
    $('btnAsistTodos')?.addEventListener('click', () => {
      document.querySelectorAll('.asist-check-convocado').forEach(cb => {
        cb.checked = true;
        cb.closest('.asist2-row')?.classList.add('is-checked');
      });
      actualizarContadorConvocados();
    });
    $('btnAsistNinguno')?.addEventListener('click', () => {
      document.querySelectorAll('.asist-check-convocado').forEach(cb => {
        cb.checked = false;
        cb.closest('.asist2-row')?.classList.remove('is-checked');
      });
      actualizarContadorConvocados();
    });

    // ✅ NUEVO: acceso directo al reporte de asistencia desde el modal.
    $('btnAsistVerReporte')?.addEventListener('click', () => {
      cerrarModal();
      window.irAReporteAsistencia?.();
    });

    // ✅ NUEVO: agregar año adicional (categorías adicionales se bindean solas
    // como chips cada vez que se dibujan, en renderCategoriasAdicionalesChips)
    $('btnAsistAgregarAnioAdicional')?.addEventListener('click', agregarAnioAdicional);
    $('asistAnioAdicionalInput')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        agregarAnioAdicional();
      }
    });

    $('modalAsistencia')?.addEventListener('click', (ev) => {
      if (ev.target.id === 'modalAsistencia') cerrarModal();
    });
  });
})();