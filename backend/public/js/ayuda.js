/* =========================================================
   AYUDA — botón flotante ❓ + panel lateral + asistente
   "Configuración inicial" (wizard paso a paso).
   Autocontenido: no depende de configuracion.js (usa sus
   mismas APIs /club/:clubId/config/...). El avance se guarda
   por club en /club/:clubId/ayuda/progreso/:guia (y, si la
   tabla todavía no existe, en el navegador).
========================================================= */
(function () {
  'use strict';
  if (window.__ayudaInit) return;
  window.__ayudaInit = true;

  const GUIA = 'config_inicial';

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n ?? 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
  const clubId = () => localStorage.getItem('activeClubId');

  async function api(path, opts = {}) {
    const token = localStorage.getItem('token');
    const headers = { Authorization: 'Bearer ' + token };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/club/${clubId()}${path}`, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (res.status === 401) {
      localStorage.removeItem('token'); localStorage.removeItem('activeClubId');
      window.location.href = '/admin.html';
      throw new Error('Sesión expirada');
    }
    let data;
    try { data = JSON.parse(await res.text()); } catch { data = { ok: false, error: 'Respuesta inválida del servidor' }; }
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Error de servidor');
    return data;
  }

  /* ---------- definición de pasos ---------- */
  const MOD_OPTS = [['mensual', 'Mensual (una cuota por mes)'], ['por_clases', 'Por paquete de clases']];

  const STEPS = [
    { key: 'bienvenida', type: 'intro', icon: '👋', title: '¡Vamos a configurar tu club!' },
    {
      key: 'actividades', type: 'list', icon: '🏋️', title: 'Tus actividades y su precio',
      endpoint: '/config/actividades', listKey: 'actividades', required: true,
      why: 'Una <b>actividad</b> es lo que practican tus socios: Fútbol, Hockey, Natación… Cada socio se inscribe en una y el <b>precio</b> que cargues acá es la cuota que se le cobra.',
      noun: 'actividad',
      fields: [
        { k: 'nombre', label: 'Nombre de la actividad', ph: 'Ej: Fútbol infantil', req: true },
        { k: 'precio_mensual', label: 'Precio de la cuota ($)', type: 'number', ph: 'Ej: 18000', req: true },
        { k: 'modalidad_pago', label: '¿Cómo la paga el socio?', type: 'select', opts: MOD_OPTS, hint: '“Mensual”: una cuota por mes. “Por paquete de clases”: paga por un paquete de clases en lugar de por mes.' }
      ],
      hide: (it) => String(it.nombre).trim() === 'Grupo Familiar',
      sub: (it) => `${money(it.precio_mensual)} · ${it.modalidad_pago === 'por_clases' ? 'por paquete de clases' : 'mensual'}`
    },
    {
      key: 'excepciones', type: 'list', gate: true, icon: '⚠️', title: 'Excepciones de cuota',
      endpoint: '/config/excepciones-cuota', listKey: 'excepciones', noun: 'excepción',
      question: '¿Hay socios que pagan una cuota distinta a la de su actividad?',
      why: 'Una <b>excepción</b> es una cuota con <b>monto fijo</b> que no depende de la actividad. Sirve, por ejemplo, para socios con descuento, hermanos, jugadores del plantel o socios adherentes. Después, al cargar un socio, tildás “Usar excepción de cuota” y elegís cuál le corresponde.',
      suggestions: ['Cuota hermanos', 'Beca 50%', 'Socio adherente'],
      fields: [
        { k: 'nombre', label: 'Nombre de la excepción', ph: 'Ej: Cuota hermanos', req: true },
        { k: 'monto', label: 'Monto fijo de la cuota ($)', type: 'number', ph: 'Ej: 12000', req: true }
      ],
      sub: (it) => money(it.monto)
    },
    {
      key: 'adicionales', type: 'list', gate: true, icon: '➕', title: 'Actividades adicionales',
      endpoint: '/config/actividades-adicionales', listKey: 'actividades', noun: 'actividad adicional',
      question: '¿Tus socios pueden sumar actividades extra con un precio aparte?',
      why: 'Una <b>actividad adicional</b> se suma a la actividad principal del socio y se cobra <b>además</b> de su cuota. Ejemplo: un socio de Fútbol que también hace Natación. Al cargar el socio tildás “Tiene actividades adicionales” y elegís cuáles.',
      fields: [
        { k: 'nombre', label: 'Nombre de la actividad adicional', ph: 'Ej: Natación', req: true },
        { k: 'precio_mensual', label: 'Precio ($)', type: 'number', ph: 'Ej: 8000', req: true },
        { k: 'modalidad_pago', label: '¿Cómo se paga?', type: 'select', opts: MOD_OPTS }
      ],
      sub: (it) => `${money(it.precio_mensual)} · ${it.modalidad_pago === 'por_clases' ? 'por paquete de clases' : 'mensual'}`
    },
    { key: 'grupo_familiar', type: 'familiar', icon: '👨‍👩‍👧', title: 'Plan Grupo Familiar' },
    {
      key: 'cuentas', type: 'list', icon: '💼', title: 'Cuentas de cobro y pago',
      endpoint: '/config/responsables', listKey: 'responsables', noun: 'cuenta',
      why: 'Las <b>cuentas</b> indican por dónde se mueve la plata: Caja efectivo, Banco, Mercado Pago, Tesorería… Cuando registrás un ingreso o un gasto elegís la cuenta, y en <b>Reportes</b> ves cuánto movió cada una.',
      suggestions: ['Caja efectivo', 'Banco', 'Mercado Pago', 'Tesorería'],
      fields: [{ k: 'nombre', label: 'Nombre de la cuenta', ph: 'Ej: Banco Santander', req: true }]
    },
    {
      key: 'tipos_ingreso', type: 'list', icon: '💵', title: 'Tipos de ingreso',
      endpoint: '/config/tipos-ingreso', listKey: 'tipos', noun: 'tipo de ingreso',
      why: 'Además de las cuotas, el club recibe otros ingresos: inscripciones, sponsors, alquileres, eventos. Un <b>tipo de ingreso</b> ordena esos movimientos y los reportes los agrupan. El monto es <b>opcional</b>: si lo cargás, se autocompleta al registrar el ingreso.',
      suggestions: ['Inscripción', 'Sponsor', 'Alquiler de cancha', 'Evento', 'Rifa'],
      fields: [
        { k: 'nombre', label: 'Nombre del tipo de ingreso', ph: 'Ej: Sponsor', req: true },
        { k: 'monto', label: 'Monto habitual (opcional)', type: 'number', ph: 'Ej: 50000' }
      ],
      sub: (it) => (it.monto != null && it.monto !== '') ? `Monto habitual ${money(it.monto)}` : 'Sin monto fijo'
    },
    {
      key: 'tipos_gasto', type: 'list', icon: '🧾', title: 'Tipos de gasto',
      endpoint: '/config/tipos-gasto', listKey: 'tipos', noun: 'tipo de gasto',
      why: 'Igual que con los ingresos, un <b>tipo de gasto</b> ordena en qué se va la plata del club (alquiler, arbitraje, materiales…) y permite ver los gastos agrupados en <b>Reportes</b>. El monto también es opcional.',
      suggestions: ['Alquiler', 'Servicios', 'Arbitraje', 'Material deportivo', 'Honorarios', 'Mantenimiento'],
      fields: [
        { k: 'nombre', label: 'Nombre del tipo de gasto', ph: 'Ej: Arbitraje', req: true },
        { k: 'monto', label: 'Monto habitual (opcional)', type: 'number', ph: 'Ej: 25000' }
      ],
      sub: (it) => (it.monto != null && it.monto !== '') ? `Monto habitual ${money(it.monto)}` : 'Sin monto fijo'
    },
    { key: 'fin', type: 'fin', icon: '🎉', title: '¡Listo! Tu club está configurado' }
  ];
  const WORK_STEPS = STEPS.filter((s) => s.type !== 'intro' && s.type !== 'fin');

  /* ---------- estado ---------- */
  const S = {
    open: false, view: 'home', idx: 0,
    prog: { paso_actual: null, pasos: {}, respuestas: {}, completado: false },
    loadedFor: null, items: [], flash: null, busy: false, gf: null
  };
  let fab, panel, nudge;

  /* ---------- progreso (servidor con respaldo local) ---------- */
  const lsKey = () => `ayuda_${clubId()}_${GUIA}`;
  async function loadProg() {
    if (S.loadedFor === clubId()) return;
    let p = null;
    try { p = (await api(`/ayuda/progreso/${GUIA}`)).progreso; }
    catch { try { p = JSON.parse(localStorage.getItem(lsKey()) || 'null'); } catch { p = null; } }
    S.prog = { paso_actual: p?.paso_actual || null, pasos: p?.pasos || {}, respuestas: p?.respuestas || {}, completado: !!p?.completado };
    S.loadedFor = clubId();
    updateFab();
  }
  async function saveProg() {
    const body = { paso_actual: S.prog.paso_actual, pasos: S.prog.pasos, respuestas: S.prog.respuestas, completado: S.prog.completado };
    try { await api(`/ayuda/progreso/${GUIA}`, { method: 'PUT', body }); }
    catch { try { localStorage.setItem(lsKey(), JSON.stringify(body)); } catch {} }
    updateFab();
  }
  const doneCount = () => WORK_STEPS.filter((s) => S.prog.pasos[s.key]).length;

  /* ---------- UI base ---------- */
  function build() {
    fab = document.createElement('button');
    fab.id = 'ayudaFab'; fab.type = 'button'; fab.title = 'Ayuda'; fab.setAttribute('aria-label', 'Abrir ayuda');
    fab.innerHTML = '?<span class="ay-dot"></span>';
    fab.addEventListener('click', () => (S.open ? close() : openHome()));
    nudge = document.createElement('div'); nudge.id = 'ayudaNudge';
    panel = document.createElement('aside'); panel.id = 'ayudaPanel'; panel.setAttribute('aria-label', 'Centro de ayuda');
    document.body.append(nudge, fab, panel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) close(); });
    panel.addEventListener('click', onClick);
    panel.addEventListener('submit', onSubmit);
  }
  function updateFab() {
    if (!fab) return;
    const pend = !S.prog.completado;
    fab.classList.toggle('pending', pend);
    fab.classList.toggle('pulse', pend && !S.open && doneCount() === 0);
  }
  function close() { S.open = false; panel.classList.remove('open'); updateFab(); }
  async function openHome() { await open('home'); }
  async function open(view) {
    S.open = true; hideNudge();
    await loadProg();
    S.view = view; S.flash = null;
    panel.classList.add('open'); render();
  }
  function hideNudge() { nudge.classList.remove('show'); try { sessionStorage.setItem('ayudaNudge', '1'); } catch {} }

  /* ---------- render ---------- */
  function head(title, back) {
    return `<div class="ay-head">${back ? `<button data-a="home" title="Volver" aria-label="Volver">←</button>` : ''}<h3>${esc(title)}</h3><button data-a="close" title="Cerrar" aria-label="Cerrar">✕</button></div>`;
  }
  function render() {
    if (S.view === 'home') return renderHome();
    return renderStep();
  }

  const QUICK = [
    ['👤', 'Cargar mis socios', 'Alta y edición de socios', 'socios'],
    ['💰', 'Registrar un cobro', 'Cuotas y otros ingresos', 'pagos'],
    ['📊', 'Ver reportes', 'Ingresos, gastos y más', 'reportes'],
    ['⚙️', 'Abrir Configuración', 'Todo lo que cargaste, en detalle', 'configuracion']
  ];
  function renderHome() {
    const n = doneCount(), tot = WORK_STEPS.length, pct = Math.round((n / tot) * 100);
    const label = S.prog.completado ? 'Repasar' : (n > 0 || S.prog.paso_actual ? 'Continuar' : 'Empezar');
    panel.innerHTML = `${head('Centro de ayuda')}
      <div class="ay-body">
        <p style="margin:0 0 14px;line-height:1.45">Hola 👋 Te acompaño para dejar tu club listo, paso a paso. Vas cargando todo acá mismo y yo te explico para qué sirve cada cosa.</p>
        <button class="ay-guide" data-a="start">
          <div class="ay-kicker">Guía</div>
          <div class="gt">🚀 Configuración inicial</div>
          <div style="font-size:13px;color:var(--t-muted,#6b7280)">Actividades y precios, excepciones, adicionales, grupo familiar, cuentas, tipos de ingreso y de gasto.</div>
          <div class="ay-bar"><i style="width:${pct}%"></i></div>
          <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--t-muted,#6b7280)">${S.prog.completado ? '✅ Completada' : `${n} de ${tot} pasos`}</span><span class="ay-btn primary">${label} →</span></div>
        </button>
        <div class="ay-kicker" style="margin:18px 0 8px">Ir directo a…</div>
        ${QUICK.map(([e, t, d, s]) => `<button class="ay-link" data-a="go" data-s="${s}"><span class="e">${e}</span><span class="tx"><b>${esc(t)}</b><span>${esc(d)}</span></span><span>›</span></button>`).join('')}
        <p style="font-size:12px;color:var(--t-muted,#6b7280);margin-top:14px">Próximamente: guías paso a paso para cargar socios, cobrar cuotas y tomar asistencia.</p>
      </div>`;
  }

  function stepper() {
    return `<div class="ay-steps">${STEPS.map((s, i) => `<i class="${S.prog.pasos[s.key] || i < S.idx ? 'done' : ''} ${i === S.idx ? 'cur' : ''}"></i>`).join('')}</div>`;
  }
  function flashHtml() { return S.flash ? `<div class="ay-flash ${S.flash.t}">${esc(S.flash.m)}</div>` : ''; }
  function setFlash(m, t = 'ok') { S.flash = { m, t }; }

  async function renderStep() {
    const st = STEPS[S.idx];
    S.prog.paso_actual = st.key;
    const kick = `<div class="ay-kicker">Paso ${S.idx + 1} de ${STEPS.length}</div>`;
    let body = '', foot = '';
    const back = S.idx > 0 ? `<button class="ay-btn ghost" data-a="prev">← Atrás</button>` : '<span></span>';

    if (st.type === 'intro') {
      body = `<div class="ay-title">${st.icon} ${esc(st.title)}</div>
        <p style="line-height:1.55">En unos minutos vas a dejar cargado lo básico para empezar a trabajar:</p>
        <ul style="line-height:1.8;padding-left:20px">
          <li>Tus <b>actividades</b> y lo que cuesta cada una</li>
          <li>Si hay <b>excepciones</b> de cuota, actividades <b>adicionales</b> o <b>plan familiar</b></li>
          <li>Tus <b>cuentas</b> y los tipos de <b>ingreso</b> y <b>gasto</b></li>
        </ul>
        <div class="ay-why"><b class="t">💡 Tené en cuenta</b>Todo lo que cargues se guarda al instante y lo podés cambiar después desde <b>Configuración</b>. Si no sabés algo, podés saltar el paso y volver más tarde.</div>`;
      foot = `${back}<span class="ay-sp"></span><button class="ay-btn primary" data-a="next">Empezar →</button>`;
    } else if (st.type === 'fin') {
      body = await finHtml();
      foot = `${back}<span class="ay-sp"></span><button class="ay-btn primary" data-a="home">Cerrar guía</button>`;
    } else if (st.type === 'familiar') {
      body = await familiarHtml(st);
      foot = footNav(back, st, !!S.gf || S.prog.respuestas[st.key] === 'no');
    } else {
      body = await listHtml(st);
      const ok = !st.required || S.items.length > 0;
      foot = footNav(back, st, ok);
    }

    panel.innerHTML = `${head(`${STEPS[S.idx].icon} Configuración inicial`, true)}<div class="ay-body">${kick}${stepper()}${flashHtml()}${body}</div><div class="ay-foot">${foot}</div>`;
    const hadFlash = S.flash && S.flash.t === 'ok';
    S.flash = null;
    if (hadFlash) { const i = panel.querySelector('form[data-form="1"] input'); if (i) i.focus(); }
    const bd = panel.querySelector('.ay-body'); if (bd && hadFlash) bd.scrollTop = 0;
  }
  function footNav(back, st, canNext) {
    return `${back}<span class="ay-sp"></span>${st.required ? '' : `<button class="ay-btn ghost" data-a="skip">Saltar</button>`}<button class="ay-btn primary" data-a="next" ${canNext ? '' : 'disabled'}>Siguiente →</button>`;
  }

  async function fetchItems(st) {
    try {
      const d = await api(st.endpoint);
      let arr = d[st.listKey] || [];
      if (st.hide) arr = arr.filter((x) => !st.hide(x));
      return arr;
    } catch (e) { setFlash(e.message, 'err'); return []; }
  }

  function fieldHtml(f) {
    const id = `ayf_${f.k}`;
    let inp;
    if (f.type === 'select') inp = `<select id="${id}" name="${f.k}">${f.opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`;
    else inp = `<input id="${id}" name="${f.k}" type="${f.type === 'number' ? 'number' : 'text'}" ${f.type === 'number' ? 'min="0" step="0.01" inputmode="decimal"' : 'maxlength="80"'} placeholder="${esc(f.ph || '')}" ${f.req ? 'required' : ''} autocomplete="off">`;
    return `<div class="ay-field"><label for="${id}">${esc(f.label)}${f.req ? ' *' : ''}</label>${inp}${f.hint ? `<div class="ay-hint">${esc(f.hint)}</div>` : ''}</div>`;
  }
  function formHtml(st) {
    const sug = st.suggestions ? `<div class="ay-kicker" style="margin-bottom:6px">Ideas (tocá para completar)</div><div class="ay-chips">${st.suggestions.map((x) => `<button type="button" class="ay-chip" data-a="sug" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : '';
    return `${sug}<form class="ay-card" data-form="1"><h4>➕ Agregar ${esc(st.noun)}</h4>${st.fields.map(fieldHtml).join('')}<button class="ay-btn primary" type="submit" ${S.busy ? 'disabled' : ''}>Agregar ${esc(st.noun)}</button></form>`;
  }
  function itemsHtml(st) {
    if (!S.items.length) return `<div class="ay-empty">Todavía no cargaste ninguna.</div>`;
    return `<ul class="ay-list">${S.items.map((it) => `<li><span class="n">${esc(it.nombre)}${st.sub ? `<div class="s">${esc(st.sub(it))}</div>` : ''}</span><button data-a="del" data-id="${esc(it.id)}" title="Eliminar" aria-label="Eliminar ${esc(it.nombre)}">🗑️</button></li>`).join('')}</ul>`;
  }

  async function listHtml(st) {
    S.items = await fetchItems(st);
    const why = `<details class="ay-why" ${S.items.length ? '' : 'open'}><summary><b>💡 ¿Para qué sirve?</b></summary><div style="margin-top:6px">${st.why}</div></details>`;
    const title = `<div class="ay-title">${st.icon} ${esc(st.title)}</div>`;
    if (st.gate) {
      let ans = S.prog.respuestas[st.key];
      if (!ans && S.items.length) ans = 'si';
      if (!ans) {
        return `${title}${why}<div class="ay-title" style="font-size:17px">${esc(st.question)}</div><div class="ay-q"><button class="ay-btn big primary" data-a="ans" data-v="si">Sí, cargar</button><button class="ay-btn big" data-a="ans" data-v="no">No</button></div>`;
      }
      S.prog.respuestas[st.key] = ans;
      if (ans === 'no') return `${title}${why}<div class="ay-flash ok">Perfecto, sin ${esc(st.noun)}s por ahora. Podés cargarlas más adelante desde Configuración.</div><button class="ay-btn" data-a="ans" data-v="si">Cambié de idea: quiero cargar</button>`;
    }
    const lead = st.required && !S.items.length ? `<p style="margin:0 0 10px">Empecemos: cargá tu primera ${esc(st.noun)}.</p>` : '';
    const loaded = S.items.length ? `<div class="ay-kicker" style="margin-bottom:8px">Ya cargadas (${S.items.length})</div>${itemsHtml(st)}<div style="height:8px"></div>` : '';
    return `${title}${why}${lead}${loaded}${formHtml(st)}${st.required && !S.items.length ? '<div class="ay-hint" style="font-size:12px;color:var(--t-muted,#6b7280)">Cargá al menos una para seguir.</div>' : ''}`;
  }

  async function familiarHtml(st) {
    let acts = [];
    try { acts = (await api('/config/actividades')).actividades || []; } catch (e) { setFlash(e.message, 'err'); }
    S.gf = acts.find((a) => String(a.nombre).trim() === 'Grupo Familiar') || null;
    const title = `<div class="ay-title">${st.icon} ${esc(st.title)}</div>`;
    const why = `<details class="ay-why" open><summary><b>💡 ¿Para qué sirve?</b></summary><div style="margin-top:6px">Con el <b>Grupo Familiar</b>, un/a jefe/a de familia paga <b>una sola cuota por todo el grupo</b>. Al activarlo, el sistema crea la actividad “Grupo Familiar”; después, en la ficha del socio, tildás “Jefe/a Plan Familiar” y elegís los integrantes.</div></details>`;
    if (S.gf) {
      return `${title}${why}<div class="ay-flash ok">✅ El Grupo Familiar está activo.</div>
        <form class="ay-card" data-form="gf"><h4>Precio de la cuota familiar</h4>
          <div class="ay-field"><label for="ayf_gf">Precio ($) *</label><input id="ayf_gf" name="precio" type="number" min="0" step="0.01" value="${esc(S.gf.precio_mensual ?? 0)}" required></div>
          <button class="ay-btn primary" type="submit">Guardar precio</button></form>`;
    }
    const ans = S.prog.respuestas[st.key];
    if (ans === 'no') return `${title}${why}<div class="ay-flash ok">Listo, sin plan familiar por ahora. Lo podés activar cuando quieras desde Configuración.</div><button class="ay-btn" data-a="gfyes">Cambié de idea: activarlo</button>`;
    return `${title}${why}<div class="ay-title" style="font-size:17px">¿Tu club ofrece un plan familiar?</div><div class="ay-q"><button class="ay-btn big primary" data-a="gfyes">Sí, activarlo</button><button class="ay-btn big" data-a="ans" data-v="no">No</button></div>`;
  }

  async function finHtml() {
    S.prog.completado = true; S.prog.pasos.fin = 'hecho'; S.prog.paso_actual = 'fin'; saveProg();
    const get = async (p, k) => { try { return (await api(p))[k] || []; } catch { return []; } };
    const [acts, exc, adi, resp, ti, tg] = await Promise.all([
      get('/config/actividades', 'actividades'), get('/config/excepciones-cuota', 'excepciones'), get('/config/actividades-adicionales', 'actividades'),
      get('/config/responsables', 'responsables'), get('/config/tipos-ingreso', 'tipos'), get('/config/tipos-gasto', 'tipos')
    ]);
    const gf = acts.some((a) => String(a.nombre).trim() === 'Grupo Familiar');
    const cell = (n, l) => `<div><b>${n}</b>${l}</div>`;
    return `<div class="ay-title">🎉 ¡Listo! Tu club está configurado</div>
      <p style="line-height:1.5;margin-top:0">Esto es lo que quedó cargado:</p>
      <div class="ay-sum">${cell(acts.filter((a) => a.nombre !== 'Grupo Familiar').length, 'actividades')}${cell(exc.length, 'excepciones de cuota')}${cell(adi.length, 'actividades adicionales')}${cell(gf ? 'Sí' : 'No', 'plan familiar')}${cell(resp.length, 'cuentas')}${cell(ti.length + ' / ' + tg.length, 'tipos de ingreso / gasto')}</div>
      <div class="ay-kicker" style="margin-bottom:8px">Y ahora, ¿qué sigue?</div>
      ${QUICK.slice(0, 3).map(([e, t, d, s]) => `<button class="ay-link" data-a="go" data-s="${s}"><span class="e">${e}</span><span class="tx"><b>${esc(t)}</b><span>${esc(d)}</span></span><span>›</span></button>`).join('')}
      <p style="font-size:12px;color:var(--t-muted,#6b7280)">Podés volver a esta guía cuando quieras desde el botón ❓.</p>`;
  }

  /* ---------- acciones ---------- */
  function go(i) { S.idx = Math.max(0, Math.min(STEPS.length - 1, i)); S.view = 'step'; render(); saveProg(); }
  function mark(key, v) { S.prog.pasos[key] = v; }

  async function onClick(e) {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a, st = STEPS[S.idx];
    if (a === 'close') return close();
    if (a === 'home') { S.view = 'home'; return render(); }
    if (a === 'start') {
      const k = S.prog.completado ? 0 : Math.max(0, STEPS.findIndex((s) => s.key === S.prog.paso_actual));
      return go(k);
    }
    if (a === 'prev') return go(S.idx - 1);
    if (a === 'next') { if (st.type !== 'intro') mark(st.key, 'hecho'); return go(S.idx + 1); }
    if (a === 'skip') { if (!S.prog.pasos[st.key]) mark(st.key, 'omitido'); return go(S.idx + 1); }
    if (a === 'go') {
      const btn = document.querySelector(`[data-section="${t.dataset.s}"]`);
      close(); if (btn) btn.click(); return;
    }
    if (a === 'sug') {
      const inp = panel.querySelector('input[name="nombre"]'); if (inp) { inp.value = t.dataset.v; inp.focus(); } return;
    }
    if (a === 'ans') {
      S.prog.respuestas[st.key] = t.dataset.v;
      if (t.dataset.v === 'no') {
        mark(st.key, 'hecho'); await saveProg();
        return st.type === 'list' ? go(S.idx + 1) : renderStep();
      }
      await saveProg(); return renderStep();
    }
    if (a === 'gfyes') {
      try { await api('/config/grupo-familiar', { method: 'POST', body: { enabled: true } }); S.prog.respuestas[st.key] = 'si'; setFlash('Grupo Familiar activado. Ahora poné el precio de la cuota familiar.'); }
      catch (err) { setFlash(err.message, 'err'); }
      return renderStep();
    }
    if (a === 'del') {
      if (!window.confirm('¿Eliminar este elemento? Los socios que ya lo usan podrían quedar sin él.')) return;
      try { await api(`${st.endpoint}/${t.dataset.id}`, { method: 'DELETE' }); setFlash('Eliminado.'); }
      catch (err) { setFlash(err.message, 'err'); }
      return renderStep();
    }
  }

  async function onSubmit(e) {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const st = STEPS[S.idx];
    const btn = f.querySelector('button[type="submit"]'); if (btn) btn.disabled = true;
    try {
      if (f.dataset.form === 'gf') {
        const precio = Number(f.elements.precio.value);
        if (!Number.isFinite(precio) || precio < 0) throw new Error('Ingresá un precio válido.');
        await api(`/config/actividades/${S.gf.id}`, { method: 'PUT', body: { nombre: 'Grupo Familiar', precio_mensual: precio, modalidad_pago: 'mensual' } });
        mark(st.key, 'hecho'); setFlash('Precio del plan familiar guardado ✔'); await saveProg();
      } else {
        const body = {};
        for (const fl of st.fields) {
          let v = f.elements[fl.k].value.trim();
          if (fl.req && v === '') throw new Error(`Completá “${fl.label}”.`);
          if (fl.type === 'number') { if (v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) throw new Error(`“${fl.label}” debe ser un número mayor o igual a 0.`); v = v === '' ? null : Number(v); }
          body[fl.k] = v;
        }
        await api(st.endpoint, { method: 'POST', body });
        mark(st.key, 'hecho'); setFlash(`${cap(st.noun)} agregada ✔ ¿Querés cargar otra? Si no, tocá “Siguiente”.`); await saveProg();
      }
    } catch (err) { setFlash(err.message, 'err'); }
    renderStep();
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- arranque ---------- */
  async function maybeNudge() {
    try { if (sessionStorage.getItem('ayudaNudge')) return; } catch {}
    await loadProg();
    if (S.prog.completado || S.open) return;
    const n = doneCount();
    nudge.innerHTML = `<b>${n ? 'Seguí con tu configuración' : '¿Configuramos tu club juntos?'}</b><br>${n ? `Llevás ${n} de ${WORK_STEPS.length} pasos.` : 'Te guío paso a paso, es rápido.'}<div class="ay-nudge-actions"><button class="ay-btn primary" data-n="go">${n ? 'Continuar' : 'Empezar'}</button><button class="ay-btn ghost" data-n="x">Ahora no</button></div>`;
    nudge.classList.add('show');
    nudge.onclick = async (e) => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      hideNudge(); if (b.dataset.n === 'go') { await open('home'); go(Math.max(0, STEPS.findIndex((s) => s.key === S.prog.paso_actual))); }
    };
  }

  function init() {
    const perms = window.__clubPerms;
    if (!perms || !perms.canWrite || !perms.canWrite('configuracion')) return false;
    if (!fab) build();
    loadProg().then(() => { updateFab(); setTimeout(maybeNudge, 1800); });
    return true;
  }
  let tries = 0;
  const iv = setInterval(() => { if (init() || ++tries > 40) clearInterval(iv); }, 500);
  // si cambia de club (superadmin) se vuelve a leer el avance
  window.addEventListener('storage', () => { S.loadedFor = null; });
  window.AyudaTSMC = { open: openHome, close };
})();
