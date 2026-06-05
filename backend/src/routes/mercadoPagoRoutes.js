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
        `&state=${encodeURIComponent(state)}`;



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

module.exports = router;
