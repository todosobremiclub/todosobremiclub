const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(r => String(r.club_id) === String(clubId) || r.role === 'superadmin');
  if (!allowed) return res.status(403).json({ ok:false, error:'No autorizado para este club' });
  next();
}

// GET /club/:clubId/pendientes
router.get('/:clubId/pendientes', requireAuth, requireClubAccess, async (req,res) => {
  try{
    const { clubId } = req.params;
    const r = await db.query(
      `SELECT id, nombre, apellido, dni, actividad, categoria, telefono, direccion,
              fecha_nacimiento, foto_url, estado, created_at
       FROM socios_pendientes
       WHERE club_id=$1 AND estado='pendiente'
       ORDER BY created_at DESC`,
      [clubId]
    );
    res.json({ ok:true, items: r.rows });
  }catch(e){
    console.error('❌ pendientes list', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// POST /club/:clubId/pendientes/:id/rechazar
router.post('/:clubId/pendientes/:id/rechazar', requireAuth, requireClubAccess, async (req,res) => {
  try{
    const { clubId, id } = req.params;
    const { motivo = null } = req.body ?? {};
    const r = await db.query(
      `UPDATE socios_pendientes
       SET estado='rechazado', motivo_rechazo=$1, updated_at=now()
       WHERE id=$2 AND club_id=$3 AND estado='pendiente'`,
      [motivo, id, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'No encontrado' });
    res.json({ ok:true });
  }catch(e){
    console.error('❌ rechazar', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// POST /club/:clubId/pendientes/:id/aceptar
router.post('/:clubId/pendientes/:id/aceptar', requireAuth, requireClubAccess, async (req,res) => {
  try{
    const { clubId, id } = req.params;

    // Traer pendiente
    const rP = await db.query(
      `SELECT * FROM socios_pendientes WHERE id=$1 AND club_id=$2 AND estado='pendiente' LIMIT 1`,
      [id, clubId]
    );
    if (!rP.rowCount) return res.status(404).json({ ok:false, error:'No encontrado' });
    const p = rP.rows[0];

    // Validar duplicado DNI contra socios
    const rDup = await db.query(
      `SELECT 1 FROM socios WHERE club_id=$1 AND dni=$2 LIMIT 1`,
      [clubId, p.dni]
    );
    if (rDup.rowCount) return res.status(409).json({ ok:false, error:'Ya existe un socio con ese DNI' });

    // Inicializar counter si no existe
    await db.query(
      `INSERT INTO club_counters (club_id, next_socio_num) VALUES ($1, 1)
       ON CONFLICT (club_id) DO NOTHING`,
      [clubId]
    );

    // Tomar siguiente número libre
    const rCounter = await db.query(
      `UPDATE club_counters
       SET next_socio_num = next_socio_num + 1
       WHERE club_id = $1
       RETURNING (next_socio_num - 1) AS numero`,
      [clubId]
    );
    const numero = Number(rCounter.rows[0].numero);

    // Insertar socio definitivo (incluye foto_url)
    const rIns = await db.query(
      `INSERT INTO socios (
        club_id, numero_socio, dni, nombre, apellido,
        telefono, direccion, fecha_nacimiento, fecha_ingreso,
        activo, becado, categoria, actividad, foto_url
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,$10,$11,$12
      ) RETURNING id`,
      [
        clubId,
        numero,
        p.dni,
        p.nombre,
        p.apellido,
        p.telefono,
        p.direccion,
        p.fecha_nacimiento,
        null,
        p.categoria,
        p.actividad,
        p.foto_url
      ]
    );

    // Marcar pendiente como aceptado
    await db.query(
      `UPDATE socios_pendientes
       SET estado='aceptado', updated_at=now()
       WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );

    res.json({ ok:true, socioId: rIns.rows[0].id, numero_socio: numero });
  }catch(e){
    console.error('❌ aceptar', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

module.exports = router;