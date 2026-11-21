// public/js/informe-mensual.js
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$ ' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const pct = (n) => (n === null || n === undefined ? '—' : n + '%');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombrePeriodo = (p) => {
    const [a, m] = String(p).split('-');
    return `${MESES[Number(m) - 1] || m} ${a}`;
  };

  async function api(url, opts = {}) {
    const token = localStorage.getItem('token');
    const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token } });
    let data = null;
    try { data = await res.json(); } catch {}
    return { res, data };
  }

  function card(titulo, valor, nota) {
    return `<div class="im-card"><h4>${esc(titulo)}</h4><div class="im-big">${valor}</div>${nota ? `<div class="im-note">${nota}</div>` : ''}</div>`;
  }

  function bloqueNoDisponible(titulo) {
    return `<div class="im-block"><h3>${esc(titulo)}</h3><div class="im-muted">No se pudo calcular esta parte del informe.</div></div>`;
  }

  function render(inf, clubId) {
    const out = [];

    if (inf.parcial) {
      out.push(`<p><span class="im-badge">Mes en curso: datos hasta hoy</span></p>`);
    }

    // Alertas
    if (inf.alertas && inf.alertas.length) {
      out.push(`<div class="im-block"><h3>🚨 Para tener en cuenta</h3>${inf.alertas.map((a) => `
        <div class="im-alert ${esc(a.nivel)}"><span>${esc(a.texto)}</span>
        ${a.seccion ? `<button class="btn" data-ir="${esc(a.seccion)}">Ir</button>` : ''}</div>`).join('')}</div>`);
    } else {
      out.push(`<div class="im-block"><h3>✅ Sin alertas</h3><div class="im-muted">No hay nada puntual para destacar este mes.</div></div>`);
    }

    // Resumen
    const s = inf.socios, f = inf.finanzas, m = inf.morosos, ap = inf.app;
    out.push('<div class="im-grid">' + [
      s ? card('Socios activos', s.activos, `${s.altas_mes} alta(s) este mes`) : '',
      f ? card('Cuotas cobradas', money(f.cuotas_cobradas), f.variacion_cuotas_pct !== null ? `${f.variacion_cuotas_pct > 0 ? '+' : ''}${f.variacion_cuotas_pct}% vs mes anterior` : `${f.cuotas_cantidad} pago(s)`) : '',
      f ? card('Resultado del mes', money(f.resultado), `Ingresos ${money(f.ingresos_totales)} − gastos ${money(f.gastos)}`) : '',
      m ? card('Deben 2 o más cuotas', m.deben_2_o_mas, `${pct(m.pct_al_dia)} de los socios con pagos está al día`) : '',
      ap ? card('Usaron la app (30 días)', pct(ap.pct_30_dias), `${ap.ingresaron_ultimos_30_dias} de ${ap.socios_activos} socios`) : '',
    ].join('') + '</div>');

    // Morosos
    if (m) {
      const filas = m.listado.map((x) => `<tr><td>${esc(x.numero)}</td><td>${esc(x.nombre)}</td><td>${esc(x.actividad || '—')}</td><td>${x.cuotas_adeudadas}</td><td>${esc(x.ultimo_pago || '—')}</td><td>${esc(x.telefono || '—')}</td></tr>`).join('');
      out.push(`<div class="im-block"><h3>💰 Socios con deuda</h3>
        <p class="im-muted">Al día: <b>${m.al_dia}</b> · Deben 1 cuota: <b>${m.debe_1_cuota}</b> · Deben 2 o más: <b>${m.deben_2_o_mas}</b> (3 o más: ${m.deben_3_o_mas}) · Sin pagos registrados: <b>${m.sin_pagos_registrados}</b>.<br>No se cuentan becados ni socios de actividades por clases.</p>
        ${m.listado.length ? `<div style="overflow:auto"><table><thead><tr><th>N°</th><th>Socio</th><th>Actividad</th><th>Cuotas</th><th>Último pago</th><th>Teléfono</th></tr></thead><tbody>${filas}</tbody></table></div>${m.listado_truncado ? '<p class="im-muted">Se muestran los 100 con más deuda.</p>' : ''}` : '<p class="im-muted">Ningún socio debe 2 o más cuotas. 👏</p>'}
      </div>`);
    } else out.push(bloqueNoDisponible('Socios con deuda'));

    // Asistencia
    const a = inf.asistencia;
    if (a) {
      out.push(`<div class="im-block"><h3>🏃 Asistencia</h3>
        ${a.eventos === 0 ? '<p class="im-muted">No se registró asistencia este mes.</p>' : `
        <p class="im-muted"><b>${a.eventos}</b> evento(s) (${a.entrenamientos} entrenamientos, ${a.partidos} partidos) · asistencia general <b>${pct(a.pct_asistencia)}</b> · promedio de <b>${a.promedio_presentes_por_evento}</b> presentes por evento.</p>
        ${a.por_actividad.length ? `<table><thead><tr><th>Actividad</th><th>Eventos</th><th>Asistencia</th></tr></thead><tbody>${a.por_actividad.map((x) => `<tr><td>${esc(x.actividad)}</td><td>${x.eventos}</td><td>${pct(x.pct_asistencia)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${a.socios_con_3_o_mas_faltas.length ? `<p style="margin-top:12px"><b>Socios con 3 o más faltas:</b> ${a.socios_con_3_o_mas_faltas.map((x) => `${esc(x.nombre)} (${x.faltas}/${x.convocatorias})`).join(', ')}</p>` : ''}`}
      </div>`);
    } else out.push(bloqueNoDisponible('Asistencia'));

    // Comunicación
    const c = inf.comunicacion;
    if (c) {
      out.push(`<div class="im-block"><h3>📣 Comunicación</h3>
        <p class="im-muted">Noticias publicadas: <b>${c.noticias_publicadas}</b> · Notificaciones enviadas: <b>${c.notificaciones_enviadas}</b>${c.whatsapp ? ` · WhatsApp: <b>${c.whatsapp.mensajes}</b> enviados, <b>${pct(c.whatsapp.pct_leidos)}</b> leídos, ${c.whatsapp.fallidos} fallidos` : ''}.</p>
        ${c.titulos_noticias.length ? `<ul>${c.titulos_noticias.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </div>`);
    } else out.push(bloqueNoDisponible('Comunicación'));

    // App
    if (ap) {
      out.push(`<div class="im-block"><h3>📱 App del socio</h3>
        <p class="im-muted">Ingresaron alguna vez: <b>${ap.ingresaron_alguna_vez}</b> de ${ap.socios_activos} (${pct(ap.pct_alguna_vez)}) · últimos 30 días: <b>${ap.ingresaron_ultimos_30_dias}</b> · últimos 90 días: <b>${ap.ingresaron_ultimos_90_dias}</b> · nunca ingresaron: <b>${ap.nunca_ingresaron}</b>.
        ${inf.app_variacion_pct_30d !== null && inf.app_variacion_pct_30d !== undefined ? `<br>Variación contra el informe anterior: <b>${inf.app_variacion_pct_30d > 0 ? '+' : ''}${inf.app_variacion_pct_30d} puntos</b>.` : ''}</p>
        <div class="im-bar"><span style="width:${ap.pct_30_dias || 0}%"></span></div>
      </div>`);
    } else out.push(bloqueNoDisponible('App del socio'));

    // Panel
    const p = inf.panel;
    if (p) {
      out.push(`<div class="im-block"><h3>🖥️ Uso del panel</h3>
        <p class="im-muted"><b>${p.acciones}</b> acción(es) de carga o edición en <b>${p.dias_activos}</b> día(s), por <b>${p.usuarios_activos}</b> usuario(s).</p>
        ${p.secciones.length ? `<p class="im-muted">Secciones más usadas: ${p.secciones.map((x) => `${esc(x.seccion)} (${x.acciones})`).join(', ')}.</p>` : ''}
      </div>`);
    }

    $('imContenido').innerHTML = out.join('');
    $('imContenido').querySelectorAll('[data-ir]').forEach((b) => {
      b.addEventListener('click', () => document.querySelector(`[data-section="${b.dataset.ir}"]`)?.click());
    });
  }

  window.initInformeMensualSection = async function () {
    const clubId = localStorage.getItem('activeClubId');
    const sel = $('imPeriodo');
    const base = `/club/${clubId}/informes-mensuales`;
    const puedeRegenerar = window.__clubPerms?.canWrite?.('reportes') && window.__clubPerms?.role === 'admin';

    async function cargar(valor) {
      $('imEstado').textContent = 'Cargando…';
      $('imContenido').innerHTML = '';
      $('imRegenerar').style.display = puedeRegenerar && valor !== 'actual' ? '' : 'none';
      const { res, data } = await api(`${base}/${valor}`);
      if (!res.ok || !data?.ok) {
        $('imEstado').textContent = data?.error || 'No se pudo cargar el informe.';
        return;
      }
      $('imEstado').textContent = data.generado_at ? `Generado el ${new Date(data.generado_at).toLocaleString('es-AR')}` : '';
      render(data.informe, clubId);
    }

    const { res, data } = await api(base);
    if (!res.ok || !data?.ok) {
      $('imEstado').textContent = data?.error || 'No se pudo cargar el listado.';
      return;
    }
    sel.innerHTML = `<option value="actual">Mes en curso (${esc(nombrePeriodo(data.periodo_actual))})</option>` +
      data.informes.map((i) => `<option value="${esc(i.periodo)}">${esc(nombrePeriodo(i.periodo))}</option>`).join('');
    sel.addEventListener('change', () => cargar(sel.value));
    $('imImprimir').addEventListener('click', () => window.print());
    $('imRegenerar').addEventListener('click', async () => {
      if (!confirm('Se recalcula este informe con los datos de hoy. ¿Continuar?')) return;
      $('imEstado').textContent = 'Regenerando…';
      const r = await api(`${base}/${sel.value}/regenerar`, { method: 'POST' });
      if (!r.res.ok) { $('imEstado').textContent = r.data?.error || 'No se pudo regenerar.'; return; }
      cargar(sel.value);
    });

    // Si ya hay un informe del mes anterior, abrimos ese; si no, el mes en curso.
    if (data.informes.length) sel.value = data.informes[0].periodo;
    cargar(sel.value);
  };

  // ===============================
  // Pop-up de bienvenida mensual: la primera vez que se entra al panel en el
  // mes, invita a revisar el informe del mes anterior (una vez por club y mes,
  // por navegador). Solo si el usuario tiene acceso y el informe ya existe.
  // ===============================
  function popupInformeMensual(periodoAnterior, clubId) {
    if (document.getElementById('imPopupOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'imPopupOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:28px 24px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:Arial,sans-serif;">
        <div style="font-size:44px;line-height:1;margin-bottom:8px;">📈</div>
        <h3 style="margin:0 0 8px;font-size:20px;color:#111827;">¡Ya está listo tu informe de ${esc(nombrePeriodo(periodoAnterior))}!</h3>
        <p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.5;">Preparamos un resumen con la cobranza, los socios con deuda, la asistencia y el uso de la app. Tomate un minutito para revisarlo: ¡gracias por hacer crecer tu club! 💙</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button id="imPopupVer" class="btn btn-primary" style="padding:10px 18px;">Ver informe</button>
          <button id="imPopupLuego" class="btn" style="padding:10px 18px;">Más tarde</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const cerrar = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) cerrar(); });
    document.getElementById('imPopupLuego').addEventListener('click', cerrar);
    document.getElementById('imPopupVer').addEventListener('click', () => {
      cerrar();
      document.querySelector('[data-section="informe-mensual"]')?.click();
    });
  }

  async function chequearPopupInformeMensual() {
    try {
      // Esperamos a que el panel termine de cargar rol y club (hasta ~20 s)
      let intentos = 0;
      while ((!window.__clubPerms || !localStorage.getItem('activeClubId')) && intentos < 40) {
        await new Promise((r) => setTimeout(r, 500));
        intentos++;
      }
      const perms = window.__clubPerms;
      const clubId = localStorage.getItem('activeClubId');
      if (!perms || !clubId || !perms.canAccess('informe-mensual')) return;

      const { res, data } = await api(`/club/${clubId}/informes-mensuales`);
      if (!res.ok || !data?.ok || !data.informes.length) return;

      const [a, m] = String(data.periodo_actual).split('-').map(Number);
      const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
      if (!data.informes.some((i) => i.periodo === ant)) return;

      const key = `im_popup_${clubId}_${data.periodo_actual}`;
      try { if (localStorage.getItem(key)) return; } catch {}
      try { localStorage.setItem(key, '1'); } catch {}
      popupInformeMensual(ant, clubId);
    } catch (e) {
      // best-effort: si algo falla, simplemente no se muestra el aviso
    }
  }

  chequearPopupInformeMensual();
})();
