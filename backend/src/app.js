const express = require('express');
const app = express();

// ✅ SEGURIDAD: detrás del proxy de Render, la IP real del cliente viene en
// X-Forwarded-For. Con "trust proxy" Express la usa en req.ip (la necesita el límite
// de intentos). TRUST_PROXY_HOPS = cuántos proxies hay delante de la app (Render = 1;
// si algún día se pone Cloudflare adelante, pasar a 2).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.disable('x-powered-by');

const { crearLimitador } = require('./middleware/rateLimit');
// Formulario "pedí una demo" (público, manda un mail): 5 pedidos por hora por IP.
const limitarDemo = crearLimitador({
  nombre: 'demo-request',
  ventanaMs: 60 * 60 * 1000,
  max: 5,
  mensaje: 'Ya recibimos varias solicitudes desde tu conexión. Probá de nuevo en un rato.'
});

// ⬆️ Aumentamos el límite del body para poder enviar fotos en base64 (por ejemplo 5 MB)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// 🔒 Seguridad (F-03): contexto de base de datos por request. Hace que
// db.query('BEGIN') ... COMMIT/ROLLBACK use UNA conexión dedicada (transacciones
// reales). Tiene que ir DESPUÉS de los parsers y ANTES de las rutas. Ver src/db.js.
app.use(require('./db').contextMiddleware);

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

// ✅ NUEVO: log de auditoría (ingresos + acciones de los admins). El
// middleware se monta ANTES de los routers de /club, /admin/clubs y
// /admin/users para que registre (best-effort) cada acción de escritura
// (POST/PUT/PATCH/DELETE) que pasa por esos módulos — ver
// src/middleware/auditLogMiddleware.js. No audita /app (API de la app de
// socios), /mp (Mercado Pago) ni /public.
const auditLogMiddleware = require('./middleware/auditLogMiddleware');




app.post("/api/demo-request", limitarDemo, async (req, res) => {
  try {
    // ✅ SEGURIDAD: se limpian los textos (sin saltos de línea ni caracteres de control)
    // y se acota el largo, para que no se pueda armar un mail a medida.
    const limpiar = (v, max = 120) =>
      String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    const nombre = limpiar(req.body?.nombre);
    const club = limpiar(req.body?.club);
    const socios = limpiar(req.body?.socios, 30);
    const telefono = limpiar(req.body?.telefono, 40);

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

app.use('/admin/clubs', auditLogMiddleware);
app.use('/admin/clubs', adminClubsRoutes);

app.use('/admin/users', auditLogMiddleware);
app.use('/admin/users', adminUsersRoutes);

// ✅ NUEVO: pantalla de "Log de actividad" en el panel Super Admin.
app.use('/admin/audit-log', require('./routes/auditLogRoutes'));

app.use('/club', auditLogMiddleware);

// ✅ NUEVO (seguridad): política de ESCRITURA por rol para todo /club/:clubId/...
// (solo_lectura no puede modificar nada; finanzas/comunicación/profesor/asistencias
// solo sus secciones). Ver src/middleware/clubWritePolicy.js.
// ROLE_POLICY_MODE=log la pone en modo de prueba (solo registra, no bloquea).
app.use('/club/:clubId', require('./middleware/clubWritePolicy'));

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
app.use('/club', require('./routes/tiendaRoutes')); // ✅ NUEVO: Tienda Online (productos + reservas, panel admin)
app.use('/club', require('./routes/espaciosRoutes')); // ✅ NUEVO: Espacios y Clases (recursos, disponibilidad, turnos; panel admin)
app.use('/club', require('./routes/informeMensualRoutes')); // ✅ NUEVO: Informe mensual de uso de la plataforma (panel)

app.use('/app', appTransferRoutes);
// 🔒 Seguridad (F-01): /admin/payments/transfer/* quedó DESACTIVADO. No verificaba el club
// (un admin de un club podía operar transferencias de otros). Panel y app usan
// /club/:clubId/payments/transfer/* (clubPaymentsTransferRoutes), que sí valida el club.
// app.use('/admin', adminTransferRoutes);
app.use('/club', clubPaymentsTransferRoutes);



// ✅ NUEVO
app.use('/club', require('./routes/notificacionesRoutes'));

app.use('/public', require('./routes/publicApplyRoutes'));
app.use('/club', require('./routes/pendientesRoutes'));
app.use('/club', require('./routes/asistenciaRoutes'));
app.use('/app', require('./routes/espaciosAppRoutes')); // ✅ NUEVO: Espacios y Clases (API de la app del socio)
app.use('/app', require('./routes/clasesAppRoutes')); // ✅ NUEVO: Clases / entrenamientos de la Agenda (app del socio)
app.use('/app', require('./routes/appRoutes'));

// ✅ NUEVO: Mercado Pago (OAuth por club, webhook, y generación del link de pago)
app.use('/mp', require('./routes/mercadoPagoRoutes'));

// ✅ NUEVO: webhook de Meta para WhatsApp (verificación + estados de entrega)
app.use('/webhooks/whatsapp', require('./routes/whatsappWebhookRoutes'));

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

// ✅ NUEVO: worker de notificaciones programadas (envío único en una fecha
// puntual, o recurrente todos los meses en un día fijo). Revisa cada 5
// minutos si hay alguna cuya próxima ejecución ya llegó, y la manda.
const { procesarNotificacionesProgramadas } = require('./services/notificacionesProgramadasWorker');
const CHEQUEO_NOTIF_PROGRAMADAS_MS = 5 * 60 * 1000; // cada 5 minutos
setInterval(() => {
  procesarNotificacionesProgramadas();
}, CHEQUEO_NOTIF_PROGRAMADAS_MS);

// ✅ NUEVO: worker de vencimiento de reservas de Espacios. Cada 5 minutos pasa
// a 'vencida' toda solicitud pendiente cuyo turno ya empezó (ver
// src/services/espaciosVencimientoWorker.js).
const { procesarVencimientosEspacios } = require('./services/espaciosVencimientoWorker');
const CHEQUEO_VENCIMIENTO_ESPACIOS_MS = 5 * 60 * 1000; // cada 5 minutos
setInterval(() => {
  procesarVencimientosEspacios();
}, CHEQUEO_VENCIMIENTO_ESPACIOS_MS);

// ✅ NUEVO: worker de categorías por edad. Corre al iniciar y después cada hora:
// pasa a cada socio a la categoría que le corresponde por su edad (solo si el
// club configuró rangos de edad y el socio no la tiene "a mano").
// Ver src/services/categoriasEdadWorker.js.
const { procesarCategoriasPorEdad } = require('./services/categoriasEdadWorker');
const CHEQUEO_CATEGORIAS_EDAD_MS = 60 * 60 * 1000; // cada 1 hora
procesarCategoriasPorEdad();
setInterval(procesarCategoriasPorEdad, CHEQUEO_CATEGORIAS_EDAD_MS);

// ✅ NUEVO: worker de retención del log de auditoría (admin_activity_log).
// Corre una vez al iniciar el server y después cada 24hs, borrando lo que
// tenga más de 3 meses de antigüedad (ver src/services/auditLogPurgeWorker.js).
const { purgarAuditLogAntiguo } = require('./services/auditLogPurgeWorker');
const PURGA_AUDIT_LOG_MS = 24 * 60 * 60 * 1000; // cada 24 horas
purgarAuditLogAntiguo();
setInterval(purgarAuditLogAntiguo, PURGA_AUDIT_LOG_MS);

// ✅ NUEVO: worker del informe mensual. Corre al iniciar y después cada hora:
// genera el informe del mes anterior para los clubes productivos que todavía
// no lo tienen (si ya existe, no hace nada). Ver src/services/informeMensualService.js.
// Requiere la tabla informes_mensuales (migración SQL); si no existe, no hace nada.
const { procesarInformesMensuales } = require('./services/informeMensualService');
const CHEQUEO_INFORME_MENSUAL_MS = 60 * 60 * 1000; // cada 1 hora
procesarInformesMensuales();
setInterval(procesarInformesMensuales, CHEQUEO_INFORME_MENSUAL_MS);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on ${PORT}`));