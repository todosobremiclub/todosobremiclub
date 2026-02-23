const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

/**
 * POST /auth/login
 * body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Faltan email o password' });
    }

    // 1) Buscar usuario
    const rUser = await db.query(
      `SELECT id, email, password_hash, is_active
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email.toLowerCase()]
    );

    if (rUser.rowCount === 0) {
      return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    }

    const user = rUser.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ ok: false, error: 'Usuario inactivo' });
    }

    // 2) Validar password
    const okPass = await bcrypt.compare(password, user.password_hash);
    if (!okPass) {
      return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    }

    // 3) Traer roles/clubs
    const rRoles = await db.query(
      `SELECT uc.role, uc.club_id, c.name AS club_name
       FROM user_clubs uc
       JOIN clubs c ON c.id = uc.club_id
       WHERE uc.user_id = $1`,
      [user.id]
    );

    const roles = rRoles.rows; // [{role, club_id, club_name}, ...]

    // 4) Firmar JWT
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ ok: false, error: 'Falta JWT_SECRET en el servidor' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, roles },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, roles }
    });
  } catch (err) {
    console.error('❌ /auth/login error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * GET /auth/me  (requiere Bearer token)
 */
router.get('/me', requireAuth, async (req, res) => {
  return res.json({ ok: true, user: req.user });
});

module.exports = router;
``