// src/services/accesoQr.js
//
// QR del carnet FIRMADO (control de acceso).
//
// Antes el QR era un JSON plano (clubId, socioId, dni, nombre, alDia, ultimoPago...) y el
// lector decidía "HABILITADO" mirando el campo ultimoPago del propio QR: cualquiera podía
// fabricar o editar uno, y el QR exponía el DNI (que además es la contraseña de la app).
//
// Ahora el QR contiene SOLO un token firmado de vida corta que emite el backend
// (GET /app/carnet/qr) y el lector lo valida contra el backend
// (POST /club/:clubId/acceso/verificar), que decide con datos reales de la base.
//
// El token se firma con una clave DERIVADA de JWT_SECRET (no con JWT_SECRET directo), para que
// un token de QR nunca pueda usarse como token de sesión de la app (requireAuth no lo acepta).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Vida del token. La app del socio lo renueva sola mientras el carnet está abierto.
const QR_TTL_SEG = 5 * 60;

function claveQr() {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('Falta JWT_SECRET en el servidor');
  return crypto.createHmac('sha256', base).update('tsmc-carnet-qr-v1').digest('hex');
}

function firmarQr({ socioId, clubId }) {
  return jwt.sign({ typ: 'qr', socioId: String(socioId), clubId: String(clubId) }, claveQr(), {
    algorithm: 'HS256',
    expiresIn: QR_TTL_SEG
  });
}

// Devuelve { socioId, clubId } o lanza Error con .codigo = 'expirado' | 'invalido'
function verificarTokenQr(token) {
  try {
    const p = jwt.verify(String(token || ''), claveQr(), { algorithms: ['HS256'] });
    if (p.typ !== 'qr' || !p.socioId || !p.clubId) {
      const e = new Error('QR inválido'); e.codigo = 'invalido'; throw e;
    }
    return { socioId: String(p.socioId), clubId: String(p.clubId) };
  } catch (err) {
    if (err.codigo) throw err;
    const e = new Error(err.name === 'TokenExpiredError' ? 'QR vencido' : 'QR inválido');
    e.codigo = err.name === 'TokenExpiredError' ? 'expirado' : 'invalido';
    throw e;
  }
}

// Regla del control de acceso (la misma que usaban los lectores): habilitado si el último pago
// cae en el mes actual, el anterior o el siguiente. Un socio becado siempre está habilitado.
// Un socio inactivo nunca.
function decidirAcceso({ activo, becado, ultimoIdx, ahora = new Date() }) {
  if (activo === false) return { habilitado: false, motivo: 'Socio inactivo.' };
  if (becado === true) return { habilitado: true, motivo: 'Socio becado.' };
  if (!ultimoIdx) return { habilitado: false, motivo: 'No registra pagos.' };
  const nowIdx = ahora.getFullYear() * 12 + ahora.getMonth() + 1; // misma escala que (anio*12 + mes)
  if (ultimoIdx >= nowIdx - 1 && ultimoIdx <= nowIdx + 1) {
    return { habilitado: true, motivo: 'Cuota al día (mes actual / anterior / siguiente).' };
  }
  return { habilitado: false, motivo: 'Cuota vencida (último pago anterior al mes anterior).' };
}

function ymTexto(idx) {
  if (!idx) return null;
  const y = Math.floor((idx - 1) / 12);
  const m = ((idx - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Estado de acceso de un socio de un club, calculado con datos de la base.
async function estadoAccesoSocio(clubId, socioId) {
  const r = await db.query(
    `SELECT id, nombre, apellido, numero_socio, actividad, categoria, foto_url, becado, activo
       FROM socios WHERE id = $1 AND club_id = $2 LIMIT 1`,
    [socioId, clubId]
  );
  if (!r.rowCount) return null;
  const s = r.rows[0];
  const rUlt = await db.query(
    `SELECT MAX((anio::int * 12) + (mes::int)) AS ultimo_idx
       FROM pagos_mensuales WHERE socio_id = $1 AND club_id = $2`,
    [socioId, clubId]
  );
  const ultimoIdx = rUlt.rows?.[0]?.ultimo_idx ? Number(rUlt.rows[0].ultimo_idx) : null;
  const dec = decidirAcceso({ activo: s.activo, becado: s.becado, ultimoIdx });
  return {
    habilitado: dec.habilitado,
    motivo: dec.motivo,
    socio: {
      nombre: s.nombre,
      apellido: s.apellido,
      numero: s.numero_socio,
      actividad: s.actividad,
      categoria: s.categoria,
      foto_url: s.foto_url,
      ultimo_pago: ymTexto(ultimoIdx)
    }
  };
}

module.exports = { firmarQr, verificarTokenQr, decidirAcceso, estadoAccesoSocio, ymTexto, QR_TTL_SEG };
