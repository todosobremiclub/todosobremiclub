const express = require('express');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const jwt = require('jsonwebtoken');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const crypto = require('crypto');

const router = express.Router();

// =============================
// Impersonación (Super Admin)
// =============================
function signImpersonationToken(payload) {
  const secret = process.env.JWT_SECRET || process.env.SECRET || process.env.JWT_KEY;
  if (!secret) {
    throw new Error('Falta JWT_SECRET (o SECRET/JWT_KEY) en variables de entorno');
  }

  // Token corto: evita riesgos si se filtra.
  // Ajustalo si querés (ej: 30m).
  return jwt.sign(payload, secret, { expiresIn: '15m' });
}

// =============================
// Estado del club (Super Admin)
// =============================
const CLUB_ESTADOS = ['productivo', 'avanzado', 'pendiente', 'sin_respuesta', 'baja'];

function normalizeClubEstado(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 'pendiente';
  if (s === 'sin respuesta') return 'sin_respuesta';
  if (s === 'bajo') return 'baja';
  if (CLUB_ESTADOS.includes(s)) return s;
  return 'pendiente';
}

function toBool(v, def = false) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'si' || s === 'sí') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return def;
}

// ✅ NUEVO: modo de pago del club (reemplaza al viejo checkbox único de
// "transferencia_habilitada"). 'ambos' habilita a la vez el botón de
// Mercado Pago y el de informar transferencia en la app del socio.
const PAYMENT_MODES = ['ninguno', 'transferencia_manual', 'mercadopago_auto', 'ambos'];

// ✅ NUEVO: true para los modos que dejan al socio informar una transferencia
// (transferencia_manual y ambos) — se usa para mantener en sync la columna
// vieja transferencia_habilitada.
function modeIncludesTransferencia(mode) {
  return mode === 'transferencia_manual' || mode === 'ambos';
}

// ✅ NUEVO: true para los modos que requieren que el club ya haya conectado
// su cuenta de Mercado Pago (mercadopago_auto y ambos).
function modeIncludesMercadoPago(mode) {
  return mode === 'mercadopago_auto' || mode === 'ambos';
}

function normalizePaymentMode(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return PAYMENT_MODES.includes(s) ? s : null;
}


// =============================
// Multer en memoria (multipart)
// =============================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// ================== LISTAR ==================
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(`
  SELECT
  id,
  name,
  address,
  city,
  province,
  contact_name,
  contact_phone,
  instagram_url,
  socios_cantidad,
  valor_mensual,
  estado,
  payment_due_day,
  mp_habilitado,
  mp_connected,
  payment_mode,

  transferencia_habilitada,
  transferencia_cvu,
  transferencia_alias,
  transferencia_titular,

  whatsapp_habilitado,      -- ✅ NUEVO
  whatsapp_limite_mensual,  -- ✅ NUEVO

  (
    SELECT COUNT(*)
    FROM socios s
    WHERE s.club_id = clubs.id
  ) AS socios_activos,

  -- ✅ NUEVO: mensajes de WhatsApp (bienvenidas + notificaciones) ya usados
  -- este mes calendario, mismo criterio que getCupoRestante() en
  -- src/services/whatsappService.js (cuenta whatsapp_mensajes desde el
  -- primer día del mes en curso, incluye tanto los 'enviado' como los
  -- 'fallido' porque un intento fallido también consume cupo).
  (
    SELECT COUNT(*)
    FROM whatsapp_mensajes wm
    WHERE wm.club_id = clubs.id
      AND wm.created_at >= date_trunc('month', NOW())
  ) AS whatsapp_usados_mes,

  logo_url,
  background_url,
  color_primary,
  color_secondary,
  color_accent,
  apply_token,
  created_at
FROM clubs
ORDER BY created_at DESC
`);

    res.json({ ok: true, clubs: r.rows });
  } catch (err) {
    console.error('❌ admin clubs list:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ================== CREAR ==================
router.post(
  '/',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([{ name: 'logo' }, { name: 'background' }]),
  async (req, res) => {
    try {
      const {
        name,
        address,
        city,
        province,
        contact_name,
        contact_phone,
        instagram_url,
        socios_cantidad,
        valor_mensual,
        payment_due_day,
        estado,
        color_primary,
        color_secondary,
        color_accent,
        mp_habilitado,
        payment_mode
      } = req.body ?? {};

      if (!name?.trim()) {
        return res.status(400).json({ ok: false, error: 'Falta name' });
      }

      // ✅ NUEVO: un club recién creado nunca puede arrancar con Mercado Pago
      // habilitado porque todavía no conectó ninguna cuenta (mp_connected =
      // false). Si mandan 'mercadopago_auto' lo bajamos a 'ninguno'; si
      // mandan 'ambos' lo bajamos a 'transferencia_manual' (esa mitad sí se
      // puede usar desde el alta, sin esperar a conectar Mercado Pago).
      let paymentModeFinal = normalizePaymentMode(payment_mode) || 'ninguno';
      if (paymentModeFinal === 'mercadopago_auto') paymentModeFinal = 'ninguno';
      if (paymentModeFinal === 'ambos') paymentModeFinal = 'transferencia_manual';

      let logo_url = null;
      let background_url = null;

      if (req.files?.logo?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.logo[0].buffer,
          mimetype: req.files.logo[0].mimetype,
          originalname: req.files.logo[0].originalname,
          folder: 'clubs/logo'
        });
        logo_url = up.url;
      }

      if (req.files?.background?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.background[0].buffer,
          mimetype: req.files.background[0].mimetype,
          originalname: req.files.background[0].originalname,
          folder: 'clubs/background'
        });
        background_url = up.url;
      }

      // ✅ Token para QR de postulación
      const apply_token = crypto.randomBytes(16).toString('hex');

      const r = await db.query(
        `
        
INSERT INTO clubs (
 name,
 address,
 city,
 province,
 contact_name,
 contact_phone,
 instagram_url,
 socios_cantidad,
 valor_mensual,
 payment_due_day,
 estado,
 mp_habilitado,
 payment_mode,
 transferencia_habilitada,
 logo_url,
 background_url,
 color_primary,
 color_secondary,
 color_accent,
 apply_token
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
RETURNING *

        `,
        [
 name.trim(),
 address ?? null,
 city ?? null,
 province ?? null,
 contact_name ?? null,
 contact_phone ?? null,
 instagram_url ?? null,
 socios_cantidad ? Number(socios_cantidad) : null,
 valor_mensual ? Number(valor_mensual) : null,
 payment_due_day ? Number(payment_due_day) : 31,
 normalizeClubEstado(estado),
 toBool(mp_habilitado, false),
 paymentModeFinal,
 modeIncludesTransferencia(paymentModeFinal), // ✅ mantiene transferencia_habilitada en sync
 logo_url,
 background_url,
 color_primary ?? '#2563eb',
 color_secondary ?? '#1e40af',
 color_accent ?? '#facc15',
 apply_token
]
      );

      res.json({ ok: true, club: r.rows[0] });
    } catch (err) {
      console.error('❌ admin clubs create:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ================== EDITAR ==================
router.put(
  '/:id',
  requireAuth,
  requireRole('superadmin'),
  upload.fields([{ name: 'logo' }, { name: 'background' }]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
 name,
 address,
 city,
 province,
 contact_name,
 contact_phone,
 instagram_url,
 socios_cantidad,
 valor_mensual,
 payment_due_day,
 estado,
 color_primary,
 color_secondary,
 color_accent,
 mp_habilitado,
 payment_mode,              // ✅ NUEVO
 whatsapp_habilitado,      // ✅ NUEVO
 whatsapp_limite_mensual   // ✅ NUEVO
} = req.body ?? {};

      if (!name?.trim()) {
        return res.status(400).json({ ok: false, error: 'Falta name' });
      }

      const current = await db.query(
        `SELECT logo_url, background_url, mp_connected FROM clubs WHERE id=$1`,
        [id]
      );
      if (!current.rowCount) {
        return res.status(404).json({ ok: false, error: 'Club no encontrado' });
      }

      let logo_url = current.rows[0].logo_url;
      let background_url = current.rows[0].background_url;

      // ✅ NUEVO: validar el modo de pago elegido.
      // 'mercadopago_auto' y 'ambos' solo se pueden activar si el club ya
      // conectó su cuenta de Mercado Pago (mp_connected = true); si no, se
      // rechaza para evitar que quede seleccionado un modo que la app no
      // puede ofrecer.
      const paymentModeNorm = normalizePaymentMode(payment_mode);
      if (payment_mode !== undefined && payment_mode !== null && payment_mode !== '' && !paymentModeNorm) {
        return res.status(400).json({ ok: false, error: 'payment_mode inválido' });
      }
      if (modeIncludesMercadoPago(paymentModeNorm) && !current.rows[0].mp_connected) {
        return res.status(400).json({
          ok: false,
          error: 'Este club todavía no conectó su cuenta de Mercado Pago. Conectala antes de habilitar el pago automático.'
        });
      }
      // Si se especifica payment_mode, transferencia_habilitada se deriva de
      // él (queda en sync); si no se manda payment_mode, se respeta el
      // comportamiento anterior (el valor que venga en el body, o sin cambios).
      const transferenciaHabilitadaFinal = paymentModeNorm
        ? modeIncludesTransferencia(paymentModeNorm)
        : toBool(req.body?.transferencia_habilitada, null);

      if (req.files?.logo?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.logo[0].buffer,
          mimetype: req.files.logo[0].mimetype,
          originalname: req.files.logo[0].originalname,
          folder: 'clubs/logo'
        });
        logo_url = up.url;
      }

      if (req.files?.background?.[0]) {
        const up = await uploadImageBuffer({
          buffer: req.files.background[0].buffer,
          mimetype: req.files.background[0].mimetype,
          originalname: req.files.background[0].originalname,
          folder: 'clubs/background'
        });
        background_url = up.url;
      }

      const r = await db.query(
  `
UPDATE clubs
SET
  name = $1,
  address = $2,
  city = $3,
  province = $4,
  contact_name = $5,
  contact_phone = $6,
  instagram_url = $7,
  socios_cantidad = $8,
  valor_mensual = $9,
  estado = COALESCE($10::text, estado),
  mp_habilitado = COALESCE($11::boolean, mp_habilitado),
  transferencia_habilitada = COALESCE($12::boolean, transferencia_habilitada),
  payment_mode = COALESCE($22::text, payment_mode),
  logo_url = COALESCE($13::text, logo_url),
  background_url = COALESCE($14::text, background_url),
  color_primary = COALESCE($15::text, color_primary),
  color_secondary = COALESCE($16::text, color_secondary),
  color_accent = COALESCE($17::text, color_accent),
  payment_due_day = COALESCE($18::int, payment_due_day),
  whatsapp_habilitado = COALESCE($19::boolean, whatsapp_habilitado),
  whatsapp_limite_mensual = COALESCE($20::int, whatsapp_limite_mensual)
WHERE id = $21::uuid
RETURNING *
  `,
  [
  name.trim(),
  address ?? null,
  city ?? null,
  province ?? null,
  contact_name ?? null,
  contact_phone ?? null,
  instagram_url ?? null,
  socios_cantidad ? Number(socios_cantidad) : null,
  valor_mensual ? Number(valor_mensual) : null,
  normalizeClubEstado(estado) ?? null,
  toBool(mp_habilitado, null),
  transferenciaHabilitadaFinal,
  logo_url ?? null,
  background_url ?? null,
  color_primary ?? null,
  color_secondary ?? null,
  color_accent ?? null,
  payment_due_day ? Number(payment_due_day) : null,
  toBool(whatsapp_habilitado, null),
  whatsapp_limite_mensual ? Number(whatsapp_limite_mensual) : null,
  id,
  paymentModeNorm
]
);

      res.json({ ok: true, club: r.rows[0] });
    } catch (err) {
      console.error('❌ admin clubs update:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ================== COMENTARIOS DEL CLUB ==================

// Listar comentarios
router.get('/:id/comments', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;

    const r = await db.query(
      `
      SELECT id, club_id, comment, created_at
      FROM club_comments
      WHERE club_id = $1
      ORDER BY created_at DESC
      `,
      [id]
    );

    res.json({ ok: true, comments: r.rows });
  } catch (err) {
    console.error('❌ get club comments:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Agregar comentario
router.post('/:id/comments', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body ?? {};

    if (!comment?.trim()) {
      return res.status(400).json({ ok: false, error: 'Comentario vacío' });
    }

    const r = await db.query(
      `
      INSERT INTO club_comments (club_id, comment)
      VALUES ($1, $2)
      RETURNING id, club_id, comment, created_at
      `,
      [id, comment.trim()]
    );

    res.json({ ok: true, comment: r.rows[0] });
  } catch (err) {
    console.error('❌ add club comment:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ================== IMPERSONAR (SOLO LECTURA) ==================
// POST /admin/clubs/:id/impersonate
// body: { role: 'solo_lectura' } (por ahora solo permitimos ese)
// Devuelve: { ok:true, token, expires_in:'15m' }
router.post('/:id/impersonate', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const roleReq = String(req.body?.role ?? 'solo_lectura').toLowerCase();

    // Por seguridad: solo permitimos este rol en impersonación
    if (roleReq !== 'solo_lectura') {
      return res.status(400).json({ ok: false, error: 'Rol no permitido para impersonación' });
    }

    // Verificar club existe (y obtener name para mostrar en UI)
    const rClub = await db.query(`SELECT id, name FROM clubs WHERE id = $1 LIMIT 1`, [id]);
    if (!rClub.rowCount) {
      return res.status(404).json({ ok: false, error: 'Club no encontrado' });
    }
    const club = rClub.rows[0];

    // Payload del token impersonado:
    // - Importante: roles SOLO con el club y role solicitado
    // - Marcamos flags para banner y auditoría
    const payload = {
      id: req.user?.id,                 // mantenemos el id real
      email: req.user?.email,           // opcional (si existe en req.user)
      impersonated: true,
      impersonated_by: req.user?.id,
      roles: [{
        club_id: club.id,
        club_name: club.name,
        role: 'solo_lectura'
      }]
    };

    const token = signImpersonationToken(payload);
    return res.json({ ok: true, token, expires_in: '15m', club: { id: club.id, name: club.name } });
  } catch (err) {
    console.error('❌ impersonate club:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ================== ACTIVAR / DESACTIVAR ==================
router.patch('/:id/active', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body || {};

  try {
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'is_active debe ser boolean' });
    }

    const r = await db.query(
      `UPDATE clubs SET is_active=$1 WHERE id=$2 RETURNING id, name, is_active`,
      [is_active, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Club no encontrado' });
    }

    res.json({ ok: true, club: r.rows[0] });
  } catch (e) {
    console.error('❌ toggle club active', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== ELIMINAR ==================
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;

try {
    await db.query('BEGIN');

    // 1) Tablas que dependen de otra tabla hija (deben irse primero que su padre)
    await db.query(
      `DELETE FROM transferencias_pago
       WHERE pago_mensual_id IN (SELECT id FROM pagos_mensuales WHERE club_id=$1)`,
      [id]
    );
    await db.query(
      `DELETE FROM asistencia_detalle
       WHERE socio_id IN (SELECT id FROM socios WHERE club_id=$1)
          OR evento_id IN (SELECT id FROM asistencia_eventos WHERE club_id=$1)`,
      [id]
    );
    await db.query(
      `DELETE FROM grupos_familiares_miembros
       WHERE grupo_familiar_id IN (SELECT id FROM grupos_familiares WHERE club_id=$1)
          OR socio_id IN (SELECT id FROM socios WHERE club_id=$1)`,
      [id]
    );

    // 2) Ahora sí, tablas que ya no tienen hijos pendientes
    await db.query('DELETE FROM asistencia_eventos WHERE club_id=$1', [id]);
    await db.query('DELETE FROM grupos_familiares WHERE club_id=$1', [id]);
    await db.query('DELETE FROM socios_adjuntos WHERE club_id=$1', [id]);
    await db.query('DELETE FROM socios_comentarios WHERE club_id=$1', [id]);

    // 3) Tablas sin FK real hacia clubs, pero con club_id (limpieza, no rompen el DELETE)
    await db.query('DELETE FROM pagos_mensuales WHERE club_id=$1', [id]);
    await db.query('DELETE FROM gastos WHERE club_id=$1', [id]);
    await db.query('DELETE FROM ingresos_generales WHERE club_id=$1', [id]);
    await db.query('DELETE FROM categorias_deportivas WHERE club_id=$1', [id]);
    await db.query('DELETE FROM tipos_gasto WHERE club_id=$1', [id]);
    await db.query('DELETE FROM tipos_ingreso WHERE club_id=$1', [id]);

    // 4) Resto de hijos directos de clubs
    await db.query('DELETE FROM cuotas_mensuales WHERE club_id=$1', [id]);
    await db.query('DELETE FROM responsables_gasto WHERE club_id=$1', [id]);
    await db.query('DELETE FROM actividades WHERE club_id=$1', [id]);
    await db.query('DELETE FROM noticias WHERE club_id=$1', [id]);
    await db.query('DELETE FROM notificaciones WHERE club_id=$1', [id]);
    await db.query('DELETE FROM club_comments WHERE club_id=$1', [id]);

    // 5) socios (después de TODO lo que dependía de socio_id)
    await db.query('DELETE FROM socios WHERE club_id=$1', [id]);

    // 6) excepciones_cuota: recién ahora, porque "socios" tenía FK hacia esta tabla
    await db.query('DELETE FROM excepciones_cuota WHERE club_id=$1', [id]);

    // 7) contadores / auxiliares
    await db.query('DELETE FROM club_counters WHERE club_id=$1', [id]);

    // 8) relación usuarios↔club
    await db.query('DELETE FROM user_clubs WHERE club_id=$1', [id]);

    // 9) por último, el club
    await db.query('DELETE FROM clubs WHERE id=$1', [id]);

    await db.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ admin clubs delete:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ================== DESCONECTAR MERCADO PAGO ==================
router.post(
  '/:id/mp/disconnect',
  requireAuth,
  requireRole('superadmin'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const r = await db.query(
        `
        UPDATE clubs
        SET
          mp_connected = false,
          mp_habilitado = false,
          mp_access_token = NULL,
          mp_refresh_token = NULL,
          mp_user_id = NULL,
          mp_expires_at = NULL,
          -- ✅ NUEVO: si el club estaba en un modo que incluye Mercado Pago y
          -- se desconecta la cuenta, no puede seguir ofreciéndolo (la app
          -- dejaría de tener con qué generar el link de pago).
          -- 'mercadopago_auto' (solo MP) -> 'ninguno'.
          -- 'ambos' (MP + transferencia) -> 'transferencia_manual' (conserva
          -- la mitad de transferencia, que no depende de Mercado Pago).
          payment_mode = CASE
            WHEN payment_mode = 'mercadopago_auto' THEN 'ninguno'
            WHEN payment_mode = 'ambos' THEN 'transferencia_manual'
            ELSE payment_mode
          END
        WHERE id = $1
        RETURNING id, name
        `,
        [id]
      );

      if (!r.rowCount) {
        return res.status(404).json({ ok: false, error: 'Club no encontrado' });
      }

      return res.json({
        ok: true,
        message: 'Mercado Pago desconectado correctamente',
        club: r.rows[0]
      });
    } catch (err) {
      console.error('❌ disconnect MP:', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  }
);

// ================== LINK PÚBLICO PARA QUE EL CLUB CONECTE SU MERCADO PAGO ==================
// GET /admin/clubs/:id/mp/public-link
// Arma (y si hace falta genera) el link que se le manda al club para que
// sea EL CLUB, logueado con SU PROPIA cuenta de Mercado Pago, quien haga la
// conexión desde su navegador — sin pasar por el panel de superadmin y sin
// que el superadmin tenga que loguearse con la cuenta de MP del club.
// Reutiliza GET /mp/public/connect/:clubId?token=... (ya existente en
// mercadoPagoRoutes.js) y el mismo apply_token que usa el QR de postulación.
router.get(
  '/:id/mp/public-link',
  requireAuth,
  requireRole('superadmin'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const r = await db.query(
        `SELECT id, name, apply_token FROM clubs WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!r.rowCount) {
        return res.status(404).json({ ok: false, error: 'Club no encontrado' });
      }

      let applyToken = r.rows[0].apply_token;

      // Clubes creados antes de que existiera apply_token no tienen uno:
      // se lo generamos y guardamos recién acá, así el link nunca falla.
      if (!applyToken) {
        applyToken = crypto.randomBytes(16).toString('hex');
        await db.query(`UPDATE clubs SET apply_token = $2 WHERE id = $1`, [id, applyToken]);
      }

      if (!process.env.PUBLIC_BASE_URL) {
        return res.status(500).json({ ok: false, error: 'Falta configurar PUBLIC_BASE_URL en el servidor' });
      }

      const url = `${process.env.PUBLIC_BASE_URL}/mp/public/connect/${id}?token=${applyToken}`;

      return res.json({ ok: true, url });
    } catch (err) {
      console.error('❌ mp public-link:', err);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  }
);

module.exports = router;
