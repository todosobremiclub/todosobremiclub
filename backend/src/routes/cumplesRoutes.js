// src/routes/cumplesRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// CORS para Flutter Web (similar a noticiasRoutes y appRoutes)
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
// Helpers
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

function argentinaNow() {
  // Fecha actual ajustada a Argentina
  const ahora = new Date();
  return new Date(
    ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
  );
}

function monthRangeFromYYYYMM(yyyymm) {
  // devuelve { start: 'YYYY-MM-01', endExclusive: 'YYYY-MM-01' del mes siguiente }
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

/**
 * GET /club/:clubId/cumples?mes=YYYY-MM
 *
 * - Panel ADMIN (token con roles):
 *   → ve TODOS los socios del club (como antes), sin filtrar por actividad.
 *
 * - App de SOCIO (token con socioId, clubId):
 *   → ve solo socios de su MISMA ACTIVIDAD.
 *
 * Devuelve:
 *  - hoy: socios que cumplen hoy (Argentina)
 *  - eventos: cumpleaños + actividades (nuevas)
 */
router.get('/:clubId/cumples', requireAuth, async (req, res) => {
  try {
    const { clubId } = req.params;
    const mesParam = String(req.query?.mes || '').trim(); // opcional

    if (mesParam && !isYYYYMM(mesParam)) {
      return res.status(400).json({ ok: false, error: 'mes inválido (use YYYY-MM)' });
    }

    // ¿Token de admin? (tiene roles)
    const roles = req.user?.roles || [];
    const esAdmin = roles.some(
      (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
    );

    // Fecha actual ajustada a Argentina
    const hoy = argentinaNow();
    const year = hoy.getFullYear();
    const hoyMes = hoy.getMonth() + 1;
    const hoyDia = hoy.getDate();

    let queryText;
    let queryParams;

    if (esAdmin) {
      // 🟢 PANEL ADMIN: todos los socios del club, sin filtro por actividad
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
        ORDER BY fecha_nacimiento
      `;
      queryParams = [clubId];
    } else if (req.user?.socioId) {
      // 🟢 APP DE SOCIO: filtramos por actividad del socio
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
        return res.status(403).json({
          ok: false,
          error: 'El socio no pertenece a este club',
        });
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
        ORDER BY fecha_nacimiento
      `;
      queryParams = [clubId, actividad];
    } else {
      return res.status(400).json({
        ok: false,
        error: 'Token inválido para cumples (ni admin ni socio).',
      });
    }

    // Ejecutamos el query según el caso (admin o socio)
    const r = await db.query(queryText, queryParams);

    // Cumpleaños de HOY
    const cumpleHoy = r.rows.filter(
      (s) => Number(s.mes_nac) === hoyMes && Number(s.dia_nac) === hoyDia
    );

    // Eventos de cumpleaños (FullCalendar acepta { title, date } para allDay)
    const eventosCumples = r.rows.map((s) => {
      const mm = String(s.mes_nac).padStart(2, '0');
      const dd = String(s.dia_nac).padStart(2, '0');

      return {
        id: `cumple-${s.id}`, // evita colisiones con actividades
        title: `🎂 ${s.nombre} ${s.apellido}`.trim(),
        date: `${year}-${mm}-${dd}`,
        allDay: true,
        classNames: ['evento-cumple'],
        // mantenemos campos "como antes" por compatibilidad
        categoria: s.categoria,
        actividad: s.actividad,
        edad: s.edad,
        extendedProps: {
          kind: 'cumple',
          socio_id: s.id,
          categoria: s.categoria,
          actividad: s.actividad,
          edad: s.edad,
        },
      };
    });

    // ===============================
    // Actividades del mes/año
    // ===============================
    let eventosActividades = [];

    if (mesParam) {
      const { start, endExclusive } = monthRangeFromYYYYMM(mesParam);

      const ra = await db.query(
        `
        SELECT id, fecha, hora_desde, hora_hasta, titulo, descripcion
        FROM agenda_actividades
        WHERE club_id = $1
          AND activo = true
          AND fecha >= $2
          AND fecha < $3
        ORDER BY fecha ASC, hora_desde ASC
        `,
        [clubId, start, endExclusive]
      );

      eventosActividades = (ra.rows || []).map((a) => {
        const fecha = String(a.fecha).slice(0, 10);
        const hd = a.hora_desde ? String(a.hora_desde).slice(0, 5) : '00:00';
        const hh = a.hora_hasta ? String(a.hora_hasta).slice(0, 5) : '00:30';

        // ✅ ACÁ estaba tu bug: faltaba el return del objeto
        return {
          id: `act-${a.id}`,
          title: `${a.titulo || 'Actividad'} (${hd}-${hh})`,
          start: `${fecha}T${hd}`,
          end: `${fecha}T${hh}`,
          allDay: false,
          classNames: ['evento-actividad'],
          extendedProps: {
            kind: 'actividad',
            id: a.id,
            fecha,
            hora_desde: hd,
            hora_hasta: hh,
            titulo: a.titulo,
            descripcion: a.descripcion,
          },
        };
      });
    } else {
      // sin mes -> actividades del año actual
      const startYear = `${year}-01-01`;
      const endYearExclusive = `${year + 1}-01-01`;

      const ra = await db.query(
        `
        SELECT id, fecha, hora_desde, hora_hasta, titulo, descripcion
        FROM agenda_actividades
        WHERE club_id = $1
          AND activo = true
          AND fecha >= $2
          AND fecha < $3
        ORDER BY fecha ASC, hora_desde ASC
        `,
        [clubId, startYear, endYearExclusive]
      );

      eventosActividades = (ra.rows || []).map((a) => {
        const fecha = String(a.fecha).slice(0, 10);
        const hd = a.hora_desde ? String(a.hora_desde).slice(0, 5) : '00:00';
        const hh = a.hora_hasta ? String(a.hora_hasta).slice(0, 5) : '00:30';

        return {
          id: `act-${a.id}`,
          title: `${a.titulo || 'Actividad'} (${hd}-${hh})`,
          start: `${fecha}T${hd}`,
          end: `${fecha}T${hh}`,
          allDay: false,
          classNames: ['evento-actividad'],
          extendedProps: {
            kind: 'actividad',
            id: a.id,
            fecha,
            hora_desde: hd,
            hora_hasta: hh,
            titulo: a.titulo,
            descripcion: a.descripcion,
          },
        };
      });
    }

    const eventos = [...eventosCumples, ...eventosActividades];

    return res.json({
      ok: true,
      hoy: cumpleHoy,
      eventos,
    });
  } catch (e) {
    console.error('❌ cumples error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================
// CRUD Actividades (Agenda)
// ======================================

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

    const r = await db.query(
      `
      INSERT INTO agenda_actividades
        (id, club_id, fecha, hora_desde, hora_hasta, titulo, descripcion, created_at, activo)
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), true)
      RETURNING id, club_id, fecha, hora_desde, hora_hasta, titulo, descripcion, created_at
      `,
      [clubId, String(fecha), String(hora_desde), String(hora_hasta), String(titulo), descripcion]
    );

    return res.status(201).json({ ok: true, actividad: r.rows[0] });
  } catch (e) {
    console.error('❌ create actividad:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /club/:clubId/agenda/actividades/:id
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

    const r = await db.query(
      `
      UPDATE agenda_actividades
      SET
        fecha = $3,
        hora_desde = $4,
        hora_hasta = $5,
        titulo = $6,
        descripcion = $7
      WHERE club_id = $1 AND id = $2 AND activo = true
      RETURNING id, club_id, fecha, hora_desde, hora_hasta, titulo, descripcion
      `,
      [clubId, id, String(fecha), String(hora_desde), String(hora_hasta), String(titulo), descripcion]
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
