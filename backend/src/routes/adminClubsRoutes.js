const express = require('express');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const crypto = require('crypto');

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
        socios_cantidad,
        valor_mensual,
        logo_url, 
        background_url, 
        color_primary, 
        color_secondary, 
        color_accent, 
        apply_token,
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
        socios_cantidad,
        valor_mensual,
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

      // ✅ Token para QR de postulación
      const apply_token = crypto.randomBytes(16).toString('hex');

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
          socios_cantidad,
          valor_mensual,
          logo_url,
          background_url,
          color_primary,
          color_secondary,
          color_accent,
          apply_token
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
          socios_cantidad ? Number(socios_cantidad) : null,
          valor_mensual ? Number(valor_mensual) : null,
          logo_url,
          background_url,
          color_primary ?? '#2563eb',
          color_secondary ?? '#1e40af',
          color_accent ?? '#facc15',
          apply_token
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
        socios_cantidad,
        valor_mensual,
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
          contact_name = $5,
          contact_phone = $6,
          instagram_url = $7,
          socios_cantidad = $8,
          valor_mensual = $9,
          logo_url = COALESCE($10, logo_url),
          background_url = COALESCE($11, background_url),
          color_primary = COALESCE($12, color_primary),
          color_secondary = COALESCE($13, color_secondary),
          color_accent = COALESCE($14, color_accent)
        WHERE id = $15
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
          socios_cantidad ? Number(socios_cantidad) : null,
          valor_mensual ? Number(valor_mensual) : null,
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

// ================== COMENTARIOS DEL CLUB ==================

// Listar comentarios
router.get('/:id/comments', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;

    const r = await db.query(
      `
      SELECT id, club_id, comment, created_at
      FROM club_comments
      WHERE club_id = $1
      ORDER BY created_at DESC
      `,
      [id]
    );

    res.json({ ok: true, comments: r.rows });
  } catch (err) {
    console.error('❌ get club comments:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Agregar comentario
router.post('/:id/comments', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body ?? {};

    if (!comment?.trim()) {
      return res.status(400).json({ ok: false, error: 'Comentario vacío' });
    }

    const r = await db.query(
      `
      INSERT INTO club_comments (club_id, comment)
      VALUES ($1, $2)
      RETURNING id, club_id, comment, created_at
      `,
      [id, comment.trim()]
    );

    res.json({ ok: true, comment: r.rows[0] });
  } catch (err) {
    console.error('❌ add club comment:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ================== ACTIVAR / DESACTIVAR ==================
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
  const { id } = req.params;

  try {
    await db.query('BEGIN');

    // ⚠️ BORRAR HIJOS PRIMERO (según tus FK por club_id)
    // Orden conservador (por si alguna tabla depende de otra)
    await db.query('DELETE FROM socios_adjuntos WHERE club_id=$1', [id]);
    await db.query('DELETE FROM socios_comentarios WHERE club_id=$1', [id]);

    await db.query('DELETE FROM cuotas_mensuales WHERE club_id=$1', [id]);
    await db.query('DELETE FROM responsables_gasto WHERE club_id=$1', [id]);
    await db.query('DELETE FROM actividades WHERE club_id=$1', [id]);

    // ✅ ESTE ES EL QUE TE BLOQUEA HOY
    await db.query('DELETE FROM noticias WHERE club_id=$1', [id]);

    await db.query('DELETE FROM notificaciones WHERE club_id=$1', [id]);

    // comentarios del club (tabla usada por tus endpoints /admin/clubs/:id/comments)
    await db.query('DELETE FROM club_comments WHERE club_id=$1', [id]);

    // socios
    await db.query('DELETE FROM socios WHERE club_id=$1', [id]);

    // contadores / auxiliares
    await db.query('DELETE FROM club_counters WHERE club_id=$1', [id]);

    // relación usuarios↔club
    await db.query('DELETE FROM user_clubs WHERE club_id=$1', [id]);

    // por último, el club
    await db.query('DELETE FROM clubs WHERE id=$1', [id]);

    await db.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ admin clubs delete:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
