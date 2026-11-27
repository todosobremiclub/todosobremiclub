process.env.JWT_SECRET = 'test-secret';
const assert = require('assert');
const jwt = require('jsonwebtoken');
const policy = require('../src/middleware/clubWritePolicy');

function run(method, path, roles, clubId = 'club-1') {
  const token = roles ? jwt.sign({ userId: 1, roles }, process.env.JWT_SECRET) : null;
  const req = { method, path, params: { clubId }, headers: token ? { authorization: 'Bearer ' + token } : {} };
  let status = null, nextCalled = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  policy(req, res, () => { nextCalled = true; });
  return nextCalled ? 'next' : status;
}
const R = (role, club_id = 'club-1') => [{ role, club_id }];
const cases = [
  // lectura siempre pasa
  ['GET', '/socios', R('solo_lectura'), 'next'],
  // solo lectura nunca escribe (incluye impersonación)
  ['POST', '/socios', R('solo_lectura'), 403],
  ['DELETE', '/tienda/productos/1', R('solo_lectura'), 403],
  ['POST', '/pagos', R('solo_lectura'), 403],
  // admin / staff todo
  ['POST', '/socios', R('admin'), 'next'],
  ['PUT', '/config/actividades/1', R('staff'), 'next'],
  // finanzas
  ['POST', '/pagos', R('finanzas'), 'next'],
  ['POST', '/ingresos', R('finanzas'), 'next'],
  ['DELETE', '/gastos/3', R('finanzas'), 'next'],
  ['POST', '/payments/transfer/9/confirm', R('finanzas'), 'next'],
  ['POST', '/planes-clases/5/registrar-pago', R('finanzas'), 'next'],
  ['POST', '/socios', R('finanzas'), 403],
  ['PUT', '/config/categorias/1', R('finanzas'), 403],
  ['POST', '/planes-clases/5/otra-cosa', R('finanzas'), 403],
  // comunicación
  ['POST', '/noticias', R('comunicacion'), 'next'],
  ['POST', '/notificaciones/programadas', R('comunicacion'), 'next'],
  ['POST', '/agenda/actividades', R('comunicacion'), 'next'],
  ['POST', '/pagos', R('comunicacion'), 403],
  ['POST', '/socios', R('comunicacion'), 403],
  // profesor / asistencias
  ['POST', '/asistencia', R('profesor'), 'next'],
  ['PUT', '/asistencia/1/detalle', R('asistencias'), 'next'],
  ['POST', '/noticias', R('asistencias'), 403],
  ['DELETE', '/socios/1', R('profesor'), 403],
  // otro club: la ruta responde 403 por membresía (el middleware no interviene)
  ['POST', '/socios', R('solo_lectura', 'club-2'), 'next'],
  // superadmin
  ['POST', '/socios', [{ role: 'superadmin', club_id: null }], 'next'],
  // sin token: lo maneja requireAuth
  ['POST', '/socios', null, 'next'],
  // rol desconocido
  ['POST', '/socios', R('invitado'), 403],
  // usuario con dos roles en el mismo club: alcanza con uno que permita
  ['POST', '/noticias', [{ role: 'solo_lectura', club_id: 'club-1' }, { role: 'comunicacion', club_id: 'club-1' }], 'next'],
];
let fallos = 0;
for (const [m, p, roles, esperado] of cases) {
  const got = run(m, p, roles);
  const ok = got === esperado;
  if (!ok) { fallos++; console.log('FALLA', m, p, JSON.stringify(roles), 'esperado', esperado, 'obtuvo', got); }
}
// modo log: no bloquea
process.env.ROLE_POLICY_MODE = 'log';
assert.strictEqual(run('POST', '/socios', R('solo_lectura')), 'next');
console.log(fallos ? `${fallos} FALLAS` : `OK: ${cases.length + 1} casos`);
process.exit(fallos ? 1 : 0);
