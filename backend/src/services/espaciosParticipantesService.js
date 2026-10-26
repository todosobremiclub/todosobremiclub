// src/services/espaciosParticipantesService.js
//
// PARTICIPANTES de reservas y abonos de recursos: socios adicionales al
// titular ("para que vayan todos"). El titular sigue siendo quien responde por
// la reserva/abono (columna socio_id); los participantes solo la VEN en la app
// y reciben los avisos.
//
// Tablas: recursos_reservas_socios (reserva_id, socio_id)
//         recursos_abonos_socios   (abono_id,   socio_id)
const MAX_PARTICIPANTES = 30;

const TABLAS = {
  reserva: { tabla: 'recursos_reservas_socios', col: 'reserva_id' },
  abono: { tabla: 'recursos_abonos_socios', col: 'abono_id' }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErrParticipantes extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

/** Limpia la lista: array de uuids únicos, sin el titular. Lanza 400 si algo es inválido. */
function limpiarIds(ids, titularId = null) {
  if (ids == null) return [];
  if (!Array.isArray(ids)) throw new ErrParticipantes(400, 'La lista de participantes es inválida', 'datos');
  const out = [];
  const visto = new Set();
  for (const x of ids) {
    const id = String(x || '').trim().toLowerCase();
    if (!UUID.test(id)) throw new ErrParticipantes(400, 'Hay un participante inválido', 'datos');
    if (titularId && id === String(titularId).toLowerCase()) continue;
    if (visto.has(id)) continue;
    visto.add(id);
    out.push(id);
  }
  if (out.length > MAX_PARTICIPANTES) {
    throw new ErrParticipantes(400, `Máximo ${MAX_PARTICIPANTES} participantes`, 'max_participantes');
  }
  return out;
}

const nombreCompleto = (s) =>
  `${s.apellido ?? ''}, ${s.nombre ?? ''}`.replace(/^, |, $/g, '').trim();

/** Participantes actuales: Map(refId -> [{socio_id, nombre, apellido, numero_socio, activo, nombre_completo}]) */
async function participantesDe(q, { clubId, tipo, ids }) {
  const t = TABLAS[tipo];
  const mapa = new Map();
  if (!t || !ids || !ids.length) return mapa;
  try {
    const r = await q.query(
      `SELECT p.${t.col} AS ref_id, s.id AS socio_id, s.nombre, s.apellido, s.numero_socio, s.activo
         FROM ${t.tabla} p
         JOIN socios s ON s.id = p.socio_id
        WHERE p.club_id = $1 AND p.${t.col} = ANY($2::uuid[])
        ORDER BY s.apellido, s.nombre`,
      [clubId, ids]
    );
    for (const x of r.rows) {
      if (!mapa.has(x.ref_id)) mapa.set(x.ref_id, []);
      mapa.get(x.ref_id).push({
        socio_id: x.socio_id, nombre: x.nombre, apellido: x.apellido,
        numero_socio: x.numero_socio ?? null, activo: x.activo !== false,
        nombre_completo: nombreCompleto(x)
      });
    }
  } catch (e) {
    // Migración todavía no corrida: no rompemos el listado.
    if (e && e.code === '42P01') return mapa;
    throw e;
  }
  return mapa;
}

/**
 * Reemplaza la lista de participantes (dentro de una transacción: q = client).
 * Los socios nuevos tienen que existir en el club y estar activos.
 * Devuelve { agregados: [socioId], quitados: [socioId], total }.
 */
async function reemplazar(q, { clubId, tipo, refId, socioIds, titularId = null }) {
  const t = TABLAS[tipo];
  const nuevos = limpiarIds(socioIds, titularId);

  const actual = await q.query(
    `SELECT socio_id FROM ${t.tabla} WHERE ${t.col} = $1`, [refId]
  );
  const actualesSet = new Set(actual.rows.map((x) => x.socio_id));
  const nuevosSet = new Set(nuevos);

  const agregados = nuevos.filter((id) => !actualesSet.has(id));
  const quitados = [...actualesSet].filter((id) => !nuevosSet.has(id));

  if (agregados.length) {
    const rs = await q.query(
      `SELECT id, activo FROM socios WHERE club_id = $1 AND id = ANY($2::uuid[])`,
      [clubId, agregados]
    );
    const mapa = new Map(rs.rows.map((s) => [s.id, s]));
    for (const id of agregados) {
      const s = mapa.get(id);
      if (!s) throw new ErrParticipantes(404, 'Hay un participante que no es socio de este club', 'socio');
      if (s.activo !== true) throw new ErrParticipantes(400, 'Hay un participante inactivo', 'socio_inactivo');
    }
    await q.query(
      `INSERT INTO ${t.tabla} (${t.col}, socio_id, club_id)
       SELECT $1, x, $3 FROM unnest($2::uuid[]) AS x
       ON CONFLICT DO NOTHING`,
      [refId, agregados, clubId]
    );
  }
  if (quitados.length) {
    await q.query(
      `DELETE FROM ${t.tabla} WHERE ${t.col} = $1 AND socio_id = ANY($2::uuid[])`,
      [refId, quitados]
    );
  }
  return { agregados, quitados, total: nuevos.length };
}

/** Ids de los participantes de una reserva/abono (sin tocar nombres). */
async function idsDe(q, { tipo, refId }) {
  const t = TABLAS[tipo];
  try {
    const r = await q.query(`SELECT socio_id FROM ${t.tabla} WHERE ${t.col} = $1`, [refId]);
    return r.rows.map((x) => x.socio_id);
  } catch (e) {
    if (e && e.code === '42P01') return [];
    throw e;
  }
}

module.exports = {
  MAX_PARTICIPANTES, ErrParticipantes, TABLAS,
  limpiarIds, participantesDe, reemplazar, idsDe, nombreCompleto
};
