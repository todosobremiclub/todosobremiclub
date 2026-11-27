// src/services/mpConnectToken.js
//
// Firmas para la conexión OAuth de Mercado Pago de cada club.
//
//  1) "state" del OAuth: club + marca de tiempo + firma HMAC. Vale 15 minutos.
//     (Antes se aceptaba también un state SIN firma —solo el clubId—, lo que
//     permitía conectar una cuenta de MP ajena a cualquier club. Se eliminó.)
//
//  2) Token del LINK PÚBLICO de conexión que el superadmin le manda al club:
//     firmado, atado a ese club y con vencimiento. Reemplaza al apply_token,
//     que es el mismo valor que lleva el QR público de postulaciones.
//
// Los dos usan etiquetas distintas dentro del HMAC, así una firma de un tipo
// nunca sirve como la del otro.
const crypto = require('crypto');

const STATE_TTL_SEG = 15 * 60;
const CONNECT_TOKEN_TTL_SEG = 7 * 24 * 60 * 60;

function getSecret() {
  return (
    process.env.MP_OAUTH_STATE_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SECRET ||
    ''
  );
}

function hmac(label, raw) {
  const secret = getSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(`${label}|${raw}`).digest('hex');
}

function igualesSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------- state de OAuth ---------- */
function buildOAuthState(clubId, nowSeg = Math.floor(Date.now() / 1000)) {
  const raw = `${clubId}.${nowSeg}`;
  const sig = hmac('mp-oauth-state', raw);
  if (!sig) throw new Error('Falta MP_OAUTH_STATE_SECRET (o JWT_SECRET) en el servidor');
  return `${raw}.${sig}`;
}

function parseOAuthState(state, nowSeg = Math.floor(Date.now() / 1000)) {
  const s = String(state || '').trim();
  if (!s) return { ok: false, error: 'state vacío' };

  const parts = s.split('.');
  // Formato único y firmado: clubId.timestamp.firma  (ya no se acepta el formato viejo sin firma)
  if (parts.length !== 3) return { ok: false, error: 'state inválido' };

  const [clubId, tsRaw, sig] = parts;
  const ts = Number(tsRaw);
  if (!clubId || !Number.isFinite(ts)) return { ok: false, error: 'state inválido' };

  const esperado = hmac('mp-oauth-state', `${clubId}.${ts}`);
  if (!esperado || !igualesSeguro(esperado, sig)) {
    return { ok: false, error: 'firma de state inválida' };
  }
  if (Math.abs(nowSeg - ts) > STATE_TTL_SEG) {
    return { ok: false, error: 'state expirado' };
  }
  return { ok: true, clubId };
}

/* ---------- token del link público de conexión ---------- */
function signConnectToken(clubId, nowSeg = Math.floor(Date.now() / 1000)) {
  const exp = nowSeg + CONNECT_TOKEN_TTL_SEG;
  const sig = hmac('mp-public-connect', `${clubId}.${exp}`);
  if (!sig) throw new Error('Falta MP_OAUTH_STATE_SECRET (o JWT_SECRET) en el servidor');
  return { token: `${exp}.${sig}`, expiraEnSeg: exp };
}

function verifyConnectToken(clubId, token, nowSeg = Math.floor(Date.now() / 1000)) {
  const t = String(token || '').trim();
  const parts = t.split('.');
  if (parts.length !== 2) return { ok: false, error: 'invalido' };
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp)) return { ok: false, error: 'invalido' };

  const esperado = hmac('mp-public-connect', `${clubId}.${exp}`);
  if (!esperado || !igualesSeguro(esperado, parts[1])) return { ok: false, error: 'invalido' };
  if (nowSeg > exp) return { ok: false, error: 'vencido' };
  return { ok: true };
}

module.exports = {
  buildOAuthState,
  parseOAuthState,
  signConnectToken,
  verifyConnectToken,
  STATE_TTL_SEG,
  CONNECT_TOKEN_TTL_SEG
};
