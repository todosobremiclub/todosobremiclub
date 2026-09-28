// src/routes/tiendaRoutes.js
//
// Módulo "Tienda Online": CRUD de productos + gestión de reservas, del
// lado del panel admin del club (montado bajo /club, requiere
// requireClubAccess). Los endpoints que usa la APP del socio (ver
// catálogo, reservar, ver "mis reservas") viven en appRoutes.js, no acá
// — ver claude/tienda-online-plan.md en el proyecto para el detalle.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const { initFirebase } = require('../config/firebaseAdmin');
const { notificarSocio } = require('../services/notificacionesService'); // ✅ NUEVO (paso 6)

const router = express.Router();

// CORS simple para Flutter Web (mismo bloque que el resto de /club/...)
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
// Helper: validar acceso al club (mismo patrón que noticiasRoutes.js)
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }
  next();
}

// ===============================
// Helper: borrar imagen vieja de Firebase (mismo patrón que noticiasRoutes.js)
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

// ============================================================
// PRODUCTOS
// ============================================================

// ------------------------------------------------------------
// GET /club/:clubId/tienda/productos
// Lista completa (incluye inactivos, para que el admin los vea y pueda
// reactivarlos/editarlos).
// ------------------------------------------------------------
router.get('/:clubId/tienda/productos', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const r = await db.query(
      `
      SELECT id, nombre, descripcion, precio, stock, imagen_url, activo, created_at, updated_at
      FROM tienda_productos
      WHERE club_id = $1
      ORDER BY activo DESC, nombre ASC
      `,
      [clubId]
    );
    return res.json({ ok: true, productos: r.rows });
  } catch (e) {
    console.error('❌ GET tienda/productos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/tienda/productos
// body: { nombre, descripcion?, precio, stock, imagen_base64?, imagen_mimetype? }
// ------------------------------------------------------------
router.post('/:clubId/tienda/productos', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    nombre,
    descripcion = null,
    precio,
    stock,
    imagen_base64,
    imagen_mimetype,
  } = req.body || {};

  try {
    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, error: 'Falta el nombre del producto' });
    }
    const precioNum = Number(precio);
    const stockNum = Number(stock);
    if (!Number.isFinite(precioNum) || precioNum < 0) {
      return res.status(400).json({ ok: false, error: 'Precio inválido' });
    }
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      return res.status(400).json({ ok: false, error: 'Stock inválido' });
    }

    let imagen_url = null;
    if (imagen_base64 && imagen_mimetype) {
      const buffer = Buffer.from(imagen_base64, 'base64');
      const up = await uploadImageBuffer({
        buffer,
        mimetype: imagen_mimetype,
        originalname: 'producto.jpg',
        folder: `clubs/${clubId}/tienda`,
      });
      imagen_url = up.url;
    }

    const r = await db.query(
      `
      INSERT INTO tienda_productos (club_id, nombre, descripcion, precio, stock, imagen_url, activo, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
      RETURNING id, nombre, descripcion, precio, stock, imagen_url, activo, created_at, updated_at
      `,
      [clubId, nombre.trim(), descripcion?.trim() || null, precioNum, stockNum, imagen_url]
    );

    return res.status(201).json({ ok: true, producto: r.rows[0] });
  } catch (e) {
    console.error('❌ POST tienda/productos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// PUT /club/:clubId/tienda/productos/:id
// body: igual que POST, más { activo? } para activar/desactivar.
// Si viene imagen_base64, reemplaza la imagen anterior.
// ------------------------------------------------------------
router.put('/:clubId/tienda/productos/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const {
    nombre,
    descripcion = null,
    precio,
    stock,
    activo,
    imagen_base64,
    imagen_mimetype,
  } = req.body || {};

  try {
    const prev = await db.query(
      `SELECT imagen_url FROM tienda_productos WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!prev.rowCount) {
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, error: 'Falta el nombre del producto' });
    }
    const precioNum = Number(precio);
    const stockNum = Number(stock);
    if (!Number.isFinite(precioNum) || precioNum < 0) {
      return res.status(400).json({ ok: false, error: 'Precio inválido' });
    }
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      return res.status(400).json({ ok: false, error: 'Stock inválido' });
    }

    let imagen_url = prev.rows[0].imagen_url;
    if (imagen_base64 && imagen_mimetype) {
      const buffer = Buffer.from(imagen_base64, 'base64');
      const up = await uploadImageBuffer({
        buffer,
        mimetype: imagen_mimetype,
        originalname: 'producto.jpg',
        folder: `clubs/${clubId}/tienda`,
      });
      const nuevaUrl = up.url;
      if (imagen_url && imagen_url !== nuevaUrl) {
        try {
          await deleteFirebaseObjectByUrl(imagen_url);
        } catch (err) {
          console.warn('⚠ No se pudo borrar imagen previa de producto:', err.message);
        }
      }
      imagen_url = nuevaUrl;
    }

    const activoBool = typeof activo === 'boolean' ? activo : (activo === 'true' ? true : (activo === 'false' ? false : prev.rows[0].activo));

    const r = await db.query(
      `
      UPDATE tienda_productos
      SET nombre = $1, descripcion = $2, precio = $3, stock = $4, imagen_url = $5, activo = $6, updated_at = NOW()
      WHERE id = $7 AND club_id = $8
      RETURNING id, nombre, descripcion, precio, stock, imagen_url, activo, created_at, updated_at
      `,
      [nombre.trim(), descripcion?.trim() || null, precioNum, stockNum, imagen_url, activoBool, id, clubId]
    );

    return res.json({ ok: true, producto: r.rows[0] });
  } catch (e) {
    console.error('❌ PUT tienda/productos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// DELETE /club/:clubId/tienda/productos/:id
// Baja física solo si el producto no tiene reservas asociadas. Si tiene,
// se desactiva en su lugar (para no romper el historial de reservas).
// ------------------------------------------------------------
router.delete('/:clubId/tienda/productos/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    const rTiene = await db.query(
      `SELECT 1 FROM tienda_reservas WHERE producto_id = $1 LIMIT 1`,
      [id]
    );

    if (rTiene.rowCount) {
      const r = await db.query(
        `UPDATE tienda_productos SET activo = false, updated_at = NOW() WHERE id = $1 AND club_id = $2`,
        [id, clubId]
      );
      if (!r.rowCount) {
        return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
      }
      return res.json({ ok: true, desactivado: true, mensaje: 'El producto tiene reservas asociadas: se desactivó en vez de eliminarse.' });
    }

    const r = await db.query(
      `DELETE FROM tienda_productos WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }
    return res.json({ ok: true, eliminado: true });
  } catch (e) {
    console.error('❌ DELETE tienda/productos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// RESERVAS (gestión admin — se muestran en la sección Pendientes)
// ============================================================

// ------------------------------------------------------------
// GET /club/:clubId/tienda/reservas?estado=pendiente
// Si no se pasa "estado", trae todas.
// ------------------------------------------------------------
router.get('/:clubId/tienda/reservas', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { estado } = req.query;

  const ESTADOS_VALIDOS = new Set(['pendiente', 'aceptada', 'rechazada', 'retirada', 'cancelada']);
  if (estado && !ESTADOS_VALIDOS.has(estado)) {
    return res.status(400).json({ ok: false, error: 'estado inválido' });
  }

  try {
    const r = await db.query(
      `
      SELECT
        r.id,
        r.cantidad,
        r.estado,
        r.estado_pago,
        r.monto_pagado,
        r.mensaje_admin,
        r.created_at,
        r.gestionada_at,
        p.id AS producto_id,
        p.nombre AS producto_nombre,
        p.precio AS producto_precio,
        p.imagen_url AS producto_imagen_url,
        s.id AS socio_id,
        s.numero_socio,
        s.nombre AS socio_nombre,
        s.apellido AS socio_apellido
      FROM tienda_reservas r
      JOIN tienda_productos p ON p.id = r.producto_id
      JOIN socios s ON s.id = r.socio_id
      WHERE r.club_id = $1
        ${estado ? 'AND r.estado = $2' : ''}
      ORDER BY r.created_at DESC
      `,
      estado ? [clubId, estado] : [clubId]
    );
    return res.json({ ok: true, reservas: r.rows });
  } catch (e) {
    console.error('❌ GET tienda/reservas', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/tienda/reservas/:id/aceptar
// body: { mensaje? }
// ✅ El stock ya se descontó cuando el socio reservó (POST /app/tienda/reservas
// en appRoutes.js), así que acá NO se vuelve a tocar el stock: solo se marca
// la reserva como aceptada.
// ------------------------------------------------------------
router.post('/:clubId/tienda/reservas/:id/aceptar', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { mensaje = null } = req.body || {};
  const adminUserId = req.user?.userId || req.user?.id || null;

  try {
    await db.query('BEGIN');

    const rRes = await db.query(
      `SELECT id, producto_id, socio_id, cantidad, estado FROM tienda_reservas WHERE id = $1 AND club_id = $2 FOR UPDATE`,
      [id, clubId]
    );
    if (!rRes.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Reserva no encontrada' });
    }
    const reserva = rRes.rows[0];
    if (reserva.estado !== 'pendiente') {
      await db.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: `La reserva ya fue gestionada (estado: ${reserva.estado})` });
    }

    const rProd = await db.query(
      `SELECT nombre FROM tienda_productos WHERE id = $1 AND club_id = $2`,
      [reserva.producto_id, clubId]
    );
    if (!rProd.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    const rUpd = await db.query(
      `
      UPDATE tienda_reservas
      SET estado = 'aceptada', mensaje_admin = $1, gestionada_por = $2, gestionada_at = NOW(), updated_at = NOW()
      WHERE id = $3
      RETURNING id, estado, mensaje_admin, gestionada_at
      `,
      [mensaje?.trim() || null, adminUserId, id]
    );

    await db.query('COMMIT');

    // ✅ paso 6: avisar al socio por push que su reserva fue aceptada.
    // Se dispara después del COMMIT (la reserva ya quedó aceptada en la
    // base pase lo que pase con el envío del push) y no bloquea la
    // respuesta si falla.
    const cuerpoAceptada = mensaje?.trim()
      ? `Tu reserva de "${rProd.rows[0].nombre}" fue aceptada. Podés retirarla en el club. Mensaje del club: ${mensaje.trim()}`
      : `Tu reserva de "${rProd.rows[0].nombre}" fue aceptada. Podés retirarla en el club.`;

    notificarSocio({
      clubId,
      socioId: reserva.socio_id,
      titulo: '🛒 Reserva aceptada',
      cuerpo: cuerpoAceptada,
      data: {
        type: 'tienda_reserva_aceptada',
        reservaId: String(id),
        productoId: String(reserva.producto_id),
      },
    }).catch(err => console.warn('⚠ No se pudo notificar al socio (reserva aceptada):', err.message));

    return res.json({ ok: true, reserva: rUpd.rows[0] });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST tienda/reservas/aceptar', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/tienda/reservas/:id/rechazar
// body: { mensaje? }
// ✅ Devuelve al stock del producto la cantidad que se había descontado al
// crear la reserva (ver POST /app/tienda/reservas en appRoutes.js).
// ------------------------------------------------------------
router.post('/:clubId/tienda/reservas/:id/rechazar', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { mensaje = null } = req.body || {};
  const adminUserId = req.user?.userId || req.user?.id || null;

  try {
    await db.query('BEGIN');

    const rRes = await db.query(
      `
      SELECT r.id, r.estado, r.socio_id, r.producto_id, r.cantidad, p.nombre AS producto_nombre
      FROM tienda_reservas r
      JOIN tienda_productos p ON p.id = r.producto_id
      WHERE r.id = $1 AND r.club_id = $2
      FOR UPDATE OF r
      `,
      [id, clubId]
    );
    if (!rRes.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Reserva no encontrada' });
    }
    if (rRes.rows[0].estado !== 'pendiente') {
      await db.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: `La reserva ya fue gestionada (estado: ${rRes.rows[0].estado})` });
    }

    const r = await db.query(
      `
      UPDATE tienda_reservas
      SET estado = 'rechazada', mensaje_admin = $1, gestionada_por = $2, gestionada_at = NOW(), updated_at = NOW()
      WHERE id = $3
      RETURNING id, estado, mensaje_admin, gestionada_at
      `,
      [mensaje?.trim() || null, adminUserId, id]
    );

    // Repone el stock reservado por esta solicitud.
    await db.query(
      `UPDATE tienda_productos SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
      [rRes.rows[0].cantidad, rRes.rows[0].producto_id]
    );

    await db.query('COMMIT');

    // ✅ paso 6: avisar al socio por push que su reserva fue rechazada.
    const cuerpoRechazada = mensaje?.trim()
      ? `Tu reserva de "${rRes.rows[0].producto_nombre}" fue rechazada. Motivo: ${mensaje.trim()}`
      : `Tu reserva de "${rRes.rows[0].producto_nombre}" fue rechazada.`;

    notificarSocio({
      clubId,
      socioId: rRes.rows[0].socio_id,
      titulo: '🛒 Reserva rechazada',
      cuerpo: cuerpoRechazada,
      data: {
        type: 'tienda_reserva_rechazada',
        reservaId: String(id),
        productoId: String(rRes.rows[0].producto_id),
      },
    }).catch(err => console.warn('⚠ No se pudo notificar al socio (reserva rechazada):', err.message));

    return res.json({ ok: true, reserva: r.rows[0] });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST tienda/reservas/rechazar', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/tienda/reservas/:id/retirado
// Se usa cuando el socio pasa a buscar el producto por el club.
// ------------------------------------------------------------
router.post('/:clubId/tienda/reservas/:id/retirado', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    const rRes = await db.query(
      `SELECT id, estado FROM tienda_reservas WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!rRes.rowCount) {
      return res.status(404).json({ ok: false, error: 'Reserva no encontrada' });
    }
    if (rRes.rows[0].estado !== 'aceptada') {
      return res.status(400).json({ ok: false, error: 'Solo se puede marcar como retirada una reserva aceptada' });
    }

    const r = await db.query(
      `
      UPDATE tienda_reservas
      SET estado = 'retirada', updated_at = NOW()
      WHERE id = $1
      RETURNING id, estado
      `,
      [id]
    );

    return res.json({ ok: true, reserva: r.rows[0] });
  } catch (e) {
    console.error('❌ POST tienda/reservas/retirado', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// Helper: busca (o crea) el tipo de ingreso "Tienda" del club, para que
// los cobros de la Tienda Online aparezcan en los reportes financieros
// (Ingresos por tipo, Ingresos vs Gastos, etc.) igual que cualquier otro
// ingreso cargado manualmente desde /club/:clubId/ingresos.
// ------------------------------------------------------------
async function getOrCrearTipoIngresoTienda(clubId) {
  const rExist = await db.query(
    `SELECT id, activo FROM tipos_ingreso WHERE club_id = $1 AND nombre = 'Tienda' LIMIT 1`,
    [clubId]
  );
  if (rExist.rowCount) {
    const fila = rExist.rows[0];
    if (!fila.activo) {
      await db.query(`UPDATE tipos_ingreso SET activo = true WHERE id = $1`, [fila.id]);
    }
    return fila.id;
  }

  try {
    const rNew = await db.query(
      `
      INSERT INTO tipos_ingreso (id, club_id, nombre, activo, created_at)
      VALUES (gen_random_uuid(), $1, 'Tienda', true, NOW())
      RETURNING id
      `,
      [clubId]
    );
    return rNew.rows[0].id;
  } catch (e) {
    // Carrera entre dos requests creando el mismo tipo a la vez: si choca
    // por unique constraint, releemos el que quedó creado.
    if (e.code === '23505') {
      const rRetry = await db.query(
        `SELECT id FROM tipos_ingreso WHERE club_id = $1 AND nombre = 'Tienda' LIMIT 1`,
        [clubId]
      );
      if (rRetry.rowCount) return rRetry.rows[0].id;
    }
    throw e;
  }
}

// ------------------------------------------------------------
// PATCH /club/:clubId/tienda/reservas/:id/estado-pago
// body: { estado_pago, monto_pagado? }
//   estado_pago: 'sin_pago' | 'parcial' | 'pagado'
//   monto_pagado: obligatorio y > 0 solo si estado_pago = 'parcial'
//     (para 'pagado' se calcula solo como precio × cantidad; para
//     'sin_pago' queda en 0).
// Se puede cambiar en cualquier momento (reserva aceptada o ya retirada),
// para que el admin pueda marcar que el socio pagó después de retirar.
//
// ✅ Cada vez que queda un monto > 0, se refleja en ingresos_generales bajo
// el tipo "Tienda" (se crea o actualiza una única fila por reserva, enlazada
// por tienda_reservas.ingreso_generado_id) para que aparezca en los
// reportes financieros. Si se vuelve a "sin_pago", ese ingreso se desactiva
// en vez de borrarse, para no perder trazabilidad.
// ------------------------------------------------------------
router.patch('/:clubId/tienda/reservas/:id/estado-pago', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { estado_pago, monto_pagado: montoBody } = req.body || {};

  const ESTADOS_PAGO_VALIDOS = new Set(['sin_pago', 'parcial', 'pagado']);
  if (!ESTADOS_PAGO_VALIDOS.has(estado_pago)) {
    return res.status(400).json({ ok: false, error: 'estado_pago inválido' });
  }

  try {
    await db.query('BEGIN');

    const rRes = await db.query(
      `
      SELECT
        r.id, r.cantidad, r.ingreso_generado_id, r.socio_id,
        p.nombre AS producto_nombre, p.precio,
        s.numero_socio, s.nombre AS socio_nombre, s.apellido AS socio_apellido
      FROM tienda_reservas r
      JOIN tienda_productos p ON p.id = r.producto_id
      JOIN socios s ON s.id = r.socio_id
      WHERE r.id = $1 AND r.club_id = $2
      FOR UPDATE OF r
      `,
      [id, clubId]
    );
    if (!rRes.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Reserva no encontrada' });
    }
    const reserva = rRes.rows[0];
    const total = Number(reserva.precio) * Number(reserva.cantidad);

    let montoPagado = 0;
    if (estado_pago === 'pagado') {
      montoPagado = total;
    } else if (estado_pago === 'parcial') {
      montoPagado = Number(String(montoBody).replace(',', '.'));
      if (!Number.isFinite(montoPagado) || montoPagado <= 0) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Ingresá el monto abonado (mayor a 0)' });
      }
      if (montoPagado > total) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: `El monto no puede superar el total de la reserva ($${total})` });
      }
    }
    // estado_pago === 'sin_pago' → montoPagado queda en 0

    let ingresoId = reserva.ingreso_generado_id;

    if (montoPagado > 0) {
      const tipoIngresoId = await getOrCrearTipoIngresoTienda(clubId);
      const socioLabel = `#${reserva.numero_socio ?? '—'} ${reserva.socio_apellido ?? ''} ${reserva.socio_nombre ?? ''}`.trim();
      const observacion = `Tienda: ${reserva.producto_nombre} x${reserva.cantidad} — ${socioLabel}`;

      if (ingresoId) {
        await db.query(
          `UPDATE ingresos_generales SET monto = $1, observacion = $2, activo = true WHERE id = $3`,
          [montoPagado, observacion, ingresoId]
        );
      } else {
        const rIng = await db.query(
          `
          INSERT INTO ingresos_generales (id, club_id, tipo_ingreso_id, fecha, monto, observacion, cuenta, created_at, activo)
          VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE, $3, $4, 'Tienda', NOW(), true)
          RETURNING id
          `,
          [clubId, tipoIngresoId, montoPagado, observacion]
        );
        ingresoId = rIng.rows[0].id;
      }
    } else if (ingresoId) {
      // Volvió a "sin_pago": el ingreso ya generado se desactiva (no se
      // borra, para no perder el registro histórico).
      await db.query(`UPDATE ingresos_generales SET activo = false WHERE id = $1`, [ingresoId]);
    }

    const rUpd = await db.query(
      `
      UPDATE tienda_reservas
      SET estado_pago = $1, monto_pagado = $2, ingreso_generado_id = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING id, estado, estado_pago, monto_pagado
      `,
      [estado_pago, montoPagado, ingresoId, id]
    );

    await db.query('COMMIT');
    return res.json({ ok: true, reserva: rUpd.rows[0] });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ PATCH tienda/reservas/estado-pago', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
