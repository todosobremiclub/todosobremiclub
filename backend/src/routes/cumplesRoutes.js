// src/routes/cumplesRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ===============================
// GET /club/:clubId/cumples
// Cumpleaños del día filtrados por actividad del socio logueado
// ===============================
router.get('/:clubId/cumples', requireAuth, async (req, res) => {
  try {
    const { clubId } = req.params;

    // Actividad del socio (viene del JWT generado en /app/login)
    const actividad = req.user?.actividad;

    if (!actividad) {
      return res.status(400).json({
        ok: false,
        error: 'El token no contiene actividad del socio.'
      });
    }

    // Fecha actual ARG
    const ahora = new Date();
    const hoy = new Date(
      ahora.toLocaleString('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires'
      })
    );
    const year = hoy.getFullYear();
    const hoyMes = hoy.getMonth() + 1;
    const hoyDia = hoy.getDate();

    // ===============================
    // SELECT filtrado por actividad
    // ===============================
    const r = await db.query(
      `
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
      `,
      [clubId, actividad]
    );

    // Cumpleaños HOY
    const cumpleHoy = r.rows.filter(
      (s) =>
        Number(s.mes_nac) === hoyMes && Number(s.dia_nac) === hoyDia
    );

    // Eventos para TODO el año (por si querés calendario después)
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
      eventos
    });

  } catch (e) {
    console.error('❌ cumples error:', e);
    return res
      .status(500)
      .json({ ok: false, error: e.message });
  }
});

module.exports = router;