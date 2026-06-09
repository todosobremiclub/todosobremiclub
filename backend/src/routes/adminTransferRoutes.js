const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ===== helper roles =====
function hasAnyRole(req, allowed) {
  const roles = req.user?.roles || [];
  const roleNames = roles.map(r => String(r.role || '').toLowerCase());
  return allowed.some(a => roleNames.includes(a));
}

function monthName(m) {
  const meses = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  return (m >= 1 && m <= 12) ? meses[m] : `Mes ${m}`;
}

/**
 * GET /admin/payments/transfer/pending
 * query opcional:
 * - club_id=UUID
 * - estado=iniciado|comprobante_subido|all   (default: all)
 * - limit (default 100, max 300)
 * - offset (default 0)
 */
router.get('/payments/transfer/pending', requireAuth, async (req, res) => {
  try {
    if (!hasAnyRole(req, ['admin', 'finanzas', 'superadmin'])) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    const clubId = req.query.club_id ? String(req.query.club_id) : null;
    const estado = (req.query.estado ? String(req.query.estado) : 'all').toLowerCase();

    const limitRaw = Number(req.query.limit ?? 100);
    const offsetRaw = Number(req.query.offset ?? 0);
    const limit = Math.max(1, Math.min(300, Number.isFinite(limitRaw) ? limitRaw : 100));
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

    // Estados a listar
    let estados = ['comprobante_subido', 'iniciado'];
    if (estado === 'iniciado') estados = ['iniciado'];
    if (estado === 'comprobante_subido') estados = ['comprobante_subido'];

    const params = [];
    let where = `WHERE t.estado = ANY($1)`;
    params.push(estados);

    if (clubId) {
      where += ` AND t.club_id = $2`;
      params.push(clubId);
    }

    const sql = `
      SELECT
        t.id,
        t.club_id,
        c.name AS club_nombre,
        t.socio_id,
        s.numero_socio,
        s.nombre,
        s.apellido,
        t.anio,
        t.mes,
        t.monto_esperado,
        t.referencia,
        t.estado,
        t.comprobante_url,
        t.comprobante_texto,
        t.created_at
      FROM transferencias_pago t
      JOIN clubs c ON c.id = t.club_id
      JOIN socios s ON s.id = t.socio_id AND s.club_id = t.club_id
      ${where}
      ORDER BY
        CASE WHEN t.estado = 'comprobante_subido' THEN 0 ELSE 1 END,
        t.created_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const r = await db.query(sql, params);

    const items = r.rows.map(x => ({
      id: x.id,
      club_id: x.club_id,
      club_nombre: x.club_nombre,
      socio_id: x.socio_id,
      socio_numero: x.numero_socio,
      socio_nombre: x.nombre,
      socio_apellido: x.apellido,
      anio: x.anio,
      mes: x.mes,
      mes_label: `${monthName(Number(x.mes))} ${x.anio}`,
      monto_esperado: Number(x.monto_esperado),
      referencia: x.referencia,
      estado: x.estado,
      comprobante_url: x.comprobante_url,
      comprobante_texto: x.comprobante_texto,
      created_at: x.created_at
    }));

    return res.json({ ok: true, items, limit, offset });
  } catch (err) {
    console.error('❌ /admin/payments/transfer/pending error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * POST /admin/payments/transfer/confirm
 * body: { club_id, socio_id, anio, mes, fecha_pago? }
 * Confirma una transferencia y crea el recibo real en pagos_mensuales
 */
router.post('/payments/transfer/confirm', requireAuth, async (req, res) => {
  try {
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

    // Idempotencia: si ya existe recibo, devolvemos ok
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

    // Buscar transferencia revisable
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
      return res.status(400).json({ ok: false, error: 'No hay transferencia iniciada/en revisión para confirmar' });
    }
    const trans = rTrans.rows[0];

    // Datos del socio (para columnas redundantes)
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

    await db.query('BEGIN');

    // Insertar recibo real (fecha_pago NOT NULL)
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

/**
 * POST /admin/payments/transfer/reject
 * body: { transferencia_id, motivo? }
 */
router.post('/payments/transfer/reject', requireAuth, async (req, res) => {
  try {
    if (!hasAnyRole(req, ['admin', 'finanzas', 'superadmin'])) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    const { transferencia_id, motivo } = req.body || {};
    if (!transferencia_id) {
      return res.status(400).json({ ok: false, error: 'transferencia_id es obligatorio' });
    }

    const motivoTxt = (motivo ? String(motivo).trim() : '');

    const r = await db.query(
      `UPDATE transferencias_pago
       SET
         estado='rechazado',
         comprobante_texto = CASE
           WHEN $2 = '' THEN comprobante_texto
           ELSE COALESCE(comprobante_texto,'') || E'\\n[RECHAZO] ' || $2
         END,
         updated_at=now()
       WHERE id=$1
         AND estado IN ('iniciado','comprobante_subido')
       RETURNING id`,
      [transferencia_id, motivoTxt]
    );

    if (!r.rowCount) {
      return res.status(400).json({ ok: false, error: 'No se pudo rechazar (no existe o ya fue procesada)' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ /admin/payments/transfer/reject error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
