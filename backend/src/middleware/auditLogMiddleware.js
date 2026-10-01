// src/middleware/auditLogMiddleware.js
//
// Middleware genérico de auditoría: registra (best-effort, ver
// auditLogService.js) cada request de escritura (POST/PUT/PATCH/DELETE)
// que pasa por los módulos donde está montado (ver src/app.js — hoy: /club,
// /admin/clubs y /admin/users).
//
// Se engancha al evento 'finish' de la respuesta en vez de loguear antes de
// llamar a next(): así el registro se hace DESPUÉS de que la ruta ya corrió
// por completo, momento en el que req.user ya está poblado por el
// requireAuth propio de esa ruta (que corre más adelante en la cadena de
// middlewares, dentro del router específico) y ya sabemos el status_code
// final de la respuesta.
//
// No audita GET (son solo lecturas) ni /auth/login (que tiene su propio
// registro más detallado en authRoutes.js, vía registrarLogin()).
const { registrarActividad } = require('../services/auditLogService');

const METODOS_AUDITADOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function auditLogMiddleware(req, res, next) {
  if (METODOS_AUDITADOS.has(req.method) && req.path !== '/auth/login') {
    res.on('finish', () => {
      registrarActividad({ req, statusCode: res.statusCode }).catch(() => {});
    });
  }
  next();
}

module.exports = auditLogMiddleware;
