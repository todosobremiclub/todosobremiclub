// src/services/auditLogService.js
//
// Log de auditoría de administradores (ver migración
// migrations/2026-10-02_admin_activity_log.sql). Dos formas de registrar:
//
//   1) registrarLogin(...)     -> lo llama authRoutes.js en cada intento de
//                                  login (exitoso o fallido).
//   2) registrarActividad(...) -> lo llama auditLogMiddleware.js después de
//                                  cada request de escritura (POST/PUT/
//                                  PATCH/DELETE) en los módulos auditados.
//
// Todo acá es "best-effort": si falla el INSERT, se loguea en consola pero
// NUNCA se interrumpe ni se hace fallar el request original — la auditoría
// no debe poder tumbar una funcionalidad del panel.
const db = require('../db');

// UUID v4 (o similar) para detectar segmentos de path que son un :id y
// sacarlos de la descripción legible (ej: /club/<uuid>/socios/<uuid> -> "socios").
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VERBOS_POR_METODO = {
  POST: 'Creó',
  PUT: 'Actualizó',
  PATCH: 'Actualizó',
  DELETE: 'Eliminó',
};

// Arma una descripción legible + un código corto de acción a partir del
// método HTTP y el path del request, sacando 'club'/'admin' y cualquier id
// (uuid o numérico) para quedarse solo con los nombres de recurso.
// Ej: POST /club/<uuid>/tienda/productos -> { accion: 'POST:tienda_productos', descripcion: 'Creó tienda / productos' }
function describirAccion(method, routePath) {
  const segmentos = String(routePath || '')
    .split('/')
    .filter(Boolean)
    .filter((seg) => (
      seg !== 'club' &&
      seg !== 'admin' &&
      !seg.startsWith(':') &&   // patrón de ruta de Express, ej: ':clubId', ':id'
      !UUID_RE.test(seg) &&     // por si en vez del patrón llega la URL real con un uuid
      !/^\d+$/.test(seg)        // idem con un id numérico
    ));

  const recurso = segmentos.join(' / ') || routePath || '';
  const verbo = VERBOS_POR_METODO[method] || method;

  return {
    accion: `${method}:${segmentos.join('_') || 'root'}`,
    descripcion: `${verbo} ${recurso}`.trim(),
  };
}

function obtenerIp(req) {
  // Si el server corre detrás de un proxy/balanceador (ej. Render, Railway),
  // la IP real del cliente suele venir en x-forwarded-for.
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || null;
}

// ------------------------------------------------------------
// Login (éxito o fracaso). Se llama desde authRoutes.js.
// ------------------------------------------------------------
async function registrarLogin({ req, userId = null, email, exitoso, descripcion }) {
  try {
    await db.query(
      `
      INSERT INTO admin_activity_log
        (user_id, email, club_id, accion, descripcion, metodo_http, ruta, status_code, ip_address)
      VALUES ($1, $2, NULL, $3, $4, 'POST', '/auth/login', $5, $6)
      `,
      [
        userId,
        email ? String(email).toLowerCase() : null,
        exitoso ? 'login_exitoso' : 'login_fallido',
        descripcion || (exitoso ? 'Inicio de sesión exitoso' : 'Intento de inicio de sesión fallido'),
        exitoso ? 200 : 401,
        obtenerIp(req),
      ]
    );
  } catch (e) {
    console.error('⚠️ No se pudo registrar el login en admin_activity_log:', e.message);
  }
}

// ------------------------------------------------------------
// Acción genérica de escritura (POST/PUT/PATCH/DELETE) sobre el panel.
// La llama auditLogMiddleware.js después de que el request ya terminó
// (res 'finish'), así req.user ya está poblado por el requireAuth de la
// ruta correspondiente.
// ------------------------------------------------------------
async function registrarActividad({ req, statusCode }) {
  // Sin usuario logueado no hay nada que auditar (ej: intento con token
  // inválido, que ya devolvió 401 antes de llegar a ningún handler real).
  const userId = req.user?.userId || req.user?.id || null;
  const email = req.user?.email || null;
  if (!userId && !email) return;

  try {
    const clubId = req.params?.clubId || req.body?.club_id || null;
    const { accion, descripcion } = describirAccion(req.method, req.baseUrl + (req.route?.path || req.path || ''));

    await db.query(
      `
      INSERT INTO admin_activity_log
        (user_id, email, club_id, accion, descripcion, metodo_http, ruta, status_code, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        userId,
        email ? String(email).toLowerCase() : null,
        clubId,
        accion,
        descripcion,
        req.method,
        req.originalUrl?.split('?')[0] || req.path,
        statusCode,
        obtenerIp(req),
      ]
    );
  } catch (e) {
    console.error('⚠️ No se pudo registrar la actividad en admin_activity_log:', e.message);
  }
}

module.exports = { registrarLogin, registrarActividad, describirAccion, obtenerIp };
