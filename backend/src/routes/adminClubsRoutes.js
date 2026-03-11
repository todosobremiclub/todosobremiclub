const express = require('express');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');

const router = express.Router();

// =============================
// Multer en memoria (multipart)
// =============================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// ================== LISTAR ==================
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT 
        id, 
        name, 
        address, 
        city, 
        province, 
        contact_name, 
        contact_phone, 
        instagram_url, 
        logo_url, 
        background_url, 
        color_primary, 
        color_secondary, 
        color_accent, 
        created_at 
      FROM clubs 
      ORDER BY created_at DESC 
    `);

    res.json({ ok: true, clubs: r.rows });
  } catch (err) {
    console.error('❌ admin clubs list:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ================== CREAR ==================
router.post(
  '/',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([{ name: 'logo' }, { name: 'background' }]),
  async (req, res) => {
    try {
      const {
        name,
        address,
        city,
        province,
        contact_name,
        contact_phone,
        instagram_url,
        color_primary,
        color_secondary,
        color_accent
      } = req.body ?? {};

      if (!name?.trim()) {
        return res.status(400).json({ ok: false, error: 'Falta name' });
      }

      let logo_url = null;
      let background_url = null;

      if (req.files?.logo?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.logo[0].buffer,
          mimetype: req.files.logo[0].mimetype,
          originalname: req.files.logo[0].originalname,
          folder: 'clubs/logo'
        });
        logo_url = up.url;
      }

      if (req.files?.background?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.background[0].buffer,
          mimetype: req.files.background[0].mimetype,
          originalname: req.files.background[0].originalname,
          folder: 'clubs/background'
        });
        background_url = up.url;
      }

      const r = await db.query(
        `
        INSERT INTO clubs (
          name, 
          address, 
          city, 
          province, 
          contact_name, 
          contact_phone, 
          instagram_url, 
          logo_url, 
          background_url, 
          color_primary, 
          color_secondary, 
          color_accent 
        ) 
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) 

        RETURNING *
        `,
        [
          name.trim(),
          address ?? null,
          city ?? null,
          province ?? null,
          contact_name ?? null,
          contact_phone ?? null,
          instagram_url ?? null,
          logo_url,
          background_url,
          color_primary ?? '#2563eb',
          color_secondary ?? '#1e40af',
          color_accent ?? '#facc15'
        ]
      );

      res.json({ ok: true, club: r.rows[0] });
    } catch (err) {
      console.error('❌ admin clubs create:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ================== EDITAR ==================
router.put(
  '/:id',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([{ name: 'logo' }, { name: 'background' }]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        address,
        city,
        province,
        contact_name,
        contact_phone,
        instagram_url,
        color_primary,
        color_secondary,
        color_accent
      } = req.body ?? {};

      if (!name?.trim()) {
        return res.status(400).json({ ok: false, error: 'Falta name' });
      }

      const current = await db.query(
        `SELECT logo_url, background_url FROM clubs WHERE id=$1`,
        [id]
      );
      if (!current.rowCount) {
        return res.status(404).json({ ok: false, error: 'Club no encontrado' });
      }

      let logo_url = current.rows[0].logo_url;
      let background_url = current.rows[0].background_url;

      if (req.files?.logo?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.logo[0].buffer,
          mimetype: req.files.logo[0].mimetype,
          originalname: req.files.logo[0].originalname,
          folder: 'clubs/logo'
        });
        logo_url = up.url;
      }

      if (req.files?.background?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.background[0].buffer,
          mimetype: req.files.background[0].mimetype,
          originalname: req.files.background[0].originalname,
          folder: 'clubs/background'
        });
        background_url = up.url;
      }

      const r = await db.query(
        `
        UPDATE clubs
        SET 
          name = $1, 
          address = $2, 
          city = $3, 
          province = $4, 
          contact_name  = $5, 
          contact_phone = $6, 
          instagram_url = $7, 
          logo_url = COALESCE($8, logo_url), 
          background_url = COALESCE($9, background_url), 
          color_primary = COALESCE($10, color_primary), 
          color_secondary = COALESCE($11, color_secondary), 
          color_accent = COALESCE($12, color_accent) 
        WHERE id = $13 
        RETURNING *
        `,
        [
          name.trim(),
          address ?? null,
          city ?? null,
          province ?? null,
          contact_name ?? null,
          contact_phone ?? null,
          instagram_url ?? null,
          logo_url,
          background_url,
          color_primary,
          color_secondary,
          color_accent,
          id
        ]
      );

      res.json({ ok: true, club: r.rows[0] });
    } catch (err) {
      console.error('❌ admin clubs update:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ================== ACTIVAR / DESACTIVAR CLUB ==================
// PATCH /admin/clubs/:id/active
router.patch('/:id/active', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body || {};

  try {
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'is_active debe ser boolean' });
    }

    const r = await db.query(
      `UPDATE clubs SET is_active=$1 WHERE id=$2 RETURNING id, name, is_active`,
      [is_active, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Club no encontrado' });
    }

    res.json({ ok: true, club: r.rows[0] });
  } catch (e) {
    console.error('❌ toggle club active', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== ELIMINAR ==================
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;

    await db.query('DELETE FROM user_clubs WHERE club_id=$1', [id]);
    await db.query('DELETE FROM clubs WHERE id=$1', [id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ admin clubs delete:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;