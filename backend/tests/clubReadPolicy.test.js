process.env.JWT_SECRET = 'test-secret';
const assert = require('assert');
const jwt = require('jsonwebtoken');
const policy = require('../src/middleware/clubReadPolicy');

function run(method, path, roles, clubId = 'club-1', extra = {}) {
  const token = roles !== null ? jwt.sign({ ...extra, roles }, process.env.JWT_SECRET) : null;
  const req = { method, path, params: { clubId }, headers: token ? { authorization: 'Bearer ' + token } : {} };
  let status = null, nextCalled = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  policy(req, res, () => { nextCalled = true; });
  return nextCalled ? 'next' : status;
}
const R = (role, club_id = 'club-1') => [{ role, club_id }];
const SOCIO = { socioId: 's1', clubId: 'club-1' };

const cases = [
  // escrituras no son de este middleware
  ['POST', '/reportes/x', R('profesor'), 'next'],
  // admin / staff / solo_lectura / superadmin: todo
  ['GET', '/reportes/ingresos-vs-gastos', R('admin'), 'next'],
  ['GET', '/reportes/ingresos-vs-gastos', R('staff'), 'next'],
  ['GET', '/socios/export.xlsx', R('solo_lectura'), 'next'],
  ['GET', '/espacios/recursos', R('solo_lectura'), 'next'],
  ['GET', '/reportes/ingresos-vs-gastos', [{ role: 'superadmin', club_id: null }], 'next'],
  // finanzas
  ['GET', '/reportes/ingresos-vs-gastos', R('finanzas'), 'next'],
  ['GET', '/pagos/abc', R('finanzas'), 'next'],
  ['GET', '/gastos', R('finanzas'), 'next'],
  ['GET', '/payments/transfer/pending', R('finanzas'), 'next'],
  ['GET', '/tienda/productos', R('finanzas'), 'next'],
  ['GET', '/informes-mensuales', R('finanzas'), 'next'],
  ['GET', '/pendientes', R('finanzas'), 'next'],
  ['GET', '/espacios/recursos', R('finanzas'), 403],
  ['GET', '/asistencia/socios-filtrados', R('finanzas'), 403],
  ['GET', '/socios/export.xlsx', R('finanzas'), 403],
  ['GET', '/socios/abc/adjuntos', R('finanzas'), 403],
  ['GET', '/socios/abc/comentarios', R('finanzas'), 403],
  ['GET', '/socios/bienvenida/pendientes', R('finanzas'), 403],
  ['GET', '/socios', R('finanzas'), 'next'],
  ['GET', '/socios/abc/planes-actividad', R('finanzas'), 'next'],
  // profesor
  ['GET', '/reportes/asistencia/matriz-mes', R('profesor'), 'next'],
  ['GET', '/reportes/ingresos-vs-gastos', R('profesor'), 403],
  ['GET', '/reportes/impagos-mes/export/excel', R('profesor'), 403],
  ['GET', '/asistencia/socios-filtrados', R('profesor'), 'next'],
  ['GET', '/pagos/abc', R('profesor'), 403],
  ['GET', '/gastos', R('profesor'), 403],
  ['GET', '/socios', R('profesor'), 'next'],
  ['GET', '/socios/export.xlsx', R('profesor'), 403],
  ['GET', '/noticias', R('profesor'), 'next'],
  ['GET', '/cumples', R('profesor'), 'next'],
  ['GET', '/config/actividades', R('profesor'), 'next'],
  ['GET', '/tienda/productos', R('profesor'), 403],
  // asistencias
  ['GET', '/asistencia/socios-filtrados', R('asistencias'), 'next'],
  ['GET', '/reportes/asistencia/socio', R('asistencias'), 'next'],
  ['GET', '/reportes/ingresos-por-tipo/detalle', R('asistencias'), 403],
  ['GET', '/pagos/abc', R('asistencias'), 403],
  ['GET', '/pendientes', R('asistencias'), 403],
  ['GET', '/socios', R('asistencias'), 'next'],
  // comunicación
  ['GET', '/noticias', R('comunicacion'), 'next'],
  ['GET', '/notificaciones', R('comunicacion'), 'next'],
  ['GET', '/cumples', R('comunicacion'), 'next'],
  ['GET', '/reportes/ingresos-vs-gastos', R('comunicacion'), 403],
  ['GET', '/pagos/abc', R('comunicacion'), 403],
  ['GET', '/asistencia/socios-filtrados', R('comunicacion'), 403],
  ['GET', '/socios/export.xlsx', R('comunicacion'), 403],
  // otro club: la ruta responde 403 por membresía (el middleware no interviene)
  ['GET', '/reportes/ingresos-vs-gastos', R('profesor', 'club-2'), 'next'],
  // sin token: lo maneja requireAuth
  ['GET', '/reportes/x', null, 'next'],
  // rol desconocido
  ['GET', '/reportes/x', R('invitado'), 403],
  ['GET', '/noticias', R('invitado'), 'next'],
  // dos roles: alcanza con uno
  ['GET', '/pagos/abc', [{ role: 'profesor', club_id: 'club-1' }, { role: 'finanzas', club_id: 'club-1' }], 'next'],
  // tokens de SOCIO (app): bloqueados en secciones del panel, libres en el resto
  ['GET', '/reportes/ingresos-vs-gastos', [], 403, SOCIO],
  ['GET', '/pendientes', [], 403, SOCIO],
  ['GET', '/socios', [], 403, SOCIO],
  ['GET', '/tienda/productos', [], 403, SOCIO],
  ['GET', '/asistencia/socios-filtrados', [], 403, SOCIO],
  ['GET', '/pagos/s1', [], 'next', SOCIO],
  ['GET', '/noticias', [], 'next', SOCIO],
  ['GET', '/cumples', [], 'next', SOCIO],
  ['GET', '/notificaciones', [], 'next', SOCIO],
  ['GET', '/config/actividades', [], 'next', SOCIO],
];
let fallos = 0;
for (const [m, p, roles, esperado, extra] of cases) {
  const got = run(m, p, roles, 'club-1', extra || {});
  if (got !== esperado) { fallos++; console.log('FALLA', m, p, JSON.stringify(roles), 'esperado', esperado, 'obtuvo', got); }
}
// modo log: no bloquea
process.env.READ_POLICY_MODE = 'log';
assert.strictEqual(run('GET', '/reportes/ingresos-vs-gastos', R('profesor')), 'next');
delete process.env.READ_POLICY_MODE;
if (fallos) { console.log(`❌ ${fallos} caso(s) fallaron`); process.exit(1); }
console.log(`✅ clubReadPolicy: ${cases.length + 1} casos OK`);
