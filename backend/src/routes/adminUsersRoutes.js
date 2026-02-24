const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

// ================== LISTAR ==================
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT
        u.id, u.email, u.full_name, u.is_active,
        json_agg(
          json_build_object(
            'club_id', uc.club_id,
            'club_name', c.name,
            'role', uc.role
          )
        ) AS roles
      FROM users u
      LEFT JOIN user_clubs uc ON uc.user_id = u.id
      LEFT JOIN clubs c ON c.id = uc.club_id
      GROUP BY u.id
      ORDER BY u.email
    `);
    res.json({ ok: true, users: r.rows });
  } catch (e) {
    console.error('❌ list users', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== CREAR ==================
router.post('/', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { email, full_name, password, is_active = true, assignments } = req.body || {};

  try {
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Faltan email o password' });
    }
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ ok: false, error: 'Faltan assignments (club/rol)' });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const passHash = await bcrypt.hash(password, 10);

    await db.query('BEGIN');

    const rUser = await db.query(
      `INSERT INTO users (email, full_name, password_hash, is_active)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, full_name, is_active`,
      [emailNorm, full_name || null, passHash, is_active]
    );

    const userId = rUser.rows[0].id;

    for (const a of assignments) {
      if (!a?.club_id || !a?.role) continue;

      await db.query(
        `INSERT INTO user_clubs (user_id, club_id, role)
         VALUES ($1,$2,$3)`,
        [userId, a.club_id, a.role]
      );
    }

    await db.query('COMMIT');
    return res.json({ ok: true, user: rUser.rows[0] });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}

    // típico de UNIQUE(email) en Postgres
    if (e.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe un usuario con ese email' });
    }

    console.error('❌ create user', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== EDITAR ==================
router.put('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { email, full_name, is_active, assignments } = req.body;

  try {
    await db.query(
      `UPDATE users SET email=$1, full_name=$2, is_active=$3 WHERE id=$4`,
      [email, full_name || null, is_active, id]
    );

    // Reemplazamos roles del usuario
    await db.query(`DELETE FROM user_clubs WHERE user_id=$1`, [id]);

    if (Array.isArray(assignments)) {
      for (const a of assignments) {
        await db.query(
          `INSERT INTO user_clubs (user_id, club_id, role)
           VALUES ($1,$2,$3)`,
          [id, a.club_id, a.role]
        );
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('❌ update user', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== ELIMINAR ==================
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(`DELETE FROM user_clubs WHERE user_id=$1`, [id]);
    await db.query(`DELETE FROM users WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ delete user', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;