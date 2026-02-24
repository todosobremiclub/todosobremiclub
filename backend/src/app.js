const express = require('express');
const app = express();

app.use(express.json());

// ✅ SERVIR FRONTEND
app.use(express.static('public'));

// ===== ROUTES =====
const authRoutes = require('./routes/authRoutes');
const adminClubsRoutes = require('./routes/adminClubsRoutes');
const adminUsersRoutes = require('./routes/adminUsersRoutes');
const configuracionRoutes = require('./routes/configuracionRoutes');

// ===== API =====
app.use('/auth', authRoutes);
app.use('/admin/clubs', adminClubsRoutes);
app.use('/admin/users', adminUsersRoutes);
app.use('/club', require('./routes/clubRoutes'));
app.use('/club', require('./routes/sociosRoutes'));
app.use('/club', configuracionRoutes);

// ===== HEALTH =====
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on ${PORT}`));
