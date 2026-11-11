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
  const AYUDA_CSS = "/* =========================================================\n   AYUDA \u2014 bot\u00f3n flotante + panel lateral + asistente\n   Usa las variables del tema (--t-*, --a, --on) con respaldo\n   para el tema Cl\u00e1sico (claro) y para el Moderno (oscuro).\n========================================================= */\n#ayudaFab{\n  position:fixed; right:22px; bottom:22px; z-index:9000;\n  width:56px; height:56px; border-radius:50%; border:0; cursor:pointer;\n  display:flex; align-items:center; justify-content:center;\n  background:var(--a,#2563eb); color:var(--on,#fff);\n  font:800 26px/1 Inter,\"Segoe UI\",system-ui,Arial,sans-serif;\n  box-shadow:0 10px 28px rgba(0,0,0,.35);\n  transition:transform .15s ease;\n}\n#ayudaFab:hover{ transform:scale(1.07); }\n#ayudaFab.pulse::after{\n  content:''; position:absolute; inset:-6px; border-radius:50%;\n  border:3px solid var(--a,#2563eb); opacity:.6; animation:ayudaPulse 1.8s ease-out infinite;\n}\n@keyframes ayudaPulse{ from{ transform:scale(.85); opacity:.7; } to{ transform:scale(1.25); opacity:0; } }\n#ayudaFab .ay-dot{\n  position:absolute; top:2px; right:2px; width:14px; height:14px; border-radius:50%;\n  background:#f59e0b; border:2px solid #fff; display:none;\n}\n#ayudaFab.pending .ay-dot{ display:block; }\n\n#ayudaNudge{\n  position:fixed; right:90px; bottom:30px; z-index:9000; max-width:290px;\n  background:var(--t-surface,#fff); color:var(--t-text,#111827);\n  border:1px solid var(--t-border,#e5e7eb); border-radius:14px; padding:12px 14px;\n  box-shadow:0 12px 34px rgba(0,0,0,.3); font-size:13.5px; line-height:1.4; display:none;\n}\n#ayudaNudge.show{ display:block; }\n#ayudaNudge .ay-nudge-actions{ display:flex; gap:8px; margin-top:10px; }\n\n#ayudaPanel{\n  position:fixed; top:0; right:0; bottom:0; z-index:9500;\n  width:min(470px,100vw); display:flex; flex-direction:column;\n  background:var(--t-surface,#fff); color:var(--t-text,#111827);\n  border-left:1px solid var(--t-border,#e5e7eb);\n  box-shadow:-18px 0 50px rgba(0,0,0,.35);\n  transform:translateX(105%); transition:transform .25s ease;\n  font-family:Inter,\"Segoe UI\",system-ui,Arial,sans-serif; font-size:14px;\n}\n#ayudaPanel.open{ transform:translateX(0); }\n.ay-head{\n  display:flex; align-items:center; gap:10px; padding:14px 16px;\n  background:var(--a,#2563eb); color:var(--on,#fff);\n}\n.ay-head h3{ margin:0; font-size:16px; font-weight:800; flex:1; }\n.ay-head button{\n  background:rgba(255,255,255,.18); border:0; color:inherit; cursor:pointer;\n  width:32px; height:32px; border-radius:10px; font-size:16px; font-weight:700;\n}\n.ay-body{ flex:1; overflow-y:auto; padding:16px; }\n.ay-foot{\n  display:flex; gap:8px; align-items:center; padding:12px 16px;\n  border-top:1px solid var(--t-border,#e5e7eb); background:var(--t-surface2,#f9fafb);\n}\n.ay-foot .ay-sp{ flex:1; }\n\n.ay-btn{\n  border:1px solid var(--t-border,#d1d5db); background:var(--t-surface2,#fff); color:inherit;\n  border-radius:11px; padding:9px 14px; font-family:inherit; font-weight:700; font-size:13.5px; line-height:1.2; cursor:pointer;\n}\n.ay-btn:hover{ filter:brightness(1.08); }\n.ay-btn.primary{ background:var(--a,#2563eb); color:var(--on,#fff); border-color:transparent; }\n.ay-btn.ghost{ background:transparent; }\n.ay-btn.danger{ color:#dc2626; }\n.ay-btn[disabled]{ opacity:.45; cursor:not-allowed; filter:none; }\n.ay-btn.big{ padding:14px 18px; font-size:15px; flex:1; }\n\n.ay-steps{ display:flex; gap:5px; margin-bottom:14px; }\n.ay-steps i{ flex:1; height:6px; border-radius:3px; background:var(--t-border,#e5e7eb); }\n.ay-steps i.done{ background:#22c55e; }\n.ay-steps i.cur{ background:var(--a,#2563eb); }\n.ay-kicker{ font-size:12px; font-weight:700; color:var(--t-muted,#6b7280); text-transform:uppercase; letter-spacing:.04em; }\n.ay-title{ font-size:21px; font-weight:800; margin:4px 0 12px; line-height:1.15; }\n.ay-why{\n  border-radius:12px; padding:12px 14px; margin-bottom:14px; line-height:1.5;\n  background:color-mix(in srgb, var(--a,#2563eb) 10%, transparent);\n  border:1px solid color-mix(in srgb, var(--a,#2563eb) 35%, transparent);\n}\n.ay-why summary{ cursor:pointer; list-style:none; } .ay-why summary::-webkit-details-marker{ display:none; }\n.ay-why summary::after{ content:' \u25be'; opacity:.6; } .ay-why[open] summary::after{ content:' \u25b4'; }\n.ay-card{\n  border:1px solid var(--t-border,#e5e7eb); border-radius:14px; padding:14px;\n  background:var(--t-surface2,#f9fafb); margin-bottom:12px;\n}\n.ay-card h4{ margin:0 0 10px; font-size:14px; }\n.ay-field{ margin-bottom:10px; }\n.ay-field label{ display:block; font-size:12px; font-weight:700; color:var(--t-muted,#6b7280); margin-bottom:4px; }\n.ay-field input,.ay-field select{\n  width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; font:inherit;\n  background:var(--t-input,#fff); color:var(--t-text,#111827); border:1px solid var(--t-border,#d1d5db);\n}\n.ay-field input:focus,.ay-field select:focus{ outline:2px solid var(--a,#2563eb); outline-offset:1px; }\n.ay-field .ay-hint{ font-size:12px; color:var(--t-muted,#6b7280); margin-top:4px; line-height:1.35; }\n.ay-row{ display:flex; gap:10px; } .ay-row>*{ flex:1; min-width:0; }\n.ay-chips{ display:flex; flex-wrap:wrap; gap:7px; margin:2px 0 12px; }\n.ay-chip{\n  border:1px dashed var(--t-border,#9ca3af); background:transparent; color:inherit; cursor:pointer;\n  border-radius:999px; padding:6px 12px; font-family:inherit; font-weight:600; font-size:12.5px; line-height:1;\n}\n.ay-chip:hover{ border-style:solid; border-color:var(--a,#2563eb); }\n.ay-list{ list-style:none; margin:0; padding:0; }\n.ay-list li{\n  display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:11px;\n  border:1px solid var(--t-border,#e5e7eb); background:var(--t-surface,#fff); margin-bottom:7px;\n}\n.ay-list li .n{ flex:1; font-weight:700; } .ay-list li .s{ font-size:12px; color:var(--t-muted,#6b7280); }\n.ay-list li button{ background:none; border:0; cursor:pointer; font-size:15px; color:#dc2626; }\n.ay-empty{ color:var(--t-muted,#6b7280); font-size:13px; padding:6px 2px 10px; }\n.ay-flash{ padding:10px 12px; border-radius:10px; margin-bottom:12px; font-weight:600; font-size:13px; }\n.ay-flash.ok{ background:rgba(34,197,94,.15); color:#16a34a; border:1px solid rgba(34,197,94,.4); }\n.ay-flash.err{ background:rgba(239,68,68,.13); color:#dc2626; border:1px solid rgba(239,68,68,.4); }\nhtml.tema-moderno .ay-flash.ok{ color:#86efac; } html.tema-moderno .ay-flash.err{ color:#fca5a5; }\n.ay-q{ display:flex; gap:10px; margin:6px 0 10px; }\n.ay-guide{\n  display:block; width:100%; text-align:left; cursor:pointer; color:inherit; font:inherit;\n  border:1px solid var(--t-border,#e5e7eb); border-radius:16px; padding:16px; margin-bottom:14px;\n  background:var(--t-surface2,#f9fafb);\n}\n.ay-guide .gt{ font-size:17px; font-weight:800; margin-bottom:4px; }\n.ay-bar{ height:8px; border-radius:4px; background:var(--t-border,#e5e7eb); margin:10px 0 6px; overflow:hidden; }\n.ay-bar i{ display:block; height:100%; background:#22c55e; border-radius:4px; }\n.ay-link{\n  display:flex; align-items:center; gap:10px; width:100%; text-align:left; cursor:pointer; color:inherit; font:inherit;\n  border:1px solid var(--t-border,#e5e7eb); border-radius:12px; padding:11px 12px; margin-bottom:8px; background:transparent;\n}\n.ay-link:hover{ border-color:var(--a,#2563eb); }\n.ay-link .e{ font-size:20px; } .ay-link .tx{ flex:1; } .ay-link .tx b{ display:block; } .ay-link .tx span{ font-size:12px; color:var(--t-muted,#6b7280); }\n.ay-sum{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px; }\n.ay-sum div{ border:1px solid var(--t-border,#e5e7eb); border-radius:12px; padding:10px 12px; background:var(--t-surface2,#f9fafb); }\n.ay-sum b{ display:block; font-size:22px; }\n@media (max-width:640px){ #ayudaNudge{ right:16px; bottom:90px; } }\n.ay-why b.t{ display:block; margin-bottom:4px; }\n\n#ayudaFab{ position:fixed !important; right:22px !important; bottom:22px !important; left:auto !important; top:auto !important; z-index:2147483000 !important; }\n#ayudaNudge{ position:fixed !important; right:90px !important; bottom:30px !important; left:auto !important; top:auto !important; z-index:2147483000 !important; }\n#ayudaPanel{ position:fixed !important; top:0 !important; right:0 !important; bottom:0 !important; left:auto !important; z-index:2147483100 !important; }\n";
  function injectCss() {
    if (document.getElementById('ayudaCss')) return;
    const st = document.createElement('style'); st.id = 'ayudaCss'; st.textContent = AYUDA_CSS;
    document.head.appendChild(st);
  }

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n ?? 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
  const clubId = () => localStorage.getItem('activeClubId');
  const canCfg = () => { const p = window.__clubPerms; return !!(p && p.canWrite && p.canWrite('configuracion')); };
  const canAsis = () => { const p = window.__clubPerms; return !!(p && p.canWrite && p.canWrite('asistencia')); };

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
    if (!canCfg()) { S.loadedFor = clubId(); return; }
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
    injectCss();
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
    const pend = canCfg() && !S.prog.completado;
    fab.classList.toggle('pending', pend);
    fab.classList.toggle('pulse', pend && !S.open && doneCount() === 0);
  }
  function close() { S.open = false; panel.classList.remove('open'); updateFab(); }
  async function openHome() { await open('home'); }
  async function open(view) {
    S.open = true; hideNudge();
    await loadProg(); await loadCoach();
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
    const cfgCard = !canCfg() ? '' : `
        <button class="ay-guide" data-a="start">
          <div class="ay-kicker">Guía</div>
          <div class="gt">🚀 Configuración inicial</div>
          <div style="font-size:13px;color:var(--t-muted,#6b7280)">Actividades y precios, excepciones, adicionales, grupo familiar, cuentas, tipos de ingreso y de gasto.</div>
          <div class="ay-bar"><i style="width:${pct}%"></i></div>
          <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--t-muted,#6b7280)">${S.prog.completado ? '✅ Completada' : `${n} de ${tot} pasos`}</span><span class="ay-btn primary">${label} →</span></div>
        </button>`;
    const gCards = GUIDES.filter((g) => g.can()).map((g) => {
      const p = gProg(g), n2 = gDone(g), t2 = gWork(g).length, pc = Math.round((n2 / t2) * 100);
      const lb = p.completado ? 'Repasar' : (n2 > 0 ? 'Continuar' : 'Empezar');
      return `
        <button class="ay-guide" data-a="coach-start" data-g="${g.id}">
          <div class="ay-kicker">${esc(g.kicker)}</div>
          <div class="gt">${g.icon} ${esc(g.title)}</div>
          <div style="font-size:13px;color:var(--t-muted,#6b7280)">${esc(g.desc)}</div>
          <div class="ay-bar"><i style="width:${pc}%"></i></div>
          <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--t-muted,#6b7280)">${p.completado ? '✅ Completada' : `${n2} de ${t2} pasos`}</span><span class="ay-btn primary">${lb} →</span></div>
        </button>`;
    }).join('');
    const quick = QUICK.filter((q) => { const p = window.__clubPerms; return !p || !p.canAccess || p.canAccess(q[3]); });
    panel.innerHTML = `${head('Centro de ayuda')}
      <div class="ay-body">
        <p style="margin:0 0 14px;line-height:1.45">Hola 👋 Elegí una guía y te acompaño paso a paso, explicándote para qué sirve cada cosa.</p>
        ${cfgCard}${gCards}
        <div class="ay-kicker" style="margin:18px 0 8px">Ir directo a…</div>
        ${quick.map(([e, t, d, s]) => `<button class="ay-link" data-a="go" data-s="${s}"><span class="e">${e}</span><span class="tx"><b>${esc(t)}</b><span>${esc(d)}</span></span><span>›</span></button>`).join('')}
        <p style="font-size:12px;color:var(--t-muted,#6b7280);margin-top:14px">Próximamente: guías para cargar socios y cobrar cuotas.</p>
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
    if (a === 'coach-start') return coachStart(t.dataset.g);
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

  /* =========================================================
     COACH (guías sobre la pantalla REAL): abre la sección o el
     modal correspondiente y resalta en naranja cada campo
     mientras una tarjeta flotante explica qué hacer. No guarda
     nada: el usuario decide. Guías: 'asistencia' y 'tienda'.
     Progreso por guía en /ayuda/progreso/:guia.
  ========================================================= */
  const COACH_CSS = `
.ay-hl{ scroll-margin-top:90px; outline:3px solid #f59e0b !important; outline-offset:3px; border-radius:10px; animation:ayHl 1.4s ease-in-out infinite; }
@keyframes ayHl{ 0%,100%{ box-shadow:0 0 0 0 rgba(245,158,11,.55); } 50%{ box-shadow:0 0 0 9px rgba(245,158,11,0); } }
#ayudaCoach{ position:fixed !important; left:22px !important; bottom:22px !important; right:auto !important; top:auto !important; z-index:2147483200 !important;
  width:min(370px,calc(100vw - 32px)); box-sizing:border-box; padding:14px 16px; border-radius:16px; display:none;
  background:var(--t-surface,#fff); color:var(--t-text,#111827); border:2px solid var(--a,#2563eb);
  box-shadow:0 16px 44px rgba(0,0,0,.4); font:14px/1.45 Inter,"Segoe UI",system-ui,Arial,sans-serif; }
#ayudaCoach.show{ display:block; }
#ayudaCoach .co-top{ display:flex; align-items:center; gap:8px; margin-bottom:6px; }
#ayudaCoach .co-top .ay-kicker{ flex:1; }
#ayudaCoach .co-x{ background:none; border:0; cursor:pointer; color:inherit; font-size:16px; opacity:.7; }
#ayudaCoach .co-t{ font-size:17px; font-weight:800; margin:2px 0 6px; line-height:1.2; }
#ayudaCoach .co-b{ font-size:13.5px; } #ayudaCoach .co-b p{ margin:0 0 6px; } #ayudaCoach .co-b ul{ margin:4px 0 6px; padding-left:18px; }
#ayudaCoach .co-warn{ margin:8px 0 0; padding:8px 10px; border-radius:10px; font-size:13px; font-weight:600; background:rgba(245,158,11,.15); border:1px solid rgba(245,158,11,.5); }
#ayudaCoach .co-act{ display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; } #ayudaCoach .co-act .ay-sp{ flex:1; }
#ayudaCoach .ay-steps{ margin:6px 0 8px; }
#ayudaCoach.co-br{ left:auto !important; right:22px !important; bottom:92px !important; }
#ayudaCoach.co-tr{ left:auto !important; right:22px !important; bottom:auto !important; top:70px !important; }
#ayudaCoach.co-tl{ bottom:auto !important; top:70px !important; }
@media (max-width:640px){ #ayudaCoach{ left:16px !important; bottom:84px !important; } }
`;
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && (e.offsetParent !== null || cs.position === 'fixed'); };
  const $q = (sel) => document.querySelector(sel);
  const asisModalOpen = () => vis($q('#modalAsistencia'));
  const asisPane2 = () => { const e = $q('#asistenciaPasoSocios'); return !!e && asisModalOpen() && getComputedStyle(e).display !== 'none'; };
  const tiendaOn = () => window.currentClub?.tienda_habilitada === true;
  const canTienda = () => { const p = window.__clubPerms; return tiendaOn() && !!(p && p.canWrite && p.canWrite('tienda')); };

  const G_ASIS = {
    id: 'asistencia', icon: '📋', name: 'Asistencia', title: 'Registrar asistencias', kicker: 'Guía en pantalla',
    desc: 'Te acompaño sobre la pantalla real: tipo, fecha, categoría, quién estuvo presente, invitados y guardar. No guarda nada de verdad.',
    can: () => canAsis(),
    steps: [
      { key: 'intro', icon: '📋', title: 'Tomar asistencia en 1 minuto', type: 'intro',
        body: '<p>Te voy a guiar sobre la <b>pantalla real</b>: se abre la ventana de asistencia y te marco cada campo con un resaltado naranja.</p><ul><li>Datos del evento (tipo, fecha, actividad, categoría)</li><li>Marcar presentes, invitados</li><li>Guardar y ver el reporte</li></ul><p><b>No se guarda nada</b> mientras dure la guía.</p>' },
      { key: 'abrir', title: 'Abrí “Asistencia”', t: ['#btnAsistencia'], opener: { label: 'Abrirla por mí', sel: '#btnAsistencia', done: asisModalOpen },
        body: '<p>Es el botón <b>📋 Asistencia</b> del menú superior. Desde ahí se toma lista de un <b>entrenamiento</b> o de un <b>partido</b>.</p>' },
      { key: 'tipo', title: '1. ¿Entrenamiento o partido?', t: ['.asist2-tipo-opciones'], modal: { vis: asisModalOpen, open: '#btnAsistencia' }, prep: () => asisBack(),
        body: '<p>Elegí qué vas a registrar. Después, en los reportes, vas a poder ver la asistencia de entrenamientos y de partidos por separado.</p>' },
      { key: 'fecha', title: '2. Fecha', t: ['#asistFecha'], modal: { vis: asisModalOpen, open: '#btnAsistencia' }, prep: () => asisBack(),
        body: '<p>Por defecto es hoy. Si te olvidaste de cargar un día anterior, cambiala acá y registrás la asistencia de esa fecha.</p>' },
      { key: 'actividad', title: '3. Actividad', t: ['#asistActividad', '#asistActividadAdicional'], modal: { vis: asisModalOpen, open: '#btnAsistencia' }, prep: () => asisBack(),
        body: '<p>Elegí la <b>actividad</b> (Fútbol, Hockey, etc.). Si el chico también hace una <b>actividad adicional</b>, podés sumarla para que aparezca en la lista.</p>' },
      { key: 'categoria', title: '4. Categoría', t: ['#asistCategoria', '#asistCategoriasAdicionalesWrap'], modal: { vis: asisModalOpen, open: '#btnAsistencia' }, prep: () => asisBack(),
        body: '<p>Se habilita al elegir la actividad. Define <b>a quién se convoca</b>. Si hay chicos que entrenan con más de una categoría, tildalas en <b>Categorías adicionales</b>.</p>' },
      { key: 'anio', title: '5. Año de nacimiento (opcional)', t: ['#asistAnioNacimiento', '#asistAnioAdicionalInput'], modal: { vis: asisModalOpen, open: '#btnAsistencia' }, prep: () => asisBack(),
        body: '<p>Sirve para filtrar por camada (por ejemplo solo los nacidos en 2012). Si lo dejás vacío se convoca a toda la categoría.</p>' },
      { key: 'buscar', title: '6. Buscar socios', t: ['#btnAsistBuscarSocios'], modal: { vis: asisModalOpen, open: '#btnAsistencia' }, prep: () => asisBack(),
        extra: { label: '▶ Buscar socios', sel: '#btnAsistBuscarSocios', show: () => asisModalOpen() && !asisPane2() },
        body: '<p>Con los datos listos, tocá <b>Buscar socios ▶</b>. Te lleva al paso 2 con todos los convocados. Podés usar el botón de abajo para probarlo ahora.</p>' },
      { key: 'convocados', title: '7. Marcá quién vino', t: ['#asistListaConvocados'], modal: { vis: asisModalOpen, open: '#btnAsistencia' },
        warn: () => (asisPane2() ? '' : 'Esta parte aparece en el paso 2. Completá los datos y tocá <b>Buscar socios ▶</b> (o usá el botón de abajo).'),
        extra: { label: '▶ Buscar socios', sel: '#btnAsistBuscarSocios', show: () => asisModalOpen() && !asisPane2() },
        body: '<p><b>Tocá la tarjeta</b> de cada socio que estuvo presente: se marca en verde. Si te equivocás, tocala de nuevo.</p>' },
      { key: 'herramientas', title: '8. Herramientas de la lista', t: ['#asistBuscarConvocado', '#btnAsistVista', '#btnAsistTodos', '#btnAsistNinguno'], modal: { vis: asisModalOpen, open: '#btnAsistencia' },
        warn: () => (asisPane2() ? '' : 'Esta parte aparece en el paso 2. Tocá <b>Buscar socios ▶</b> en la ventana.'),
        extra: { label: '▶ Buscar socios', sel: '#btnAsistBuscarSocios', show: () => asisModalOpen() && !asisPane2() },
        body: '<ul><li><b>Buscador</b>: encontrá a un socio por nombre.</li><li><b>Grilla / Lista</b>: con fotos o más compacta.</li><li><b>Todos presentes</b> / <b>Ninguno</b>: marcás todo de una vez y corregís solo las ausencias.</li></ul>' },
      { key: 'invitados', title: '9. Invitados', t: ['#asistInvitadosWrap'], modal: { vis: asisModalOpen, open: '#btnAsistencia' },
        warn: () => (asisPane2() ? '' : 'Esta parte aparece en el paso 2. Tocá <b>Buscar socios ▶</b> en la ventana.'),
        extra: { label: '▶ Buscar socios', sel: '#btnAsistBuscarSocios', show: () => asisModalOpen() && !asisPane2() },
        body: '<p>Si vino un chico que <b>no figura en la lista</b> (de otra categoría o que probó ese día), buscalo acá y se suma como invitado.</p>' },
      { key: 'guardar', title: '10. Guardar', t: ['#btnAsistGuardar'], modal: { vis: asisModalOpen, open: '#btnAsistencia' },
        warn: () => (asisPane2() ? '' : 'Este botón aparece en el paso 2. Tocá <b>Buscar socios ▶</b> en la ventana.'),
        body: '<p>Cuando termines tocá <b>Guardar asistencia</b>. Se guardan los presentes y los ausentes. <b>En esta guía no lo toco</b>: si estás practicando, cerrá la ventana sin guardar.</p>' },
      { key: 'reporte', title: '11. Ver reporte', t: ['#btnAsistVerReporte'], modal: { vis: asisModalOpen, open: '#btnAsistencia' },
        body: '<p><b>📊 Ver reporte</b> muestra cuánto asistió cada socio, por actividad y categoría, en el período que elijas.</p>' },
      { key: 'fin', icon: '🎉', title: '¡Listo!', type: 'fin',
        body: '<p>Ya sabés tomar asistencia: <b>Datos → Buscar socios → marcar presentes → Guardar</b>.</p><p>Podés repetir esta guía cuando quieras desde el ❓.</p>' }
    ],
    onFinish: () => { if (asisModalOpen()) { const c = $q('#btnAsistCancelarDatos'); if (c) c.click(); } }
  };
  function asisBack() { if (asisPane2()) { const b = $q('#btnAsistVolverDatos'); if (b) b.click(); } }

  const TN = { nav: 'tienda', navSel: '#tienda-section' };
  const ventaOpen = () => vis($q('#modalVentaManualOverlay'));
  const G_TIENDA = {
    id: 'tienda', icon: '🛒', name: 'Tienda', title: 'Armar mi tienda', kicker: 'Guía en pantalla · Tienda Online',
    desc: 'Cargá tus productos (con talles y fotos), gestioná las reservas de los socios, cargá ventas en mostrador y controlá los pagos. Te marco cada parte en pantalla.',
    can: () => canTienda(),
    steps: [
      { key: 'intro', icon: '🛒', title: 'Tu tienda, paso a paso', type: 'intro',
        body: '<p>Los socios ven tus productos en la app (menú <b>Más → Tienda</b>), los <b>reservan</b> y vos los gestionás desde el panel. <b>El pago es en el club</b>, no hay cobro online.</p><ul><li>Cargar productos (foto, precio, stock, talles)</li><li>Aceptar o rechazar reservas</li><li>Venta manual en mostrador</li><li>Controlar pagos y retiros</li></ul><p>No guardo nada por vos: la guía solo te marca dónde tocar.</p>' },
      { key: 'ir', title: 'Entrá a “Tienda”', t: ['[data-section="tienda"]'], nav: 'tienda',
        body: '<p>Está en el menú superior (🛒 <b>Tienda</b>); solo les aparece a los clubes que la tienen habilitada. Ya te llevé a esa pantalla.</p>' },
      { key: 'nombre', title: '1. Nombre y descripción', t: ['#tiendaNombre', '#tiendaDescripcion'], nav: 'tienda',
        body: '<p>Poné un nombre claro y, en la descripción, lo que el socio necesita saber: colores, condición, medidas.</p>' },
      { key: 'precio', title: '2. Precio y stock', t: ['#tiendaPrecio', '#tiendaStockWrap'], nav: 'tienda',
        body: '<p>El <b>precio</b> es por unidad. El <b>stock</b> es cuántas unidades tenés. Se descuenta recién cuando <b>aceptás</b> una reserva, no cuando el socio la hace.</p>' },
      { key: 'talles', title: '3. ¿Se vende por talle?', t: ['label:has(#tiendaTieneTalles)', '#tiendaTallesWrap'], nav: 'tienda',
        body: '<p>Para ropa o calzado tildá esta opción: cargás cada <b>talle con su propio stock</b> (S, M, L / 38, 39…) y el total se calcula solo. En la app los talles sin stock se ven tachados.</p>' },
      { key: 'tipo', title: '4. Tipo de producto', t: ['#tiendaCategoria'], nav: 'tienda',
        body: '<p>Sirve para ordenar y para filtrar ventas e ingresos por rubro (indumentaria, bebidas…). Los tipos se crean en <b>Configuración</b>, debajo de “Cuentas $”. Si no cargaste ninguno, dejalo en “Sin tipificar”.</p>' },
      { key: 'fotos', title: '5. Fotos (hasta 3)', t: ['#tiendaImagen', '#tiendaImagen2', '#tiendaImagen3'], nav: 'tienda',
        body: '<p>La primera es la principal. Hasta 3 MB cada una (JPG, PNG o WEBP). En la app se ven deslizando, como un carrete.</p>' },
      { key: 'preview', title: '6. Vista previa', t: ['.tw-preview-phone'], nav: 'tienda',
        body: '<p>A la derecha ves aproximadamente cómo lo va a ver el socio en su celular mientras completás el formulario.</p>' },
      { key: 'publicar', title: '7. Publicar', t: ['#btnTiendaGuardar'], nav: 'tienda',
        body: '<p>Cuando esté listo tocá <b>Publicar producto</b>. Queda visible en la app al instante. <b>Yo no lo toco</b>: lo hacés vos.</p>' },
      { key: 'lista', title: '8. Tus productos publicados', t: ['table:has(#tiendaTableBody)'], nav: 'tienda',
        body: '<p>Desde acá <b>editás</b>, <b>desactivás</b> (deja de verse en la app sin perder el historial) o <b>eliminás</b>. Si el producto ya tuvo reservas, eliminar lo desactiva para no romper el historial.</p>' },
      { key: 'pend', title: '9. Reservas de los socios', t: ['#tiendaReservasWrapper', '[data-section="pendientes"]'], nav: 'pendientes',
        body: '<p>Cada reserva llega a <b>Pendientes → Reservas de tienda</b>. Las que vienen del carrito se gestionan <b>juntas como un pedido</b>.</p><ul><li><b>Aceptar</b>: descuenta el stock y le avisa al socio por notificación (podés dejarle un mensaje, ej. “retirá el viernes”).</li><li><b>Rechazar</b>: no toca el stock y le avisa el motivo.</li><li><b>Marcar retirado</b>: cuando se lo llevó. Si falta pagar, te pide confirmar y queda como deuda.</li></ul>' },
      { key: 'manual', title: '10. Venta manual (mostrador)', t: ['#btnVentaManualAbrir'], nav: 'tienda',
        opener: { label: 'Abrir el formulario', sel: '#btnVentaManualAbrir', done: ventaOpen },
        body: '<p>Para quien compra en el club sin usar la app. Tocá <b>➕ Cargar venta manual</b>.</p>' },
      { key: 'manual2', title: 'Completá la venta manual', t: ['#ventaManualSocioBusqueda', '#ventaManualProducto', '#ventaManualEstadoPago', '#ventaManualRetirado'], modal: { vis: ventaOpen, open: '#btnVentaManualAbrir' }, nav: 'tienda',
        body: '<ul><li>Buscá al <b>socio</b> (o tildá “No socio” para una visita).</li><li>Elegí <b>producto</b> y <b>talle</b>, cantidad y precio.</li><li><b>Estado de pago</b>: falta de pago, seña o pago completo (si cobrás, elegís la cuenta y se registra el ingreso).</li><li><b>Ya retirado</b>: tildalo si se lo llevó en el momento.</li></ul><p>Yo no guardo: cerrá con <b>Cancelar</b> si solo estás mirando.</p>' },
      { key: 'historial', title: '11. Historial de ventas y pagos', t: ['table:has(#tiendaHistorialVentasBody)'], nav: 'tienda', cleanup: () => { if (ventaOpen()) { const c = $q('#ventaManualCancel'); if (c) c.click(); } },
        body: '<p>Todas las ventas, de la app y manuales. En <b>Estado de pago</b> podés registrar un cobro posterior (seña o saldo): ahí se genera el ingreso en tus cuentas.</p><p>Podés buscar por socio o producto y filtrar por tipo.</p>' },
      { key: 'fin', icon: '🎉', title: '¡Tu tienda está lista!', type: 'fin',
        body: '<p>Resumen: <b>publicás → el socio reserva → aceptás → retira y paga → queda en el historial</b>.</p><p>Podés repetir esta guía cuando quieras desde el ❓.</p>' }
    ],
    onFinish: () => { if (ventaOpen()) { const c = $q('#ventaManualCancel'); if (c) c.click(); } }
  };
  /* ---- Guía: Publicar una noticia (con los destinos posibles) ---- */
  const canNoti = () => { const p = window.__clubPerms; return !!(p && p.canWrite && p.canWrite('noticias')); };
  const DESTINOS = [
    ['todos', 'Todos los socios', 'La ven todos los socios del club. Ideal para avisos generales (feriados, cambios de horario, eventos).'],
    ['actividad', 'Por Actividad', 'Solo la ven los socios de una actividad (por ejemplo Fútbol o Hockey). Elegís la actividad en el desplegable que aparece.'],
    ['categoria', 'Por Categoría', 'Solo los socios de una categoría (por ejemplo Sub 12). Útil para convocatorias o avisos del plantel.'],
    ['anio_nac', 'Por Año de nacimiento', 'Solo los nacidos en un año determinado (por ejemplo 2012). Sirve para camadas.'],
    ['cat_anio', 'Categoría + Año', 'Combina categoría y año: llega únicamente a quienes cumplen las dos condiciones.'],
    ['act_cat', 'Actividad + Categoría', 'Combina actividad y categoría: por ejemplo solo Hockey Sub 14.'],
    ['falta_pago', 'En falta de pago', 'Solo la ven los socios con cuotas adeudadas. Perfecto para recordatorios de pago sin exponer a los demás.']
  ];
  const destSel = () => $q('#notiDestinoTipo');
  const setDestino = (v) => { const el = destSel(); if (!el) return; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const destinoBody = () => {
    const cur = (destSel() && destSel().value) || 'todos';
    const d = DESTINOS.find((x) => x[0] === cur) || DESTINOS[0];
    return `<p>Elegí a quién le llega. Tocá una opción para <b>verla en pantalla</b> (no se publica nada):</p>
      <div class="ay-chips" style="margin:6px 0">${DESTINOS.map((x) => `<button type="button" class="ay-chip" data-c="dest" data-v="${x[0]}" style="${x[0] === cur ? 'border-style:solid;border-color:var(--a,#2563eb);font-weight:800' : ''}">${esc(x[1])}</button>`).join('')}</div>
      <p style="margin:6px 0 0"><b>${esc(d[1])}:</b> ${esc(d[2])}</p>`;
  };
  const G_NOTI = {
    id: 'noticias', icon: '📣', name: 'Noticias', title: 'Publicar una noticia', kicker: 'Guía en pantalla · Noticias',
    desc: 'Escribí tu noticia, sumale una imagen y elegí a quién le llega: todos los socios, una actividad, una categoría, un año o los que están en falta de pago.',
    can: () => canNoti(),
    steps: [
      { key: 'intro', icon: '📣', title: 'Publicá una noticia', type: 'intro',
        body: '<p>Las noticias se ven en la sección <b>Noticias</b> de la app de tus socios. Vas a poder elegir <b>quiénes la ven</b>: todos o solo un grupo.</p><ul><li>Título, texto e imagen</li><li>Destino (a quién le llega)</li><li>Vista previa y publicar</li><li>Editar o borrar publicadas</li></ul><p>Yo solo te marco dónde tocar: <b>no publico nada</b>.</p>' },
      { key: 'ir', title: 'Entrá a “Noticias”', t: ['[data-section="noticias"]'], nav: 'noticias',
        body: '<p>Está en el menú superior (📣 <b>Noticias</b>). Ya te llevé a esa pantalla.</p>' },
      { key: 'texto', title: '1. Título y texto', t: ['#notiTitulo', '#notiTexto'], nav: 'noticias',
        body: '<p>Un título corto y claro, y el texto con lo importante primero (qué, cuándo, dónde). Los dos son obligatorios.</p>' },
      { key: 'imagen', title: '2. Imagen (opcional)', t: ['#notiImagen'], nav: 'noticias',
        body: '<p>Una foto o flyer ayuda a que la lean. Hasta 3 MB, en JPG, PNG o WEBP. Podés quitarla con “✖ Quitar”.</p>' },
      { key: 'destino', title: '3. Destino: ¿a quién le llega?', t: ['#notiDestinoTipo', '#notiDestinoExtra'], nav: 'noticias',
        body: destinoBody, cleanup: () => setDestino('todos') },
      { key: 'preview', title: '4. Vista previa', t: ['.nw-preview-phone'], nav: 'noticias',
        body: '<p>Mientras escribís, a la derecha ves aproximadamente cómo la va a ver el socio en su celular.</p>' },
      { key: 'publicar', title: '5. Publicar', t: ['#btnNoticiaPublicar'], nav: 'noticias',
        body: '<p>Cuando esté lista tocá <b>📤 Publicar noticia</b>. Queda disponible en la app al instante para el destino elegido. <b>Yo no la publico</b>: lo hacés vos.</p>' },
      { key: 'lista', title: '6. Noticias publicadas', t: ['table:has(#noticiasTableBody)'], nav: 'noticias',
        body: '<p>Acá ves todas las que publicaste, con su <b>destino</b> en la columna correspondiente. Desde <b>Acciones</b> podés <b>editarlas</b> (cambiar texto o destino) o <b>eliminarlas</b>.</p>' },
      { key: 'fin', icon: '🎉', title: '¡Listo!', type: 'fin',
        body: '<p>Resumen: <b>título y texto → imagen → destino → publicar</b>.</p><p>Podés repetir esta guía cuando quieras desde el ❓.</p>' }
    ],
    onFinish: () => setDestino('todos')
  };
  const GUIDES = [G_ASIS, G_TIENDA, G_NOTI];
  const gById = (id) => GUIDES.find((g) => g.id === id);
  const CP = {};   // progreso por guía
  const C = { open: false, g: null, idx: 0, sig: '', navKey: '' };
  const gWork = (g) => g.steps.filter((s) => s.type !== 'intro' && s.type !== 'fin');
  const gDone = (g) => { const p = CP[g.id]; return p ? gWork(g).filter((s) => p.pasos[s.key]).length : 0; };
  const gProg = (g) => CP[g.id] || { paso_actual: null, pasos: {}, completado: false };
  const lsG = (g) => `ayuda_${clubId()}_${g.id}`;
  let coachEl, coachIv;

  async function loadCoach() {
    for (const g of GUIDES) {
      const k = clubId();
      if (CP[g.id] && CP[g.id].club === k) continue;
      let p = null;
      try { p = (await api(`/ayuda/progreso/${g.id}`)).progreso; }
      catch { try { p = JSON.parse(localStorage.getItem(lsG(g)) || 'null'); } catch { p = null; } }
      CP[g.id] = { club: k, paso_actual: p?.paso_actual || null, pasos: p?.pasos || {}, completado: !!p?.completado };
    }
  }
  async function saveCoach(g) {
    const p = CP[g.id];
    const body = { paso_actual: p.paso_actual, pasos: p.pasos, respuestas: {}, completado: p.completado };
    try { await api(`/ayuda/progreso/${g.id}`, { method: 'PUT', body }); }
    catch { try { localStorage.setItem(lsG(g), JSON.stringify(body)); } catch {} }
  }
  function injectCoachCss() {
    if (document.getElementById('ayudaCoachCss')) return;
    const st = document.createElement('style'); st.id = 'ayudaCoachCss'; st.textContent = COACH_CSS; document.head.appendChild(st);
  }
  const clearHl = () => document.querySelectorAll('.ay-hl').forEach((e) => e.classList.remove('ay-hl'));

  async function coachStart(id) {
    const g = gById(id || 'asistencia'); if (!g) return;
    await loadCoach();
    injectCoachCss();
    if (!coachEl) { coachEl = document.createElement('div'); coachEl.id = 'ayudaCoach'; coachEl.addEventListener('click', coachClick); document.body.appendChild(coachEl); }
    close();
    C.open = true; C.g = g;
    const p = CP[g.id];
    C.idx = p.completado ? 0 : Math.max(0, g.steps.findIndex((s) => s.key === p.paso_actual));
    C.sig = ''; C.navKey = '';
    coachRender();
    clearInterval(coachIv); coachIv = setInterval(coachTick, 600);
  }
  function coachStop() {
    if (C.g && C.g.onFinish && C.open) { /* no cerrar modales al salir: el usuario decide */ }
    C.open = false; clearInterval(coachIv); clearHl();
    if (coachEl) coachEl.classList.remove('show');
  }
  function coachSig() {
    const st = C.g.steps[C.idx];
    return [C.idx, vis($q((st.t || [])[0] || '#__none')), st.modal ? st.modal.vis() : '', asisPane2()].join('|');
  }
  function coachTick() { if (!C.open) return; if (coachSig() !== C.sig) coachRender(); }
  function coachGo(i) {
    const g = C.g, prev = g.steps[C.idx];
    if (prev && prev.cleanup) prev.cleanup();
    C.idx = Math.max(0, Math.min(g.steps.length - 1, i));
    CP[g.id].paso_actual = g.steps[C.idx].key; C.navKey = ''; coachRender(); saveCoach(g);
  }
  function coachRender() {
    const g = C.g, st = g.steps[C.idx];
    clearHl();
    // 1) dejar la pantalla real en el estado que pide el paso
    const key = g.id + ':' + C.idx;
    if (st.nav && C.navKey !== key) {
      C.navKey = key;
      const first = $q((st.t || [])[0] || '#__none');
      const nb = document.querySelector(`[data-section="${st.nav}"]`);
      if (nb && st.key !== 'ir' && !(first && vis(first))) nb.click();
      else if (nb && st.key === 'ir') nb.click();
    }
    if (st.modal && !st.modal.vis()) { const b = $q(st.modal.open); if (b && vis(b)) b.click(); }
    if (st.prep) st.prep();
    C.sig = coachSig();
    // 2) tarjeta
    let acts = '';
    const back = C.idx > 0 ? '<button class="ay-btn ghost" data-c="prev">← Atrás</button>' : '';
    let warn = st.warn ? st.warn() : '';
    if (st.opener) { if (!st.opener.done()) acts += `<button class="ay-btn" data-c="opener">${esc(st.opener.label)}</button>`; else warn = '✔ Ya está abierta. Seguí al próximo paso.'; }
    if (st.extra && st.extra.show()) acts += `<button class="ay-btn" data-c="extra">${esc(st.extra.label)}</button>`;
    if (st.modal && !st.modal.vis()) acts += `<button class="ay-btn" data-c="reopen">Reabrir ventana</button>`;
    if (st.type === 'fin') acts += '<button class="ay-btn primary" data-c="finish">Terminar</button>';
    const tot = g.steps.length;
    const p = CP[g.id];
    const dots = `<div class="ay-steps">${g.steps.map((s, i) => `<i class="${p.pasos[s.key] || i < C.idx ? 'done' : ''} ${i === C.idx ? 'cur' : ''}"></i>`).join('')}</div>`;
    const nav = st.type === 'fin' ? '' : `<span class="ay-sp"></span><button class="ay-btn primary" data-c="next">${st.type === 'intro' ? 'Empezar' : 'Siguiente'} →</button>`;
    coachEl.innerHTML = `<div class="co-top"><div class="ay-kicker">${esc(g.name)} · ${C.idx + 1} de ${tot}</div><button class="co-x" data-c="exit" title="Salir de la guía" aria-label="Salir">✕</button></div>${dots}
      <div class="co-t">${st.icon ? st.icon + ' ' : ''}${esc(st.title)}</div><div class="co-b">${typeof st.body === 'function' ? st.body() : (st.body || '')}</div>${warn ? `<div class="co-warn">${warn}</div>` : ''}
      <div class="co-act">${back}${acts}${nav}</div>`;
    coachEl.classList.add('show');
    // 3) resaltar
    let first = null;
    (st.t || []).forEach((sel) => { let e = null; try { e = $q(sel); } catch {} if (e && vis(e)) { e.classList.add('ay-hl'); first = first || e; } });
    if (first) { try { first.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch {} }
    // la tarjeta se ubica en la esquina que menos tape lo resaltado
    const area = () => { const c = coachEl.getBoundingClientRect(); return [...document.querySelectorAll('.ay-hl')].reduce((t, e) => { const r = e.getBoundingClientRect(); const w = Math.min(r.right, c.right) - Math.max(r.left, c.left), h = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top); return t + (w > 0 && h > 0 ? w * h : 0); }, 0); };
    let best = '', bestA = Infinity;
    for (const pos of ['', 'co-br', 'co-tr', 'co-tl']) {
      coachEl.classList.remove('co-br', 'co-tr', 'co-tl'); if (pos) coachEl.classList.add(pos);
      const a = area(); if (a < bestA) { bestA = a; best = pos; } if (a === 0) break;
    }
    coachEl.classList.remove('co-br', 'co-tr', 'co-tl'); if (best) coachEl.classList.add(best);
  }
  async function coachClick(e) {
    const t = e.target.closest('[data-c]'); if (!t) return;
    const a = t.dataset.c, g = C.g, st = g.steps[C.idx];
    if (a === 'exit') return coachStop();
    if (a === 'prev') return coachGo(C.idx - 1);
    if (a === 'next') { if (st.type !== 'intro') CP[g.id].pasos[st.key] = 'hecho'; return coachGo(C.idx + 1); }
    if (a === 'dest') { setDestino(t.dataset.v); setTimeout(coachRender, 120); return; }
    if (a === 'opener') { const b = $q(st.opener.sel); if (b) b.click(); setTimeout(coachRender, 400); return; }
    if (a === 'extra') { const b = $q(st.extra.sel); if (b) b.click(); setTimeout(coachRender, 900); return; }
    if (a === 'reopen') { const b = $q(st.modal.open); if (b) b.click(); setTimeout(coachRender, 400); return; }
    if (a === 'finish') { CP[g.id].completado = true; await saveCoach(g); if (g.onFinish) g.onFinish(); coachStop(); }
  }

  /* ---------- arranque ---------- */
  async function maybeNudge() {
    try { if (sessionStorage.getItem('ayudaNudge')) return; } catch {}
    if (!canCfg()) return;
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
    if (!perms || !perms.canWrite || !(canCfg() || canAsis() || canTienda() || canNoti())) return false;
    if (!fab) build();
    loadProg().then(() => { updateFab(); setTimeout(maybeNudge, 1800); });
    return true;
  }
  let tries = 0;
  const iv = setInterval(() => { if (init() || ++tries > 40) clearInterval(iv); }, 500);
  // si cambia de club (superadmin) se vuelve a leer el avance
  window.addEventListener('storage', () => { S.loadedFor = null; });
  window.AyudaTSMC = { open: openHome, close, coach: (id) => coachStart(id) };
})();
