// src/routes/accesoRoutes.js
// Control de acceso: valida el QR del carnet contra la base (ver services/accesoQr.js).
//
// POST /club/:clubId/acceso/verificar
//   body: { qr: "<token firmado>" }
//     o   { legacy: { socioId } }   ← QR viejo (JSON plano) de socios que todavía no actualizaron la app.
//         Solo se acepta mientras ACCESO_QR_LEGACY != '0'. El estado SIEMPRE sale de la base
//         (nunca de lo que diga el QR), y el socioId es un UUID imposible de adivinar.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { verificarTokenQr, estadoAccesoSocio } = require('../services/accesoQr');
const { crearLimitador } = require('../middleware/rateLimit');

const router = express.Router();

// Roles del panel que operan el control de acceso (los mismos que ven la sección).
const ROLES_ACCESO = new Set(['admin', 'staff', 'finanzas', 'solo_lectura', 'superadmin']);

// Tope generoso por IP: evita usar el endpoint para probar identificadores a ritmo de máquina.
const limitarVerificar = crearLimitador({
  nombre: 'acceso-verificar',
  ventanaMs: 60 * 1000,
  max: 120,
  mensaje: 'Demasiadas lecturas seguidas. Esperá unos segundos.'
});

function puedeOperar(req, clubId) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  return roles.some((r) => {
    const rol = String(r.role || '').toLowerCase();
    if (rol === 'superadmin') return true;
    return String(r.club_id) === String(clubId) && ROLES_ACCESO.has(rol);
  });
}

router.post('/:clubId/acceso/verificar', limitarVerificar, requireAuth, async (req, res) => {
  try {
    const { clubId } = req.params;
    if (!puedeOperar(req, clubId)) {
      return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
    }

    const { qr, legacy } = req.body || {};
    let socioId = null;
    let esLegacy = false;

    if (qr) {
      let p;
      try {
        p = verificarTokenQr(qr);
      } catch (e) {
        return res.json({
          ok: true,
          habilitado: false,
          motivo: e.codigo === 'expirado'
            ? 'El QR venció. Pedile al socio que abra de nuevo su carnet.'
            : 'El código escaneado no es un carnet válido.'
        });
      }
      if (String(p.clubId) !== String(clubId)) {
        return res.json({ ok: true, habilitado: false, motivo: 'El carnet es de otro club.' });
      }
      socioId = p.socioId;
    } else if (legacy && legacy.socioId) {
      if (String(process.env.ACCESO_QR_LEGACY || '1') === '0') {
        return res.json({
          ok: true,
          habilitado: false,
          motivo: 'Carnet desactualizado: el socio tiene que actualizar la app.'
        });
      }
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(String(legacy.socioId))) {
        return res.json({ ok: true, habilitado: false, motivo: 'El código escaneado no es un carnet válido.' });
      }
      socioId = String(legacy.socioId);
      esLegacy = true;
    } else {
      return res.status(400).json({ ok: false, error: 'Falta el código QR' });
    }

    const estado = await estadoAccesoSocio(clubId, socioId);
    if (!estado) {
      return res.json({ ok: true, habilitado: false, motivo: 'El socio no pertenece a este club.' });
    }
    return res.json({ ok: true, legacy: esLegacy, ...estado });
  } catch (e) {
    console.error('❌ acceso/verificar', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
