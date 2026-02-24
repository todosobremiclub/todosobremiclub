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
  if (!allowed) return res.status(403).json({ ok:false, error:'No autorizado para este club' });
  next();
}

/* ============================================================
   CUOTAS
   GET  /club/:clubId/config/cuotas
   POST /club/:clubId/config/cuotas/:mes
============================================================ */
router.get('/:clubId/config/cuotas', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(
      `SELECT mes, monto
       FROM cuotas_mensuales
       WHERE club_id = $1
       ORDER BY mes ASC`,
      [clubId]
    );
    res.json({ ok:true, cuotas: r.rows });
  } catch (e) {
    console.error('❌ get cuotas', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.post('/:clubId/config/cuotas/:mes', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, mes } = req.params;
  const { monto } = req.body || {};

  try {
    const mesNum = Number(mes);
    if (!mesNum || mesNum < 1 || mesNum > 12) {
      return res.status(400).json({ ok:false, error:'Mes inválido' });
    }
    if (monto !== null && (isNaN(monto) || Number(monto) < 0)) {
      return res.status(400).json({ ok:false, error:'Monto inválido' });
    }

    const r = await db.query(
      `
      INSERT INTO cuotas_mensuales (club_id, mes, monto, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (club_id, mes)
      DO UPDATE SET monto = EXCLUDED.monto, updated_at = NOW()
      RETURNING mes, monto
      `,
      [clubId, mesNum, monto]
    );

    res.json({ ok:true, cuota: r.rows[0] });
  } catch (e) {
    console.error('❌ save cuota', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

/* ============================================================
   CATEGORÍAS (por club)
   GET/POST/PUT/DELETE /club/:clubId/config/categorias
============================================================ */
router.get('/:clubId/config/categorias', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(
      `SELECT id, nombre
       FROM categorias_deportivas
       WHERE club_id = $1 AND activo = true
       ORDER BY nombre ASC`,
      [clubId]
    );
    res.json({ ok:true, categorias: r.rows });
  } catch (e) {
    console.error('❌ get categorias', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.post('/:clubId/config/categorias', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { nombre } = req.body || {};
  try {
    if (!nombre?.trim()) return res.status(400).json({ ok:false, error:'Falta nombre' });

    const r = await db.query(
      `INSERT INTO categorias_deportivas (id, club_id, nombre, activo, updated_at)
       VALUES (gen_random_uuid(), $1, $2, true, NOW())
       RETURNING id, nombre`,
      [clubId, nombre.trim()]
    );
    res.json({ ok:true, categoria: r.rows[0] });
  } catch (e) {
    console.error('❌ create categoria', e);
    if (e.code === '23505') return res.status(409).json({ ok:false, error:'La categoría ya existe' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.put('/:clubId/config/categorias/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { nombre } = req.body || {};
  try {
    if (!nombre?.trim()) return res.status(400).json({ ok:false, error:'Falta nombre' });

    const r = await db.query(
      `UPDATE categorias_deportivas
       SET nombre=$1, updated_at=NOW()
       WHERE id=$2 AND club_id=$3
       RETURNING id, nombre`,
      [nombre.trim(), id, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'No encontrada' });
    res.json({ ok:true, categoria: r.rows[0] });
  } catch (e) {
    console.error('❌ update categoria', e);
    if (e.code === '23505') return res.status(409).json({ ok:false, error:'La categoría ya existe' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.delete('/:clubId/config/categorias/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    const r = await db.query(
      `UPDATE categorias_deportivas
       SET activo=false, updated_at=NOW()
       WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'No encontrada' });
    res.json({ ok:true });
  } catch (e) {
    console.error('❌ delete categoria', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

/* ============================================================
   TIPOS DE GASTO
   GET/POST/PUT/DELETE /club/:clubId/config/tipos-gasto
============================================================ */
router.get('/:clubId/config/tipos-gasto', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(
      `SELECT id, nombre
       FROM tipos_gasto
       WHERE club_id = $1 AND activo = true
       ORDER BY nombre ASC`,
      [clubId]
    );
    res.json({ ok:true, tipos: r.rows });
  } catch (e) {
    console.error('❌ get tipos-gasto', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.post('/:clubId/config/tipos-gasto', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { nombre } = req.body || {};
  try {
    if (!nombre?.trim()) return res.status(400).json({ ok:false, error:'Falta nombre' });

    const r = await db.query(
      `INSERT INTO tipos_gasto (id, club_id, nombre, activo, updated_at)
       VALUES (gen_random_uuid(), $1, $2, true, NOW())
       RETURNING id, nombre`,
      [clubId, nombre.trim()]
    );
    res.json({ ok:true, tipo: r.rows[0] });
  } catch (e) {
    console.error('❌ create tipo-gasto', e);
    if (e.code === '23505') return res.status(409).json({ ok:false, error:'El tipo ya existe' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.put('/:clubId/config/tipos-gasto/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { nombre } = req.body || {};
  try {
    if (!nombre?.trim()) return res.status(400).json({ ok:false, error:'Falta nombre' });

    const r = await db.query(
      `UPDATE tipos_gasto
       SET nombre=$1, updated_at=NOW()
       WHERE id=$2 AND club_id=$3
       RETURNING id, nombre`,
      [nombre.trim(), id, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'No encontrado' });
    res.json({ ok:true, tipo: r.rows[0] });
  } catch (e) {
    console.error('❌ update tipo-gasto', e);
    if (e.code === '23505') return res.status(409).json({ ok:false, error:'El tipo ya existe' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.delete('/:clubId/config/tipos-gasto/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    const r = await db.query(
      `UPDATE tipos_gasto
       SET activo=false, updated_at=NOW()
       WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'No encontrado' });
    res.json({ ok:true });
  } catch (e) {
    console.error('❌ delete tipo-gasto', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

/* ============================================================
   RESPONSABLES DEL GASTO
   GET/POST/PUT/DELETE /club/:clubId/config/responsables
============================================================ */
router.get('/:clubId/config/responsables', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(
      `SELECT id, nombre
       FROM responsables_gasto
       WHERE club_id = $1 AND activo = true
       ORDER BY nombre ASC`,
      [clubId]
    );
    res.json({ ok:true, responsables: r.rows });
  } catch (e) {
    console.error('❌ get responsables', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.post('/:clubId/config/responsables', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { nombre } = req.body || {};
  try {
    if (!nombre?.trim()) return res.status(400).json({ ok:false, error:'Falta nombre' });

    const r = await db.query(
      `INSERT INTO responsables_gasto (id, club_id, nombre, activo, updated_at)
       VALUES (gen_random_uuid(), $1, $2, true, NOW())
       RETURNING id, nombre`,
      [clubId, nombre.trim()]
    );
    res.json({ ok:true, responsable: r.rows[0] });
  } catch (e) {
    console.error('❌ create responsable', e);
    if (e.code === '23505') return res.status(409).json({ ok:false, error:'El responsable ya existe' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.put('/:clubId/config/responsables/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { nombre } = req.body || {};
  try {
    if (!nombre?.trim()) return res.status(400).json({ ok:false, error:'Falta nombre' });

    const r = await db.query(
      `UPDATE responsables_gasto
       SET nombre=$1, updated_at=NOW()
       WHERE id=$2 AND club_id=$3
       RETURNING id, nombre`,
      [nombre.trim(), id, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'No encontrado' });
    res.json({ ok:true, responsable: r.rows[0] });
  } catch (e) {
    console.error('❌ update responsable', e);
    if (e.code === '23505') return res.status(409).json({ ok:false, error:'El responsable ya existe' });
    res.status(500).json({ ok:false, error: e.message });
  }
});

router.delete('/:clubId/config/responsables/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    const r = await db.query(
      `UPDATE responsables_gasto
       SET activo=false, updated_at=NOW()
       WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'No encontrado' });
    res.json({ ok:true });
  } catch (e) {
    console.error('❌ delete responsable', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

module.exports = router;