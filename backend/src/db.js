const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// ============================================================
// db.js — acceso a PostgreSQL con TRANSACCIONES REALES por request
//
// PROBLEMA (auditoría F-03): el código hace
//     await db.query('BEGIN'); ... await db.query('COMMIT');
// pero cada db.query() tomaba una conexión DISTINTA del pool, así que el
// BEGIN, los INSERT/UPDATE y el COMMIT/ROLLBACK corrían en conexiones
// diferentes: no había atomicidad, los "FOR UPDATE" no bloqueaban nada y el
// ROLLBACK no deshacía lo anterior.
//
// SOLUCIÓN: un contexto por request (AsyncLocalStorage). Cuando un handler
// hace db.query('BEGIN'), se le reserva UNA conexión dedicada; todos los
// db.query() siguientes de ESE request (aunque estén en helpers) usan esa
// misma conexión hasta el COMMIT/ROLLBACK, y ahí se libera. Los handlers no
// necesitan cambiar.
//
// Red de seguridad: si el handler termina la respuesta sin COMMIT/ROLLBACK,
// se cierra solo: respuesta < 400 → COMMIT (comportamiento histórico),
// respuesta >= 400 → ROLLBACK. Además hay un watchdog por si el request
// queda colgado con la transacción abierta.
// ============================================================

const TX_RE = /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\s*;?\s*$/i;
const TX_WATCHDOG_MS = 90 * 1000;

function crear(pool) {
  const als = new AsyncLocalStorage();
  const fake = (command) => ({ command, rowCount: null, rows: [], fields: [] });

  function liberar(store, client, err) {
    if (store.timer) { clearTimeout(store.timer); store.timer = null; }
    store.client = null;
    store.depth = 0;
    try { client.removeListener('error', store.onError); } catch (_) { /* nada */ }
    try { client.release(err || undefined); } catch (_) { /* ya liberado */ }
  }

  async function begin(store) {
    if (store.client) { store.depth += 1; return fake('BEGIN'); } // BEGIN anidado: no abre otra
    const client = await pool.connect();
    store.onError = (e) => console.error('❌ [db] error en conexión de transacción:', e.message);
    client.on('error', store.onError);
    try {
      await client.query('BEGIN');
    } catch (e) {
      try { client.removeListener('error', store.onError); } catch (_) { /* nada */ }
      client.release(e);
      throw e;
    }
    store.client = client;
    store.depth = 1;
    store.timer = setTimeout(() => {
      if (store.client !== client) return;
      console.error('⚠️ [db] transacción abierta más de 90s: ROLLBACK automático');
      client.query('ROLLBACK').catch(() => {}).finally(() => { if (store.client === client) liberar(store, client); });
    }, TX_WATCHDOG_MS);
    if (store.timer.unref) store.timer.unref();
    return fake('BEGIN');
  }

  async function commit(store) {
    const client = store.client;
    if (!client) return fake('COMMIT'); // COMMIT sin transacción abierta: no-op
    if (store.depth > 1) { store.depth -= 1; return fake('COMMIT'); }
    try {
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) { /* nada */ }
      liberar(store, client);
      throw e;
    }
    liberar(store, client);
    return fake('COMMIT');
  }

  async function rollback(store) {
    const client = store.client;
    if (!client) return fake('ROLLBACK');
    try {
      await client.query('ROLLBACK');
    } finally {
      liberar(store, client);
    }
    return fake('ROLLBACK');
  }

  async function query(text, params) {
    if (!pool) throw new Error('DATABASE_URL no configurada');
    const store = als.getStore();
    if (!store) return pool.query(text, params); // sin contexto (scripts, tests): comportamiento anterior
    if (typeof text === 'string' && params === undefined) {
      const m = TX_RE.exec(text);
      if (m) {
        const cmd = m[1].toUpperCase();
        if (cmd === 'BEGIN' || cmd.startsWith('START')) return begin(store);
        if (cmd === 'COMMIT' || cmd === 'END') return commit(store);
        return rollback(store);
      }
    }
    return (store.client || pool).query(text, params);
  }

  async function getClient() {
    if (!pool) throw new Error('DATABASE_URL no configurada');
    return pool.connect();
  }

  // Para código nuevo: transacción explícita con su propia conexión.
  //   await db.withTransaction(async (c) => { await c.query(...); ... });
  async function withTransaction(fn) {
    if (!pool) throw new Error('DATABASE_URL no configurada');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(client);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) { /* nada */ }
      throw e;
    } finally {
      client.release();
    }
  }

  // Middleware: abre el contexto del request y cierra transacciones olvidadas.
  function contextMiddleware(req, res, next) {
    const store = { client: null, depth: 0, timer: null, onError: null };
    res.on('finish', async () => {
      const client = store.client;
      if (!client) return;
      const ok = res.statusCode < 400;
      console.warn(`⚠️ [db] ${req.method} ${req.originalUrl.split('?')[0]} terminó (${res.statusCode}) con la transacción abierta → ${ok ? 'COMMIT' : 'ROLLBACK'} automático`);
      try {
        await client.query(ok ? 'COMMIT' : 'ROLLBACK');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) { /* nada */ }
        console.error('❌ [db] cierre automático de transacción falló:', e.message);
      }
      if (store.client === client) liberar(store, client);
    });
    als.run(store, next);
  }

  // Para workers/cron (fuera de un request) que usen BEGIN/COMMIT con db.query.
  function runInContext(fn) {
    return als.run({ client: null, depth: 0, timer: null, onError: null }, fn);
  }

  return { query, getClient, withTransaction, contextMiddleware, runInContext };
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL no está configurada.');
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false } // necesario en Render
    })
  : null;

if (pool) {
  // Sin esto, un corte de conexión en un cliente ocioso tumba el proceso.
  pool.on('error', (e) => console.error('❌ [db] error en pool (cliente ocioso):', e.message));
}

module.exports = { ...crear(pool), _crear: crear };
