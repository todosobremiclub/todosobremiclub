const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// GET /club/:clubId  (solo si el usuario tiene ese club en su JWT)
router.get('/:clubId', requireAuth, async (req, res) => {
  try {
    const { clubId } = req.params;

    const roles = req.user?.roles || [];
    const allowed = roles.some(r => String(r.club_id) === String(clubId));
    if (!allowed) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });

    const r = await db.query(
      `SELECT id, name, address, city, province, logo_url, background_url
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
      [clubId]
    );

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Club no encontrado' });

    res.json({ ok: true, club: r.rows[0] });
  } catch (err) {
    console.error('❌ clubRoutes:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;