const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

/**
 * Crear preferencia de Mercado Pago (Checkout Pro)
 * POST /app/payments/mercadopago/preference
 */
router.post('/payments/mercadopago/preference', requireAuth, async (req, res) => {
  try {
    const { club_id, concepto, monto } = req.body || {};

    if (!club_id || monto == null) {
      return res.status(400).json({
        ok: false,
        error: 'club_id y monto son obligatorios'
      });
    }

    // 1) Obtener token del club
    const rClub = await db.query(
      `SELECT name, mp_connected, mp_access_token
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
      [club_id]
    );

    if (!rClub.rowCount) {
      return res.status(404).json({ ok: false, error: 'Club no encontrado' });
    }

    const club = rClub.rows[0];

    if (!club.mp_connected || !club.mp_access_token) {
      return res.status(400).json({
        ok: false,
        error: 'El club no tiene Mercado Pago conectado'
      });
    }

    const unitPrice = Number(monto);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ ok: false, error: 'monto inválido' });
    }

    // 2) Crear preferencia en Mercado Pago (con token del CLUB)
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${club.mp_access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [
          {
            title: concepto || `Pago ${club.name}`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: unitPrice
          }
        ],
        back_urls: {
          success: 'https://todosobremiclub.com.ar/pago-exitoso',
          failure: 'https://todosobremiclub.com.ar/pago-fallido',
          pending: 'https://todosobremiclub.com.ar/pago-pendiente'
        },
        auto_return: 'approved'
      })
    });

    const mpData = await mpRes.json().catch(() => null);

    if (!mpRes.ok) {
      return res.status(400).json({
        ok: false,
        error: 'Error creando preferencia de Mercado Pago',
        mp: mpData
      });
    }

    return res.json({
      ok: true,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point
    });
  } catch (err) {
    console.error('❌ create preference error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
