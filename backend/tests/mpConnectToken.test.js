process.env.MP_OAUTH_STATE_SECRET = 'secreto-de-prueba';
const assert = require('assert');
const T = require('../src/services/mpConnectToken');

const CLUB = '11111111-2222-3333-4444-555555555555';
const OTRO = '99999999-2222-3333-4444-555555555555';
const now = 1_800_000_000;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// --- state ---
const st = T.buildOAuthState(CLUB, now);
let p = T.parseOAuthState(st, now + 10);
ok(p.ok && p.clubId === CLUB, 'state válido');

// el formato viejo (solo clubId) YA NO se acepta
ok(!T.parseOAuthState(CLUB, now).ok, 'state legacy rechazado');
ok(!T.parseOAuthState('', now).ok, 'state vacío rechazado');
// cambiar de club manteniendo la firma
const partes = st.split('.');
ok(!T.parseOAuthState(`${OTRO}.${partes[1]}.${partes[2]}`, now).ok, 'cambio de club rechazado');
// firma alterada / más partes
ok(!T.parseOAuthState(`${CLUB}.${partes[1]}.${'0'.repeat(64)}`, now).ok, 'firma falsa rechazada');
ok(!T.parseOAuthState(`${st}.extra`, now).ok, 'state con partes de más rechazado');
// vencido (>15 min) y futuro lejano
ok(!T.parseOAuthState(st, now + 16 * 60).ok, 'state vencido rechazado');
ok(T.parseOAuthState(st, now + 14 * 60).ok, 'state a 14 min válido');

// --- token de link público ---
const { token } = T.signConnectToken(CLUB, now);
ok(T.verifyConnectToken(CLUB, token, now + 100).ok, 'token válido');
ok(!T.verifyConnectToken(OTRO, token, now + 100).ok, 'token de otro club rechazado');
ok(T.verifyConnectToken(CLUB, token, now + T.CONNECT_TOKEN_TTL_SEG + 5).error === 'vencido', 'token vencido');
ok(!T.verifyConnectToken(CLUB, 'abc', now).ok, 'token basura rechazado');
ok(!T.verifyConnectToken(CLUB, '', now).ok, 'token vacío rechazado');
// el apply_token (hex de 32) no sirve
ok(!T.verifyConnectToken(CLUB, 'a1b2c3d4e5f60718293a4b5c6d7e8f90', now).ok, 'apply_token no sirve');
// una firma de state no sirve como token de link, y viceversa
ok(!T.verifyConnectToken(CLUB, `${partes[1]}.${partes[2]}`, now).ok, 'firma de state no sirve de token');
const [exp, sig] = token.split('.');
ok(!T.parseOAuthState(`${CLUB}.${exp}.${sig}`, Number(exp)).ok, 'firma de token no sirve de state');

// sin secreto configurado: no se puede generar nada
delete process.env.MP_OAUTH_STATE_SECRET; delete process.env.JWT_SECRET; delete process.env.SECRET;
assert.throws(() => T.buildOAuthState(CLUB, now)); n++;
assert.throws(() => T.signConnectToken(CLUB, now)); n++;
ok(!T.parseOAuthState(st, now).ok, 'sin secreto no valida');

console.log(`OK: ${n} verificaciones`);
