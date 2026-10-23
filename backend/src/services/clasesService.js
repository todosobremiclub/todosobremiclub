// src/services/clasesService.js
//
// CLASES (Espacios y Clases, Release B): clases grupales recurrentes con cupo.
//  - El club las agenda (horarios semanales o de un día puntual) y asigna socios.
//  - Si la clase tiene `recurso_id`, OCUPA el recurso en esos horarios (el motor de
//    disponibilidad ya las resta de los turnos). Al guardarla se valida que no pise
//    reservas pendientes/aceptadas, abonos ni otras clases del mismo recurso.
//  - "Cancelar una fecha" = fila en clases_excepciones (esa ocurrencia no existe).
//  - Las inscripciones las hace solo el club (v1); el socio las ve en la app.
const disp = require('./disponibilidadService');
const reservasSvc = require('./espaciosReservasService');

const { ErrNegocio, esFechaReal, enTransaccion } = reservasSvc;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORIZONTE_DIAS = 180;
const MAX_HORARIOS = 14;
const MAX_SOCIOS_POR_LLAMADA = 200;
const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const hoyAR = () => disp.ahoraArgentina().fecha;

// ------------------------------------------------------------------
// Validación
// ------------------------------------------------------------------
function validarHorarios(raw, hoy) {
  if (!Array.isArray(raw) || !raw.length) throw new ErrNegocio(400, 'Cargá al menos un horario', 'datos');
  if (raw.length > MAX_HORARIOS) throw new ErrNegocio(400, `Máximo ${MAX_HORARIOS} horarios por clase`, 'datos');
  return raw.map((h, i) => {
    const pre = raw.length > 1 ? `Horario ${i + 1}: ` : '';
    const tipo = String(h?.tipo || '').toLowerCase();
    if (!['semanal', 'fecha'].includes(tipo)) throw new ErrNegocio(400, `${pre}tipo inválido (semanal o fecha)`, 'datos');
    const hd = String(h.hora_desde || '').slice(0, 5), hh = String(h.hora_hasta || '').slice(0, 5);
    if (!HHMM.test(hd) || !HHMM.test(hh)) throw new ErrNegocio(400, `${pre}horario inválido (HH:MM)`, 'datos');
    if (hd >= hh) throw new ErrNegocio(400, `${pre}la hora de inicio debe ser anterior a la de fin`, 'datos');
    const out = { tipo, hora_desde: hd, hora_hasta: hh, dia_semana: null, fecha: null, vigente_desde: null, vigente_hasta: null };
    if (tipo === 'semanal') {
      const d = Number(h.dia_semana);
      if (!Number.isInteger(d) || d < 0 || d > 6) throw new ErrNegocio(400, `${pre}día de la semana inválido`, 'datos');
      out.dia_semana = d;
      for (const k of ['vigente_desde', 'vigente_hasta']) {
        if (h[k]) {
          if (!esFechaReal(String(h[k]))) throw new ErrNegocio(400, `${pre}${k} inválida (YYYY-MM-DD)`, 'datos');
          out[k] = String(h[k]);
        }
      }
      if (out.vigente_desde && out.vigente_hasta && out.vigente_hasta < out.vigente_desde) {
        throw new ErrNegocio(400, `${pre}la vigencia "hasta" no puede ser anterior a "desde"`, 'datos');
      }
    } else {
      if (!esFechaReal(String(h.fecha || ''))) throw new ErrNegocio(400, `${pre}fecha inválida (YYYY-MM-DD)`, 'datos');
      if (String(h.fecha) < hoy) throw new ErrNegocio(400, `${pre}la fecha ya pasó`, 'datos');
      out.fecha = String(h.fecha);
    }
    return out;
  });
}

function validarDatos(b, hoy) {
  const nombre = String(b.nombre ?? '').trim();
  if (!nombre) throw new ErrNegocio(400, 'Falta el nombre de la clase', 'datos');
  if (nombre.length > 120) throw new ErrNegocio(400, 'El nombre es demasiado largo (máx. 120)', 'datos');
  let cupo = null;
  if (b.cupo !== undefined && b.cupo !== null && b.cupo !== '') {
    cupo = Number(b.cupo);
    if (!Number.isInteger(cupo) || cupo < 1 || cupo > 100000) throw new ErrNegocio(400, 'Cupo inválido (entero mayor a 0, o vacío para sin límite)', 'datos');
  }
  let color = null;
  if (b.color) {
    color = String(b.color).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ErrNegocio(400, 'Color inválido (formato #RRGGBB)', 'datos');
  }
  let recursoId = null;
  if (b.recurso_id) {
    if (!UUID.test(String(b.recurso_id))) throw new ErrNegocio(400, 'Recurso inválido', 'datos');
    recursoId = String(b.recurso_id);
  }
  return {
    nombre,
    descripcion: String(b.descripcion ?? '').trim().slice(0, 500) || null,
    profesor: String(b.profesor ?? '').trim().slice(0, 120) || null,
    cupo, color, recursoId,
    horarios: validarHorarios(b.horarios, hoy)
  };
}

// ------------------------------------------------------------------
// Ocurrencias y conflictos (funciones puras)
// ------------------------------------------------------------------
/**
 * Expande horarios a ocurrencias. Con `marcarCanceladas` las fechas en excepciones
 * se devuelven con cancelada:true (para la app); si no, se omiten.
 */
function ocurrencias({ horarios, excepciones = [], desde, hasta, marcarCanceladas = false }) {
  const out = [];
  const exc = new Map(excepciones.map((e) => [e.fecha, e.motivo || null]));
  for (let f = desde; f <= hasta; f = disp.addDays(f, 1)) {
    for (const h of horarios) {
      if (!disp.aplicaRegla(h, f)) continue;
      const cancelada = exc.has(f);
      if (cancelada && !marcarCanceladas) continue;
      const o = { fecha: f, hora_desde: String(h.hora_desde).slice(0, 5), hora_hasta: String(h.hora_hasta).slice(0, 5) };
      if (marcarCanceladas) { o.cancelada = cancelada; o.motivo_cancelacion = cancelada ? exc.get(f) : null; }
      out.push(o);
    }
  }
  return out.sort((a, b) => (a.fecha + a.hora_desde).localeCompare(b.fecha + b.hora_desde));
}

/**
 * Cruza las ocurrencias de una clase con lo que ya ocupa el recurso.
 * ctx: salida de disp.cargarContexto (reservas, abonos, excepcionesAbono, clases).
 */
function conflictosClase({ ocurrencias: occs, ctx, claseId = null }) {
  const out = [];
  const visto = new Set();
  const add = (key, c) => { if (!visto.has(key)) { visto.add(key); out.push(c); } };
  for (const o of occs) {
    const a1 = disp.toMin(o.hora_desde), a2 = disp.toMin(o.hora_hasta);
    for (const r of ctx.reservas || []) {
      if (r.fecha !== o.fecha || !['pendiente', 'aceptada'].includes(r.estado)) continue;
      if (overlap(a1, a2, disp.toMin(r.hora_desde), disp.toMin(r.hora_hasta))) {
        add(`r:${r.id}`, { tipo: 'reserva', reserva_id: r.id, fecha: r.fecha, desde: r.hora_desde, hasta: r.hora_hasta, estado: r.estado, socio_id: r.socio_id || null, nombre_externo: r.nombre_externo || null });
      }
    }
    for (const ab of ctx.abonos || []) {
      if (ab.estado && ab.estado !== 'activo') continue;
      if (Number(ab.dia_semana) !== disp.dow(o.fecha)) continue;
      if ((ab.vigente_desde && o.fecha < ab.vigente_desde) || (ab.vigente_hasta && o.fecha > ab.vigente_hasta)) continue;
      if ((ctx.excepcionesAbono || []).some((e) => e.abono_id === ab.id && o.fecha >= e.fecha_desde && o.fecha <= e.fecha_hasta)) continue;
      if (overlap(a1, a2, disp.toMin(ab.hora_desde), disp.toMin(ab.hora_hasta))) {
        add(`a:${ab.id}:${o.fecha}`, { tipo: 'abono', abono_id: ab.id, fecha: o.fecha, desde: ab.hora_desde, hasta: ab.hora_hasta, socio_id: ab.socio_id || null, nombre_externo: ab.nombre_externo || null });
      }
    }
    for (const c of ctx.clases || []) {
      if (c.clase_id === claseId || c.fecha !== o.fecha) continue;
      if (overlap(a1, a2, disp.toMin(c.hora_desde), disp.toMin(c.hora_hasta))) {
        add(`c:${c.clase_id}:${c.fecha}:${c.hora_desde}`, { tipo: 'clase', clase_id: c.clase_id, nombre: c.nombre, fecha: c.fecha, desde: c.hora_desde, hasta: c.hora_hasta });
      }
    }
  }
  return out;
}

// "lun y mié 18:00–19:00 · sáb 10:00–11:00" (para los push)
function horariosTexto(horarios) {
  const grupos = new Map();
  const extra = [];
  for (const h of horarios) {
    const rango = `${String(h.hora_desde).slice(0, 5)}–${String(h.hora_hasta).slice(0, 5)}`;
    if (h.tipo === 'semanal') {
      if (!grupos.has(rango)) grupos.set(rango, []);
      grupos.get(rango).push(Number(h.dia_semana));
    } else {
      const [, m, d] = String(h.fecha).split('-');
      extra.push(`${d}/${m} ${rango}`);
    }
  }
  const partes = [];
  for (const [rango, dias] of grupos) {
    const orden = [...new Set(dias)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DIAS_CORTO[d]);
    const dd = orden.length > 1 ? `${orden.slice(0, -1).join(', ')} y ${orden[orden.length - 1]}` : orden[0];
    partes.push(`${dd} ${rango}`);
  }
  return [...partes, ...extra].join(' · ');
}

// ------------------------------------------------------------------
// Acceso a datos
// ------------------------------------------------------------------
const SQL_H = `id, clase_id, tipo, dia_semana,
  to_char(fecha,'YYYY-MM-DD') AS fecha,
  to_char(hora_desde,'HH24:MI') AS hora_desde, to_char(hora_hasta,'HH24:MI') AS hora_hasta,
  to_char(vigente_desde,'YYYY-MM-DD') AS vigente_desde, to_char(vigente_hasta,'YYYY-MM-DD') AS vigente_hasta`;

async function horariosDe(q, ids) {
  if (!ids.length) return new Map();
  const r = await q.query(
    `SELECT ${SQL_H} FROM clases_horarios WHERE clase_id = ANY($1::uuid[])
      ORDER BY tipo, dia_semana, fecha, hora_desde`,
    [ids]
  );
  const m = new Map();
  for (const h of r.rows) { if (!m.has(h.clase_id)) m.set(h.clase_id, []); m.get(h.clase_id).push(h); }
  return m;
}
async function excepcionesDe(q, ids, desde) {
  if (!ids.length) return new Map();
  const r = await q.query(
    `SELECT id, clase_id, to_char(fecha,'YYYY-MM-DD') AS fecha, motivo
       FROM clases_excepciones WHERE clase_id = ANY($1::uuid[]) AND fecha >= $2::date ORDER BY fecha`,
    [ids, desde]
  );
  const m = new Map();
  for (const e of r.rows) { if (!m.has(e.clase_id)) m.set(e.clase_id, []); m.get(e.clase_id).push(e); }
  return m;
}

const SQL_CLASE = `
  c.id, c.club_id, c.nombre, c.descripcion, c.profesor, c.recurso_id, rec.nombre AS recurso_nombre,
  c.cupo, c.color, c.activo, c.created_at,
  (SELECT COUNT(*) FROM clases_socios cs WHERE cs.clase_id = c.id AND cs.estado = 'activo')::int AS inscriptos`;

// Primera ocurrencia (>= hoy) no cancelada
function proximaFecha(horarios, excepciones, hoy) {
  const occ = ocurrencias({ horarios, excepciones, desde: hoy, hasta: disp.addDays(hoy, 400) });
  return occ.length ? occ[0] : null;
}

async function listarClases(db, { clubId, soloActivas = false, clubInfoSocioId = null }) {
  const hoy = hoyAR();
  const r = await db.query(
    `SELECT ${SQL_CLASE}
       ${clubInfoSocioId ? `, EXISTS (SELECT 1 FROM clases_socios x WHERE x.clase_id = c.id AND x.socio_id = $2 AND x.estado = 'activo') AS inscripto` : ''}
       FROM clases c LEFT JOIN recursos rec ON rec.id = c.recurso_id
      WHERE c.club_id = $1 ${soloActivas ? 'AND c.activo = TRUE' : ''}
      ORDER BY c.activo DESC, lower(c.nombre)`,
    clubInfoSocioId ? [clubId, clubInfoSocioId] : [clubId]
  );
  const ids = r.rows.map((c) => c.id);
  const [hm, em] = await Promise.all([horariosDe(db, ids), excepcionesDe(db, ids, hoy)]);
  return r.rows.map((c) => {
    const horarios = hm.get(c.id) || [];
    const excs = em.get(c.id) || [];
    return { ...c, horarios, excepciones: excs, horarios_texto: horariosTexto(horarios), proxima: proximaFecha(horarios, excs, hoy) };
  });
}

async function obtenerClase(q, { clubId, id, forUpdate = false }) {
  if (forUpdate) {
    const l = await q.query(`SELECT id FROM clases WHERE id = $1 AND club_id = $2 FOR UPDATE`, [id, clubId]);
    if (!l.rowCount) return null;
  }
  const r = await q.query(
    `SELECT ${SQL_CLASE} FROM clases c LEFT JOIN recursos rec ON rec.id = c.recurso_id WHERE c.id = $1 AND c.club_id = $2`,
    [id, clubId]
  );
  if (!r.rowCount) return null;
  const hoy = hoyAR();
  const [hm, em] = await Promise.all([horariosDe(q, [id]), excepcionesDe(q, [id], hoy)]);
  const horarios = hm.get(id) || [];
  const excs = em.get(id) || [];
  return { ...r.rows[0], horarios, excepciones: excs, horarios_texto: horariosTexto(horarios), proxima: proximaFecha(horarios, excs, hoy) };
}

async function nombresReservas(q, conflictos) {
  const sids = [...new Set(conflictos.map((c) => c.socio_id).filter(Boolean))];
  if (!sids.length) return conflictos;
  const rs = await q.query(`SELECT id, nombre, apellido FROM socios WHERE id = ANY($1::uuid[])`, [sids]);
  const m = new Map(rs.rows.map((s) => [s.id, `${s.apellido ?? ''}, ${s.nombre ?? ''}`.replace(/^, |, $/g, '').trim()]));
  return conflictos.map((c) => ({ ...c, titular: c.socio_id ? m.get(c.socio_id) : c.nombre_externo }));
}

// Valida que las ocurrencias futuras no pisen nada del recurso. Lanza 409 con la lista.
async function validarRecursoLibre(c, { clubId, recursoId, horarios, excepciones, claseId, hoy }) {
  const hasta = disp.addDays(hoy, HORIZONTE_DIAS);
  const occs = ocurrencias({ horarios, excepciones, desde: hoy, hasta });
  if (!occs.length) return;
  const ctx = await disp.cargarContexto(c, { clubId, recursoId, desde: hoy, hasta });
  if (!ctx) throw new ErrNegocio(404, 'Recurso no encontrado', 'recurso');
  const conf = conflictosClase({ ocurrencias: occs, ctx, claseId });
  if (conf.length) {
    const lista = await nombresReservas(c, conf);
    throw new ErrNegocio(
      409,
      `La clase se superpone con ${lista.length} ${lista.length === 1 ? 'turno ya ocupado' : 'turnos ya ocupados'} de ese recurso. Cancelá o mové esas reservas/abonos primero.`,
      'conflictos',
      { conflictos: lista }
    );
  }
}

async function guardarClase(db, { clubId, id = null, body }) {
  const hoy = hoyAR();
  const d = validarDatos(body || {}, hoy);
  const activoBody = body.activo === undefined ? undefined : (body.activo === true || body.activo === 'true');

  return enTransaccion(db, async (c) => {
    let previa = null;
    if (id) {
      previa = await obtenerClase(c, { clubId, id, forUpdate: true });
      if (!previa) throw new ErrNegocio(404, 'Clase no encontrada', 'clase');
    }
    const activo = activoBody === undefined ? (previa ? previa.activo : true) : activoBody;

    if (d.recursoId) {
      const rr = await c.query(`SELECT id, activo FROM recursos WHERE id = $1 AND club_id = $2 FOR UPDATE`, [d.recursoId, clubId]);
      if (!rr.rowCount) throw new ErrNegocio(404, 'Recurso no encontrado', 'recurso');
      if (!rr.rows[0].activo) throw new ErrNegocio(400, 'Ese recurso no está activo', 'recurso_inactivo');
    }
    if (previa && d.cupo !== null && d.cupo < previa.inscriptos) {
      throw new ErrNegocio(409, `El cupo (${d.cupo}) no puede ser menor a los inscriptos actuales (${previa.inscriptos}). Dá de baja a alguien primero.`, 'cupo', { cupo: d.cupo, inscriptos: previa.inscriptos });
    }
    if (d.recursoId && activo) {
      const excs = previa ? (await excepcionesDe(c, [id], hoy)).get(id) || [] : [];
      await validarRecursoLibre(c, { clubId, recursoId: d.recursoId, horarios: d.horarios, excepciones: excs, claseId: id, hoy });
    }

    let claseId = id;
    if (!id) {
      const ins = await c.query(
        `INSERT INTO clases (club_id, nombre, descripcion, profesor, recurso_id, cupo, color, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [clubId, d.nombre, d.descripcion, d.profesor, d.recursoId, d.cupo, d.color, activo]
      );
      claseId = ins.rows[0].id;
    } else {
      await c.query(
        `UPDATE clases SET nombre=$1, descripcion=$2, profesor=$3, recurso_id=$4, cupo=$5, color=$6, activo=$7 WHERE id=$8`,
        [d.nombre, d.descripcion, d.profesor, d.recursoId, d.cupo, d.color, activo, id]
      );
      await c.query(`DELETE FROM clases_horarios WHERE clase_id = $1`, [id]);
    }
    for (const h of d.horarios) {
      await c.query(
        `INSERT INTO clases_horarios (clase_id, tipo, dia_semana, fecha, hora_desde, hora_hasta, vigente_desde, vigente_hasta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [claseId, h.tipo, h.dia_semana, h.fecha, h.hora_desde, h.hora_hasta, h.vigente_desde, h.vigente_hasta]
      );
    }
    return obtenerClase(c, { clubId, id: claseId });
  });
}

// Borra si nunca tuvo inscriptos; si tuvo, la desactiva (queda el historial).
async function eliminarClase(db, { clubId, id }) {
  return enTransaccion(db, async (c) => {
    const cl = await obtenerClase(c, { clubId, id, forUpdate: true });
    if (!cl) throw new ErrNegocio(404, 'Clase no encontrada', 'clase');
    const h = await c.query(`SELECT COUNT(*)::int AS n FROM clases_socios WHERE clase_id = $1`, [id]);
    if (h.rows[0].n > 0) {
      await c.query(`UPDATE clases SET activo = FALSE WHERE id = $1`, [id]);
      return { desactivada: true, motivo: 'La clase tiene inscriptos en su historial, por eso se desactivó en lugar de borrarse.' };
    }
    await c.query(`DELETE FROM clases WHERE id = $1`, [id]); // horarios y excepciones: ON DELETE CASCADE
    return { desactivada: false };
  });
}

// ------------------------------------------------------------------
// Fechas canceladas
// ------------------------------------------------------------------
async function agregarExcepcion(db, { clubId, id, fecha, motivo }) {
  const hoy = hoyAR();
  const f = String(fecha || '');
  if (!esFechaReal(f)) throw new ErrNegocio(400, 'Fecha inválida (YYYY-MM-DD)', 'datos');
  if (f < hoy) throw new ErrNegocio(400, 'Esa fecha ya pasó', 'datos');
  const m = String(motivo || '').trim().slice(0, 120) || null;

  const out = await enTransaccion(db, async (c) => {
    const cl = await obtenerClase(c, { clubId, id, forUpdate: true });
    if (!cl) throw new ErrNegocio(404, 'Clase no encontrada', 'clase');
    if (!ocurrencias({ horarios: cl.horarios, desde: f, hasta: f }).length) {
      throw new ErrNegocio(400, 'La clase no se dicta ese día', 'datos');
    }
    const dup = await c.query(`SELECT 1 FROM clases_excepciones WHERE clase_id = $1 AND fecha = $2::date`, [id, f]);
    if (dup.rowCount) throw new ErrNegocio(409, 'Esa fecha ya está cancelada', 'duplicada');
    const ins = await c.query(
      `INSERT INTO clases_excepciones (clase_id, fecha, motivo) VALUES ($1,$2,$3)
       RETURNING id, to_char(fecha,'YYYY-MM-DD') AS fecha, motivo`,
      [id, f, m]
    );
    const socios = await c.query(
      `SELECT socio_id FROM clases_socios WHERE clase_id = $1 AND estado = 'activo'`, [id]
    );
    return { excepcion: ins.rows[0], clase: cl, socios: socios.rows.map((x) => x.socio_id) };
  });

  const [, mm, dd] = f.split('-');
  for (const socioId of out.socios) {
    reservasSvc.avisarSocio({
      clubId, socioId,
      titulo: '📚 Clase cancelada',
      cuerpo: `La clase de ${out.clase.nombre} del ${DIAS_CORTO[disp.dow(f)]} ${dd}/${mm} no se dicta.${m ? ` Motivo: ${m}` : ''}`,
      data: { type: 'clase_cancelada', claseId: String(id) }
    });
  }
  return out.excepcion;
}

// Volver a dictar esa fecha: si el recurso se ocupó mientras tanto, se rechaza con la lista.
async function quitarExcepcion(db, { clubId, id, excId }) {
  const hoy = hoyAR();
  return enTransaccion(db, async (c) => {
    const cl = await obtenerClase(c, { clubId, id, forUpdate: true });
    if (!cl) throw new ErrNegocio(404, 'Clase no encontrada', 'clase');
    const re = await c.query(`SELECT id, to_char(fecha,'YYYY-MM-DD') AS fecha FROM clases_excepciones WHERE id = $1 AND clase_id = $2`, [excId, id]);
    if (!re.rowCount) throw new ErrNegocio(404, 'Excepción no encontrada', 'excepcion');
    const f = re.rows[0].fecha;
    if (cl.recurso_id && cl.activo && f >= hoy) {
      await c.query(`SELECT id FROM recursos WHERE id = $1 FOR UPDATE`, [cl.recurso_id]);
      const occs = ocurrencias({ horarios: cl.horarios, desde: f, hasta: f });
      if (occs.length) {
        const ctx = await disp.cargarContexto(c, { clubId, recursoId: cl.recurso_id, desde: f, hasta: f });
        const conf = conflictosClase({ ocurrencias: occs, ctx, claseId: id });
        if (conf.length) {
          throw new ErrNegocio(409, 'Ese día el recurso ya fue ocupado por otra persona. No se puede volver a dictar la clase esa fecha.', 'conflictos', { conflictos: await nombresReservas(c, conf) });
        }
      }
    }
    await c.query(`DELETE FROM clases_excepciones WHERE id = $1`, [excId]);
    return { id: excId };
  });
}

// ------------------------------------------------------------------
// Inscriptos
// ------------------------------------------------------------------
async function listarInscriptos(db, { clubId, id }) {
  const cl = await db.query(`SELECT id FROM clases WHERE id = $1 AND club_id = $2`, [id, clubId]);
  if (!cl.rowCount) throw new ErrNegocio(404, 'Clase no encontrada', 'clase');
  const r = await db.query(
    `SELECT s.id AS socio_id, s.numero_socio, s.nombre, s.apellido, s.activo AS socio_activo,
            to_char(cs.desde,'YYYY-MM-DD') AS desde
       FROM clases_socios cs JOIN socios s ON s.id = cs.socio_id
      WHERE cs.clase_id = $1 AND cs.estado = 'activo'
      ORDER BY lower(s.apellido), lower(s.nombre)`,
    [id]
  );
  return r.rows;
}

async function inscribir(db, { clubId, id, socioIds }) {
  const ids = [...new Set((Array.isArray(socioIds) ? socioIds : []).map(String))];
  if (!ids.length) throw new ErrNegocio(400, 'Elegí al menos un socio', 'datos');
  if (ids.length > MAX_SOCIOS_POR_LLAMADA) throw new ErrNegocio(400, `Máximo ${MAX_SOCIOS_POR_LLAMADA} socios por vez`, 'datos');
  if (ids.some((x) => !UUID.test(x))) throw new ErrNegocio(400, 'Socio inválido', 'datos');

  const out = await enTransaccion(db, async (c) => {
    const cl = await obtenerClase(c, { clubId, id, forUpdate: true });
    if (!cl) throw new ErrNegocio(404, 'Clase no encontrada', 'clase');
    if (!cl.activo) throw new ErrNegocio(400, 'La clase está desactivada', 'clase_inactiva');

    const rs = await c.query(`SELECT id, activo FROM socios WHERE club_id = $1 AND id = ANY($2::uuid[])`, [clubId, ids]);
    if (rs.rowCount !== ids.length) throw new ErrNegocio(404, 'Algún socio no existe en este club', 'socio');
    if (rs.rows.some((s) => s.activo !== true)) throw new ErrNegocio(400, 'Solo se pueden inscribir socios activos', 'socio_inactivo');

    const ya = await c.query(`SELECT socio_id FROM clases_socios WHERE clase_id = $1 AND estado = 'activo' AND socio_id = ANY($2::uuid[])`, [id, ids]);
    const yaSet = new Set(ya.rows.map((x) => x.socio_id));
    const nuevos = ids.filter((x) => !yaSet.has(x));

    if (cl.cupo !== null && cl.inscriptos + nuevos.length > cl.cupo) {
      throw new ErrNegocio(
        409,
        `No hay cupo: la clase tiene ${cl.inscriptos} de ${cl.cupo} lugares ocupados y querés sumar ${nuevos.length}.`,
        'cupo',
        { cupo: cl.cupo, inscriptos: cl.inscriptos, lugares_libres: Math.max(cl.cupo - cl.inscriptos, 0) }
      );
    }
    for (const s of nuevos) {
      await c.query(`INSERT INTO clases_socios (club_id, clase_id, socio_id, desde) VALUES ($1,$2,$3,$4::date)`, [clubId, id, s, hoyAR()]);
    }
    return { clase: cl, nuevos, yaInscriptos: [...yaSet] };
  });

  for (const socioId of out.nuevos) {
    reservasSvc.avisarSocio({
      clubId, socioId,
      titulo: '📚 Te inscribieron en una clase',
      cuerpo: `${out.clase.nombre}${out.clase.profesor ? ` con ${out.clase.profesor}` : ''}: ${out.clase.horarios_texto}${out.clase.recurso_nombre ? ` (${out.clase.recurso_nombre})` : ''}.`,
      data: { type: 'clase_inscripcion', claseId: String(id) }
    });
  }
  return { inscriptos_nuevos: out.nuevos.length, ya_inscriptos: out.yaInscriptos.length };
}

async function darDeBaja(db, { clubId, id, socioId }) {
  const out = await enTransaccion(db, async (c) => {
    const cl = await obtenerClase(c, { clubId, id, forUpdate: true });
    if (!cl) throw new ErrNegocio(404, 'Clase no encontrada', 'clase');
    const r = await c.query(
      `UPDATE clases_socios SET estado = 'baja', hasta = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        WHERE clase_id = $1 AND socio_id = $2 AND estado = 'activo'`,
      [id, socioId]
    );
    if (!r.rowCount) throw new ErrNegocio(404, 'Ese socio no está inscripto en la clase', 'socio');
    return cl;
  });
  reservasSvc.avisarSocio({
    clubId, socioId,
    titulo: '📚 Baja de clase',
    cuerpo: `Dejaste de estar inscripto en ${out.nombre}.`,
    data: { type: 'clase_baja', claseId: String(id) }
  });
  return { ok: true };
}

// ------------------------------------------------------------------
// Calendario (ocurrencias expandidas)
// ------------------------------------------------------------------
async function calendario(db, { clubId, desde, hasta, claseId = null, recursoId = null }) {
  if (!esFechaReal(desde) || !esFechaReal(hasta) || hasta < desde) throw new ErrNegocio(400, 'Rango de fechas inválido', 'datos');
  if (disp.daysBetween(desde, hasta) + 1 > 62) throw new ErrNegocio(400, 'El rango máximo es de 62 días', 'datos');
  const clases = (await listarClases(db, { clubId, soloActivas: true }))
    .filter((c) => (!claseId || c.id === claseId) && (!recursoId || c.recurso_id === recursoId));
  const ids = clases.map((c) => c.id);
  const exc = ids.length
    ? await db.query(`SELECT clase_id, to_char(fecha,'YYYY-MM-DD') AS fecha, motivo FROM clases_excepciones WHERE clase_id = ANY($1::uuid[]) AND fecha BETWEEN $2::date AND $3::date`, [ids, desde, hasta])
    : { rows: [] };
  const out = [];
  for (const c of clases) {
    const e = exc.rows.filter((x) => x.clase_id === c.id);
    for (const o of ocurrencias({ horarios: c.horarios, excepciones: e, desde, hasta, marcarCanceladas: true })) {
      out.push({
        clase_id: c.id, nombre: c.nombre, color: c.color, profesor: c.profesor,
        recurso_id: c.recurso_id, recurso_nombre: c.recurso_nombre, cupo: c.cupo, inscriptos: c.inscriptos, ...o
      });
    }
  }
  return out.sort((a, b) => (a.fecha + a.hora_desde).localeCompare(b.fecha + b.hora_desde));
}

// ------------------------------------------------------------------
// App del socio
// ------------------------------------------------------------------
function paraApp(c, { proximas = 0 } = {}) {
  const hoy = hoyAR();
  const base = {
    id: c.id, nombre: c.nombre, descripcion: c.descripcion, profesor: c.profesor,
    recurso_nombre: c.recurso_nombre, cupo: c.cupo, inscriptos: c.inscriptos, color: c.color,
    inscripto: c.inscripto === true, horarios: c.horarios, horarios_texto: c.horarios_texto,
    proxima_fecha: c.proxima ? c.proxima.fecha : null,
    proxima_hora_desde: c.proxima ? c.proxima.hora_desde : null,
    proxima_hora_hasta: c.proxima ? c.proxima.hora_hasta : null
  };
  if (proximas > 0) {
    const occ = ocurrencias({
      horarios: c.horarios, excepciones: c.excepciones, desde: hoy, hasta: disp.addDays(hoy, 60), marcarCanceladas: true
    });
    base.proximas = occ.slice(0, proximas);
  }
  return base;
}

async function clasesParaApp(db, { clubId, socioId }) {
  const l = await listarClases(db, { clubId, soloActivas: true, clubInfoSocioId: socioId });
  return l.map((c) => paraApp(c));
}
async function misClasesParaApp(db, { clubId, socioId }) {
  const l = await listarClases(db, { clubId, soloActivas: true, clubInfoSocioId: socioId });
  return l.filter((c) => c.inscripto).map((c) => paraApp(c, { proximas: 6 }));
}

module.exports = {
  HORIZONTE_DIAS, validarDatos, validarHorarios, ocurrencias, conflictosClase, horariosTexto,
  listarClases, obtenerClase, guardarClase, eliminarClase,
  agregarExcepcion, quitarExcepcion, listarInscriptos, inscribir, darDeBaja, calendario,
  clasesParaApp, misClasesParaApp
};
