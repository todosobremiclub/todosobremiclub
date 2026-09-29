// src/routes/appRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
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
    activo,
    becado
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

    // ✅ Registrar que el socio se logueó en la app (para el reporte de Socios logueados)
    try {
      await db.query(
        `UPDATE socios SET ultimo_login_app = NOW() WHERE id = $1`,
        [socio.id]
      );
    } catch (eLogin) {
      console.error('⚠️ No se pudo registrar ultimo_login_app:', eLogin);
    }

    /// 2) Traer club (para theme dinámico + transferencias)
const rClub = await db.query(
  `
  SELECT
    id,
    name,
    logo_url,
    color_primary,
    color_secondary,
    color_accent,
    instagram_url,  
    payment_due_day,
    transferencia_habilitada,
    transferencia_cvu,
    transferencia_alias,
    transferencia_titular,
    tienda_habilitada

  FROM clubs
  WHERE id = $1
  LIMIT 1
  `,
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
const curDay = now.getDate();

const ultimo_pago = ultimoYM ? ymToString(ultimoYM) : null;

const paymentDueDay = Number(rClub.rows?.[0]?.payment_due_day ?? 31);

// período exigido según fecha actual y corte del club
let requiredYear = curYear;
let requiredMonth = curMonth;

if (curDay <= paymentDueDay) {
  requiredMonth = curMonth - 1;
  if (requiredMonth === 0) {
    requiredMonth = 12;
    requiredYear = curYear - 1;
  }
}

const requiredIdx = requiredYear * 12 + requiredMonth;

// becado = siempre al día
const al_dia = socio.becado === true
  ? true
  : (ultimoIdx ? (ultimoIdx >= requiredIdx) : false);

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
instagram_url: club.instagram_url,

transferencia_habilitada: club.transferencia_habilitada,
transferencia_cvu: club.transferencia_cvu,
transferencia_alias: club.transferencia_alias,
transferencia_titular: club.transferencia_titular,
tienda_habilitada: club.tienda_habilitada
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

    // Buscar socio real
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

    // Guardamos la foto como data URL para reutilizar el flujo actual de pendientes tipo "foto"
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
      filename,
    });
  } catch (e) {
    console.error('❌ app photo request', e);
    return res.status(500).json({
      ok: false,
      error: e.message || 'Error interno',
    });
  }
});

// ======================================================
// GET /app/asistencias?mes=YYYY-MM
// App: resumen + detalle de asistencias/ausencias del socio
// logueado para el mes indicado (por defecto, el mes actual).
// Además informa si el socio tiene ALGÚN registro histórico
// (en cualquier mes) para que la app decida si muestra o no
// el indicador en el carnet.
// ======================================================
function monthRangeFromYYYYMM(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = `${y}-${String(mo).padStart(2, '0')}-01`;
  const endDate = new Date(y, mo, 1); // primer día del mes siguiente
  const endY = endDate.getFullYear();
  const endM = endDate.getMonth() + 1;
  const endExclusive = `${endY}-${String(endM).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

router.get('/asistencias', requireAuth, async (req, res) => {
  try {
    const clubId =
      req.user?.clubId || req.user?.club_id || req.user?.clubID || null;
    const socioId =
      req.user?.socioId || req.user?.socio_id || req.user?.socioID || null;

    if (!clubId || !socioId) {
      return res.status(401).json({ ok: false, error: 'Token inválido para la app' });
    }

    const now = new Date();
    const mesDefault = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const mesParam = String(req.query.mes || mesDefault);

    const range = monthRangeFromYYYYMM(mesParam);
    if (!range) {
      return res.status(400).json({ ok: false, error: 'Parámetro "mes" inválido (usar YYYY-MM)' });
    }

    // ¿Tiene ALGÚN registro histórico (en cualquier mes, no solo el pedido)?
    const rHist = await db.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM asistencia_detalle ad
        JOIN asistencia_eventos ae ON ae.id = ad.evento_id
        WHERE ad.socio_id = $1 AND ae.club_id = $2
      ) AS existe
      `,
      [socioId, clubId]
    );
    const tieneHistorial = rHist.rows?.[0]?.existe === true;

    // Si nunca tuvo un registro, ni siquiera consultamos el detalle del mes:
    // esto es lo que la app usa para decidir si oculta el indicador del carnet.
    if (!tieneHistorial) {
      return res.json({
        ok: true,
        mes: mesParam,
        tieneHistorial: false,
        resumen: { presentes: 0, ausentes: 0 },
        detalle: [],
      });
    }

    const rDet = await db.query(
      `
      SELECT
        to_char(ae.fecha::date, 'YYYY-MM-DD') AS fecha,
        ae.tipo,
        ae.actividad,
        ae.actividad_adicional,
        ae.categoria,
        ad.presente
      FROM asistencia_detalle ad
      JOIN asistencia_eventos ae ON ae.id = ad.evento_id
      WHERE ad.socio_id = $1
        AND ae.club_id = $2
        AND ae.fecha::date >= $3::date
        AND ae.fecha::date <  $4::date
      ORDER BY ae.fecha ASC
      `,
      [socioId, clubId, range.start, range.endExclusive]
    );

    const detalle = rDet.rows.map((r) => ({
      fecha: r.fecha,
      tipo: r.tipo,
      actividad: r.actividad,
      actividadAdicional: r.actividad_adicional,
      categoria: r.categoria,
      presente: r.presente === true,
    }));

    const presentes = detalle.filter((d) => d.presente).length;
    const ausentes = detalle.length - presentes;

    return res.json({
      ok: true,
      mes: mesParam,
      tieneHistorial: true,
      resumen: { presentes, ausentes },
      detalle,
    });
  } catch (e) {
    console.error('❌ /app/asistencias error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================================
// GET /app/config
// Devuelve la versión mínima de build permitida por
// plataforma y el link a la store correspondiente.
// Sin auth: se consulta ANTES de loguearse, en cada
// apertura de la app (ver app.dart, _checkForceUpdate).
//
// Para forzar una actualización: subí el número de
// minBuildAndroid / minBuildIOS al build que acabás de
// publicar. Cualquier instalación con un build MENOR
// queda bloqueada hasta que actualice.
// ======================================================
const APP_MIN_BUILD_ANDROID = 22;
// ⚠️ iOS todavía está en TestFlight (no en la store pública).
// Dejamos el mínimo en 0 (= nunca bloquea) hasta que se apruebe
// la primera versión pública y tengamos la URL real de App Store.
const APP_MIN_BUILD_IOS = 0;

const APP_STORE_URL_ANDROID =
  'https://play.google.com/store/apps/details?id=com.todosobremiclub.app';
// TODO: completar con la URL real una vez publicada en App Store
// (formato: https://apps.apple.com/app/idXXXXXXXXXX)
const APP_STORE_URL_IOS = '';

router.get('/config', (req, res) => {
  return res.json({
    ok: true,
    minBuildAndroid: APP_MIN_BUILD_ANDROID,
    minBuildIOS: APP_MIN_BUILD_IOS,
    storeUrlAndroid: APP_STORE_URL_ANDROID,
    storeUrlIOS: APP_STORE_URL_IOS,
  });
});

// ======================================================
// TIENDA ONLINE (app del socio)
// clubId y socioId salen siempre del token (requireAuth), nunca de la URL,
// mismo criterio que /app/asistencias y /app/socios/photo-request.
// ======================================================

// ------------------------------------------------------
// GET /app/tienda/productos
// Catálogo de productos activos del club del socio logueado.
// ------------------------------------------------------
router.get('/tienda/productos', requireAuth, async (req, res) => {
  try {
    const clubId = req.user?.clubId || req.user?.club_id || null;
    if (!clubId) {
      return res.status(401).json({ ok: false, error: 'Token inválido para la app' });
    }

    // ✅ Defensivo: si el club no tiene Tienda habilitada, no exponemos el
    // catálogo aunque alguien pegue directo al endpoint.
    const rClub = await db.query(
      `SELECT tienda_habilitada FROM clubs WHERE id = $1 LIMIT 1`,
      [clubId]
    );
    if (!rClub.rowCount || rClub.rows[0].tienda_habilitada !== true) {
      return res.status(403).json({ ok: false, error: 'Este club no tiene Tienda Online habilitada' });
    }

    const r = await db.query(
      `
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.stock, p.imagen_url,
             p.categoria_id, c.nombre AS categoria_nombre, p.tiene_talles,
             COALESCE(
               (
                 SELECT json_agg(json_build_object('id', t.id, 'talle', t.talle, 'stock', t.stock) ORDER BY t.orden ASC)
                 FROM tienda_producto_talles t
                 WHERE t.producto_id = p.id
               ),
               '[]'
             ) AS talles
      FROM tienda_productos p
      LEFT JOIN tienda_categorias c ON c.id = p.categoria_id
      WHERE p.club_id = $1 AND p.activo = true
      ORDER BY p.nombre ASC
      `,
      [clubId]
    );

    return res.json({ ok: true, productos: r.rows });
  } catch (e) {
    console.error('❌ GET /app/tienda/productos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------
// POST /app/tienda/reservas
// body: { items: [{ producto_id, talle_id?, cantidad }, ...] }
//   (compatibilidad: también acepta el formato viejo de un solo producto
//   { producto_id, talle_id?, cantidad } sin el array "items").
// ✅ El stock se descuenta ACÁ, al momento de reservar (no cuando el admin
// acepta): así dos socios no pueden reservar más unidades de las que hay
// disponibles mientras la reserva está pendiente. Si el admin la rechaza,
// tiendaRoutes.js (endpoint /rechazar) devuelve el stock reservado. Todas
// las líneas del carrito comparten un mismo pedido_id y el admin las
// gestiona juntas (ver claude/tienda-talles-carrito-venta-manual-plan.md).
// ------------------------------------------------------
router.post('/tienda/reservas', requireAuth, async (req, res) => {
  try {
    const clubId = req.user?.clubId || req.user?.club_id || null;
    const socioId = req.user?.socioId || req.user?.socio_id || null;
    if (!clubId || !socioId) {
      return res.status(401).json({ ok: false, error: 'Token inválido para la app' });
    }

    const body = req.body || {};
    const items = Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ producto_id: body.producto_id, talle_id: body.talle_id ?? null, cantidad: body.cantidad ?? 1 }];

    if (!items.length || items.some(it => !it?.producto_id)) {
      return res.status(400).json({ ok: false, error: 'Faltan productos en el carrito' });
    }
    for (const it of items) {
      const cantidadNum = Number(it.cantidad);
      if (!Number.isInteger(cantidadNum) || cantidadNum < 1) {
        return res.status(400).json({ ok: false, error: 'Cantidad inválida' });
      }
    }

    await db.query('BEGIN');

    const pedidoId = require('crypto').randomUUID();
    const reservasCreadas = [];

    for (const it of items) {
      const cantidadNum = Number(it.cantidad);

      // FOR UPDATE: bloquea la fila del producto para que dos reservas
      // simultáneas no descuenten stock que ya no está disponible.
      const rProd = await db.query(
        `SELECT id, nombre, activo, stock, tiene_talles FROM tienda_productos WHERE id = $1 AND club_id = $2 FOR UPDATE`,
        [it.producto_id, clubId]
      );
      if (!rProd.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
      }
      const producto = rProd.rows[0];
      if (!producto.activo) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: `"${producto.nombre}" ya no está disponible` });
      }

      let talleNombre = null;
      if (producto.tiene_talles) {
        if (!it.talle_id) {
          await db.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: `Elegí un talle para "${producto.nombre}"` });
        }
        const rTalle = await db.query(
          `SELECT id, talle, stock FROM tienda_producto_talles WHERE id = $1 AND producto_id = $2 FOR UPDATE`,
          [it.talle_id, it.producto_id]
        );
        if (!rTalle.rowCount) {
          await db.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: 'Talle no encontrado' });
        }
        if (rTalle.rows[0].stock < cantidadNum) {
          await db.query('ROLLBACK');
          return res.status(409).json({ ok: false, error: `No hay stock suficiente del talle ${rTalle.rows[0].talle} de "${producto.nombre}" (disponible: ${rTalle.rows[0].stock})` });
        }
        talleNombre = rTalle.rows[0].talle;
        await db.query(`UPDATE tienda_producto_talles SET stock = stock - $1, updated_at = NOW() WHERE id = $2`, [cantidadNum, it.talle_id]);
      } else if (producto.stock < cantidadNum) {
        await db.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: `No hay stock suficiente de "${producto.nombre}" (disponible: ${producto.stock})` });
      }

      await db.query(
        `UPDATE tienda_productos SET stock = stock - $1, updated_at = NOW() WHERE id = $2`,
        [cantidadNum, it.producto_id]
      );

      const r = await db.query(
        `
        INSERT INTO tienda_reservas (club_id, producto_id, socio_id, cantidad, estado, talle_id, talle, pedido_id, origen)
        VALUES ($1, $2, $3, $4, 'pendiente', $5, $6, $7, 'app')
        RETURNING id, club_id, producto_id, socio_id, cantidad, estado, talle_id, talle, pedido_id, created_at
        `,
        [clubId, it.producto_id, socioId, cantidadNum, it.talle_id || null, talleNombre, pedidoId]
      );
      reservasCreadas.push(r.rows[0]);
    }

    await db.query('COMMIT');

    return res.status(201).json({ ok: true, pedido_id: pedidoId, reservas: reservasCreadas });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST /app/tienda/reservas', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------
// GET /app/tienda/reservas/mias
// Historial de reservas del socio logueado, más recientes primero. Las
// líneas de un mismo carrito comparten pedido_id — la app las agrupa.
// ------------------------------------------------------
router.get('/tienda/reservas/mias', requireAuth, async (req, res) => {
  try {
    const clubId = req.user?.clubId || req.user?.club_id || null;
    const socioId = req.user?.socioId || req.user?.socio_id || null;
    if (!clubId || !socioId) {
      return res.status(401).json({ ok: false, error: 'Token inválido para la app' });
    }

    const r = await db.query(
      `
      SELECT
        r.id,
        r.pedido_id,
        r.cantidad,
        r.estado,
        r.estado_pago,
        r.talle,
        r.mensaje_admin,
        r.created_at,
        r.gestionada_at,
        p.id AS producto_id,
        p.nombre AS producto_nombre,
        p.precio AS producto_precio,
        p.imagen_url AS producto_imagen_url
      FROM tienda_reservas r
      JOIN tienda_productos p ON p.id = r.producto_id
      WHERE r.socio_id = $1 AND r.club_id = $2
      ORDER BY r.created_at DESC
      `,
      [socioId, clubId]
    );

    return res.json({ ok: true, reservas: r.rows });
  } catch (e) {
    console.error('❌ GET /app/tienda/reservas/mias', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;