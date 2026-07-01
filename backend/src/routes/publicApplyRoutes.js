const express = require('express');
const db = require('../db');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');

const router = express.Router();

function norm(v) { return String(v ?? '').trim(); }
function onlyDigits(v) { return String(v ?? '').replace(/\D+/g, ''); }

function parseInputDateToISO(value) {
  if (!value) return null;

  // input type="date" → "YYYY-MM-DD"
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // Date real
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

async function validateClubToken(clubId, token) {
  const r = await db.query(
    `SELECT id, apply_token FROM clubs WHERE id = $1 LIMIT 1`,
    [clubId]
  );
  if (!r.rowCount) return false;
  return String(r.rows[0].apply_token || '') === String(token || '');
}

// GET /public/club/:clubId/apply/options?t=TOKEN
router.get('/club/:clubId/apply/options', async (req, res) => {
  try {
    const { clubId } = req.params;
    const token = req.query.t;

    const ok = await validateClubToken(clubId, token);
    if (!ok) return res.status(403).json({ ok: false, error: 'Token inválido' });

    const [rActs, rCats] = await Promise.all([
      db.query(`SELECT nombre FROM actividades WHERE club_id=$1 AND activo=true ORDER BY nombre ASC`, [clubId]),
      db.query(`SELECT nombre FROM categorias_deportivas WHERE club_id=$1 AND activo=true ORDER BY nombre ASC`, [clubId])
    ]);

const rClub = await db.query(
  `
  SELECT
    id,
    name,
    logo_url,
    color_primary,
    color_secondary,
    color_accent
  FROM clubs
  WHERE id = $1
  LIMIT 1
  `,
  [clubId]
);

const club = rClub.rowCount ? rClub.rows[0] : null;

    return res.json({
  ok: true,
  club: club ? {
    id: club.id,
    name: club.name,
    logo_url: club.logo_url,
    color_primary: club.color_primary,
    color_secondary: club.color_secondary,
    color_accent: club.color_accent
  } : null,
  actividades: (rActs.rows || []).map(x => x.nombre).filter(Boolean),
  categorias: (rCats.rows || []).map(x => x.nombre).filter(Boolean),
});
  } catch (e) {
    console.error('❌ options apply', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /public/club/:clubId/apply?t=TOKEN
// body alta: { nombre, apellido, dni, actividad, categoria, telefono, direccion, fecha_nacimiento, foto_base64?, foto_mimetype?, tipo? }
// body foto: { dni, foto_base64, foto_mimetype, tipo:'foto' }
router.post('/club/:clubId/apply', async (req, res) => {
  try {
    const { clubId } = req.params;
    const token = req.query.t;

    const ok = await validateClubToken(clubId, token);
    if (!ok) return res.status(403).json({ ok: false, error: 'Token inválido' });

    const {
  nombre, apellido, dni, actividad, categoria,
  telefono, email, direccion, fecha_nacimiento,
  foto_base64, foto_mimetype,
  tipo
} = req.body ?? {};

    // ✅ tipoFinal SIEMPRE al principio (evita "Cannot access before initialization")
    const tipoFinal =
      String(tipo ?? 'alta').trim().toLowerCase() === 'foto'
        ? 'foto'
        : 'alta';

    const dniNorm = onlyDigits(dni);

    // =========================
    // Validación por tipo
    // =========================
    if (tipoFinal === 'foto') {
      if (!dniNorm || !foto_base64 || !foto_mimetype) {
        return res.status(400).json({
          ok: false,
          error: 'Para actualizar foto debés indicar DNI y una foto.'
        });
      }
    } else {
      // alta normal
      if (!nombre || !apellido || !dniNorm || !actividad || !categoria || !fecha_nacimiento) {
        return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios' });
      }
    }

if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
  return res.status(400).json({
    ok: false,
    error: 'Mail inválido'
  });
}

    // =========================
    // Fecha nacimiento SOLO para alta
    // =========================
    let fnISO = null;
    if (tipoFinal === 'alta') {
      fnISO = parseInputDateToISO(fecha_nacimiento);
      if (!fnISO) {
        return res.status(400).json({ ok: false, error: 'fecha_nacimiento inválida' });
      }
    }

    // =========================
    // Validar socio existente (se usa para modo foto y para evitar duplicado en alta)
    // =========================
    // Traemos también actividad/categoria/fecha_nacimiento para cumplir NOT NULL en pendientes cuando tipo='foto'
    const rSoc = await db.query(
      `SELECT id, nombre, apellido, actividad, categoria, fecha_nacimiento, telefono, direccion
       FROM socios
       WHERE club_id=$1 AND dni=$2
       LIMIT 1`,
      [clubId, dniNorm]
    );

    if (tipoFinal === 'foto') {
      if (!rSoc.rowCount) {
        return res.status(404).json({
          ok: false,
          error: 'No existe un socio con ese DNI en el club.'
        });
      }
    } else {
      // alta normal: no debe existir
      if (rSoc.rowCount) {
        return res.status(409).json({ ok: false, error: 'Ya existe un socio con ese DNI' });
      }
    }

    // =========================
    // Evitar duplicado de pendientes por DNI + tipo
    // =========================
    const rPen = await db.query(
      `SELECT 1
       FROM socios_pendientes
       WHERE club_id=$1 AND dni=$2 AND estado='pendiente' AND tipo=$3
       LIMIT 1`,
      [clubId, dniNorm, tipoFinal]
    );

    if (rPen.rowCount) {
      return res.status(409).json({ ok: false, error: 'Ya hay una solicitud pendiente para ese DNI' });
    }

    // =========================
    // Subir foto (obligatoria en modo foto, opcional en alta)
    // =========================
    let foto_url = null;
    if (foto_base64 && foto_mimetype) {
      const buffer = Buffer.from(foto_base64, 'base64');
      const up = await uploadImageBuffer({
        buffer,
        mimetype: foto_mimetype,
        originalname: 'postulacion.jpg',
        folder: `clubs/${clubId}/postulaciones`
      });
      foto_url = up.url;
    }

    // =========================
    // Insertar en pendientes (incluye tipo)
    // IMPORTANTÍSIMO: para tipo='foto' NO podemos enviar actividad/categoria null si la tabla es NOT NULL.
    // Entonces tomamos actividad/categoria/fecha_nacimiento del socio existente.
    // =========================
    const socioRow = rSoc.rowCount ? rSoc.rows[0] : null;

    const nombreFinal = (tipoFinal === 'foto') ? (socioRow?.nombre ?? null) : norm(nombre);
    const apellidoFinal = (tipoFinal === 'foto') ? (socioRow?.apellido ?? null) : norm(apellido);

    const actividadFinal = (tipoFinal === 'foto')
      ? (socioRow?.actividad ?? 'Actualización foto')
      : norm(actividad);

    const categoriaFinal = (tipoFinal === 'foto')
      ? (socioRow?.categoria ?? 'Actualización foto')
      : norm(categoria);

    const telefonoFinal = (tipoFinal === 'foto')
      ? (socioRow?.telefono ?? null)
      : (telefono ? norm(telefono) : null);

    const direccionFinal = (tipoFinal === 'foto')
      ? (socioRow?.direccion ?? null)
      : (direccion ? norm(direccion) : null);

    const fechaNacFinal = (tipoFinal === 'foto')
      ? (socioRow?.fecha_nacimiento ?? null)
      : fnISO;

    const r = await db.query(
      `
      INSERT INTO socios_pendientes
  (club_id, nombre, apellido, dni, actividad, categoria, telefono, email, direccion, fecha_nacimiento, foto_url, tipo, estado, created_at, updated_at)
VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendiente', now(), now())
      RETURNING id
      `,
      [
  clubId,
  nombreFinal,
  apellidoFinal,
  dniNorm,
  actividadFinal,
  categoriaFinal,
  telefonoFinal,
  email ? norm(email) : null,
  direccionFinal,
  fechaNacFinal,
  foto_url,
  tipoFinal
]
    );

    return res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error('❌ apply post', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;