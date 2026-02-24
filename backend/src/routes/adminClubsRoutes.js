const express = require('express');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

async function listClubs() {
  return db.query(
    `SELECT id, name, address, city, province, logo_url, background_url, is_active, created_at
     FROM clubs
     ORDER BY created_at DESC`
  );
}

// ✅ GET /admin/clubs
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await listClubs();
    res.json({ ok: true, clubs: r.rows });
  } catch (err) {
    console.error('❌ admin clubs list:', err);
    res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

// ✅ POST /admin/clubs (create)
router.post(
  '/',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'background', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { name, address, city, province } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Falta name' });

      let logo_url = null;
      let background_url = null;

      const logoFile = req.files?.logo?.[0];
      const bgFile = req.files?.background?.[0];

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
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [name.trim(), address || null, city || null, province || null, logo_url, background_url]
      );

      res.status(201).json({ ok: true, club: r.rows[0] });
    } catch (err) {
      console.error('❌ admin clubs create:', err);
      res.status(500).json({ ok: false, error: err.message || 'Error interno' });
    }
  }
);

// ✅ PUT /admin/clubs/:id (edit)
router.put(
  '/:id',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'background', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, address, city, province } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Falta name' });

      // Traer actuales (para mantener logo/fondo si no se envían nuevos)
      const current = await db.query(
        `SELECT logo_url, background_url FROM clubs WHERE id=$1 LIMIT 1`,
        [id]
      );
      if (current.rowCount === 0) return res.status(404).json({ ok: false, error: 'Club no encontrado' });

      let logo_url = current.rows[0].logo_url;
      let background_url = current.rows[0].background_url;

      const logoFile = req.files?.logo?.[0];
      const bgFile = req.files?.background?.[0];

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
        `UPDATE clubs
         SET name=$1, address=$2, city=$3, province=$4, logo_url=$5, background_url=$6
         WHERE id=$7
         RETURNING *`,
        [name.trim(), address || null, city || null, province || null, logo_url, background_url, id]
      );

      res.json({ ok: true, club: r.rows[0] });
    } catch (err) {
      console.error('❌ admin clubs update:', err);
      res.status(500).json({ ok: false, error: err.message || 'Error interno' });
    }
  }
);

// ✅ DELETE /admin/clubs/:id (delete)
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Si el club está asignado a usuarios, esto fallará por FK.
    // Primero borrar relaciones user_clubs de ese club:
    await db.query(`DELETE FROM user_clubs WHERE club_id=$1`, [id]);
    await db.query(`DELETE FROM clubs WHERE id=$1`, [id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ admin clubs delete:', err);
    res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

module.exports = router;