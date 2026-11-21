// src/services/informeMensualService.js
//
// Informe mensual de uso de la plataforma, por club. Es 100% reglas fijas y
// consultas SQL (sin IA): cobranza, socios que deben 2 o más cuotas,
// asistencia, noticias/notificaciones, uso de la app del socio y uso del
// panel, más una lista de alertas armada con reglas simples.
//
// - calcularInforme(clubId, periodo): calcula el informe (no guarda nada).
// - generarYGuardar(clubId, periodo): calcula y hace UPSERT en informes_mensuales.
// - procesarInformesMensuales(): worker. Genera el informe del mes anterior para
//   los clubes que todavía no lo tienen. Corre al iniciar y cada hora desde
//   app.js; como solo trabaja si falta algún informe, es liviano.
//
// Notas:
// - "Morosos" y "app" muestran el estado AL MOMENTO DE GENERAR el informe (el
//   worker lo genera el día 1, o sea al cierre del mes).
// - El criterio de "al día" es el mismo que usa el resto del sistema (día de
//   corte del club: payment_due_day), ver pagos/socios.
const db = require('../db');

const MAX_MOROSOS_LISTADOS = 100;

// ===============================
// Fechas / períodos ('YYYY-MM')
// ===============================
function periodoDeFecha(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

function parsePeriodo(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo || ''));
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12) return null;
  const sig = mes === 12 ? { a: anio + 1, m: 1 } : { a: anio, m: mes + 1 };
  return {
    periodo: periodoDeFecha(anio, mes),
    anio,
    mes,
    desde: `${anio}-${String(mes).padStart(2, '0')}-01`,
    hasta: `${sig.a}-${String(sig.m).padStart(2, '0')}-01`, // exclusivo
  };
}

function periodoAnterior(periodo) {
  const p = parsePeriodo(periodo);
  if (!p) return null;
  return p.mes === 1 ? periodoDeFecha(p.anio - 1, 12) : periodoDeFecha(p.anio, p.mes - 1);
}

// Mes actual en hora de Argentina (el server corre en UTC)
function periodoActual(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = parts.find((x) => x.type === 'year').value;
  const m = parts.find((x) => x.type === 'month').value;
  return `${y}-${m}`;
}

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null); // 1 decimal

// Si un bloque falla (ej: una tabla opcional que todavía no existe en la base)
// no se cae todo el informe: ese bloque queda en null.
async function seguro(nombre, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`⚠ informe mensual (${nombre}):`, e.message);
    return null;
  }
}

// ===============================
// Bloques
// ===============================
async function bloqueClub(clubId) {
  const r = await db.query(
    `SELECT name, payment_due_day,
            COALESCE(whatsapp_habilitado, false) AS whatsapp_habilitado,
            COALESCE(whatsapp_limite_mensual, 0) AS whatsapp_limite_mensual,
            COALESCE(tienda_habilitada, false) AS tienda_habilitada
     FROM clubs WHERE id = $1`,
    [clubId]
  );
  return r.rows[0] || null;
}

async function bloqueSocios(clubId, p) {
  const r = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE activo = true)::int AS activos,
       COUNT(*) FILTER (WHERE activo = true AND becado = true)::int AS becados,
       COUNT(*) FILTER (WHERE fecha_ingreso >= $2 AND fecha_ingreso < $3)::int AS altas_mes,
       COUNT(*) FILTER (WHERE activo = true AND (telefono IS NULL OR telefono = ''))::int AS sin_telefono
     FROM socios WHERE club_id = $1`,
    [clubId, p.desde, p.hasta]
  );
  const x = r.rows[0];
  return {
    activos: x.activos,
    becados: x.becados,
    altas_mes: x.altas_mes,
    sin_telefono: x.sin_telefono,
  };
}

async function bloqueFinanzas(clubId, p, pAnt) {
  const q = `
    SELECT
      (SELECT COALESCE(SUM(monto),0) FROM pagos_mensuales
        WHERE club_id = $1 AND fecha_pago >= $2 AND fecha_pago < $3) AS cuotas,
      (SELECT COUNT(*) FROM pagos_mensuales
        WHERE club_id = $1 AND fecha_pago >= $2 AND fecha_pago < $3)::int AS cuotas_cantidad,
      (SELECT COUNT(DISTINCT socio_id) FROM pagos_mensuales
        WHERE club_id = $1 AND fecha_pago >= $2 AND fecha_pago < $3)::int AS socios_que_pagaron,
      (SELECT COALESCE(SUM(monto),0) FROM ingresos_generales
        WHERE club_id = $1 AND activo = true AND fecha >= $2 AND fecha < $3) AS otros_ingresos,
      (SELECT COALESCE(SUM(monto),0) FROM gastos
        WHERE club_id = $1 AND activo = true AND periodo >= $2 AND periodo < $3) AS gastos`;
  const [a, b] = await Promise.all([
    db.query(q, [clubId, p.desde, p.hasta]),
    db.query(q, [clubId, pAnt.desde, pAnt.hasta]),
  ]);
  const f = (x) => ({
    cuotas_cobradas: num(x.cuotas),
    cuotas_cantidad: x.cuotas_cantidad,
    socios_que_pagaron: x.socios_que_pagaron,
    otros_ingresos: num(x.otros_ingresos),
    gastos: num(x.gastos),
  });
  const act = f(a.rows[0]);
  const ant = f(b.rows[0]);
  const ingresos = act.cuotas_cobradas + act.otros_ingresos;
  const ingresosAnt = ant.cuotas_cobradas + ant.otros_ingresos;
  return {
    ...act,
    ingresos_totales: ingresos,
    resultado: ingresos - act.gastos,
    mes_anterior: {
      cuotas_cobradas: ant.cuotas_cobradas,
      ingresos_totales: ingresosAnt,
      gastos: ant.gastos,
    },
    variacion_cuotas_pct:
      ant.cuotas_cobradas > 0
        ? Math.round(((act.cuotas_cobradas - ant.cuotas_cobradas) / ant.cuotas_cobradas) * 1000) / 10
        : null,
  };
}

// Cuotas adeudadas por socio (mismo criterio de "al día" que el resto del sistema):
//  - se excluyen becados y actividades "por_clases"
//  - período exigido = mes actual si ya pasó el día de corte del club, si no el anterior
//  - cuotas adeudadas = período exigido - último mes pagado (en meses)
//  - los socios sin ningún pago registrado se cuentan aparte: puede ser que el
//    club nunca cargó sus pagos, y mezclarlos inflaría la lista de morosos.
async function bloqueMorosos(clubId) {
  const r = await db.query(
    `
    WITH base AS (
      SELECT
        s.id, s.numero_socio, s.nombre, s.apellido, s.actividad, s.telefono,
        s.fecha_ingreso,
        COALESCE((
          SELECT MAX(pm.anio::int * 100 + pm.mes::int)
          FROM pagos_mensuales pm
          WHERE pm.club_id = s.club_id AND pm.socio_id = s.id
        ), 0) AS ult_ym,
        (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int
          - CASE WHEN EXTRACT(DAY FROM CURRENT_DATE)::int <= COALESCE(c.payment_due_day, 31)
                 THEN 1 ELSE 0 END) AS req_idx
      FROM socios s
      JOIN clubs c ON c.id = s.club_id
      LEFT JOIN LATERAL (
        SELECT a.modalidad_pago
        FROM actividades a
        WHERE a.club_id = s.club_id AND a.nombre = s.actividad AND a.activo = true
        LIMIT 1
      ) act_dep ON true
      WHERE s.club_id = $1
        AND s.activo = true
        AND COALESCE(s.becado, false) = false
        AND COALESCE(act_dep.modalidad_pago, 'mensual') <> 'por_clases'
    ),
    calc AS (
      SELECT *,
        CASE WHEN ult_ym = 0 THEN NULL
             ELSE GREATEST(req_idx - ((ult_ym / 100) * 12 + (ult_ym % 100)), 0)
        END AS cuotas_adeudadas
      FROM base
    )
    SELECT id, numero_socio, nombre, apellido, actividad, telefono, ult_ym, cuotas_adeudadas
    FROM calc
    ORDER BY cuotas_adeudadas DESC NULLS LAST, ult_ym ASC, apellido, nombre
    `,
    [clubId]
  );

  const rows = r.rows;
  const conPagos = rows.filter((x) => x.cuotas_adeudadas !== null);
  const sinPagos = rows.filter((x) => x.cuotas_adeudadas === null);
  const al_dia = conPagos.filter((x) => Number(x.cuotas_adeudadas) === 0).length;
  const debe_1 = conPagos.filter((x) => Number(x.cuotas_adeudadas) === 1).length;
  const deben2 = conPagos.filter((x) => Number(x.cuotas_adeudadas) >= 2);
  const fmtYM = (ym) => {
    const v = Number(ym);
    return v ? `${Math.floor(v / 100)}-${String(v % 100).padStart(2, '0')}` : null;
  };

  return {
    total_evaluados: rows.length,
    al_dia,
    debe_1_cuota: debe_1,
    deben_2_o_mas: deben2.length,
    deben_3_o_mas: deben2.filter((x) => Number(x.cuotas_adeudadas) >= 3).length,
    sin_pagos_registrados: sinPagos.length,
    pct_al_dia: pct(al_dia, conPagos.length),
    listado_truncado: deben2.length > MAX_MOROSOS_LISTADOS,
    listado: deben2.slice(0, MAX_MOROSOS_LISTADOS).map((x) => ({
      socio_id: x.id,
      numero: x.numero_socio,
      nombre: `${x.apellido || ''} ${x.nombre || ''}`.trim(),
      actividad: x.actividad || null,
      telefono: x.telefono || null,
      cuotas_adeudadas: Number(x.cuotas_adeudadas),
      ultimo_pago: fmtYM(x.ult_ym),
    })),
  };
}

async function bloqueAsistencia(clubId, p) {
  const [tot, porAct, faltas] = await Promise.all([
    db.query(
      `SELECT
         COUNT(DISTINCT e.id)::int AS eventos,
         COUNT(DISTINCT e.id) FILTER (WHERE e.tipo = 'entrenamiento')::int AS entrenamientos,
         COUNT(DISTINCT e.id) FILTER (WHERE e.tipo = 'partido')::int AS partidos,
         COUNT(d.id) FILTER (WHERE d.origen = 'convocado' AND d.presente = true)::int AS conv_presentes,
         COUNT(d.id) FILTER (WHERE d.origen = 'convocado')::int AS convocatorias,
         COUNT(DISTINCT d.socio_id) FILTER (WHERE d.presente = true)::int AS socios_distintos
       FROM asistencia_eventos e
       LEFT JOIN asistencia_detalle d ON d.evento_id = e.id
       WHERE e.club_id = $1 AND e.fecha >= $2 AND e.fecha < $3`,
      [clubId, p.desde, p.hasta]
    ),
    db.query(
      `SELECT e.actividad,
              COUNT(DISTINCT e.id)::int AS eventos,
              COUNT(d.id) FILTER (WHERE d.origen = 'convocado' AND d.presente = true)::int AS presentes,
              COUNT(d.id) FILTER (WHERE d.origen = 'convocado')::int AS convocatorias
       FROM asistencia_eventos e
       LEFT JOIN asistencia_detalle d ON d.evento_id = e.id
       WHERE e.club_id = $1 AND e.fecha >= $2 AND e.fecha < $3
       GROUP BY e.actividad
       ORDER BY eventos DESC, e.actividad
       LIMIT 15`,
      [clubId, p.desde, p.hasta]
    ),
    db.query(
      `SELECT s.id, s.numero_socio, s.nombre, s.apellido,
              COUNT(*) FILTER (WHERE d.presente = false)::int AS faltas,
              COUNT(*)::int AS convocatorias
       FROM asistencia_detalle d
       JOIN asistencia_eventos e ON e.id = d.evento_id
       JOIN socios s ON s.id = d.socio_id
       WHERE e.club_id = $1 AND e.fecha >= $2 AND e.fecha < $3 AND d.origen = 'convocado'
       GROUP BY s.id, s.numero_socio, s.nombre, s.apellido
       HAVING COUNT(*) FILTER (WHERE d.presente = false) >= 3
       ORDER BY faltas DESC, s.apellido, s.nombre
       LIMIT 10`,
      [clubId, p.desde, p.hasta]
    ),
  ]);
  const t = tot.rows[0];
  return {
    eventos: t.eventos,
    entrenamientos: t.entrenamientos,
    partidos: t.partidos,
    convocatorias: t.convocatorias,
    presentes: t.conv_presentes,
    pct_asistencia: pct(t.conv_presentes, t.convocatorias),
    promedio_presentes_por_evento: t.eventos > 0 ? Math.round((t.conv_presentes / t.eventos) * 10) / 10 : null,
    por_actividad: porAct.rows.map((x) => ({
      actividad: x.actividad || 'Sin actividad',
      eventos: x.eventos,
      pct_asistencia: pct(x.presentes, x.convocatorias),
    })),
    socios_con_3_o_mas_faltas: faltas.rows.map((x) => ({
      socio_id: x.id,
      numero: x.numero_socio,
      nombre: `${x.apellido || ''} ${x.nombre || ''}`.trim(),
      faltas: x.faltas,
      convocatorias: x.convocatorias,
    })),
  };
}

async function bloqueComunicacion(clubId, p, whatsappHabilitado) {
  const [nt, nf, wa] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS n,
              (ARRAY_AGG(titulo ORDER BY created_at DESC))[1:5] AS titulos
       FROM noticias
       WHERE club_id = $1 AND created_at >= $2 AND created_at < $3`,
      [clubId, p.desde, p.hasta]
    ),
    db.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE canal IN ('whatsapp','ambos'))::int AS con_whatsapp
       FROM notificaciones
       WHERE club_id = $1 AND activo = true AND sent_at IS NOT NULL
         AND created_at >= $2 AND created_at < $3`,
      [clubId, p.desde, p.hasta]
    ),
    whatsappHabilitado
      ? db.query(
          `SELECT COUNT(*)::int AS enviados,
                  COUNT(*) FILTER (WHERE status IN ('entregado','leido'))::int AS entregados,
                  COUNT(*) FILTER (WHERE status = 'leido')::int AS leidos,
                  COUNT(*) FILTER (WHERE status = 'fallido')::int AS fallidos
           FROM whatsapp_mensajes
           WHERE club_id = $1 AND created_at >= $2 AND created_at < $3`,
          [clubId, p.desde, p.hasta]
        )
      : Promise.resolve(null),
  ]);
  const w = wa && wa.rows[0];
  return {
    noticias_publicadas: nt.rows[0].n,
    titulos_noticias: nt.rows[0].titulos || [],
    notificaciones_enviadas: nf.rows[0].n,
    notificaciones_con_whatsapp: nf.rows[0].con_whatsapp,
    whatsapp: w
      ? {
          mensajes: w.enviados,
          entregados: w.entregados,
          leidos: w.leidos,
          fallidos: w.fallidos,
          pct_leidos: pct(w.leidos, w.enviados),
        }
      : null,
  };
}

async function bloqueApp(clubId) {
  const r = await db.query(
    `SELECT
       COUNT(*)::int AS activos,
       COUNT(*) FILTER (WHERE ultimo_login_app IS NOT NULL)::int AS alguna_vez,
       COUNT(*) FILTER (WHERE ultimo_login_app >= NOW() - INTERVAL '30 days')::int AS ult_30d,
       COUNT(*) FILTER (WHERE ultimo_login_app >= NOW() - INTERVAL '90 days')::int AS ult_90d
     FROM socios WHERE club_id = $1 AND activo = true`,
    [clubId]
  );
  const x = r.rows[0];
  return {
    socios_activos: x.activos,
    ingresaron_alguna_vez: x.alguna_vez,
    ingresaron_ultimos_30_dias: x.ult_30d,
    ingresaron_ultimos_90_dias: x.ult_90d,
    nunca_ingresaron: x.activos - x.alguna_vez,
    pct_30_dias: pct(x.ult_30d, x.activos),
    pct_alguna_vez: pct(x.alguna_vez, x.activos),
  };
}

async function bloquePanel(clubId, p) {
  const [tot, sec] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS acciones,
              COUNT(DISTINCT created_at::date)::int AS dias_activos,
              COUNT(DISTINCT COALESCE(user_id::text, email))::int AS usuarios
       FROM admin_activity_log
       WHERE club_id = $1 AND created_at >= $2 AND created_at < $3`,
      [clubId, p.desde, p.hasta]
    ),
    db.query(
      `SELECT substring(ruta from '/club/[^/]+/([^/?]+)') AS seccion, COUNT(*)::int AS acciones
       FROM admin_activity_log
       WHERE club_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY 1
       HAVING substring(ruta from '/club/[^/]+/([^/?]+)') IS NOT NULL
       ORDER BY acciones DESC
       LIMIT 8`,
      [clubId, p.desde, p.hasta]
    ),
  ]);
  const t = tot.rows[0];
  return {
    acciones: t.acciones,
    dias_activos: t.dias_activos,
    usuarios_activos: t.usuarios,
    secciones: sec.rows,
  };
}

// ===============================
// Alertas (reglas fijas)
// nivel: 'alta' | 'media' | 'info'; seccion = a dónde ir en el panel
// ===============================
function armarAlertas(inf, anterior) {
  const out = [];
  const add = (nivel, texto, seccion) => out.push({ nivel, texto, seccion: seccion || null });
  const m = inf.morosos;
  const f = inf.finanzas;
  const a = inf.asistencia;
  const c = inf.comunicacion;
  const ap = inf.app;
  const pn = inf.panel;

  if (m && m.deben_2_o_mas > 0) {
    add(
      'alta',
      `${m.deben_2_o_mas} socio(s) deben 2 o más cuotas` +
        (m.deben_3_o_mas ? ` (${m.deben_3_o_mas} con 3 o más)` : '') +
        '. Podés avisarles desde Notificaciones, eligiendo el destino "Falta de pago".',
      'notificaciones'
    );
  }
  if (m && m.debe_1_cuota > 0) {
    add('media', `${m.debe_1_cuota} socio(s) deben 1 cuota: un recordatorio a tiempo evita que pasen a deber 2.`, 'notificaciones');
  }
  if (m && m.sin_pagos_registrados > 0) {
    add(
      'info',
      `${m.sin_pagos_registrados} socio(s) activos no tienen ningún pago registrado. Si ya pagaron, cargá sus pagos para que la cobranza se vea completa.`,
      'socios'
    );
  }
  if (f && f.variacion_cuotas_pct !== null && f.variacion_cuotas_pct <= -20) {
    add('alta', `La cobranza de cuotas cayó ${Math.abs(f.variacion_cuotas_pct)}% respecto del mes anterior.`, 'reportes');
  }
  if (f && f.gastos > f.ingresos_totales && f.gastos > 0) {
    add('media', 'Los gastos del mes superaron a los ingresos.', 'reportes');
  }
  if (a) {
    if (a.eventos === 0) {
      const habiaAntes = anterior && anterior.asistencia && anterior.asistencia.eventos > 0;
      add(
        habiaAntes ? 'media' : 'info',
        habiaAntes
          ? 'No se registró asistencia este mes (el mes anterior sí).'
          : 'No se registró asistencia este mes. Con ella podés ver quién deja de venir antes de que se dé de baja.',
        'asistencia'
      );
    } else if (a.socios_con_3_o_mas_faltas.length > 0) {
      add('media', `${a.socios_con_3_o_mas_faltas.length} socio(s) tuvieron 3 o más faltas este mes.`, 'reportes');
    }
  }
  if (c) {
    if (c.noticias_publicadas === 0) add('info', 'No publicaste noticias este mes. Una noticia por semana mantiene a los socios conectados.', 'noticias');
    if (c.notificaciones_enviadas === 0) add('info', 'No enviaste notificaciones este mes.', 'notificaciones');
    if (c.whatsapp && c.whatsapp.fallidos > 0) {
      add('media', `${c.whatsapp.fallidos} mensaje(s) de WhatsApp fallaron. Revisá que los teléfonos de esos socios estén bien cargados.`, 'notificaciones');
    }
  }
  if (ap && ap.socios_activos >= 20) {
    if (ap.pct_30_dias !== null && ap.pct_30_dias < 15) {
      add(
        'media',
        `Solo el ${ap.pct_30_dias}% de los socios abrió la app en los últimos 30 días. Probá avisarles por notificación y WhatsApp que ya tienen el carnet y los recibos en la app.`,
        'notificaciones'
      );
    }
    if (ap.nunca_ingresaron > ap.socios_activos / 2) {
      add('info', `${ap.nunca_ingresaron} socio(s) nunca ingresaron a la app.`, 'socios');
    }
  }
  if (pn && pn.acciones === 0) {
    add('info', 'No hubo actividad en el panel este mes.', null);
  }
  if (inf.club && inf.club.whatsapp_habilitado && inf.club.whatsapp_limite_mensual > 0 && c && c.whatsapp) {
    const usoPct = (c.whatsapp.mensajes / inf.club.whatsapp_limite_mensual) * 100;
    if (usoPct >= 80) {
      add('media', `Usaste el ${Math.round(usoPct)}% del cupo mensual de WhatsApp.`, null);
    }
  }
  const orden = { alta: 0, media: 1, info: 2 };
  out.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
  return out;
}

// ===============================
// Informe completo de un club para un período
// ===============================
async function calcularInforme(clubId, periodo) {
  const p = parsePeriodo(periodo);
  if (!p) throw new Error('Período inválido (esperado YYYY-MM)');
  const pAnt = parsePeriodo(periodoAnterior(periodo));

  const club = await bloqueClub(clubId);
  if (!club) throw new Error('Club no encontrado');

  const [socios, finanzas, morosos, asistencia, comunicacion, app, panel, rAnt] = await Promise.all([
    seguro('socios', () => bloqueSocios(clubId, p)),
    seguro('finanzas', () => bloqueFinanzas(clubId, p, pAnt)),
    seguro('morosos', () => bloqueMorosos(clubId)),
    seguro('asistencia', () => bloqueAsistencia(clubId, p)),
    seguro('comunicacion', () => bloqueComunicacion(clubId, p, club.whatsapp_habilitado)),
    seguro('app', () => bloqueApp(clubId)),
    seguro('panel', () => bloquePanel(clubId, p)),
    seguro('informe anterior', () =>
      db.query(`SELECT datos FROM informes_mensuales WHERE club_id = $1 AND periodo = $2`, [clubId, pAnt.periodo])
    ),
  ]);

  const anterior = rAnt && rAnt.rows[0] ? rAnt.rows[0].datos : null;

  const informe = {
    version: 1,
    periodo: p.periodo,
    parcial: p.periodo === periodoActual(), // mes en curso: números hasta hoy
    generado_at: new Date().toISOString(),
    club: {
      nombre: club.name,
      payment_due_day: club.payment_due_day,
      whatsapp_habilitado: club.whatsapp_habilitado,
      whatsapp_limite_mensual: club.whatsapp_limite_mensual,
      tienda_habilitada: club.tienda_habilitada,
    },
    socios,
    finanzas,
    morosos,
    asistencia,
    comunicacion,
    app,
    panel,
    // variación de la app contra el informe del mes anterior (si existe)
    app_variacion_pct_30d:
      app && anterior && anterior.app && anterior.app.pct_30_dias !== null && app.pct_30_dias !== null
        ? Math.round((app.pct_30_dias - anterior.app.pct_30_dias) * 10) / 10
        : null,
  };
  informe.alertas = armarAlertas(informe, anterior);
  return informe;
}

async function generarYGuardar(clubId, periodo) {
  const informe = await calcularInforme(clubId, periodo);
  await db.query(
    `INSERT INTO informes_mensuales (club_id, periodo, datos, generado_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (club_id, periodo)
     DO UPDATE SET datos = EXCLUDED.datos, generado_at = NOW()`,
    [clubId, informe.periodo, JSON.stringify(informe)]
  );
  return informe;
}

// ===============================
// Worker: genera el informe del mes anterior para los clubes que no lo tienen
// ===============================
let corriendo = false;

async function procesarInformesMensuales() {
  if (corriendo) return 0;
  corriendo = true;
  try {
    const periodo = periodoAnterior(periodoActual());
    const r = await db.query(
      `SELECT c.id
       FROM clubs c
       WHERE COALESCE(c.is_active, true) = true
         AND c.estado = 'productivo'
         AND NOT EXISTS (
           SELECT 1 FROM informes_mensuales i WHERE i.club_id = c.id AND i.periodo = $1
         )
       ORDER BY c.created_at NULLS LAST`,
      [periodo]
    );
    let n = 0;
    for (const row of r.rows) {
      try {
        await generarYGuardar(row.id, periodo);
        n++;
      } catch (e) {
        console.error(`❌ Informe mensual club ${row.id} (${periodo}):`, e.message);
      }
    }
    if (n > 0) console.log(`📊 Informes mensuales ${periodo}: ${n} generado(s)`);
    return n;
  } catch (e) {
    // 42P01 = todavía no se corrió la migración: no ensuciamos el log cada hora
    if (e && (e.code === '42P01' || e.code === '42703')) return 0;
    console.error('❌ Worker informes mensuales:', e.message);
    return 0;
  } finally {
    corriendo = false;
  }
}

module.exports = {
  parsePeriodo,
  periodoAnterior,
  periodoActual,
  calcularInforme,
  generarYGuardar,
  procesarInformesMensuales,
};
