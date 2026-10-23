// src/services/espaciosReservasService.js
//
// Lógica de RESERVAS de recursos (Espacios y Clases, paso 6).
// La usan tanto el panel (espaciosRoutes.js) como la app del socio
// (espaciosAppRoutes.js), así las reglas son las mismas en los dos lados.
//
// Reglas (plan: claude/espacios-y-clases-plan.md):
//  - Una reserva pendiente BLOQUEA el turno para los demás.
//  - Máximo 3 pendientes por socio (anti-abuso).
//  - El servidor valida que el turno sea EXACTAMENTE uno de los generados
//    por disponibilidadService y que esté libre (no confía en la app).
//  - Anti doble reserva: transacción en UNA conexión (db.getClient()) con
//    SELECT ... FOR UPDATE sobre la fila del recurso.
//  - El socio cancela una reserva ACEPTADA hasta `cancelar_hasta_horas` antes
//    (configurable por recurso). Una PENDIENTE la puede cancelar libremente
//    hasta que empiece el turno (todavía no hay nada acordado con el club).
//  - Horas siempre en horario de Argentina (DATE + TIME sin zona).
const disp = require('./disponibilidadService');

const MAX_PENDIENTES_SOCIO = 3;
const TZ_SQL = `'America/Argentina/Buenos_Aires'`;
const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

class ErrNegocio extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code || null;
    this.extra = extra;
  }
}

// --- notificaciones (lazy, para poder stubear en tests) ---------------------
let _notificador = null;
function setNotificador(fn) { _notificador = fn; }
function getNotificador() {
  if (_notificador) return _notificador;
  return require('./notificacionesService').notificarSocio;
}
function avisar(args) {
  try {
    const p = getNotificador()(args);
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('⚠ No se pudo notificar al socio (espacios):', err.message));
    }
  } catch (err) {
    console.warn('⚠ No se pudo notificar al socio (espacios):', err.message);
  }
}

// --- helpers de fecha/hora ---------------------------------------------------
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const esFechaReal = (s) => {
  if (!disp.isISODate(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Minutos desde "ahora" hasta el inicio del turno (negativo = ya empezó)
function minutosHastaInicio(fecha, hora, a = disp.ahoraArgentina()) {
  return disp.daysBetween(a.fecha, fecha) * 1440 + disp.toMin(String(hora).slice(0, 5)) - a.min;
}
const yaEmpezo = (fecha, hora, a) => minutosHastaInicio(fecha, hora, a) <= 0;

function fmtCorto(fecha) {
  const [, m, d] = fecha.split('-');
  return `${DIAS_CORTO[disp.dow(fecha)]} ${d}/${m}`;
}
function descTurno(r) {
  return `${r.recurso_nombre} el ${fmtCorto(r.fecha)} de ${r.hora_desde} a ${r.hora_hasta}`;
}

// --- transacción en una sola conexión ----------------------------------------
async function enTransaccion(db, fn) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* nada */ }
    throw e;
  } finally {
    client.release();
  }
}

const SQL_RESERVA = `
  r.id, r.club_id, r.recurso_id, rec.nombre AS recurso_nombre,
  r.socio_id, r.nombre_externo, r.contacto_externo,
  to_char(r.fecha, 'YYYY-MM-DD') AS fecha,
  to_char(r.hora_desde, 'HH24:MI') AS hora_desde,
  to_char(r.hora_hasta, 'HH24:MI') AS hora_hasta,
  r.estado, r.origen, r.comentario_socio, r.mensaje_admin,
  r.created_at, r.gestionada_at,
  rec.cancelar_hasta_horas`;

async function obtenerReserva(q, { clubId, id, forUpdate = false }) {
  const r = await q.query(
    `SELECT ${SQL_RESERVA}
       FROM recursos_reservas r
       JOIN recursos rec ON rec.id = r.recurso_id
      WHERE r.id = $1 AND r.club_id = $2
      ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
    [id, clubId]
  );
  return r.rows[0] || null;
}

function mensajeMotivoNoLibre(motivo, recurso) {
  switch (motivo) {
    case 'pasado':
      return recurso && Number(recurso.anticipacion_min_horas) > 0
        ? `Ese turno ya no se puede reservar (hay que reservar con al menos ${recurso.anticipacion_min_horas} hs de anticipación)`
        : 'Ese turno ya empezó';
    case 'fuera_de_rango':
      return `Solo se puede reservar con hasta ${recurso?.anticipacion_max_dias ?? 30} días de anticipación`;
    case 'sin_disponibilidad':
    case 'turno_inexistente':
      return 'Ese turno no existe o ya no está disponible';
    default: // reserva | abono | clase | bloqueo
      return 'Ese turno ya fue ocupado por otra persona';
  }
}

// ============================================================================
// CREAR (app: pendiente · panel: aceptada)
// ============================================================================
/**
 * @param {object} p
 *  clubId, recursoId, fecha 'YYYY-MM-DD', horaDesde 'HH:MM'
 *  origen: 'app' | 'panel'
 *  socioId (obligatorio en 'app'; en 'panel' socio O nombreExterno)
 *  nombreExterno, contactoExterno, comentario, adminUserId
 */
async function crearReserva(db, p) {
  const origen = p.origen === 'panel' ? 'panel' : 'app';
  const horaDesde = String(p.horaDesde || '').slice(0, 5);
  if (!p.recursoId) throw new ErrNegocio(400, 'Falta el recurso', 'datos');
  if (!esFechaReal(p.fecha)) throw new ErrNegocio(400, 'Fecha inválida (YYYY-MM-DD)', 'datos');
  if (!HHMM.test(horaDesde)) throw new ErrNegocio(400, 'Hora inválida (HH:MM)', 'datos');

  const socioId = p.socioId || null;
  const nombreExterno = String(p.nombreExterno || '').trim().slice(0, 120) || null;
  const contactoExterno = String(p.contactoExterno || '').trim().slice(0, 120) || null;
  if (origen === 'app' && !socioId) throw new ErrNegocio(401, 'Token inválido para la app', 'auth');
  if (!socioId && !nombreExterno) {
    throw new ErrNegocio(400, 'Indicá el socio o el nombre de la persona', 'datos');
  }
  const comentario = String(p.comentario || '').trim().slice(0, 300) || null;

  const creada = await enTransaccion(db, async (c) => {
    // 1) Lock por socio (serializa el tope de 3 pendientes aunque pida en recursos distintos)
    if (socioId) {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`espacios_socio:${socioId}`]);
    }
    // 2) Lock del recurso (serializa las reservas del mismo recurso: anti doble reserva)
    const rr = await c.query(
      `SELECT id, activo, reservable_app FROM recursos WHERE id = $1 AND club_id = $2 FOR UPDATE`,
      [p.recursoId, p.clubId]
    );
    if (!rr.rowCount) throw new ErrNegocio(404, 'Recurso no encontrado', 'recurso');
    if (!rr.rows[0].activo) throw new ErrNegocio(400, 'Este recurso no está activo', 'recurso_inactivo');
    if (origen === 'app' && !rr.rows[0].reservable_app) {
      throw new ErrNegocio(403, 'Este recurso no se reserva desde la app', 'no_reservable_app');
    }

    // 3) Socio válido (y activo si reserva desde la app)
    if (socioId) {
      const rs = await c.query(`SELECT activo FROM socios WHERE id = $1 AND club_id = $2`, [socioId, p.clubId]);
      if (!rs.rowCount) throw new ErrNegocio(404, 'Socio no encontrado', 'socio');
      if (origen === 'app' && rs.rows[0].activo !== true) {
        throw new ErrNegocio(403, 'Socio inactivo', 'socio_inactivo');
      }
    }

    // 4) Tope de pendientes (solo reservas de la app)
    if (origen === 'app') {
      const cnt = await c.query(
        `SELECT COUNT(*)::int AS n FROM recursos_reservas
          WHERE socio_id = $1 AND estado = 'pendiente'
            AND (fecha + hora_desde) > (NOW() AT TIME ZONE ${TZ_SQL})`,
        [socioId]
      );
      if (cnt.rows[0].n >= MAX_PENDIENTES_SOCIO) {
        throw new ErrNegocio(
          409,
          `Ya tenés ${MAX_PENDIENTES_SOCIO} solicitudes pendientes. Esperá a que el club las responda o cancelá alguna.`,
          'max_pendientes'
        );
      }
    }

    // 5) El turno tiene que ser uno de los generados y estar libre
    const ctx = await disp.cargarContexto(c, {
      clubId: p.clubId, recursoId: p.recursoId, desde: p.fecha, hasta: p.fecha
    });
    if (!ctx) throw new ErrNegocio(404, 'Recurso no encontrado', 'recurso');
    const v = disp.validarTurnoLibre({ ...ctx, aplicarAnticipacion: origen === 'app' }, p.fecha, horaDesde);
    if (!v.ok) {
      const status = ['sin_disponibilidad', 'turno_inexistente', 'pasado', 'fuera_de_rango'].includes(v.motivo) ? 400 : 409;
      throw new ErrNegocio(status, mensajeMotivoNoLibre(v.motivo, ctx.recurso), v.motivo === 'pasado' || v.motivo === 'fuera_de_rango' ? v.motivo : 'turno_ocupado');
    }
    if (origen === 'panel' && yaEmpezo(p.fecha, horaDesde)) {
      throw new ErrNegocio(400, 'Ese turno ya empezó', 'pasado');
    }

    const estado = origen === 'app' ? 'pendiente' : 'aceptada';
    const ins = await c.query(
      `INSERT INTO recursos_reservas
         (club_id, recurso_id, socio_id, nombre_externo, contacto_externo,
          fecha, hora_desde, hora_hasta, estado, origen, comentario_socio,
          gestionada_por, gestionada_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        p.clubId, p.recursoId, socioId, socioId ? null : nombreExterno, socioId ? null : contactoExterno,
        p.fecha, v.turno.hora_desde, v.turno.hora_hasta, estado, origen, comentario,
        origen === 'panel' ? (p.adminUserId || null) : null,
        origen === 'panel' ? new Date() : null
      ]
    );
    return obtenerReserva(c, { clubId: p.clubId, id: ins.rows[0].id });
  });

  if (origen === 'panel' && creada.socio_id) {
    avisar({
      clubId: p.clubId, socioId: creada.socio_id,
      titulo: '🏟️ Reserva confirmada',
      cuerpo: `El club te reservó ${descTurno(creada)}.`,
      data: { type: 'espacios_reserva_aceptada', reservaId: String(creada.id) }
    });
  }
  return creada;
}

// ============================================================================
// GESTIÓN DEL CLUB: aceptar / rechazar / cancelar
// ============================================================================
async function gestionarReserva(db, { clubId, id, accion, mensaje = null, adminUserId = null }) {
  if (!['aceptar', 'rechazar', 'cancelar'].includes(accion)) {
    throw new ErrNegocio(400, 'Acción inválida', 'datos');
  }
  const msg = String(mensaje || '').trim().slice(0, 300) || null;

  const r = await enTransaccion(db, async (c) => {
    const fila = await obtenerReserva(c, { clubId, id, forUpdate: true });
    if (!fila) throw new ErrNegocio(404, 'Reserva no encontrada', 'reserva');

    if (accion === 'aceptar' || accion === 'rechazar') {
      if (fila.estado !== 'pendiente') {
        throw new ErrNegocio(400, 'La reserva ya fue gestionada', 'ya_gestionada');
      }
    } else if (fila.estado !== 'aceptada') {
      throw new ErrNegocio(
        400,
        fila.estado === 'pendiente'
          ? 'La reserva está pendiente: usá "Rechazar"'
          : 'Solo se puede cancelar una reserva aceptada',
        'estado_invalido'
      );
    }

    if (accion === 'aceptar') {
      if (yaEmpezo(fila.fecha, fila.hora_desde)) {
        throw new ErrNegocio(409, 'El turno ya comenzó; la solicitud vence sola', 'turno_empezado');
      }
      // Re-validación de solapamiento (bloqueamos el recurso)
      await c.query(`SELECT id FROM recursos WHERE id = $1 FOR UPDATE`, [fila.recurso_id]);

      const otra = await c.query(
        `SELECT 1 FROM recursos_reservas
          WHERE recurso_id = $1 AND fecha = $2::date AND id <> $3
            AND estado IN ('pendiente','aceptada')
            AND hora_desde < $5::time AND hora_hasta > $4::time
          LIMIT 1`,
        [fila.recurso_id, fila.fecha, fila.id, fila.hora_desde, fila.hora_hasta]
      );
      if (otra.rowCount) {
        throw new ErrNegocio(409, 'Ese turno se superpone con otra reserva', 'solapamiento');
      }
      const ctx = await disp.cargarContexto(c, {
        clubId, recursoId: fila.recurso_id, desde: fila.fecha, hasta: fila.fecha
      });
      if (ctx) {
        const dias = disp.calcularTurnos({
          ...ctx, reservas: ctx.reservas.filter((x) => x.id !== fila.id),
          desde: fila.fecha, hasta: fila.fecha, aplicarAnticipacion: false
        });
        const dia = dias.find((d) => d.fecha === fila.fecha);
        const t = dia && dia.turnos.find((x) => x.hora_desde === fila.hora_desde);
        if (t && t.estado !== 'libre') {
          const quien = { bloqueo: 'quedó bloqueado', abono: 'lo ocupa un abono', clase: 'lo ocupa una clase' }[t.motivo] || 'está ocupado';
          throw new ErrNegocio(409, `No se puede aceptar: el turno ${quien}`, 'solapamiento', { motivo: t.motivo });
        }
      }
    }

    if (accion === 'cancelar' && yaEmpezo(fila.fecha, fila.hora_hasta)) {
      throw new ErrNegocio(400, 'Ese turno ya pasó', 'pasado');
    }

    const nuevo = { aceptar: 'aceptada', rechazar: 'rechazada', cancelar: 'cancelada' }[accion];
    await c.query(
      `UPDATE recursos_reservas
          SET estado = $1, mensaje_admin = $2, gestionada_por = $3, gestionada_at = NOW()
        WHERE id = $4`,
      [nuevo, msg, adminUserId, fila.id]
    );
    return obtenerReserva(c, { clubId, id: fila.id });
  });

  if (r.socio_id) {
    const sufijo = msg ? ` Mensaje del club: ${msg}` : '';
    const textos = {
      aceptar: ['🏟️ Reserva aceptada', `Tu reserva de ${descTurno(r)} fue aceptada.${sufijo}`, 'espacios_reserva_aceptada'],
      rechazar: ['🏟️ Reserva rechazada', `Tu solicitud de ${descTurno(r)} fue rechazada.${msg ? ` Motivo: ${msg}` : ''}`, 'espacios_reserva_rechazada'],
      cancelar: ['🏟️ Reserva cancelada', `El club canceló tu reserva de ${descTurno(r)}.${msg ? ` Motivo: ${msg}` : ''}`, 'espacios_reserva_cancelada']
    }[accion];
    avisar({
      clubId, socioId: r.socio_id, titulo: textos[0], cuerpo: textos[1],
      data: { type: textos[2], reservaId: String(r.id) }
    });
  }
  return r;
}

// ============================================================================
// CANCELA EL SOCIO (app)
// ============================================================================
async function cancelarPorSocio(db, { clubId, socioId, id }) {
  return enTransaccion(db, async (c) => {
    const r = await c.query(
      `SELECT ${SQL_RESERVA}
         FROM recursos_reservas r
         JOIN recursos rec ON rec.id = r.recurso_id
        WHERE r.id = $1 AND r.club_id = $2 AND r.socio_id = $3
        FOR UPDATE OF r`,
      [id, clubId, socioId]
    );
    const fila = r.rows[0];
    if (!fila) throw new ErrNegocio(404, 'Reserva no encontrada', 'reserva');
    if (!['pendiente', 'aceptada'].includes(fila.estado)) {
      throw new ErrNegocio(400, 'Esta reserva ya no se puede cancelar', 'estado_invalido');
    }
    const faltan = minutosHastaInicio(fila.fecha, fila.hora_desde);
    if (faltan <= 0) throw new ErrNegocio(400, 'El turno ya comenzó', 'pasado');
    if (fila.estado === 'aceptada' && faltan < Number(fila.cancelar_hasta_horas) * 60) {
      const h = Number(fila.cancelar_hasta_horas);
      throw new ErrNegocio(
        400,
        `Solo podés cancelar hasta ${h} ${h === 1 ? 'hora' : 'horas'} antes del turno. Comunicate con el club.`,
        'fuera_de_plazo',
        { cancelar_hasta_horas: h }
      );
    }
    await c.query(`UPDATE recursos_reservas SET estado = 'cancelada' WHERE id = $1`, [fila.id]);
    return obtenerReserva(c, { clubId, id: fila.id });
  });
}

// Datos extra para la app: ¿puede cancelar y hasta cuándo?
function infoCancelacion(fila) {
  const faltan = minutosHastaInicio(fila.fecha, fila.hora_desde);
  if (!['pendiente', 'aceptada'].includes(fila.estado) || faltan <= 0) return { puede_cancelar: false };
  if (fila.estado === 'pendiente') return { puede_cancelar: true };
  const limite = Number(fila.cancelar_hasta_horas) * 60;
  return { puede_cancelar: faltan >= limite, cancelar_hasta_horas: Number(fila.cancelar_hasta_horas) };
}

// ============================================================================
// VENCIMIENTO: pendientes cuyo turno ya empezó -> 'vencida'
// ============================================================================
async function vencerPendientes(db) {
  const r = await db.query(
    `WITH v AS (
       UPDATE recursos_reservas
          SET estado = 'vencida', gestionada_at = NOW()
        WHERE estado = 'pendiente'
          AND (fecha + hora_desde) <= (NOW() AT TIME ZONE ${TZ_SQL})
        RETURNING id, club_id, recurso_id, socio_id, fecha, hora_desde, hora_hasta
     )
     SELECT v.id, v.club_id, v.socio_id, rec.nombre AS recurso_nombre,
            to_char(v.fecha, 'YYYY-MM-DD') AS fecha,
            to_char(v.hora_desde, 'HH24:MI') AS hora_desde,
            to_char(v.hora_hasta, 'HH24:MI') AS hora_hasta
       FROM v JOIN recursos rec ON rec.id = v.recurso_id`
  );
  for (const x of r.rows) {
    if (!x.socio_id) continue;
    avisar({
      clubId: x.club_id, socioId: x.socio_id,
      titulo: '🏟️ Solicitud vencida',
      cuerpo: `Tu solicitud de ${descTurno(x)} venció sin respuesta del club.`,
      data: { type: 'espacios_reserva_vencida', reservaId: String(x.id) }
    });
  }
  return r.rowCount;
}

module.exports = {
  MAX_PENDIENTES_SOCIO, ErrNegocio, setNotificador,
  avisarSocio: avisar, enTransaccion,
  crearReserva, gestionarReserva, cancelarPorSocio, infoCancelacion, vencerPendientes,
  obtenerReserva, minutosHastaInicio, yaEmpezo, esFechaReal, SQL_RESERVA
};
