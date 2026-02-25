const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles || [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok:false, error:'No autorizado para este club' });
  next();
}

// ============================================================
// GET /club/:clubId/pagos/resumen?anio=2026
// Devuelve socios + meses pagados (para la tabla principal)
// ============================================================
router.get('/:clubId/pagos/resumen', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const anio = Number(req.query.anio) || new Date().getFullYear();

    const r = await db.query(`
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
    `, [clubId, anio]);

    res.json({ ok:true, anio, socios: r.rows });
  } catch (e) {
    console.error('❌ pagos resumen:', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ============================================================
// GET /club/:clubId/pagos/:socioId?anio=2026
// Devuelve meses pagos (para deshabilitar botones en el modal)
// ============================================================
router.get('/:clubId/pagos/:socioId', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId, socioId } = req.params;
    const anio = Number(req.query.anio) || new Date().getFullYear();

    const r = await db.query(`
      SELECT mes, monto, fecha_pago
      FROM pagos_mensuales
      WHERE club_id = $1 AND socio_id = $2 AND anio = $3
      ORDER BY mes ASC
    `, [clubId, socioId, anio]);

    res.json({ ok:true, anio, pagos: r.rows, mesesPagados: r.rows.map(x => Number(x.mes)) });
  } catch (e) {
    console.error('❌ pagos socio:', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/pagos
// body: { socio_id, anio, meses: [1..12], fecha_pago: "YYYY-MM-DD" }
// Guarda 1 registro por mes con el monto desde cuotas_mensuales
// ============================================================
router.post('/:clubId/pagos', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { socio_id, anio, meses, fecha_pago } = req.body || {};

    if (!socio_id || !anio || !Array.isArray(meses) || meses.length === 0 || !fecha_pago) {
      return res.status(400).json({ ok:false, error:'Datos incompletos' });
    }

    const anioNum = Number(anio);
    const mesesNum = meses.map(Number).filter(m => m >= 1 && m <= 12);

    if (!anioNum || mesesNum.length === 0) {
      return res.status(400).json({ ok:false, error:'Año o meses inválidos' });
    }

    // Traer montos configurados (cuotas_mensuales)
    const rCuotas = await db.query(`
      SELECT mes, monto
      FROM cuotas_mensuales
      WHERE club_id = $1
    `, [clubId]);

    const mapMonto = new Map(rCuotas.rows.map(r => [Number(r.mes), Number(r.monto)]));

    // Validar que existan montos para todos los meses seleccionados
    const sinMonto = mesesNum.filter(m => !mapMonto.has(m));
    if (sinMonto.length) {
      return res.status(400).json({
        ok:false,
        error:`Falta configurar monto para los meses: ${sinMonto.join(', ')}`
      });
    }

    await db.query('BEGIN');

    // Insert por mes, evitando duplicados por el unique index
    const inserted = [];
    for (const mes of mesesNum) {
      const monto = mapMonto.get(mes);

      const rIns = await db.query(`
        INSERT INTO pagos_mensuales (club_id, socio_id, anio, mes, monto, fecha_pago)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (club_id, socio_id, anio, mes) DO NOTHING
        RETURNING id, anio, mes, monto, fecha_pago
      `, [clubId, socio_id, anioNum, mes, monto, fecha_pago]);

      if (rIns.rowCount) inserted.push(rIns.rows[0]);
    }

    await db.query('COMMIT');

    res.json({ ok:true, insertedCount: inserted.length, inserted });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('❌ registrar pagos:', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

module.exports = router;
