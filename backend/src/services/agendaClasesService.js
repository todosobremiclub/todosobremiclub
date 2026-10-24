// src/services/agendaClasesService.js
//
// CLASES / ENTRENAMIENTOS dentro de la Agenda.
// Una clase es una fila de agenda_actividades con tipo = 'clase' (puede ser de un
// día puntual o periódica, igual que cualquier actividad) más los socios
// asignados en agenda_actividades_socios. El socio las ve en la app en
// "Mis clases / entrenamientos" (GET /app/clases/mias).
//
// Este módulo NO sabe nada de Espacios y Clases (reservas de recursos).
'use strict';

const { generarOcurrencias, addDaysLocal, fechaISO } = require('./agendaRecurrencia');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SOCIOS = 500;
const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

class ErrNegocio extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ------------------------------------------------------------------
// Fechas (Argentina)
// ------------------------------------------------------------------
function hoyArgentina() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  return p; // YYYY-MM-DD
}
const dateDe = (iso) => new Date(`${iso}T00:00:00`);
const dmy = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };

/**
 * Texto de frecuencia, sin el horario: "Todos los lunes y miércoles",
 * "Cada 2 semanas: sábados", "Una vez: sáb 25/10/2026", "Todos los días"...
 * `a` usa los alias de las consultas: fecha_iso, recurrencia_*.
 */
function describirFrecuencia(a) {
  const base = dateDe(a.fecha_iso);
  const hasta = a.recurrencia_hasta ? ` (hasta el ${dmy(a.recurrencia_hasta)})` : '';
  if (!a.recurrencia_tipo) {
    return `Una vez: ${DIAS_CORTO[base.getDay()]} ${dmy(a.fecha_iso)}`;
  }
  const n = Math.max(1, Number(a.recurrencia_intervalo) || 1);
  switch (a.recurrencia_tipo) {
    case 'diario':
      return (n === 1 ? 'Todos los días' : `Cada ${n} días`) + hasta;
    case 'semanal': {
      const dias = (Array.isArray(a.recurrencia_dias_semana) && a.recurrencia_dias_semana.length
        ? a.recurrencia_dias_semana.map(Number) : [base.getDay()]);
      const ord = [...new Set(dias)].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => DIAS_LARGO[d]);
      const lista = ord.length > 1 ? `${ord.slice(0, -1).join(', ')} y ${ord[ord.length - 1]}` : ord[0];
      return (n === 1 ? `Todos los ${lista}` : `Cada ${n} semanas: ${lista}`) + hasta;
    }
    case 'mensual':
      return (n === 1 ? `El día ${base.getDate()} de cada mes` : `El día ${base.getDate()}, cada ${n} meses`) + hasta;
    case 'anual':
      return (n === 1 ? `Cada año el ${base.getDate()} de ${MESES[base.getMonth()]}` : `Cada ${n} años el ${base.getDate()} de ${MESES[base.getMonth()]}`) + hasta;
    default:
      return '';
  }
}

/** Próximas ocurrencias [{fecha, hora_desde, hora_hasta}] desde `desde` (inclusive). */
function proximasOcurrencias(a, { desde = hoyArgentina(), dias = 90, max = 6 } = {}) {
  const hasta = fechaISO(addDaysLocal(dateDe(desde), dias));
  return generarOcurrencias(a, desde, hasta)
    .slice(0, max)
    .map((d) => ({ fecha: fechaISO(d), hora_desde: a.hd, hora_hasta: a.hh }));
}

// ------------------------------------------------------------------
// Notificaciones (se resuelve al usarse; tests pueden reemplazarlo)
// ------------------------------------------------------------------
let _notificador = null;
function setNotificador(fn) { _notificador = fn; }
function avisarSocio(payload) {
  try {
    const fn = _notificador || require('./notificacionesService').notificarSocio;
    Promise.resolve(fn(payload)).catch((e) => console.error('⚠️ push clase:', e.message));
  } catch (e) {
    console.error('⚠️ push clase:', e.message);
  }
}

// ------------------------------------------------------------------
// Consultas
// ------------------------------------------------------------------
const SQL_CLASE = `
  a.id, a.titulo, a.descripcion,
  to_char(a.fecha::date, 'YYYY-MM-DD') AS fecha_iso,
  to_char(a.hora_desde::time, 'HH24:MI') AS hd,
  to_char(a.hora_hasta::time, 'HH24:MI') AS hh,
  a.recurrencia_tipo, a.recurrencia_intervalo, a.recurrencia_dias_semana,
  to_char(a.recurrencia_hasta::date, 'YYYY-MM-DD') AS recurrencia_hasta`;

/** Map actividad_id -> cantidad de socios asignados. Si falla (tabla sin migrar) devuelve vacío. */
async function contarAsignados(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    const r = await db.query(
      `SELECT actividad_id, COUNT(*)::int AS n FROM agenda_actividades_socios WHERE actividad_id = ANY($1::uuid[]) GROUP BY actividad_id`,
      [ids]
    );
    r.rows.forEach((x) => out.set(x.actividad_id, x.n));
  } catch (e) {
    console.error('⚠️ contarAsignados:', e.message);
  }
  return out;
}

/** Set de ids de clases a las que está asignado el socio (vacío si falla). */
async function clasesAsignadasA(db, socioId) {
  try {
    const r = await db.query(`SELECT actividad_id FROM agenda_actividades_socios WHERE socio_id = $1`, [socioId]);
    return new Set(r.rows.map((x) => x.actividad_id));
  } catch (e) {
    console.error('⚠️ clasesAsignadasA:', e.message);
    return new Set();
  }
}

async function listarSocios(db, { clubId, actividadId }) {
  const a = await db.query(`SELECT tipo FROM agenda_actividades WHERE id = $1 AND club_id = $2 AND activo = true`, [actividadId, clubId]);
  if (!a.rowCount) throw new ErrNegocio(404, 'Actividad no encontrada', 'actividad');
  const r = await db.query(
    `SELECT s.id AS socio_id, s.numero_socio, s.nombre, s.apellido, s.activo
       FROM agenda_actividades_socios x JOIN socios s ON s.id = x.socio_id
      WHERE x.actividad_id = $1
      ORDER BY lower(s.apellido), lower(s.nombre)`,
    [actividadId]
  );
  return r.rows;
}

/**
 * Reemplaza el conjunto de socios asignados a una clase. Avisa por push a los
 * que se suman y a los que se sacan. Devuelve { agregados, quitados, total }.
 */
async function reemplazarSocios(db, { clubId, actividadId, socioIds }) {
  if (!Array.isArray(socioIds)) throw new ErrNegocio(400, 'socioIds debe ser una lista', 'datos');
  const ids = [...new Set(socioIds.map(String))];
  if (ids.length > MAX_SOCIOS) throw new ErrNegocio(400, `Máximo ${MAX_SOCIOS} socios por clase`, 'datos');
  if (ids.some((x) => !UUID.test(x))) throw new ErrNegocio(400, 'Socio inválido', 'datos');

  const c = await db.getClient();
  let clase, nuevos, quitados;
  try {
    await c.query('BEGIN');
    const ra = await c.query(
      `SELECT ${SQL_CLASE}, a.tipo FROM agenda_actividades a WHERE a.id = $1 AND a.club_id = $2 AND a.activo = true FOR UPDATE`,
      [actividadId, clubId]
    );
    if (!ra.rowCount) throw new ErrNegocio(404, 'Actividad no encontrada', 'actividad');
    clase = ra.rows[0];
    if (clase.tipo !== 'clase') throw new ErrNegocio(400, 'Solo se asignan socios a actividades de tipo Clase / entrenamiento', 'tipo');

    const act = await c.query(`SELECT socio_id FROM agenda_actividades_socios WHERE actividad_id = $1`, [actividadId]);
    const actuales = new Set(act.rows.map((x) => x.socio_id));
    nuevos = ids.filter((x) => !actuales.has(x));
    quitados = [...actuales].filter((x) => !ids.includes(x));

    if (nuevos.length) {
      const v = await c.query(`SELECT id FROM socios WHERE club_id = $1 AND activo = true AND id = ANY($2::uuid[])`, [clubId, nuevos]);
      if (v.rowCount !== nuevos.length) throw new ErrNegocio(400, 'Algún socio no existe en este club o está inactivo', 'socio');
      for (const s of nuevos) {
        await c.query(`INSERT INTO agenda_actividades_socios (club_id, actividad_id, socio_id) VALUES ($1,$2,$3)`, [clubId, actividadId, s]);
      }
    }
    if (quitados.length) {
      await c.query(`DELETE FROM agenda_actividades_socios WHERE actividad_id = $1 AND socio_id = ANY($2::uuid[])`, [actividadId, quitados]);
    }
    await c.query('COMMIT');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ya cerrada */ }
    throw e;
  } finally {
    c.release();
  }

  const cuando = `${describirFrecuencia(clase)}, de ${clase.hd} a ${clase.hh}`;
  nuevos.forEach((socioId) => avisarSocio({
    clubId, socioId, titulo: '🎓 Te sumaron a una clase',
    cuerpo: `${clase.titulo}. ${cuando}.`, data: { type: 'clase_asignada', actividadId: String(actividadId) }
  }));
  quitados.forEach((socioId) => avisarSocio({
    clubId, socioId, titulo: '🎓 Baja de una clase',
    cuerpo: `Ya no estás asignado a "${clase.titulo}".`, data: { type: 'clase_baja', actividadId: String(actividadId) }
  }));
  return { agregados: nuevos.length, quitados: quitados.length, total: ids.length };
}

/** Clases / entrenamientos del socio con sus próximas fechas (para la app). */
async function clasesDelSocio(db, { clubId, socioId, max = 6 }) {
  const r = await db.query(
    `SELECT ${SQL_CLASE}
       FROM agenda_actividades_socios x
       JOIN agenda_actividades a ON a.id = x.actividad_id
      WHERE x.club_id = $1 AND x.socio_id = $2 AND a.activo = true AND a.tipo = 'clase'`,
    [clubId, socioId]
  );
  const hoy = hoyArgentina();
  const out = [];
  for (const a of r.rows) {
    const proximas = proximasOcurrencias(a, { desde: hoy, dias: 90, max });
    if (!proximas.length) continue; // clase finalizada o fecha puntual ya pasada
    out.push({
      id: a.id, titulo: a.titulo, descripcion: a.descripcion,
      hora_desde: a.hd, hora_hasta: a.hh,
      recurrente: !!a.recurrencia_tipo,
      frecuencia_texto: describirFrecuencia(a),
      proxima: proximas[0],
      proximas
    });
  }
  out.sort((x, y) => (x.proxima.fecha + x.proxima.hora_desde).localeCompare(y.proxima.fecha + y.proxima.hora_desde));
  return out;
}

module.exports = {
  ErrNegocio, setNotificador, describirFrecuencia, proximasOcurrencias, hoyArgentina,
  contarAsignados, clasesAsignadasA, listarSocios, reemplazarSocios, clasesDelSocio
};
