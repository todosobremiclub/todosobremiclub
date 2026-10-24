// src/routes/clasesAppRoutes.js
//
// API de la APP del socio para Clases / entrenamientos de la Agenda
// (montado bajo /app). El club y el socio salen del token.
//   GET /app/clases/mias  → clases donde el socio está asignado, con próximas fechas.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const clasesSvc = require('../services/agendaClasesService');

const router = express.Router();

router.get('/clases/mias', requireAuth, async (req, res) => {
  try {
    const clubId = req.user?.clubId || req.user?.club_id || null;
    const socioId = req.user?.socioId || req.user?.socio_id || null;
    if (!clubId || !socioId) {
      return res.status(401).json({ ok: false, error: 'Token inválido para la app' });
    }
    const clases = await clasesSvc.clasesDelSocio(db, { clubId, socioId });
    return res.json({ ok: true, clases });
  } catch (e) {
    console.error('❌ GET /app/clases/mias:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
