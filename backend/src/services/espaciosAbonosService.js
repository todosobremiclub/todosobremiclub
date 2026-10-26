// src/services/espaciosAbonosService.js
//
// ABONOS de recursos (Espacios y Clases, paso 8): reserva fija semanal
// (mismo día y hora todas las semanas) SIN fecha de finalización.
//  - No se guardan filas por semana: las ocurrencias se calculan al vuelo
//    (disponibilidadService las considera al armar los turnos).
//  - Fechas liberadas (vacaciones / "esta semana no viene"): tabla
//    recursos_abonos_excepciones; esos días el turno queda libre para otros.
//  - "Dar de baja" = fijar vigente_hasta (por defecto hoy, inclusive): el
//    abono sigue ocupando hasta esa fecha y después deja de aplicar solo.
//    Un abono "finalizado" es uno con vigente_hasta < hoy.
//  - Al crear: el horario tiene que ser un turno de la grilla del recurso para
//    ese día de la semana, y no puede pisar otro abono, reservas
//    pendientes/aceptadas futuras ni clases. Si pisa -> 409 con la lista.
const disp = require('./disponibilidadService');
const reservasSvc = require('./espaciosReservasService');
const part = require('./espaciosParticipantesService');
const { ErrNegocio, esFechaReal } = reservasSvc;

const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HORIZONTE_CLASES_DIAS = 180;

// Los errores del servicio de participantes se devuelven como errores de negocio
async function conParticipantes(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof part.ErrParticipantes) throw new ErrNegocio(e.status, e.message, e.code);
    throw e;
  }
}
const descAbono = (a) =>
  `${a.recurso_nombre}, todos los ${DIAS_LARGO[a.dia_semana]} de ${a.hora_desde} a ${a.hora_hasta}`;
const MAX_RANGO_EXCEPCION_DIAS = 366;

const SQL_ABONO = `
  a.id, a.club_id, a.recurso_id, rec.nombre AS recurso_nombre,
  a.socio_id, a.nombre_externo, a.contacto_externo, a.dia_semana,
  to_char(a.hora_desde, 'HH24:MI') AS hora_desde,
  to_char(a.hora_hasta, 'HH24:MI') AS hora_hasta,
  to_char(a.vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
  to_char(a.vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta,
  a.estado, a.notas, a.created_at`;

// ¿Está liberada esa fecha por alguna excepción?
const liberada = (excs, fecha) => excs.some((e) => fecha >= e.fecha_desde && fecha <= e.fecha_hasta);

// Próxima fecha (>= hoy) en la que el abono ocupa el turno; null si ya finalizó.
function proximaFecha(abono, excepciones, hoy) {
  let f = abono.vigente_desde > hoy ? abono.vigente_desde : hoy;
  for (let i = 0; i < 7 && disp.dow(f) !== Number(abono.dia_semana); i++) f = disp.addDays(f, 1);
  for (let k = 0; k < 120; k++, f = disp.addDays(f, 7)) { // ~2 años de semanas
    if (abono.vigente_hasta && f > abono.vigente_hasta) return null;
    if (!liberada(excepciones, f)) return f;
  }
  return null;
}

const estadoCalculado = (a, hoy) =>
  a.vigente_hasta && a.vigente_hasta < hoy ? 'finalizado' : 'vigente';

async function excepcionesDe(q, ids, hoy) {
  if (!ids.length) return new Map();
  const r = await q.query(
    `SELECT id, abono_id, motivo,
            to_char(fecha_desde, 'YYYY-MM-DD') AS fecha_desde,
            to_char(fecha_hasta, 'YYYY-MM-DD') AS fecha_hasta
       FROM recursos_abonos_excepciones
      WHERE abono_id = ANY($1::uuid[]) AND fecha_hasta >= $2::date
      ORDER BY fecha_desde`,
    [ids, hoy]
  );
  const m = new Map();
  for (const e of r.rows) {
    if (!m.has(e.abono_id)) m.set(e.abono_id, []);
    m.get(e.abono_id).push(e);
  }
  return m;
}

// Adjunta proxima_fecha, excepciones futuras, estado calculado y titular
async function enriquecer(q, clubId, filas) {
  const hoy = disp.ahoraArgentina().fecha;
  const exc = await excepcionesDe(q, filas.map((a) => a.id), hoy);
  const ids = [...new Set(filas.map((a) => a.socio_id).filter(Boolean))];
  const socios = new Map();
  if (ids.length) {
    const rs = await q.query(
      `SELECT id, nombre, apellido, numero_socio FROM socios WHERE club_id = $1 AND id = ANY($2::uuid[])`,
      [clubId, ids]
    );
    rs.rows.forEach((s) => socios.set(s.id, s));
  }
  const participantes = await part.participantesDe(q, { clubId, tipo: 'abono', ids: filas.map((a) => a.id) });
  return filas.map((a) => {
    const excs = exc.get(a.id) || [];
    const s = a.socio_id ? socios.get(a.socio_id) : null;
    return {
      ...a,
      participantes: participantes.get(a.id) || [],
      titular: s ? `${s.apellido ?? ''}, ${s.nombre ?? ''}`.replace(/^, |, $/g, '').trim() : a.nombre_externo,
      numero_socio: s ? s.numero_socio : null,
      estado_calculado: estadoCalculado(a, hoy),
      proxima_fecha: proximaFecha(a, excs, hoy),
      excepciones: excs
    };
  });
}

async function obtenerAbono(q, { clubId, id, forUpdate = false }) {
  const r = await q.query(
    `SELECT ${SQL_ABONO} FROM recursos_abonos a JOIN recursos rec ON rec.id = a.recurso_id
      WHERE a.id = $1 AND a.club_id = $2 ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [id, clubId]
  );
  return r.rows[0] || null;
}

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

// ---------------------------------------------------------------- listar
async function listarAbonos(db, { clubId, recursoId, socioId, estado }) {
  const where = ['a.club_id = $1'];
  const params = [clubId];
  if (recursoId) { params.push(recursoId); where.push(`a.recurso_id = $${params.length}`); }
  if (socioId) {
    params.push(socioId);
    where.push(`(a.socio_id = $${params.length} OR EXISTS (
      SELECT 1 FROM recursos_abonos_socios x WHERE x.abono_id = a.id AND x.socio_id = $${params.length}))`);
  }
  const hoy = disp.ahoraArgentina().fecha;
  if (estado === 'vigente') { params.push(hoy); where.push(`(a.vigente_hasta IS NULL OR a.vigente_hasta >= $${params.length}::date)`); }
  if (estado === 'finalizado') { params.push(hoy); where.push(`(a.vigente_hasta IS NOT NULL AND a.vigente_hasta < $${params.length}::date)`); }
  const r = await db.query(
    `SELECT ${SQL_ABONO} FROM recursos_abonos a JOIN recursos rec ON rec.id = a.recurso_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.dia_semana, a.hora_desde, a.created_at LIMIT 500`,
    params
  );
  return enriquecer(db, clubId, r.rows);
}

// ---------------------------------------------------------------- crear
async function crearAbono(db, p) {
  const hoy = disp.ahoraArgentina().fecha;
  const dia = Number(p.diaSemana);
  const horaDesde = String(p.horaDesde || '').slice(0, 5);
  const horaHasta = String(p.horaHasta || '').slice(0, 5);
  if (!p.recursoId) throw new ErrNegocio(400, 'Falta el recurso', 'datos');
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new ErrNegocio(400, 'Día de la semana inválido (0=Domingo … 6=Sábado)', 'datos');
  if (!HHMM.test(horaDesde) || !HHMM.test(horaHasta) || horaDesde >= horaHasta) {
    throw new ErrNegocio(400, 'Horario inválido (HH:MM, el inicio debe ser anterior al fin)', 'datos');
  }
  const vigenteDesde = p.vigenteDesde ? String(p.vigenteDesde) : hoy;
  if (!esFechaReal(vigenteDesde)) throw new ErrNegocio(400, 'vigente_desde inválida (YYYY-MM-DD)', 'datos');
  if (vigenteDesde < hoy) throw new ErrNegocio(400, 'El abono no puede empezar en el pasado', 'datos');
  let vigenteHasta = null;
  if (p.vigenteHasta) {
    vigenteHasta = String(p.vigenteHasta);
    if (!esFechaReal(vigenteHasta)) throw new ErrNegocio(400, 'vigente_hasta inválida (YYYY-MM-DD)', 'datos');
    if (vigenteHasta < vigenteDesde) throw new ErrNegocio(400, 'La fecha de fin no puede ser anterior a la de inicio', 'datos');
  }
  const socioId = p.socioId || null;
  const nombreExterno = String(p.nombreExterno || '').trim().slice(0, 120) || null;
  const contacto = String(p.contactoExterno || '').trim().slice(0, 120) || null;
  const notas = String(p.notas || '').trim().slice(0, 300) || null;
  if (!socioId && !nombreExterno) throw new ErrNegocio(400, 'Indicá el socio o el nombre del titular del abono', 'datos');
  const participantesIds = await conParticipantes(async () => part.limpiarIds(p.participantesIds, socioId));
  let participantesNuevos = [];

  const creado = await enTransaccion(db, async (c) => {
    const rr = await c.query(`SELECT id, activo FROM recursos WHERE id = $1 AND club_id = $2 FOR UPDATE`, [p.recursoId, p.clubId]);
    if (!rr.rowCount) throw new ErrNegocio(404, 'Recurso no encontrado', 'recurso');
    if (!rr.rows[0].activo) throw new ErrNegocio(400, 'Este recurso no está activo', 'recurso_inactivo');
    if (socioId) {
      const rs = await c.query(`SELECT 1 FROM socios WHERE id = $1 AND club_id = $2`, [socioId, p.clubId]);
      if (!rs.rowCount) throw new ErrNegocio(404, 'Socio no encontrado', 'socio');
    }

    // 1) El horario tiene que ser un turno de la grilla ese día de la semana
    const ctx = await disp.cargarContexto(c, { clubId: p.clubId, recursoId: p.recursoId, desde: vigenteDesde, hasta: vigenteDesde });
    const coincide = disp.abonoCoincideConGrilla({
      recurso: ctx.recurso, disponibilidad: ctx.disponibilidad,
      dia_semana: dia, hora_desde: horaDesde, hora_hasta: horaHasta, referencia: vigenteDesde
    });
    if (!coincide) {
      throw new ErrNegocio(
        400,
        `Ese horario no coincide con un turno del recurso los ${DIAS_LARGO[dia]}. Elegí un turno de la grilla (turnos de ${ctx.recurso.duracion_turno_min} min dentro de los horarios cargados).`,
        'fuera_de_grilla'
      );
    }

    // 2) Conflictos (otros abonos, reservas futuras, clases)
    const ab = await c.query(
      `SELECT id, nombre_externo, estado, dia_semana,
              to_char(hora_desde,'HH24:MI') AS hora_desde, to_char(hora_hasta,'HH24:MI') AS hora_hasta,
              to_char(vigente_desde,'YYYY-MM-DD') AS vigente_desde, to_char(vigente_hasta,'YYYY-MM-DD') AS vigente_hasta
         FROM recursos_abonos
        WHERE recurso_id = $1 AND estado = 'activo' AND dia_semana = $2
          AND (vigente_hasta IS NULL OR vigente_hasta >= $3::date)`,
      [p.recursoId, dia, hoy]
    );
    const rv = await c.query(
      `SELECT r.id, r.estado, r.socio_id, r.nombre_externo,
              to_char(r.fecha,'YYYY-MM-DD') AS fecha,
              to_char(r.hora_desde,'HH24:MI') AS hora_desde, to_char(r.hora_hasta,'HH24:MI') AS hora_hasta
         FROM recursos_reservas r
        WHERE r.recurso_id = $1 AND r.estado IN ('pendiente','aceptada') AND r.fecha >= $2::date
          AND ($3::date IS NULL OR r.fecha <= $3::date)
          AND EXTRACT(DOW FROM r.fecha) = $4`,
      [p.recursoId, hoy, vigenteHasta, dia]
    );
    const finClases = vigenteHasta && vigenteHasta < disp.addDays(hoy, HORIZONTE_CLASES_DIAS)
      ? vigenteHasta : disp.addDays(hoy, HORIZONTE_CLASES_DIAS);
    const clases = await disp.cargarOcurrenciasClases(c, p.recursoId, hoy > vigenteDesde ? hoy : vigenteDesde, finClases);

    const conflictos = disp.conflictosAbono({
      abono: { dia_semana: dia, hora_desde: horaDesde, hora_hasta: horaHasta, vigente_desde: vigenteDesde, vigente_hasta: vigenteHasta },
      abonosActivos: ab.rows, reservasFuturas: rv.rows, clasesOcurrencias: clases, hoy
    });
    if (conflictos.length) {
      // nombres de los titulares de las reservas en conflicto
      const mapa = new Map(rv.rows.map((x) => [x.id, x]));
      const sids = [...new Set(rv.rows.map((x) => x.socio_id).filter(Boolean))];
      const nombres = new Map();
      if (sids.length) {
        const rs = await c.query(`SELECT id, nombre, apellido FROM socios WHERE id = ANY($1::uuid[])`, [sids]);
        rs.rows.forEach((s) => nombres.set(s.id, `${s.apellido ?? ''}, ${s.nombre ?? ''}`.replace(/^, |, $/g, '').trim()));
      }
      const lista = conflictos.map((x) => {
        if (x.tipo !== 'reserva') return x;
        const r = mapa.get(x.reserva_id);
        return { ...x, titular: r?.socio_id ? nombres.get(r.socio_id) : r?.nombre_externo };
      });
      throw new ErrNegocio(
        409,
        `El abono se superpone con ${lista.length} ${lista.length === 1 ? 'turno ya ocupado' : 'turnos ya ocupados'}. Cancelá o mové esas reservas/clases primero.`,
        'conflictos',
        { conflictos: lista }
      );
    }

    const ins = await c.query(
      `INSERT INTO recursos_abonos
         (club_id, recurso_id, socio_id, nombre_externo, contacto_externo, dia_semana,
          hora_desde, hora_hasta, vigente_desde, vigente_hasta, estado, notas, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'activo',$11,$12) RETURNING id`,
      [p.clubId, p.recursoId, socioId, socioId ? null : nombreExterno, socioId ? null : contacto,
       dia, horaDesde, horaHasta, vigenteDesde, vigenteHasta, notas, p.adminUserId || null]
    );
    if (participantesIds.length) {
      const rp = await conParticipantes(() => part.reemplazar(c, {
        clubId: p.clubId, tipo: 'abono', refId: ins.rows[0].id, socioIds: participantesIds, titularId: socioId
      }));
      participantesNuevos = rp.agregados;
    }
    return obtenerAbono(c, { clubId: p.clubId, id: ins.rows[0].id });
  });

  for (const sid of participantesNuevos) {
    reservasSvc.avisarSocio({
      clubId: p.clubId, socioId: sid,
      titulo: '🏟️ Te sumaron a un abono',
      cuerpo: `${descAbono(creado)}.`,
      data: { type: 'espacios_abono_participante', abonoId: String(creado.id) }
    });
  }
  if (creado.socio_id) {
    reservasSvc.avisarSocio({
      clubId: p.clubId, socioId: creado.socio_id,
      titulo: '🏟️ Tenés un abono',
      cuerpo: `${creado.recurso_nombre}, todos los ${DIAS_LARGO[creado.dia_semana]} de ${creado.hora_desde} a ${creado.hora_hasta}` +
        `${creado.vigente_desde > hoy ? `, desde el ${creado.vigente_desde.split('-').reverse().join('/')}` : ''}.`,
      data: { type: 'espacios_abono_creado', abonoId: String(creado.id) }
    });
  }
  const [out] = await enriquecer(db, p.clubId, [creado]);
  return out;
}

// ---------------------------------------------------------------- editar
async function editarAbono(db, { clubId, id, cambios }) {
  const out = await enTransaccion(db, async (c) => {
    const a = await obtenerAbono(c, { clubId, id, forUpdate: true });
    if (!a) throw new ErrNegocio(404, 'Abono no encontrado', 'abono');
    const sets = []; const vals = [];
    const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (cambios.notas !== undefined) push('notas', String(cambios.notas ?? '').trim().slice(0, 300) || null);
    if (!a.socio_id) {
      if (cambios.nombre_externo !== undefined) {
        const n = String(cambios.nombre_externo ?? '').trim().slice(0, 120);
        if (!n) throw new ErrNegocio(400, 'El nombre no puede quedar vacío', 'datos');
        push('nombre_externo', n);
      }
      if (cambios.contacto_externo !== undefined) push('contacto_externo', String(cambios.contacto_externo ?? '').trim().slice(0, 120) || null);
    }
    if (cambios.vigente_hasta !== undefined) {
      if (cambios.vigente_hasta === null || cambios.vigente_hasta === '') push('vigente_hasta', null);
      else {
        const f = String(cambios.vigente_hasta);
        if (!esFechaReal(f)) throw new ErrNegocio(400, 'vigente_hasta inválida (YYYY-MM-DD)', 'datos');
        if (f < a.vigente_desde) throw new ErrNegocio(400, 'La fecha de fin no puede ser anterior al inicio del abono', 'datos');
        push('vigente_hasta', f);
      }
    }
    if (!sets.length) throw new ErrNegocio(400, 'No hay cambios para guardar', 'datos');
    vals.push(id);
    await c.query(`UPDATE recursos_abonos SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    return obtenerAbono(c, { clubId, id });
  });
  const [r] = await enriquecer(db, clubId, [out]);
  return r;
}

// ---------------------------------------------------------------- baja
// fechaHasta: último día en que el abono todavía aplica (inclusive). Default: hoy.
async function darDeBaja(db, { clubId, id, fechaHasta }) {
  const hoy = disp.ahoraArgentina().fecha;
  const f = fechaHasta ? String(fechaHasta) : hoy;
  if (!esFechaReal(f)) throw new ErrNegocio(400, 'fecha_hasta inválida (YYYY-MM-DD)', 'datos');
  const out = await enTransaccion(db, async (c) => {
    const a = await obtenerAbono(c, { clubId, id, forUpdate: true });
    if (!a) throw new ErrNegocio(404, 'Abono no encontrado', 'abono');
    if (a.vigente_hasta && a.vigente_hasta < hoy) throw new ErrNegocio(400, 'Este abono ya finalizó', 'finalizado');
    // No se puede terminar antes de que empiece: se deja terminando el día anterior al inicio
    const hasta = f < a.vigente_desde ? disp.addDays(a.vigente_desde, -1) : f;
    await c.query(`UPDATE recursos_abonos SET vigente_hasta = $1 WHERE id = $2`, [hasta, id]);
    return obtenerAbono(c, { clubId, id });
  });
  if (out.socio_id) {
    reservasSvc.avisarSocio({
      clubId, socioId: out.socio_id,
      titulo: '🏟️ Abono finalizado',
      cuerpo: `Tu abono de ${out.recurso_nombre} (${DIAS_LARGO[out.dia_semana]} ${out.hora_desde}) dejó de estar vigente a partir del ${disp.addDays(out.vigente_hasta, 1).split('-').reverse().join('/')}.`,
      data: { type: 'espacios_abono_baja', abonoId: String(out.id) }
    });
  }
  const [r] = await enriquecer(db, clubId, [out]);
  return r;
}

// ---------------------------------------------------------------- excepciones
async function agregarExcepcion(db, { clubId, id, fechaDesde, fechaHasta, motivo }) {
  const hoy = disp.ahoraArgentina().fecha;
  const d = String(fechaDesde || '');
  const h = fechaHasta ? String(fechaHasta) : d;
  if (!esFechaReal(d) || !esFechaReal(h)) throw new ErrNegocio(400, 'Fechas inválidas (YYYY-MM-DD)', 'datos');
  if (h < d) throw new ErrNegocio(400, 'La fecha "hasta" no puede ser anterior a "desde"', 'datos');
  if (h < hoy) throw new ErrNegocio(400, 'Esas fechas ya pasaron', 'datos');
  if (disp.daysBetween(d, h) + 1 > MAX_RANGO_EXCEPCION_DIAS) {
    throw new ErrNegocio(400, `El rango máximo es de ${MAX_RANGO_EXCEPCION_DIAS} días`, 'datos');
  }
  return enTransaccion(db, async (c) => {
    const a = await obtenerAbono(c, { clubId, id, forUpdate: true });
    if (!a) throw new ErrNegocio(404, 'Abono no encontrado', 'abono');
    const ins = await c.query(
      `INSERT INTO recursos_abonos_excepciones (abono_id, fecha_desde, fecha_hasta, motivo)
       VALUES ($1,$2,$3,$4)
       RETURNING id, to_char(fecha_desde,'YYYY-MM-DD') AS fecha_desde, to_char(fecha_hasta,'YYYY-MM-DD') AS fecha_hasta, motivo`,
      [id, d, h, String(motivo || '').trim().slice(0, 120) || null]
    );
    return ins.rows[0];
  });
}

// Quitar una excepción vuelve a ocupar esas fechas: si alguien reservó mientras
// estaban libres, se rechaza con la lista (para no generar doble reserva).
async function quitarExcepcion(db, { clubId, id, excId }) {
  const hoy = disp.ahoraArgentina().fecha;
  return enTransaccion(db, async (c) => {
    const a = await obtenerAbono(c, { clubId, id, forUpdate: true });
    if (!a) throw new ErrNegocio(404, 'Abono no encontrado', 'abono');
    await c.query(`SELECT id FROM recursos WHERE id = $1 FOR UPDATE`, [a.recurso_id]);
    const re = await c.query(
      `SELECT id, to_char(fecha_desde,'YYYY-MM-DD') AS fecha_desde, to_char(fecha_hasta,'YYYY-MM-DD') AS fecha_hasta
         FROM recursos_abonos_excepciones WHERE id = $1 AND abono_id = $2`,
      [excId, id]
    );
    if (!re.rowCount) throw new ErrNegocio(404, 'Excepción no encontrada', 'excepcion');
    const e = re.rows[0];
    const desde = e.fecha_desde > hoy ? e.fecha_desde : hoy;
    if (e.fecha_hasta >= hoy) {
      const rv = await c.query(
        `SELECT id, estado, socio_id, nombre_externo, to_char(fecha,'YYYY-MM-DD') AS fecha,
                to_char(hora_desde,'HH24:MI') AS hora_desde, to_char(hora_hasta,'HH24:MI') AS hora_hasta
           FROM recursos_reservas
          WHERE recurso_id = $1 AND estado IN ('pendiente','aceptada')
            AND fecha BETWEEN $2::date AND $3::date AND EXTRACT(DOW FROM fecha) = $4`,
        [a.recurso_id, desde, e.fecha_hasta, a.dia_semana]
      );
      const clases = disp.daysBetween(desde, e.fecha_hasta) <= 400
        ? await disp.cargarOcurrenciasClases(c, a.recurso_id, desde, e.fecha_hasta) : [];
      const conflictos = disp.conflictosAbono({
        abono: { dia_semana: a.dia_semana, hora_desde: a.hora_desde, hora_hasta: a.hora_hasta, vigente_desde: desde, vigente_hasta: e.fecha_hasta },
        abonosActivos: [], reservasFuturas: rv.rows, clasesOcurrencias: clases, hoy
      });
      if (conflictos.length) {
        throw new ErrNegocio(409, 'Otra persona ya reservó en esas fechas liberadas. Cancelá esas reservas antes de volver a activar el abono.', 'conflictos', { conflictos });
      }
    }
    await c.query(`DELETE FROM recursos_abonos_excepciones WHERE id = $1`, [excId]);
    return { id: excId };
  });
}

// ---------------------------------------------------------------- participantes
async function actualizarParticipantes(db, { clubId, id, socioIds }) {
  let cambios = { agregados: [], quitados: [] };
  const fila = await enTransaccion(db, async (c) => {
    const a = await obtenerAbono(c, { clubId, id, forUpdate: true });
    if (!a) throw new ErrNegocio(404, 'Abono no encontrado', 'abono');
    const hoy = disp.ahoraArgentina().fecha;
    if (a.estado !== 'activo' || (a.vigente_hasta && a.vigente_hasta < hoy)) {
      throw new ErrNegocio(400, 'Solo se pueden cambiar los participantes de un abono vigente', 'estado_invalido');
    }
    cambios = await conParticipantes(() => part.reemplazar(c, {
      clubId, tipo: 'abono', refId: a.id, socioIds, titularId: a.socio_id
    }));
    return a;
  });
  for (const sid of cambios.agregados) {
    reservasSvc.avisarSocio({
      clubId, socioId: sid,
      titulo: '🏟️ Te sumaron a un abono',
      cuerpo: `${descAbono(fila)}.`,
      data: { type: 'espacios_abono_participante', abonoId: String(fila.id) }
    });
  }
  for (const sid of cambios.quitados) {
    reservasSvc.avisarSocio({
      clubId, socioId: sid,
      titulo: '🏟️ Te quitaron de un abono',
      cuerpo: `Ya no figurás en el abono de ${descAbono(fila)}.`,
      data: { type: 'espacios_abono_participante_baja', abonoId: String(fila.id) }
    });
  }
  const [out] = await enriquecer(db, clubId, [fila]);
  return out;
}

// ---------------------------------------------------------------- app (socio)
// Abonos donde el socio es titular o participante (rol: 'titular' | 'participante').
async function abonosDelSocio(db, { clubId, socioId }) {
  const hoy = disp.ahoraArgentina().fecha;
  const r = await db.query(
    `SELECT ${SQL_ABONO} FROM recursos_abonos a JOIN recursos rec ON rec.id = a.recurso_id
      WHERE a.club_id = $1
        AND (a.socio_id = $2 OR EXISTS (
              SELECT 1 FROM recursos_abonos_socios x WHERE x.abono_id = a.id AND x.socio_id = $2))
        AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= $3::date)
      ORDER BY a.dia_semana, a.hora_desde`,
    [clubId, socioId, hoy]
  );
  const filas = await enriquecer(db, clubId, r.rows);
  return filas.map((a) => ({
    rol: a.socio_id === socioId ? 'titular' : 'participante',
    titular: a.titular || null,
    participantes: (a.participantes || []).map((x) => x.nombre_completo),
    id: a.id, recurso_id: a.recurso_id, recurso_nombre: a.recurso_nombre,
    dia_semana: a.dia_semana, hora_desde: a.hora_desde, hora_hasta: a.hora_hasta,
    vigente_desde: a.vigente_desde, vigente_hasta: a.vigente_hasta,
    proxima_fecha: a.proxima_fecha,
    fechas_liberadas: a.excepciones.map((e) => ({ fecha_desde: e.fecha_desde, fecha_hasta: e.fecha_hasta, motivo: e.motivo }))
  }));
}

module.exports = {
  proximaFecha, listarAbonos, crearAbono, editarAbono, darDeBaja,
  agregarExcepcion, quitarExcepcion, abonosDelSocio, obtenerAbono, enriquecer, actualizarParticipantes
};
