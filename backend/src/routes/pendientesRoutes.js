const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');

const router = express.Router();

function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
    (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  next();
}

// GET /club/:clubId/pendientes
router.get('/:clubId/pendientes', requireAuth, async (req, res) => {
  const { tipo } = req.query;
  try {
    const { clubId } = req.params;
    const r = await db.query(
      `SELECT id, nombre, apellido, dni, actividad, categoria, telefono, direccion,
              fecha_nacimiento, foto_url, tipo, estado, created_at
       FROM socios_pendientes
       WHERE club_id=$1 AND estado='pendiente'
       ORDER BY created_at DESC`,
      [clubId]
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error('❌ pendientes list', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /club/:clubId/pendientes/:id/rechazar
router.post('/:clubId/pendientes/:id/rechazar', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId, id } = req.params;
    const { motivo = null } = req.body ?? {};

    const r = await db.query(
      `UPDATE socios_pendientes
       SET estado='rechazado', motivo_rechazo=$1, updated_at=now()
       WHERE id=$2 AND club_id=$3 AND estado='pendiente'`,
      [motivo, id, clubId]
    );

    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ rechazar', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /club/:clubId/pendientes/:id/aceptar
router.post('/:clubId/pendientes/:id/aceptar', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    await db.query('BEGIN');

    // 1) Traer pendiente (lock para que no se acepte dos veces)
    const rP = await db.query(
      `SELECT *
       FROM socios_pendientes
       WHERE id=$1 AND club_id=$2 AND estado='pendiente'
       LIMIT 1
       FOR UPDATE`,
      [id, clubId]
    );

    if (!rP.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'No encontrado' });
    }
    const p = rP.rows[0];

const tipo = String(p.tipo ?? 'alta').toLowerCase();


    // 2) Validación según tipo
const rSoc = await db.query(
  `SELECT id, numero_socio, foto_url FROM socios WHERE club_id=$1 AND dni=$2 LIMIT 1`,
  [clubId, p.dni]
);

if (tipo === 'foto') {
  if (!rSoc.rowCount) {
    await db.query('ROLLBACK');
    return res.status(404).json({ ok:false, error:'No existe socio con ese DNI' });
  }
  if (!p.foto_url) {
    await db.query('ROLLBACK');
    return res.status(400).json({ ok:false, error:'La postulación no trae foto para aplicar' });
  }

  // Actualizar foto del socio existente
  const socioId = rSoc.rows[0].id;
  await db.query(
    `UPDATE socios SET foto_url = $1, updated_at = NOW() WHERE id = $2 AND club_id = $3`,
    [p.foto_url, socioId, clubId]
  );

  // Marcar pendiente como aceptado
  await db.query(
    `UPDATE socios_pendientes
     SET estado='aceptado', updated_at=now()
     WHERE id=$1 AND club_id=$2`,
    [id, clubId]
  );

  await db.query('COMMIT');
  return res.json({
    ok:true,
    modo:'foto',
    socioId,
    numero_socio: rSoc.rows[0].numero_socio
  });
}

// alta normal: si ya existe, conflicto
if (rSoc.rowCount) {
  await db.query('ROLLBACK');
  return res.status(409).json({ ok: false, error: 'Ya existe un socio con ese DNI' });
}


    // 3) Asegurar counter
await db.query(
  `
  INSERT INTO club_counters (club_id, next_socio_num)
  VALUES ($1, 1)
  ON CONFLICT (club_id) DO NOTHING
  `,
  [clubId]
);

// 4) Tomar siguiente número LIBRE real (saltando ocupados) con lock
//    Nota: esto soluciona contadores desfasados en clubes con historia/migraciones
const rLock = await db.query(
  `SELECT next_socio_num FROM club_counters WHERE club_id = $1 LIMIT 1 FOR UPDATE`,
  [clubId]
);

let candidate = Number(rLock.rows?.[0]?.next_socio_num ?? 1);
if (!candidate || Number.isNaN(candidate) || candidate < 1) candidate = 1;

// Loop para saltear números ya usados
// (limitamos iteraciones para evitar loops infinitos por datos corruptos)
let guard = 0;
while (guard < 5000) {
  const rExists = await db.query(
    `SELECT 1 FROM socios WHERE club_id = $1 AND numero_socio = $2 LIMIT 1`,
    [clubId, candidate]
  );
  if (!rExists.rowCount) break;
  candidate += 1;
  guard += 1;
}

if (guard >= 5000) {
  await db.query('ROLLBACK');
  return res.status(500).json({ ok: false, error: 'No se pudo generar número de socio (loop protección)' });
}

// Actualizar contador al siguiente disponible
await db.query(
  `UPDATE club_counters SET next_socio_num = $2 WHERE club_id = $1`,
  [clubId, candidate + 1]
);

const numero = candidate;


    // 5) Insertar socio definitivo (mínimo y compatible)
    // Nota: fecha_ingreso queda null, foto_url se puede agregar luego si querés.
    let rIns;
    try {
      rIns = await db.query(
        `INSERT INTO socios (
          club_id, numero_socio, dni, nombre, apellido,
          telefono, direccion, email, fecha_nacimiento,
          activo, becado, categoria, actividad
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,$10,$11
        )
        RETURNING id`,
        [
          clubId,
          numero,
          p.dni,
          p.nombre,
          p.apellido,
          p.telefono ?? null,
          p.direccion ?? null,
          p.email ?? null,
          p.fecha_nacimiento,
          p.categoria,
          p.actividad
        ]
      );
    } catch (e) {
      // Duplicados (por si carrera de datos)
      if (e && e.code === '23505') {
        await db.query('ROLLBACK');
        return res.status(409).json({
  ok: false,
  error: 'Duplicado en DB',
  constraint: e.constraint || null,
  detail: e.detail || null
});
      }
      throw e;
    }

    if (!rIns?.rowCount) {
      await db.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: 'No se pudo insertar el socio' });
    }

    const socioId = rIns.rows[0].id;

// 5.b) Copiar foto del pendiente al socio (si existe)
if (p.foto_url) {
  await db.query(
    `UPDATE socios
     SET foto_url = $1
     WHERE id = $2`,
    [p.foto_url, socioId]
  );
}

    // 6) Marcar pendiente como aceptado
    await db.query(
      `UPDATE socios_pendientes
       SET estado='aceptado', updated_at=now()
       WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );

    await db.query('COMMIT');

    res.json({ ok: true, socioId, numero_socio: numero });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}

    // ✅ LOG DETALLADO (esto es lo que necesitábamos para ver el error real)
    console.error('❌ ERROR ACEPTAR PENDIENTE', {
      message: e.message,
      code: e.code,
      detail: e.detail,
      stack: e.stack
    });

    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==========================================
// APP: solicitud cambio de foto
// ==========================================
router.post('/app/socios/photo-request', requireAuth, async (req, res) => {
  try {
    const { socio_id, foto_base64, filename, mimetype } = req.body;

    if (!socio_id || !foto_base64) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan datos'
      });
    }

    // 👉 sacar club del usuario
    const clubId = req.user?.roles?.[0]?.club_id;

    if (!clubId) {
      return res.status(400).json({
        ok: false,
        error: 'No se pudo determinar el club'
      });
    }

    // 👉 obtener socio actual
    const rSocio = await db.query(
      `SELECT * FROM socios WHERE id=$1 AND club_id=$2 LIMIT 1`,
      [socio_id, clubId]
    );

    if (!rSocio.rowCount) {
      return res.status(404).json({
        ok: false,
        error: 'Socio no encontrado'
      });
    }

    const s = rSocio.rows[0];

    /// 👉 subir imagen a storage y guardar URL real
const buffer = Buffer.from(foto_base64, 'base64');

const up = await uploadImageBuffer({
  buffer,
  mimetype: mimetype || 'image/jpeg',
  originalname: filename || 'socio-app.jpg',
  folder: `clubs/${clubId}/socios`
});

const fotoUrl = up.url;


    // 👉 CREAR PENDIENTE
    const r = await db.query(
      `
      INSERT INTO socios_pendientes (
        club_id,
        nombre,
        apellido,
        dni,
        actividad,
        categoria,
        telefono,
        direccion,
        fecha_nacimiento,
        foto_url,
        tipo,
        estado
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'foto','pendiente')
      RETURNING id
      `,
      [
        clubId,
        s.nombre,
        s.apellido,
        s.dni,
        s.actividad,
        s.categoria,
        s.telefono,
        s.direccion,
        s.fecha_nacimiento,
        fotoUrl
      ]
    );

    return res.json({
      ok: true,
      pendiente_id: r.rows[0].id
    });

  } catch (e) {
    console.error('❌ photo request', e);
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

module.exports = router;