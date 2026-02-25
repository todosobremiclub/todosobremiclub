const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const { initFirebase } = require('../config/firebaseAdmin');
const router = express.Router();

// ===============================
// Helper: validar acceso al club
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles || [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  next();
}

// ===============================
// Helpers Firebase delete
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
// LISTAR / BUSCAR / FILTRAR (+ pago_al_dia)
// ===============================
router.get('/:clubId/socios', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const {
      search = '',
      categoria = '',
      activo = '',
      anio = '',
      limit = '200',
      offset = '0'
    } = req.query;

    // Periodo actual y anterior (para estado de pago)
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;
    let prevY = curY;
    let prevM = curM - 1;
    if (prevM === 0) { prevM = 12; prevY = curY - 1; }

    const where = ['s.club_id = $1'];
    const params = [clubId];
    let p = 2;

    if (activo !== '') { where.push(`s.activo = $${p++}`); params.push(activo === '1'); }
    if (categoria) { where.push(`s.categoria = $${p++}`); params.push(categoria); }
    if (anio) { where.push(`EXTRACT(YEAR FROM s.fecha_nacimiento) = $${p++}`); params.push(Number(anio)); }
    if (search) {
      where.push(`(
        s.nombre ILIKE $${p} OR
        s.apellido ILIKE $${p} OR
        s.dni ILIKE $${p}
      )`);
      params.push(`%${search}%`);
      p++;
    }

    // params para cálculo pago
    const pCurY = p++; params.push(curY);
    const pCurM = p++; params.push(curM);
    const pPrevY = p++; params.push(prevY);
    const pPrevM = p++; params.push(prevM);

    const q = `
      SELECT
        s.id, s.club_id, s.numero_socio, s.dni, s.nombre, s.apellido, s.categoria, s.telefono,
        s.fecha_nacimiento, s.fecha_ingreso, s.activo, s.becado, s.foto_url,
        s.created_at, s.updated_at,
        DATE_PART('year', AGE(s.fecha_nacimiento))::int AS edad,
        EXTRACT(YEAR FROM s.fecha_nacimiento)::int AS anio_nacimiento,

        CASE
          WHEN s.becado = true THEN true
          WHEN EXISTS (
            SELECT 1
            FROM pagos_mensuales pm
            WHERE pm.club_id = s.club_id
              AND pm.socio_id = s.id
              AND (
                (pm.anio = $${pCurY} AND pm.mes = $${pCurM})
                OR
                (pm.anio = $${pPrevY} AND pm.mes = $${pPrevM})
              )
          ) THEN true
          ELSE false
        END AS pago_al_dia

      FROM socios s
      WHERE ${where.join(' AND ')}
      ORDER BY s.numero_socio ASC
      LIMIT $${p++} OFFSET $${p++}
    `;

    params.push(Number(limit), Number(offset));
    const r = await db.query(q, params);
    res.json({ ok: true, socios: r.rows });
  } catch (e) {
    console.error('❌ list socios', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// CREAR SOCIO
// ===============================
router.post('/:clubId/socios', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    numero_socio,
    dni, nombre, apellido, telefono,
    fecha_nacimiento, fecha_ingreso,
    activo = true,
    becado = false,
    categoria
  } = req.body || {};

  try {
    if (!dni || !nombre || !apellido || !fecha_nacimiento || !categoria) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios' });
    }

    await db.query('BEGIN');
    await db.query(`
      INSERT INTO club_counters (club_id, next_socio_num)
      VALUES ($1, 1)
      ON CONFLICT (club_id) DO NOTHING
    `, [clubId]);

    let nro = numero_socio;
    if (!nro) {
      const rNum = await db.query(`
        UPDATE club_counters
        SET next_socio_num = next_socio_num + 1
        WHERE club_id = $1
        RETURNING (next_socio_num - 1) AS numero
      `, [clubId]);
      nro = rNum.rows[0].numero;
    }

    const r = await db.query(`
      INSERT INTO socios (
        club_id, numero_socio, dni, nombre, apellido, telefono,
        fecha_nacimiento, fecha_ingreso, activo, becado, categoria
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      clubId, nro, String(dni), String(nombre), String(apellido),
      telefono || null,
      fecha_nacimiento,
      fecha_ingreso || null,
      !!activo, !!becado, String(categoria)
    ]);

    await db.query('COMMIT');
    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('❌ create socio', e);
    if (e.code === '23505') {
      return res.status(409).json({ ok: false, error: 'DNI o Nº de socio ya existe en este club' });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// EDITAR SOCIO
// ===============================
router.put('/:clubId/socios/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const {
    numero_socio, dni, nombre, apellido, telefono,
    fecha_nacimiento, fecha_ingreso,
    activo, becado, categoria
  } = req.body || {};

  try {
    const r = await db.query(`
      UPDATE socios SET
        numero_socio=$1, dni=$2, nombre=$3, apellido=$4, telefono=$5,
        fecha_nacimiento=$6, fecha_ingreso=$7,
        activo=$8, becado=$9, categoria=$10
      WHERE id=$11 AND club_id=$12
      RETURNING *
    `, [
      numero_socio, dni, nombre, apellido, telefono || null,
      fecha_nacimiento, fecha_ingreso || null,
      !!activo, !!becado, categoria,
      id, clubId
    ]);

    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    console.error('❌ update socio', e);
    if (e.code === '23505') {
      return res.status(409).json({ ok: false, error: 'DNI o Nº de socio ya existe en este club' });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// ELIMINAR SOCIO
// ===============================
router.delete('/:clubId/socios/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    const r = await db.query(`DELETE FROM socios WHERE id=$1 AND club_id=$2`, [id, clubId]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ delete socio', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// SUBIR / REEMPLAZAR FOTO (borra la anterior)
// ===============================
router.post('/:clubId/socios/:id/foto', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { base64, mimetype, filename } = req.body || {};

  try {
    if (!base64 || !mimetype) {
      return res.status(400).json({ ok: false, error: 'Falta base64 o mimetype' });
    }

    const prev = await db.query(
      `SELECT foto_url FROM socios WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );
    if (!prev.rowCount) return res.status(404).json({ ok: false, error: 'Socio no encontrado' });

    const oldUrl = prev.rows[0].foto_url;

    const buffer = Buffer.from(base64, 'base64');
    const up = await uploadImageBuffer({
      buffer,
      mimetype,
      originalname: filename || 'socio.jpg',
      folder: `clubs/${clubId}/socios`
    });

    const r = await db.query(
      `UPDATE socios SET foto_url=$1 WHERE id=$2 AND club_id=$3 RETURNING id, foto_url`,
      [up.url, id, clubId]
    );

    if (oldUrl && oldUrl !== up.url) {
      try { await deleteFirebaseObjectByUrl(oldUrl); }
      catch (err) { console.warn('⚠️ No se pudo borrar la foto anterior:', err.message); }
    }

    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    console.error('❌ upload/replace foto socio', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// EXPORT CSV
// ===============================
router.get('/:clubId/socios/export.csv', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(`
      SELECT
        numero_socio, dni, nombre, apellido, categoria, telefono,
        fecha_nacimiento, fecha_ingreso, activo, becado, foto_url
      FROM socios
      WHERE club_id=$1
      ORDER BY numero_socio ASC
    `, [clubId]);

    const header = [
      'numero_socio','dni','nombre','apellido','categoria','telefono',
      'fecha_nacimiento','fecha_ingreso','activo','becado','foto_url'
    ];
    const lines = [header.join(',')].concat(
      r.rows.map(row =>
        header.map(h => {
          const v = row[h];
          const s = v == null ? '' : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(',')
      )
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="socios.csv"');
    res.send(lines.join('\n'));
  } catch (e) {
    console.error('❌ export socios', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;