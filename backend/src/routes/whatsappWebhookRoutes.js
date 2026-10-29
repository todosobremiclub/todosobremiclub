// src/routes/whatsappWebhookRoutes.js
// Webhook de Meta para WhatsApp: verificación inicial (GET) + estados de entrega
// de cada mensaje enviado (POST): sent -> delivered -> read, o failed.
const express = require('express');
const router = express.Router();
const db = require('../db');

// Verificación (Meta la llama una vez al configurar el webhook en su panel)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Estados de entrega de cada mensaje enviado
router.post('/', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const statuses = entry?.changes?.[0]?.value?.statuses ?? [];

    for (const s of statuses) {
      const estado = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' }[s.status] || s.status;

      // ✅ NUEVO: si Meta informa un fallo, guardamos el motivo (código y mensaje)
      // para poder ver por qué un socio no recibió el WhatsApp.
      const motivo = estado === 'fallido' && s.errors ? JSON.stringify(s.errors).slice(0, 1000) : null;

      // ✅ NUEVO: los estados pueden llegar desordenados (ej: "enviado" después de
      // "leído"); solo se avanza (enviado -> entregado -> leído). "fallido" siempre se registra.
      await db.query(
        `UPDATE whatsapp_mensajes
         SET status = $1::text,
             error = CASE WHEN $1::text = 'fallido' THEN COALESCE($3::text, error) ELSE error END
         WHERE wa_message_id = $2
           AND (
             $1::text = 'fallido'
             OR (CASE status WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2 WHEN 'leido' THEN 3 ELSE 0 END)
              < (CASE $1::text WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2 WHEN 'leido' THEN 3 ELSE 0 END)
           )`,
        [estado, s.id, motivo]
      );
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('❌ whatsapp webhook', e);
    res.sendStatus(200); // siempre 200, para que Meta no reintente indefinidamente
  }
});

module.exports = router;
