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

// ✅ Tipo de agenda_actividades. 'evento' se pinta de azul y 'clase' (clase /
// entrenamiento con socios asignados) de violeta, en vez del verde de
// 'actividad' (ver cumples.html/cumples.js).
function normalizeTipoActividad(v) {
  return v === 'evento' || v === 'clase' ? v : 'actividad';
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

// Recurrencia (diario / semanal / mensual / anual): helpers compartidos con las Clases.
const {
  addDaysLocal, fechaISO, generarOcurrencias,
} = require('../services/agendaRecurrencia');
const clasesSvc = require('../services/agendaClasesService');
const recursosAgenda = require('../services/agendaRecursosService');

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
        COALESCE(tipo, 'actividad') AS tipo,
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

    // ✅ Clases / entrenamientos: el socio solo ve las suyas; el admin ve todas
    // y, de cada una, cuántos socios tiene asignados.
    let filasActividades = ra.rows || [];
    let asignadosPorClase = new Map();
    if (filasActividades.some((a) => a.tipo === 'clase')) {
      if (esAdmin) {
        asignadosPorClase = await clasesSvc.contarAsignados(
          db,
          filasActividades.filter((a) => a.tipo === 'clase').map((a) => a.id)
        );
      } else {
        const mias = await clasesSvc.clasesAsignadasA(db, req.user?.socioId);
        filasActividades = filasActividades.filter((a) => a.tipo !== 'clase' || mias.has(a.id));
      }
    }

    const eventosActividades = [];
    filasActividades.forEach((a) => {
      const hd = a.hd || '00:00';
      const hh = a.hh || '00:30';
      const esRecurrente = !!a.recurrencia_tipo;
      const ocurrencias = generarOcurrencias(a, start, endExclusive);

      ocurrencias.forEach((fechaDate) => {
        const fecha = fechaISO(fechaDate);
        eventosActividades.push({
          id: `act-${a.id}-${fecha}`,
          title: `${a.tipo === 'evento' ? '📌 ' : a.tipo === 'clase' ? '🎓 ' : ''}${a.titulo || 'Actividad'}${esRecurrente ? ' 🔁' : ''}`,
          start: `${fecha}T${hd}`,
          end: `${fecha}T${hh}`,
          allDay: false,
          // ✅ 'evento-evento' azul, 'evento-clase' violeta, 'evento-actividad' verde.
          classNames: [a.tipo === 'evento' ? 'evento-evento' : a.tipo === 'clase' ? 'evento-clase' : 'evento-actividad'],
          extendedProps: {
            kind: 'actividad',
            tipo: a.tipo,
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
            ...(a.tipo === 'clase' && esAdmin ? { inscriptos: asignadosPorClase.get(a.id) || 0 } : {}),
          },
        });
      });
    });

    // ✅ Recursos (reservas aceptadas y abonos): solo para el panel y si el club tiene el módulo.
    const eventosRecursos = esAdmin
      ? await recursosAgenda.eventosRecursos(db, { clubId, desde: start, hastaExcl: endExclusive })
      : [];

    return res.json({
      ok: true,
      hoy: cumpleHoy,
      eventos: [...eventosCumples, ...eventosActividades, ...eventosRecursos],
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

    const { fecha, hora_desde, hora_hasta, titulo, descripcion = null, tipo } = req.body || {};

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
        (id, club_id, tipo, fecha, hora_desde, hora_hasta, titulo, descripcion,
         recurrencia_tipo, recurrencia_intervalo, recurrencia_dias_semana, recurrencia_hasta,
         created_at, activo)
      VALUES
        (gen_random_uuid(), $1, $2, $3::date, $4::time, $5::time, $6, $7,
         $8, $9, $10::int[], $11::date,
         NOW(), true)
      RETURNING id, club_id, tipo, fecha, hora_desde, hora_hasta, titulo, descripcion,
        recurrencia_tipo, recurrencia_intervalo, recurrencia_dias_semana, recurrencia_hasta, created_at
      `,
      [
        clubId,
        normalizeTipoActividad(tipo),
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

    const { fecha, hora_desde, hora_hasta, titulo, descripcion = null, tipo } = req.body || {};

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
        tipo = $3,
        fecha = $4::date,
        hora_desde = $5::time,
        hora_hasta = $6::time,
        titulo = $7,
        descripcion = $8,
        recurrencia_tipo = $9,
        recurrencia_intervalo = $10,
        recurrencia_dias_semana = $11::int[],
        recurrencia_hasta = $12::date
      WHERE club_id = $1 AND id = $2 AND activo = true
      RETURNING id, club_id, tipo, fecha, hora_desde, hora_hasta, titulo, descripcion,
        recurrencia_tipo, recurrencia_intervalo, recurrencia_dias_semana, recurrencia_hasta
      `,
      [
        clubId,
        id,
        normalizeTipoActividad(tipo),
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

// ===============================
// Clases / entrenamientos: socios asignados
// ===============================
function esDelClub(req, clubId) {
  const roles = req.user?.roles || [];
  return roles.some((r) => r.role === 'superadmin' || String(r.club_id) === String(clubId));
}

function responderClase(res, e, etiqueta) {
  if (e instanceof clasesSvc.ErrNegocio) {
    return res.status(e.status).json({ ok: false, error: e.message, code: e.code });
  }
  console.error(`❌ ${etiqueta}:`, e);
  return res.status(500).json({ ok: false, error: e.message });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /club/:clubId/agenda/actividades/:id/socios
router.get('/:clubId/agenda/actividades/:id/socios', requireAuth, async (req, res) => {
  try {
    const { clubId, id } = req.params;
    if (!esDelClub(req, clubId)) return res.status(403).json({ ok: false, error: 'No autorizado' });
    if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Actividad inválida' });
    const socios = await clasesSvc.listarSocios(db, { clubId, actividadId: id });
    return res.json({ ok: true, socios });
  } catch (e) {
    return responderClase(res, e, 'GET actividad socios');
  }
});

// PUT /club/:clubId/agenda/actividades/:id/socios   body: { socioIds: [uuid, ...] }
// Reemplaza la lista de socios asignados (solo actividades de tipo 'clase').
router.put('/:clubId/agenda/actividades/:id/socios', requireAuth, async (req, res) => {
  try {
    const { clubId, id } = req.params;
    if (!canWriteAgenda(req, clubId)) return res.status(403).json({ ok: false, error: 'No autorizado' });
    if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Actividad inválida' });
    const r = await clasesSvc.reemplazarSocios(db, { clubId, actividadId: id, socioIds: req.body?.socioIds });
    return res.json({ ok: true, ...r });
  } catch (e) {
    return responderClase(res, e, 'PUT actividad socios');
  }
});

module.exports = router;
