// src/routes/auditLogRoutes.js
//
// ✅ NUEVO: pantalla de "Log de actividad" del panel Super Admin — permite
// ver los ingresos (login) y las acciones de escritura de los usuarios
// admin, con filtros por club, email, tipo de acción y rango de fechas.
// Los datos los generan authRoutes.js (login) y auditLogMiddleware.js
// (acciones), y se guardan en la tabla admin_activity_log (ver migración
// 2026-10-02_admin_activity_log.sql). Se conservan 3 meses — ver
// src/services/auditLogPurgeWorker.js.
//
// Mismo criterio de acceso que /admin/users y /admin/clubs: solo superadmin.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

// ================== LISTAR (con filtros + paginación) ==================
// GET /admin/audit-log?club_id=&email=&accion=&desde=&hasta=&page=&page_size=
router.get('/', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const {
      club_id: clubId,
      email,
      accion,
      desde,
      hasta,
    } = req.query;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(req.query.page_size, 10) || PAGE_SIZE_DEFAULT));
    const offset = (page - 1) * pageSize;

    const condiciones = [];
    const params = [];

    if (clubId) {
      params.push(clubId);
      condiciones.push(`l.club_id = $${params.length}`);
    }
    if (email) {
      params.push(`%${String(email).toLowerCase()}%`);
      condiciones.push(`l.email ILIKE $${params.length}`);
    }
    if (accion) {
      params.push(accion);
      condiciones.push(`l.accion = $${params.length}`);
    }
    if (desde) {
      params.push(desde);
      condiciones.push(`l.created_at >= $${params.length}::date`);
    }
    if (hasta) {
      params.push(hasta);
      condiciones.push(`l.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const rTotal = await db.query(
      `SELECT COUNT(*)::int AS total FROM admin_activity_log l ${where}`,
      params
    );

    const rRows = await db.query(
      `
      SELECT
        l.id, l.user_id, l.email, l.club_id, c.name AS club_name,
        l.accion, l.descripcion, l.metodo_http, l.ruta, l.status_code,
        l.ip_address, l.created_at
      FROM admin_activity_log l
      LEFT JOIN clubs c ON c.id = l.club_id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, pageSize, offset]
    );

    res.json({
      ok: true,
      rows: rRows.rows,
      total: rTotal.rows[0].total,
      page,
      page_size: pageSize,
    });
  } catch (e) {
    console.error('❌ GET admin/audit-log', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== ACCIONES DISTINTAS (para el filtro) ==================
// GET /admin/audit-log/acciones
router.get('/acciones', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT DISTINCT accion FROM admin_activity_log ORDER BY accion`
    );
    res.json({ ok: true, acciones: r.rows.map((x) => x.accion) });
  } catch (e) {
    console.error('❌ GET admin/audit-log/acciones', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
