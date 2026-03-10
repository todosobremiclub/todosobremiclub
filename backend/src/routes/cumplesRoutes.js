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

/**
 * GET /club/:clubId/cumples
 *
 * - Panel ADMIN (token con roles):
 *   → ve TODOS los socios del club (como antes), sin filtrar por actividad.
 *
 * - App de SOCIO (token con socioId, clubId):
 *   → ve solo socios de su MISMA ACTIVIDAD.
 */
router.get('/:clubId/cumples', requireAuth, async (req, res) => {
  try {
    const { clubId } = req.params;

    // ¿Token de admin? (tiene roles)
    const roles = req.user?.roles || [];
    const esAdmin = roles.some(
      (r) =>
        String(r.club_id) === String(clubId) || r.role === 'superadmin'
    );

    // Fecha actual ajustada a Argentina
    const ahora = new Date();
    const hoy = new Date(
      ahora.toLocaleString('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    );
    const year = hoy.getFullYear();
    const hoyMes = hoy.getMonth() + 1;
    const hoyDia = hoy.getDate();

    let queryText;
    let queryParams;

    if (esAdmin) {
      // 🟢 PANEL ADMIN:
      // comportamiento original: todos los socios del club, sin filtro por actividad
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
      // 🟢 APP DE SOCIO:
      // buscamos la actividad del socio en la base y filtramos por esa actividad
      const socioId = req.user.socioId;

      const rs = await db.query(
        'SELECT actividad, club_id FROM socios WHERE id = $1 LIMIT 1',
        [socioId]
      );

      if (!rs.rowCount) {
        return res
          .status(404)
          .json({ ok: false, error: 'Socio no encontrado' });
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
      // Ni admin ni socio del app → no debería usar este endpoint
      return res.status(400).json({
        ok: false,
        error: 'Token inválido para cumples (ni admin ni socio).',
      });
    }

    // Ejecutamos el query según el caso (admin o socio)
    const r = await db.query(queryText, queryParams);

    // Cumpleaños de HOY
    const cumpleHoy = r.rows.filter(
      (s) =>
        Number(s.mes_nac) === hoyMes && Number(s.dia_nac) === hoyDia
    );

    // Eventos para TODO el año (agenda/admin + app)
    const eventos = r.rows.map((s) => ({
      id: s.id,
      title: `${s.nombre} ${s.apellido}`,
      date: `${year}-${String(s.mes_nac).padStart(2, '0')}-${String(
        s.dia_nac
      ).padStart(2, '0')}`,
      categoria: s.categoria,
      actividad: s.actividad,
      edad: s.edad,
    }));

    return res.json({
      ok: true,
      hoy: cumpleHoy,
      eventos,
    });
  } catch (e) {
    console.error('❌ cumples error:', e);
    return res
      .status(500)
      .json({ ok: false, error: e.message });
  }
});

module.exports = router;