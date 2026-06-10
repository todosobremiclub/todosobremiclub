const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ======================================================
// CORS (para Flutter Web localhost) — opcional si ya está global
// ======================================================
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ======================================================
// Helpers
// ======================================================
function getSocioId(req) {
  return req.user?.socioId || req.user?.socio_id || req.user?.socioID || null;
}
function getClubId(req) {
  return req.user?.clubId || req.user?.club_id || req.user?.clubID || null;
}
function pad2(n) {
  return String(n).padStart(2, '0');
}

// ======================================================
// POST /app/payments/transfer/start
// body: { anio, mes }
// ======================================================
router.post('/payments/transfer/start', requireAuth, async (req, res) => {
  try {
    const clubId = getClubId(req);
    const socioId = getSocioId(req);

    if (!clubId || !socioId) {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido para la app (faltan clubId/socioId en el JWT)'
      });
    }

    const { anio, mes } = req.body || {};
    const anioNum = Number(anio);
    const mesNum = Number(mes);

    if (!Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      return res.status(400).json({ ok: false, error: 'Año inválido' });
    }
    if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
      return res.status(400).json({ ok: false, error: 'Mes inválido' });
    }

    // 1) Si ya existe pago confirmado en pagos_mensuales, no dejamos iniciar transferencia
    const rYaPago = await db.query(
      `SELECT id
       FROM pagos_mensuales
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
       LIMIT 1`,
      [clubId, socioId, anioNum, mesNum]
    );
    if (rYaPago.rowCount) {
      return res.status(400).json({ ok: false, error: 'Ese mes ya figura como pagado' });
    }

// 1.b) Si ya existe intento activo para ese período, no crear otro
const rActivo = await db.query(
  `SELECT id, estado
   FROM transferencias_pago
   WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
     AND estado IN ('iniciado','comprobante_subido')
   ORDER BY created_at DESC
   LIMIT 1`,
  [clubId, socioId, anioNum, mesNum]
);

if (rActivo.rowCount) {
  const activo = rActivo.rows[0];

  // Si ya subió comprobante → ya está en revisión, no permitir otro start
  if (activo.estado === 'comprobante_subido') {
    return res.json({
      ok: true,
      transferenciaId: activo.id,
      estado: 'en_revision',
      reuse: true
    });
  }

  // Si está iniciado → reutilizar el mismo intento
  return res.json({
    ok: true,
    transferenciaId: activo.id,
    estado: 'iniciado',
    reuse: true
  });
}


    // 2) Obtener numero_socio + actividad/excepción para calcular monto
    const rSoc = await db.query(
      `SELECT id, numero_socio, actividad, excepcion_cuota_id
       FROM socios
       WHERE id=$1 AND club_id=$2
       LIMIT 1`,
      [socioId, clubId]
    );
    if (!rSoc.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }
    const socio = rSoc.rows[0];

    const numeroSocio = socio.numero_socio;
    if (!numeroSocio) {
      return res.status(400).json({ ok: false, error: 'El socio no tiene numero_socio' });
    }

    // 3) Calcular monto mensual (misma lógica que usábamos para la cuota)
    let montoPorMes = 0;

    if (socio.excepcion_cuota_id) {
      const rExc = await db.query(
        `SELECT monto
         FROM excepciones_cuota
         WHERE club_id=$1 AND id=$2 AND activo=true
         LIMIT 1`,
        [clubId, socio.excepcion_cuota_id]
      );
      montoPorMes = rExc.rowCount ? (Number(rExc.rows[0].monto) || 0) : 0;
    } else {
      const act = String(socio.actividad || '').trim();
      if (act) {
        const rAct = await db.query(
          `SELECT precio_mensual
           FROM actividades
           WHERE club_id=$1 AND nombre=$2 AND activo=true
           LIMIT 1`,
          [clubId, act]
        );
        montoPorMes = rAct.rowCount ? (Number(rAct.rows[0].precio_mensual) || 0) : 0;
      }
    }

    // Fallback: si no hay actividad/excepción, usamos valor mensual del club (si existe)
    if (!Number.isFinite(montoPorMes) || montoPorMes <= 0) {
      const rClub = await db.query(
        `SELECT valor_mensual
         FROM clubs
         WHERE id=$1
         LIMIT 1`,
        [clubId]
      );
      montoPorMes = rClub.rowCount ? (Number(rClub.rows[0].valor_mensual) || 0) : 0;
    }

    if (!Number.isFinite(montoPorMes) || montoPorMes <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'No se pudo determinar el monto mensual (actividad/excepción/valor_mensual)'
      });
    }

    // 4) Generar referencia base: TSMC-<numero_socio>-<YYYYMM>
const referenciaBase = `TSMC-${numeroSocio}-${anioNum}${pad2(mesNum)}`;

// 4.b) Asegurar unicidad de referencia (porque existe UNIQUE idx_transferencias_referencia)
const rRef = await db.query(
  `SELECT 1
   FROM transferencias_pago
   WHERE referencia = $1
   LIMIT 1`,
  [referenciaBase]
);

const referencia = rRef.rowCount
  ? `${referenciaBase}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  : referenciaBase;

    
    // 6) Crear intento
    const rIns = await db.query(
      `INSERT INTO transferencias_pago
       (club_id, socio_id, anio, mes, referencia, monto_esperado, estado)
       VALUES ($1,$2,$3,$4,$5,$6,'iniciado')
       RETURNING id, referencia, monto_esperado, estado`,
      [clubId, socioId, anioNum, mesNum, referencia, montoPorMes]
    );

    const nuevo = rIns.rows[0];

    return res.json({
      ok: true,
      referencia: nuevo.referencia,
      monto: Number(nuevo.monto_esperado),
      estado: 'transferencia_iniciada',
      ya_existia: false
    });
  } catch (err) {
    console.error('❌ /payments/transfer/start error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ======================================================
// POST /app/payments/transfer/proof
// body: { anio, mes, comprobante_url?, comprobante_texto? }
// ======================================================
router.post('/payments/transfer/proof', requireAuth, async (req, res) => {
  try {
    const clubId = getClubId(req);
    const socioId = getSocioId(req);

    if (!clubId || !socioId) {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido para la app (faltan clubId/socioId)'
      });
    }

    const { anio, mes, comprobante_url, comprobante_texto } = req.body || {};
    const anioNum = Number(anio);
    const mesNum = Number(mes);

    if (!Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      return res.status(400).json({ ok: false, error: 'Año inválido' });
    }
    if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
      return res.status(400).json({ ok: false, error: 'Mes inválido' });
    }

    if (!comprobante_url && !comprobante_texto) {
      return res.status(400).json({
        ok: false,
        error: 'Debe adjuntar un comprobante o un texto'
      });
    }

    // 1) Verificar que no esté ya pagado
    const rYaPago = await db.query(
      `SELECT id
       FROM pagos_mensuales
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
       LIMIT 1`,
      [clubId, socioId, anioNum, mesNum]
    );
    if (rYaPago.rowCount) {
      return res.status(400).json({
        ok: false,
        error: 'Ese mes ya figura como pagado'
      });
    }

    /// 2) Buscar intento activo (iniciado o ya con comprobante)
const rIntento = await db.query(
  `SELECT id, estado
   FROM transferencias_pago
   WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
     AND estado IN ('iniciado','comprobante_subido')
   ORDER BY created_at DESC
   LIMIT 1`,
  [clubId, socioId, anioNum, mesNum]
);

    if (!rIntento.rowCount) {
      return res.status(400).json({
        ok: false,
        error: 'No hay una transferencia iniciada para ese período'
      });
    }

    const intentoId = rIntento.rows[0].id;

// Si ya estaba con comprobante, devolvemos OK (idempotente)
if (rIntento.rows[0].estado === 'comprobante_subido') {
  return res.json({ ok: true, estado: 'en_revision', transferenciaId: intentoId });
}

    // 3) Actualizar intento con comprobante
    await db.query(
      `UPDATE transferencias_pago
       SET
         comprobante_url = COALESCE($1, comprobante_url),
         comprobante_texto = COALESCE($2, comprobante_texto),
         estado = 'comprobante_subido',
         updated_at = now()
       WHERE id = $3`,
      [comprobante_url || null, comprobante_texto || null, intentoId]
    );

    return res.json({
      ok: true,
      estado: 'en_revision'
    });
  } catch (err) {
    console.error('❌ /payments/transfer/proof error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ======================================================
// GET /app/club/transferencia-config
// Devuelve CVU / Alias / Titular del club para la app
// ======================================================
router.get('/club/transferencia-config', requireAuth, async (req, res) => {
  try {
    const clubId = getClubId(req);

    if (!clubId) {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido para la app (no se pudo determinar clubId)'
      });
    }

    const r = await db.query(
      `SELECT transferencia_cvu, transferencia_alias, transferencia_titular
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
      [clubId]
    );

    if (!r.rowCount) {
      return res.status(404).json({
        ok: false,
        error: 'Club no encontrado'
      });
    }

    return res.json({
  ok: true,

  // claves que usa Flutter
  cvu: r.rows[0].transferencia_cvu,
  alias: r.rows[0].transferencia_alias,
  titular: r.rows[0].transferencia_titular,

  // claves antiguas (compatibilidad)
  transferencia_cvu: r.rows[0].transferencia_cvu,
  transferencia_alias: r.rows[0].transferencia_alias,
  transferencia_titular: r.rows[0].transferencia_titular
});
  } catch (err) {
    console.error('❌ /app/club/transferencia-config error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});


module.exports = router;
