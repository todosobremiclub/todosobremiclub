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
  (r) =>
    String(r.club_id) === String(clubId) ||
    r.role === 'superadmin'
);

  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }

const canWrite = roles.some(
  (r) =>
    r.role === 'admin' ||
    r.role === 'staff' ||
    r.role === 'superadmin' ||
    r.role === 'profesor' // ✅ CLAVE
);

if (!canWrite) {
  return res.status(403).json({ ok: false, error: 'No autorizado' });
}
  next();
}

function isAdminToken(req) {
  const roles = req.user?.roles ?? [];
  return roles.some(
    (r) =>
      r.role === 'admin' ||
      r.role === 'staff' ||
      r.role === 'superadmin' ||
      r.role === 'profesor' // ✅ NUEVO
  );
}

// ===============================
// Helper: normalizar texto para nombre de topic FCM
// ⚠️ Esta función debe dar EXACTAMENTE el mismo resultado que
// normalizeForTopic() en push_service.dart (lado app). Si se
// cambia una, hay que cambiar la otra, sino los nombres de topic
// no van a coincidir entre backend y app.
// ===============================
function slugForTopic(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // sacar acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

// ===============================
// Helper: validar destino_tipo (mismos criterios que Noticias)
// ===============================
const DESTINO_TIPOS_VALIDOS = new Set([
  'todos',
  'actividad',
  'categoria',
  'anio_nac',
  'cat_anio',
  'act_cat',
  'falta_pago',
]);

function validateDestino({ destino_tipo, destino_valor1, destino_valor2 }) {
  const tipo = destino_tipo || 'todos';

  if (!DESTINO_TIPOS_VALIDOS.has(tipo)) {
    throw new Error('destino_tipo inválido');
  }
  if (tipo === 'actividad' && !destino_valor1) {
    throw new Error('Falta actividad (destino_valor1)');
  }
  if (tipo === 'categoria' && !destino_valor1) {
    throw new Error('Falta categoría (destino_valor1)');
  }
  if (tipo === 'anio_nac' && !destino_valor1) {
    throw new Error('Falta año de nacimiento (destino_valor1)');
  }
  if (tipo === 'cat_anio' && (!destino_valor1 || !destino_valor2)) {
    throw new Error('Falta categoría o año de nacimiento (destino_valor1 / destino_valor2)');
  }
  if (tipo === 'act_cat' && (!destino_valor1 || !destino_valor2)) {
    throw new Error('Falta actividad o categoría (destino_valor1 / destino_valor2)');
  }
}

// ===============================
// Helper: resolver a qué topic/condición de FCM mandar el push
// según el destino elegido en el panel.
// ===============================
function buildFcmTarget(clubId, destino) {
  const tipo = destino?.destino_tipo || 'todos';
  const v1 = destino?.destino_valor1 || null;
  const v2 = destino?.destino_valor2 || null;

  const topicActividad = (act) => `club_${clubId}_act_${slugForTopic(act)}`;
  const topicCategoria = (cat) => `club_${clubId}_cat_${slugForTopic(cat)}`;
  const topicAnio = (anio) => `club_${clubId}_anio_${slugForTopic(anio)}`;
  const topicFaltaPago = () => `club_${clubId}_faltapago`;

  switch (tipo) {
    case 'actividad':
      return { topic: topicActividad(v1) };
    case 'categoria':
      return { topic: topicCategoria(v1) };
    case 'anio_nac':
      return { topic: topicAnio(v1) };
    case 'act_cat':
      return {
        condition: `'${topicActividad(v1)}' in topics && '${topicCategoria(v2)}' in topics`,
      };
    case 'cat_anio':
      return {
        condition: `'${topicCategoria(v1)}' in topics && '${topicAnio(v2)}' in topics`,
      };
    case 'falta_pago':
      return { topic: topicFaltaPago() };
    default:
      return { topic: `club_${clubId}` };
  }
}

// ===============================
// Helper: enviar push al destino elegido
// (todos / actividad / categoría / año / falta de pago / combinaciones)
// ✅ Incluye clubName en el título y en data
// ===============================
async function sendPushToClubTopic({ clubId, clubName, titulo, cuerpo, notificacionId, data }) {
  const admin = initFirebase();
  if (!admin) throw new Error('Firebase no inicializado (faltan FIREBASE_*)');

  const target = buildFcmTarget(clubId, data);

  // ✅ Título con nombre del club
  // Ej: "Club Atlético — Suspensión por lluvia"
  const titleFinal = clubName
    ? `${String(clubName).trim()} — ${String(titulo ?? '').trim()}`
    : String(titulo ?? '').trim();

  // data en FCM debe ser string
  const message = {
    ...target, // { topic: '...' } o { condition: '...' }
    notification: {
      title: String(titleFinal).slice(0, 120),
      body: String(cuerpo ?? '').slice(0, 200),
    },
    data: {
      type: 'notificacion',
      clubId: String(clubId),
      clubNombre: String(clubName ?? ''), // ✅ NUEVO
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
router.get('/:clubId/notificaciones', requireAuth, async (req, res, next) => {
  const { clubId } = req.params;

  try {
    // Caso SOCIO: token de /app/login trae socioId y clubId
    if (req.user?.socioId) {
      if (req.user.clubId && String(req.user.clubId) !== String(clubId)) {
        return res
          .status(403)
          .json({ ok: false, error: 'El socio no pertenece a este club' });
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

    // Caso ADMIN / STAFF / usuario con acceso al club
    if (!req.user?.socioId) {
      await new Promise((resolve, reject) => {
        requireClubAccess(req, res, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Si requireClubAccess ya respondió error, cortamos
      if (res.headersSent) return;
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
// ✅ Incluye nombre del club en el push
// ============================================================
router.post('/:clubId/notificaciones', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { titulo, cuerpo, data = null } = req.body ?? {};

  try {
    if (!titulo?.trim() || !cuerpo?.trim()) {
      return res.status(400).json({ ok: false, error: 'Completá título y cuerpo.' });
    }

    // ✅ Validar el destino elegido (mismos criterios que Noticias)
    try {
      validateDestino(data ?? {});
    } catch (eDestino) {
      return res.status(400).json({ ok: false, error: eDestino.message });
    }


    // ✅ Traer nombre del club (para mostrar en push)
    const rClub = await db.query(      `SELECT name FROM clubs WHERE id = $1 LIMIT 1`,
      [clubId]
    );
    const clubName = rClub.rowCount ? rClub.rows[0].name : 'Club';

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
  clubName,
  titulo: noti.titulo,
  cuerpo: noti.cuerpo,
  notificacionId: noti.id,
  data
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