// src/routes/clasesRoutes.js
//
// Módulo "Espacios y Clases" — CLASES, panel del club (montado bajo /club).
// Release B. Plan: claude/espacios-y-clases-plan.md (sección 4.5).
// Permisos: lectura = admin / staff / solo_lectura; escritura = admin / staff (+ superadmin).
// El club debe tener espacios_habilitado = true.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const clasesSvc = require('../services/clasesService');
const reservasSvc = require('../services/espaciosReservasService');

const router = express.Router();

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

const ROLES_LECTURA = new Set(['admin', 'staff', 'solo_lectura']);
const ROLES_ESCRITURA = new Set(['admin', 'staff']);

function acceso(escritura) {
  const permitidos = escritura ? ROLES_ESCRITURA : ROLES_LECTURA;
  return async (req, res, next) => {
    try {
      const { clubId } = req.params;
      if (!isUuid(clubId)) return res.status(400).json({ ok: false, error: 'Club inválido' });
      const roles = req.user?.roles ?? [];
      const permitido = roles.some(
        (r) =>
          r.role === 'superadmin' ||
          (String(r.club_id) === String(clubId) && permitidos.has(String(r.role).toLowerCase()))
      );
      if (!permitido) return res.status(403).json({ ok: false, error: 'No autorizado' });
      const rc = await db.query(`SELECT espacios_habilitado FROM clubs WHERE id = $1`, [clubId]);
      if (!rc.rowCount || rc.rows[0].espacios_habilitado !== true) {
        return res.status(403).json({ ok: false, error: 'El módulo Espacios y Clases no está habilitado para este club' });
      }
      next();
    } catch (e) {
      console.error('❌ clases acceso', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}
const leer = [requireAuth, acceso(false)];
const escribir = [requireAuth, acceso(true)];

function responderError(res, e, etiqueta) {
  if (e instanceof reservasSvc.ErrNegocio) {
    return res.status(e.status).json({ ok: false, error: e.message, code: e.code, ...e.extra });
  }
  console.error(`❌ ${etiqueta}`, e);
  return res.status(500).json({ ok: false, error: e.message });
}

// Valida :id (y opcionalmente otros params uuid)
function uuids(...names) {
  return (req, res, next) => {
    for (const n of names) {
      if (!isUuid(req.params[n])) return res.status(400).json({ ok: false, error: 'Identificador inválido' });
    }
    next();
  };
}

// GET /club/:clubId/clases
router.get('/:clubId/clases', ...leer, async (req, res) => {
  try {
    const clases = await clasesSvc.listarClases(db, { clubId: req.params.clubId });
    return res.json({ ok: true, clases });
  } catch (e) { return responderError(res, e, 'GET clases'); }
});

// GET /club/:clubId/clases/calendario?desde&hasta&clase_id&recurso_id   (máx. 62 días)
router.get('/:clubId/clases/calendario', ...leer, async (req, res) => {
  try {
    const { clase_id, recurso_id } = req.query;
    if (clase_id && !isUuid(clase_id)) return res.status(400).json({ ok: false, error: 'Clase inválida' });
    if (recurso_id && !isUuid(recurso_id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });
    const eventos = await clasesSvc.calendario(db, {
      clubId: req.params.clubId,
      desde: String(req.query.desde || ''), hasta: String(req.query.hasta || ''),
      claseId: clase_id || null, recursoId: recurso_id || null
    });
    return res.json({ ok: true, eventos });
  } catch (e) { return responderError(res, e, 'GET clases/calendario'); }
});

// GET /club/:clubId/clases/:id
router.get('/:clubId/clases/:id', ...leer, uuids('id'), async (req, res) => {
  try {
    const clase = await clasesSvc.obtenerClase(db, { clubId: req.params.clubId, id: req.params.id });
    if (!clase) return res.status(404).json({ ok: false, error: 'Clase no encontrada' });
    return res.json({ ok: true, clase });
  } catch (e) { return responderError(res, e, 'GET clases/:id'); }
});

// POST /club/:clubId/clases
router.post('/:clubId/clases', ...escribir, async (req, res) => {
  try {
    const clase = await clasesSvc.guardarClase(db, { clubId: req.params.clubId, body: req.body });
    return res.status(201).json({ ok: true, clase });
  } catch (e) { return responderError(res, e, 'POST clases'); }
});

// PUT /club/:clubId/clases/:id   (reemplaza datos y horarios)
router.put('/:clubId/clases/:id', ...escribir, uuids('id'), async (req, res) => {
  try {
    const clase = await clasesSvc.guardarClase(db, { clubId: req.params.clubId, id: req.params.id, body: req.body });
    return res.json({ ok: true, clase });
  } catch (e) { return responderError(res, e, 'PUT clases/:id'); }
});

// DELETE /club/:clubId/clases/:id   (borra o, si tuvo inscriptos, desactiva)
router.delete('/:clubId/clases/:id', ...escribir, uuids('id'), async (req, res) => {
  try {
    const r = await clasesSvc.eliminarClase(db, { clubId: req.params.clubId, id: req.params.id });
    return res.json({ ok: true, ...r });
  } catch (e) { return responderError(res, e, 'DELETE clases/:id'); }
});

// POST /club/:clubId/clases/:id/excepciones   { fecha, motivo? }   → cancela esa fecha (avisa a inscriptos)
router.post('/:clubId/clases/:id/excepciones', ...escribir, uuids('id'), async (req, res) => {
  try {
    const excepcion = await clasesSvc.agregarExcepcion(db, {
      clubId: req.params.clubId, id: req.params.id, fecha: req.body?.fecha, motivo: req.body?.motivo
    });
    return res.status(201).json({ ok: true, excepcion });
  } catch (e) { return responderError(res, e, 'POST clases/:id/excepciones'); }
});

// DELETE /club/:clubId/clases/:id/excepciones/:excId   → vuelve a dictar esa fecha
router.delete('/:clubId/clases/:id/excepciones/:excId', ...escribir, uuids('id', 'excId'), async (req, res) => {
  try {
    await clasesSvc.quitarExcepcion(db, { clubId: req.params.clubId, id: req.params.id, excId: req.params.excId });
    return res.json({ ok: true });
  } catch (e) { return responderError(res, e, 'DELETE clases/:id/excepciones/:excId'); }
});

// GET /club/:clubId/clases/:id/socios
router.get('/:clubId/clases/:id/socios', ...leer, uuids('id'), async (req, res) => {
  try {
    const inscriptos = await clasesSvc.listarInscriptos(db, { clubId: req.params.clubId, id: req.params.id });
    return res.json({ ok: true, inscriptos });
  } catch (e) { return responderError(res, e, 'GET clases/:id/socios'); }
});

// POST /club/:clubId/clases/:id/socios   { socioIds: [uuid,...] }
router.post('/:clubId/clases/:id/socios', ...escribir, uuids('id'), async (req, res) => {
  try {
    const r = await clasesSvc.inscribir(db, { clubId: req.params.clubId, id: req.params.id, socioIds: req.body?.socioIds });
    return res.status(201).json({ ok: true, ...r });
  } catch (e) { return responderError(res, e, 'POST clases/:id/socios'); }
});

// DELETE /club/:clubId/clases/:id/socios/:socioId
router.delete('/:clubId/clases/:id/socios/:socioId', ...escribir, uuids('id', 'socioId'), async (req, res) => {
  try {
    await clasesSvc.darDeBaja(db, { clubId: req.params.clubId, id: req.params.id, socioId: req.params.socioId });
    return res.json({ ok: true });
  } catch (e) { return responderError(res, e, 'DELETE clases/:id/socios/:socioId'); }
});

module.exports = router;
