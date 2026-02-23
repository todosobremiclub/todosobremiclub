const { Pool } = require('pg');

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

async function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL no configurada');
  return pool.query(text, params);
}

module.exports = { query };