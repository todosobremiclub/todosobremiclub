// src/routes/appRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

// ✅ CORS simple para Flutter Web (sin instalar cors)
// (permite llamadas desde http://localhost:xxxx)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Helpers
function onlyDigits(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

function ymToString(ym) {
  const y = Math.floor(ym / 100);
  const m = ym % 100;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * POST /app/login
 * body: { numero, dni }
 * Devuelve: { ok, token, socio, club }
 */
router.post('/login', async (req, res) => {
  try {
    const numeroRaw = req.body?.numero;
    const dniRaw = req.body?.dni;

    const numero = Number(String(numeroRaw ?? '').trim());
    const dni = onlyDigits(dniRaw);

    if (!numero || !dni) {
      return res.status(400).json({ ok: false, error: 'Faltan número o DNI' });
    }

    // 1) Buscar socio (multiclub) por numero + dni
    const rSocio = await db.query(
      `SELECT
         id,
         club_id,
         numero_socio,
         dni,
         nombre,
         apellido,
         actividad,
         categoria,
         fecha_nacimiento,
         fecha_ingreso,
         foto_url,
         activo
       FROM socios
       WHERE numero_socio = $1
         AND dni = $2
       LIMIT 1`,
      [numero, dni]
    );

    if (rSocio.rowCount === 0) {
      return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    }

    const socio = rSocio.rows[0];

    if (!socio.activo) {
      return res.status(403).json({ ok: false, error: 'Socio inactivo' });
    }

    const clubId = socio.club_id;

    // 2) Traer club (para theme dinámico)
const rClub = await db.query(
  `SELECT
         id,
         name,
         logo_url,
         color_primary,
         color_secondary,
         color_accent,
         instagram_url          -- 👈 AGREGADO
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
  [clubId]
);

    if (rClub.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Club no encontrado' });
    }

    const club = rClub.rows[0];

    // 3) Último pago (convertido a índice de meses para comparar correctamente)
// Ejemplo: 2026-03 => idx = 2026*12 + 3
const rUlt = await db.query(
  `
  SELECT
    MAX( (anio::int * 12) + (mes::int) ) AS ultimo_idx,
    MAX( (anio::int * 100) + (mes::int) ) AS ultimo_ym
  FROM pagos_mensuales
  WHERE socio_id = $1 AND club_id = $2
  `,
  [socio.id, clubId]
);

const ultimoIdx = rUlt.rows?.[0]?.ultimo_idx
  ? Number(rUlt.rows[0].ultimo_idx)
  : null;
const ultimoYM = rUlt.rows?.[0]?.ultimo_ym
  ? Number(rUlt.rows[0].ultimo_ym)
  : null;

const now = new Date();
const curYear = now.getFullYear();
const curMonth = now.getMonth() + 1; // 1-12
const curIdx = curYear * 12 + curMonth;

const ultimo_pago = ultimoYM ? ymToString(ultimoYM) : null;

// ✅ al_dia: consideramos OK si último mes pagado es el actual O el anterior
// es decir: ultimoIdx >= (curIdx - 1)
const al_dia = ultimoIdx ? (ultimoIdx >= (curIdx - 1)) : false;

    // 4) Emitir token APP (JWT)
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ ok: false, error: 'Falta JWT_SECRET en el servidor' });
    }

    const token = jwt.sign(
      {
        socioId: socio.id,
        clubId: clubId,
        numero_socio: socio.numero_socio
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // 5) Respuesta para Flutter
    return res.json({
      ok: true,
      token,
      socio: {
        id: socio.id,
        club_id: clubId,
        numero: socio.numero_socio,
        dni: socio.dni,
        nombre: socio.nombre,
        apellido: socio.apellido,
        actividad: socio.actividad,
        categoria: socio.categoria,
        fecha_nacimiento: socio.fecha_nacimiento,
        fecha_ingreso: socio.fecha_ingreso,
        foto_url: socio.foto_url,
        ultimo_pago,
        al_dia
      },
      club: {
   id: club.id,
   nombre: club.name,
   logo_url: club.logo_url,
   color_primary: club.color_primary,
   color_secondary: club.color_secondary,
   color_accent: club.color_accent,
   instagram_url: club.instagram_url      // 👈 AGREGADO
}
    });
  } catch (e) {
    console.error('❌ /app/login error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================================
// POST /app/socios/photo-request
// App: solicitar cambio de foto del socio (queda pendiente para aprobación)
// ======================================================
router.post('/socios/photo-request', requireAuth, async (req, res) => {
  try {
    const clubId =
      req.user?.clubId ||
      req.user?.club_id ||
      req.user?.clubID ||
      null;

    const socioIdToken =
      req.user?.socioId ||
      req.user?.socio_id ||
      req.user?.socioID ||
      null;

    const {
      socio_id,
      foto_base64,
      filename = 'foto.jpg',
      mimetype = 'image/jpeg',
    } = req.body || {};

    if (!clubId || !socioIdToken) {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido para la app',
      });
    }

    if (!socio_id || !foto_base64) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan datos',
      });
    }

    // El socio solo puede pedir cambio de SU propia foto
    if (String(socio_id) !== String(socioIdToken)) {
      return res.status(403).json({
        ok: false,
        error: 'No autorizado para solicitar cambio de foto de otro socio',
      });
    }

    // Verificar socio
    const rSocio = await db.query(
      `
      SELECT id, nombre, apellido, dni, actividad, categoria, telefono, direccion, fecha_nacimiento
      FROM socios
      WHERE id = $1 AND club_id = $2
      LIMIT 1
      `,
      [socio_id, clubId]
    );

    if (!rSocio.rowCount) {
      return res.status(404).json({
        ok: false,
        error: 'Socio no encontrado',
      });
    }

    const s = rSocio.rows[0];

    // Guardamos la imagen como data URL para reutilizar el flujo actual de aprobación
    const fotoUrl = `data:${mimetype};base64,${foto_base64}`;

    const r = await db.query(
      `
      INSERT INTO socios_pendientes (
        club_id,
        nombre,
        apellido,
        dni,
        actividad,
        categoria,
        telefono,
        direccion,
        fecha_nacimiento,
        foto_url,
        tipo,
        estado
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'foto','pendiente')
      RETURNING id
      `,
      [
        clubId,
        s.nombre,
        s.apellido,
        s.dni,
        s.actividad,
        s.categoria,
        s.telefono,
        s.direccion,
        s.fecha_nacimiento,
        fotoUrl,
      ]
    );

    return res.json({
      ok: true,
      pendiente_id: r.rows[0].id,
    });
  } catch (e) {
    console.error('❌ app photo request', e);
    return res.status(500).json({
      ok: false,
      error: e.message || 'Error interno',
    });
  }
});

module.exports = router;