const db = require('../db');

module.exports = async function requireClubReadAccess(req, res, next) {
  try {
    const userId = req.user.id;
    const clubId = req.params.clubId || req.body.club_id;

    if (!clubId) {
      return res.status(400).json({ ok: false, error: 'clubId requerido' });
    }

    const r = await db.query(
      `SELECT role
       FROM user_clubs
       WHERE user_id = $1 AND club_id = $2`,
      [userId, clubId]
    );

    if (!r.rowCount) {
      return res.status(403).json({ ok: false, error: 'Sin acceso al club' });
    }

    // ✅ Todos los roles válidos pueden leer
    req.clubRole = r.rows[0].role;
    next();
  } catch (e) {
    console.error('❌ requireClubReadAccess', e);
    res.status(500).json({ ok: false, error: 'Error de autorización' });
  }
};
