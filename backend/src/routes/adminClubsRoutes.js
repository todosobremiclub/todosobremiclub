const express = require('express');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// Multer en memoria (buffer)
const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB por archivo (logo/fondo)
});

function fileToDataUrl(file) {
  if (!file) return null;
  const b64 = file.buffer.toString('base64');
  return `data:${file.mimetype};base64,${b64}`;
}

// ✅ LISTAR CLUBES (solo superadmin)
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

// ✅ CREAR CLUB con logo y fondo (solo superadmin)
// Recibe multipart/form-data: fields + files
router.post(
  '/',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'background', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { name, address, city, province } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ ok: false, error: 'Falta name' });
      }

      const logoFile = req.files?.logo?.[0] || null;
      const bgFile = req.files?.background?.[0] || null;

      const logo_url = fileToDataUrl(logoFile);
      const background_url = fileToDataUrl(bgFile);

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
      res.status(500).json({ ok: false, error: 'Error interno' });
    }
  }
);

module.exports = router;