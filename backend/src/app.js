const express = require('express');
const app = express();

// ⬆️ Aumentamos el límite del body para poder enviar fotos en base64 (por ejemplo 5 MB)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const path = require('path');

// ✅ SERVIR FRONTEND (path absoluto)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ✅ Redirigir raíz al login admin
app.get('/', (_req, res) => {
  res.redirect('/admin.html');
});

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
app.use('/club', require('./routes/gastosRoutes'));
app.use('/club', require('./routes/cumplesRoutes'));
app.use('/club', require('./routes/pagosRoutes'));
app.use('/club', require('./routes/reportesRoutes'));
app.use('/club', require('./routes/noticiasRoutes'));

// ✅ NUEVO
app.use('/club', require('./routes/notificacionesRoutes'));

app.use('/public', require('./routes/publicApplyRoutes'));
app.use('/club', require('./routes/pendientesRoutes'));
app.use('/app', require('./routes/appRoutes'));

// ===== HEALTH =====
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on ${PORT}`));