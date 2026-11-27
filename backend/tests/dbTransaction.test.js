// Ejecutar: node --test tests/dbTransaction.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// Pool falso: cada conexión registra sus sentencias.
function fakePool() {
  const log = [];
  let n = 0;
  const pool = {
    log,
    conexiones: 0, liberadas: 0,
    query: async (t) => { log.push(['pool', t]); return { rows: [], rowCount: 0 }; },
    connect: async () => {
      const id = ++n; pool.conexiones++;
      const c = {
        id,
        on() {}, removeListener() {},
        query: async (t) => { log.push([id, t]); return { rows: [], rowCount: 0 }; },
        release: () => { pool.liberadas++; log.push([id, 'RELEASE']); }
      };
      return c;
    }
  };
  return pool;
}
const { _crear } = require('../src/db');

async function req(app, path) {
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const out = await new Promise((resolve) => {
    http.get({ port, path }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
  });
  await new Promise((r) => srv.close(r));
  return out;
}

test('BEGIN/INSERT/COMMIT van por UNA misma conexión y se libera', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (_q, res) => {
    await db.query('BEGIN'); await db.query('INSERT 1', []); await db.query('UPDATE 2', []); await db.query('COMMIT');
    res.json({ ok: true });
  });
  await req(app, '/x');
  const conn = pool.log.filter((l) => l[0] === 1).map((l) => l[1]);
  assert.deepStrictEqual(conn, ['BEGIN', 'INSERT 1', 'UPDATE 2', 'COMMIT', 'RELEASE']);
  assert.strictEqual(pool.log.filter((l) => l[0] === 'pool').length, 0);
});

test('ROLLBACK deshace en la misma conexión', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (_q, res) => {
    await db.query('BEGIN'); await db.query('INSERT 1', []); await db.query('ROLLBACK');
    res.status(400).json({ ok: false });
  });
  await req(app, '/x');
  assert.deepStrictEqual(pool.log.filter((l) => l[0] === 1).map((l) => l[1]), ['BEGIN', 'INSERT 1', 'ROLLBACK', 'RELEASE']);
});

test('queries sin transacción usan el pool como antes', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (_q, res) => { await db.query('SELECT 1', []); res.json({}); });
  await req(app, '/x');
  assert.strictEqual(pool.conexiones, 0);
});

test('respuesta 400 sin ROLLBACK explícito → ROLLBACK automático y se libera', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (_q, res) => { await db.query('BEGIN'); await db.query('UPDATE stock', []); res.status(400).json({}); });
  await req(app, '/x');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(pool.log.filter((l) => l[0] === 1).map((l) => l[1]), ['BEGIN', 'UPDATE stock', 'ROLLBACK', 'RELEASE']);
});

test('respuesta 200 sin COMMIT explícito → COMMIT automático (compatibilidad)', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (_q, res) => { await db.query('BEGIN'); await db.query('UPDATE a', []); res.json({ ok: true }); });
  await req(app, '/x');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(pool.log.filter((l) => l[0] === 1).map((l) => l[1]), ['BEGIN', 'UPDATE a', 'COMMIT', 'RELEASE']);
});

test('dos requests simultáneos no comparten conexión', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (q, res) => {
    await db.query('BEGIN');
    await new Promise((r) => setTimeout(r, 20));
    await db.query('INSERT ' + q.query.k, []);
    await db.query('COMMIT'); res.json({});
  });
  await Promise.all([req(app, '/x?k=A'), req(app, '/x?k=B')]);
  const porConn = {};
  pool.log.filter((l) => typeof l[0] === 'number').forEach((l) => (porConn[l[0]] = porConn[l[0]] || []).push(l[1]));
  const vals = Object.values(porConn).map((a) => a.join('|'));
  assert.ok(vals.includes('BEGIN|INSERT A|COMMIT|RELEASE') && vals.includes('BEGIN|INSERT B|COMMIT|RELEASE'));
});

test('BEGIN anidado (helper dentro de handler) no abre otra conexión', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (_q, res) => {
    await db.query('BEGIN'); await db.query('BEGIN'); await db.query('A', []); await db.query('COMMIT'); await db.query('B', []); await db.query('COMMIT');
    res.json({});
  });
  await req(app, '/x');
  assert.strictEqual(pool.conexiones, 1);
  assert.deepStrictEqual(pool.log.filter((l) => l[0] === 1).map((l) => l[1]), ['BEGIN', 'A', 'B', 'COMMIT', 'RELEASE']);
});

test('COMMIT/ROLLBACK sin transacción no revientan ni tocan la base', async () => {
  const pool = fakePool(); const db = _crear(pool);
  const app = express(); app.use(db.contextMiddleware);
  app.get('/x', async (_q, res) => { await db.query('COMMIT'); await db.query('ROLLBACK'); res.json({}); });
  await req(app, '/x');
  assert.strictEqual(pool.log.length, 0);
});

test('withTransaction hace commit y rollback con su propia conexión', async () => {
  const pool = fakePool(); const db = _crear(pool);
  await db.withTransaction(async (c) => { await c.query('X'); });
  await assert.rejects(db.withTransaction(async (c) => { await c.query('Y'); throw new Error('falló'); }));
  assert.deepStrictEqual(pool.log.map((l) => l[1]), ['BEGIN', 'X', 'COMMIT', 'RELEASE', 'BEGIN', 'Y', 'ROLLBACK', 'RELEASE']);
});

test('sin contexto (workers) db.query funciona como antes', async () => {
  const pool = fakePool(); const db = _crear(pool);
  await db.query('SELECT 1', []);
  assert.strictEqual(pool.log[0][0], 'pool');
});
