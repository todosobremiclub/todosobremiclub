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
         color_accent
       FROM clubs
       WHERE id = $1
       LIMIT 1`,
      [clubId]
    );

    if (rClub.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Club no encontrado' });
    }

    const club = rClub.rows[0];

    // 3) Último pago (YYYYMM) desde pagos_mensuales
    //    (usamos MAX(anio*100+mes) para no depender de fecha_pago)
    const rUlt = await db.query(
      `SELECT MAX((anio::int * 100) + (mes::int)) AS ultimo
       FROM pagos_mensuales
       WHERE socio_id = $1 AND club_id = $2`,
      [socio.id, clubId]
    );

    const ultimoYM = rUlt.rows?.[0]?.ultimo ? Number(rUlt.rows[0].ultimo) : null;

    const now = new Date();
    const curYM = now.getFullYear() * 100 + (now.getMonth() + 1);

    const ultimo_pago = ultimoYM ? ymToString(ultimoYM) : null;
    const al_dia = ultimoYM ? (ultimoYM >= curYM) : false;

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
        color_accent: club.color_accent
      }
    });
  } catch (e) {
    console.error('❌ /app/login error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;