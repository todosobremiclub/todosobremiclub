const express = require('express');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');

const router = express.Router();

// multer en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// ✅ GET /admin/clubs
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT id, name, address, city, province, logo_url, background_url, is_active, created_at
       FROM clubs
       ORDER BY created_at DESC`
    );
    res.json({ ok: true, clubs: r.rows });
  } catch (err) {
    console.error('❌ admin clubs list:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ✅ POST /admin/clubs (multipart/form-data con logo/background)
router.post(
  '/',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'background', maxCount: 1 }
  ]), // upload.fields está soportado por Multer [3](https://expressjs.com/en/resources/middleware/multer.html)
  async (req, res) => {
    try {
      const { name, address, city, province } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ ok: false, error: 'Falta name' });
      }

      let logo_url = null;
      let background_url = null;

      const logoFile = req.files?.logo?.[0];
      const bgFile = req.files?.background?.[0];

      // Subir a Firebase si vienen archivos
      if (logoFile) {
        const up = await uploadImageBuffer({
          buffer: logoFile.buffer,
          mimetype: logoFile.mimetype,
          originalname: logoFile.originalname,
          folder: 'clubs/logo'
        });
        logo_url = up.url;
      }

      if (bgFile) {
        const up = await uploadImageBuffer({
          buffer: bgFile.buffer,
          mimetype: bgFile.mimetype,
          originalname: bgFile.originalname,
          folder: 'clubs/background'
        });
        background_url = up.url;
      }

      const r = await db.query(
        `INSERT INTO clubs (name, address, city, province, logo_url, background_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, address, city, province, logo_url, background_url, is_active, created_at`,
        [
          name.trim(),
          address || null,
          city || null,
          province || null,
          logo_url,
          background_url
        ]
      );

      res.status(201).json({ ok: true, club: r.rows[0] });
    } catch (err) {
      console.error('❌ admin clubs create:', err);
      res.status(500).json({ ok: false, error: err.message || 'Error interno' });
    }
  }
);

module.exports = router;