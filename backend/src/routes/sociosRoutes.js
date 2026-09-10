const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const { initFirebase } = require('../config/firebaseAdmin');
const multer = require('multer');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer'); // ✅ NUEVO: para el email de bienvenida

// ✅ NUEVO: tamaño de lote e intervalo entre lotes para la bienvenida por email
// (se puede ajustar sin tocar código, seteando estas variables de entorno en Render)
const BIENVENIDA_LOTE_SIZE = Number(process.env.BIENVENIDA_LOTE_SIZE || 20);
const BIENVENIDA_LOTE_INTERVALO_MIN = Number(process.env.BIENVENIDA_LOTE_INTERVALO_MIN || 60);

// ✅ NUEVO: DNI sin puntos ni otros caracteres, se usa al cargar/editar un
// socio a mano (el import de Excel ya tenía su propia versión de esto).
function onlyDigitsDni(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB (Excel)
});

// Upload para adjuntos de socio (máx 10 MB por archivo)
const uploadAdjunto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

const router = express.Router();

// ======================================
// GRUPO FAMILIAR HELPERS
// ======================================

async function getGrupoByJefe({ clubId, jefeSocioId }) {
  const r = await db.query(
    `
    SELECT id
    FROM grupos_familiares
    WHERE club_id = $1
      AND jefe_socio_id = $2
      AND activo = true
    LIMIT 1
    `,
    [clubId, jefeSocioId]
  );
  return r.rows[0] ?? null;
}


// ===============================
// Helper: validar acceso al club
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles || [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }
  next();
}

// ===============================
// BIENVENIDA POR EMAIL – HELPERS
// ===============================

// Mismo transporter que ya usa el proyecto en authRoutes.js / app.js
function getMailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
}

// ✅ Texto del mail de bienvenida. Editar SOLO acá cuando se quiera cambiar la redacción.
function buildBienvenidaEmail({ clubName, clubLogoUrl, nombre, apellido, numeroSocio, dni }) {
  const subject = `¡Bienvenido/a a ${clubName}!`;

  const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.todosobremiclub.app';
  const IOS_URL = 'https://apps.apple.com/ar/app/todo-sobre-mi-club/id6766353290';

  const text = `Hola ${nombre} ${apellido},

¡Te damos la bienvenida a ${clubName}!

Ya podés ingresar a la app de socios con estos datos:

Usuario (N° de socio): ${numeroSocio}
Contraseña (DNI): ${dni}

Descargá la app y sé parte de nuestro club.

Android: ${ANDROID_URL}
iOS: ${IOS_URL}

Saludos,
${clubName}`;

  // ✅ Logo del club en el encabezado (si el club tiene uno cargado)
  const logoHtml = clubLogoUrl
    ? `
      <div style="text-align:center; margin-bottom:18px;">
        <img src="${clubLogoUrl}" alt="${clubName}"
             style="max-width:160px; max-height:90px; object-fit:contain;">
      </div>
    `
    : '';

  const html = `
    <div style="font-family:Arial, sans-serif; color:#111; max-width:480px; margin:0 auto;">
      ${logoHtml}
      <p>Hola <b>${nombre} ${apellido}</b>,</p>
      <p>¡Te damos la bienvenida a <b>${clubName}</b>!</p>
      <p>Ya podés ingresar a la app de socios con estos datos:</p>
      <ul>
        <li><b>Usuario (N° de socio):</b> ${numeroSocio}</li>
        <li><b>Contraseña (DNI):</b> ${dni}</li>
      </ul>
      <p>Descargá la app y sé parte de nuestro club.</p>
      <p style="text-align:center; margin:22px 0;">
        <a href="${ANDROID_URL}"
           style="display:inline-block; margin:6px 8px; padding:10px 18px; background:#111827; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:bold; font-size:13px;">
          📲 Descargar para Android
        </a>
        <a href="${IOS_URL}"
           style="display:inline-block; margin:6px 8px; padding:10px 18px; background:#111827; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:bold; font-size:13px;">
          📱 Descargar para iOS
        </a>
      </p>
      <p>Saludos,<br>${clubName}</p>
    </div>
  `;

  return { subject, text, html };
}

// ===============================
// Helper: validar Excepción de Cuota
// ===============================
async function assertValidExcepcionCuota({ clubId, excepcionCuotaId }) {
  if (!excepcionCuotaId) return; // null/undefined => OK

  const r = await db.query(
    `
    SELECT id
    FROM excepciones_cuota
    WHERE id = $1
      AND club_id = $2
      AND activo = true
    LIMIT 1
    `,
    [excepcionCuotaId, clubId]
  );

  if (!r.rowCount) {
    const err = new Error('Excepción de cuota inválida');
    err.statusCode = 400;
    throw err;
  }
}

// ===============================
// Helpers Firebase delete
// ===============================
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
  const bucket = admin.storage().bucket();
  await bucket.file(objectPath).delete({ ignoreNotFound: true });
}

// ======================================
// GET grupo familiar de un socio (jefe)
// ======================================
router.get('/:clubId/grupo-familiar/:socioId', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId, socioId } = req.params;

    const rGrupo = await db.query(
      `
      SELECT id, jefe_socio_id
      FROM grupos_familiares
      WHERE club_id = $1
        AND jefe_socio_id = $2
        AND activo = true
      LIMIT 1
      `,
      [clubId, socioId]
    );

    if (!rGrupo.rowCount) {
      return res.json({ ok: true, grupo: null, miembros: [] });
    }

    const grupoId = rGrupo.rows[0].id;

    const rMiembros = await db.query(
      `
      SELECT s.id, s.nombre, s.apellido, s.numero_socio
      FROM grupos_familiares_miembros gm
      JOIN socios s ON s.id = gm.socio_id
      WHERE gm.grupo_familiar_id = $1
      `,
      [grupoId]
    );

    res.json({
      ok: true,
      grupo: rGrupo.rows[0],
      miembros: rMiembros.rows
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================
// CREAR / ACTUALIZAR GRUPO FAMILIAR
// ======================================
router.post('/:clubId/grupo-familiar', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { jefeSocioId, miembros } = req.body;

  if (!jefeSocioId) {
    return res.status(400).json({ ok: false, error: 'Falta el socio jefe del grupo familiar.' });
  }

  // ✅ NUEVO: sacamos duplicados y al propio jefe de la lista de miembros
  // ANTES de tocar la base (antes se filtraba el jefe adentro del loop,
  // pero un ID repetido en el array igual llegaba a intentar un INSERT
  // duplicado dentro del mismo grupo).
  const miembrosIds = [...new Set((miembros || []).map((id) => String(id)))]
    .filter((id) => id !== String(jefeSocioId));

  try {
    await db.query('BEGIN');

    // 1. buscar grupo existente
    let grupo = await getGrupoByJefe({ clubId, jefeSocioId });

    // 2. crear si no existe
    if (!grupo) {
      const rNew = await db.query(
        `
        INSERT INTO grupos_familiares (id, club_id, jefe_socio_id, activo, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW())
        RETURNING id
        `,
        [clubId, jefeSocioId]
      );
      grupo = rNew.rows[0];
    }

    const grupoId = grupo.id;

    // ✅ NUEVO: validar ANTES de insertar que ninguno de los socios elegidos
    // ya sea miembro de OTRO grupo familiar activo. Antes esto solo se
    // filtraba en el frontend contra una lista de socios que se cacheaba una
    // sola vez (podía quedar desactualizada), y si igual llegaba a pasar acá,
    // Postgres lo cortaba con un 500 crudo:
    // "duplicate key value violates unique constraint ux_miembro_unico".
    if (miembrosIds.length) {
      const rConflicto = await db.query(
        `
        SELECT s.id, s.nombre, s.apellido, s.numero_socio
        FROM grupos_familiares_miembros gfm
        JOIN grupos_familiares gf ON gf.id = gfm.grupo_familiar_id
        JOIN socios s ON s.id = gfm.socio_id
        WHERE gf.club_id = $1
          AND gf.activo = true
          AND gf.id <> $2
          AND gfm.socio_id = ANY($3::uuid[])
        `,
        [clubId, grupoId, miembrosIds]
      );

      if (rConflicto.rowCount) {
        await db.query('ROLLBACK');
        const nombres = rConflicto.rows
          .map((s) => `${s.apellido} ${s.nombre} (N° ${s.numero_socio})`)
          .join(', ');
        return res.status(409).json({
          ok: false,
          error: `Ya pertenece a otro Grupo Familiar activo: ${nombres}. Sacalo de ese grupo antes de agregarlo acá.`
        });
      }
    }

    // 3. limpiar miembros anteriores de ESTE grupo
    await db.query(
      `DELETE FROM grupos_familiares_miembros WHERE grupo_familiar_id = $1`,
      [grupoId]
    );

    // 4. insertar nuevos miembros
    for (const socioId of miembrosIds) {
      await db.query(
        `
        INSERT INTO grupos_familiares_miembros (id, grupo_familiar_id, socio_id, created_at)
        VALUES (gen_random_uuid(), $1, $2, NOW())
        `,
        [grupoId, socioId]
      );
    }

    await db.query('COMMIT');
    res.json({ ok: true });

  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}

    // ✅ NUEVO: red de seguridad por si dos guardados chocan justo al mismo
    // tiempo (carrera) y la validación de arriba no llegó a agarrarlo.
    if (e && e.code === '23505') {
      return res.status(409).json({
        ok: false,
        error: 'Uno de los socios seleccionados ya pertenece a otro Grupo Familiar activo. Actualizá la pantalla e intentá de nuevo.'
      });
    }

    console.error('❌ POST grupo-familiar', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================
// ELIMINAR GRUPO FAMILIAR
// ======================================
router.delete('/:clubId/grupo-familiar/:jefeSocioId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, jefeSocioId } = req.params;

  try {
    await db.query('BEGIN');

    const rGrupo = await db.query(
      `
      SELECT id
      FROM grupos_familiares
      WHERE club_id = $1
        AND jefe_socio_id = $2
        AND activo = true
      LIMIT 1
      `,
      [clubId, jefeSocioId]
    );

    if (rGrupo.rowCount) {
      const grupoId = rGrupo.rows[0].id;

      // ✅ NUEVO: esto antes NO se borraba. Las filas de miembros quedaban
      // huérfanas (el grupo pasaba a activo=false pero sus integrantes
      // seguían en grupos_familiares_miembros), y esas filas viejas chocaban
      // contra "ux_miembro_unico" apenas alguien intentaba volver a armar un
      // Grupo Familiar con esos mismos socios más adelante.
      await db.query(
        `DELETE FROM grupos_familiares_miembros WHERE grupo_familiar_id = $1`,
        [grupoId]
      );

      await db.query(
        `
        UPDATE grupos_familiares
        SET activo = false, updated_at = NOW()
        WHERE id = $1
        `,
        [grupoId]
      );
    }

    await db.query('COMMIT');
    res.json({ ok: true });

  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ DELETE grupo-familiar', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// PLAN DE CUOTAS PERSONALIZADO POR SOCIO + ACTIVIDAD
// (para actividades con esquema de pago irregular, ej: equitación)
// ===============================

// Arma la sugerencia de cuotas repitiendo el mismo monto cada tanto (1, 2, 3
// o 6 meses según la periodicidad elegida: mensual, bimestral, trimestral o
// semestral). El admin la puede editar antes de guardar.
function generarCuotasSugeridas({ montoPorMes, cantidadCuotas, periodicidadMeses, mesInicio, anioInicio }) {
  const monto = Math.round(Number(montoPorMes) * 100) / 100;
  const cant = parseInt(cantidadCuotas, 10);
  const paso = parseInt(periodicidadMeses, 10) || 1; // 1=mensual, 2=bimestral, 3=trimestral, 6=semestral
  const cuotas = [];

  let mes = parseInt(mesInicio, 10);
  let anio = parseInt(anioInicio, 10);

  for (let i = 1; i <= cant; i++) {
    cuotas.push({ numero_cuota: i, anio, mes, monto });

    mes += paso;
    while (mes > 12) { mes -= 12; anio++; }
  }

  return cuotas;
}

// GET: lista los planes (activos e inactivos) de un socio, con sus cuotas
router.get('/:clubId/socios/:socioId/planes-actividad', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, socioId } = req.params;
  try {
    const rPlanes = await db.query(
      `
      SELECT p.id, p.actividad_id, p.activo, p.created_at,
             a.nombre AS actividad_nombre
      FROM planes_actividad_socio p
      JOIN actividades_adicionales a ON a.id = p.actividad_id
      WHERE p.club_id = $1 AND p.socio_id = $2
      ORDER BY p.created_at DESC
      `,
      [clubId, socioId]
    );

    const planes = rPlanes.rows;
    if (planes.length) {
      const ids = planes.map(p => p.id);
      const rCuotas = await db.query(
        `
        SELECT id, plan_id, numero_cuota, anio, mes, monto, pagado, fecha_pago, cuenta
        FROM planes_actividad_cuotas
        WHERE plan_id = ANY($1::uuid[])
        ORDER BY anio, mes, numero_cuota
        `,
        [ids]
      );
      for (const plan of planes) {
        plan.cuotas = rCuotas.rows.filter(c => c.plan_id === plan.id);
      }
    }

    res.json({ ok: true, planes });
  } catch (e) {
    console.error('❌ GET planes-actividad', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: sugiere cuotas en partes iguales, SIN guardar nada todavía.
// El frontend usa esto para prellenar la tabla editable antes de confirmar.
router.post('/:clubId/planes-actividad/sugerir-cuotas', requireAuth, requireClubAccess, async (req, res) => {
  const { montoPorMes, cantidadCuotas, periodicidadMeses, mesInicio, anioInicio } = req.body;

  if (!montoPorMes || !cantidadCuotas || !mesInicio || !anioInicio) {
    return res.status(400).json({ ok: false, error: 'Faltan datos para sugerir las cuotas.' });
  }

  try {
    const cuotas = generarCuotasSugeridas({ montoPorMes, cantidadCuotas, periodicidadMeses, mesInicio, anioInicio });
    res.json({ ok: true, cuotas });
  } catch (e) {
    console.error('❌ POST sugerir-cuotas', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: crea (o reactiva) el plan de un socio para una actividad, con el
// detalle de cuotas ya definitivo (el que el admin confirmó, editado o no).
router.post('/:clubId/socios/:socioId/planes-actividad', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, socioId } = req.params;
  const { actividad_id, cuotas } = req.body;

  if (!actividad_id || !Array.isArray(cuotas) || !cuotas.length) {
    return res.status(400).json({ ok: false, error: 'Falta la actividad o el detalle de cuotas.' });
  }

  for (const c of cuotas) {
    if (!c.anio || !c.mes || c.monto == null) {
      return res.status(400).json({ ok: false, error: 'Cada cuota necesita año, mes y monto.' });
    }
  }

  try {
    await db.query('BEGIN');

    // ¿ya existe un plan (activo o no) para este socio+actividad? Por el
    // UNIQUE (club_id, socio_id, actividad_id) no podemos insertar otro:
    // si existe, lo reactivamos y le reemplazamos las cuotas.
    const rExiste = await db.query(
      `SELECT id FROM planes_actividad_socio WHERE club_id = $1 AND socio_id = $2 AND actividad_id = $3`,
      [clubId, socioId, actividad_id]
    );

    let planId;
    if (rExiste.rowCount) {
      planId = rExiste.rows[0].id;
      await db.query(
        `UPDATE planes_actividad_socio SET activo = true, updated_at = NOW() WHERE id = $1`,
        [planId]
      );
      await db.query(`DELETE FROM planes_actividad_cuotas WHERE plan_id = $1`, [planId]);
    } else {
      const rNew = await db.query(
        `
        INSERT INTO planes_actividad_socio (id, club_id, socio_id, actividad_id, activo, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, true, NOW(), NOW())
        RETURNING id
        `,
        [clubId, socioId, actividad_id]
      );
      planId = rNew.rows[0].id;
    }

    for (const c of cuotas) {
      await db.query(
        `
        INSERT INTO planes_actividad_cuotas (id, plan_id, numero_cuota, anio, mes, monto, pagado)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, false)
        `,
        [planId, c.numero_cuota || null, c.anio, c.mes, c.monto]
      );
    }

    await db.query('COMMIT');
    res.json({ ok: true, planId });

  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST planes-actividad', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT: reemplaza el detalle de cuotas de un plan existente (edición posterior)
router.put('/:clubId/planes-actividad/:planId/cuotas', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId } = req.params;
  const { cuotas } = req.body;

  if (!Array.isArray(cuotas) || !cuotas.length) {
    return res.status(400).json({ ok: false, error: 'Falta el detalle de cuotas.' });
  }

  try {
    const rPlan = await db.query(
      `SELECT id FROM planes_actividad_socio WHERE id = $1 AND club_id = $2`,
      [planId, clubId]
    );
    if (!rPlan.rowCount) {
      return res.status(404).json({ ok: false, error: 'Plan no encontrado.' });
    }

    await db.query('BEGIN');
    // Solo se tocan las cuotas que todavía no fueron pagadas, para no
    // perder el historial de pago de las que ya se cobraron.
    await db.query(`DELETE FROM planes_actividad_cuotas WHERE plan_id = $1 AND pagado = false`, [planId]);

    for (const c of cuotas) {
      if (c.pagado) continue; // las pagadas no se re-insertan, ya siguen ahí
      await db.query(
        `
        INSERT INTO planes_actividad_cuotas (id, plan_id, numero_cuota, anio, mes, monto, pagado)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, false)
        `,
        [planId, c.numero_cuota || null, c.anio, c.mes, c.monto]
      );
    }

    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ PUT planes-actividad/cuotas', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// Helper: resuelve el nombre de la cuenta a partir de cuenta_id
// (mismo criterio que usa pagosRoutes.js para la cuota social)
// ------------------------------------------------------------
async function resolverCuentaPlanCuotas({ clubId, cuenta, cuenta_id }) {
  if (cuenta) return cuenta;
  if (!cuenta_id) return null;
  try {
    const r = await db.query(
      `SELECT nombre FROM responsables_gasto WHERE id = $1 AND club_id = $2 LIMIT 1`,
      [cuenta_id, clubId]
    );
    return r.rowCount ? r.rows[0].nombre : null;
  } catch (e) {
    console.error('Error resolviendo cuenta (plan de cuotas)', e);
    return null;
  }
}

// POST: registra el pago DE VERDAD de una o varias cuotas del plan.
// A diferencia de un simple check, esto:
//  1) Suma el monto de cada cuota como un concepto más dentro de
//     pagos_mensuales (la misma tabla de la que salen recaudación y
//     todos los reportes), en el mes exacto al que corresponde esa cuota.
//  2) Guarda la cuenta elegida, igual que en el pago de la cuota social.
//  3) Marca la cuota como pagada en el plan.
// A propósito NO participa del cálculo de "pago_completo" de ese mes
// (el que decide si el socio está al día con la cuota social): pagar
// una cuota de una actividad especial no debe hacer que alguien
// aparezca "al día" o "en mora" del club por un concepto aparte.
router.post('/:clubId/planes-actividad/:planId/registrar-pago', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId } = req.params;
  const { cuotaIds, cuenta, cuenta_id, fecha_pago } = req.body;

  if (!Array.isArray(cuotaIds) || !cuotaIds.length) {
    return res.status(400).json({ ok: false, error: 'Seleccioná al menos una cuota.' });
  }

  const cuentaFinal = await resolverCuentaPlanCuotas({ clubId, cuenta, cuenta_id });
  if (!cuentaFinal) {
    return res.status(400).json({ ok: false, error: 'Elegí la cuenta con la que se cobró.' });
  }

  const fechaPagoFinal = fecha_pago || new Date().toISOString().slice(0, 10);

  try {
    const rPlan = await db.query(
      `
      SELECT p.id, p.socio_id, p.actividad_id, a.nombre AS actividad_nombre,
             s.nombre AS socio_nombre, s.apellido AS socio_apellido, s.numero_socio
      FROM planes_actividad_socio p
      JOIN actividades_adicionales a ON a.id = p.actividad_id
      JOIN socios s ON s.id = p.socio_id
      WHERE p.id = $1 AND p.club_id = $2
      `,
      [planId, clubId]
    );
    if (!rPlan.rowCount) {
      return res.status(404).json({ ok: false, error: 'Plan no encontrado.' });
    }
    const plan = rPlan.rows[0];

    const rTotalCuotas = await db.query(
      `SELECT COUNT(*) AS total FROM planes_actividad_cuotas WHERE plan_id = $1`,
      [planId]
    );
    const totalCuotas = Number(rTotalCuotas.rows[0]?.total || 0);

    const rCuotas = await db.query(
      `
      SELECT id, numero_cuota, anio, mes, monto
      FROM planes_actividad_cuotas
      WHERE plan_id = $1 AND id = ANY($2::uuid[]) AND pagado = false
      `,
      [planId, cuotaIds]
    );

    if (!rCuotas.rowCount) {
      return res.status(400).json({ ok: false, error: 'Las cuotas seleccionadas ya están pagadas o no existen.' });
    }

    await db.query('BEGIN');

    for (const cuota of rCuotas.rows) {
      const item = {
        tipo: 'plan_actividad',
        nombre: `${plan.actividad_nombre} - Cuota ${cuota.numero_cuota}/${totalCuotas}`,
        monto: Number(cuota.monto),
        seleccionado: true,
        plan_cuota_id: cuota.id
      };

      const rPrev = await db.query(
        `
        SELECT id, detalle_pago, monto_total_teorico
        FROM pagos_mensuales
        WHERE club_id = $1 AND socio_id = $2 AND anio = $3 AND mes = $4
        LIMIT 1
        `,
        [clubId, plan.socio_id, cuota.anio, cuota.mes]
      );

      if (!rPrev.rowCount) {
        await db.query(
          `
          INSERT INTO pagos_mensuales
          (club_id, socio_id, socio_nombre, socio_apellido, socio_numero, anio, mes,
           monto, fecha_pago, cuenta, detalle_pago, monto_total_teorico, monto_pagado, pago_completo)
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false)
          `,
          [
            clubId, plan.socio_id, plan.socio_nombre, plan.socio_apellido, plan.numero_socio,
            cuota.anio, cuota.mes,
            item.monto, fechaPagoFinal, cuentaFinal, JSON.stringify([item]), item.monto, item.monto
          ]
        );
      } else {
        const prev = rPrev.rows[0];
        const prevDetalle = Array.isArray(prev.detalle_pago) ? prev.detalle_pago : [];
        const mergedDetalle = [...prevDetalle.filter(d => d.plan_cuota_id !== cuota.id), item];

        const montoPagado = mergedDetalle
          .filter(d => d.seleccionado === true)
          .reduce((acc, d) => acc + Number(d.monto || 0), 0);

        // ✅ "pago_completo" solo depende de los conceptos que NO son de un
        // plan de cuotas (base + adicionales normales), para no alterar el
        // estado de mora de la cuota social del club.
        const itemsCuotaSocial = mergedDetalle.filter(d => d.tipo !== 'plan_actividad');
        const pagoCompleto = itemsCuotaSocial.length > 0
          ? itemsCuotaSocial.every(d => d.seleccionado === true)
          : false;

        const montoTeoricoNuevo = Number(prev.monto_total_teorico || 0) + item.monto;

        await db.query(
          `
          UPDATE pagos_mensuales
          SET monto = $1, fecha_pago = $2, cuenta = $3, detalle_pago = $4,
              monto_total_teorico = $5, monto_pagado = $1, pago_completo = $6
          WHERE id = $7
          `,
          [montoPagado, fechaPagoFinal, cuentaFinal, JSON.stringify(mergedDetalle), montoTeoricoNuevo, pagoCompleto, prev.id]
        );
      }

      await db.query(
        `UPDATE planes_actividad_cuotas SET pagado = true, fecha_pago = $1, cuenta = $2 WHERE id = $3`,
        [fechaPagoFinal, cuentaFinal, cuota.id]
      );
    }

    await db.query('COMMIT');
    res.json({ ok: true, cuotasPagadas: rCuotas.rows.length });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST registrar-pago plan cuotas', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: deshace el pago de una cuota puntual (por si se cargó mal).
// Saca el concepto correspondiente de pagos_mensuales y recalcula esa
// fila, y vuelve a dejar la cuota como pendiente en el plan.
router.post('/:clubId/planes-actividad/:planId/cuotas/:cuotaId/revertir-pago', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId, cuotaId } = req.params;

  try {
    const rPlan = await db.query(
      `SELECT id, socio_id FROM planes_actividad_socio WHERE id = $1 AND club_id = $2`,
      [planId, clubId]
    );
    if (!rPlan.rowCount) {
      return res.status(404).json({ ok: false, error: 'Plan no encontrado.' });
    }
    const socioId = rPlan.rows[0].socio_id;

    const rCuota = await db.query(
      `SELECT id, anio, mes, monto, pagado FROM planes_actividad_cuotas WHERE id = $1 AND plan_id = $2`,
      [cuotaId, planId]
    );
    if (!rCuota.rowCount) {
      return res.status(404).json({ ok: false, error: 'Cuota no encontrada.' });
    }
    const cuota = rCuota.rows[0];

    if (!cuota.pagado) {
      return res.json({ ok: true }); // ya estaba pendiente, nada que hacer
    }

    await db.query('BEGIN');

    const rPrev = await db.query(
      `
      SELECT id, detalle_pago, monto_total_teorico
      FROM pagos_mensuales
      WHERE club_id = $1 AND socio_id = $2 AND anio = $3 AND mes = $4
      LIMIT 1
      `,
      [clubId, socioId, cuota.anio, cuota.mes]
    );

    if (rPrev.rowCount) {
      const prev = rPrev.rows[0];
      const prevDetalle = Array.isArray(prev.detalle_pago) ? prev.detalle_pago : [];
      const mergedDetalle = prevDetalle.filter(d => d.plan_cuota_id !== cuotaId);

      const montoPagado = mergedDetalle
        .filter(d => d.seleccionado === true)
        .reduce((acc, d) => acc + Number(d.monto || 0), 0);

      const itemsCuotaSocial = mergedDetalle.filter(d => d.tipo !== 'plan_actividad');
      const pagoCompleto = itemsCuotaSocial.length > 0
        ? itemsCuotaSocial.every(d => d.seleccionado === true)
        : false;

      const montoTeoricoNuevo = Math.max(0, Number(prev.monto_total_teorico || 0) - Number(cuota.monto));

      await db.query(
        `
        UPDATE pagos_mensuales
        SET monto = $1, detalle_pago = $2, monto_total_teorico = $3,
            monto_pagado = $1, pago_completo = $4
        WHERE id = $5
        `,
        [montoPagado, JSON.stringify(mergedDetalle), montoTeoricoNuevo, pagoCompleto, prev.id]
      );
    }

    await db.query(
      `UPDATE planes_actividad_cuotas SET pagado = false, fecha_pago = NULL, cuenta = NULL WHERE id = $1`,
      [cuotaId]
    );

    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST revertir-pago plan cuotas', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE: da de baja el plan (soft-delete, igual que Grupo Familiar)
router.delete('/:clubId/planes-actividad/:planId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId } = req.params;
  try {
    await db.query(
      `UPDATE planes_actividad_socio SET activo = false, updated_at = NOW() WHERE id = $1 AND club_id = $2`,
      [planId, clubId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE planes-actividad', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// PLAN DE CLASES POR SOCIO + ACTIVIDAD
// (para actividades que se pagan por paquete de clases, no por mes,
// ej: clases sueltas de equitación que no son fijas en el calendario)
// ===============================

// GET: lista los paquetes (activos e inactivos) de un socio, con su
// historial de clases tomadas y de pagos parciales ya calculados.
router.get('/:clubId/socios/:socioId/planes-clases', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, socioId } = req.params;
  try {
    const rPlanes = await db.query(
      `
      SELECT p.id, p.actividad_id, p.tipo_actividad, p.cantidad_clases, p.monto_total,
             p.activo, p.fecha_inicio, p.created_at,
             COALESCE(aa.nombre, ad.nombre) AS actividad_nombre
      FROM planes_clases_socio p
      LEFT JOIN actividades_adicionales aa
        ON aa.id = p.actividad_id AND p.tipo_actividad = 'adicional'
      LEFT JOIN actividades ad
        ON ad.id = p.actividad_id AND p.tipo_actividad = 'deportiva'
      WHERE p.club_id = $1 AND p.socio_id = $2
      ORDER BY p.created_at DESC
      `,
      [clubId, socioId]
    );

    const planes = rPlanes.rows;
    if (planes.length) {
      const ids = planes.map(p => p.id);

      const rRegistro = await db.query(
        `
        SELECT id, plan_id, fecha
        FROM planes_clases_registro
        WHERE plan_id = ANY($1::uuid[])
        ORDER BY fecha ASC
        `,
        [ids]
      );

      const rPagos = await db.query(
        `
        SELECT id, plan_id, monto, fecha_pago, cuenta
        FROM planes_clases_pagos
        WHERE plan_id = ANY($1::uuid[])
        ORDER BY fecha_pago ASC NULLS LAST, created_at ASC
        `,
        [ids]
      );

      for (const plan of planes) {
        plan.registro = rRegistro.rows.filter(r => r.plan_id === plan.id);
        plan.pagos = rPagos.rows.filter(pg => pg.plan_id === plan.id);
        plan.clases_tomadas = plan.registro.length;
        plan.clases_restantes = Number(plan.cantidad_clases) - plan.clases_tomadas;
        plan.monto_pagado = plan.pagos.reduce((acc, pg) => acc + Number(pg.monto || 0), 0);
        plan.saldo_pendiente = Math.round((Number(plan.monto_total) - plan.monto_pagado) * 100) / 100;
      }
    }

    res.json({ ok: true, planes });
  } catch (e) {
    console.error('❌ GET planes-clases', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: crea un paquete nuevo (compra inicial o renovación). Cada
// renovación es un plan nuevo, para conservar el historial de cada
// paquete comprado por separado.
router.post('/:clubId/socios/:socioId/planes-clases', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, socioId } = req.params;
  const { actividad_id, tipo_actividad, cantidad_clases, monto_total, fecha_inicio } = req.body;

  const cantidadNum = Number(cantidad_clases);
  const montoNum = Number(monto_total);
  const tipoActividadVal = (tipo_actividad === 'deportiva') ? 'deportiva' : 'adicional';

  if (!actividad_id) {
    return res.status(400).json({ ok: false, error: 'Elegí la actividad.' });
  }
  if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
    return res.status(400).json({ ok: false, error: 'La cantidad de clases debe ser mayor a 0.' });
  }
  if (!Number.isFinite(montoNum) || montoNum < 0) {
    return res.status(400).json({ ok: false, error: 'El monto del paquete no es válido.' });
  }

  try {
    const tablaActividad = tipoActividadVal === 'deportiva' ? 'actividades' : 'actividades_adicionales';
    const rAct = await db.query(
      `SELECT id, nombre FROM ${tablaActividad} WHERE id = $1 AND club_id = $2 AND activo = true`,
      [actividad_id, clubId]
    );
    if (!rAct.rowCount) {
      return res.status(404).json({ ok: false, error: 'Actividad no encontrada.' });
    }

    const rIns = await db.query(
      `
      INSERT INTO planes_clases_socio
        (id, club_id, socio_id, actividad_id, tipo_actividad, cantidad_clases, monto_total, activo, fecha_inicio, created_at, updated_at)
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, $7, NOW(), NOW())
      RETURNING id
      `,
      [clubId, socioId, actividad_id, tipoActividadVal, cantidadNum, montoNum, fecha_inicio || null]
    );

    res.json({ ok: true, planId: rIns.rows[0].id });
  } catch (e) {
    console.error('❌ POST planes-clases', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT: edita cantidad de clases / monto / fecha de inicio de un paquete
// ya creado (por ejemplo, si se cargó mal).
router.put('/:clubId/planes-clases/:planId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId } = req.params;
  const { cantidad_clases, monto_total, fecha_inicio } = req.body;

  const cantidadNum = Number(cantidad_clases);
  const montoNum = Number(monto_total);

  if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
    return res.status(400).json({ ok: false, error: 'La cantidad de clases debe ser mayor a 0.' });
  }
  if (!Number.isFinite(montoNum) || montoNum < 0) {
    return res.status(400).json({ ok: false, error: 'El monto del paquete no es válido.' });
  }

  try {
    const r = await db.query(
      `
      UPDATE planes_clases_socio
      SET cantidad_clases = $1, monto_total = $2, fecha_inicio = $3, updated_at = NOW()
      WHERE id = $4 AND club_id = $5
      RETURNING id
      `,
      [cantidadNum, montoNum, fecha_inicio || null, planId, clubId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado.' });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('❌ PUT planes-clases', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE: da de baja el paquete (soft-delete, igual que el plan de cuotas)
router.delete('/:clubId/planes-clases/:planId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId } = req.params;
  try {
    const r = await db.query(
      `UPDATE planes_clases_socio SET activo = false, updated_at = NOW() WHERE id = $1 AND club_id = $2`,
      [planId, clubId]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado.' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE planes-clases', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: registra que el socio tomó una clase (botón manual). No bloquea
// nada si no quedan clases disponibles o el paquete no está pagado: solo
// se informa en la ficha, y el admin decide si hay que renovar/cobrar.
router.post('/:clubId/planes-clases/:planId/registrar-clase', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId } = req.params;
  const { fecha } = req.body || {};

  try {
    const rPlan = await db.query(
      `SELECT id FROM planes_clases_socio WHERE id = $1 AND club_id = $2`,
      [planId, clubId]
    );
    if (!rPlan.rowCount) {
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado.' });
    }

    const fechaFinal = fecha || new Date().toISOString();

    const rIns = await db.query(
      `INSERT INTO planes_clases_registro (id, plan_id, fecha, created_at)
       VALUES (gen_random_uuid(), $1, $2, NOW())
       RETURNING id, fecha`,
      [planId, fechaFinal]
    );

    res.json({ ok: true, registro: rIns.rows[0] });
  } catch (e) {
    console.error('❌ POST registrar-clase', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE: deshace una clase registrada por error.
router.delete('/:clubId/planes-clases/:planId/registro/:registroId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId, registroId } = req.params;
  try {
    const r = await db.query(
      `
      DELETE FROM planes_clases_registro
      WHERE id = $1 AND plan_id = $2
        AND plan_id IN (SELECT id FROM planes_clases_socio WHERE club_id = $3)
      `,
      [registroId, planId, clubId]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro no encontrado.' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ DELETE registro plan-clases', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: registra un pago parcial (o total) del paquete. Igual que en el
// plan de cuotas, el monto se suma como un concepto más dentro de
// pagos_mensuales (para que aparezca en recaudación y reportes), en el
// mes de la fecha de pago elegida, pero SIN participar del cálculo de
// "pago_completo" de la cuota social (no afecta la mora del club).
router.post('/:clubId/planes-clases/:planId/registrar-pago', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId } = req.params;
  const { monto, cuenta, cuenta_id, fecha_pago } = req.body;

  const montoNum = Number(monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ ok: false, error: 'Ingresá un monto válido.' });
  }

  const cuentaFinal = await resolverCuentaPlanCuotas({ clubId, cuenta, cuenta_id });
  if (!cuentaFinal) {
    return res.status(400).json({ ok: false, error: 'Elegí la cuenta con la que se cobró.' });
  }

  const fechaPagoFinal = fecha_pago || new Date().toISOString().slice(0, 10);
  const [anioStr, mesStr] = fechaPagoFinal.slice(0, 7).split('-');
  const anio = Number(anioStr);
  const mes = Number(mesStr);

  try {
    const rPlan = await db.query(
      `
      SELECT p.id, p.socio_id, p.actividad_id, COALESCE(aa.nombre, ad.nombre) AS actividad_nombre,
             s.nombre AS socio_nombre, s.apellido AS socio_apellido, s.numero_socio
      FROM planes_clases_socio p
      LEFT JOIN actividades_adicionales aa
        ON aa.id = p.actividad_id AND p.tipo_actividad = 'adicional'
      LEFT JOIN actividades ad
        ON ad.id = p.actividad_id AND p.tipo_actividad = 'deportiva'
      JOIN socios s ON s.id = p.socio_id
      WHERE p.id = $1 AND p.club_id = $2
      `,
      [planId, clubId]
    );
    if (!rPlan.rowCount) {
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado.' });
    }
    const plan = rPlan.rows[0];

    await db.query('BEGIN');

    const rPago = await db.query(
      `INSERT INTO planes_clases_pagos (id, plan_id, monto, fecha_pago, cuenta, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       RETURNING id`,
      [planId, montoNum, fechaPagoFinal, cuentaFinal]
    );
    const pagoId = rPago.rows[0].id;

    const item = {
      tipo: 'plan_clases',
      nombre: `${plan.actividad_nombre} - Paquete de clases`,
      monto: montoNum,
      seleccionado: true,
      plan_clases_pago_id: pagoId
    };

    const rPrev = await db.query(
      `
      SELECT id, detalle_pago, monto_total_teorico
      FROM pagos_mensuales
      WHERE club_id = $1 AND socio_id = $2 AND anio = $3 AND mes = $4
      LIMIT 1
      `,
      [clubId, plan.socio_id, anio, mes]
    );

    if (!rPrev.rowCount) {
      await db.query(
        `
        INSERT INTO pagos_mensuales
        (club_id, socio_id, socio_nombre, socio_apellido, socio_numero, anio, mes,
         monto, fecha_pago, cuenta, detalle_pago, monto_total_teorico, monto_pagado, pago_completo)
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false)
        `,
        [
          clubId, plan.socio_id, plan.socio_nombre, plan.socio_apellido, plan.numero_socio,
          anio, mes,
          item.monto, fechaPagoFinal, cuentaFinal, JSON.stringify([item]), item.monto, item.monto
        ]
      );
    } else {
      const prev = rPrev.rows[0];
      const prevDetalle = Array.isArray(prev.detalle_pago) ? prev.detalle_pago : [];
      const mergedDetalle = [...prevDetalle, item];

      const montoPagado = mergedDetalle
        .filter(d => d.seleccionado === true)
        .reduce((acc, d) => acc + Number(d.monto || 0), 0);

      // ✅ Mismo criterio que el plan de cuotas: "pago_completo" solo
      // depende de los conceptos que NO son de un plan de clases/cuotas.
      const itemsCuotaSocial = mergedDetalle.filter(d => d.tipo !== 'plan_clases' && d.tipo !== 'plan_actividad');
      const pagoCompleto = itemsCuotaSocial.length > 0
        ? itemsCuotaSocial.every(d => d.seleccionado === true)
        : false;

      const montoTeoricoNuevo = Number(prev.monto_total_teorico || 0) + item.monto;

      await db.query(
        `
        UPDATE pagos_mensuales
        SET monto = $1, fecha_pago = $2, cuenta = $3, detalle_pago = $4,
            monto_total_teorico = $5, monto_pagado = $1, pago_completo = $6
        WHERE id = $7
        `,
        [montoPagado, fechaPagoFinal, cuentaFinal, JSON.stringify(mergedDetalle), montoTeoricoNuevo, pagoCompleto, prev.id]
      );
    }

    await db.query('COMMIT');
    res.json({ ok: true, pagoId });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST registrar-pago plan-clases', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: deshace un pago parcial cargado por error.
router.post('/:clubId/planes-clases/:planId/pagos/:pagoId/revertir-pago', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, planId, pagoId } = req.params;

  try {
    const rPlan = await db.query(
      `SELECT id, socio_id FROM planes_clases_socio WHERE id = $1 AND club_id = $2`,
      [planId, clubId]
    );
    if (!rPlan.rowCount) {
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado.' });
    }
    const socioId = rPlan.rows[0].socio_id;

    const rPago = await db.query(
      `SELECT id, monto, fecha_pago FROM planes_clases_pagos WHERE id = $1 AND plan_id = $2`,
      [pagoId, planId]
    );
    if (!rPago.rowCount) {
      return res.status(404).json({ ok: false, error: 'Pago no encontrado.' });
    }
    const pago = rPago.rows[0];
    const fechaPago = new Date(pago.fecha_pago);
    const anio = fechaPago.getUTCFullYear();
    const mes = fechaPago.getUTCMonth() + 1;

    await db.query('BEGIN');

    const rPrev = await db.query(
      `
      SELECT id, detalle_pago, monto_total_teorico
      FROM pagos_mensuales
      WHERE club_id = $1 AND socio_id = $2 AND anio = $3 AND mes = $4
      LIMIT 1
      `,
      [clubId, socioId, anio, mes]
    );

    if (rPrev.rowCount) {
      const prev = rPrev.rows[0];
      const prevDetalle = Array.isArray(prev.detalle_pago) ? prev.detalle_pago : [];
      const mergedDetalle = prevDetalle.filter(d => d.plan_clases_pago_id !== pagoId);

      const montoPagado = mergedDetalle
        .filter(d => d.seleccionado === true)
        .reduce((acc, d) => acc + Number(d.monto || 0), 0);

      const itemsCuotaSocial = mergedDetalle.filter(d => d.tipo !== 'plan_clases' && d.tipo !== 'plan_actividad');
      const pagoCompleto = itemsCuotaSocial.length > 0
        ? itemsCuotaSocial.every(d => d.seleccionado === true)
        : false;

      const montoTeoricoNuevo = Math.max(0, Number(prev.monto_total_teorico || 0) - Number(pago.monto));

      await db.query(
        `
        UPDATE pagos_mensuales
        SET monto = $1, detalle_pago = $2, monto_total_teorico = $3,
            monto_pagado = $1, pago_completo = $4
        WHERE id = $5
        `,
        [montoPagado, JSON.stringify(mergedDetalle), montoTeoricoNuevo, pagoCompleto, prev.id]
      );
    }

    await db.query(`DELETE FROM planes_clases_pagos WHERE id = $1`, [pagoId]);

    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST revertir-pago plan-clases', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// LISTAR / BUSCAR / FILTRAR (+ pago_al_dia)
// ===============================
router.get('/:clubId/socios', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const {
      search = '',
      categoria = '',
      actividad = '',
      activo = '',
      anio = '',
      limit = '200',
      offset = '0'
    } = req.query;

    const where = ['s.club_id = $1'];
    const params = [clubId];
    let p = 2;

    if (activo !== '') {
      where.push(`s.activo = $${p++}`);
      params.push(activo === '1');
    }

    if (categoria) {
      where.push(`s.categoria = $${p++}`);
      params.push(categoria);
    }

    if (actividad) {
      where.push(`s.actividad = $${p++}`);
      params.push(actividad);
    }

    if (anio) {
      where.push(`EXTRACT(YEAR FROM s.fecha_nacimiento) = $${p++}`);
      params.push(Number(anio));
    }

    if (search) {
      where.push(`(
        s.nombre ILIKE $${p} OR
        s.apellido ILIKE $${p} OR
        s.dni ILIKE $${p}
      )`);
      params.push(`%${search}%`);
      p++;
    }

    const q = `
      SELECT
        s.id,
        s.club_id,
        s.numero_socio,
        s.dni,
        s.nombre,
        s.apellido,
        s.es_menor,
        s.tutor_nombre,
        s.categoria,
        s.actividad,
        s.telefono,
        s.direccion,
        s.email,
        s.fecha_nacimiento,
        s.fecha_ingreso,
        s.activo,
        s.becado,
        s.tiene_actividades_adicionales,
        s.actividades_adicionales,
        s.excepcion_cuota_id,
        ec.nombre AS excepcion_cuota_nombre,
        ec.monto AS excepcion_cuota_monto,
        c.payment_due_day,
        s.foto_url,
        s.created_at,
        s.updated_at,

COALESCE(gf_jefe.id, gf_miembro.id) AS grupo_familiar_id,
CASE WHEN gf_jefe.id IS NOT NULL THEN true ELSE false END AS es_jefe_plan_familiar,
CASE WHEN gf_miembro.id IS NOT NULL THEN true ELSE false END AS es_miembro_plan_familiar,
gf_miembro.jefe_socio_id AS grupo_familiar_jefe_id,
CASE
  WHEN gf_jefe.id IS NOT NULL THEN 'jefe'
  WHEN gf_miembro.id IS NOT NULL THEN 'miembro'
  ELSE 'ninguno'
END AS tipo_grupo_familiar,

DATE_PART('year', AGE(s.fecha_nacimiento))::int AS edad,
        EXTRACT(YEAR FROM s.fecha_nacimiento)::int AS anio_nacimiento,
-- ✅ Detecta si TODOS los pagos son completos
(
  SELECT BOOL_AND(pm.pago_completo)
  FROM pagos_mensuales pm
  WHERE pm.socio_id = s.id
    AND pm.club_id = s.club_id
) AS pago_completo,

-- ✅ Detecta si HAY pagos parciales
(
  SELECT COUNT(*) > 0
  FROM pagos_mensuales pm
  WHERE pm.socio_id = s.id
    AND pm.club_id = s.club_id
    AND pm.pago_completo = false
) AS tiene_pagos_parciales,

act_dep.modalidad_pago AS actividad_modalidad_pago,

CASE
  WHEN s.becado = true THEN true
  WHEN COALESCE(act_dep.modalidad_pago, 'mensual') = 'por_clases' THEN true
  ELSE
    COALESCE((
      SELECT MAX((pm.anio::int * 100) + (pm.mes::int))
      FROM pagos_mensuales pm
      WHERE pm.club_id = s.club_id
        AND pm.socio_id = s.id
    ), 0) >=
    CASE
      -- ✅ Si estamos ANTES o IGUAL al día límite → exigimos mes anterior
      WHEN EXTRACT(DAY FROM CURRENT_DATE)::int <= COALESCE(c.payment_due_day, 31)
      THEN
        CASE
          WHEN EXTRACT(MONTH FROM CURRENT_DATE)::int = 1
          THEN ((EXTRACT(YEAR FROM CURRENT_DATE)::int - 1) * 100) + 12
          ELSE (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100) + (EXTRACT(MONTH FROM CURRENT_DATE)::int - 1)
        END

      -- ✅ Si estamos DESPUÉS del día límite → exigimos mes actual
      ELSE
        (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100) + EXTRACT(MONTH FROM CURRENT_DATE)::int
    END
END AS pago_al_dia

      FROM socios s
      LEFT JOIN excepciones_cuota ec
        ON ec.id = s.excepcion_cuota_id
       AND ec.club_id = s.club_id
      LEFT JOIN clubs c
        ON c.id = s.club_id
      LEFT JOIN actividades act_dep
        ON act_dep.club_id = s.club_id
       AND act_dep.nombre = s.actividad
       AND act_dep.activo = true
LEFT JOIN grupos_familiares gf_jefe
  ON gf_jefe.club_id = s.club_id
 AND gf_jefe.jefe_socio_id = s.id
 AND gf_jefe.activo = true

LEFT JOIN grupos_familiares_miembros gfm
  ON gfm.socio_id = s.id

LEFT JOIN grupos_familiares gf_miembro
  ON gf_miembro.id = gfm.grupo_familiar_id
 AND gf_miembro.activo = true
      WHERE ${where.join(' AND ')}
      ORDER BY s.numero_socio ASC
      LIMIT $${p++} OFFSET $${p++}
    `;

    params.push(Number(limit), Number(offset));

    const qCount = `
      SELECT COUNT(*)::int AS total
      FROM socios s
      WHERE ${where.join(' AND ')}
    `;

    const rCount = await db.query(qCount, params.slice(0, params.length - 2));
    const total = rCount.rows[0]?.total ?? 0;

    const r = await db.query(q, params);


const socios = r.rows || [];

// 1. calcular mes exigible (MISMA lógica que SQL)
const now = new Date();
const diaHoy = now.getDate();
const mesActual = now.getMonth() + 1;
const anioActual = now.getFullYear();
const paymentDueDay = Number(socios[0]?.payment_due_day ?? 31);

let mesExigible = mesActual;
let anioExigible = anioActual;

if (diaHoy <= paymentDueDay) {
  if (mesActual === 1) {
    mesExigible = 12;
    anioExigible = anioActual - 1;
  } else {
    mesExigible = mesActual - 1;
  }
}

// 2. traer pagos del mes exigible
const rPagos = await db.query(`
  SELECT
    socio_id,
    mes,
    anio,
    detalle_pago,
    pago_completo
  FROM pagos_mensuales
  WHERE club_id = $1
    AND (
      anio = $2
      OR anio = $3
    )
`, [
  clubId,
  anioExigible,
  anioActual
]);

const pagosMap = new Map();

for (const p of rPagos.rows) {
  const key = String(p.socio_id);
  if (!pagosMap.has(key)) pagosMap.set(key, []);
  pagosMap.get(key).push(p);
}

function parseDetalle(d) {
  try {
    return Array.isArray(d) ? d : JSON.parse(d || '[]');
  } catch {
    return [];
  }
}

// 3. recalcular estado
const sociosFinal = socios.map(s => {

const pagosPropios = pagosMap.get(String(s.id)) || [];

const pagosPeriodo = pagosPropios.filter(p => {

  if (
    Number(p.mes) === mesActual &&
    Number(p.anio) === anioActual
  ) {
    return true;
  }

  if (
    diaHoy <= paymentDueDay &&
    Number(p.mes) === mesExigible &&
    Number(p.anio) === anioExigible
  ) {
    return true;
  }

  return false;

});

const detallePropio =
  pagosPeriodo.flatMap(
    p => parseDetalle(p.detalle_pago)
  );


const jefeId = s.grupo_familiar_jefe_id;
const esMiembro = s.es_miembro_plan_familiar === true;

const pagosBase = esMiembro && jefeId
  ? (pagosMap.get(String(jefeId)) || [])
  : pagosPropios;

const pagoMesActualBase = pagosBase.some(
  p =>
    Number(p.mes) === mesActual &&
    Number(p.anio) === anioActual
);

const pagoMesExigibleBase = pagosBase.some(
  p =>
    Number(p.mes) === mesExigible &&
    Number(p.anio) === anioExigible
);

let baseCubierta = false;

if (s.becado) {
  baseCubierta = true;
}
else if (s.actividad_modalidad_pago === 'por_clases') {
  // ✅ Actividad deportiva "por paquete de clases": no genera cuota social
  // mensual, se paga aparte con el paquete de clases (ficha del socio).
  baseCubierta = true;
}
else if (pagoMesActualBase) {
  baseCubierta = true;
}
else if (
  diaHoy <= paymentDueDay &&
  pagoMesExigibleBase
) {
  baseCubierta = true;
}

  let adicionalesConfig = [];
  try {
    adicionalesConfig = JSON.parse(s.actividades_adicionales || '[]');
  } catch {}

  const adicionalesPagados = new Set(
    detallePropio
      .filter(d => d.tipo === 'adicional' && d.seleccionado === true)
      .map(d => String(d.nombre).trim())
  );

  const faltanAdicionales = adicionalesConfig.some(x => !adicionalesPagados.has(String(x).trim()));

  let pagoAlDia = false;
  let esParcial = false;

// detectar pagos

const pagoMesActual = pagosPropios.some(
  (p) => Number(p.mes) === mesActual && Number(p.anio) === anioActual
);

const tieneAlgunPagoAdicional =
  adicionalesPagados.size > 0;

if (baseCubierta && !faltanAdicionales) {

  pagoAlDia = true;
  esParcial = false;

}
else if (
  (baseCubierta && faltanAdicionales) ||
  (!baseCubierta && tieneAlgunPagoAdicional)
) {

  pagoAlDia = false;
  esParcial = true;

}
else {

  pagoAlDia = false;
  esParcial = false;

}

  return {
    ...s,
    pago_al_dia: pagoAlDia,
    tiene_pagos_parciales: esParcial,
    pago_completo: pagoAlDia && !esParcial
  };
});

    res.json({
      ok: true,
      socios: sociosFinal,
      total,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (e) {
    console.error('❌ list socios', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// ESTADO ADJUNTOS / COMENTARIO – RESUMEN PARA TABLA
// GET /club/:clubId/socios/estados
// ===============================
router.get('/:clubId/socios/estados', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const q = `
  SELECT
    s.id AS socio_id,

    -- Tiene adjuntos?
    (COUNT(a.id) > 0) AS tiene_adjuntos,

    -- Tiene comentario en adjuntos O en comentarios independientes?
    (
      SUM(
        CASE
          WHEN a.comentario IS NOT NULL AND btrim(a.comentario) <> '' THEN 1
          ELSE 0
        END
      )
      +
      SUM(
        CASE
          WHEN c.comentario IS NOT NULL AND btrim(c.comentario) <> '' THEN 1
          ELSE 0
        END
      )
    ) > 0 AS tiene_comentario

  FROM socios s
  LEFT JOIN socios_adjuntos a
    ON a.socio_id = s.id
   AND a.club_id = s.club_id
  LEFT JOIN socios_comentarios c
    ON c.socio_id = s.id
   AND c.club_id = s.club_id

  WHERE s.club_id = $1
  GROUP BY s.id
  ORDER BY s.numero_socio;
`;

    const r = await db.query(q, [clubId]);
    res.json({ ok: true, estados: r.rows });
  } catch (e) {
    console.error('❌ estados socios (adjuntos/comentario)', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// DESCARGAR PLANTILLA EXCEL (CARGA MASIVA)
// GET /club/:clubId/socios/template.xlsx
// ===============================
router.get('/:clubId/socios/template.xlsx', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;

    // traer opciones para dropdowns
    const [rActs, rCats] = await Promise.all([
      db.query(
        `SELECT nombre FROM actividades WHERE club_id = $1 AND activo = true ORDER BY nombre ASC`,
        [clubId]
      ),
      db.query(
        `SELECT nombre FROM categorias_deportivas WHERE club_id = $1 AND activo = true ORDER BY nombre ASC`,
        [clubId]
      )
    ]);

    const actividades = (rActs.rows || []).map(x => x.nombre).filter(Boolean);
    const categorias = (rCats.rows || []).map(x => x.nombre).filter(Boolean);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Todo Sobre mi Club';

    // Hoja principal
    const ws = wb.addWorksheet('Socios');

    // Columnas (todos los campos del modal, menos foto)
    ws.columns = [
      { header: 'numero_socio', key: 'numero_socio', width: 14 },
      { header: 'dni', key: 'dni', width: 14 },
      { header: 'nombre', key: 'nombre', width: 18 },
      { header: 'apellido', key: 'apellido', width: 18 },
      { header: 'actividad', key: 'actividad', width: 22 },
      { header: 'categoria', key: 'categoria', width: 22 },
      { header: 'telefono', key: 'telefono', width: 16 },
      { header: 'direccion', key: 'direccion', width: 26 },
{ header: 'email', key: 'email', width: 26 },
      { header: 'fecha_nacimiento (DD/MM/AAAA)', key: 'fecha_nacimiento', width: 22 },
      { header: 'fecha_ingreso (DD/MM/AAAA)', key: 'fecha_ingreso', width: 22 },
      { header: 'activo (SI/NO)', key: 'activo', width: 14 },
      { header: 'becado (SI/NO)', key: 'becado', width: 14 }
    ];

    // Header style
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: 'A1', to: 'M1' };

    // Hoja oculta para listas
    const lists = wb.addWorksheet('Listas');
    lists.state = 'veryHidden';

    // cargar listas
    lists.getCell('A1').value = 'ACTIVIDADES';
    actividades.forEach((v, i) => (lists.getCell(`A${i + 2}`).value = v));

    lists.getCell('B1').value = 'CATEGORIAS';
    categorias.forEach((v, i) => (lists.getCell(`B${i + 2}`).value = v));

    // Rangos para validación (hasta 500 filas)
    const maxRows = 500;
    const actRange = actividades.length ? `Listas!$A$2:$A$${actividades.length + 1}` : null;
    const catRange = categorias.length ? `Listas!$B$2:$B$${categorias.length + 1}` : null;

    // Validaciones: actividad (col E) y categoria (col F)
    for (let r = 2; r <= maxRows + 1; r++) {
      if (actRange) {
        ws.getCell(`E${r}`).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [actRange],
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: 'Seleccioná una actividad del menú.'
        };
      }
      if (catRange) {
        ws.getCell(`F${r}`).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [catRange],
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: 'Seleccioná una categoría del menú.'
        };
      }

      // activo (SI/NO) = columna L
ws.getCell(`L${r}`).dataValidation = {
  type: 'list',
  allowBlank: true,
  formulae: ['"SI,NO"']
};

// becado (SI/NO) = columna M
ws.getCell(`M${r}`).dataValidation = {
  type: 'list',
  allowBlank: true,
  formulae: ['"SI,NO"']
};
    }

    // Nota en fila 2 (opcional, no rompe import)
    ws.getCell('N1').value = 'NOTA';
    ws.getCell('N2').value =
      'Dejá numero_socio vacío para autogenerar. Fechas en formato DD/MM/AAAA.';

    // Descargar
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="socios_${clubId}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('❌ template socios excel', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// IMPORTAR EXCEL (CARGA MASIVA)
// ===============================
router.post(
  '/:clubId/socios/import.xlsx',
  requireAuth,
  requireClubAccess,
  upload.single('file'),
  async (req, res) => {
    const { clubId } = req.params;
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: 'Falta archivo Excel (file)' });
      }

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);

      // Preferimos hoja "Socios", si no existe tomamos la primera
      const ws = wb.getWorksheet('Socios') || wb.worksheets[0];
      if (!ws) return res.status(400).json({ ok: false, error: 'Excel inválido: no hay hoja' });

      // 1) Traer DNIs y numeros existentes del club
      const rExist = await db.query(
        `SELECT numero_socio, dni FROM socios WHERE club_id = $1`,
        [clubId]
      );
      const dniExist = new Set(
        (rExist.rows || []).map(x => String(x.dni ?? '').trim()).filter(Boolean)
      );
      const numExist = new Set(
        (rExist.rows || []).map(x => String(x.numero_socio ?? '').trim()).filter(Boolean)
      );

      // 2) Leer filas (desde fila 2)
      const rows = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        rows.push({ rowNumber, row });
      });

      // 3) Obtener next_socio_num para autogenerar
      await db.query(
        `INSERT INTO club_counters (club_id, next_socio_num) VALUES ($1, 1)
         ON CONFLICT (club_id) DO NOTHING`,
        [clubId]
      );
      const rCounter = await db.query(
        `SELECT next_socio_num FROM club_counters WHERE club_id = $1 LIMIT 1`,
        [clubId]
      );
      let nextNum = Number(rCounter.rows?.[0]?.next_socio_num ?? 1);

      const errors = [];
      const toInsert = [];

      // helpers
      const norm = v => String(v ?? '').trim();
      const onlyDigits = v => String(v ?? '').replace(/\D+/g, '');
      const parseBoolSI = (v, defVal) => {
        const s = norm(v).toUpperCase();
        if (!s) return defVal;
        if (s === 'SI' || s === 'S' || s === 'TRUE' || s === '1') return true;
        if (s === 'NO' || s === 'N' || s === 'FALSE' || s === '0') return false;
        return defVal;
      };

      function pad2(n) {
        return String(n).padStart(2, '0');
      }

      function dateToISO(d) {
        const yyyy = d.getFullYear();
        const mm = pad2(d.getMonth() + 1);
        const dd = pad2(d.getDate());
        return `${yyyy}-${mm}-${dd}`;
      }

      function excelSerialToISO(serial) {
        const n = Number(serial);
        if (!Number.isFinite(n)) return null;
        const ms = Math.round((n - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return null;
        return dateToISO(d);
      }

      function parseExcelDateToISO(value) {
        if (value === null || value === undefined || value === '') return null;

        if (typeof value === 'object' && value && value.text) {
          value = value.text;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          return dateToISO(value);
        }

        if (typeof value === 'number') {
          return excelSerialToISO(value);
        }

        const s = String(value).trim();

        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

        let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
          let a = Number(m[1]);
          let b = Number(m[2]);
          const yyyy = Number(m[3]);

          let dd, mm;
          if (b > 12) {
            mm = a;
            dd = b;
          } else if (a > 12) {
            dd = a;
            mm = b;
          } else {
            dd = a;
            mm = b;
          }

          if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
          return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
        }

        m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) {
          const dd = Number(m[1]);
          const mm = Number(m[2]);
          const yyyy = Number(m[3]);
          if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
          return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
        }

        return null;
      }

      // 4) Validar y preparar inserts
      for (const r of rows) {
        const rowNumber = r.rowNumber;
        const row = r.row;

        let numero = norm(row.getCell(1).value);
        const dniRaw = norm(row.getCell(2).value);
        const dni = onlyDigits(dniRaw);
        const nombre = norm(row.getCell(3).value);
        const apellido = norm(row.getCell(4).value);
        const actividad = norm(row.getCell(5).value);
        const categoria = norm(row.getCell(6).value);
        const telefono = norm(row.getCell(7).value);          // G
const direccion = norm(row.getCell(8).value);         // H
const email = norm(row.getCell(9).value);             // I
const fecha_nacimiento_raw = row.getCell(10).value;   // J
const fecha_ingreso_raw = row.getCell(11).value;      // K
const activo = parseBoolSI(row.getCell(12).value, true);   // L
const becado = parseBoolSI(row.getCell(13).value, false);  // M


        if (!dni || dni.length < 7) {
          errors.push({
            row: rowNumber,
            error: 'DNI inválido o vacío',
            dni: dniRaw,
            numero_socio: numero
          });
          continue;
        }
        if (!nombre || !apellido || !actividad || !categoria || !fecha_nacimiento_raw) {
          errors.push({
            row: rowNumber,
            error:
              'Faltan campos obligatorios (nombre/apellido/actividad/categoria/fecha_nacimiento)',
            dni,
            numero_socio: numero
          });
          continue;
        }

        const fnISO = parseExcelDateToISO(fecha_nacimiento_raw);
        if (!fnISO) {
          errors.push({
            row: rowNumber,
            error: 'fecha_nacimiento inválida (usar DD/MM/AAAA)',
            dni,
            numero_socio: numero
          });
          continue;
        }

        let fiISO = null;
        if (fecha_ingreso_raw) {
          fiISO = parseExcelDateToISO(fecha_ingreso_raw);
          if (!fiISO) {
            errors.push({
              row: rowNumber,
              error: 'fecha_ingreso inválida (usar DD/MM/AAAA)',
              dni,
              numero_socio: numero
            });
            continue;
          }
        }

        if (dniExist.has(dni)) {
          errors.push({
            row: rowNumber,
            error: 'DNI ya existe en el club',
            dni,
            numero_socio: numero
          });
          continue;
        }

        if (!numero) {
          while (numExist.has(String(nextNum))) nextNum++;
          numero = String(nextNum);
          nextNum++;
        }

        if (numExist.has(String(numero))) {
          errors.push({
            row: rowNumber,
            error: 'Número de socio ya existe en el club',
            dni,
            numero_socio: numero
          });
          continue;
        }

        dniExist.add(dni);
        numExist.add(String(numero));

        toInsert.push({
  numero_socio: Number(numero),
  dni,
  nombre,
  apellido,
  actividad,
  categoria,
  telefono: telefono ?? null,
  direccion: direccion ?? null,
  email: email ?? null,
  fecha_nacimiento: fnISO,
  fecha_ingreso: fiISO,
  activo,
  becado
});
      }

      // 5) Insertar uno por uno
let insertedCount = 0;

for (const s of toInsert) {
  try {
    const rIns = await db.query(
      `INSERT INTO socios (
        club_id, numero_socio, dni, nombre, apellido,
        telefono, direccion, email,
        fecha_nacimiento, fecha_ingreso,
        activo, becado, categoria, actividad
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,
        $11,$12,$13,$14
      ) RETURNING id`,
      [
        clubId,
        s.numero_socio,
        s.dni,
        s.nombre,
        s.apellido,
        s.telefono,
        s.direccion,
        s.email,
        s.fecha_nacimiento,
        s.fecha_ingreso,
        s.activo,
        s.becado,
        s.categoria,
        s.actividad
      ]
    );

    if (rIns.rowCount) insertedCount++;
  } catch (e) {
    errors.push({
      row: null,
      error: e.code === '23505' ? 'Duplicado (DB)' : e.message,
      dni: s.dni,
      numero_socio: s.numero_socio
    });
  }
}

      await db.query(
        `UPDATE club_counters SET next_socio_num = $2 WHERE club_id = $1`,
        [clubId, nextNum]
      );

      return res.json({
        ok: true,
        insertedCount,
        errorCount: errors.length,
        errors
      });
    } catch (e) {
      console.error('❌ import socios excel', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// CREAR SOCIO
// ===============================
router.post('/:clubId/socios', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
const {
  numero_socio,
  dni,
  nombre,
  apellido,
  telefono,
  direccion,
  email,
  fecha_nacimiento,
  fecha_ingreso,
  activo = true,
  becado = false,
  categoria,
  actividad,
  excepcion_cuota_id = null,
  es_menor = false,
  tutor_nombre = null,
  tiene_actividades_adicionales = false,
  actividades_adicionales = null
} = req.body ?? {};

  try {
    // ✅ NUEVO: el DNI se guarda siempre solo con dígitos (sin puntos, guiones,
    // espacios, etc.), sea que venga limpio del formulario web/app o con
    // puntos por las dudas (copiar/pegar, versiones viejas de la app, etc.).
    const dniLimpio = onlyDigitsDni(dni);

    if (!dniLimpio || !nombre || !apellido || !fecha_nacimiento || !categoria || !actividad) {
      return res.status(400).json({
        ok: false,
        error: 'Completá DNI, Nombre, Apellido, Categoría, Actividad y Fecha de nacimiento.'
      });
    }

if (es_menor && !String(tutor_nombre || '').trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Si el socio es menor, completá el nombre del padre/madre/tutor.'
      });
    }

// ✅ Validar excepción (si viene)
await assertValidExcepcionCuota({ clubId, excepcionCuotaId: excepcion_cuota_id });


    await db.query('BEGIN');

    await db.query(
      `
      INSERT INTO club_counters (club_id, next_socio_num)
      VALUES ($1, 1)
      ON CONFLICT (club_id) DO NOTHING
      `,
      [clubId]
    );

    let nro = numero_socio;
    if (!nro) {
      const rNum = await db.query(
        `
        UPDATE club_counters
        SET next_socio_num = next_socio_num + 1
        WHERE club_id = $1
        RETURNING (next_socio_num - 1) AS numero
        `,
        [clubId]
      );
      nro = rNum.rows[0].numero;
    }

const r = await db.query(
  `
  INSERT INTO socios (
    club_id,
    numero_socio,
    dni,
    nombre,
    apellido,
    telefono,
    direccion,
    email,
    fecha_nacimiento,
    fecha_ingreso,
    activo,
    becado,
    categoria,
    actividad,
    excepcion_cuota_id,
    es_menor,
    tutor_nombre,
    tiene_actividades_adicionales,
    actividades_adicionales
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
  )
  RETURNING *
  `,
  [
    clubId,
    nro,
    dniLimpio,
    String(nombre),
    String(apellido),
    telefono ?? null,
    direccion ?? null,
    email ?? null,
    fecha_nacimiento,
    fecha_ingreso ?? null,
    !!activo,
    !!becado,
    String(categoria),
    String(actividad),
    (excepcion_cuota_id ?? null),
    !!es_menor,
    (tutor_nombre ?? null),
    !!tiene_actividades_adicionales,
    (actividades_adicionales ?? null)
  ]
);

    await db.query('COMMIT');
    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('❌ create socio', e);
    if (e.code === '23505') {
      return res
        .status(409)
        .json({ ok: false, error: 'DNI o Nº de socio ya existe en este club' });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// EDITAR SOCIO
// ===============================
router.put('/:clubId/socios/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
const {
  numero_socio,
  dni,
  nombre,
  apellido,
  telefono,
  direccion,
  email,
  fecha_nacimiento,
  fecha_ingreso,
  activo,
  becado,
  categoria,
  actividad,
  excepcion_cuota_id = null,
  es_menor,
  tutor_nombre,
  tiene_actividades_adicionales = false,
  actividades_adicionales = null
} = req.body ?? {};

  try {
if (es_menor && !String(tutor_nombre || '').trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Si el socio es menor, completá el nombre del padre/madre/tutor.'
      });
    }

// ✅ NUEVO: mismo criterio que al crear, el DNI se guarda solo con dígitos.
const dniLimpio = onlyDigitsDni(dni);

await assertValidExcepcionCuota({ clubId, excepcionCuotaId: excepcion_cuota_id });

const r = await db.query(
  `
  UPDATE socios SET
    numero_socio = $1,
    dni = $2,
    nombre = $3,
    apellido = $4,
    telefono = $5,
    direccion = $6,
    email = $7,
    fecha_nacimiento = $8,
    fecha_ingreso = $9,
    activo = $10,
    becado = $11,
    categoria = $12,
    actividad = $13,
    excepcion_cuota_id = $14,
    es_menor = $15,
    tutor_nombre = $16,
    tiene_actividades_adicionales = $17,
    actividades_adicionales = $18,
    bienvenida_enviada_at = CASE
      WHEN email IS DISTINCT FROM $21 THEN NULL
      WHEN dni IS DISTINCT FROM $22 THEN NULL
      WHEN numero_socio IS DISTINCT FROM $23 THEN NULL
      ELSE bienvenida_enviada_at
    END
  WHERE id = $19 AND club_id = $20
  RETURNING *
  `,
  [
    numero_socio,
    dniLimpio,
    nombre,
    apellido,
    telefono ?? null,
    direccion ?? null,
    email ?? null,
    fecha_nacimiento,
    fecha_ingreso ?? null,
    !!activo,
    !!becado,
    categoria,
    actividad,
    (excepcion_cuota_id ?? null),
    !!es_menor,
    (tutor_nombre ?? null),
    !!tiene_actividades_adicionales,
    (actividades_adicionales ?? null),
    id,
    clubId,
    email ?? null,   // ✅ mismo valor que $7, en parámetro aparte para el CASE
    dniLimpio,       // ✅ NUEVO: mismo valor que $2, en parámetro aparte para el CASE
    numero_socio,    // ✅ NUEVO: mismo valor que $1, en parámetro aparte para el CASE
  ]
);


    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }



    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    console.error('❌ update socio', e);
    if (e.code === '23505') {
      return res
        .status(409)
        .json({ ok: false, error: 'DNI o Nº de socio ya existe en este club' });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// ELIMINAR SOCIO (borrado total, incluyendo todo su historial relacionado)
// ===============================
router.delete('/:clubId/socios/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1) Confirmar que el socio existe en este club
    const rCheck = await client.query(
      `SELECT id FROM socios WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!rCheck.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }

    // 2) Buscar todas las tablas que tengan una FK hacia socios.id
    const rFks = await client.query(`
      SELECT
        tc.table_name AS tabla,
        kcu.column_name AS columna
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = 'socios'
        AND ccu.column_name = 'id'
        AND tc.table_name <> 'socios'
    `);

    // 3) Borrar el historial relacionado en cada una de esas tablas
    for (const { tabla, columna } of rFks.rows) {
      await client.query(`DELETE FROM "${tabla}" WHERE "${columna}" = $1`, [id]);
    }

    // 4) Borrar el socio (esto libera el número de socio y el DNI)
    await client.query(`DELETE FROM socios WHERE id = $1 AND club_id = $2`, [id, clubId]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ delete socio', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ===============================
// SUBIR / REEMPLAZAR FOTO (borra la anterior)
// ===============================
router.post('/:clubId/socios/:id/foto', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { base64, mimetype, filename } = req.body ?? {};

  try {
    if (!base64 || !mimetype) {
      return res.status(400).json({ ok: false, error: 'Falta base64 o mimetype' });
    }

    const prev = await db.query(
      `SELECT foto_url FROM socios WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );
    if (!prev.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }

    const oldUrl = prev.rows[0].foto_url;

    const buffer = Buffer.from(base64, 'base64');
    const up = await uploadImageBuffer({
      buffer,
      mimetype,
      originalname: filename || 'socio.jpg',
      folder: `clubs/${clubId}/socios`
    });

    const r = await db.query(
      `UPDATE socios SET foto_url=$1 WHERE id=$2 AND club_id=$3 RETURNING id, foto_url`,
      [up.url, id, clubId]
    );

    if (oldUrl && oldUrl !== up.url) {
      try {
        await deleteFirebaseObjectByUrl(oldUrl);
      } catch (err) {
        console.warn('⚠️ No se pudo borrar la foto anterior:', err.message);
      }
    }

    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    console.error('❌ upload/replace foto socio', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// ADJUNTOS DE SOCIO – LISTAR
// ===============================
router.get(
  '/:clubId/socios/:id/adjuntos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId } = req.params;

    try {
      const r = await db.query(
        `
        SELECT
          id,
          filename,
          mimetype,
          size_bytes,
          comentario,
          url,
          created_at
        FROM socios_adjuntos
        WHERE club_id = $1 AND socio_id = $2
        ORDER BY created_at DESC
        `,
        [clubId, socioId]
      );

      res.json({ ok: true, adjuntos: r.rows });
    } catch (e) {
      console.error('❌ list socios_adjuntos', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// ADJUNTOS DE SOCIO – SUBIR
// ===============================
router.post(
  '/:clubId/socios/:id/adjuntos',
  requireAuth,
  requireClubAccess,
  uploadAdjunto.single('file'),
  async (req, res) => {
    const { clubId, id: socioId } = req.params;
    const comentario = (req.body?.comentario || '').toString().trim();

    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'Falta archivo (file)' });
      }

      const { buffer, mimetype, originalname, size } = req.file;

      const up = await uploadImageBuffer({
        buffer,
        mimetype,
        originalname,
        folder: `clubs/${clubId}/socios-adjuntos`
      });

      const r = await db.query(
        `
        INSERT INTO socios_adjuntos (
          club_id,
          socio_id,
          url,
          filename,
          mimetype,
          size_bytes,
          comentario
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
        RETURNING
          id,
          club_id,
          socio_id,
          url,
          filename,
          mimetype,
          size_bytes,
          comentario,
          created_at
        `,
        [clubId, socioId, up.url, originalname, mimetype, size, comentario || null]
      );

      res.status(201).json({ ok: true, adjunto: r.rows[0] });
    } catch (e) {
      console.error('❌ upload socio adjunto', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// ADJUNTOS DE SOCIO – ELIMINAR
// ===============================
router.delete(
  '/:clubId/socios/:id/adjuntos/:adjuntoId',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId, adjuntoId } = req.params;

    try {
      const prev = await db.query(
        `SELECT url FROM socios_adjuntos WHERE id = $1 AND club_id = $2 AND socio_id = $3`,
        [adjuntoId, clubId, socioId]
      );

      if (!prev.rowCount) {
        return res.status(404).json({ ok: false, error: 'Adjunto no encontrado' });
      }

      const url = prev.rows[0].url;

      await db.query(
        `DELETE FROM socios_adjuntos WHERE id = $1 AND club_id = $2 AND socio_id = $3`,
        [adjuntoId, clubId, socioId]
      );

      try {
        await deleteFirebaseObjectByUrl(url);
      } catch (err) {
        console.warn('⚠️ No se pudo borrar archivo adjunto de Firebase:', err.message);
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('❌ delete socio adjunto', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// COMENTARIOS DE SOCIO – LISTAR
// GET /club/:clubId/socios/:id/comentarios
// ===============================
router.get(
  '/:clubId/socios/:id/comentarios',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId } = req.params;
    try {
      const q = `
        SELECT
          id,
          comentario,
          created_at
        FROM socios_comentarios
        WHERE club_id = $1 AND socio_id = $2
        ORDER BY created_at DESC
      `;
      const r = await db.query(q, [clubId, socioId]);
      return res.json({ ok: true, comentarios: r.rows });
    } catch (e) {
      console.error('❌ Error listando comentarios', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// COMENTARIOS DE SOCIO – CREAR
// POST /club/:clubId/socios/:id/comentarios
// ===============================
router.post(
  '/:clubId/socios/:id/comentarios',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId } = req.params;
    const comentario = (req.body?.comentario || '').trim();

    if (!comentario) {
      return res.status(400).json({
        ok: false,
        error: 'El comentario no puede estar vacío.'
      });
    }

    try {
      const q = `
        INSERT INTO socios_comentarios (club_id, socio_id, comentario)
        VALUES ($1, $2, $3)
        RETURNING id, comentario, created_at
      `;
      const r = await db.query(q, [clubId, socioId, comentario]);

      return res.json({ ok: true, comentario: r.rows[0] });
    } catch (e) {
      console.error('❌ Error guardando comentario', e);
      return res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  }
);

// ===============================
// COMENTARIOS DE SOCIO – ELIMINAR
// DELETE /club/:clubId/socios/:id/comentarios/:comentarioId
// ===============================
router.delete(
  '/:clubId/socios/:id/comentarios/:comentarioId',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId, comentarioId } = req.params;
    try {
      const r = await db.query(
        `DELETE FROM socios_comentarios WHERE id = $1 AND club_id = $2 AND socio_id = $3`,
        [comentarioId, clubId, socioId]
      );
      if (!r.rowCount) {
        return res.status(404).json({ ok: false, error: 'Comentario no encontrado' });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error('❌ delete socio comentario', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// EXPORT EXCEL (.xlsx)
// ===============================
router.get('/:clubId/socios/export.xlsx', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;

 function fmtDateDDMMYYYY(value) {
  if (!value) return '';

  const date = new Date(value);
  if (isNaN(date.getTime())) return '';

  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();

  return `${d}/${m}/${y}`;
}


  try {
    const r = await db.query(
      `
      SELECT
        numero_socio,
        dni,
        nombre,
        apellido,
        categoria,
        actividad,
        telefono,
        direccion,
        email,
        fecha_nacimiento,
        fecha_ingreso,
        activo,
        becado,
        foto_url
      FROM socios
      WHERE club_id = $1
      ORDER BY numero_socio ASC
      `,
      [clubId]
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Todo Sobre mi Club';

    const ws = wb.addWorksheet('Socios');

    ws.columns = [
  { header: 'N° socio', key: 'numero_socio', width: 12 },
  { header: 'DNI', key: 'dni', width: 14 },
  { header: 'Nombre', key: 'nombre', width: 18 },
  { header: 'Apellido', key: 'apellido', width: 18 },
  { header: 'Categoría', key: 'categoria', width: 18 },
  { header: 'Actividad', key: 'actividad', width: 22 },
  { header: 'Teléfono', key: 'telefono', width: 16 },
  { header: 'Dirección', key: 'direccion', width: 28 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Fecha nacimiento', key: 'fecha_nacimiento', width: 16 },
  { header: 'Fecha ingreso', key: 'fecha_ingreso', width: 16 },
  { header: 'Activo', key: 'activo', width: 10 },
  { header: 'Becado', key: 'becado', width: 10 }
];


    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: 'A1', to: 'M1' };

    for (const row of r.rows) {
      ws.addRow({
        numero_socio: row.numero_socio ?? '',
        dni: row.dni ?? '',
        nombre: row.nombre ?? '',
        apellido: row.apellido ?? '',
        categoria: row.categoria ?? '',
        actividad: row.actividad ?? '',
        telefono: row.telefono ?? '',
        direccion: row.direccion ?? '',
        email: row.email ?? '',
        fecha_nacimiento: fmtDateDDMMYYYY(row.fecha_nacimiento),
        fecha_ingreso: fmtDateDDMMYYYY(row.fecha_ingreso),
        activo: row.activo ? 'Sí' : 'No',
        becado: row.becado ? 'Sí' : 'No'
        
      });
    }

res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="socios_${clubId}.xlsx"`
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('❌ export socios xlsx', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// BIENVENIDA POR EMAIL – LISTAR PENDIENTES
// GET /club/:clubId/socios/bienvenida/pendientes
// Devuelve los socios ACTIVOS que todavía no recibieron el mail de bienvenida.
// ===============================
router.get(
  '/:clubId/socios/bienvenida/pendientes',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    try {
      const r = await db.query(
        `
        SELECT
          id,
          numero_socio,
          dni,
          nombre,
          apellido,
          email
        FROM socios s
        WHERE club_id = $1
          AND activo = true
          AND bienvenida_enviada_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM bienvenida_envios_programados e
            WHERE e.socio_id = s.id
              AND e.enviado_at IS NULL
              AND e.error IS NULL
          )
        ORDER BY numero_socio ASC
        `,
        [clubId]
      );

      res.json({ ok: true, socios: r.rows });
    } catch (e) {
      console.error('❌ list pendientes bienvenida', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// BIENVENIDA POR EMAIL – ENVIAR A LOS SELECCIONADOS
// POST /club/:clubId/socios/bienvenida/enviar
// body: { socioIds: [id1, id2, ...] }
//
// Por cada socio:
//  - Se vuelve a verificar en la DB que sigue pendiente (evita reenviar
//    por doble click o si dos personas lo mandan al mismo tiempo).
//  - Si no tiene email cargado, se reporta como error y NO se marca enviado.
//  - Si el envío de mail falla, se reporta como error y NO se marca enviado
//    (así puede reintentarse después, sigue apareciendo en "pendientes").
//  - Si se envía OK, se marca bienvenida_enviada_at = NOW() y desaparece
//    de "pendientes" en los próximos envíos.
// ===============================
router.post(
  '/:clubId/socios/bienvenida/enviar',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const { socioIds } = req.body ?? {};

    try {
      if (!Array.isArray(socioIds) || socioIds.length === 0) {
        return res.status(400).json({ ok: false, error: 'Seleccioná al menos un socio.' });
      }

      // Re-chequear cuáles siguen pendientes y no tienen ya un envío programado sin enviar
      // (protege contra doble click y contra volver a programar a alguien que ya está en cola)
      const rPendientes = await db.query(
        `
        SELECT s.id
        FROM socios s
        WHERE s.club_id = $1
          AND s.id = ANY($2::uuid[])
          AND s.bienvenida_enviada_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM bienvenida_envios_programados e
            WHERE e.socio_id = s.id
              AND e.enviado_at IS NULL
              AND e.error IS NULL
          )
        `,
        [clubId, socioIds]
      );

      const idsAProgramar = rPendientes.rows.map(r => r.id);

      if (!idsAProgramar.length) {
        return res.json({
          ok: true,
          programados: 0,
          lotes: 0,
          mensaje: 'No hay socios nuevos para programar (ya estaban enviados o en cola).'
        });
      }

      // Partir en lotes de BIENVENIDA_LOTE_SIZE; cada lote se manda
      // BIENVENIDA_LOTE_INTERVALO_MIN minutos después del anterior
      // (el lote 0 sale en la próxima corrida del worker, ver procesarBienvenidasPendientes)
      const ahora = new Date();
      const filasValues = [];
      const params = [];
      let idx = 1;

      idsAProgramar.forEach((socioId, i) => {
        const lote = Math.floor(i / BIENVENIDA_LOTE_SIZE);
        const programadoPara = new Date(ahora.getTime() + lote * BIENVENIDA_LOTE_INTERVALO_MIN * 60 * 1000);

        filasValues.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(clubId, socioId, lote, programadoPara);
      });

      await db.query(
        `
        INSERT INTO bienvenida_envios_programados (club_id, socio_id, lote, programado_para)
        VALUES ${filasValues.join(', ')}
        `,
        params
      );

      const totalLotes = Math.floor((idsAProgramar.length - 1) / BIENVENIDA_LOTE_SIZE) + 1;

      res.json({
        ok: true,
        programados: idsAProgramar.length,
        lotes: totalLotes,
        loteSize: BIENVENIDA_LOTE_SIZE,
        intervaloMinutos: BIENVENIDA_LOTE_INTERVALO_MIN
      });
    } catch (e) {
      console.error('❌ programar bienvenida', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// BIENVENIDA POR EMAIL – PROCESAR COLA PROGRAMADA
// La llama periódicamente app.js (setInterval), no es un endpoint HTTP.
// Manda los envíos cuya fecha programada ya llegó, en tandas de a 50 por
// corrida (para no trabarse si el servidor estuvo caído un rato y se
// acumularon varias horas de cola).
// ===============================
async function procesarBienvenidasPendientes() {
  try {
    const r = await db.query(
      `
      SELECT e.id AS envio_id, e.club_id, s.id AS socio_id, s.numero_socio,
             s.dni, s.nombre, s.apellido, s.email,
             c.name AS club_name, c.logo_url AS club_logo_url
      FROM bienvenida_envios_programados e
      JOIN socios s ON s.id = e.socio_id
      JOIN clubs c ON c.id = e.club_id
      WHERE e.enviado_at IS NULL
        AND e.error IS NULL
        AND e.programado_para <= NOW()
      ORDER BY e.programado_para ASC
      LIMIT 50
      `
    );

    if (!r.rowCount) return;

    console.log(`✉️ Procesando ${r.rowCount} bienvenida(s) programada(s)...`);
    const transporter = getMailTransporter();

    for (const row of r.rows) {
      const email = String(row.email ?? '').trim();

      if (!email) {
        await db.query(
          `UPDATE bienvenida_envios_programados SET error = $2 WHERE id = $1`,
          [row.envio_id, 'El socio no tiene email cargado.']
        );
        continue;
      }

      const { subject, text, html } = buildBienvenidaEmail({
        clubName: row.club_name,
        clubLogoUrl: row.club_logo_url,
        nombre: row.nombre,
        apellido: row.apellido,
        numeroSocio: row.numero_socio,
        dni: row.dni
      });

      try {
        await transporter.sendMail({
          from: `"${row.club_name}" <${process.env.MAIL_USER}>`,
          to: email,
          subject,
          text,
          html
        });

        await db.query(
          `UPDATE bienvenida_envios_programados SET enviado_at = NOW() WHERE id = $1`,
          [row.envio_id]
        );
        await db.query(
          `UPDATE socios SET bienvenida_enviada_at = NOW() WHERE id = $1 AND club_id = $2`,
          [row.socio_id, row.club_id]
        );
      } catch (err) {
        console.error(`❌ error enviando bienvenida programada ${row.envio_id}:`, err.message);
        await db.query(
          `UPDATE bienvenida_envios_programados SET error = $2 WHERE id = $1`,
          [row.envio_id, 'No se pudo enviar el email.']
        );
      }
    }
  } catch (e) {
    console.error('❌ procesarBienvenidasPendientes', e);
  }
}

module.exports = router;
// ✅ NUEVO: se expone la función además del router, para que app.js pueda
// llamarla periódicamente con setInterval
module.exports.procesarBienvenidasPendientes = procesarBienvenidasPendientes;