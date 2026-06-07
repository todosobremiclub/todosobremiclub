const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ======================================================
// Helpers Mercado Pago (token + webhook signature)
// ======================================================
function getMpSecret() {
  return (
    process.env.MP_WEBHOOK_SECRET ||
    process.env.MP_OAUTH_STATE_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SECRET ||
    ''
  );
}

function signMpWebhook(clubId) {
  const secret = getMpSecret();
  if (!secret) return null;
  const crypto = require('crypto');
  return crypto.createHmac('sha256', secret).update(String(clubId)).digest('hex');
}

function buildNotificationUrl(clubId) {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return null;
  const sig = signMpWebhook(clubId);
  if (!sig) return null;
  return `${base}/mp/webhook?clubId=${encodeURIComponent(clubId)}&sig=${encodeURIComponent(sig)}`;
}

async function refreshClubMpToken(clubId) {
  const r = await db.query(
    `SELECT id, mp_connected, mp_access_token, mp_refresh_token, mp_expires_at
     FROM clubs
     WHERE id = $1
     LIMIT 1`,
    [clubId]
  );
  if (!r.rowCount) throw new Error('Club no encontrado');
  const club = r.rows[0];
  if (!club.mp_connected || !club.mp_access_token) throw new Error('El club no tiene Mercado Pago conectado');
  if (!club.mp_refresh_token) return club.mp_access_token;

  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return club.mp_access_token;

  const mpRes = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: club.mp_refresh_token
    })
  });

  const mpData = await mpRes.json().catch(() => null);
  if (!mpRes.ok || !mpData?.access_token) {
    console.error('❌ MP refresh_token error:', mpData);
    return club.mp_access_token;
  }

  const expiresAt = mpData.expires_in
    ? new Date(Date.now() + Number(mpData.expires_in) * 1000)
    : null;

  await db.query(
    `UPDATE clubs
     SET
       mp_connected = true,
       mp_access_token = $2,
       mp_refresh_token = $3,
       mp_expires_at = $4
     WHERE id = $1`,
    [clubId, mpData.access_token, mpData.refresh_token || club.mp_refresh_token, expiresAt]
  );

  return mpData.access_token;
}

async function getClubMpAccessToken(clubId) {
  const r = await db.query(
    `SELECT id, mp_connected, mp_access_token, mp_expires_at
     FROM clubs
     WHERE id = $1
     LIMIT 1`,
    [clubId]
  );
  if (!r.rowCount) throw new Error('Club no encontrado');
  const club = r.rows[0];
  if (!club.mp_connected || !club.mp_access_token) throw new Error('El club no tiene Mercado Pago conectado');

  if (!club.mp_expires_at) return club.mp_access_token;

  const exp = new Date(club.mp_expires_at);
  const msLeft = exp.getTime() - Date.now();
  if (Number.isFinite(msLeft) && msLeft < 48 * 60 * 60 * 1000) {
    return await refreshClubMpToken(clubId);
  }
  return club.mp_access_token;
}

function assertSocioOrAdmin(req, clubId, socioId) {
  // Si el token es de socio (app), debe coincidir con socioId + clubId
  if (req.user?.socioId) {
    if (String(req.user.socioId) !== String(socioId)) {
      const err = new Error('No autorizado: socioId no coincide');
      err.status = 403;
      throw err;
    }
    if (req.user.clubId && String(req.user.clubId) !== String(clubId)) {
      const err = new Error('No autorizado: clubId no coincide');
      err.status = 403;
      throw err;
    }
  }
}

/**
 * Crear preferencia de Mercado Pago (Checkout Pro)
 * POST /app/payments/mercadopago/preference
 */
router.post('/payments/mercadopago/preference', requireAuth, async (req, res) => {
  try {
    const { club_id, concepto, monto } = req.body || {};

    if (!club_id || monto == null) {
      return res.status(400).json({
        ok: false,
        error: 'club_id y monto son obligatorios'
      });
    }

    // 1) Obtener token del club
    const rClub = await db.query(
      `SELECT name, mp_connected, mp_access_token
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
      [club_id]
    );

    if (!rClub.rowCount) {
      return res.status(404).json({ ok: false, error: 'Club no encontrado' });
    }

    const club = rClub.rows[0];

    if (!club.mp_connected || !club.mp_access_token) {
      return res.status(400).json({
        ok: false,
        error: 'El club no tiene Mercado Pago conectado'
      });
    }

    const unitPrice = Number(monto);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ ok: false, error: 'monto inválido' });
    }

    // 2) Crear preferencia en Mercado Pago (con token del CLUB)
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${club.mp_access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [
          {
            title: concepto || `Pago ${club.name}`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: unitPrice
          }
        ],
        back_urls: {
          success: 'https://todosobremiclub.com.ar/pago-exitoso',
          failure: 'https://todosobremiclub.com.ar/pago-fallido',
          pending: 'https://todosobremiclub.com.ar/pago-pendiente'
        },
        auto_return: 'approved',
external_reference: `app_${club_id}_${Date.now()}`,
notification_url: buildNotificationUrl(club_id),
metadata: { club_id: String(club_id) }
      })
    });

    const mpData = await mpRes.json().catch(() => null);

    if (!mpRes.ok) {
      return res.status(400).json({
        ok: false,
        error: 'Error creando preferencia de Mercado Pago',
        mp: mpData
      });
    }

    return res.json({
      ok: true,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point
    });
  } catch (err) {
    console.error('❌ create preference error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * Crear preferencia para pagar CUOTA (mensualidades)
 * POST /app/payments/mercadopago/cuota-preference
 * body: { club_id, socio_id, anio, meses:[1..12], es_parcial?, monto_parcial? }
 */
router.post('/payments/mercadopago/cuota-preference', requireAuth, async (req, res) => {
  try {
    const { club_id, socio_id, anio, meses, es_parcial = false, monto_parcial = null } = req.body || {};

    if (!club_id || !socio_id || !anio || !Array.isArray(meses) || meses.length === 0) {
      return res.status(400).json({ ok: false, error: 'club_id, socio_id, anio y meses son obligatorios' });
    }

    // Seguridad: si es socio (app) solo puede pagar SU cuota
    try { assertSocioOrAdmin(req, club_id, socio_id); }
    catch (e) { return res.status(e.status || 403).json({ ok: false, error: e.message || 'No autorizado' }); }

    const anioNum = Number(anio);
    const mesesNum = meses.map(Number).filter(m => m >= 1 && m <= 12);
    if (!Number.isFinite(anioNum) || mesesNum.length === 0) {
      return res.status(400).json({ ok: false, error: 'anio o meses inválidos' });
    }

    // Traer socio
    const rSoc = await db.query(
      `SELECT id, nombre, apellido, numero_socio, actividad, excepcion_cuota_id
       FROM socios
       WHERE id=$1 AND club_id=$2
       LIMIT 1`,
      [socio_id, club_id]
    );
    if (!rSoc.rowCount) return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    const socio = rSoc.rows[0];

    // Calcular monto por mes
    const esParcialBool = (es_parcial === true || es_parcial === 'true');
    let montoPorMes = 0;

    if (esParcialBool) {
      const m = Number(monto_parcial);
      if (!Number.isFinite(m) || m < 0) return res.status(400).json({ ok: false, error: 'monto_parcial inválido (>=0)' });
      montoPorMes = m;
    } else {
      if (socio.excepcion_cuota_id) {
        const rExc = await db.query(
          `SELECT monto FROM excepciones_cuota
           WHERE club_id=$1 AND id=$2 AND activo=true
           LIMIT 1`,
          [club_id, socio.excepcion_cuota_id]
        );
        montoPorMes = rExc.rowCount ? (Number(rExc.rows[0].monto) || 0) : 0;
      } else {
        const act = String(socio.actividad || '').trim();
        const rAct = await db.query(
          `SELECT precio_mensual FROM actividades
           WHERE club_id=$1 AND nombre=$2 AND activo=true
           LIMIT 1`,
          [club_id, act]
        );
        montoPorMes = rAct.rowCount ? (Number(rAct.rows[0].precio_mensual) || 0) : 0;
      }
      if (!Number.isFinite(montoPorMes) || montoPorMes <= 0) {
        return res.status(400).json({ ok: false, error: 'No se pudo determinar el monto mensual (actividad/excepción)' });
      }
    }

    const total = montoPorMes * mesesNum.length;

    // Token del club
    const accessToken = await getClubMpAccessToken(club_id);

    // Preferencia
    const notification_url = buildNotificationUrl(club_id);
    const external_reference = `cuota|${club_id}|${socio_id}|${anioNum}|${mesesNum.join(',')}`;

   const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    items: [
      {
        title: `Cuota social ${anioNum} (${mesesNum.length} mes/es)`,
        quantity: 1,
        currency_id: 'ARS',
        unit_price: Number(total)
      }
    ],
    external_reference,
    notification_url,
    metadata: {
      club_id: String(club_id),
      socio_id: String(socio_id),
      anio: Number(anioNum),
      meses: mesesNum.join(','),
      monto_por_mes: Number(montoPorMes)
    },
    back_urls: {
      success: 'https://todosobremiclub.com.ar/pago-exitoso',
      failure: 'https://todosobremiclub.com.ar/pago-fallido',
      pending: 'https://todosobremiclub.com.ar/pago-pendiente'
    },
    auto_return: 'approved'
  })
});
  } catch (err) {
    console.error('❌ cuota-preference error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});


module.exports = router;
