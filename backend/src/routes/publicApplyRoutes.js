const express = require('express');
const db = require('../db');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');

const router = express.Router();

function norm(v){ return String(v ?? '').trim(); }
function onlyDigits(v){ return String(v ?? '').replace(/\D+/g,''); }

function parseInputDateToISO(value){
  if (!value) return null;

  // input type="date" → "YYYY-MM-DD"
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // Date real
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2,'0');
    const dd = String(value.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}
async function validateClubToken(clubId, token){
  const r = await db.query(
    `SELECT id, apply_token FROM clubs WHERE id = $1 LIMIT 1`,
    [clubId]
  );
  if (!r.rowCount) return false;
  return String(r.rows[0].apply_token || '') === String(token || '');
}

// GET /public/club/:clubId/apply/options?t=TOKEN
router.get('/club/:clubId/apply/options', async (req, res) => {
  try{
    const { clubId } = req.params;
    const token = req.query.t;

    const ok = await validateClubToken(clubId, token);
    if (!ok) return res.status(403).json({ ok:false, error:'Token inválido' });

    const [rActs, rCats] = await Promise.all([
      db.query(`SELECT nombre FROM actividades WHERE club_id=$1 AND activo=true ORDER BY nombre ASC`, [clubId]),
      db.query(`SELECT nombre FROM categorias_deportivas WHERE club_id=$1 AND activo=true ORDER BY nombre ASC`, [clubId])
    ]);

    res.json({
      ok:true,
      actividades: (rActs.rows||[]).map(x=>x.nombre).filter(Boolean),
      categorias: (rCats.rows||[]).map(x=>x.nombre).filter(Boolean),
    });
  }catch(e){
    console.error('❌ options apply', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// POST /public/club/:clubId/apply?t=TOKEN
// body: { nombre, apellido, dni, actividad, categoria, telefono, direccion, fecha_nacimiento(DD/MM/AAAA), foto_base64?, foto_mimetype? }
router.post('/club/:clubId/apply', async (req, res) => {
  try{
    const { clubId } = req.params;
    const token = req.query.t;

    const ok = await validateClubToken(clubId, token);
    if (!ok) return res.status(403).json({ ok:false, error:'Token inválido' });

    const {
  nombre, apellido, dni, actividad, categoria,
  telefono, direccion, fecha_nacimiento,
  foto_base64, foto_mimetype,
  tipo
} = req.body ?? {};


    const dniNorm = onlyDigits(dni);
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
    return res.status(400).json({ ok:false, error:'Faltan campos obligatorios' });
  }
}


const tipoFinal = String(tipo ?? 'alta').trim().toLowerCase() === 'foto'
  ? 'foto'
  : 'alta';


    const fnISO = parseInputDateToISO(fecha_nacimiento);
if (!fnISO){
  return res.status(400).json({ ok:false, error:'fecha_nacimiento inválida' });
}

    // Validar DNI contra socios existentes
const rSoc = await db.query(
  `SELECT id, nombre, apellido FROM socios WHERE club_id=$1 AND dni=$2 LIMIT 1`,
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
  // alta normal
  if (rSoc.rowCount) {
    return res.status(409).json({ ok:false, error:'Ya existe un socio con ese DNI' });
  }
}


    // Validar DNI contra pendientes (estado pendiente)
    const rPen = await db.query(
  `SELECT 1
   FROM socios_pendientes
   WHERE club_id=$1 AND dni=$2 AND estado='pendiente' AND tipo=$3
   LIMIT 1`,
  [clubId, dniNorm, tipoFinal]
);

    if (rPen.rowCount){
  return res.status(409).json({ ok:false, error:'Ya hay una solicitud pendiente para ese DNI' });
}


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

// 👇 Insertar en pendientes (incluye tipo)
const r = await db.query(
  `
  INSERT INTO socios_pendientes
    (club_id, nombre, apellido, dni, actividad, categoria, telefono, direccion, fecha_nacimiento, foto_url, tipo, estado, created_at, updated_at)
  VALUES
    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pendiente', now(), now())
  RETURNING id
  `,
  [
    clubId,
    // si es foto, usamos nombre/apellido del socio existente (rSoc viene de arriba)
    (tipoFinal === 'foto' ? (rSoc.rows[0].nombre ?? null) : norm(nombre)),
    (tipoFinal === 'foto' ? (rSoc.rows[0].apellido ?? null) : norm(apellido)),
    dniNorm,
    (tipoFinal === 'foto' ? null : norm(actividad)),
    (tipoFinal === 'foto' ? null : norm(categoria)),
    (tipoFinal === 'foto' ? null : (telefono ? norm(telefono) : null)),
    (tipoFinal === 'foto' ? null : (direccion ? norm(direccion) : null)),
    (tipoFinal === 'foto' ? null : fnISO),
    foto_url,
    tipoFinal
  ]
);

return res.json({ ok: true, id: r.rows[0].id });

  }catch(e){
    console.error('❌ apply post', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

module.exports = router;