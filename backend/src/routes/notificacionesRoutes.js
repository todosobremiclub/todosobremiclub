// src/routes/notificacionesRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const {
  validateDestino,
  crearYEnviarNotificacion,
} = require('../services/notificacionesService'); // ✅ lógica de envío ahora centralizada acá

const router = express.Router();

// ===============================
// CORS simple (igual a noticias/cumples/pagos)
// ===============================
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ===============================
// Helper: validar acceso al club (ADMIN/STAFF/SUPERADMIN)
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
  (r) =>
    String(r.club_id) === String(clubId) ||
    r.role === 'superadmin'
);

  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }

const canWrite = roles.some(
  (r) =>
    r.role === 'admin' ||
    r.role === 'staff' ||
    r.role === 'superadmin' ||
    r.role === 'profesor' // ✅ CLAVE
);

if (!canWrite) {
  return res.status(403).json({ ok: false, error: 'No autorizado' });
}
  next();
}

// ============================================================
// GET /club/:clubId/notificaciones
// - ADMIN (panel): lista las activas del club (historial)
// - SOCIO (app): lista las activas del club (valida clubId si viene en token)
// ============================================================
router.get('/:clubId/notificaciones', requireAuth, async (req, res, next) => {
  const { clubId } = req.params;

  try {
    // Caso SOCIO: token de /app/login trae socioId y clubId
    if (req.user?.socioId) {
      if (req.user.clubId && String(req.user.clubId) !== String(clubId)) {
        return res
          .status(403)
          .json({ ok: false, error: 'El socio no pertenece a este club' });
      }

      const r = await db.query(
        `
        SELECT id, club_id, titulo, cuerpo, data, created_at, sent_at
        FROM notificaciones
        WHERE club_id = $1 AND activo = true
        ORDER BY created_at DESC
        LIMIT 200
        `,
        [clubId]
      );

      return res.json({ ok: true, notificaciones: r.rows });
    }

    // Caso ADMIN / STAFF / usuario con acceso al club
    if (!req.user?.socioId) {
      await new Promise((resolve, reject) => {
        requireClubAccess(req, res, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Si requireClubAccess ya respondió error, cortamos
      if (res.headersSent) return;
    }


    const r = await db.query(
      `
      SELECT id, club_id, titulo, cuerpo, data, created_at, sent_at, activo
      FROM notificaciones
      WHERE club_id = $1 AND activo = true
      ORDER BY created_at DESC
      LIMIT 500
      `,
      [clubId]
    );

    return res.json({ ok: true, notificaciones: r.rows });
  } catch (e) {
    console.error('❌ GET notificaciones', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/notificaciones
// Guarda + envía automáticamente al guardar (push a topic club_<clubId>)
// body: { titulo, cuerpo, data? }
// ✅ Incluye nombre del club en el push
// ============================================================
router.post('/:clubId/notificaciones', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { titulo, cuerpo, data = null, canal = 'app' } = req.body ?? {};

  try {
    if (!titulo?.trim() || !cuerpo?.trim()) {
      return res.status(400).json({ ok: false, error: 'Completá título y cuerpo.' });
    }

    // ✅ Validar el destino elegido (mismos criterios que Noticias)
    try {
      validateDestino(data ?? {});
    } catch (eDestino) {
      return res.status(400).json({ ok: false, error: eDestino.message });
    }

    const { notificacion, whatsappResumen } = await crearYEnviarNotificacion({
      clubId, titulo, cuerpo, data, canal
    });

    return res.status(201).json({ ok: true, notificacion, whatsappResumen });
  } catch (e) {
    console.error('❌ POST notificaciones', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /club/:clubId/notificaciones/:id
// Soft delete: activo=false
// ============================================================
router.delete('/:clubId/notificaciones/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    const r = await db.query(
      `
      UPDATE notificaciones
      SET activo = false, updated_at = NOW()
      WHERE id = $1 AND club_id = $2
      `,
      [id, clubId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Notificación no encontrada' });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE notificaciones', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// ✅ NUEVO: NOTIFICACIONES PROGRAMADAS
// Permiten dejar cargado hoy un envío para que salga solo más
// adelante, sin que un admin tenga que entrar a apretar "Enviar":
//   - tipo_repeticion = 'una_vez'  -> sale una sola vez, en fecha_hora
//   - tipo_repeticion = 'mensual'  -> sale todos los meses, el día
//                                     dia_mes (1-31) a la hora indicada
// El envío en sí lo hace notificacionesProgramadasWorker.js, que corre
// cada 5 minutos (ver setInterval en src/app.js) y usa la misma función
// crearYEnviarNotificacion() de acá arriba.
// ============================================================

// Horario de Argentina, sin horario de verano desde 2009 -> offset fijo.
const OFFSET_ARG_MIN = -3 * 60;

// Arma un Date (en UTC) a partir de fecha "YYYY-MM-DD" + hora "HH:MM"
// interpretadas en horario de Argentina.
function argToUtcDate(fechaStr, horaStr) {
  const [y, m, d] = String(fechaStr).split('-').map(Number);
  const [hh, mm] = String(horaStr).split(':').map(Number);
  // Date.UTC con la hora "de Argentina" y después le restamos el offset
  // (offset es negativo, así que restarlo suma minutos -> pasa a UTC real).
  const utcMs = Date.UTC(y, (m - 1), d, hh, mm, 0) - OFFSET_ARG_MIN * 60 * 1000;
  return new Date(utcMs);
}

// Dado un día del mes deseado (1-31) y una hora "HH:MM" (horario Argentina),
// calcula la próxima fecha/hora (en UTC) en que corresponde ejecutar. Si el
// mes no tiene ese día (ej: 31 en abril), usa el último día del mes.
function calcularProximaEjecucionMensual(diaMes, horaStr, desde = new Date()) {
  const [hh, mm] = String(horaStr).split(':').map(Number);

  // Trabajamos en "hora Argentina": convertimos `desde` (UTC) a los campos
  // de fecha/hora que tendría un reloj en Argentina en ese instante.
  const desdeArgMs = desde.getTime() + OFFSET_ARG_MIN * 60 * 1000;
  const desdeArg = new Date(desdeArgMs);

  const anio = desdeArg.getUTCFullYear();
  const mesActual = desdeArg.getUTCMonth(); // 0-11

  const ultimoDiaMesActual = new Date(Date.UTC(anio, mesActual + 1, 0)).getUTCDate();
  const diaEsteMes = Math.min(diaMes, ultimoDiaMesActual);

  const candidatoEsteMes = new Date(
    Date.UTC(anio, mesActual, diaEsteMes, hh, mm, 0) - OFFSET_ARG_MIN * 60 * 1000
  );

  if (candidatoEsteMes.getTime() > desde.getTime()) {
    return candidatoEsteMes;
  }

  // Ya pasó este mes -> próximo mes
  const ultimoDiaProxMes = new Date(Date.UTC(anio, mesActual + 2, 0)).getUTCDate();
  const diaProxMes = Math.min(diaMes, ultimoDiaProxMes);

  return new Date(
    Date.UTC(anio, mesActual + 1, diaProxMes, hh, mm, 0) - OFFSET_ARG_MIN * 60 * 1000
  );
}

// ============================================================
// GET /club/:clubId/notificaciones/programadas
// Lista las notificaciones programadas activas del club.
// ============================================================
router.get('/:clubId/notificaciones/programadas', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(
      `
      SELECT id, club_id, titulo, cuerpo, data, canal, tipo_repeticion,
             fecha_hora, dia_mes, hora, proxima_ejecucion, ultima_ejecucion,
             activo, created_at
      FROM notificaciones_programadas
      WHERE club_id = $1 AND activo = true
      ORDER BY proxima_ejecucion ASC
      `,
      [clubId]
    );
    return res.json({ ok: true, programadas: r.rows });
  } catch (e) {
    console.error('❌ GET notificaciones/programadas', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/notificaciones/programadas
// Crea una notificación programada (no la envía ahora).
// body: {
//   titulo, cuerpo, data (destino), canal,
//   tipo_repeticion: 'una_vez' | 'mensual',
//   // si 'una_vez':
//   fecha: 'YYYY-MM-DD', hora: 'HH:MM',
//   // si 'mensual':
//   dia_mes: 1-31, hora: 'HH:MM'
// }
// Las fechas/horas se interpretan en horario de Argentina.
// ============================================================
router.post('/:clubId/notificaciones/programadas', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    titulo, cuerpo, data = null, canal = 'app',
    tipo_repeticion, fecha, hora, dia_mes,
  } = req.body ?? {};

  try {
    if (!titulo?.trim() || !cuerpo?.trim()) {
      return res.status(400).json({ ok: false, error: 'Completá título y cuerpo.' });
    }

    try {
      validateDestino(data ?? {});
    } catch (eDestino) {
      return res.status(400).json({ ok: false, error: eDestino.message });
    }

    const canalFinal = ['app', 'whatsapp', 'ambos'].includes(canal) ? canal : 'app';

    if (!['una_vez', 'mensual'].includes(tipo_repeticion)) {
      return res.status(400).json({ ok: false, error: 'tipo_repeticion inválido (una_vez | mensual)' });
    }
    if (!hora || !/^\d{1,2}:\d{2}$/.test(hora)) {
      return res.status(400).json({ ok: false, error: 'Falta la hora de envío (HH:MM)' });
    }

    let fechaHora = null;
    let diaMesFinal = null;
    let proximaEjecucion = null;

    if (tipo_repeticion === 'una_vez') {
      if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ ok: false, error: 'Falta la fecha de envío (YYYY-MM-DD)' });
      }
      fechaHora = argToUtcDate(fecha, hora);
      if (fechaHora.getTime() <= Date.now()) {
        return res.status(400).json({ ok: false, error: 'La fecha/hora programada ya pasó' });
      }
      proximaEjecucion = fechaHora;
    } else {
      const dm = Number(dia_mes);
      if (!Number.isInteger(dm) || dm < 1 || dm > 31) {
        return res.status(400).json({ ok: false, error: 'Día del mes inválido (1 a 31)' });
      }
      diaMesFinal = dm;
      proximaEjecucion = calcularProximaEjecucionMensual(dm, hora);
    }

    const rIns = await db.query(
      `
      INSERT INTO notificaciones_programadas
        (club_id, titulo, cuerpo, data, canal, tipo_repeticion, fecha_hora, dia_mes, hora, proxima_ejecucion, activo, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, true, NOW(), NOW())
      RETURNING id, club_id, titulo, cuerpo, data, canal, tipo_repeticion, fecha_hora, dia_mes, hora, proxima_ejecucion, created_at
      `,
      [clubId, titulo.trim(), cuerpo.trim(), data, canalFinal, tipo_repeticion, fechaHora, diaMesFinal, hora, proximaEjecucion]
    );

    return res.status(201).json({ ok: true, programada: rIns.rows[0] });
  } catch (e) {
    console.error('❌ POST notificaciones/programadas', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /club/:clubId/notificaciones/programadas/:id
// Cancela (soft delete) una notificación programada que todavía no salió.
// ============================================================
router.delete('/:clubId/notificaciones/programadas/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    const r = await db.query(
      `UPDATE notificaciones_programadas SET activo = false, updated_at = NOW() WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Notificación programada no encontrada' });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE notificaciones/programadas', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.calcularProximaEjecucionMensual = calcularProximaEjecucionMensual;
