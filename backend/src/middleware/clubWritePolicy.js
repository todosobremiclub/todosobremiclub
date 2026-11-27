// src/middleware/clubWritePolicy.js
//
// Política de ESCRITURA por rol para todo lo que cuelga de /club/:clubId/...
//
// Antes, la mayoría de las rutas solo verificaban que el club estuviera en el
// token (membresía), sin mirar el rol: un usuario "solo_lectura" (o el token de
// impersonación del superadmin) podía modificar datos llamando a la API
// directamente. Este middleware centraliza la regla y es el espejo de lo que el
// panel ya muestra (canWrite en public/js/club.js).
//
// Se monta UNA vez en src/app.js:  app.use('/club/:clubId', clubWritePolicy);
// y solo actúa sobre métodos de escritura (POST/PUT/PATCH/DELETE).
//
// Reglas (rol -> primer segmento de la ruta, después de /club/:clubId, que puede escribir):
//   superadmin / admin / staff : todo
//   finanzas     : pagos, ingresos, gastos, payments (transferencias), registrar-pago de planes
//   comunicacion : noticias, notificaciones, agenda
//   profesor     : noticias, notificaciones, asistencia, agenda
//   asistencias  : asistencia
//   solo_lectura : nada
//   cualquier otro rol: nada
//
// Modo de prueba: ROLE_POLICY_MODE=log → no bloquea, solo registra en consola lo
// que bloquearía (para poder revisar en producción antes de hacerlo efectivo).
const jwt = require('jsonwebtoken');

const METODOS_ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizarRol(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r === 'read' || r === 'readonly' || r === 'solo lectura' || r === 'solo_lectura') return 'solo_lectura';
  if (r === 'comunicacion' || r === 'comunicación' || r === 'comms') return 'comunicacion';
  if (r === 'finanzas' || r === 'finance') return 'finanzas';
  if (r === 'asistencias' || r === 'asistencia') return 'asistencias';
  if (r === 'staff') return 'admin';
  return r;
}

const SECCIONES_POR_ROL = {
  finanzas: new Set(['pagos', 'ingresos', 'gastos', 'payments']),
  comunicacion: new Set(['noticias', 'notificaciones', 'agenda']),
  profesor: new Set(['noticias', 'notificaciones', 'asistencia', 'agenda']),
  asistencias: new Set(['asistencia'])
};

// path = lo que queda después de /club/:clubId  (ej: "/pagos", "/planes-clases/ID/registrar-pago")
function seccionDeRuta(path) {
  const partes = String(path || '').split('?')[0].split('/').filter(Boolean);
  return { primero: (partes[0] || '').toLowerCase(), ultimo: (partes[partes.length - 1] || '').toLowerCase() };
}

function rolPermiteEscribir(rol, path) {
  if (rol === 'superadmin' || rol === 'admin') return true;
  const { primero, ultimo } = seccionDeRuta(path);

  // Control de acceso: "verificar" un QR es una LECTURA (no modifica nada), pero se hace por POST
  // para no mandar el token en la URL. El rol se controla dentro de la ruta (accesoRoutes.js).
  if (primero === 'acceso' && ultimo === 'verificar') return true;

  // Finanzas registra cobros de planes desde la pantalla de Pagos.
  if (rol === 'finanzas' && (primero === 'planes-actividad' || primero === 'planes-clases') && ultimo === 'registrar-pago') {
    return true;
  }
  const permitidas = SECCIONES_POR_ROL[rol];
  return !!(permitidas && permitidas.has(primero));
}

function clubWritePolicy(req, res, next) {
  try {
    if (!METODOS_ESCRITURA.has(req.method)) return next();

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

    // Token de superadmin (rol global) → sin restricciones.
    if (roles.some((r) => normalizarRol(r.role) === 'superadmin')) return next();

    const rolesDelClub = roles
      .filter((r) => String(r.club_id) === clubId)
      .map((r) => normalizarRol(r.role));

    // Sin rol en este club: el chequeo de membresía de cada ruta responde 403.
    if (!rolesDelClub.length) return next();

    const ok = rolesDelClub.some((rol) => rolPermiteEscribir(rol, req.path));
    if (ok) return next();

    const modoLog = String(process.env.ROLE_POLICY_MODE || '').toLowerCase() === 'log';
    console.warn(
      `🔒 clubWritePolicy ${modoLog ? '(solo log) ' : ''}bloquea ${req.method} /club/${clubId}${req.path} rol=${rolesDelClub.join(',')}`
    );
    if (modoLog) return next();

    return res.status(403).json({ ok: false, error: 'Tu rol no permite modificar esta sección' });
  } catch (e) {
    console.error('❌ clubWritePolicy', e);
    return res.status(500).json({ ok: false, error: 'Error de autorización' });
  }
}

module.exports = clubWritePolicy;
module.exports._interno = { normalizarRol, rolPermiteEscribir };
