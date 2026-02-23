const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

/**
 * GET /admin/users
 * Lista usuarios con sus clubes y roles
 */
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.is_active,
        u.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'club_id', c.id,
              'club_name', c.name,
              'role', uc.role
            )
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'
        ) AS roles
      FROM users u
      LEFT JOIN user_clubs uc ON uc.user_id = u.id
      LEFT JOIN clubs c ON c.id = uc.club_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    res.json({ ok: true, users: r.rows });
  } catch (err) {
    console.error('❌ admin users list:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * POST /admin/users
 * Crea usuario y asigna clubes/roles
 * body:
 * {
 *   email,
 *   full_name,
 *   password,
 *   assignments: [{ club_id, role }]
 * }
 */
router.post('/', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { email, full_name, password, assignments = [] } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y password son obligatorios' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const rUser = await db.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, is_active, created_at`,
      [email.toLowerCase(), password_hash, full_name || null]
    );

    const user = rUser.rows[0];

    for (const a of assignments) {
      await db.query(
        `INSERT INTO user_clubs (user_id, club_id, role)
         VALUES ($1, $2, $3)`,
        [user.id, a.club_id, a.role]
      );
    }

    res.status(201).json({ ok: true, user });
  } catch (err) {
    console.error('❌ admin users create:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;