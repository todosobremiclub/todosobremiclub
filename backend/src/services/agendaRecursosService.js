// src/services/agendaRecursosService.js
//
// Eventos de "Recursos" para la Agenda del panel: reservas ACEPTADAS y abonos
// (expandidos semana a semana, sin las fechas liberadas). Solo se arma para el
// panel (el endpoint de la Agenda lo pide únicamente a tokens de admin) y solo
// si el club tiene el módulo Recursos habilitado. Si algo falla (por ejemplo,
// una migración sin correr) devuelve [] y no rompe la Agenda.
const disp = require('./disponibilidadService');
const part = require('./espaciosParticipantesService');

const finEvento = (fecha, hd, hh) =>
  hh <= hd ? `${disp.addDays(fecha, 1)}T00:00` : `${fecha}T${hh}`;

/**
 * @param {object} db
 * @param {{clubId:string, desde:string, hastaExcl:string}} p  fechas YYYY-MM-DD (hasta exclusivo)
 */
async function eventosRecursos(db, { clubId, desde, hastaExcl }) {
  try {
    const rc = await db.query(`SELECT espacios_habilitado FROM clubs WHERE id = $1 LIMIT 1`, [clubId]);
    if (!rc.rowCount || rc.rows[0].espacios_habilitado !== true) return [];
    const hasta = disp.addDays(hastaExcl, -1);
    if (hasta < desde) return [];

    const [rr, ra] = await Promise.all([
      db.query(
        `SELECT r.id, rec.nombre AS recurso, r.socio_id, r.nombre_externo,
                s.nombre AS s_nombre, s.apellido AS s_apellido,
                to_char(r.fecha, 'YYYY-MM-DD') AS fecha,
                to_char(r.hora_desde, 'HH24:MI') AS hd, to_char(r.hora_hasta, 'HH24:MI') AS hh
           FROM recursos_reservas r
           JOIN recursos rec ON rec.id = r.recurso_id
           LEFT JOIN socios s ON s.id = r.socio_id
          WHERE r.club_id = $1 AND r.estado = 'aceptada'
            AND r.fecha BETWEEN $2::date AND $3::date
          ORDER BY r.fecha, r.hora_desde`,
        [clubId, desde, hasta]
      ),
      db.query(
        `SELECT a.id, rec.nombre AS recurso, a.socio_id, a.nombre_externo, a.dia_semana,
                s.nombre AS s_nombre, s.apellido AS s_apellido,
                to_char(a.hora_desde, 'HH24:MI') AS hd, to_char(a.hora_hasta, 'HH24:MI') AS hh,
                to_char(a.vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
                to_char(a.vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta
           FROM recursos_abonos a
           JOIN recursos rec ON rec.id = a.recurso_id
           LEFT JOIN socios s ON s.id = a.socio_id
          WHERE a.club_id = $1 AND a.estado = 'activo'
            AND a.vigente_desde <= $3::date
            AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= $2::date)`,
        [clubId, desde, hasta]
      )
    ]);

    let excepciones = [];
    if (ra.rowCount) {
      const re = await db.query(
        `SELECT abono_id, to_char(fecha_desde, 'YYYY-MM-DD') AS fecha_desde,
                to_char(fecha_hasta, 'YYYY-MM-DD') AS fecha_hasta
           FROM recursos_abonos_excepciones
          WHERE abono_id = ANY($1::uuid[]) AND fecha_hasta >= $2::date AND fecha_desde <= $3::date`,
        [ra.rows.map((a) => a.id), desde, hasta]
      );
      excepciones = re.rows;
    }
    const [pr, pa] = await Promise.all([
      part.participantesDe(db, { clubId, tipo: 'reserva', ids: rr.rows.map((x) => x.id) }),
      part.participantesDe(db, { clubId, tipo: 'abono', ids: ra.rows.map((x) => x.id) })
    ]);

    const titularDe = (x) =>
      x.socio_id
        ? `${x.s_apellido ?? ''}, ${x.s_nombre ?? ''}`.replace(/^, |, $/g, '').trim()
        : x.nombre_externo || 'Sin nombre';

    const eventos = [];
    const armar = (id, tipo, x, fecha, participantes) => {
      const extra = participantes.length ? ` +${participantes.length}` : '';
      eventos.push({
        id,
        title: `🏟️ ${x.recurso} · ${titularDe(x)}${extra}${tipo === 'abono' ? ' 🔁' : ''}`,
        start: `${fecha}T${x.hd}`,
        end: finEvento(fecha, x.hd, x.hh),
        allDay: false,
        classNames: ['evento-recurso'],
        extendedProps: {
          kind: 'recurso', tipo, fecha, hora_desde: x.hd, hora_hasta: x.hh,
          recurso: x.recurso, titular: titularDe(x),
          participantes: participantes.map((p) => p.nombre_completo)
        }
      });
    };

    for (const x of rr.rows) armar(`rec-r-${x.id}`, 'reserva', x, x.fecha, pr.get(x.id) || []);

    for (const a of ra.rows) {
      const excs = excepciones.filter((e) => e.abono_id === a.id);
      let f = desde > a.vigente_desde ? desde : a.vigente_desde;
      for (let i = 0; i < 7 && disp.dow(f) !== Number(a.dia_semana); i++) f = disp.addDays(f, 1);
      for (; f <= hasta; f = disp.addDays(f, 7)) {
        if (a.vigente_hasta && f > a.vigente_hasta) break;
        if (excs.some((e) => f >= e.fecha_desde && f <= e.fecha_hasta)) continue;
        armar(`rec-a-${a.id}-${f}`, 'abono', a, f, pa.get(a.id) || []);
      }
    }
    return eventos;
  } catch (e) {
    console.warn('⚠ Agenda: no se pudieron armar los eventos de recursos:', e.message);
    return [];
  }
}

module.exports = { eventosRecursos };
