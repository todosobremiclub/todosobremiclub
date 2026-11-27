// Ejecutar: node tests/accesoQr.test.js
process.env.JWT_SECRET = 'test-secret';
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

// db falsa (sin base real)
const CLUB = '11111111-1111-4111-8111-111111111111';
const OTRO_CLUB = '22222222-2222-4222-8222-222222222222';
const SOCIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MOROSO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INACTIVO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BECADO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const hoy = new Date();
const idx = (d) => d.getFullYear() * 12 + d.getMonth() + 1;
const socios = {
  [SOCIO]: { id: SOCIO, nombre: 'Ana', apellido: 'Paz', numero_socio: 10, activo: true, becado: false, ultimo: idx(hoy) },
  [MOROSO]: { id: MOROSO, nombre: 'Mora', apellido: 'Ros', numero_socio: 11, activo: true, becado: false, ultimo: idx(hoy) - 5 },
  [INACTIVO]: { id: INACTIVO, nombre: 'In', apellido: 'Activo', numero_socio: 12, activo: false, becado: false, ultimo: idx(hoy) },
  [BECADO]: { id: BECADO, nombre: 'Be', apellido: 'Cado', numero_socio: 13, activo: true, becado: true, ultimo: null },
};
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    const [a, b] = params;
    if (/FROM socios/.test(sql)) {
      const s = socios[a];
      return { rowCount: s && b === CLUB ? 1 : 0, rows: s && b === CLUB ? [s] : [] };
    }
    if (/FROM pagos_mensuales/.test(sql)) {
      const s = socios[a];
      return { rows: [{ ultimo_idx: s ? s.ultimo : null }] };
    }
    return { rows: [], rowCount: 0 };
  }
} };

const { firmarQr, verificarTokenQr, decidirAcceso } = require('../src/services/accesoQr');
const accesoRoutes = require('../src/routes/accesoRoutes');

function post(app, path, body, token) {
  return new Promise((resolve) => {
    const srv = http.createServer(app).listen(0, () => {
      const data = JSON.stringify(body);
      const req = http.request({ port: srv.address().port, path, method: 'POST', headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
        ...(token ? { authorization: 'Bearer ' + token } : {}) } }, (res) => {
        let d = ''; res.on('data', (c) => (d += c));
        res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); });
      });
      req.end(data);
    });
  });
}
const app = express(); app.use(express.json()); app.use('/club', accesoRoutes);
const panel = (role, club = CLUB) => jwt.sign({ userId: 1, roles: [{ role, club_id: club }] }, process.env.JWT_SECRET);

(async () => {
  // --- servicio ---
  const t = firmarQr({ socioId: SOCIO, clubId: CLUB });
  assert.deepStrictEqual(verificarTokenQr(t), { socioId: SOCIO, clubId: CLUB });
  // el token de QR NO sirve como token de sesión (requireAuth usa JWT_SECRET directo)
  assert.throws(() => jwt.verify(t, process.env.JWT_SECRET));
  // un token de sesión de socio NO sirve como QR
  const sesion = jwt.sign({ socioId: SOCIO, clubId: CLUB }, process.env.JWT_SECRET, { expiresIn: '30d' });
  assert.throws(() => verificarTokenQr(sesion), (e) => e.codigo === 'invalido');
  // token vencido
  const crypto = require('crypto');
  const clave = crypto.createHmac('sha256', process.env.JWT_SECRET).update('tsmc-carnet-qr-v1').digest('hex');
  const viejo = jwt.sign({ typ: 'qr', socioId: SOCIO, clubId: CLUB }, clave, { expiresIn: -10 });
  assert.throws(() => verificarTokenQr(viejo), (e) => e.codigo === 'expirado');
  // basura y alg none
  assert.throws(() => verificarTokenQr('hola'), (e) => e.codigo === 'invalido');
  assert.throws(() => verificarTokenQr(''), (e) => e.codigo === 'invalido');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' +
    Buffer.from(JSON.stringify({ typ: 'qr', socioId: SOCIO, clubId: CLUB })).toString('base64url') + '.';
  assert.throws(() => verificarTokenQr(none), (e) => e.codigo === 'invalido');

  // --- regla de acceso ---
  assert.strictEqual(decidirAcceso({ activo: true, becado: false, ultimoIdx: idx(hoy) }).habilitado, true);
  assert.strictEqual(decidirAcceso({ activo: true, becado: false, ultimoIdx: idx(hoy) - 1 }).habilitado, true);
  assert.strictEqual(decidirAcceso({ activo: true, becado: false, ultimoIdx: idx(hoy) - 2 }).habilitado, false);
  assert.strictEqual(decidirAcceso({ activo: true, becado: false, ultimoIdx: null }).habilitado, false);
  assert.strictEqual(decidirAcceso({ activo: true, becado: true, ultimoIdx: null }).habilitado, true);
  assert.strictEqual(decidirAcceso({ activo: false, becado: true, ultimoIdx: idx(hoy) }).habilitado, false);

  // --- endpoint ---
  const u = `/club/${CLUB}/acceso/verificar`;
  let r = await post(app, u, { qr: t }, panel('admin'));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.habilitado, true);
  assert.strictEqual(r.body.socio.nombre, 'Ana'); assert.ok(!('dni' in r.body.socio));
  // finanzas y solo_lectura pueden operar
  assert.strictEqual((await post(app, u, { qr: t }, panel('finanzas'))).body.habilitado, true);
  assert.strictEqual((await post(app, u, { qr: t }, panel('solo_lectura'))).body.habilitado, true);
  // profesor / comunicación / asistencias no
  assert.strictEqual((await post(app, u, { qr: t }, panel('profesor'))).status, 403);
  assert.strictEqual((await post(app, u, { qr: t }, panel('comunicacion'))).status, 403);
  // admin de OTRO club no puede
  assert.strictEqual((await post(app, u, { qr: t }, panel('admin', OTRO_CLUB))).status, 403);
  // sin token / token de socio
  assert.strictEqual((await post(app, u, { qr: t })).status, 401);
  assert.strictEqual((await post(app, u, { qr: t }, sesion)).status, 403);
  // moroso, inactivo, becado
  r = await post(app, u, { qr: firmarQr({ socioId: MOROSO, clubId: CLUB }) }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false);
  r = await post(app, u, { qr: firmarQr({ socioId: INACTIVO, clubId: CLUB }) }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false);
  r = await post(app, u, { qr: firmarQr({ socioId: BECADO, clubId: CLUB }) }, panel('admin'));
  assert.strictEqual(r.body.habilitado, true);
  // QR de otro club
  r = await post(app, u, { qr: firmarQr({ socioId: SOCIO, clubId: OTRO_CLUB }) }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false); assert.match(r.body.motivo, /otro club/);
  // QR inventado / vencido / sin cuerpo
  r = await post(app, u, { qr: 'inventado' }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false);
  r = await post(app, u, { qr: viejo }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false); assert.match(r.body.motivo, /venci/);
  assert.strictEqual((await post(app, u, {}, panel('admin'))).status, 400);
  // QR viejo (legacy): el estado sale de la base, NO de lo que diga el QR
  r = await post(app, u, { legacy: { socioId: MOROSO, ultimoPago: '2099-01', alDia: true } }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false); assert.strictEqual(r.body.legacy, true);
  r = await post(app, u, { legacy: { socioId: SOCIO } }, panel('admin'));
  assert.strictEqual(r.body.habilitado, true);
  r = await post(app, u, { legacy: { socioId: 'no-es-uuid' } }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false);
  // legacy de un socio de otro club
  r = await post(app, `/club/${OTRO_CLUB}/acceso/verificar`, { legacy: { socioId: SOCIO } }, panel('admin', OTRO_CLUB));
  assert.strictEqual(r.body.habilitado, false);
  // legacy apagado
  process.env.ACCESO_QR_LEGACY = '0';
  r = await post(app, u, { legacy: { socioId: SOCIO } }, panel('admin'));
  assert.strictEqual(r.body.habilitado, false); assert.match(r.body.motivo, /actualizar/);
  delete process.env.ACCESO_QR_LEGACY;

  console.log('✅ accesoQr: todos los casos OK');
  process.exit(0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
