const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

/**
 * Acceso a club: mismo patrón que pendientesRoutes.js
 * - permite si el token trae roles con club_id = clubId o role=superadmin
 */
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
    (r) => String(r.club_id) === String(clubId) || String(r.role) === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  next();
}

/**
 * Permisos de finanzas:
 * - admin y finanzas del club pueden confirmar/rechazar
 * - superadmin lo dejamos permitido (si querés, lo hacemos solo lectura)
 */
function requireFinanceRole(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];

  const ok = roles.some(r => {
    const sameClub = String(r.club_id) === String(clubId);
    const role = String(r.role || '').toLowerCase();
    return (sameClub && (role === 'admin' || role === 'finanzas')) || role === 'superadmin';
  });

  if (!ok) return res.status(403).json({ ok: false, error: 'No autorizado (finanzas)' });
  next();
}

/**
 * GET /club/:clubId/payments/transfer/pending
 * Lista transferencias iniciadas / con comprobante del club
 */
router.get('/:clubId/payments/transfer/pending', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const estado = String(req.query.estado ?? 'all').toLowerCase(); // all | iniciado | comprobante_subido

    let estados = ['iniciado', 'comprobante_subido'];
    if (estado === 'iniciado') estados = ['iniciado'];
    if (estado === 'comprobante_subido') estados = ['comprobante_subido'];

    const r = await db.query(
      `
      SELECT
        t.id,
        t.club_id,
        t.socio_id,
        s.numero_socio,
        s.nombre,
        s.apellido,
        t.anio,
        t.mes,
        t.referencia,
        t.monto_esperado,
        t.estado,
        t.comprobante_url,
        t.comprobante_texto,
        t.created_at
      FROM transferencias_pago t
      JOIN socios s ON s.id = t.socio_id AND s.club_id = t.club_id
      WHERE t.club_id = $1
        AND t.estado = ANY($2)
      ORDER BY
        CASE WHEN t.estado = 'comprobante_subido' THEN 0 ELSE 1 END,
        t.created_at ASC
      `,
      [clubId, estados]
    );

    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error('❌ transfer pending list', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /club/:clubId/payments/transfer/:transferId/confirm
 * Confirma transferencia y CREA recibo en pagos_mensuales (fecha_pago es NOT NULL)
 */
router.post('/:clubId/payments/transfer/:transferId/confirm', requireAuth, requireClubAccess, requireFinanceRole, async (req, res) => {
  const { clubId, transferId } = req.params;
  try {
    // fecha_pago opcional
    const fechaPago = (typeof req.body?.fecha_pago === 'string' && req.body.fecha_pago.length >= 10)
      ? req.body.fecha_pago.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    await db.query('BEGIN');

    // 1) Traer transferencia (lock)
    const rT = await db.query(
      `
      SELECT *
      FROM transferencias_pago
      WHERE id=$1 AND club_id=$2 AND estado IN ('iniciado','comprobante_subido')
      LIMIT 1
      FOR UPDATE
      `,
      [transferId, clubId]
    );

    if (!rT.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Transferencia no encontrada o ya procesada' });
    }

    const t = rT.rows[0];

    // 2) Si ya existe recibo, idempotencia
    const rYa = await db.query(
      `SELECT id FROM pagos_mensuales WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4 LIMIT 1`,
      [clubId, t.socio_id, t.anio, t.mes]
    );
    if (rYa.rowCount) {
      // marcamos transferencia confirmada igual y linkeamos
      await db.query(
        `UPDATE transferencias_pago SET estado='confirmado', pago_mensual_id=$2, updated_at=now() WHERE id=$1`,
        [t.id, rYa.rows[0].id]
      );

// 6) Cerrar otros intentos activos del mismo período (seguridad)
await db.query(
  `UPDATE transferencias_pago
   SET estado='cancelado', updated_at=now()
   WHERE club_id = $1
     AND socio_id = $2
     AND anio = $3
     AND mes = $4
     AND id <> $5
     AND estado IN ('iniciado','comprobante_subido')`,
  [clubId, t.socio_id, t.anio, t.mes, t.id]
);

      await db.query('COMMIT');
      return res.json({ ok: true, ya_existia: true, pago_mensual_id: rYa.rows[0].id });
    }

    // 3) Datos del socio para columnas redundantes en pagos_mensuales
    const rSoc = await db.query(
      `SELECT nombre, apellido, numero_socio FROM socios WHERE id=$1 AND club_id=$2 LIMIT 1`,
      [t.socio_id, clubId]
    );
    if (!rSoc.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }
    const s = rSoc.rows[0];

    // 4) Insertar recibo real
    const rIns = await db.query(
      `
      INSERT INTO pagos_mensuales
      (club_id, socio_id, anio, mes, monto, fecha_pago, cuenta,
       socio_nombre, socio_apellido, socio_numero,
       estado_pago, metodo_pago, referencia_transferencia, confirmado_at)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,
       $11,$12,$13,$14)
      RETURNING id
      `,
      [
        clubId,
        t.socio_id,
        t.anio,
        t.mes,
        Number(t.monto_esperado),
        fechaPago,
        'Transferencia',
        s.nombre ?? null,
        s.apellido ?? null,
        s.numero_socio ?? null,
        'confirmado',
        'transferencia',
        t.referencia,
        new Date()
      ]
    );

    const pagoMensualId = rIns.rows[0].id;

    // 5) Marcar transferencia confirmada y linkear al recibo
    await db.query(
      `UPDATE transferencias_pago SET estado='confirmado', pago_mensual_id=$2, updated_at=now() WHERE id=$1`,
      [t.id, pagoMensualId]
    );

    await db.query('COMMIT');
    return res.json({ ok: true, pago_mensual_id: pagoMensualId, referencia: t.referencia });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('❌ transfer confirm', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});


/**
 * POST /club/:clubId/payments/transfer/:transferId/reject
 * Rechaza transferencia (no crea recibo)
 */
router.post('/:clubId/payments/transfer/:transferId/reject', requireAuth, requireClubAccess, requireFinanceRole, async (req, res) => {
  try {
    const { clubId, transferId } = req.params;
    const motivo = String(req.body?.motivo ?? '').trim();

    const r = await db.query(
      `
      UPDATE transferencias_pago
      SET
        estado='rechazado',
        comprobante_texto = CASE
          WHEN $2 = '' THEN comprobante_texto
          ELSE COALESCE(comprobante_texto,'') || E'\\n[RECHAZO] ' || $2
        END,
        updated_at=now()
      WHERE id=$1 AND club_id=$3 AND estado IN ('iniciado','comprobante_subido')
      RETURNING id
      `,
      [transferId, motivo, clubId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Transferencia no encontrada o ya procesada' });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ transfer reject', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PATCH /club/:clubId/config/transferencia
 * Guarda CVU/ALIAS/TITULAR del club (para que el socio vea dónde transferir)
 */
router.patch('/:clubId/config/transferencia', requireAuth, requireClubAccess, requireFinanceRole, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { transferencia_cvu, transferencia_alias, transferencia_titular } = req.body || {};

    // Validación mínima
    const cvu = transferencia_cvu ? String(transferencia_cvu).trim() : null;
    const alias = transferencia_alias ? String(transferencia_alias).trim() : null;
    const titular = transferencia_titular ? String(transferencia_titular).trim() : null;

    // CVU típico: 22 dígitos (no lo fuerzo al 100% por flexibilidad)
    if (cvu && cvu.length < 10) {
      return res.status(400).json({ ok: false, error: 'CVU inválido' });
    }

    await db.query(
      `
      UPDATE clubs
      SET
        transferencia_cvu = $2,
        transferencia_alias = $3,
        transferencia_titular = $4
      WHERE id = $1
      `,
      [clubId, cvu, alias, titular]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ club transferencia config', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
