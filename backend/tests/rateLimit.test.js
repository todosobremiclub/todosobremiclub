const assert = require('assert');
const { crearLimitador, intentar, _reset } = require('../src/middleware/rateLimit');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

function fakeRes() {
  const handlers = {};
  return {
    statusCode: 200, headers: {}, body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
    on(ev, fn) { handlers[ev] = fn; },
    finish(status) { this.statusCode = status; handlers.finish && handlers.finish(); }
  };
}
function pedir(lim, ip) {
  const req = { ip };
  const res = fakeRes();
  let paso = false;
  lim(req, res, () => { paso = true; });
  return { paso, res };
}

// --- contar todo: 3 por ventana ---
_reset();
const lim = crearLimitador({ nombre: 't1', ventanaMs: 1000, max: 3 });
for (let i = 0; i < 3; i++) ok(pedir(lim, '1.1.1.1').paso, `pedido ${i + 1} pasa`);
let b = pedir(lim, '1.1.1.1');
ok(!b.paso && b.res.statusCode === 429, 'el 4º se bloquea con 429');
ok(Number(b.res.headers['Retry-After']) >= 1, 'incluye Retry-After');
ok(b.res.body.ok === false && /intentos/i.test(b.res.body.error), 'mensaje en español');
ok(pedir(lim, '2.2.2.2').paso, 'otra IP no se ve afectada');

// --- vence la ventana ---
const t0 = 1_000_000;
_reset();
for (let i = 0; i < 2; i++) intentar('t2', 'k', 2, 1000, t0);
ok(!intentar('t2', 'k', 2, 1000, t0 + 500).permitido, 'bloqueado dentro de la ventana');
ok(intentar('t2', 'k', 2, 1000, t0 + 1001).permitido, 'se libera al vencer la ventana');

// --- solo fallos: los éxitos devuelven el intento ---
_reset();
const login = crearLimitador({ nombre: 'login', ventanaMs: 60000, max: 3, contarSoloFallos: true });
for (let i = 0; i < 10; i++) {            // 10 logins correctos seguidos
  const r = pedir(login, '3.3.3.3'); ok(r.paso, 'login correcto pasa'); r.res.finish(200);
}
for (let i = 0; i < 3; i++) {              // 3 fallos
  const r = pedir(login, '3.3.3.3'); ok(r.paso, 'intento fallido pasa'); r.res.finish(401);
}
ok(!pedir(login, '3.3.3.3').paso, 'tras 3 fallos se bloquea (aunque haya tenido éxitos antes)');

// --- ráfaga en paralelo: no hay que esperar a que terminen para frenar ---
_reset();
const rafaga = crearLimitador({ nombre: 'raf', ventanaMs: 60000, max: 3, contarSoloFallos: true });
const resultados = [];
for (let i = 0; i < 10; i++) resultados.push(pedir(rafaga, '4.4.4.4')); // ninguno terminó todavía
ok(resultados.filter(r => r.paso).length === 3, 'solo 3 de 10 pedidos simultáneos pasan');

// --- clave personalizada (por email) ---
_reset();
const porMail = crearLimitador({ nombre: 'mail', ventanaMs: 1000, max: 1, clave: (req) => req.mail });
const rq = (mail) => { const res = fakeRes(); let p = false; porMail({ mail, ip: 'x' }, res, () => { p = true; }); return p; };
ok(rq('a@a.com') && !rq('a@a.com') && rq('b@b.com'), 'clave personalizada');

console.log(`OK: ${n} verificaciones`);
