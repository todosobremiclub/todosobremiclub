


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
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  next();
}

// ===============================
// Helpers período YYYY-MM <-> DATE
// ===============================
function parsePeriodoYYYYMM(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (!anio || anio < 2000 || anio > 2100) return null;
  if (!mes || mes < 1 || mes > 12) return null;
  return { anio, mes, date: `${anio}-${String(mes).padStart(2, '0')}-01` };
}

function fmtYYYYMM(dateVal) {
  try {
    const d = new Date(dateVal);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  } catch {
    return null;
  }
}

// ============================================================
// GET /club/:clubId/gastos?desde=YYYY-MM&hasta=YYYY-MM&limit=200&offset=0
// Devuelve gastos + total del período
// ============================================================
router.get('/:clubId/gastos', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { desde = '', hasta = '', limit = '200', offset = '0' } = req.query;

  try {
    const pDesde = desde ? parsePeriodoYYYYMM(String(desde)) : null;
    const pHasta = hasta ? parsePeriodoYYYYMM(String(hasta)) : null;

    if (desde && !pDesde) return res.status(400).json({ ok: false, error: 'Parámetro "desde" inválido (use YYYY-MM)' });
    if (hasta && !pHasta) return res.status(400).json({ ok: false, error: 'Parámetro "hasta" inválido (use YYYY-MM)' });

    const where = ['g.club_id = $1', 'g.activo = true'];
    const params = [clubId];
    let p = 2;

    if (pDesde) {
      where.push(`g.periodo >= $${p++}`);
      params.push(pDesde.date);
    }
    if (pHasta) {
      where.push(`g.periodo <= $${p++}`);
      params.push(pHasta.date);
    }

    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const off = Math.max(Number(offset) || 0, 0);

    const qList = `
      SELECT
        g.id,
        g.periodo,
        g.fecha_gasto,
        g.tipo_gasto_id,
        tg.nombre AS tipo_gasto,
        g.responsable_id,
        rg.nombre AS responsable,
        g.monto,
        g.descripcion,
        g.created_at
      FROM gastos g
      JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
      JOIN responsables_gasto rg ON rg.id = g.responsable_id
      WHERE ${where.join(' AND ')}
      ORDER BY g.periodo DESC, g.created_at DESC
      LIMIT $${p++} OFFSET $${p++}
    `;

    const qTotal = `
      SELECT COALESCE(SUM(g.monto), 0) AS total
      FROM gastos g
      WHERE ${where.join(' AND ')}
    `;

    const paramsList = params.slice();
    paramsList.push(lim, off);

    const [rList, rTotal] = await Promise.all([
      db.query(qList, paramsList),
      db.query(qTotal, params),
    ]);

    const gastos = (rList.rows || []).map(row => ({
      ...row,
      periodo: fmtYYYYMM(row.periodo) || row.periodo,
    }));

    const total = Number(rTotal.rows?.[0]?.total || 0);

    res.json({ ok: true, gastos, total });
  } catch (e) {
    console.error('❌ get gastos', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/gastos
// body: { periodo:"YYYY-MM", fecha_gasto:"YYYY-MM-DD", tipo_gasto_id, responsable_id, monto, descripcion? }
// ============================================================
router.post('/:clubId/gastos', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    periodo,
    fecha_gasto,
    tipo_gasto_id,
    responsable_id,
    monto,
    descripcion,
  } = req.body || {};

  try {
    const pPeriodo = parsePeriodoYYYYMM(String(periodo || ''));
    if (!pPeriodo) return res.status(400).json({ ok: false, error: 'Periodo inválido (use YYYY-MM)' });

    if (!fecha_gasto) return res.status(400).json({ ok: false, error: 'Falta fecha_gasto (YYYY-MM-DD)' });
    if (!tipo_gasto_id) return res.status(400).json({ ok: false, error: 'Falta tipo_gasto_id' });
    if (!responsable_id) return res.status(400).json({ ok: false, error: 'Falta responsable_id' });

    const montoNum = Number(monto);
    if (Number.isNaN(montoNum) || montoNum < 0) {
      return res.status(400).json({ ok: false, error: 'Monto inválido' });
    }

    // Validar referencias activas (opcional pero útil)
    const [tg, rg] = await Promise.all([
      db.query(`SELECT id FROM tipos_gasto WHERE id=$1 AND club_id=$2 AND activo=true`, [tipo_gasto_id, clubId]),
      db.query(`SELECT id FROM responsables_gasto WHERE id=$1 AND club_id=$2 AND activo=true`, [responsable_id, clubId]),
    ]);

    if (!tg.rowCount) return res.status(400).json({ ok: false, error: 'Tipo de gasto inexistente o inactivo' });
    if (!rg.rowCount) return res.status(400).json({ ok: false, error: 'Responsable inexistente o inactivo' });

    const r = await db.query(
      `
      INSERT INTO gastos (
        id, club_id, periodo, fecha_gasto, tipo_gasto_id, responsable_id, monto, descripcion, activo, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW()
      )
      RETURNING id, club_id, periodo, fecha_gasto, tipo_gasto_id, responsable_id, monto, descripcion, created_at
      `,
      [
        clubId,
        pPeriodo.date,
        fecha_gasto,
        tipo_gasto_id,
        responsable_id,
        montoNum,
        (descripcion ?? null),
      ]
    );

    const gasto = r.rows[0];
    res.status(201).json({
      ok: true,
      gasto: { ...gasto, periodo: fmtYYYYMM(gasto.periodo) || gasto.periodo },
    });
  } catch (e) {
    console.error('❌ create gasto', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /club/:clubId/gastos/:id  (soft delete)
// ============================================================
router.delete('/:clubId/gastos/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    const r = await db.query(
      `
      UPDATE gastos
      SET activo=false, updated_at=NOW()
      WHERE id=$1 AND club_id=$2
      `,
      [id, clubId]
    );

    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Gasto no encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ delete gasto', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// GET /club/:clubId/gastos/total?desde=YYYY-MM&hasta=YYYY-MM
// ============================================================
router.get('/:clubId/gastos/total', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { desde = '', hasta = '' } = req.query;

  try {
    const pDesde = desde ? parsePeriodoYYYYMM(String(desde)) : null;
    const pHasta = hasta ? parsePeriodoYYYYMM(String(hasta)) : null;

    if (desde && !pDesde) return res.status(400).json({ ok: false, error: 'Parámetro "desde" inválido (use YYYY-MM)' });
    if (hasta && !pHasta) return res.status(400).json({ ok: false, error: 'Parámetro "hasta" inválido (use YYYY-MM)' });

    const where = ['club_id = $1', 'activo = true'];
    const params = [clubId];
    let p = 2;

    if (pDesde) {
      where.push(`periodo >= $${p++}`);
      params.push(pDesde.date);
    }
    if (pHasta) {
      where.push(`periodo <= $${p++}`);
      params.push(pHasta.date);
    }

    const r = await db.query(
      `SELECT COALESCE(SUM(monto), 0) AS total
       FROM gastos
       WHERE ${where.join(' AND ')}`,
      params
    );

    res.json({ ok: true, total: Number(r.rows?.[0]?.total || 0) });
  } catch (e) {
    console.error('❌ total gastos', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;