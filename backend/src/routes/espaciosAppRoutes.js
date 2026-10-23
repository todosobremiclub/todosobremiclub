// src/routes/espaciosAppRoutes.js
//
// Módulo "Espacios y Clases" — API de la APP del socio (montado bajo /app).
// El club y el socio salen del JWT (igual que /app/tienda/...).
// Paso 6: recursos, turnos libres, reservas (crear / mías / cancelar).
// Paso 8: abonos del socio (solo lectura).
// Más adelante: /app/clases (Release B).
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const disp = require('../services/disponibilidadService');
const reservasSvc = require('../services/espaciosReservasService');
const abonosSvc = require('../services/espaciosAbonosService');

const router = express.Router();

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

// Valida token de la app + flag del club. Devuelve { clubId, socioId } o responde el error.
async function sesionEspacios(req, res) {
  const clubId = req.user?.clubId || req.user?.club_id || null;
  const socioId = req.user?.socioId || req.user?.socio_id || null;
  if (!clubId || !socioId) {
    res.status(401).json({ ok: false, error: 'Token inválido para la app' });
    return null;
  }
  const rc = await db.query(`SELECT espacios_habilitado FROM clubs WHERE id = $1 LIMIT 1`, [clubId]);
  if (!rc.rowCount || rc.rows[0].espacios_habilitado !== true) {
    res.status(403).json({ ok: false, error: 'Este club no tiene Espacios y Clases habilitado' });
    return null;
  }
  return { clubId, socioId };
}

function responderError(res, e, etiqueta) {
  if (e instanceof reservasSvc.ErrNegocio) {
    return res.status(e.status).json({ ok: false, error: e.message, code: e.code, ...e.extra });
  }
  console.error(`❌ ${etiqueta}`, e);
  return res.status(500).json({ ok: false, error: e.message });
}

// GET /app/espacios/recursos
router.get('/espacios/recursos', requireAuth, async (req, res) => {
  try {
    const s = await sesionEspacios(req, res);
    if (!s) return;
    const r = await db.query(
      `
      SELECT r.id, r.nombre, r.tipo, r.descripcion, r.capacidad, r.imagen_url,
             r.duracion_turno_min, r.anticipacion_min_horas, r.anticipacion_max_dias,
             r.cancelar_hasta_horas
        FROM recursos r
       WHERE r.club_id = $1 AND r.activo = TRUE AND r.reservable_app = TRUE
         AND EXISTS (SELECT 1 FROM recursos_disponibilidad d
                      WHERE d.recurso_id = r.id AND d.activo = TRUE AND d.modo = 'disponible')
       ORDER BY r.orden ASC, r.nombre ASC
      `,
      [s.clubId]
    );
    return res.json({ ok: true, recursos: r.rows });
  } catch (e) {
    return responderError(res, e, 'GET /app/espacios/recursos');
  }
});

// GET /app/espacios/recursos/:id/turnos?desde&hasta   (solo turnos LIBRES; default 14 días, tope 31)
router.get('/espacios/recursos/:id/turnos', requireAuth, async (req, res) => {
  try {
    const s = await sesionEspacios(req, res);
    if (!s) return;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });

    const hoy = disp.ahoraArgentina().fecha;
    const desde = req.query.desde ? String(req.query.desde) : hoy;
    if (!reservasSvc.esFechaReal(desde)) {
      return res.status(400).json({ ok: false, error: 'Fechas inválidas (YYYY-MM-DD)' });
    }
    const hasta = req.query.hasta ? String(req.query.hasta) : disp.addDays(desde, 13);
    if (!reservasSvc.esFechaReal(hasta)) {
      return res.status(400).json({ ok: false, error: 'Fechas inválidas (YYYY-MM-DD)' });
    }

    let out;
    try {
      out = await disp.turnosDisponibles(
        db, { clubId: s.clubId, recursoId: id, desde, hasta }, { aplicarAnticipacion: true }
      );
    } catch (err) {
      if (err.message === 'rango_invalido') return res.status(400).json({ ok: false, error: 'El rango de fechas es inválido' });
      if (err.message === 'rango_muy_grande') {
        return res.status(400).json({ ok: false, error: `El rango máximo es de ${disp.MAX_DIAS_RANGO} días` });
      }
      throw err;
    }
    if (!out || !out.recurso.activo || !out.recurso.reservable_app) {
      return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });
    }
    const r = out.recurso;
    const dias = disp.soloLibres(out.dias).map((d) => ({
      fecha: d.fecha,
      turnos: d.turnos.map((t) => ({ hora_desde: t.hora_desde, hora_hasta: t.hora_hasta }))
    }));
    return res.json({
      ok: true,
      recurso: {
        id: r.id, nombre: r.nombre, duracion_turno_min: r.duracion_turno_min,
        cancelar_hasta_horas: r.cancelar_hasta_horas
      },
      desde, hasta, dias
    });
  } catch (e) {
    return responderError(res, e, 'GET /app/espacios/recursos/:id/turnos');
  }
});

// POST /app/espacios/reservas   body: { recurso_id, fecha, hora_desde, comentario? }
router.post('/espacios/reservas', requireAuth, async (req, res) => {
  try {
    const s = await sesionEspacios(req, res);
    if (!s) return;
    const b = req.body || {};
    if (!isUuid(b.recurso_id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });
    const r = await reservasSvc.crearReserva(db, {
      clubId: s.clubId, socioId: s.socioId, origen: 'app',
      recursoId: b.recurso_id, fecha: String(b.fecha || ''), horaDesde: String(b.hora_desde || ''),
      comentario: b.comentario
    });
    return res.status(201).json({ ok: true, reserva: formatoApp(r) });
  } catch (e) {
    return responderError(res, e, 'POST /app/espacios/reservas');
  }
});

function formatoApp(r) {
  return {
    id: r.id, recurso_id: r.recurso_id, recurso_nombre: r.recurso_nombre,
    fecha: r.fecha, hora_desde: r.hora_desde, hora_hasta: r.hora_hasta,
    estado: r.estado, origen: r.origen,
    comentario: r.comentario_socio, mensaje_admin: r.mensaje_admin,
    created_at: r.created_at, ...reservasSvc.infoCancelacion(r)
  };
}

// GET /app/espacios/reservas/mias   (próximas primero; historial de los últimos 90 días)
router.get('/espacios/reservas/mias', requireAuth, async (req, res) => {
  try {
    const s = await sesionEspacios(req, res);
    if (!s) return;
    const q = await db.query(
      `
      SELECT ${reservasSvc.SQL_RESERVA}, rec.imagen_url AS recurso_imagen_url
        FROM recursos_reservas r
        JOIN recursos rec ON rec.id = r.recurso_id
       WHERE r.club_id = $1 AND r.socio_id = $2
         AND r.fecha >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 90)
       ORDER BY r.fecha DESC, r.hora_desde DESC
       LIMIT 200
      `,
      [s.clubId, s.socioId]
    );
    const reservas = q.rows.map((r) => ({ ...formatoApp(r), recurso_imagen_url: r.recurso_imagen_url }));
    return res.json({ ok: true, reservas });
  } catch (e) {
    return responderError(res, e, 'GET /app/espacios/reservas/mias');
  }
});

// POST /app/espacios/reservas/:id/cancelar
router.post('/espacios/reservas/:id/cancelar', requireAuth, async (req, res) => {
  try {
    const s = await sesionEspacios(req, res);
    if (!s) return;
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: 'Reserva inválida' });
    const r = await reservasSvc.cancelarPorSocio(db, {
      clubId: s.clubId, socioId: s.socioId, id: req.params.id
    });
    return res.json({ ok: true, reserva: formatoApp(r) });
  } catch (e) {
    return responderError(res, e, 'POST /app/espacios/reservas/:id/cancelar');
  }
});

// GET /app/espacios/abonos/mios   (abonos vigentes del socio; solo lectura)
router.get('/espacios/abonos/mios', requireAuth, async (req, res) => {
  try {
    const s = await sesionEspacios(req, res);
    if (!s) return;
    const abonos = await abonosSvc.abonosDelSocio(db, { clubId: s.clubId, socioId: s.socioId });
    return res.json({ ok: true, abonos });
  } catch (e) {
    return responderError(res, e, 'GET /app/espacios/abonos/mios');
  }
});

module.exports = router;
