const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ===============================
// Helper: validar acceso al club
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles || [];
  const allowed = roles.some(
    (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  next();
}

// ===============================
// Helpers fecha YYYY-MM-DD
// ===============================
function isISODate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// ============================================================
// GET /club/:clubId/pagos/resumen?anio=2026
// Devuelve socios + meses pagados (para la tabla principal)
// ============================================================
router.get('/:clubId/pagos/resumen', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const anio = Number(req.query.anio) || new Date().getFullYear();

    const r = await db.query(
      `
      SELECT
        s.id AS socio_id,
        s.numero_socio,
        s.nombre,
        s.apellido,
        COALESCE(
          ARRAY_AGG(pm.mes ORDER BY pm.mes) FILTER (WHERE pm.mes IS NOT NULL),
          '{}'
        ) AS meses_pagados
      FROM socios s
      LEFT JOIN pagos_mensuales pm
        ON pm.socio_id = s.id
        AND pm.club_id = s.club_id
        AND pm.anio = $2
      WHERE s.club_id = $1 AND s.activo = true
      GROUP BY s.id, s.numero_socio, s.nombre, s.apellido
      ORDER BY s.numero_socio ASC
      `,
      [clubId, anio]
    );

    res.json({ ok: true, anio, socios: r.rows });
  } catch (e) {
    console.error('❌ pagos resumen:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// GET /club/:clubId/pagos/:socioId?anio=2026
// Devuelve pagos del socio + mesesPagados (para deshabilitar botones)
// ============================================================
router.get('/:clubId/pagos/:socioId', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId, socioId } = req.params;
    const anio = Number(req.query.anio) || new Date().getFullYear();

    const r = await db.query(
      `
      SELECT mes, monto, fecha_pago
      FROM pagos_mensuales
      WHERE club_id = $1 AND socio_id = $2 AND anio = $3
      ORDER BY mes ASC
      `,
      [clubId, socioId, anio]
    );

    res.json({
      ok: true,
      anio,
      pagos: r.rows,
      mesesPagados: r.rows.map((x) => Number(x.mes)),
    });
  } catch (e) {
    console.error('❌ pagos socio:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/pagos
// body: { socio_id, anio, meses:[1..12], fecha_pago:"YYYY-MM-DD" }
// Guarda 1 registro por mes con el monto desde cuotas_mensuales
// ============================================================
router.post('/:clubId/pagos', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { socio_id, anio, meses, fecha_pago } = req.body || {};

    if (!socio_id || !anio || !Array.isArray(meses) || meses.length === 0 || !fecha_pago) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos' });
    }
    if (!isISODate(fecha_pago)) {
      return res.status(400).json({ ok: false, error: 'fecha_pago inválida (use YYYY-MM-DD)' });
    }

    const anioNum = Number(anio);
    const mesesNum = meses.map(Number).filter((m) => m >= 1 && m <= 12);
    if (!anioNum || mesesNum.length === 0) {
      return res.status(400).json({ ok: false, error: 'Año o meses inválidos' });
    }

    // Traer montos configurados (cuotas_mensuales)
    const rCuotas = await db.query(
      `
      SELECT mes, monto
      FROM cuotas_mensuales
      WHERE club_id = $1
      `,
      [clubId]
    );

    const mapMonto = new Map(rCuotas.rows.map((r) => [Number(r.mes), Number(r.monto)]));

    // Validar que existan montos para todos los meses seleccionados
    const sinMonto = mesesNum.filter((m) => !mapMonto.has(m));
    if (sinMonto.length) {
      return res.status(400).json({
        ok: false,
        error: `Falta configurar monto para los meses: ${sinMonto.join(', ')}`,
      });
    }

    await db.query('BEGIN');

    // Insert por mes, evitando duplicados por unique index
    const inserted = [];
    for (const mes of mesesNum) {
      const monto = mapMonto.get(mes);

      const rIns = await db.query(
        `
        INSERT INTO pagos_mensuales (club_id, socio_id, anio, mes, monto, fecha_pago)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (club_id, socio_id, anio, mes) DO NOTHING
        RETURNING id, anio, mes, monto, fecha_pago
        `,
        [clubId, socio_id, anioNum, mes, monto, fecha_pago]
      );

      if (rIns.rowCount) inserted.push(rIns.rows[0]);
    }

    await db.query('COMMIT');
    res.json({ ok: true, insertedCount: inserted.length, inserted });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('❌ registrar pagos:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// ✅ NUEVO: INGRESOS GENERALES (no asociados a socios)
// ============================================================

// ------------------------------------------------------------
// GET /club/:clubId/ingresos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&limit=200&offset=0
// Devuelve ingresos + total (para mostrar "abajo" de pagos de socios)
// ------------------------------------------------------------
router.get('/:clubId/ingresos', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { desde = '', hasta = '', limit = '200', offset = '0' } = req.query;

  try {
    const where = ['ig.club_id = $1', 'ig.activo = true'];
    const params = [clubId];
    let p = 2;

    if (desde) {
      if (!isISODate(String(desde))) {
        return res.status(400).json({ ok: false, error: 'desde inválido (use YYYY-MM-DD)' });
      }
      where.push(`ig.fecha >= $${p++}`);
      params.push(String(desde));
    }

    if (hasta) {
      if (!isISODate(String(hasta))) {
        return res.status(400).json({ ok: false, error: 'hasta inválido (use YYYY-MM-DD)' });
      }
      where.push(`ig.fecha <= $${p++}`);
      params.push(String(hasta));
    }

    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const off = Math.max(Number(offset) || 0, 0);

    const qList = `
      SELECT
        ig.id,
        ig.fecha,
        ig.monto,
        ig.observacion,
        ig.tipo_ingreso_id,
        ti.nombre AS tipo_ingreso
      FROM ingresos_generales ig
      JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
      WHERE ${where.join(' AND ')}
      ORDER BY ig.fecha DESC, ig.created_at DESC
      LIMIT $${p++} OFFSET $${p++}
    `;

    const qTotal = `
      SELECT COALESCE(SUM(ig.monto), 0) AS total
      FROM ingresos_generales ig
      WHERE ${where.join(' AND ')}
    `;

    const paramsList = params.slice();
    paramsList.push(lim, off);

    const [rList, rTotal] = await Promise.all([
      db.query(qList, paramsList),
      db.query(qTotal, params),
    ]);

    res.json({
      ok: true,
      ingresos: rList.rows || [],
      total: Number(rTotal.rows?.[0]?.total || 0),
    });
  } catch (e) {
    console.error('❌ get ingresos:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/ingresos
// body: { tipo_ingreso_id, fecha:"YYYY-MM-DD", monto:Number, observacion? }
// ------------------------------------------------------------
router.post('/:clubId/ingresos', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { tipo_ingreso_id, fecha, monto, observacion } = req.body || {};

  try {
    if (!tipo_ingreso_id || !fecha || monto === undefined || monto === null) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos' });
    }
    if (!isISODate(String(fecha))) {
      return res.status(400).json({ ok: false, error: 'fecha inválida (use YYYY-MM-DD)' });
    }

    const montoNum = Number(monto);
    if (Number.isNaN(montoNum) || montoNum < 0) {
      return res.status(400).json({ ok: false, error: 'Monto inválido' });
    }

    // Validar tipo_ingreso pertenece al club y está activo
    const rTipo = await db.query(
      `SELECT id FROM tipos_ingreso WHERE id = $1 AND club_id = $2 AND activo = true`,
      [tipo_ingreso_id, clubId]
    );
    if (!rTipo.rowCount) {
      return res.status(400).json({ ok: false, error: 'Tipo de ingreso inexistente o inactivo' });
    }

    const r = await db.query(
      `
      INSERT INTO ingresos_generales
        (id, club_id, tipo_ingreso_id, fecha, monto, observacion, created_at, activo)
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), true)
      RETURNING id, club_id, tipo_ingreso_id, fecha, monto, observacion, created_at
      `,
      [clubId, tipo_ingreso_id, String(fecha), montoNum, (observacion ?? null)]
    );

    res.status(201).json({ ok: true, ingreso: r.rows[0] });
  } catch (e) {
    console.error('❌ create ingreso:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;