const express = require('express');
const app = express();

app.use(express.json());

const db = require('./db');

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'todosobremiclub-backend' });
});

app.get('/db-health', async (_req, res) => {
  try {
    const r = await db.query('SELECT 1 AS ok');
    res.json({ ok: true, db: r.rows[0] });
  } catch (err) {
    console.error('❌ DB health error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
