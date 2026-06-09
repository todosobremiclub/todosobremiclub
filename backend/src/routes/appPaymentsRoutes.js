const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const crypto = require('crypto');

const router = express.Router();

// ======================================================
// Helper fetch con timeout (evita requests colgados)
// ======================================================
async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ======================================================
// CORS (necesario para Flutter Web / Chrome localhost)
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
  return crypto.createHmac('sha256', secret).update(String(clubId)).digest('hex');
}

function buildNotificationUrl(clubId) {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return null;
  const sig = signMpWebhook(clubId);
  if (!sig) return null;

  // ✅ IMPORTANTE: en backend es "&" (NO "&amp;")
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

  if (!club.mp_connected || !club.mp_access_token) {
    throw new Error('El club no tiene Mercado Pago conectado');
  }

  // Si no hay refresh_token, no podemos refrescar
  if (!club.mp_refresh_token) return club.mp_access_token;

  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return club.mp_access_token;

  const mpRes = await fetchWithTimeout(
    'https://api.mercadopago.com/oauth/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: club.mp_refresh_token,
      }),
    },
    15000
  );

  const mpText = await mpRes.text();
  let mpData;
  try { mpData = JSON.parse(mpText); } catch { mpData = { raw: mpText }; }

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

  if (!club.mp_connected || !club.mp_access_token) {
    throw new Error('El club no tiene Mercado Pago conectado');
  }

  if (!club.mp_expires_at) return club.mp_access_token;

  const exp = new Date(club.mp_expires_at);
  const msLeft = exp.getTime() - Date.now();

  // Si faltan menos de 48hs, refrescamos
  if (Number.isFinite(msLeft) && msLeft < 48 * 60 * 60 * 1000) {
    return await refreshClubMpToken(clubId);
  }

  return club.mp_access_token;
}

// Si el token JWT es de socio, solo puede pagar SU socioId/clubId
function assertSocioOrAdmin(req, clubId, socioId) {
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

// ======================================================
// Endpoint SIMPLE (si lo usás en algún lado)
// POST /app/payments/mercadopago/preference
// body: { club_id, concepto, monto }
// ======================================================
router.post('/payments/mercadopago/preference', requireAuth, async (req, res) => {
  try {
    const { club_id, concepto, monto } = req.body || {};

    if (!club_id || monto == null) {
      return res.status(400).json({ ok: false, error: 'club_id y monto son obligatorios' });
    }

    const rClub = await db.query(
      `SELECT name, mp_connected, mp_access_token
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
      [club_id]
    );

    if (!rClub.rowCount) return res.status(404).json({ ok: false, error: 'Club no encontrado' });

    const club = rClub.rows[0];
    if (!club.mp_connected || !club.mp_access_token) {
      return res.status(400).json({ ok: false, error: 'El club no tiene Mercado Pago conectado' });
    }

    const unitPrice = Number(monto);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ ok: false, error: 'monto inválido' });
    }

    const notification_url = buildNotificationUrl(club_id);
    if (!notification_url) {
      return res.status(500).json({
        ok: false,
        error: 'Falta PUBLIC_BASE_URL o MP_WEBHOOK_SECRET para armar notification_url'
      });
    }

    const mpRes = await fetchWithTimeout(
      'https://api.mercadopago.com/checkout/preferences',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${club.mp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              title: concepto || `Pago ${club.name}`,
              quantity: 1,
              currency_id: 'ARS',
              unit_price: unitPrice,
            },
          ],
          back_urls: {
            success: 'https://todosobremiclub.com.ar/pago-exitoso',
            failure: 'https://todosobremiclub.com.ar/pago-fallido',
            pending: 'https://todosobremiclub.com.ar/pago-pendiente',
          },
          auto_return: 'approved',
          external_reference: `app_${club_id}_${Date.now()}`,
          notification_url,
          metadata: { club_id: String(club_id) },
        }),
      },
      15000
    );

    const mpText = await mpRes.text();
    let mpData;
    try { mpData = JSON.parse(mpText); } catch { mpData = { raw: mpText }; }

    if (!mpRes.ok) {
      return res.status(400).json({ ok: false, error: 'Error creando preferencia', mp: mpData });
    }

    return res.json({
      ok: true,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
    });
  } catch (err) {
    console.error('❌ preference error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ======================================================
// Endpoint PRINCIPAL (el que usa la app)
// POST /app/payments/mercadopago/cuota-preference
// body: { club_id, socio_id, anio, meses:[1..12], es_parcial?, monto_parcial? }
// ======================================================
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
      `SELECT id, actividad, excepcion_cuota_id
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
      if (!Number.isFinite(m) || m < 0) {
        return res.status(400).json({ ok: false, error: 'monto_parcial inválido (>=0)' });
      }
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

    // Token del club (con refresh)
    const accessToken = await getClubMpAccessToken(club_id);

    const notification_url = buildNotificationUrl(club_id);
    if (!notification_url) {
      return res.status(500).json({
        ok: false,
        error: 'Falta PUBLIC_BASE_URL o MP_WEBHOOK_SECRET para armar notification_url'
      });
    }

    const external_reference = `cuota|${club_id}|${socio_id}|${anioNum}|${mesesNum.join(',')}`;

    console.log('🟦 [MP cuota] start', { club_id, socio_id, anio: anioNum, meses: mesesNum });

    let mpRes;
    try {
      mpRes = await fetchWithTimeout(
        'https://api.mercadopago.com/checkout/preferences',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [
              {
                title: `Cuota social ${anioNum} (${mesesNum.length} mes/es)`,
                quantity: 1,
                currency_id: 'ARS',
                unit_price: Number(total),
              },
            ],
            external_reference,
            notification_url,
            metadata: {
              club_id: String(club_id),
              socio_id: String(socio_id),
              anio: Number(anioNum),
              meses: mesesNum.join(','),
              monto_por_mes: Number(montoPorMes),
            },
            back_urls: {
              success: 'https://todosobremiclub.com.ar/pago-exitoso',
              failure: 'https://todosobremiclub.com.ar/pago-fallido',
              pending: 'https://todosobremiclub.com.ar/pago-pendiente',
            },
            auto_return: 'approved',
          }),
        },
        15000
      );
    } catch (e) {
      console.error('❌ [MP cuota] fetch error/timeout:', e);
      return res.status(504).json({ ok: false, error: 'Timeout o error de red llamando a Mercado Pago' });
    }

    const mpText = await mpRes.text();
    let mpData;
    try { mpData = JSON.parse(mpText); } catch { mpData = { raw: mpText }; }

    if (!mpRes.ok) {
      console.error('❌ [MP cuota] MP error:', mpData);
      return res.status(400).json({ ok: false, error: 'Error creando preferencia (cuota)', mp: mpData });
    }

    console.log('✅ [MP cuota] ok preference', { id: mpData.id });

    return res.json({
      ok: true,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
      total,
      monto_por_mes: montoPorMes,
      meses: mesesNum,
    });
  } catch (err) {
    console.error('❌ cuota-preference error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
