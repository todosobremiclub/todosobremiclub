// Prueba de integración: Express real + trust proxy + limitador de logins
const express = require('express');
const http = require('http');
const { crearLimitador } = require('../src/middleware/rateLimit');
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
const lim = crearLimitador({ nombre: 'login', ventanaMs: 60000, max: 3, contarSoloFallos: true });
app.post('/login', lim, (req, res) => {
  if (req.body.pass === 'ok') return res.json({ ok: true });
  res.status(401).json({ ok: false });
});
function post(xff, pass) {
  return new Promise((resolve) => {
    const req = http.request({ port: server.address().port, path: '/login', method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.end(JSON.stringify({ pass }));
  });
}
const server = app.listen(0, async () => {
  const assert = require('assert'); let n = 0;
  // el cliente real (último valor que agrega el proxy) es 5.5.5.5; el atacante inventa valores a la izquierda
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await post(`10.0.0.${i}, 5.5.5.5`, 'mal'));   // rota IPs falsas
  assert.deepStrictEqual(r, [401, 401, 401, 429]); n++;                            // igual se frena: cuenta la IP real
  assert.strictEqual(await post('6.6.6.6', 'mal'), 401); n++;                       // otro cliente real no se ve afectado
  assert.strictEqual(await post('6.6.6.6', 'ok'), 200); n++;
  for (let i = 0; i < 8; i++) assert.strictEqual(await post('7.7.7.7', 'ok'), 200);  // logins buenos no gastan intentos
  n++;
  console.log(`OK: ${n} verificaciones de integración`);
  server.close();
});
