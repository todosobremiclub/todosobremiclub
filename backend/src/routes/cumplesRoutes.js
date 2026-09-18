// src/routes/cumplesRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// CORS para Flutter Web
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ===============================
// Helpers básicos
// ===============================
function isISODate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isTimeHHMM(v) {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
}
function isYYYYMM(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
}
function isValidRecurrenciaTipo(v) {
  return ['diario', 'semanal', 'mensual', 'anual'].includes(v);
}

function argentinaNow() {
  const ahora = new Date();
  return new Date(
    ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
  );
}

function monthRangeFromYYYYMM(yyyymm) {
  const [ys, ms] = String(yyyymm).split('-');
  const y = Number(ys);
  const m = Number(ms);

  const start = `${ys}-${ms}-01`;

  let ny = y;
  let nm = m + 1;
  if (nm === 13) {
    nm = 1;
    ny = y + 1;
  }
  const endExclusive = `${String(ny)}-${String(nm).padStart(2, '0')}-01`;

  return { start, endExclusive };
}

function canWriteAgenda(req, clubId) {
  const roles = req.user?.roles || [];
  return roles.some(
    (r) =>
      r.role === 'superadmin' ||
      (String(r.club_id) === String(clubId) && String(r.role) !== 'solo_lectura')
  );
}

// ===============================
// Helpers de fechas (recurrencia)
// ===============================
function yearsInRange(start, endExclusive) {
  const y1 = Number(String(start).slice(0, 4));
  const y2 = Number(String(endExclusive).slice(0, 4));
  const years = new Set([y1, y2]);
  return Array.from(years);
}

function mondayOf(d) {
  const day = d.getDay(); // 0=Dom..6=Sab
  const diff = day === 0 ? -6 : 1 - day; // días para llegar al lunes de esa semana
  const r = new Date(d);
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDaysLocal(d, days) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function addMonthsSafe(d, months) {
  const r = new Date(d);
  const targetDay = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(targetDay, lastDay));
  return r;
}

function addYearsSafe(d, years) {
  return addMonthsSafe(d, years * 12);
}

function fechaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MAX_OCURRENCIAS = 400;

/**
 * Genera las fechas (Date, 00:00 local) en que ocurre una actividad
 * dentro del rango [rangeStart, rangeEndExclusive) (strings YYYY-MM-DD).
 * Si la actividad no es recurrente, devuelve [] o [fecha] según corresponda.
 */
function generarOcurrencias(act, rangeStart, rangeEndExclusive) {
  const rangeStartD = new Date(`${rangeStart}T00:00:00`);
  const rangeEndD = new Date(`${rangeEndExclusive}T00:00:00`);
  const anchor = new Date(`${act.fecha_iso}T00:00:00`);
  const tipo = act.recurrencia_tipo;

  if (!tipo) {
    if (anchor >= rangeStartD && anchor < rangeEndD) return [anchor];
    return [];
  }

  const intervalo = Math.max(1, Number(act.recurrencia_intervalo) || 1);
  const hasta = act.recurrencia_hasta ? new Date(`${act.recurrencia_hasta}T00:00:00`) : null;
  const limiteFin = hasta && hasta < rangeEndD ? hasta : addDaysLocal(rangeEndD, -1);

  if (anchor > limiteFin) return [];

  const out = [];

  if (tipo === 'diario') {
    let cursor = new Date(anchor);
    if (cursor < rangeStartD) {
      const diffDias = Math.round((rangeStartD - cursor) / 86400000);
      const pasos = Math.ceil(diffDias / intervalo);
      cursor = addDaysLocal(cursor, pasos * intervalo);
    }
    while (cursor <= limiteFin && cursor < rangeEndD && out.length < MAX_OCURRENCIAS) {
      if (cursor >= rangeStartD) out.push(new Date(cursor));
      cursor = addDaysLocal(cursor, intervalo);
    }
  } else if (tipo === 'semanal') {
    const diasSemana =
      Array.isArray(act.recurrencia_dias_semana) && act.recurrencia_dias_semana.length
        ? act.recurrencia_dias_semana.map(Number)
        : [anchor.getDay()];

    let semanaCursor = mondayOf(anchor);
    while (semanaCursor <= limiteFin && out.length < MAX_OCURRENCIAS) {
      for (const dow of diasSemana) {
        const offset = dow === 0 ? 6 : dow - 1; // lunes=0 .. domingo=6
        const dia = addDaysLocal(semanaCursor, offset);
        if (dia >= anchor && dia <= limiteFin && dia >= rangeStartD && dia < rangeEndD) {
          out.push(dia);
        }
      }
      semanaCursor = addDaysLocal(semanaCursor, intervalo * 7);
    }
    out.sort((a, b) => a - b);
  } else if (tipo === 'mensual') {
    let cursor = new Date(anchor);
    while (cursor <= limiteFin && out.length < MAX_OCURRENCIAS) {
      if (cursor >= rangeStartD && cursor < rangeEndD) out.push(new Date(cursor));
      cursor = addMonthsSafe(cursor, intervalo);
    }
  } else if (tipo === 'anual') {
    let cursor = new Date(anchor);
    while (cursor <= limiteFin && out.length < MAX_OCURRENCIAS) {
      if (cursor >= rangeStartD && cursor < rangeEndD) out.push(new Date(cursor));
      cursor = addYearsSafe(cursor, intervalo);
    }
  }

  return out;
}

/**
 * GET /club/:clubId/cumples?mes=YYYY-MM
 * GET /club/:clubId/cumples?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (hasta = exclusivo)
 * Devuelve:
 *  - hoy: socios que cumplen hoy (Argentina)
 *  - eventos: cumpleaños + actividades (expandiendo recurrencias) dentro del rango
 *
 * Compatibilidad: la app mobile sigue usando "mes" tal cual antes.
 * El admin web (vista semana/mes de FullCalendar) usa "desde"/"hasta" para traer
 * exactamente el rango visible, incluso cuando cruza mes o año.
 */
router.get('/:clubId/cumples', requireAuth, async (req, res) => {
  try {
    const { clubId } = req.params;
    const mesParam = String(req.query?.mes || '').trim(); // opcional
    const desdeParam = String(req.query?.desde || '').trim(); // opcional
    const hastaParam = String(req.query?.hasta || '').trim(); // opcional

    if (mesParam && !isYYYYMM(mesParam)) {
      return res.status(400).json({ ok: false, error: 'mes inválido (use YYYY-MM)' });
    }
    if ((desdeParam && !isISODate(desdeParam)) || (hastaParam && !isISODate(hastaParam))) {
      return res.status(400).json({ ok: false, error: '"desde"/"hasta" inválidos (use YYYY-MM-DD)' });
    }

    const hoyArg = argentinaNow();

    let start;
    let endExclusive;
    let yearCalendar;

    if (desdeParam && hastaParam) {
      start = desdeParam;
      endExclusive = hastaParam;
      yearCalendar = Number(start.slice(0, 4));
    } else if (mesParam) {
      ({ start, endExclusive } = monthRangeFromYYYYMM(mesParam));
      yearCalendar = Number(mesParam.slice(0, 4));
    } else {
      yearCalendar = hoyArg.getFullYear();
      start = `${yearCalendar}-01-01`;
      endExclusive = `${yearCalendar + 1}-01-01`;
    }

    // ¿Token de admin?
    const roles = req.user?.roles || [];
    const esAdmin = roles.some(
      (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
    );

    // “Hoy” para banner
    const hoyMes = hoyArg.getMonth() + 1;
    const hoyDia = hoyArg.getDate();

    let queryText;
    let queryParams;

    if (esAdmin) {
      queryText = `
        SELECT
          id,
          nombre,
          apellido,
          actividad,
          categoria,
          foto_url,
          fecha_nacimiento,
          EXTRACT(MONTH FROM fecha_nacimiento) AS mes_nac,
          EXTRACT(DAY FROM fecha_nacimiento) AS dia_nac,
          DATE_PART('year', AGE(fecha_nacimiento))::int AS edad
        FROM socios
        WHERE club_id = $1
          AND activo = true
        ORDER BY EXTRACT(MONTH FROM fecha_nacimiento), EXTRACT(DAY FROM fecha_nacimiento)
      `;
      queryParams = [clubId];
    } else if (req.user?.socioId) {
      const socioId = req.user.socioId;

      const rs = await db.query(
        'SELECT actividad, club_id FROM socios WHERE id = $1 LIMIT 1',
        [socioId]
      );
      if (!rs.rowCount) {
        return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
      }

      const actividad = rs.rows[0].actividad;
      const socioClubId = rs.rows[0].club_id;

      if (String(socioClubId) !== String(clubId)) {
        return res.status(403).json({ ok: false, error: 'El socio no pertenece a este club' });
      }

      queryText = `
        SELECT
          id,
          nombre,
          apellido,
          actividad,
          categoria,
          foto_url,
          fecha_nacimiento,
          EXTRACT(MONTH FROM fecha_nacimiento) AS mes_nac,
          EXTRACT(DAY FROM fecha_nacimiento) AS dia_nac,
          DATE_PART('year', AGE(fecha_nacimiento))::int AS edad
        FROM socios
        WHERE club_id = $1
          AND activo = true
          AND actividad = $2
        ORDER BY EXTRACT(MONTH FROM fecha_nacimiento), EXTRACT(DAY FROM fecha_nacimiento)
      `;
      queryParams = [clubId, actividad];
    } else {
      return res.status(400).json({ ok: false, error: 'Token inválido para cumples.' });
    }

    const r = await db.query(queryText, queryParams);

    // Cumples de HOY (banner)
    const cumpleHoy = r.rows.filter(
      (s) => Number(s.mes_nac) === hoyMes && Number(s.dia_nac) === hoyDia
    );

    // Cumpleaños como eventos allDay, resolviendo el/los años que toca el rango
    // (una semana o un mes visible puede cruzar de un año a otro).
    const anios = yearsInRange(start, endExclusive);
    const eventosCumples = [];

    r.rows.forEach((s) => {
      const mm = String(s.mes_nac).padStart(2, '0');
      const dd = String(s.dia_nac).padStart(2, '0');

      anios.forEach((anio) => {
        const fecha = `${anio}-${mm}-${dd}`;
        if (fecha >= start && fecha < endExclusive) {
          eventosCumples.push({
            id: `cumple-${s.id}-${fecha}`,
            title: `🎂 ${s.nombre} ${s.apellido}`.trim(),
            date: fecha,
            allDay: true,
            classNames: ['evento-cumple'],
            extendedProps: {
              kind: 'cumple',
              socio_id: s.id,
              categoria: s.categoria,
              actividad: s.actividad,
              edad: s.edad,
            },
          });
        }
      });
    });

    // Actividades (expandiendo recurrencias dentro del rango)
    const ra = await db.query(
      `
      SELECT
        id,
        to_char(fecha::date, 'YYYY-MM-DD') AS fecha_iso,
        to_char(hora_desde::time, 'HH24:MI') AS hd,
        to_char(hora_hasta::time, 'HH24:MI') AS hh,
        titulo,
        descripcion,
        recurrencia_tipo,
        recurrencia_intervalo,
        recurrencia_dias_semana,
        to_char(recurrencia_hasta::date, 'YYYY-MM-DD') AS recurrencia_hasta
      FROM agenda_actividades
      WHERE club_id = $1
        AND activo = true
        AND fecha::date < $3::date
        AND (recurrencia_tipo IS NOT NULL OR fecha::date >= $2::date)
        AND (recurrencia_tipo IS NULL OR recurrencia_hasta IS NULL OR recurrencia_hasta >= $2::date)
      ORDER BY fecha ASC, hora_desde ASC
      `,
      [clubId, start, endExclusive]
    );

    const eventosActividades = [];
    (ra.rows || []).forEach((a) => {
      const hd = a.hd || '00:00';
      const hh = a.hh || '00:30';
      const esRecurrente = !!a.recurrencia_tipo;
      const ocurrencias = generarOcurrencias(a, start, endExclusive);

      ocurrencias.forEach((fechaDate) => {
        const fecha = fechaISO(fechaDate);
        eventosActividades.push({
          id: `act-${a.id}-${fecha}`,
          title: `${a.titulo || 'Actividad'}${esRecurrente ? ' 🔁' : ''}`,
          start: `${fecha}T${hd}`,
          end: `${fecha}T${hh}`,
          allDay: false,
          classNames: ['evento-actividad'],
          extendedProps: {
            kind: 'actividad',
            id: a.id, // id real en BD (la serie)
            fecha, // fecha de ESTA ocurrencia
            fecha_base: a.fecha_iso, // fecha ancla de la serie
            hora_desde: hd,
            hora_hasta: hh,
            titulo: a.titulo,
            descripcion: a.descripcion,
            recurrente: esRecurrente,
            recurrencia_tipo: a.recurrencia_tipo,
            recurrencia_intervalo: a.recurrencia_intervalo,
            recurrencia_dias_semana: a.recurrencia_dias_semana,
            recurrencia_hasta: a.recurrencia_hasta,
          },
        });
      });
    });

    return res.json({
      ok: true,
      hoy: cumpleHoy,
      eventos: [...eventosCumples, ...eventosActividades],
    });
  } catch (e) {
    console.error('❌ cumples error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// CRUD Actividades (Agenda)
// ===============================

/**
 * Valida y normaliza los campos de recurrencia recibidos en el body.
 * Devuelve { error } o { recTipo, recIntervalo, recDias, recHasta }.
 */
function parseRecurrencia(body, fecha) {
  const {
    recurrente = false,
    recurrencia_tipo = null,
    recurrencia_intervalo = 1,
    recurrencia_dias_semana = null,
    recurrencia_hasta = null,
  } = body || {};

  if (!recurrente) {
    return { recTipo: null, recIntervalo: 1, recDias: null, recHasta: null };
  }

  if (!isValidRecurrenciaTipo(recurrencia_tipo)) {
    return { error: 'Tipo de recurrencia inválido (diario/semanal/mensual/anual)' };
  }

  const recIntervalo = Math.max(1, Number(recurrencia_intervalo) || 1);

  let recDias = null;
  if (recurrencia_tipo === 'semanal') {
    if (!Array.isArray(recurrencia_dias_semana) || !recurrencia_dias_semana.length) {
      return { error: 'Seleccioná al menos un día de la semana para la repetición semanal' };
    }
    recDias = recurrencia_dias_semana
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (!recDias.length) {
      return { error: 'Días de la semana inválidos' };
    }
  }

  let recHasta = null;
  if (recurrencia_hasta) {
    if (!isISODate(String(recurrencia_hasta))) {
      return { error: 'Fecha "hasta" inválida (use YYYY-MM-DD)' };
    }
    if (String(recurrencia_hasta) < String(fecha)) {
      return { error: 'La fecha "hasta" debe ser posterior a la fecha de inicio' };
    }
    recHasta = recurrencia_hasta;
  }

  return { recTipo: recurrencia_tipo, recIntervalo, recDias, recHasta };
}

// POST /club/:clubId/agenda/actividades
router.post('/:clubId/agenda/actividades', requireAuth, async (req, res) => {
  try {
    const { clubId } = req.params;

    if (!canWriteAgenda(req, clubId)) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    const { fecha, hora_desde, hora_hasta, titulo, descripcion = null } = req.body || {};

    if (!fecha || !hora_desde || !hora_hasta || !titulo) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos' });
    }
    if (!isISODate(String(fecha))) {
      return res.status(400).json({ ok: false, error: 'fecha inválida (YYYY-MM-DD)' });
    }
    if (!isTimeHHMM(String(hora_desde)) || !isTimeHHMM(String(hora_hasta))) {
      return res.status(400).json({ ok: false, error: 'Horario inválido (HH:MM)' });
    }
    if (String(hora_desde) >= String(hora_hasta)) {
      return res.status(400).json({ ok: false, error: 'Rango horario inválido' });
    }

    const rec = parseRecurrencia(req.body, fecha);
    if (rec.error) {
      return res.status(400).json({ ok: false, error: rec.error });
    }

    const r = await db.query(
      `
      INSERT INTO agenda_actividades
        (id, club_id, fecha, hora_desde, hora_hasta, titulo, descripcion,
         recurrencia_tipo, recurrencia_intervalo, recurrencia_dias_semana, recurrencia_hasta,
         created_at, activo)
      VALUES
        (gen_random_uuid(), $1, $2::date, $3::time, $4::time, $5, $6,
         $7, $8, $9::int[], $10::date,
         NOW(), true)
      RETURNING id, club_id, fecha, hora_desde, hora_hasta, titulo, descripcion,
        recurrencia_tipo, recurrencia_intervalo, recurrencia_dias_semana, recurrencia_hasta, created_at
      `,
      [
        clubId,
        fecha,
        hora_desde,
        hora_hasta,
        titulo,
        descripcion,
        rec.recTipo,
        rec.recIntervalo,
        rec.recDias,
        rec.recHasta,
      ]
    );

    return res.status(201).json({ ok: true, actividad: r.rows[0] });
  } catch (e) {
    console.error('❌ create actividad:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /club/:clubId/agenda/actividades/:id
// Nota: editar una actividad recurrente edita la serie completa (fecha = fecha ancla).
router.put('/:clubId/agenda/actividades/:id', requireAuth, async (req, res) => {
  try {
    const { clubId, id } = req.params;

    if (!canWriteAgenda(req, clubId)) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    const { fecha, hora_desde, hora_hasta, titulo, descripcion = null } = req.body || {};

    if (!fecha || !hora_desde || !hora_hasta || !titulo) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos' });
    }
    if (!isISODate(String(fecha))) {
      return res.status(400).json({ ok: false, error: 'fecha inválida (YYYY-MM-DD)' });
    }
    if (!isTimeHHMM(String(hora_desde)) || !isTimeHHMM(String(hora_hasta))) {
      return res.status(400).json({ ok: false, error: 'Horario inválido (HH:MM)' });
    }
    if (String(hora_desde) >= String(hora_hasta)) {
      return res.status(400).json({ ok: false, error: 'Rango horario inválido' });
    }

    const rec = parseRecurrencia(req.body, fecha);
    if (rec.error) {
      return res.status(400).json({ ok: false, error: rec.error });
    }

    const r = await db.query(
      `
      UPDATE agenda_actividades
      SET
        fecha = $3::date,
        hora_desde = $4::time,
        hora_hasta = $5::time,
        titulo = $6,
        descripcion = $7,
        recurrencia_tipo = $8,
        recurrencia_intervalo = $9,
        recurrencia_dias_semana = $10::int[],
        recurrencia_hasta = $11::date
      WHERE club_id = $1 AND id = $2 AND activo = true
      RETURNING id, club_id, fecha, hora_desde, hora_hasta, titulo, descripcion,
        recurrencia_tipo, recurrencia_intervalo, recurrencia_dias_semana, recurrencia_hasta
      `,
      [
        clubId,
        id,
        fecha,
        hora_desde,
        hora_hasta,
        titulo,
        descripcion,
        rec.recTipo,
        rec.recIntervalo,
        rec.recDias,
        rec.recHasta,
      ]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Actividad no encontrada' });
    }

    return res.json({ ok: true, actividad: r.rows[0] });
  } catch (e) {
    console.error('❌ update actividad:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /club/:clubId/agenda/actividades/:id
// Nota: elimina la serie completa (todas las ocurrencias futuras) si era recurrente.
router.delete('/:clubId/agenda/actividades/:id', requireAuth, async (req, res) => {
  try {
    const { clubId, id } = req.params;

    if (!canWriteAgenda(req, clubId)) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    const r = await db.query(
      `
      UPDATE agenda_actividades
      SET activo = false
      WHERE club_id = $1 AND id = $2 AND activo = true
      `,
      [clubId, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Actividad no encontrada' });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ delete actividad:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
