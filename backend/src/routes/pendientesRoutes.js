const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

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
router.get('/:clubId/pendientes', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const r = await db.query(
      `SELECT id, nombre, apellido, dni, actividad, categoria, telefono, direccion,
              fecha_nacimiento, foto_url, estado, created_at
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

    // 2) Validar duplicado DNI contra socios
    const rDup = await db.query(
      `SELECT 1 FROM socios WHERE club_id=$1 AND dni=$2 LIMIT 1`,
      [clubId, p.dni]
    );
    if (rDup.rowCount) {
      await db.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Ya existe un socio con ese DNI' });
    }

    // 3) Asegurar counter
    await db.query(
      `INSERT INTO club_counters (club_id, next_socio_num)
       VALUES ($1, 1)
       ON CONFLICT (club_id) DO NOTHING`,
      [clubId]
    );

    // 4) Tomar siguiente número (y reintentar si por algún motivo no devolvió fila)
    let numero = null;

    const rCounter = await db.query(
      `UPDATE club_counters
       SET next_socio_num = next_socio_num + 1
       WHERE club_id = $1
       RETURNING (next_socio_num - 1) AS numero`,
      [clubId]
    );

    if (rCounter.rowCount) {
      numero = Number(rCounter.rows[0].numero);
    }

    if (!numero || Number.isNaN(numero)) {
      // fallback: leer y usar next_socio_num manualmente
      const rSel = await db.query(
        `SELECT next_socio_num FROM club_counters WHERE club_id=$1 LIMIT 1`,
        [clubId]
      );
      const n = Number(rSel.rows?.[0]?.next_socio_num ?? 1);
      numero = n;

      await db.query(
        `UPDATE club_counters SET next_socio_num = $2 WHERE club_id=$1`,
        [clubId, n + 1]
      );
    }

    if (!numero || Number.isNaN(numero)) {
      await db.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: 'No se pudo generar número de socio' });
    }

    // 5) Insertar socio definitivo (mínimo y compatible)
    // Nota: fecha_ingreso queda null, foto_url se puede agregar luego si querés.
    let rIns;
    try {
      rIns = await db.query(
        `INSERT INTO socios (
          club_id, numero_socio, dni, nombre, apellido,
          telefono, direccion, fecha_nacimiento,
          activo, becado, categoria, actividad
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,true,false,$9,$10
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
          p.fecha_nacimiento,
          p.categoria,
          p.actividad
        ]
      );
    } catch (e) {
      // Duplicados (por si carrera de datos)
      if (e && e.code === '23505') {
        await db.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'DNI o N° de socio duplicado (DB)' });
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

module.exports = router;