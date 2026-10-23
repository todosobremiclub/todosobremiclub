// src/routes/espaciosRoutes.js
//
// Módulo "Espacios y Clases" — panel del club (montado bajo /club).
// Plan completo: claude/espacios-y-clases-plan.md en el proyecto.
//
// PASO 4: recursos + disponibilidad + vista de turnos.
// PASO 6: reservas (listar, alta manual del club, aceptar / rechazar / cancelar).
// PASO 8: abonos (reserva fija semanal sin fecha de fin) + fechas liberadas.
// Los endpoints de la APP del socio viven en appRoutes.js.
//
// Permisos: lectura = admin / staff / solo_lectura; escritura = admin / staff.
// Superadmin entra siempre. Además el club debe tener espacios_habilitado = true.
//
// Transacciones: se usa db.getClient() (UNA conexión) y no db.query('BEGIN'),
// porque db.query usa el pool y cada consulta puede salir por otra conexión.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const { initFirebase } = require('../config/firebaseAdmin');
const disp = require('../services/disponibilidadService');
const reservasSvc = require('../services/espaciosReservasService');
const abonosSvc = require('../services/espaciosAbonosService');

const router = express.Router();

// CORS simple (mismo bloque que el resto de /club/...)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ===============================
// Helpers
// ===============================
const TIPOS_RECURSO = ['cancha', 'salon', 'espacio', 'otro'];
const MAX_REGLAS_POR_RECURSO = 300;
const MAX_REGLAS_POR_LLAMADA = 60;

const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const isHHMM = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const isFechaReal = (s) => {
  if (!disp.isISODate(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const ROLES_LECTURA = new Set(['admin', 'staff', 'solo_lectura']);
const ROLES_ESCRITURA = new Set(['admin', 'staff']);

// Acceso al módulo: rol permitido en ese club + flag del club encendido.
function acceso(escritura) {
  const permitidos = escritura ? ROLES_ESCRITURA : ROLES_LECTURA;
  return async (req, res, next) => {
    try {
      const { clubId } = req.params;
      if (!isUuid(clubId)) {
        return res.status(400).json({ ok: false, error: 'Club inválido' });
      }
      const roles = req.user?.roles ?? [];
      const permitido = roles.some(
        (r) =>
          r.role === 'superadmin' ||
          (String(r.club_id) === String(clubId) && permitidos.has(String(r.role).toLowerCase()))
      );
      if (!permitido) {
        return res.status(403).json({ ok: false, error: 'No autorizado' });
      }
      const rc = await db.query(
        `SELECT espacios_habilitado FROM clubs WHERE id = $1`,
        [clubId]
      );
      if (!rc.rowCount || rc.rows[0].espacios_habilitado !== true) {
        return res
          .status(403)
          .json({ ok: false, error: 'El módulo Espacios y Clases no está habilitado para este club' });
      }
      next();
    } catch (e) {
      console.error('❌ espacios acceso', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}
const leer = [requireAuth, acceso(false)];
const escribir = [requireAuth, acceso(true)];

// Imágenes (mismo patrón que noticias/tienda; carpeta clubs/<clubId>/espacios)
function extractFirebaseObjectPath(url) {
  try {
    const u = new URL(url);
    const marker = '/o/';
    const i = u.pathname.indexOf(marker);
    if (i < 0) return null;
    return decodeURIComponent(u.pathname.slice(i + marker.length));
  } catch {
    return null;
  }
}
async function deleteFirebaseObjectByUrl(url) {
  const objectPath = extractFirebaseObjectPath(url);
  if (!objectPath) return;
  const admin = initFirebase();
  if (!admin) return;
  await admin.storage().bucket().file(objectPath).delete({ ignoreNotFound: true });
}
async function resolverImagen({ prevUrl, base64, mimetype, quitar, clubId }) {
  if (base64 && mimetype) {
    const up = await uploadImageBuffer({
      buffer: Buffer.from(base64, 'base64'),
      mimetype,
      originalname: 'recurso.jpg',
      folder: `clubs/${clubId}/espacios`
    });
    if (prevUrl && prevUrl !== up.url) {
      try { await deleteFirebaseObjectByUrl(prevUrl); }
      catch (err) { console.warn('⚠ No se pudo borrar imagen previa de recurso:', err.message); }
    }
    return up.url;
  }
  if (quitar && prevUrl) {
    try { await deleteFirebaseObjectByUrl(prevUrl); }
    catch (err) { console.warn('⚠ No se pudo borrar imagen de recurso:', err.message); }
    return null;
  }
  return prevUrl ?? null;
}

// Entero opcional dentro de un rango. Devuelve { value } o { error }.
function entero(v, { min, max, campo, nullable = false }) {
  if (v === undefined) return { skip: true };
  if ((v === null || v === '') && nullable) return { value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${campo} inválido (entero entre ${min} y ${max})` };
  }
  return { value: n };
}
const toBool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// Valida y normaliza los campos de un recurso (alta: todos; edición: solo los enviados).
function validarCamposRecurso(body, { alta }) {
  const out = {};
  const b = body || {};

  if (alta || b.nombre !== undefined) {
    const nombre = String(b.nombre ?? '').trim();
    if (!nombre) return { error: 'Falta el nombre del recurso' };
    if (nombre.length > 80) return { error: 'El nombre es demasiado largo (máx. 80)' };
    out.nombre = nombre;
  }
  if (b.tipo !== undefined || alta) {
    const tipo = String(b.tipo ?? 'cancha').trim().toLowerCase();
    if (!TIPOS_RECURSO.includes(tipo)) {
      return { error: `Tipo inválido (${TIPOS_RECURSO.join(', ')})` };
    }
    out.tipo = tipo;
  }
  if (b.descripcion !== undefined) out.descripcion = String(b.descripcion ?? '').trim() || null;

  const reglas = [
    ['capacidad', { min: 1, max: 100000, campo: 'Capacidad', nullable: true }],
    ['duracion_turno_min', { min: 15, max: 720, campo: 'Duración del turno' }],
    ['anticipacion_min_horas', { min: 0, max: 720, campo: 'Anticipación mínima' }],
    ['anticipacion_max_dias', { min: 1, max: 365, campo: 'Anticipación máxima' }],
    ['cancelar_hasta_horas', { min: 0, max: 720, campo: 'Cancelación hasta' }],
    ['orden', { min: 0, max: 100000, campo: 'Orden' }]
  ];
  for (const [campo, opt] of reglas) {
    const r = entero(b[campo], opt);
    if (r.error) return { error: r.error };
    if (!r.skip) out[campo] = r.value;
  }
  if (b.reservable_app !== undefined) out.reservable_app = toBool(b.reservable_app);
  if (b.activo !== undefined) out.activo = toBool(b.activo);
  return { campos: out };
}

const SELECT_RECURSO = `
  r.id, r.club_id, r.nombre, r.tipo, r.descripcion, r.capacidad, r.imagen_url,
  r.duracion_turno_min, r.anticipacion_min_horas, r.anticipacion_max_dias,
  r.cancelar_hasta_horas, r.reservable_app, r.activo, r.orden, r.created_at`;

async function tablaClasesExiste() {
  const r = await db.query(`SELECT to_regclass('public.clases') IS NOT NULL AS ok`);
  return r.rows[0].ok === true;
}

// ============================================================
// RECURSOS
// ============================================================

// GET /club/:clubId/espacios/recursos  (incluye inactivos, para poder reactivarlos)
router.get('/:clubId/espacios/recursos', ...leer, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(
      `
      SELECT ${SELECT_RECURSO},
        (SELECT COUNT(*) FROM recursos_disponibilidad d
          WHERE d.recurso_id = r.id AND d.activo = TRUE AND d.modo = 'disponible')::int AS reglas_disponibilidad,
        (SELECT COUNT(*) FROM recursos_abonos a
          WHERE a.recurso_id = r.id AND a.estado = 'activo'
            AND (a.vigente_hasta IS NULL
                 OR a.vigente_hasta >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))::int AS abonos_activos,
        (SELECT COUNT(*) FROM recursos_reservas x
          WHERE x.recurso_id = r.id AND x.estado = 'pendiente')::int AS reservas_pendientes
      FROM recursos r
      WHERE r.club_id = $1
      ORDER BY r.activo DESC, r.orden ASC, r.nombre ASC
      `,
      [clubId]
    );
    return res.json({ ok: true, recursos: r.rows });
  } catch (e) {
    console.error('❌ GET espacios/recursos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /club/:clubId/espacios/recursos
router.post('/:clubId/espacios/recursos', ...escribir, async (req, res) => {
  const { clubId } = req.params;
  try {
    const v = validarCamposRecurso(req.body, { alta: true });
    if (v.error) return res.status(400).json({ ok: false, error: v.error });
    const c = v.campos;

    const dup = await db.query(
      `SELECT 1 FROM recursos WHERE club_id = $1 AND activo = TRUE AND lower(nombre) = lower($2)`,
      [clubId, c.nombre]
    );
    if (dup.rowCount) {
      return res.status(409).json({ ok: false, error: 'Ya existe un recurso activo con ese nombre' });
    }

    const imagen_url = await resolverImagen({
      prevUrl: null,
      base64: req.body?.imagen_base64,
      mimetype: req.body?.imagen_mimetype,
      quitar: false,
      clubId
    });

    const r = await db.query(
      `
      INSERT INTO recursos
        (club_id, nombre, tipo, descripcion, capacidad, imagen_url,
         duracion_turno_min, anticipacion_min_horas, anticipacion_max_dias,
         cancelar_hasta_horas, reservable_app, activo, orden)
      VALUES ($1,$2,$3,$4,$5,$6,
              COALESCE($7,60), COALESCE($8,0), COALESCE($9,30),
              COALESCE($10,12), COALESCE($11,TRUE), TRUE, COALESCE($12,0))
      RETURNING ${SELECT_RECURSO.replace(/\br\./g, '')}
      `,
      [
        clubId, c.nombre, c.tipo, c.descripcion ?? null, c.capacidad ?? null, imagen_url,
        c.duracion_turno_min ?? null, c.anticipacion_min_horas ?? null, c.anticipacion_max_dias ?? null,
        c.cancelar_hasta_horas ?? null, c.reservable_app ?? null, c.orden ?? null
      ]
    );
    return res.status(201).json({ ok: true, recurso: r.rows[0] });
  } catch (e) {
    console.error('❌ POST espacios/recursos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /club/:clubId/espacios/recursos/:id   (edita solo los campos enviados)
router.put('/:clubId/espacios/recursos/:id', ...escribir, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });

    const actual = await db.query(
      `SELECT ${SELECT_RECURSO} FROM recursos r WHERE r.id = $1 AND r.club_id = $2`,
      [id, clubId]
    );
    if (!actual.rowCount) return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });
    const prev = actual.rows[0];

    const v = validarCamposRecurso(req.body, { alta: false });
    if (v.error) return res.status(400).json({ ok: false, error: v.error });
    const c = v.campos;

    if (c.nombre !== undefined && c.nombre.toLowerCase() !== prev.nombre.toLowerCase()) {
      const dup = await db.query(
        `SELECT 1 FROM recursos WHERE club_id = $1 AND activo = TRUE AND lower(nombre) = lower($2) AND id <> $3`,
        [clubId, c.nombre, id]
      );
      if (dup.rowCount) {
        return res.status(409).json({ ok: false, error: 'Ya existe un recurso activo con ese nombre' });
      }
    }

    // Imagen: nueva (base64) o quitar
    if ((req.body?.imagen_base64 && req.body?.imagen_mimetype) || toBool(req.body?.quitar_imagen)) {
      c.imagen_url = await resolverImagen({
        prevUrl: prev.imagen_url,
        base64: req.body?.imagen_base64,
        mimetype: req.body?.imagen_mimetype,
        quitar: toBool(req.body?.quitar_imagen),
        clubId
      });
    }

    const columnas = Object.keys(c);
    if (!columnas.length) {
      return res.status(400).json({ ok: false, error: 'No hay cambios para guardar' });
    }
    const sets = columnas.map((col, i) => `${col} = $${i + 1}`);
    const valores = columnas.map((col) => c[col]);
    valores.push(id, clubId);

    const r = await db.query(
      `UPDATE recursos r SET ${sets.join(', ')}
        WHERE r.id = $${columnas.length + 1} AND r.club_id = $${columnas.length + 2}
        RETURNING ${SELECT_RECURSO}`,
      valores
    );

    // Avisos (no bloquean): cambiar la duración del turno no toca lo ya reservado
    const avisos = [];
    if (c.duracion_turno_min !== undefined && c.duracion_turno_min !== prev.duracion_turno_min) {
      const rr = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM recursos_abonos WHERE recurso_id = $1 AND estado = 'activo')::int AS abonos,
           (SELECT COUNT(*) FROM recursos_reservas
             WHERE recurso_id = $1 AND estado IN ('pendiente','aceptada') AND fecha >= $2::date)::int AS reservas`,
        [id, disp.ahoraArgentina().fecha]
      );
      const { abonos, reservas } = rr.rows[0];
      if (abonos || reservas) {
        avisos.push(
          `Cambiaste la duración del turno: hay ${abonos} abono(s) activo(s) y ${reservas} reserva(s) futura(s) ` +
          'que se mantienen con su horario actual y pueden no coincidir con la nueva grilla.'
        );
      }
    }
    return res.json({ ok: true, recurso: r.rows[0], avisos });
  } catch (e) {
    console.error('❌ PUT espacios/recursos/:id', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /club/:clubId/espacios/recursos/:id
// Si tiene historia (reservas / abonos / clases) se desactiva; si no, se borra.
router.delete('/:clubId/espacios/recursos/:id', ...escribir, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });

    const rr = await db.query(
      `SELECT id, imagen_url FROM recursos WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!rr.rowCount) return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });

    const dep = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM recursos_reservas WHERE recurso_id = $1)::int AS reservas,
         (SELECT COUNT(*) FROM recursos_abonos WHERE recurso_id = $1)::int AS abonos`,
      [id]
    );
    let clases = 0;
    if (await tablaClasesExiste()) {
      const rc = await db.query(`SELECT COUNT(*)::int AS n FROM clases WHERE recurso_id = $1`, [id]);
      clases = rc.rows[0].n;
    }
    const { reservas, abonos } = dep.rows[0];

    if (reservas || abonos || clases) {
      await db.query(`UPDATE recursos SET activo = FALSE WHERE id = $1 AND club_id = $2`, [id, clubId]);
      const pend = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM recursos_reservas
             WHERE recurso_id = $1 AND estado IN ('pendiente','aceptada') AND fecha >= $2::date)::int AS reservas_futuras,
           (SELECT COUNT(*) FROM recursos_abonos WHERE recurso_id = $1 AND estado = 'activo')::int AS abonos_activos`,
        [id, disp.ahoraArgentina().fecha]
      );
      return res.json({
        ok: true,
        desactivado: true,
        motivo: 'El recurso tiene historial (reservas, abonos o clases), por eso se desactivó en lugar de borrarse.',
        ...pend.rows[0]
      });
    }

    await db.query(`DELETE FROM recursos WHERE id = $1 AND club_id = $2`, [id, clubId]); // disponibilidad: ON DELETE CASCADE
    if (rr.rows[0].imagen_url) {
      try { await deleteFirebaseObjectByUrl(rr.rows[0].imagen_url); }
      catch (err) { console.warn('⚠ No se pudo borrar imagen de recurso:', err.message); }
    }
    return res.json({ ok: true, desactivado: false });
  } catch (e) {
    console.error('❌ DELETE espacios/recursos/:id', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DISPONIBILIDAD (regular, día específico y bloqueos)
// ============================================================

// Valida y normaliza UNA regla. Devuelve { regla } o { error }.
function validarRegla(raw) {
  const r = raw || {};
  const modo = String(r.modo ?? 'disponible').toLowerCase();
  if (!['disponible', 'bloqueado'].includes(modo)) return { error: 'Modo inválido (disponible o bloqueado)' };
  const tipo = String(r.tipo ?? '').toLowerCase();
  if (!['semanal', 'fecha'].includes(tipo)) return { error: 'Tipo inválido (semanal o fecha)' };

  const regla = {
    modo, tipo, dia_semana: null, fecha: null,
    hora_desde: null, hora_hasta: null,
    vigente_desde: null, vigente_hasta: null,
    motivo: String(r.motivo ?? '').trim().slice(0, 120) || null
  };

  if (tipo === 'semanal') {
    const d = Number(r.dia_semana);
    if (!Number.isInteger(d) || d < 0 || d > 6) return { error: 'dia_semana inválido (0=Domingo … 6=Sábado)' };
    regla.dia_semana = d;
    for (const k of ['vigente_desde', 'vigente_hasta']) {
      if (r[k] !== undefined && r[k] !== null && r[k] !== '') {
        if (!isFechaReal(String(r[k]))) return { error: `${k} inválida (YYYY-MM-DD)` };
        regla[k] = String(r[k]);
      }
    }
    if (regla.vigente_desde && regla.vigente_hasta && regla.vigente_hasta < regla.vigente_desde) {
      return { error: 'La vigencia "hasta" no puede ser anterior a "desde"' };
    }
  } else {
    if (!isFechaReal(String(r.fecha ?? ''))) return { error: 'fecha inválida (YYYY-MM-DD)' };
    regla.fecha = String(r.fecha);
  }

  const hd = r.hora_desde === undefined || r.hora_desde === '' ? null : r.hora_desde;
  const hh = r.hora_hasta === undefined || r.hora_hasta === '' ? null : r.hora_hasta;
  if (modo === 'disponible') {
    if (!isHHMM(hd) || !isHHMM(hh)) return { error: 'Horario inválido (HH:MM)' };
    if (hd >= hh) return { error: 'La hora de inicio debe ser anterior a la de fin' };
    regla.hora_desde = hd; regla.hora_hasta = hh;
  } else if (hd !== null || hh !== null) { // bloqueo por tramo: ambas horas o ninguna (todo el día)
    if (!isHHMM(hd) || !isHHMM(hh)) return { error: 'Para bloquear un tramo indicá hora desde y hasta (HH:MM)' };
    if (hd >= hh) return { error: 'La hora de inicio debe ser anterior a la de fin' };
    regla.hora_desde = hd; regla.hora_hasta = hh;
  }
  return { regla };
}

const SELECT_REGLA = `
  id, recurso_id, modo, tipo, dia_semana,
  to_char(fecha, 'YYYY-MM-DD') AS fecha,
  to_char(hora_desde, 'HH24:MI') AS hora_desde,
  to_char(hora_hasta, 'HH24:MI') AS hora_hasta,
  to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
  to_char(vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta,
  motivo, created_at`;

async function recursoDelClub(clubId, id) {
  if (!isUuid(id)) return null;
  const r = await db.query(
    `SELECT id, nombre, duracion_turno_min FROM recursos WHERE id = $1 AND club_id = $2`,
    [id, clubId]
  );
  return r.rowCount ? r.rows[0] : null;
}

// GET /club/:clubId/espacios/recursos/:id/disponibilidad
router.get('/:clubId/espacios/recursos/:id/disponibilidad', ...leer, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    if (!(await recursoDelClub(clubId, id))) {
      return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });
    }
    const r = await db.query(
      `SELECT ${SELECT_REGLA}
         FROM recursos_disponibilidad
        WHERE recurso_id = $1 AND activo = TRUE
        ORDER BY modo DESC,                     -- primero 'disponible', después 'bloqueado'
                 tipo DESC,                     -- 'semanal' antes que 'fecha'
                 ((COALESCE(dia_semana, 0) + 6) % 7) ASC,   -- semana de lunes a domingo
                 fecha ASC NULLS LAST, hora_desde ASC NULLS FIRST`,
      [id]
    );
    return res.json({ ok: true, reglas: r.rows });
  } catch (e) {
    console.error('❌ GET espacios/disponibilidad', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /club/:clubId/espacios/recursos/:id/disponibilidad
// Body: una regla, o { reglas: [ ... ] } (ej. lunes a viernes de una vez).
router.post('/:clubId/espacios/recursos/:id/disponibilidad', ...escribir, async (req, res) => {
  const { clubId, id } = req.params;
  let client;
  try {
    if (!(await recursoDelClub(clubId, id))) {
      return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });
    }
    const entrada = Array.isArray(req.body?.reglas) ? req.body.reglas : [req.body];
    if (!entrada.length) return res.status(400).json({ ok: false, error: 'No hay reglas para agregar' });
    if (entrada.length > MAX_REGLAS_POR_LLAMADA) {
      return res.status(400).json({ ok: false, error: `Máximo ${MAX_REGLAS_POR_LLAMADA} reglas por vez` });
    }

    const reglas = [];
    for (let i = 0; i < entrada.length; i++) {
      const v = validarRegla(entrada[i]);
      if (v.error) {
        return res.status(400).json({
          ok: false,
          error: entrada.length > 1 ? `Regla ${i + 1}: ${v.error}` : v.error
        });
      }
      reglas.push(v.regla);
    }

    client = await db.getClient();
    await client.query('BEGIN');
    // Serializa las altas de reglas del mismo recurso (evita pasarse del tope o duplicar en paralelo)
    await client.query(`SELECT id FROM recursos WHERE id = $1 FOR UPDATE`, [id]);

    const cnt = await client.query(
      `SELECT COUNT(*)::int AS n FROM recursos_disponibilidad WHERE recurso_id = $1 AND activo = TRUE`,
      [id]
    );
    if (cnt.rows[0].n + reglas.length > MAX_REGLAS_POR_RECURSO) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        error: `Se supera el máximo de ${MAX_REGLAS_POR_RECURSO} reglas por recurso`
      });
    }

    const creadas = [];
    let duplicadas = 0;
    for (const g of reglas) {
      const dup = await client.query(
        `SELECT 1 FROM recursos_disponibilidad
          WHERE recurso_id = $1 AND activo = TRUE AND modo = $2 AND tipo = $3
            AND dia_semana IS NOT DISTINCT FROM $4::smallint
            AND fecha IS NOT DISTINCT FROM $5::date
            AND hora_desde IS NOT DISTINCT FROM $6::time
            AND hora_hasta IS NOT DISTINCT FROM $7::time
            AND vigente_desde IS NOT DISTINCT FROM $8::date
            AND vigente_hasta IS NOT DISTINCT FROM $9::date`,
        [id, g.modo, g.tipo, g.dia_semana, g.fecha, g.hora_desde, g.hora_hasta, g.vigente_desde, g.vigente_hasta]
      );
      if (dup.rowCount) { duplicadas++; continue; }
      const ins = await client.query(
        `INSERT INTO recursos_disponibilidad
           (club_id, recurso_id, modo, tipo, dia_semana, fecha, hora_desde, hora_hasta,
            vigente_desde, vigente_hasta, motivo, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
         RETURNING ${SELECT_REGLA}`,
        [clubId, id, g.modo, g.tipo, g.dia_semana, g.fecha, g.hora_desde, g.hora_hasta,
         g.vigente_desde, g.vigente_hasta, g.motivo]
      );
      creadas.push(ins.rows[0]);
    }
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, reglas: creadas, duplicadas });
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) { /* nada */ } }
    console.error('❌ POST espacios/disponibilidad', e);
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    if (client) client.release();
  }
});

// DELETE /club/:clubId/espacios/disponibilidad/:reglaId
router.delete('/:clubId/espacios/disponibilidad/:reglaId', ...escribir, async (req, res) => {
  const { clubId, reglaId } = req.params;
  try {
    if (!isUuid(reglaId)) return res.status(400).json({ ok: false, error: 'Regla inválida' });
    const r = await db.query(
      `DELETE FROM recursos_disponibilidad WHERE id = $1 AND club_id = $2 RETURNING id`,
      [reglaId, clubId]
    );
    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Regla no encontrada' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE espacios/disponibilidad', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// TURNOS (vista previa / calendario)
// ============================================================
// GET /club/:clubId/espacios/recursos/:id/turnos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&vista=socio]
//   - Sin "vista": TODOS los turnos (libres y ocupados, con quién/qué los ocupa) y sin filtro de
//     anticipación: es lo que ve el club en su calendario.
//   - vista=socio: solo los LIBRES y aplicando las reglas de anticipación: es "cómo lo verá el socio".
//   Sin fechas: hoy + 6 días. Máximo 31 días por consulta.
router.get('/:clubId/espacios/recursos/:id/turnos', ...leer, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });

    const hoy = disp.ahoraArgentina().fecha;
    const desde = req.query.desde ? String(req.query.desde) : hoy;
    if (!isFechaReal(desde)) {
      return res.status(400).json({ ok: false, error: 'Fechas inválidas (YYYY-MM-DD)' });
    }
    const hasta = req.query.hasta ? String(req.query.hasta) : disp.addDays(desde, 6);
    if (!isFechaReal(hasta)) {
      return res.status(400).json({ ok: false, error: 'Fechas inválidas (YYYY-MM-DD)' });
    }
    const vistaSocio = String(req.query.vista || '') === 'socio';

    let out;
    try {
      out = await disp.turnosDisponibles(
        db,
        { clubId, recursoId: id, desde, hasta },
        { aplicarAnticipacion: vistaSocio }
      );
    } catch (err) {
      if (err.message === 'rango_invalido') {
        return res.status(400).json({ ok: false, error: 'El rango de fechas es inválido' });
      }
      if (err.message === 'rango_muy_grande') {
        return res.status(400).json({ ok: false, error: `El rango máximo es de ${disp.MAX_DIAS_RANGO} días` });
      }
      throw err;
    }
    if (!out) return res.status(404).json({ ok: false, error: 'Recurso no encontrado' });

    let dias = vistaSocio ? disp.soloLibres(out.dias) : out.dias;

    // Panel: agrega el nombre del titular (socio) a reservas/abonos que ocupan cada turno
    if (!vistaSocio) {
      const ids = new Set();
      for (const d of dias) for (const t of d.turnos) for (const o of t.ocupado_por || []) {
        if (o.socio_id) ids.add(o.socio_id);
      }
      if (ids.size) {
        const rs = await db.query(
          `SELECT id, nombre, apellido, numero_socio FROM socios WHERE club_id = $1 AND id = ANY($2::uuid[])`,
          [clubId, [...ids]]
        );
        const mapa = new Map(rs.rows.map((s) => [s.id, s]));
        for (const d of dias) for (const t of d.turnos) for (const o of t.ocupado_por || []) {
          if (o.socio_id && mapa.has(o.socio_id)) {
            const s = mapa.get(o.socio_id);
            o.titular = `${s.apellido ?? ''}, ${s.nombre ?? ''}`.replace(/^, |, $/g, '').trim();
            o.numero_socio = s.numero_socio ?? null;
          } else if (o.nombre_externo) {
            o.titular = o.nombre_externo;
          }
        }
      }
    }

    const r = out.recurso;
    return res.json({
      ok: true,
      recurso: { id: r.id, nombre: r.nombre, duracion_turno_min: r.duracion_turno_min },
      desde, hasta, vista: vistaSocio ? 'socio' : 'panel',
      dias
    });
  } catch (e) {
    console.error('❌ GET espacios/turnos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// RESERVAS (paso 6)
// ============================================================
const ESTADOS_RESERVA = ['pendiente', 'aceptada', 'rechazada', 'cancelada', 'vencida'];

function responderError(res, e, etiqueta) {
  if (e instanceof reservasSvc.ErrNegocio) {
    return res.status(e.status).json({ ok: false, error: e.message, code: e.code, ...e.extra });
  }
  console.error(`❌ ${etiqueta}`, e);
  return res.status(500).json({ ok: false, error: e.message });
}
const adminUserId = (req) => req.user?.userId || req.user?.id || null;

// GET /club/:clubId/espacios/reservas?estado=pendiente,aceptada&desde&hasta&recurso_id&socio_id&orden=asc|desc&limit
router.get('/:clubId/espacios/reservas', ...leer, async (req, res) => {
  const { clubId } = req.params;
  try {
    const where = ['r.club_id = $1'];
    const params = [clubId];

    if (req.query.estado) {
      const estados = String(req.query.estado).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (!estados.length || estados.some((x) => !ESTADOS_RESERVA.includes(x))) {
        return res.status(400).json({ ok: false, error: `Estado inválido (${ESTADOS_RESERVA.join(', ')})` });
      }
      params.push(estados);
      where.push(`r.estado = ANY($${params.length}::text[])`);
    }
    for (const [k, op] of [['desde', '>='], ['hasta', '<=']]) {
      if (req.query[k]) {
        if (!isFechaReal(String(req.query[k]))) {
          return res.status(400).json({ ok: false, error: `${k} inválida (YYYY-MM-DD)` });
        }
        params.push(String(req.query[k]));
        where.push(`r.fecha ${op} $${params.length}::date`);
      }
    }
    for (const k of ['recurso_id', 'socio_id']) {
      if (req.query[k]) {
        if (!isUuid(req.query[k])) return res.status(400).json({ ok: false, error: `${k} inválido` });
        params.push(String(req.query[k]));
        where.push(`r.${k} = $${params.length}`);
      }
    }
    const orden = String(req.query.orden || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000);

    const q = await db.query(
      `
      SELECT r.id, r.recurso_id, rec.nombre AS recurso_nombre,
             r.socio_id, s.nombre AS socio_nombre, s.apellido AS socio_apellido, s.numero_socio,
             r.nombre_externo, r.contacto_externo,
             to_char(r.fecha, 'YYYY-MM-DD') AS fecha,
             to_char(r.hora_desde, 'HH24:MI') AS hora_desde,
             to_char(r.hora_hasta, 'HH24:MI') AS hora_hasta,
             r.estado, r.origen, r.comentario_socio, r.mensaje_admin, r.created_at, r.gestionada_at
        FROM recursos_reservas r
        JOIN recursos rec ON rec.id = r.recurso_id
        LEFT JOIN socios s ON s.id = r.socio_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.fecha ${orden}, r.hora_desde ${orden}, r.created_at ${orden}
       LIMIT ${limit}
      `,
      params
    );
    const reservas = q.rows.map((x) => ({
      ...x,
      titular: x.socio_id
        ? `${x.socio_apellido ?? ''}, ${x.socio_nombre ?? ''}`.replace(/^, |, $/g, '').trim()
        : x.nombre_externo
    }));
    return res.json({ ok: true, reservas });
  } catch (e) {
    return responderError(res, e, 'GET espacios/reservas');
  }
});

// POST /club/:clubId/espacios/reservas   (alta manual del club; nace aceptada)
// body: { recurso_id, fecha, hora_desde, socio_id? | nombre_externo (+contacto_externo?), comentario? }
router.post('/:clubId/espacios/reservas', ...escribir, async (req, res) => {
  const { clubId } = req.params;
  try {
    const b = req.body || {};
    if (!isUuid(b.recurso_id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });
    if (b.socio_id && !isUuid(b.socio_id)) return res.status(400).json({ ok: false, error: 'Socio inválido' });
    const creada = await reservasSvc.crearReserva(db, {
      clubId,
      recursoId: b.recurso_id,
      fecha: String(b.fecha || ''),
      horaDesde: String(b.hora_desde || ''),
      origen: 'panel',
      socioId: b.socio_id || null,
      nombreExterno: b.nombre_externo,
      contactoExterno: b.contacto_externo,
      comentario: b.comentario,
      adminUserId: adminUserId(req)
    });
    return res.status(201).json({ ok: true, reserva: creada });
  } catch (e) {
    return responderError(res, e, 'POST espacios/reservas');
  }
});

// POST /club/:clubId/espacios/reservas/:id/(aceptar|rechazar|cancelar)   body: { mensaje? }
for (const accion of ['aceptar', 'rechazar', 'cancelar']) {
  router.post(`/:clubId/espacios/reservas/:id/${accion}`, ...escribir, async (req, res) => {
    const { clubId, id } = req.params;
    try {
      if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Reserva inválida' });
      const r = await reservasSvc.gestionarReserva(db, {
        clubId, id, accion, mensaje: req.body?.mensaje, adminUserId: adminUserId(req)
      });
      return res.json({ ok: true, reserva: r });
    } catch (e) {
      return responderError(res, e, `POST espacios/reservas/${accion}`);
    }
  });
}

// ============================================================
// ABONOS (paso 8)
// ============================================================

// GET /club/:clubId/espacios/abonos?recurso_id&socio_id&estado=vigente|finalizado
router.get('/:clubId/espacios/abonos', ...leer, async (req, res) => {
  const { clubId } = req.params;
  try {
    for (const k of ['recurso_id', 'socio_id']) {
      if (req.query[k] && !isUuid(req.query[k])) return res.status(400).json({ ok: false, error: `${k} inválido` });
    }
    const estado = req.query.estado ? String(req.query.estado).toLowerCase() : null;
    if (estado && !['vigente', 'finalizado'].includes(estado)) {
      return res.status(400).json({ ok: false, error: 'Estado inválido (vigente, finalizado)' });
    }
    const abonos = await abonosSvc.listarAbonos(db, {
      clubId, recursoId: req.query.recurso_id || null, socioId: req.query.socio_id || null, estado
    });
    return res.json({ ok: true, abonos });
  } catch (e) {
    return responderError(res, e, 'GET espacios/abonos');
  }
});

// POST /club/:clubId/espacios/abonos
// body: { recurso_id, dia_semana (0=Dom..6=Sáb), hora_desde, hora_hasta, socio_id | nombre_externo (+contacto_externo),
//         vigente_desde?, vigente_hasta?, notas? }
router.post('/:clubId/espacios/abonos', ...escribir, async (req, res) => {
  const { clubId } = req.params;
  try {
    const b = req.body || {};
    if (!isUuid(b.recurso_id)) return res.status(400).json({ ok: false, error: 'Recurso inválido' });
    if (b.socio_id && !isUuid(b.socio_id)) return res.status(400).json({ ok: false, error: 'Socio inválido' });
    const abono = await abonosSvc.crearAbono(db, {
      clubId, recursoId: b.recurso_id, diaSemana: b.dia_semana,
      horaDesde: b.hora_desde, horaHasta: b.hora_hasta,
      socioId: b.socio_id || null, nombreExterno: b.nombre_externo, contactoExterno: b.contacto_externo,
      vigenteDesde: b.vigente_desde, vigenteHasta: b.vigente_hasta, notas: b.notas,
      adminUserId: adminUserId(req)
    });
    return res.status(201).json({ ok: true, abono });
  } catch (e) {
    return responderError(res, e, 'POST espacios/abonos');
  }
});

// PUT /club/:clubId/espacios/abonos/:id   (notas, contacto/nombre de externo, vigente_hasta)
// Cambiar día u hora = dar de baja y crear otro (deja historial).
router.put('/:clubId/espacios/abonos/:id', ...escribir, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Abono inválido' });
    const abono = await abonosSvc.editarAbono(db, { clubId, id, cambios: req.body || {} });
    return res.json({ ok: true, abono });
  } catch (e) {
    return responderError(res, e, 'PUT espacios/abonos/:id');
  }
});

// POST /club/:clubId/espacios/abonos/:id/baja   body: { fecha_hasta? }  (último día que aplica, inclusive; default hoy)
router.post('/:clubId/espacios/abonos/:id/baja', ...escribir, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Abono inválido' });
    const abono = await abonosSvc.darDeBaja(db, { clubId, id, fechaHasta: req.body?.fecha_hasta });
    return res.json({ ok: true, abono });
  } catch (e) {
    return responderError(res, e, 'POST espacios/abonos/:id/baja');
  }
});

// POST /club/:clubId/espacios/abonos/:id/excepciones   body: { fecha_desde, fecha_hasta?, motivo? }
router.post('/:clubId/espacios/abonos/:id/excepciones', ...escribir, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Abono inválido' });
    const b = req.body || {};
    const excepcion = await abonosSvc.agregarExcepcion(db, {
      clubId, id, fechaDesde: b.fecha_desde, fechaHasta: b.fecha_hasta, motivo: b.motivo
    });
    return res.status(201).json({ ok: true, excepcion });
  } catch (e) {
    return responderError(res, e, 'POST espacios/abonos/:id/excepciones');
  }
});

// DELETE /club/:clubId/espacios/abonos/:id/excepciones/:excId
router.delete('/:clubId/espacios/abonos/:id/excepciones/:excId', ...escribir, async (req, res) => {
  const { clubId, id, excId } = req.params;
  try {
    if (!isUuid(id) || !isUuid(excId)) return res.status(400).json({ ok: false, error: 'Identificador inválido' });
    await abonosSvc.quitarExcepcion(db, { clubId, id, excId });
    return res.json({ ok: true });
  } catch (e) {
    return responderError(res, e, 'DELETE espacios/abonos/:id/excepciones/:excId');
  }
});

module.exports = router;
