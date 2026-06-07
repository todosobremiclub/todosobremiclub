const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

/* ======================================================
   Helpers para OAuth state (seguridad)
====================================================== */

function getStateSecret() {
  return (
    process.env.MP_OAUTH_STATE_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SECRET ||
    ''
  );
}

function signState(raw) {
  const secret = getStateSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function buildOAuthState(clubId) {
  const ts = Math.floor(Date.now() / 1000);
  const raw = `${clubId}.${ts}`;
  const sig = signState(raw);
  if (!sig) return clubId; // fallback legacy
  return `${clubId}.${ts}.${sig}`;
}

function parseOAuthState(state) {
  const s = String(state || '').trim();
  if (!s) return { ok: false, error: 'state vacío' };

  const parts = s.split('.');
  if (parts.length === 1) {
    // legacy: state = clubId
    return { ok: true, clubId: parts[0], legacy: true };
  }

  if (parts.length < 3) {
    return { ok: false, error: 'state inválido' };
  }

  const clubId = parts[0];
  const ts = Number(parts[1]);
  const sig = parts.slice(2).join('.');

  if (!Number.isFinite(ts)) {
    return { ok: false, error: 'timestamp inválido en state' };
  }

  const raw = `${clubId}.${ts}`;
  const expected = signState(raw);

  if (!expected || expected !== sig) {
    return { ok: false, error: 'firma de state inválida' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 15 * 60) {
    return { ok: false, error: 'state expirado' };
  }

  return { ok: true, clubId, legacy: false };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* ======================================================
   Helpers Webhook + Refresh Token (MP)
====================================================== */
function getMpWebhookSecret() {
  return (
    process.env.MP_WEBHOOK_SECRET ||
    process.env.MP_OAUTH_STATE_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SECRET ||
    ''
  );
}

function signMpWebhook(clubId) {
  const secret = getMpWebhookSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(String(clubId)).digest('hex');
}

function verifyMpWebhook(clubId, sig) {
  const expected = signMpWebhook(clubId);
  if (!expected || !sig) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(sig));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
  if (!club.mp_connected) throw new Error('Club sin Mercado Pago conectado');
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
    return club.mp_access_token; // fallback
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


/* ======================================================
   PASO 2 – Iniciar OAuth
   GET /mp/oauth/connect/:clubId
====================================================== */

router.get(
  '/oauth/connect/:clubId',
  requireAuth,
  requireRole('superadmin'),
  async (req, res) => {


    try {
      const { clubId } = req.params;

      // 1. Validar club
      const r = await db.query(
        `SELECT id, name, mp_connected FROM clubs WHERE id = $1 LIMIT 1`,
        [clubId]
      );

      if (!r.rowCount) {
        return res.status(404).json({
          ok: false,
          error: 'Club no encontrado'
        });
      }

      if (r.rows[0].mp_connected) {
        return res.status(400).json({
          ok: false,
          error: 'El club ya tiene Mercado Pago conectado'
        });
      }

      // 2. Configuración OAuth
      const clientId = process.env.MP_CLIENT_ID;
      const redirectUri = `${process.env.PUBLIC_BASE_URL}/mp/oauth/callback`;

      if (!clientId || !process.env.MP_CLIENT_SECRET) {
        return res.status(500).json({
          ok: false,
          error: 'Configuración de Mercado Pago incompleta'
        });
      }

      const state = buildOAuthState(clubId);

      const oauthUrl =
        'https://auth.mercadopago.com.ar/authorization' +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(state)}` +
`&scope=${encodeURIComponent('offline_access')}`;



      // 3) Si el frontend lo pide en JSON, devolvemos la URL (para luego redirigir con window.location.href)
if (req.query && String(req.query.json || '') === '1') {
  return res.json({ ok: true, oauthUrl });
}

// 4) Comportamiento normal: redirigir
return res.redirect(oauthUrl);
    } catch (err) {
      console.error('❌ MP OAuth connect:', err);
      return res.status(500).json({
        ok: false,
        error: 'Error iniciando conexión con Mercado Pago'
      });
    }
  }
);

/* ======================================================
   PASO 3 – Callback OAuth
   GET /mp/oauth/callback
====================================================== */

router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.status(400).send(`
        <h2>❌ No se pudo conectar Mercado Pago</h2>
        <p>${escapeHtml(error_description || error)}</p>
        <a href="/superadmin.html">Volver</a>
      `);
    }

    if (!code) {
      return res.status(400).send(`
        <h2>❌ Falta parámetro code</h2>
        <a href="/superadmin.html">Volver</a>
      `);
    }

    const parsed = parseOAuthState(state);
    if (!parsed.ok) {
      return res.status(400).send(`
        <h2>❌ State inválido</h2>
        <p>${escapeHtml(parsed.error)}</p>
        <a href="/superadmin.html">Volver</a>
      `);
    }

    const clubId = parsed.clubId;

    // Verificar club
    const rClub = await db.query(
      `SELECT id, name FROM clubs WHERE id = $1 LIMIT 1`,
      [clubId]
    );

    if (!rClub.rowCount) {
      return res.status(404).send(`
        <h2>❌ Club no encontrado</h2>
        <a href="/superadmin.html">Volver</a>
      `);
    }

    const clientId = process.env.MP_CLIENT_ID;
    const clientSecret = process.env.MP_CLIENT_SECRET;
    const redirectUri = `${process.env.PUBLIC_BASE_URL}/mp/oauth/callback`;

    // Intercambio code → token
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('code', code);
    body.set('redirect_uri', redirectUri);

    const mpRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      body
    });

    const mpText = await mpRes.text();
    let mpData;
    try {
      mpData = JSON.parse(mpText);
    } catch {
      mpData = { raw: mpText };
    }

    if (!mpRes.ok) {
      console.error('❌ OAuth token error:', mpData);
      return res.status(400).send(`
        <h2>❌ Error Mercado Pago</h2>
        <pre>${escapeHtml(JSON.stringify(mpData, null, 2))}</pre>
        <a href="/superadmin.html">Volver</a>
      `);
    }

    const expiresAt = new Date(Date.now() + mpData.expires_in * 1000);

    await db.query(
      `
      UPDATE clubs
      SET
        mp_connected = true,
        mp_user_id = $2,
        mp_access_token = $3,
        mp_refresh_token = $4,
        mp_expires_at = $5
      WHERE id = $1
      `,
      [
        clubId,
        mpData.user_id,
        mpData.access_token,
        mpData.refresh_token,
        expiresAt
      ]
    );

    return res.send(`
      <h2>✅ Mercado Pago conectado</h2>
      <p>Club: <b>${escapeHtml(rClub.rows[0].name)}</b></p>
      <a href="/superadmin.html">Volver al Super Admin</a>
    `);
  } catch (err) {
    console.error('❌ OAuth callback error:', err);
    return res.status(500).send(`
      <h2>❌ Error inesperado</h2>
      <pre>${escapeHtml(err.message)}</pre>
      <a href="/superadmin.html">Volver</a>
    `);
  }
});

/* ======================================================
   WEBHOOK – Notificaciones de pago (Checkout Pro)
   URL sugerida: POST /mp/webhook?clubId=...&sig=...
====================================================== */
router.post('/webhook', async (req, res) => {
  try {
    const clubId = String(req.query.clubId || req.query.club_id || '').trim();
    const sig = String(req.query.sig || '').trim();

    // Respondemos 200 SIEMPRE para evitar reintentos masivos
    if (!clubId || !verifyMpWebhook(clubId, sig)) {
      return res.status(200).json({ ok: false });
    }

    const body = req.body || {};
    const topic = String(body.type || body.topic || req.query.topic || '').toLowerCase();

    // MP suele enviar paymentId en body.data.id
    const paymentId = body?.data?.id || body?.id || req.query?.id || null;

    if (!paymentId) return res.status(200).json({ ok: true, ignored: true });

    // Solo pagos
    if (topic && !topic.includes('payment')) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Traer detalle del pago
    const accessToken = await getClubMpAccessToken(clubId);

    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const payData = await payRes.json().catch(() => null);

    if (!payRes.ok || !payData) {
      console.error('❌ MP payment detail error:', paymentId, payData);
      return res.status(200).json({ ok: false });
    }

    // Solo approved
    if (String(payData.status || '').toLowerCase() !== 'approved') {
      return res.status(200).json({ ok: true, status: payData.status });
    }

    // Si viene metadata de cuota, registramos meses
    const md = payData.metadata || {};
    const socioId = md.socio_id || md.socioId || null;
    const anio = md.anio || md.year || null;
    const mesesRaw = md.meses || md.months || null;

    let meses = [];
    if (Array.isArray(mesesRaw)) meses = mesesRaw.map(Number).filter(m => m >= 1 && m <= 12);
    else if (typeof mesesRaw === 'string') meses = mesesRaw.split(',').map(x => Number(x.trim())).filter(m => m >= 1 && m <= 12);

    if (socioId && anio && meses.length) {
      const montoPorMes = Number(md.monto_por_mes || md.montoPorMes || 0) || 0;
      const montoFallback = Number(payData.transaction_amount || 0) || 0;
      const montoFinal = montoPorMes > 0 ? montoPorMes : (montoFallback / meses.length);

      const rSoc = await db.query(
        `SELECT nombre, apellido, numero_socio
         FROM socios
         WHERE id=$1 AND club_id=$2
         LIMIT 1`,
        [socioId, clubId]
      );

      if (rSoc.rowCount) {
        const s = rSoc.rows[0];
        const fechaPago = payData.date_approved
          ? String(payData.date_approved).slice(0, 10)
          : new Date().toISOString().slice(0, 10);

        await db.query('BEGIN');
        for (const mes of meses) {
          await db.query(
            `INSERT INTO pagos_mensuales
             (club_id, socio_id, socio_nombre, socio_apellido, socio_numero, anio, mes, monto, fecha_pago, cuenta)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (club_id, socio_id, anio, mes) DO NOTHING`,
            [
              clubId,
              socioId,
              s.nombre ?? null,
              s.apellido ?? null,
              s.numero_socio ?? null,
              Number(anio),
              Number(mes),
              montoFinal,
              fechaPago,
              'Mercado Pago'
            ]
          );
        }
        await db.query('COMMIT');
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('❌ MP webhook error:', e);
    return res.status(200).json({ ok: false });
  }
});

// =====================================================
// Link público para que el club conecte su Mercado Pago
// GET /mp/public/connect/:clubId?token=apply_token
// =====================================================
router.get('/public/connect/:clubId', async (req, res) => {
  try {
    const { clubId } = req.params;
    const token = String(req.query?.token || '').trim();

    if (!token) {
      return res.status(400).send('Falta token');
    }

    // Validar club + token (usamos apply_token como token de conexión)
    const r = await db.query(
      `SELECT id, name, apply_token FROM clubs WHERE id = $1 LIMIT 1`,
      [clubId]
    );

    if (!r.rowCount) {
      return res.status(404).send('Club no encontrado');
    }

    const club = r.rows[0];
    if (String(club.apply_token || '') !== token) {
      return res.status(403).send('Token inválido');
    }

    const clientId = process.env.MP_CLIENT_ID;
    const redirectUri = `${process.env.PUBLIC_BASE_URL}/mp/oauth/callback`;

    if (!clientId || !process.env.MP_CLIENT_SECRET || !process.env.PUBLIC_BASE_URL) {
      return res.status(500).send('Configuración MP incompleta');
    }

    const state = buildOAuthState(clubId);

    const oauthUrl =
      'https://auth.mercadopago.com.ar/authorization' +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent('offline_access')}`;

    return res.redirect(oauthUrl);
  } catch (err) {
    console.error('❌ MP public connect:', err);
    return res.status(500).send('Error interno');
  }
});

/* ======================================================
   WEBHOOK – Mercado Pago (pagos automáticos)
   POST /mp/webhook?clubId=XXX&sig=YYY
====================================================== */

const crypto = require('crypto');

// 🔐 Secreto compartido (NO exponer)
function getMpWebhookSecret() {
  return (
    process.env.MP_WEBHOOK_SECRET ||
    process.env.JWT_SECRET ||
    ''
  );
}

function signWebhook(clubId) {
  const secret = getMpWebhookSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(String(clubId))
    .digest('hex');
}

function verifyWebhook(clubId, sig) {
  if (!clubId || !sig) return false;
  const expected = signWebhook(clubId);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(sig)
  );
}

router.post('/webhook', async (req, res) => {
  // ✅ Siempre responder 200 rápido
  res.status(200).json({ ok: true });

  try {
    const clubId = String(req.query.clubId || '').trim();
    const sig = String(req.query.sig || '').trim();

    if (!verifyWebhook(clubId, sig)) {
      console.error('❌ Webhook MP inválido (firma)');
      return;
    }

    // Mercado Pago envía el ID del pago acá
    const paymentId =
      req.body?.data?.id ||
      req.body?.id ||
      null;

    if (!paymentId) {
      console.warn('⚠️ Webhook sin paymentId');
      return;
    }

    // 🔑 Traer token del club
    const rClub = await db.query(
      `SELECT mp_access_token
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
      [clubId]
    );

    if (!rClub.rowCount) {
      console.error('❌ Club no encontrado:', clubId);
      return;
    }

    const accessToken = rClub.rows[0].mp_access_token;

    // 🔎 Consultar pago real en Mercado Pago
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const payment = await mpRes.json();

    if (!mpRes.ok) {
      console.error('❌ Error MP payment:', payment);
      return;
    }

    // ✅ Solo pagos aprobados
    if (payment.status !== 'approved') {
      return;
    }

    // 🧠 Metadata enviada desde la app
    const md = payment.metadata || {};
    const socioId = md.socio_id;
    const anio = Number(md.anio);
    const mesesRaw = md.meses || '';
    const montoPorMes = Number(md.monto_por_mes || 0);

    if (!socioId || !anio || !mesesRaw) {
      console.error('❌ Metadata incompleta:', md);
      return;
    }

    const meses = mesesRaw
      .split(',')
      .map(m => Number(m))
      .filter(m => m >= 1 && m <= 12);

    if (!meses.length) {
      console.error('❌ Meses inválidos:', mesesRaw);
      return;
    }

    // 👤 Datos del socio
    const rSocio = await db.query(
      `SELECT nombre, apellido, numero_socio
       FROM socios
       WHERE id = $1 AND club_id = $2
       LIMIT 1`,
      [socioId, clubId]
    );

    if (!rSocio.rowCount) {
      console.error('❌ Socio no encontrado:', socioId);
      return;
    }

    const socio = rSocio.rows[0];

    const fechaPago =
      payment.date_approved?.substring(0, 10) ||
      new Date().toISOString().substring(0, 10);

    // ✅ Insertar pagos (idempotente)
    await db.query('BEGIN');

    for (const mes of meses) {
      await db.query(
        `INSERT INTO pagos_mensuales
         (club_id, socio_id, socio_nombre, socio_apellido, socio_numero,
          anio, mes, monto, fecha_pago, cuenta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (club_id, socio_id, anio, mes) DO NOTHING`,
        [
          clubId,
          socioId,
          socio.nombre,
          socio.apellido,
          socio.numero_socio,
          anio,
          mes,
          montoPorMes,
          fechaPago,
          'Mercado Pago',
        ]
      );
    }

    await db.query('COMMIT');

    console.log(
      `✅ Pago MP acreditado | club=${clubId} socio=${socioId} meses=${meses.join(',')}`
    );
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch (_) {}

    console.error('❌ Error webhook MP:', err);
  }
});

module.exports = router;
