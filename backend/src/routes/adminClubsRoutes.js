const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// ✅ Listar clubes (solo superadmin)
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT id, name, address, city, province, is_active, created_at
       FROM clubs
       ORDER BY created_at DESC`
    );
    res.json({ ok: true, clubs: r.rows });
  } catch (err) {
    console.error('❌ admin clubs list:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ✅ Crear club (solo superadmin)
router.post('/', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { name, address, city, province } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Falta name' });
    }

    const r = await db.query(
      `INSERT INTO clubs (name, address, city, province)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, address, city, province, is_active, created_at`,
      [name.trim(), address || null, city || null, province || null]
    );

    res.status(201).json({ ok: true, club: r.rows[0] });
  } catch (err) {
    console.error('❌ admin clubs create:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;