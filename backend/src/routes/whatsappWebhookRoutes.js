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
      await db.query(
        `UPDATE whatsapp_mensajes SET status = $1 WHERE wa_message_id = $2`,
        [estado, s.id]
      );
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('❌ whatsapp webhook', e);
    res.sendStatus(200); // siempre 200, para que Meta no reintente indefinidamente
  }
});

module.exports = router;
