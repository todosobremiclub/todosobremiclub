const express = require('express');
const app = express();

// ⬆️ Aumentamos el límite del body para poder enviar fotos en base64 (por ejemplo 5 MB)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const path = require('path');
const nodemailer = require('nodemailer');

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
const mercadoPagoRoutes = require('./routes/mercadoPagoRoutes');




app.post("/api/demo-request", async (req, res) => {
  try {
    const { nombre, club, socios, telefono } = req.body;

    if (!nombre || !club || !socios || !telefono) {
      return res.status(400).json({ ok: false, message: "Datos incompletos" });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"TSMC Web" <${process.env.MAIL_USER}>`,
      to: "todosobremiclub@gmail.com",
      subject: "Solicitud de instancia de prueba – TSMC",
      text: `
Nueva solicitud de instancia de prueba:

Nombre y Apellido: ${nombre}
Club: ${club}
Cantidad de socios: ${socios}
Teléfono: ${telefono}
      `
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("Error enviando mail:", error);
    res.status(500).json({ ok: false });
  }
});

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

app.use('/mp', mercadoPagoRoutes);



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