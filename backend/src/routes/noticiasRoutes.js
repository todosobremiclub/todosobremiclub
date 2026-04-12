// src/routes/noticiasRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const { initFirebase } = require('../config/firebaseAdmin');

const router = express.Router();

// CORS simple para Flutter Web (similar a /appRoutes)
	
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
// Helper: validar acceso al club
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }
  next();
}

// ===============================
// Helpers Firebase delete (imagen vieja)
// ===============================
function extractFirebaseObjectPath(url) {
  try {
    const u = new URL(url);
    const marker = '/o/';
    const i = u.pathname.indexOf(marker);
    if (i < 0) return null;
    return decodeURIComponent(u.pathname.slice(i + marker.length));
  } catch {
    return null;
  }
}

async function deleteFirebaseObjectByUrl(url) {
  const objectPath = extractFirebaseObjectPath(url);
  if (!objectPath) return;
  const admin = initFirebase();
  if (!admin) return;
  const bucket = admin.storage().bucket();
  await bucket.file(objectPath).delete({ ignoreNotFound: true });
}

// ===============================
// Helper validación destino_tipo
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
  if (!DESTINO_TIPOS_VALIDOS.has(destino_tipo)) {
    throw new Error('destino_tipo inválido');
  }

  if (destino_tipo === 'actividad' && !destino_valor1) {
    throw new Error('Falta actividad (destino_valor1)');
  }

  if (destino_tipo === 'categoria' && !destino_valor1) {
    throw new Error('Falta categoría (destino_valor1)');
  }

  if (destino_tipo === 'anio_nac' && !destino_valor1) {
    throw new Error('Falta año de nacimiento (destino_valor1)');
  }

  if (destino_tipo === 'cat_anio') {
    if (!destino_valor1 || !destino_valor2) {
      throw new Error(
        'Falta categoría o año de nacimiento (destino_valor1 / destino_valor2)'
      );
    }
  }

  if (destino_tipo === 'act_cat') {
    if (!destino_valor1 || !destino_valor2) {
      throw new Error(
        'Falta actividad o categoría (destino_valor1 / destino_valor2)'
      );
    }
  }
}

// ============================================================
// GET /club/:clubId/noticias
// Lista noticias activas del club
// ============================================================


router.get('/:clubId/noticias', requireAuth, async (req, res) => {
  const { clubId } = req.params;
  const socioId = req.user?.socioId;  // viene desde /app/login
  try {
   // ✅ Si NO hay socioId -> permitir a CUALQUIER usuario del club
const hasClubAccess = (req.user?.roles || []).some(
  r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
);

if (!socioId && hasClubAccess) {
  const r = await db.query(`
    SELECT
      id, club_id, titulo, texto, imagen_url,
      destino_tipo, destino_valor1, destino_valor2,
      created_at, updated_at, activo
    FROM noticias
    WHERE club_id = $1
      AND activo = true
    ORDER BY created_at DESC
  `, [clubId]);

  return res.json({ ok: true, noticias: r.rows });
}

if (!socioId) {
  return res.status(403).json({
    ok: false,
    error: 'No autorizado para ver noticias del club'
  });
}


    // Si HAY socioId -> filtramos según actividad / categoría / año y falta de pago
const now = new Date();
const curY = now.getFullYear();
const curM = now.getMonth() + 1;
let prevY = curY;
let prevM = curM - 1;
if (prevM === 0) {
  prevM = 12;
  prevY = curY - 1;
}

const rSocio = await db.query(
  `
  SELECT
    s.actividad,
    s.categoria,
    s.fecha_nacimiento,
    s.becado,
    CASE
      WHEN s.becado = true THEN true
      WHEN EXISTS (
        SELECT 1
        FROM pagos_mensuales pm
        WHERE pm.club_id = s.club_id
          AND pm.socio_id = s.id
          AND (
            (pm.anio = $3 AND pm.mes = $4)
            OR
            (pm.anio = $5 AND pm.mes = $6)
          )
      ) THEN true
      ELSE false
    END AS pago_al_dia
  FROM socios s
  WHERE s.id = $1 AND s.club_id = $2
  LIMIT 1
  `,
  [socioId, clubId, curY, curM, prevY, prevM]
);

if (!rSocio.rowCount) {
  return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
}

const socio = rSocio.rows[0];
const actividad = socio.actividad || null;
const categoria = socio.categoria || null;

let anioNac = null;
if (socio.fecha_nacimiento) {
  const d = new Date(socio.fecha_nacimiento);
  if (!isNaN(d.getTime())) {
    anioNac = String(d.getFullYear());
  }
}

// 🔴 En falta de pago si NO está al día
const enFaltaPago = socio.pago_al_dia === false;

const r = await db.query(
  `
  SELECT
    id,
    club_id,
    titulo,
    texto,
    imagen_url,
    destino_tipo,
    destino_valor1,
    destino_valor2,
    created_at,
    updated_at,
    activo
  FROM noticias
  WHERE club_id = $1
    AND activo = true
    AND (
      destino_tipo = 'todos'
      OR (destino_tipo = 'actividad' AND destino_valor1 = $2)
      OR (destino_tipo = 'categoria' AND destino_valor1 = $3)
      OR (destino_tipo = 'anio_nac' AND destino_valor1 = $4)
      OR (destino_tipo = 'cat_anio' AND destino_valor1 = $3 AND destino_valor2 = $4)
      OR (destino_tipo = 'act_cat' AND destino_valor1 = $2 AND destino_valor2 = $3)
      OR (destino_tipo = 'falta_pago' AND $5 = true)
    )
  ORDER BY created_at DESC
  `,
  [clubId, actividad, categoria, anioNac, enFaltaPago]
);

return res.json({ ok: true, noticias: r.rows });
  } catch (e) {
    console.error('❌ GET noticias', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});



// ============================================================
// POST /club/:clubId/noticias
// body: { titulo, texto, destino_tipo, destino_valor1?, destino_valor2?,
//         imagen_base64?, imagen_mimetype? }
// ============================================================
router.post('/:clubId/noticias', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    titulo,
    texto,
    destino_tipo,
    destino_valor1 = null,
    destino_valor2 = null,
    imagen_base64,
    imagen_mimetype
  } = req.body ?? {};

  try {
    if (!titulo?.trim() || !texto?.trim()) {
      return res.status(400).json({ ok: false, error: 'Completá título y texto.' });
    }

    const dest = {
      destino_tipo: String(destino_tipo || 'todos'),
      destino_valor1: destino_valor1 ? String(destino_valor1) : null,
      destino_valor2: destino_valor2 ? String(destino_valor2) : null
    };

    validateDestino(dest);

    let imagen_url = null;
    if (imagen_base64 && imagen_mimetype) {
      const buffer = Buffer.from(imagen_base64, 'base64');
      const up = await uploadImageBuffer({
        buffer,
        mimetype: imagen_mimetype,
        originalname: 'noticia.jpg',
        folder: `clubs/${clubId}/noticias`
      });
      imagen_url = up.url;
    }

    const r = await db.query(
      `
      INSERT INTO noticias (
        club_id,
        titulo,
        texto,
        imagen_url,
        destino_tipo,
        destino_valor1,
        destino_valor2,
        created_at,
        updated_at,
        activo
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7, NOW(), NOW(), true
      )
      RETURNING
        id,
        club_id,
        titulo,
        texto,
        imagen_url,
        destino_tipo,
        destino_valor1,
        destino_valor2,
        created_at,
        updated_at,
        activo
      `,
      [
        clubId,
        titulo.trim(),
        texto.trim(),
        imagen_url,
        dest.destino_tipo,
        dest.destino_valor1,
        dest.destino_valor2
      ]
    );

    res.status(201).json({ ok: true, noticia: r.rows[0] });
  } catch (e) {
    console.error('❌ POST noticias', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// PUT /club/:clubId/noticias/:id
// body: igual que POST, pero opcionalmente puede no incluir imagen
// Si viene imagen_base64 -> reemplaza imagen previa
// ============================================================
router.put('/:clubId/noticias/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const {
    titulo,
    texto,
    destino_tipo,
    destino_valor1 = null,
    destino_valor2 = null,
    imagen_base64,
    imagen_mimetype
  } = req.body ?? {};

  try {
    if (!titulo?.trim() || !texto?.trim()) {
      return res.status(400).json({ ok: false, error: 'Completá título y texto.' });
    }

    const dest = {
      destino_tipo: String(destino_tipo || 'todos'),
      destino_valor1: destino_valor1 ? String(destino_valor1) : null,
      destino_valor2: destino_valor2 ? String(destino_valor2) : null,
    };

    validateDestino(dest);

    // Traer noticia actual (para imagen previa)
    const prev = await db.query(
      `SELECT imagen_url FROM noticias WHERE id = $1 AND club_id = $2 AND activo = true`,
      [id, clubId]
    );
    if (!prev.rowCount) {
      return res.status(404).json({ ok: false, error: 'Noticia no encontrada' });
    }

    let imagen_url = prev.rows[0].imagen_url;

    // ¿Hay nueva imagen?
    if (imagen_base64 && imagen_mimetype) {
      const buffer = Buffer.from(imagen_base64, 'base64');
      const up = await uploadImageBuffer({
        buffer,
        mimetype: imagen_mimetype,
        originalname: 'noticia.jpg',
        folder: `clubs/${clubId}/noticias`
      });
      const nuevaUrl = up.url;

      // borrar anterior si existe y es distinta
      if (imagen_url && imagen_url !== nuevaUrl) {
        try {
          await deleteFirebaseObjectByUrl(imagen_url);
        } catch (err) {
          console.warn('⚠ No se pudo borrar imagen previa de noticia:', err.message);
        }
      }
      imagen_url = nuevaUrl;
    }

    const r = await db.query(
      `
      UPDATE noticias
      SET
        titulo = $1,
        texto = $2,
        imagen_url = $3,
        destino_tipo = $4,
        destino_valor1 = $5,
        destino_valor2 = $6,
        updated_at = NOW()
      WHERE id = $7 AND club_id = $8
      RETURNING
        id,
        club_id,
        titulo,
        texto,
        imagen_url,
        destino_tipo,
        destino_valor1,
        destino_valor2,
        created_at,
        updated_at,
        activo
      `,
      [
        titulo.trim(),
        texto.trim(),
        imagen_url,
        dest.destino_tipo,
        dest.destino_valor1,
        dest.destino_valor2,
        id,
        clubId
      ]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Noticia no encontrada' });
    }

    res.json({ ok: true, noticia: r.rows[0] });
  } catch (e) {
    console.error('❌ PUT noticias', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /club/:clubId/noticias/:id
// Soft delete: activo = false
// ============================================================
router.delete('/:clubId/noticias/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    const r = await db.query(
      `
      UPDATE noticias
      SET activo = false, updated_at = NOW()
      WHERE id = $1 AND club_id = $2
      `,
      [id, clubId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Noticia no encontrada' });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE noticias', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;