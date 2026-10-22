// backend/src/services/disponibilidadService.js
//
// Motor de turnos de "Espacios y Clases" (plan: claude/espacios-y-clases-plan.md, sección 5).
// Lo usan el panel del club y la app del socio, para que ambos vean EXACTAMENTE lo mismo.
//
// Dos capas:
//   1) Funciones PURAS (sin base de datos): calcularTurnos, validarTurnoLibre, conflictosAbono...
//      Reciben filas "planas" y devuelven resultados. Se prueban en backend/tests.
//   2) Cargadores: turnosDisponibles(db, ...) / cargarContexto(db, ...) que leen la base y
//      llaman a las funciones puras. `db` puede ser el pool (require('../db')) o un client
//      dentro de una transacción (para el SELECT ... FOR UPDATE de las reservas).
//
// Convenciones: fechas 'YYYY-MM-DD', horas 'HH:MM', días de semana 0=Domingo..6=Sábado,
// todo en horario local de Argentina (sin zona horaria en la base).

'use strict';

const MAX_DIAS_RANGO = 31;
const TZ_AR = 'America/Argentina/Buenos_Aires';

// ------------------------------------------------------------------
// Utilidades de fecha/hora
// ------------------------------------------------------------------
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(':');
  return Number(h) * 60 + Number(m);
};

const fmt = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

const daysBetween = (aIso, bIso) =>
  Math.round((new Date(`${bIso}T00:00:00Z`) - new Date(`${aIso}T00:00:00Z`)) / 86400000);

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// "Ahora" en Argentina como { fecha:'YYYY-MM-DD', min: minutos desde las 00:00 }
function ahoraArgentina(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_AR,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return {
    fecha: `${g('year')}-${g('month')}-${g('day')}`,
    min: Number(g('hour')) * 60 + Number(g('minute'))
  };
}

const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// ¿La regla (disponibilidad / horario) aplica a esa fecha?
function aplicaRegla(r, fecha) {
  if (r.tipo === 'fecha') return String(r.fecha) === fecha;
  if (r.tipo === 'semanal') {
    if (Number(r.dia_semana) !== dow(fecha)) return false;
    if (r.vigente_desde && fecha < r.vigente_desde) return false;
    if (r.vigente_hasta && fecha > r.vigente_hasta) return false;
    return true;
  }
  return false;
}

function mergeIntervals(list) {
  const s = list.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); // solapa o es contigua
    else out.push([a, b]);
  }
  return out;
}

// ------------------------------------------------------------------
// 1) Grilla de turnos de un día (sin reservas, abonos ni clases)
// ------------------------------------------------------------------
// Devuelve [{ desde, hasta }] en minutos, ya unificadas las ventanas solapadas.
// Un turno solo existe si entra COMPLETO en la ventana.
function generarGrilla({ recurso, disponibilidad, fecha }) {
  const dur = Number(recurso.duracion_turno_min) || 60;
  const ventanas = mergeIntervals(
    (disponibilidad || [])
      .filter((r) => r.activo !== false && r.modo !== 'bloqueado' && aplicaRegla(r, fecha))
      .map((r) => [toMin(r.hora_desde), toMin(r.hora_hasta)])
      .filter(([a, b]) => b > a)
  );
  const slots = [];
  for (const [a, b] of ventanas) {
    for (let t = a; t + dur <= b; t += dur) slots.push({ desde: t, hasta: t + dur });
  }
  return slots;
}

// ------------------------------------------------------------------
// 2) Cálculo completo de turnos (libres y ocupados) para un rango
// ------------------------------------------------------------------
/**
 * @param {object} p
 * @param {object} p.recurso            fila de recursos (duracion_turno_min, anticipacion_min_horas, anticipacion_max_dias)
 * @param {Array}  p.disponibilidad     filas de recursos_disponibilidad
 * @param {Array}  p.reservas           reservas del rango (se consideran solo pendiente/aceptada)
 * @param {Array}  p.abonos             abonos activos que tocan el rango
 * @param {Array}  p.excepcionesAbono   [{abono_id, fecha_desde, fecha_hasta}]
 * @param {Array}  p.clases             ocurrencias de clases en este recurso [{clase_id, nombre, fecha, hora_desde, hora_hasta}]
 * @param {string} p.desde              'YYYY-MM-DD'
 * @param {string} p.hasta              'YYYY-MM-DD' (inclusive)
 * @param {object} p.ahora              { fecha, min } (default: ahora en Argentina)
 * @param {boolean} p.aplicarAnticipacion  false para la vista del panel (muestra pasado y lejano sin marcar)
 * @returns {Array} [{ fecha, turnos:[{ hora_desde, hora_hasta, estado:'libre'|'ocupado', motivo?, ocupado_por? }] }]
 */
function calcularTurnos(p) {
  const {
    recurso, disponibilidad = [], reservas = [], abonos = [],
    excepcionesAbono = [], clases = [], desde, hasta,
    aplicarAnticipacion = true
  } = p;
  const ahora = p.ahora || ahoraArgentina();

  if (!isISODate(desde) || !isISODate(hasta) || hasta < desde) {
    throw new Error('rango_invalido');
  }
  if (daysBetween(desde, hasta) + 1 > MAX_DIAS_RANGO) {
    throw new Error('rango_muy_grande');
  }

  const minAnt = Number(recurso.anticipacion_min_horas || 0) * 60;
  const maxDias = Number(recurso.anticipacion_max_dias || 30);
  const resultado = [];

  for (let fecha = desde; fecha <= hasta; fecha = addDays(fecha, 1)) {
    const grilla = generarGrilla({ recurso, disponibilidad, fecha });
    if (!grilla.length) continue; // día sin disponibilidad: no se lista

    // Bloqueos que aplican a la fecha
    const bloqueos = disponibilidad
      .filter((r) => r.activo !== false && r.modo === 'bloqueado' && aplicaRegla(r, fecha))
      .map((r) => ({
        desde: r.hora_desde ? toMin(r.hora_desde) : 0,
        hasta: r.hora_hasta ? toMin(r.hora_hasta) : 1440,
        motivo: r.motivo || null
      }));

    // Abonos que ocupan la fecha (y no están liberados por una excepción)
    const abonosDia = abonos.filter((a) => {
      if (a.estado && a.estado !== 'activo') return false;
      if (Number(a.dia_semana) !== dow(fecha)) return false;
      if (a.vigente_desde && fecha < a.vigente_desde) return false;
      if (a.vigente_hasta && fecha > a.vigente_hasta) return false;
      const liberada = excepcionesAbono.some(
        (e) => e.abono_id === a.id && fecha >= e.fecha_desde && fecha <= e.fecha_hasta
      );
      return !liberada;
    });

    const reservasDia = reservas.filter(
      (r) => r.fecha === fecha && (r.estado === 'pendiente' || r.estado === 'aceptada')
    );
    const clasesDia = clases.filter((c) => c.fecha === fecha);

    const diasDesdeHoy = daysBetween(ahora.fecha, fecha);
    const turnos = grilla.map((s) => {
      const ocupadoPor = [];

      for (const b of bloqueos) {
        if (overlap(s.desde, s.hasta, b.desde, b.hasta)) {
          ocupadoPor.push({ tipo: 'bloqueo', motivo: b.motivo });
        }
      }
      for (const a of abonosDia) {
        if (overlap(s.desde, s.hasta, toMin(a.hora_desde), toMin(a.hora_hasta))) {
          ocupadoPor.push({
            tipo: 'abono', abono_id: a.id,
            socio_id: a.socio_id || null, nombre_externo: a.nombre_externo || null
          });
        }
      }
      for (const c of clasesDia) {
        if (overlap(s.desde, s.hasta, toMin(c.hora_desde), toMin(c.hora_hasta))) {
          ocupadoPor.push({ tipo: 'clase', clase_id: c.clase_id, nombre: c.nombre || null });
        }
      }
      for (const r of reservasDia) {
        if (overlap(s.desde, s.hasta, toMin(r.hora_desde), toMin(r.hora_hasta))) {
          ocupadoPor.push({
            tipo: 'reserva', reserva_id: r.id, estado: r.estado,
            socio_id: r.socio_id || null, nombre_externo: r.nombre_externo || null
          });
        }
      }

      if (aplicarAnticipacion) {
        const inicioAbs = diasDesdeHoy * 1440 + s.desde;
        if (inicioAbs < ahora.min + minAnt) ocupadoPor.push({ tipo: 'pasado' });
        else if (diasDesdeHoy > maxDias) ocupadoPor.push({ tipo: 'fuera_de_rango' });
      }

      const t = { hora_desde: fmt(s.desde), hora_hasta: fmt(s.hasta) };
      if (ocupadoPor.length) {
        return { ...t, estado: 'ocupado', motivo: ocupadoPor[0].tipo, ocupado_por: ocupadoPor };
      }
      return { ...t, estado: 'libre' };
    });

    resultado.push({ fecha, turnos });
  }
  return resultado;
}

const soloLibres = (resultado) =>
  resultado
    .map((d) => ({ fecha: d.fecha, turnos: d.turnos.filter((t) => t.estado === 'libre') }))
    .filter((d) => d.turnos.length);

// ¿El turno pedido (fecha + hora_desde) es EXACTAMENTE uno de los generados y está libre?
// Es la validación que hace el servidor antes de insertar una reserva: no confía en la app.
function validarTurnoLibre(p, fecha, horaDesde) {
  const r = calcularTurnos({ ...p, desde: fecha, hasta: fecha });
  const dia = r.find((d) => d.fecha === fecha);
  if (!dia) return { ok: false, motivo: 'sin_disponibilidad' };
  const t = dia.turnos.find((x) => x.hora_desde === String(horaDesde).slice(0, 5));
  if (!t) return { ok: false, motivo: 'turno_inexistente' };
  if (t.estado !== 'libre') return { ok: false, motivo: t.motivo, turno: t };
  return { ok: true, turno: t };
}

// ------------------------------------------------------------------
// 3) Conflictos al crear un abono (se llama antes de insertarlo)
// ------------------------------------------------------------------
/**
 * @param {object} p
 * @param {object} p.abono               { dia_semana, hora_desde, hora_hasta, vigente_desde, vigente_hasta|null }
 * @param {Array}  p.abonosActivos       otros abonos activos del recurso
 * @param {Array}  p.reservasFuturas     reservas pendiente/aceptada del recurso con fecha >= hoy
 * @param {Array}  p.clasesOcurrencias   ocurrencias de clases del recurso (horizonte razonable, ej. 180 días)
 * @param {string} p.hoy                 'YYYY-MM-DD'
 */
function conflictosAbono(p) {
  const { abono, abonosActivos = [], reservasFuturas = [], clasesOcurrencias = [], hoy } = p;
  const a1 = toMin(abono.hora_desde), a2 = toMin(abono.hora_hasta);
  const desde = abono.vigente_desde || hoy;
  const hasta = abono.vigente_hasta || '9999-12-31';
  const conflictos = [];

  for (const o of abonosActivos) {
    if (o.id && o.id === abono.id) continue;
    if ((o.estado && o.estado !== 'activo') || Number(o.dia_semana) !== Number(abono.dia_semana)) continue;
    if (!overlap(a1, a2, toMin(o.hora_desde), toMin(o.hora_hasta))) continue;
    const od = o.vigente_desde || '0000-01-01', oh = o.vigente_hasta || '9999-12-31';
    if (od <= hasta && desde <= oh) {
      conflictos.push({
        tipo: 'abono', abono_id: o.id,
        detalle: o.nombre_externo || 'otro abono', desde: o.hora_desde, hasta: o.hora_hasta
      });
    }
  }
  for (const r of reservasFuturas) {
    if (!(r.estado === 'pendiente' || r.estado === 'aceptada')) continue;
    if (r.fecha < hoy || r.fecha < desde || r.fecha > hasta) continue;
    if (dow(r.fecha) !== Number(abono.dia_semana)) continue;
    if (overlap(a1, a2, toMin(r.hora_desde), toMin(r.hora_hasta))) {
      conflictos.push({
        tipo: 'reserva', reserva_id: r.id, fecha: r.fecha,
        estado: r.estado, desde: r.hora_desde, hasta: r.hora_hasta
      });
    }
  }
  for (const c of clasesOcurrencias) {
    if (c.fecha < hoy || c.fecha < desde || c.fecha > hasta) continue;
    if (dow(c.fecha) !== Number(abono.dia_semana)) continue;
    if (overlap(a1, a2, toMin(c.hora_desde), toMin(c.hora_hasta))) {
      conflictos.push({ tipo: 'clase', clase_id: c.clase_id, nombre: c.nombre, fecha: c.fecha });
    }
  }
  return conflictos;
}

// ¿El horario del abono coincide con un turno de la grilla del recurso para ese día de la semana?
// Se evalúa contra la próxima fecha con ese día de la semana a partir de `referencia`.
function abonoCoincideConGrilla({ recurso, disponibilidad, dia_semana, hora_desde, hora_hasta, referencia }) {
  let f = referencia;
  for (let i = 0; i < 7 && dow(f) !== Number(dia_semana); i++) f = addDays(f, 1);
  // Probamos hasta 8 semanas por si hay reglas con vigencia futura o una fecha bloqueada puntual
  for (let k = 0; k < 8; k++, f = addDays(f, 7)) {
    const g = generarGrilla({ recurso, disponibilidad, fecha: f });
    if (g.some((s) => fmt(s.desde) === String(hora_desde).slice(0, 5) &&
                      fmt(s.hasta) === String(hora_hasta).slice(0, 5))) return true;
  }
  return false;
}

// ------------------------------------------------------------------
// 4) Expansión de clases (para ocupar el recurso donde se dictan)
// ------------------------------------------------------------------
function expandirClases({ horarios = [], excepciones = [], desde, hasta }) {
  const out = [];
  for (let fecha = desde; fecha <= hasta; fecha = addDays(fecha, 1)) {
    for (const h of horarios) {
      if (!aplicaRegla(h, fecha)) continue;
      if (excepciones.some((e) => e.clase_id === h.clase_id && e.fecha === fecha)) continue;
      out.push({
        clase_id: h.clase_id, nombre: h.nombre, fecha,
        hora_desde: String(h.hora_desde).slice(0, 5), hora_hasta: String(h.hora_hasta).slice(0, 5)
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------
// 5) Cargadores desde la base
// ------------------------------------------------------------------
const SQL_FECHA = (c) => `to_char(${c}, 'YYYY-MM-DD')`;
const SQL_HORA = (c) => `to_char(${c}, 'HH24:MI')`;

let _tablaClasesExiste = false; // la tabla recién existe cuando se corra la migración del Release B
async function existeTablaClases(db) {
  if (_tablaClasesExiste) return true;
  const r = await db.query(`SELECT to_regclass('public.clases') IS NOT NULL AS ok`);
  _tablaClasesExiste = r.rows[0].ok === true;
  return _tablaClasesExiste;
}

async function cargarOcurrenciasClases(db, recursoId, desde, hasta) {
  if (!(await existeTablaClases(db))) return [];
  const h = await db.query(
    `SELECT c.id AS clase_id, c.nombre, h.tipo, h.dia_semana,
            ${SQL_FECHA('h.fecha')} AS fecha,
            ${SQL_HORA('h.hora_desde')} AS hora_desde, ${SQL_HORA('h.hora_hasta')} AS hora_hasta,
            ${SQL_FECHA('h.vigente_desde')} AS vigente_desde, ${SQL_FECHA('h.vigente_hasta')} AS vigente_hasta
       FROM clases c
       JOIN clases_horarios h ON h.clase_id = c.id
      WHERE c.recurso_id = $1 AND c.activo = TRUE`,
    [recursoId]
  );
  if (!h.rowCount) return [];
  const ids = [...new Set(h.rows.map((x) => x.clase_id))];
  const e = await db.query(
    `SELECT clase_id, ${SQL_FECHA('fecha')} AS fecha
       FROM clases_excepciones
      WHERE clase_id = ANY($1::uuid[]) AND fecha BETWEEN $2::date AND $3::date`,
    [ids, desde, hasta]
  );
  return expandirClases({ horarios: h.rows, excepciones: e.rows, desde, hasta });
}

/**
 * Carga todo lo necesario para calcular un rango. `db` puede ser pool o client de transacción.
 * Devuelve null si el recurso no existe o no es del club.
 */
async function cargarContexto(db, { clubId, recursoId, desde, hasta }) {
  const rr = await db.query(
    `SELECT id, club_id, nombre, tipo, descripcion, capacidad, imagen_url,
            duracion_turno_min, anticipacion_min_horas, anticipacion_max_dias,
            cancelar_hasta_horas, reservable_app, activo
       FROM recursos WHERE id = $1 AND club_id = $2`,
    [recursoId, clubId]
  );
  if (!rr.rowCount) return null;
  const recurso = rr.rows[0];

  const disp = await db.query(
    `SELECT id, modo, tipo, dia_semana,
            ${SQL_FECHA('fecha')} AS fecha,
            ${SQL_HORA('hora_desde')} AS hora_desde, ${SQL_HORA('hora_hasta')} AS hora_hasta,
            ${SQL_FECHA('vigente_desde')} AS vigente_desde, ${SQL_FECHA('vigente_hasta')} AS vigente_hasta,
            motivo, activo
       FROM recursos_disponibilidad WHERE recurso_id = $1 AND activo = TRUE`,
    [recursoId]
  );

  const res = await db.query(
    `SELECT id, socio_id, nombre_externo, estado,
            ${SQL_FECHA('fecha')} AS fecha,
            ${SQL_HORA('hora_desde')} AS hora_desde, ${SQL_HORA('hora_hasta')} AS hora_hasta
       FROM recursos_reservas
      WHERE recurso_id = $1 AND estado IN ('pendiente','aceptada')
        AND fecha BETWEEN $2::date AND $3::date`,
    [recursoId, desde, hasta]
  );

  const ab = await db.query(
    `SELECT id, socio_id, nombre_externo, estado, dia_semana,
            ${SQL_HORA('hora_desde')} AS hora_desde, ${SQL_HORA('hora_hasta')} AS hora_hasta,
            ${SQL_FECHA('vigente_desde')} AS vigente_desde, ${SQL_FECHA('vigente_hasta')} AS vigente_hasta
       FROM recursos_abonos
      WHERE recurso_id = $1 AND estado = 'activo'
        AND vigente_desde <= $3::date AND (vigente_hasta IS NULL OR vigente_hasta >= $2::date)`,
    [recursoId, desde, hasta]
  );

  let excepcionesAbono = [];
  if (ab.rowCount) {
    const ex = await db.query(
      `SELECT abono_id, ${SQL_FECHA('fecha_desde')} AS fecha_desde, ${SQL_FECHA('fecha_hasta')} AS fecha_hasta
         FROM recursos_abonos_excepciones
        WHERE abono_id = ANY($1::uuid[]) AND fecha_hasta >= $2::date AND fecha_desde <= $3::date`,
      [ab.rows.map((a) => a.id), desde, hasta]
    );
    excepcionesAbono = ex.rows;
  }

  const clases = await cargarOcurrenciasClases(db, recursoId, desde, hasta);

  return {
    recurso, disponibilidad: disp.rows, reservas: res.rows,
    abonos: ab.rows, excepcionesAbono, clases
  };
}

/**
 * Atajo: carga + calcula. Devuelve null si el recurso no existe.
 * opciones: { aplicarAnticipacion (default true), ahora }
 */
async function turnosDisponibles(db, { clubId, recursoId, desde, hasta }, opciones = {}) {
  const ctx = await cargarContexto(db, { clubId, recursoId, desde, hasta });
  if (!ctx) return null;
  return {
    recurso: ctx.recurso,
    dias: calcularTurnos({ ...ctx, desde, hasta, ...opciones }),
    _ctx: ctx
  };
}

module.exports = {
  MAX_DIAS_RANGO,
  // utilidades
  toMin, fmt, addDays, dow, daysBetween, isISODate, ahoraArgentina,
  // lógica pura
  generarGrilla, calcularTurnos, soloLibres, validarTurnoLibre,
  conflictosAbono, abonoCoincideConGrilla, expandirClases,
  // base de datos
  cargarContexto, cargarOcurrenciasClases, turnosDisponibles
};
