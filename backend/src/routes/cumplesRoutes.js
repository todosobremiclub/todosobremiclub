const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles || [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok:false, error:'No autorizado para este club' });
  next();
}

router.get('/:clubId/cumples', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { mes } = req.query;  // YYYY-MM

    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ ok: false, error: 'mes inválido (use YYYY-MM)' });
    }

    const inicio = `${mes}-01`;

    const r = await db.query(`
 SELECT
 id,
 nombre,
 apellido,
 categoria,
 foto_url,
 fecha_nacimiento,
 EXTRACT(MONTH FROM fecha_nacimiento) AS mes_nac,
 EXTRACT(DAY FROM fecha_nacimiento) AS dia_nac,
 DATE_PART('year', AGE(fecha_nacimiento))::int AS edad
 FROM socios
 WHERE club_id = $1 AND activo = true
 ORDER BY fecha_nacimiento
`, [clubId]);


    const hoy = new Date();
    const hoyMes = hoy.getMonth() + 1;
    const hoyDia = hoy.getDate();

    const cumpleHoy = r.rows.filter(s =>
      Number(s.mes_nac) === hoyMes && Number(s.dia_nac) === hoyDia
    );

    const eventos = r.rows
      .filter(s => `${String(s.mes_nac).padStart(2,'0')}` === mes.slice(5))
      .map(s => ({
        id: s.id,
        title: `${s.nombre} ${s.apellido}`,
        date: `${mes.slice(0,4)}-${String(s.mes_nac).padStart(2,'0')}-${String(s.dia_nac).padStart(2,'0')}`,
        categoria: s.categoria,
        edad: s.edad
      }));

    res.json({ ok: true, hoy: cumpleHoy, eventos });

  } catch (e) {
    console.error('❌ cumples error:', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

module.exports = router;