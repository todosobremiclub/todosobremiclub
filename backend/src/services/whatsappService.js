// src/services/whatsappService.js
// Envío de plantillas de WhatsApp (Meta Cloud API) + control de cupo mensual por club.
// Mismo nivel que src/config/firebaseAdmin.js (que centraliza el envío de push).
const db = require('../db');

const WA_API_URL = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Convierte un teléfono cargado en socios.telefono a formato E.164 sin '+'
// (mismo criterio que ya usa el frontend en public/js/socios.js -> phoneToWaE164)
function toE164(phone) {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return null;

  d = d.replace(/^0+/, ''); // quita 0 inicial
  d = d.replace(/^15/, ''); // quita 15 si lo pusieron al inicio

  if (d.startsWith('54')) return d;
  return d.length >= 10 ? '549' + d : '54' + d;
}

// ¿El club tiene el add-on de WhatsApp contratado/activo?
async function isWhatsappHabilitado(clubId) {
  const r = await db.query(
    `SELECT whatsapp_habilitado FROM clubs WHERE id = $1`,
    [clubId]
  );
  return r.rowCount ? r.rows[0].whatsapp_habilitado === true : false;
}

// Cupo mensual restante del club (se recalcula al vuelo contando whatsapp_mensajes
// del mes en curso, igual que pago_al_dia se calcula al vuelo en sociosRoutes.js).
async function getCupoRestante(clubId) {
  const rClub = await db.query(
    `SELECT whatsapp_habilitado, whatsapp_limite_mensual FROM clubs WHERE id = $1`,
    [clubId]
  );

  if (!rClub.rowCount || !rClub.rows[0].whatsapp_habilitado) {
    return { habilitado: false, limite: 0, usados: 0, restante: 0 };
  }

  const limite = rClub.rows[0].whatsapp_limite_mensual;

  const rUsados = await db.query(
    `
    SELECT COUNT(*)::int AS usados
    FROM whatsapp_mensajes
    WHERE club_id = $1
      AND created_at >= date_trunc('month', NOW())
    `,
    [clubId]
  );

  const usados = rUsados.rows[0].usados;
  return { habilitado: true, limite, usados, restante: Math.max(0, limite - usados) };
}

// Manda una plantilla de WhatsApp a un teléfono, chequeando primero que el club
// tenga el add-on activo y cupo disponible, y registrando el resultado (éxito o
// error) en whatsapp_mensajes para auditoría + conteo de cupo.
async function enviarPlantillaWhatsapp({
  clubId,
  socioId = null,
  notificacionId = null,
  tipo,           // 'bienvenida' | 'notificacion'
  telefono,
  templateName,
  languageCode = 'es_AR',
  parametros = [] // array de strings, en el orden {{1}}, {{2}}, ...
}) {
  const e164 = toE164(telefono);
  if (!e164) {
    return { ok: false, error: 'Teléfono inválido o vacío' };
  }

  const { habilitado, restante } = await getCupoRestante(clubId);
  if (!habilitado) {
    return { ok: false, error: 'El club no tiene WhatsApp habilitado' };
  }
  if (restante <= 0) {
    return { ok: false, error: 'El club alcanzó su límite mensual de WhatsApp' };
  }

  const body = {
    messaging_product: 'whatsapp',
    to: e164,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: parametros.length
        ? [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: String(p) })) }]
        : []
    }
  };

  try {
    const resp = await fetch(WA_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const json = await resp.json();

    if (!resp.ok) {
      await db.query(
        `INSERT INTO whatsapp_mensajes (club_id, socio_id, notificacion_id, tipo, telefono, template_name, status, error)
         VALUES ($1,$2,$3,$4,$5,$6,'fallido',$7)`,
        [clubId, socioId, notificacionId, tipo, e164, templateName, JSON.stringify(json?.error ?? json)]
      );
      return { ok: false, error: json?.error?.message || 'Error enviando WhatsApp' };
    }

    const waMessageId = json?.messages?.[0]?.id ?? null;

    await db.query(
      `INSERT INTO whatsapp_mensajes (club_id, socio_id, notificacion_id, tipo, telefono, template_name, status, wa_message_id)
       VALUES ($1,$2,$3,$4,$5,$6,'enviado',$7)`,
      [clubId, socioId, notificacionId, tipo, e164, templateName, waMessageId]
    );

    return { ok: true, waMessageId };
  } catch (e) {
    console.error('❌ enviarPlantillaWhatsapp', e);
    await db.query(
      `INSERT INTO whatsapp_mensajes (club_id, socio_id, notificacion_id, tipo, telefono, template_name, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,'fallido',$7)`,
      [clubId, socioId, notificacionId, tipo, e164, templateName, e.message]
    );
    return { ok: false, error: e.message };
  }
}

module.exports = { enviarPlantillaWhatsapp, getCupoRestante, isWhatsappHabilitado, toE164 };
