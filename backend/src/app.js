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
const appTransferRoutes = require('./routes/appTransferRoutes');
const adminTransferRoutes = require('./routes/adminTransferRoutes');
const clubPaymentsTransferRoutes = require('./routes/clubPaymentsTransferRoutes');




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

// ✅ Guardamos la referencia (antes se pasaba directo al require) para poder
// llamar a procesarBienvenidasPendientes() desde el setInterval de más abajo
const sociosRoutes = require('./routes/sociosRoutes');
app.use('/club', sociosRoutes);

app.use('/club', configuracionRoutes);
app.use('/club', require('./routes/gastosRoutes'));
app.use('/club', require('./routes/cumplesRoutes'));
app.use('/club', require('./routes/pagosRoutes'));
app.use('/club', require('./routes/reportesRoutes'));
app.use('/club', require('./routes/noticiasRoutes'));

app.use('/app', appTransferRoutes);
app.use('/admin', adminTransferRoutes);
app.use('/club', clubPaymentsTransferRoutes);



// ✅ NUEVO
app.use('/club', require('./routes/notificacionesRoutes'));

app.use('/public', require('./routes/publicApplyRoutes'));
app.use('/club', require('./routes/pendientesRoutes'));
app.use('/club', require('./routes/asistenciaRoutes'));
app.use('/app', require('./routes/appRoutes'));

// ===== HEALTH =====
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ✅ NUEVO: worker de envío de bienvenidas por lotes.
// Revisa cada 5 minutos si hay envíos programados cuya hora ya llegó, y los manda.
// (El tamaño de lote y el intervalo entre lotes se configuran en sociosRoutes.js
// con las variables de entorno BIENVENIDA_LOTE_SIZE y BIENVENIDA_LOTE_INTERVALO_MIN)
const CHEQUEO_BIENVENIDA_MS = 5 * 60 * 1000; // cada 5 minutos
setInterval(() => {
  sociosRoutes.procesarBienvenidasPendientes();
}, CHEQUEO_BIENVENIDA_MS);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on ${PORT}`));