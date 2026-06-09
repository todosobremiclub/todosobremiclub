const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ===== helper roles =====
function hasAnyRole(req, allowed) {
  const roles = req.user?.roles || [];
  // roles viene como [{role, club_id, club_name}, ...] según /auth/login [2](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/authRoutes.js)
  const roleNames = roles.map(r => String(r.role || '').toLowerCase());
  return allowed.some(a => roleNames.includes(a));
}

// ======================================================
// POST /admin/payments/transfer/confirm
// body: { club_id, socio_id, anio, mes, fecha_pago? }
// Confirma una transferencia y crea el recibo real en pagos_mensuales
// ======================================================
router.post('/payments/transfer/confirm', requireAuth, async (req, res) => {
  try {
    // 1) Permisos (admin/finanzas/superadmin)
    if (!hasAnyRole(req, ['admin', 'finanzas', 'superadmin'])) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    const { club_id, socio_id, anio, mes, fecha_pago } = req.body || {};
    const anioNum = Number(anio);
    const mesNum = Number(mes);

    if (!club_id || !socio_id) {
      return res.status(400).json({ ok: false, error: 'club_id y socio_id son obligatorios' });
    }
    if (!Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      return res.status(400).json({ ok: false, error: 'Año inválido' });
    }
    if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
      return res.status(400).json({ ok: false, error: 'Mes inválido' });
    }

    const fechaPago = (typeof fecha_pago === 'string' && fecha_pago.length >= 10)
      ? fecha_pago.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // 2) Verificar que NO exista ya el recibo (idempotencia)
    const rYaPago = await db.query(
      `SELECT id
       FROM pagos_mensuales
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
       LIMIT 1`,
      [club_id, socio_id, anioNum, mesNum]
    );

    if (rYaPago.rowCount) {
      return res.status(200).json({ ok: true, ya_existia: true, pago_mensual_id: rYaPago.rows[0].id });
    }

    // 3) Buscar transferencia en estado revisable (iniciado o comprobante_subido)
    const rTrans = await db.query(
      `SELECT id, referencia, monto_esperado, estado
       FROM transferencias_pago
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
         AND estado IN ('iniciado', 'comprobante_subido')
       ORDER BY created_at DESC
       LIMIT 1`,
      [club_id, socio_id, anioNum, mesNum]
    );

    if (!rTrans.rowCount) {
      return res.status(400).json({
        ok: false,
        error: 'No hay transferencia iniciada/en revisión para confirmar'
      });
    }

    const trans = rTrans.rows[0];

    // 4) Datos del socio para completar columnas redundantes (como hoy tu tabla las tiene)
    const rSoc = await db.query(
      `SELECT nombre, apellido, numero_socio
       FROM socios
       WHERE id=$1 AND club_id=$2
       LIMIT 1`,
      [socio_id, club_id]
    );

    if (!rSoc.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }

    const socio = rSoc.rows[0];

    // 5) Transacción DB: crear recibo + actualizar estados
    await db.query('BEGIN');

    // 5.1) Insertar recibo real en pagos_mensuales (fecha_pago NO NULL)
    const rInsPago = await db.query(
      `INSERT INTO pagos_mensuales
       (club_id, socio_id, anio, mes, monto, fecha_pago, cuenta,
        socio_nombre, socio_apellido, socio_numero,
        estado_pago, metodo_pago, referencia_transferencia, confirmado_at)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,
        $11,$12,$13,$14)
       RETURNING id`,
      [
        club_id,
        socio_id,
        anioNum,
        mesNum,
        Number(trans.monto_esperado),
        fechaPago,
        'Transferencia',
        socio.nombre ?? null,
        socio.apellido ?? null,
        socio.numero_socio ?? null,
        'confirmado',
        'transferencia',
        trans.referencia,
        new Date()
      ]
    );

    const pagoMensualId = rInsPago.rows[0].id;

    // 5.2) Actualizar transferencia
    await db.query(
      `UPDATE transferencias_pago
       SET estado='confirmado',
           pago_mensual_id=$2,
           updated_at=now()
       WHERE id=$1`,
      [trans.id, pagoMensualId]
    );

    await db.query('COMMIT');

    return res.json({
      ok: true,
      pago_mensual_id: pagoMensualId,
      transferencia_id: trans.id,
      referencia: trans.referencia
    });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ /admin/payments/transfer/confirm error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
