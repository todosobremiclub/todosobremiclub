// src/middleware/clubReadPolicy.js
//
// Política de LECTURA por rol para todo lo que cuelga de /club/:clubId/...
// (hermana de clubWritePolicy.js, que cubre las escrituras).
//
// Antes, la mayoría de los GET solo verificaban que el usuario perteneciera al club
// (membresía), sin mirar el rol: un "profesor" o "asistencias" podía leer reportes
// financieros, pagos, DNI de socios, etc. llamando a la API directamente. Este
// middleware centraliza la regla y es el espejo de lo que el panel ya muestra
// (buildPermissions.canAccess en public/js/club.js).
//
// Se monta UNA vez en src/app.js, después de clubWritePolicy:
//   app.use('/club/:clubId', require('./middleware/clubReadPolicy'));
// y solo actúa sobre GET/HEAD.
//
// Siempre pueden leer: superadmin, admin (y staff), solo_lectura.
// Roles adicionales por sección (primer segmento después de /club/:clubId):
//   reportes (financieros / socios) ........ finanzas
//   reportes/asistencia/* ................... finanzas, profesor, asistencias
//   pagos, gastos, ingresos, payments ....... finanzas
//   informes-mensuales ...................... finanzas
//   tienda .................................. finanzas
//   pendientes .............................. finanzas
//   asistencia .............................. profesor, asistencias
//   espacios ................................ (solo admin / solo_lectura)
//   socios/export.xlsx, socios/bienvenida/*,
//   socios/:id/adjuntos, socios/:id/comentarios (solo admin / solo_lectura)
//   resto (socios, config, noticias, notificaciones, cumples, agenda, ayuda, whatsapp, ...) : todos los roles
//
// Tokens de SOCIO (app, sin "roles"): no tienen que leer las secciones del panel.
// Se bloquean en las secciones administrativas; en las demás (noticias, cumples,
// pagos propios, etc.) decide cada ruta, como hasta ahora.
//
// Modo de prueba: READ_POLICY_MODE=log → no bloquea, solo registra en consola lo
// que bloquearía (para revisar en producción antes de hacerlo efectivo).
const jwt = require('jsonwebtoken');
const { _interno } = require('./clubWritePolicy');
const { normalizarRol } = _interno;

const METODOS_LECTURA = new Set(['GET', 'HEAD']);

// Roles que leen TODO el club.
const ROLES_LECTURA_TOTAL = new Set(['superadmin', 'admin', 'solo_lectura']);

// Secciones que el token de socio (app) nunca debe leer.
const SECCIONES_SOLO_PANEL = new Set([
  'reportes', 'gastos', 'ingresos', 'payments', 'informes-mensuales', 'informe-mensual',
  'tienda', 'espacios', 'pendientes', 'asistencia', 'socios', 'grupo-familiar',
  'socios-relacionados', 'whatsapp'
]);

// null = todos los roles. Set = roles adicionales (además de los de lectura total).
function rolesPermitidos(partes) {
  const p0 = (partes[0] || '').toLowerCase();
  const p1 = (partes[1] || '').toLowerCase();
  const p2 = (partes[2] || '').toLowerCase();

  switch (p0) {
    case 'reportes':
      if (p1 === 'asistencia') return new Set(['finanzas', 'profesor', 'asistencias']);
      return new Set(['finanzas']);
    case 'pagos':
    case 'gastos':
    case 'ingresos':
    case 'payments':
    case 'informes-mensuales':
    case 'informe-mensual':
    case 'tienda':
    case 'pendientes':
      return new Set(['finanzas']);
    case 'asistencia':
      return new Set(['profesor', 'asistencias']);
    case 'espacios':
      return new Set();
    case 'socios':
      // Datos sensibles (DNI/email/teléfono masivos, documentos médicos, notas internas).
      if (p1 === 'export.xlsx' || p1 === 'bienvenida' || p2 === 'adjuntos' || p2 === 'comentarios') return new Set();
      return null;
    default:
      return null;
  }
}

function partesDeRuta(path) {
  return String(path || '').split('?')[0].split('/').filter(Boolean);
}

function rolPermiteLeer(rol, path) {
  if (ROLES_LECTURA_TOTAL.has(rol)) return true;
  const permitidos = rolesPermitidos(partesDeRuta(path));
  if (permitidos === null) return true;
  return permitidos.has(rol);
}

function clubReadPolicy(req, res, next) {
  try {
    if (!METODOS_LECTURA.has(req.method)) return next();

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    // Sin token / token inválido: que responda 401 el requireAuth de cada ruta.
    if (!token || !process.env.JWT_SECRET) return next();

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return next();
    }

    const clubId = String(req.params.clubId || '');
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    const modoLog = String(process.env.READ_POLICY_MODE || '').toLowerCase() === 'log';

    function bloquear(detalle, mensaje) {
      console.warn(`🔒 clubReadPolicy ${modoLog ? '(solo log) ' : ''}bloquea ${req.method} /club/${clubId}${req.path} ${detalle}`);
      if (modoLog) return next();
      return res.status(403).json({ ok: false, error: mensaje });
    }

    // Token de superadmin (rol global) → sin restricciones.
    if (roles.some((r) => normalizarRol(r.role) === 'superadmin')) return next();

    // Token de socio (app): sin roles de panel.
    if (!roles.length) {
      const seccion = partesDeRuta(req.path)[0] || '';
      if (SECCIONES_SOLO_PANEL.has(seccion.toLowerCase())) {
        return bloquear('token=socio', 'No autorizado');
      }
      return next();
    }

    const rolesDelClub = roles
      .filter((r) => String(r.club_id) === clubId)
      .map((r) => normalizarRol(r.role));

    // Sin rol en este club: el chequeo de membresía de cada ruta responde 403.
    if (!rolesDelClub.length) return next();

    if (rolesDelClub.some((rol) => rolPermiteLeer(rol, req.path))) return next();

    return bloquear(`rol=${rolesDelClub.join(',')}`, 'Tu rol no permite ver esta sección');
  } catch (e) {
    console.error('❌ clubReadPolicy', e);
    return res.status(500).json({ ok: false, error: 'Error de autorización' });
  }
}

module.exports = clubReadPolicy;
module.exports._interno = { rolPermiteLeer, rolesPermitidos };
