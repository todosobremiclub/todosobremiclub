/* =========================================================
   TEMA MODERNO DEL PANEL (colores del club)
   - Calcula la paleta a partir de color_primary / color_secondary
   - Aplica clase html.tema-moderno (o la quita para volver al "Clásico")
   - El usuario elige en el botón 🎨 (se recuerda en este navegador)
========================================================= */
(function () {
  const KEY = 'tsmcTema';
  const root = document.documentElement;
  const BASE = '#0b1020';

  function esModerno() {
    try { return localStorage.getItem(KEY) !== 'clasico'; } catch (e) { return true; }
  }

  // ---------- utilidades de color ----------
  function rgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) || 0); }
  function hex(a) { return '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
  function lum(h) { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; }
  function mix(h, t, p) { const a = rgb(h), b = rgb(t); return hex(a.map((v, i) => v + (b[i] - v) * p)); }
  function sat(h) { const [r, g, b] = rgb(h); return Math.max(r, g, b) - Math.min(r, g, b); }
  // Aclara conservando el tono si el color es demasiado oscuro para fondo oscuro
  function lift(h) {
    if (lum(h) >= .12) return h;
    let [r, g, b] = rgb(h).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let H = 0, S = 0, L = (mx + mn) / 2; const d = mx - mn;
    if (d) { S = d / (1 - Math.abs(2 * L - 1)); H = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H *= 60; if (H < 0) H += 360; }
    L = Math.max(L, .52); S = Math.max(S, .7);
    const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((H / 60) % 2 - 1)), m = L - C / 2;
    const t = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][Math.floor(H / 60) % 6];
    return hex(t.map(v => (v + m) * 255));
  }
  function validHex(h) { return /^#?[0-9a-fA-F]{6}$/.test(String(h || '').trim()); }

  // ---------- paleta ----------
  function paleta(club) {
    const p0 = validHex(club && club.color_primary) ? club.color_primary : '#2563eb';
    const s0 = validHex(club && club.color_secondary) ? club.color_secondary : '#1e40af';
    const a = lift(p0);
    // secundario casi blanco / gris: no sirve para degradé -> derivado del primario
    const b = (sat(s0) < 40 || (lum(s0) > .85 && sat(s0) < 80)) ? mix(a, BASE, .35) : lift(s0);
    const mid = mix(a, b, .5);
    return {
      a, b,
      bt: lum(b) < .3 ? mix(lift(b), '#ffffff', .28) : b,           // secundario apto para texto
      on: lum(mid) > .45 ? BASE : '#ffffff',      // texto sobre degradé
      bg1: mix(BASE, a, .42), bg2: mix(BASE, b, .38),
      bgm: mix(mix(BASE, a, .3), mix(BASE, b, .3), .5),
      bar1: mix(BASE, a, .62), bar2: mix(BASE, b, .5),
      orig: { p: p0, s: s0 }
    };
  }

  function aplicar(club) {
    const accent = club && validHex(club.color_accent) ? club.color_accent : '#facc15';
    const body = document.body;
    if (!esModerno()) {
      // Clásico: colores tal cual los cargó el club
      root.classList.remove('tema-moderno');
      root.style.setProperty('--color-primary', (club && club.color_primary) || '#2563eb');
      root.style.setProperty('--color-secondary', (club && club.color_secondary) || '#1e40af');
      root.style.setProperty('--color-accent', accent);
      if (body) {
        if (club && club.background_url) {
          body.style.backgroundImage = `url('${club.background_url}')`;
          body.style.backgroundColor = 'rgba(255,255,255,0.65)';
          body.style.backgroundBlendMode = 'overlay';
          body.style.backgroundSize = 'cover';
          body.style.backgroundPosition = 'center';
          body.style.backgroundAttachment = 'fixed';
        } else {
          body.style.backgroundImage = 'none';
          body.style.backgroundColor = '';
          body.style.backgroundBlendMode = '';
        }
      }
      return;
    }
    const P = paleta(club);
    root.classList.add('tema-moderno');
    const set = (k, v) => root.style.setProperty(k, v);
    set('--color-primary', P.a);
    set('--color-secondary', P.bt);
    set('--color-accent', accent);
    set('--a', P.a); set('--b', P.b); set('--on', P.on);
    set('--bg1', P.bg1); set('--bg2', P.bg2); set('--bgm', P.bgm);
    set('--bar1', P.bar1); set('--bar2', P.bar2);
    set('--logo-from', P.orig.p); set('--logo-to', P.orig.s);
    // Si el club subió una imagen de fondo, se mantiene bajo un velo con el degradé del club
    if (club && club.background_url && body) {
      body.style.backgroundImage =
        `linear-gradient(160deg, ${P.bg1}ee 0%, ${P.bgm}e6 50%, ${P.bg2}ee 100%), url('${club.background_url}')`;
      body.style.backgroundColor = '';
      body.style.backgroundBlendMode = 'normal';
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundAttachment = 'fixed';
    } else if (body) {
      body.style.backgroundImage = '';
      body.style.backgroundColor = '';
      body.style.backgroundBlendMode = '';
    }
  }

  // ---------- íconos del menú (SVG, solo se ven en el tema moderno) ----------
  const ICONS = {
    socios: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.8.2 5 2.4 5 5.3"/>',
    pendientes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pagos: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 15h2"/>',
    gastos: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    noticias: '<path d="M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 7a7 7 0 0 1 0 10"/>',
    notificaciones: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    cumples: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    configuracion: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    reportes: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    tienda: '<path d="M3 4h2l2.2 11h10.6L20 7H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
    espacios: '<path d="M3 21V9l9-6 9 6v12z"/><path d="M9 21v-6h6v6"/>',
    acceso: '<path d="M14 3h6v18h-6M10 8l4 4-4 4M14 12H3"/>',
    asistencia: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4M9 12l2 2 4-4"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v1M14 21h3M21 18v3"/>'
  };
  function svg(name) {
    return `<svg class="nav-svg" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }
  function inyectarIconos() {
    document.querySelectorAll('.topnav__center [data-section]').forEach(btn => {
      if (btn.querySelector('.nav-svg')) return;
      const ico = btn.querySelector('.nav-ico');
      const name = btn.dataset.section;
      if (ico && ICONS[name]) ico.insertAdjacentHTML('afterend', svg(name));
    });
    [['btnAsistencia', 'asistencia'], ['btnVerQR', 'qr'], ['btnControlAcceso', 'acceso']].forEach(([id, name]) => {
      const b = document.getElementById(id);
      if (!b || b.querySelector('.nav-svg')) return;
      // el emoji del texto original queda oculto vía CSS en tema moderno
      const raw = b.firstChild && b.firstChild.nodeType === 3 ? b.firstChild : null;
      if (raw) {
        const t = raw.textContent.replace(/^\s*\S+\s/, ' ');           // quita el emoji inicial
        b.dataset.clasicoTxt = raw.textContent;
        b.dataset.modernoTxt = t;
        const wrap = document.createElement('span');
        wrap.className = 'btn-txt'; wrap.textContent = raw.textContent;
        raw.replaceWith(wrap);
        wrap.insertAdjacentHTML('beforebegin', svg(name));
      }
    });
  }
  function textosBotones() {
    const mod = esModerno();
    document.querySelectorAll('.btn-txt').forEach(w => {
      const b = w.parentElement;
      w.textContent = mod ? (b.dataset.modernoTxt || w.textContent) : (b.dataset.clasicoTxt || w.textContent);
    });
  }

  function iniciarBoton(getClub) {
    const b = document.getElementById('btnTema');
    if (!b) return;
    const pintar = () => { b.textContent = esModerno() ? '🎨 Moderno' : '🎨 Clásico'; b.title = 'Cambiar entre el tema moderno y el clásico'; };
    pintar();
    b.addEventListener('click', () => {
      try { localStorage.setItem(KEY, esModerno() ? 'clasico' : 'moderno'); } catch (e) { }
      aplicar(getClub());
      textosBotones();
      pintar();
    });
  }

  // Aplicación temprana (antes de conocer el club) para evitar destello claro
  if (esModerno()) root.classList.add('tema-moderno');

  window.TSMC_Tema = { aplicar, esModerno, inyectarIconos, textosBotones, iniciarBoton, paleta };
})();
