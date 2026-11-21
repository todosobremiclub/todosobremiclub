// src/routes/informeMensualRoutes.js
// Informe mensual de uso de la plataforma (por club). Solo lectura salvo
// "regenerar". Lo ven: admin/staff, solo lectura y finanzas del club (y superadmin).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const svc = require('../services/informeMensualService');

const router = express.Router();

function rolDelClub(req, clubId) {
  const roles = req.user?.roles ?? [];
  if (roles.some((r) => r.role === 'superadmin')) return 'admin';
  const r = roles.find((x) => String(x.club_id) === String(clubId));
  if (!r) return null;
  const v = String(r.role || '').toLowerCase();
  if (v === 'staff') return 'admin';
  if (v === 'read' || v === 'readonly' || v === 'solo lectura') return 'solo_lectura';
  if (v === 'finance') return 'finanzas';
  return v;
}

function requireInformeAccess(req, res, next) {
  const rol = rolDelClub(req, req.params.clubId);
  if (!rol) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  if (!['admin', 'solo_lectura', 'finanzas'].includes(rol)) {
    return res.status(403).json({ ok: false, error: 'Tu rol no tiene acceso al informe mensual' });
  }
  req.rolInforme = rol;
  next();
}

// Lista de informes disponibles (más nuevo primero)
router.get('/:clubId/informes-mensuales', requireAuth, requireInformeAccess, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT periodo, generado_at
       FROM informes_mensuales
       WHERE club_id = $1
       ORDER BY periodo DESC
       LIMIT 36`,
      [req.params.clubId]
    );
    res.json({ ok: true, periodo_actual: svc.periodoActual(), informes: r.rows });
  } catch (e) {
    console.error('❌ GET informes-mensuales:', e);
    res.status(500).json({ ok: false, error: 'No se pudo cargar el listado de informes' });
  }
});

// Un informe guardado. Para el mes en curso ("actual") se calcula en el momento
// (parcial, hasta hoy) y no se guarda.
router.get('/:clubId/informes-mensuales/:periodo', requireAuth, requireInformeAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const periodo = req.params.periodo === 'actual' ? svc.periodoActual() : req.params.periodo;
    if (!svc.parsePeriodo(periodo)) return res.status(400).json({ ok: false, error: 'Período inválido' });

    if (periodo === svc.periodoActual()) {
      const informe = await svc.calcularInforme(clubId, periodo);
      return res.json({ ok: true, informe, guardado: false });
    }
    const r = await db.query(
      `SELECT datos, generado_at FROM informes_mensuales WHERE club_id = $1 AND periodo = $2`,
      [clubId, periodo]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'No hay informe para ese período' });
    res.json({ ok: true, informe: r.rows[0].datos, generado_at: r.rows[0].generado_at, guardado: true });
  } catch (e) {
    console.error('❌ GET informe mensual:', e);
    res.status(500).json({ ok: false, error: 'No se pudo cargar el informe' });
  }
});

// Regenerar un mes ya cerrado (solo admin). Útil si cargaron pagos atrasados.
// Ojo: "morosos" y "app" reflejan el estado de HOY, no el del cierre de ese mes.
router.post('/:clubId/informes-mensuales/:periodo/regenerar', requireAuth, requireInformeAccess, async (req, res) => {
  try {
    if (req.rolInforme !== 'admin') return res.status(403).json({ ok: false, error: 'Solo un administrador puede regenerar' });
    const periodo = req.params.periodo;
    const p = svc.parsePeriodo(periodo);
    if (!p) return res.status(400).json({ ok: false, error: 'Período inválido' });
    if (periodo >= svc.periodoActual()) {
      return res.status(400).json({ ok: false, error: 'Solo se pueden regenerar meses ya cerrados' });
    }
    const informe = await svc.generarYGuardar(req.params.clubId, periodo);
    res.json({ ok: true, informe });
  } catch (e) {
    console.error('❌ POST regenerar informe:', e);
    res.status(500).json({ ok: false, error: 'No se pudo regenerar el informe' });
  }
});

module.exports = router;
