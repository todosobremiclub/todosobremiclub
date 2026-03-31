// src/routes/notificacionesRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { initFirebase } = require('../config/firebaseAdmin');

const router = express.Router();

// ===============================
// CORS simple (igual a noticias/cumples/pagos)
// ===============================
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ===============================
// Helper: validar acceso al club (ADMIN/STAFF/SUPERADMIN)
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
    (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }
  next();
}

function isAdminToken(req) {
  const roles = req.user?.roles ?? [];
  return roles.some(
    (r) => r.role === 'admin' || r.role === 'staff' || r.role === 'superadmin'
  );
}

// ===============================
// Helper: enviar push a topic del club
// (solo dispositivos suscriptos a ese club)
// ===============================
async function sendPushToClubTopic({ clubId, titulo, cuerpo, notificacionId }) {
  const admin = initFirebase();
  if (!admin) throw new Error('Firebase no inicializado (faltan FIREBASE_*)');

  const topic = `club_${clubId}`;

  // data en FCM debe ser string
  const message = {
    topic,
    notification: {
      title: String(titulo ?? '').slice(0, 120),
      body: String(cuerpo ?? '').slice(0, 200),
    },
    data: {
      type: 'notificacion',
      clubId: String(clubId),
      notificacionId: String(notificacionId),
    },
  };

  const messageId = await admin.messaging().send(message);
  return messageId;
}

// ============================================================
// GET /club/:clubId/notificaciones
// - ADMIN (panel): lista las activas del club (historial)
// - SOCIO (app): lista las activas del club (valida clubId si viene en token)
// ============================================================
router.get('/:clubId/notificaciones', requireAuth, async (req, res) => {
  const { clubId } = req.params;

  try {
    // Caso SOCIO: token de /app/login trae socioId y clubId
    if (req.user?.socioId) {
      if (req.user.clubId && String(req.user.clubId) !== String(clubId)) {
        return res.status(403).json({ ok: false, error: 'El socio no pertenece a este club' });
      }

      const r = await db.query(
        `
        SELECT id, club_id, titulo, cuerpo, data, created_at, sent_at
        FROM notificaciones
        WHERE club_id = $1 AND activo = true
        ORDER BY created_at DESC
        LIMIT 200
        `,
        [clubId]
      );

      return res.json({ ok: true, notificaciones: r.rows });
    }

    // Caso ADMIN: token con roles
    if (!isAdminToken(req)) {
      return res.status(401).json({ ok: false, error: 'Token inválido (no es socio ni admin)' });
    }

    // Validar que tenga el club en roles (mismo criterio que otros routes)
    const roles = req.user?.roles ?? [];
    const allowed = roles.some(
      (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
    );
    if (!allowed) {
      return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
    }

    const r = await db.query(
      `
      SELECT id, club_id, titulo, cuerpo, data, created_at, sent_at, activo
      FROM notificaciones
      WHERE club_id = $1 AND activo = true
      ORDER BY created_at DESC
      LIMIT 500
      `,
      [clubId]
    );

    return res.json({ ok: true, notificaciones: r.rows });
  } catch (e) {
    console.error('❌ GET notificaciones', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/notificaciones
// Guarda + envía automáticamente al guardar (push a topic club_<clubId>)
// body: { titulo, cuerpo, data? }
// ============================================================
router.post('/:clubId/notificaciones', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { titulo, cuerpo, data = null } = req.body ?? {};

  try {
    if (!titulo?.trim() || !cuerpo?.trim()) {
      return res.status(400).json({ ok: false, error: 'Completá título y cuerpo.' });
    }

    // 1) Insertar en DB
    const rIns = await db.query(
      `
      INSERT INTO notificaciones (club_id, titulo, cuerpo, data, activo, created_at, updated_at)
      VALUES ($1, $2, $3, $4, true, NOW(), NOW())
      RETURNING id, club_id, titulo, cuerpo, data, created_at
      `,
      [clubId, titulo.trim(), cuerpo.trim(), data]
    );

    const noti = rIns.rows[0];

    // 2) Enviar push (FCM)
    const messageId = await sendPushToClubTopic({
      clubId,
      titulo: noti.titulo,
      cuerpo: noti.cuerpo,
      notificacionId: noti.id,
    });

    // 3) Guardar metadata de envío
    await db.query(
      `
      UPDATE notificaciones
      SET sent_at = NOW(),
          firebase_message_id = $1,
          updated_at = NOW()
      WHERE id = $2 AND club_id = $3
      `,
      [messageId, noti.id, clubId]
    );

    return res.status(201).json({
      ok: true,
      notificacion: {
        ...noti,
        sent_at: new Date().toISOString(),
        firebase_message_id: messageId,
      },
    });
  } catch (e) {
    console.error('❌ POST notificaciones', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /club/:clubId/notificaciones/:id
// Soft delete: activo=false
// ============================================================
router.delete('/:clubId/notificaciones/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    const r = await db.query(
      `
      UPDATE notificaciones
      SET activo = false, updated_at = NOW()
      WHERE id = $1 AND club_id = $2
      `,
      [id, clubId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Notificación no encontrada' });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE notificaciones', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
