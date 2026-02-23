const express = require('express');
const app = express();

app.use(express.json());

const authRoutes = require('./routes/authRoutes');
const adminClubsRoutes = require('./routes/adminClubsRoutes');
const adminUsersRoutes = require('./routes/adminUsersRoutes');


// health actual
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'todosobremiclub-backend' });
});

// db-health (si lo tenés)
const db = require('./db');
app.get('/db-health', async (_req, res) => {
  try {
    const r = await db.query('SELECT 1 AS ok');
    res.json({ ok: true, db: r.rows[0] });
  } catch (err) {
    console.error('❌ DB health error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ NUEVO: Auth
app.use('/auth', authRoutes);
app.use('/admin/clubs', adminClubsRoutes);
app.use('/admin/users', adminUsersRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
