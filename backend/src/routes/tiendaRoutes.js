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

// ===============================
// ✅ NUEVO: hasta 3 fotos por producto (imagen_url / imagen_url_2 / imagen_url_3)
// ===============================
// Resuelve un "slot" de foto (1, 2 o 3) a partir del body de POST/PUT:
// - si viene base64+mimetype: sube la foto nueva a Firebase y borra la
//   anterior (si había y es distinta).
// - si viene quitar=true (y no hay base64): borra la foto existente de
//   Firebase y deja el slot en null.
// - si no viene nada de lo anterior: deja la foto existente tal cual.
async function resolverImagenSlot({ prevUrl, base64, mimetype, quitar, clubId }) {
  if (base64 && mimetype) {
    const buffer = Buffer.from(base64, 'base64');
    const up = await uploadImageBuffer({
      buffer,
      mimetype,
      originalname: 'producto.jpg',
      folder: `clubs/${clubId}/tienda`,
    });
    const nuevaUrl = up.url;
    if (prevUrl && prevUrl !== nuevaUrl) {
      try {
        await deleteFirebaseObjectByUrl(prevUrl);
      } catch (err) {
        console.warn('⚠ No se pudo borrar imagen previa de producto:', err.message);
      }
    }
    return nuevaUrl;
  }

  if (quitar && prevUrl) {
    try {
      await deleteFirebaseObjectByUrl(prevUrl);
    } catch (err) {
      console.warn('⚠ No se pudo borrar imagen de producto:', err.message);
    }
    return null;
  }

  return prevUrl ?? null;
}

// Arma el array de fotos cargadas (sin huecos) a partir de las 3 columnas,
// para que el frontend (carrusel de la app) no tenga que pensar en slots.
function armarImagenesProducto(row) {
  return [row.imagen_url, row.imagen_url_2, row.imagen_url_3].filter(Boolean);
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
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.stock,
             p.imagen_url, p.imagen_url_2, p.imagen_url_3, p.activo,
             p.created_at, p.updated_at, p.tiene_talles,
             p.categoria_id, c.nombre AS categoria_nombre,
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
      WHERE p.club_id = $1
      ORDER BY p.activo DESC, p.nombre ASC
      `,
      [clubId]
    );
    const productos = r.rows.map(p => ({ ...p, imagenes: armarImagenesProducto(p) }));
    return res.json({ ok: true, productos });
  } catch (e) {
    console.error('❌ GET tienda/productos', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/tienda/productos
// body: {
//   nombre, descripcion?, precio, stock, ...,
//   imagen_base64?, imagen_mimetype?,     // foto 1
//   imagen2_base64?, imagen2_mimetype?,   // foto 2 (✅ NUEVO)
//   imagen3_base64?, imagen3_mimetype?,   // foto 3 (✅ NUEVO)
// }
// ------------------------------------------------------------
router.post('/:clubId/tienda/productos', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    nombre,
    descripcion = null,
    precio,
    stock,
    categoria_id = null,
    tiene_talles = false,
    talles = [],
    imagen_base64,
    imagen_mimetype,
    imagen2_base64,
    imagen2_mimetype,
    imagen3_base64,
    imagen3_mimetype,
  } = req.body || {};

  try {
    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, error: 'Falta el nombre del producto' });
    }
    const precioNum = Number(precio);
    if (!Number.isFinite(precioNum) || precioNum < 0) {
      return res.status(400).json({ ok: false, error: 'Precio inválido' });
    }

    // ✅ NUEVO: si el producto se vende por talle, el stock total sale de
    // sumar el stock de cada talle (no se usa el campo "stock" plano).
    const tieneTallesBool = tiene_talles === true || tiene_talles === 'true';
    let stockNum = Number(stock);
    if (!tieneTallesBool && (!Number.isInteger(stockNum) || stockNum < 0)) {
      return res.status(400).json({ ok: false, error: 'Stock inválido' });
    }
    if (tieneTallesBool && (!Array.isArray(talles) || !talles.length)) {
      return res.status(400).json({ ok: false, error: 'Agregá al menos un talle con su stock' });
    }

    // ✅ NUEVO: tipificación del producto (tienda_categorias), opcional.
    let categoriaIdFinal = null;
    if (categoria_id) {
      const rCat = await db.query(
        `SELECT id FROM tienda_categorias WHERE id = $1 AND club_id = $2 AND activo = true`,
        [categoria_id, clubId]
      );
      if (!rCat.rowCount) {
        return res.status(400).json({ ok: false, error: 'El tipo de producto seleccionado no existe' });
      }
      categoriaIdFinal = categoria_id;
    }

    // ✅ NUEVO: hasta 3 fotos. En alta no hay foto previa que borrar, así
    // que cada slot sube directo si vino base64 (si no vino nada, queda null).
    const imagen_url = await resolverImagenSlot({ prevUrl: null, base64: imagen_base64, mimetype: imagen_mimetype, quitar: false, clubId });
    const imagen_url_2 = await resolverImagenSlot({ prevUrl: null, base64: imagen2_base64, mimetype: imagen2_mimetype, quitar: false, clubId });
    const imagen_url_3 = await resolverImagenSlot({ prevUrl: null, base64: imagen3_base64, mimetype: imagen3_mimetype, quitar: false, clubId });

    const r = await db.query(
      `
      INSERT INTO tienda_productos (club_id, nombre, descripcion, precio, stock, categoria_id, tiene_talles, imagen_url, imagen_url_2, imagen_url_3, activo, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), NOW())
      RETURNING id, nombre, descripcion, precio, stock, categoria_id, tiene_talles, imagen_url, imagen_url_2, imagen_url_3, activo, created_at, updated_at
      `,
      [clubId, nombre.trim(), descripcion?.trim() || null, precioNum, tieneTallesBool ? 0 : stockNum, categoriaIdFinal, tieneTallesBool, imagen_url, imagen_url_2, imagen_url_3]
    );
    const producto = { ...r.rows[0], imagenes: armarImagenesProducto(r.rows[0]) };

    if (tieneTallesBool) {
      let stockTotal;
      try {
        stockTotal = await reemplazarTallesProducto(producto.id, talles);
      } catch (errTalles) {
        return res.status(400).json({ ok: false, error: errTalles.message });
      }
      const rStock = await db.query(
        `UPDATE tienda_productos SET stock = $1 WHERE id = $2 RETURNING stock`,
        [stockTotal, producto.id]
      );
      producto.stock = rStock.rows[0].stock;
    }

    return res.status(201).json({ ok: true, producto });
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
    categoria_id = null,
    tiene_talles = false,
    talles = [],
    imagen_base64,
    imagen_mimetype,
    quitar_imagen = false,
    imagen2_base64,
    imagen2_mimetype,
    quitar_imagen_2 = false,
    imagen3_base64,
    imagen3_mimetype,
    quitar_imagen_3 = false,
  } = req.body || {};

  try {
    const prev = await db.query(
      `SELECT imagen_url, imagen_url_2, imagen_url_3 FROM tienda_productos WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!prev.rowCount) {
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, error: 'Falta el nombre del producto' });
    }
    const precioNum = Number(precio);
    if (!Number.isFinite(precioNum) || precioNum < 0) {
      return res.status(400).json({ ok: false, error: 'Precio inválido' });
    }

    // ✅ NUEVO: idem POST — con talles, el stock sale de sumar cada talle.
    const tieneTallesBool = tiene_talles === true || tiene_talles === 'true';
    let stockNum = Number(stock);
    if (!tieneTallesBool && (!Number.isInteger(stockNum) || stockNum < 0)) {
      return res.status(400).json({ ok: false, error: 'Stock inválido' });
    }
    if (tieneTallesBool && (!Array.isArray(talles) || !talles.length)) {
      return res.status(400).json({ ok: false, error: 'Agregá al menos un talle con su stock' });
    }

    // ✅ NUEVO: tipificación del producto (tienda_categorias), opcional.
    let categoriaIdFinal = null;
    if (categoria_id) {
      const rCat = await db.query(
        `SELECT id FROM tienda_categorias WHERE id = $1 AND club_id = $2 AND activo = true`,
        [categoria_id, clubId]
      );
      if (!rCat.rowCount) {
        return res.status(400).json({ ok: false, error: 'El tipo de producto seleccionado no existe' });
      }
      categoriaIdFinal = categoria_id;
    }

    // ✅ NUEVO: hasta 3 fotos — cada slot se resuelve de forma independiente
    // (subir nueva / quitar existente / dejar igual).
    const imagen_url = await resolverImagenSlot({
      prevUrl: prev.rows[0].imagen_url,
      base64: imagen_base64,
      mimetype: imagen_mimetype,
      quitar: quitar_imagen === true || quitar_imagen === 'true',
      clubId,
    });
    const imagen_url_2 = await resolverImagenSlot({
      prevUrl: prev.rows[0].imagen_url_2,
      base64: imagen2_base64,
      mimetype: imagen2_mimetype,
      quitar: quitar_imagen_2 === true || quitar_imagen_2 === 'true',
      clubId,
    });
    const imagen_url_3 = await resolverImagenSlot({
      prevUrl: prev.rows[0].imagen_url_3,
      base64: imagen3_base64,
      mimetype: imagen3_mimetype,
      quitar: quitar_imagen_3 === true || quitar_imagen_3 === 'true',
      clubId,
    });

    const activoBool = typeof activo === 'boolean' ? activo : (activo === 'true' ? true : (activo === 'false' ? false : prev.rows[0].activo));

    if (tieneTallesBool) {
      try {
        stockNum = await reemplazarTallesProducto(id, talles);
      } catch (errTalles) {
        return res.status(400).json({ ok: false, error: errTalles.message });
      }
    } else {
      // El producto dejó de venderse por talle (o nunca lo hizo): se borran
      // los talles que pudiera tener cargados.
      await db.query(`DELETE FROM tienda_producto_talles WHERE producto_id = $1`, [id]);
    }

    const r = await db.query(
      `
      UPDATE tienda_productos
      SET nombre = $1, descripcion = $2, precio = $3, stock = $4, categoria_id = $5, tiene_talles = $6,
          imagen_url = $7, imagen_url_2 = $8, imagen_url_3 = $9, activo = $10, updated_at = NOW()
      WHERE id = $11 AND club_id = $12
      RETURNING id, nombre, descripcion, precio, stock, categoria_id, tiene_talles, imagen_url, imagen_url_2, imagen_url_3, activo, created_at, updated_at
      `,
      [nombre.trim(), descripcion?.trim() || null, precioNum, stockNum, categoriaIdFinal, tieneTallesBool, imagen_url, imagen_url_2, imagen_url_3, activoBool, id, clubId]
    );

    return res.json({ ok: true, producto: { ...r.rows[0], imagenes: armarImagenesProducto(r.rows[0]) } });
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
// RESERVAS / PEDIDOS (gestión admin — se muestran en la sección Pendientes)
//
// ✅ NUEVO (carrito): varias reservas compradas juntas comparten el mismo
// tienda_reservas.pedido_id. Los endpoints de gestión de abajo (aceptar,
// rechazar, retirado, estado-pago) reciben ese pedido_id en el parámetro
// :id de la URL (una reserva "suelta" vieja tiene pedido_id = su propio id,
// así que sigue funcionando igual) y actúan sobre TODAS las líneas del
// pedido a la vez — ver claude/tienda-talles-carrito-venta-manual-plan.md.
// ============================================================

// ------------------------------------------------------------
// GET /club/:clubId/tienda/reservas?estado=pendiente
// Si no se pasa "estado", trae todas. Devuelve filas planas (una por
// línea/talle); el admin las agrupa por pedido_id para mostrarlas juntas.
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
        r.pedido_id,
        r.origen,
        r.cantidad,
        r.estado,
        r.estado_pago,
        r.monto_pagado,
        r.talle_id,
        r.talle,
        ing.cuenta AS forma_pago,
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
      LEFT JOIN ingresos_generales ing ON ing.id = r.ingreso_generado_id
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
// POST /club/:clubId/tienda/reservas/:id/aceptar   (:id = pedido_id)
// body: { mensaje?, cantidad?, items?: [{ id, cantidad }] }
// ✅ El stock ya se descontó cuando el socio reservó (POST /app/tienda/reservas
// en appRoutes.js), así que acá NO se vuelve a descontar: solo se marcan
// aceptadas todas las líneas del pedido. El admin puede entregar MENOS
// cantidad de la pedida en cada línea (ej: pidieron 2 y solo hay/entregan
// 1); la diferencia vuelve al stock (del talle, si el producto tiene, y al
// total del producto). Nunca se permite entregar más de lo pedido.
// ------------------------------------------------------------
router.post('/:clubId/tienda/reservas/:id/aceptar', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { mensaje = null, cantidad = null, items = null } = req.body || {};
  const adminUserId = req.user?.userId || req.user?.id || null;

  try {
    await db.query('BEGIN');

    const rRows = await db.query(
      `SELECT id, producto_id, talle_id, socio_id, cantidad, estado FROM tienda_reservas WHERE pedido_id = $1 AND club_id = $2 FOR UPDATE`,
      [id, clubId]
    );
    if (!rRows.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }
    const filas = rRows.rows;
    if (filas.some(f => f.estado !== 'pendiente')) {
      await db.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'El pedido ya fue gestionado' });
    }

    // Cantidad a entregar por línea: { id_de_la_reserva: cantidad }. Si el
    // pedido tiene una sola línea también se acepta el parámetro plano
    // "cantidad" (compatibilidad con el flujo anterior, sin carrito).
    const cantidadPorLinea = new Map();
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it && it.id !== undefined && it.id !== null) cantidadPorLinea.set(String(it.id), it.cantidad);
      }
    } else if (filas.length === 1 && cantidad !== null && cantidad !== undefined && String(cantidad).trim() !== '') {
      cantidadPorLinea.set(String(filas[0].id), cantidad);
    }

    const nombresProductos = [];
    let huboReduccion = false;
    let socioId = null;

    for (const fila of filas) {
      socioId = fila.socio_id;
      const cantidadOriginal = Number(fila.cantidad);
      let cantidadFinal = cantidadOriginal;

      if (cantidadPorLinea.has(String(fila.id))) {
        const cantidadNum = Number(cantidadPorLinea.get(String(fila.id)));
        if (!Number.isInteger(cantidadNum) || cantidadNum < 1) {
          await db.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'La cantidad a entregar debe ser un entero mayor o igual a 1' });
        }
        if (cantidadNum > cantidadOriginal) {
          await db.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: `No se puede entregar más de lo pedido (${cantidadOriginal})` });
        }
        cantidadFinal = cantidadNum;
      }

      const diferencia = cantidadOriginal - cantidadFinal;
      if (diferencia > 0) {
        huboReduccion = true;
        if (fila.talle_id) {
          await db.query(
            `UPDATE tienda_producto_talles SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
            [diferencia, fila.talle_id]
          );
        }
        await db.query(
          `UPDATE tienda_productos SET stock = stock + $1, updated_at = NOW() WHERE id = $2 AND club_id = $3`,
          [diferencia, fila.producto_id, clubId]
        );
      }

      const rProd = await db.query(`SELECT nombre FROM tienda_productos WHERE id = $1 AND club_id = $2`, [fila.producto_id, clubId]);
      if (rProd.rowCount) nombresProductos.push(rProd.rows[0].nombre);

      await db.query(
        `
        UPDATE tienda_reservas
        SET estado = 'aceptada', cantidad = $1, mensaje_admin = $2, gestionada_por = $3, gestionada_at = NOW(), updated_at = NOW()
        WHERE id = $4
        `,
        [cantidadFinal, mensaje?.trim() || null, adminUserId, fila.id]
      );
    }

    await db.query('COMMIT');

    // ✅ paso 6: avisar al socio por push que su pedido fue aceptado (un
    // solo push por pedido, aunque tenga varias líneas).
    const listaProductos = nombresProductos.join(', ');
    const avisoReduccion = huboReduccion ? ' Alguna cantidad se ajustó según el stock disponible.' : '';
    const cuerpoAceptada = mensaje?.trim()
      ? `Tu pedido (${listaProductos}) fue aceptado.${avisoReduccion} Podés retirarlo en el club. Mensaje del club: ${mensaje.trim()}`
      : `Tu pedido (${listaProductos}) fue aceptado.${avisoReduccion} Podés retirarlo en el club.`;

    notificarSocio({
      clubId,
      socioId,
      titulo: '🛒 Pedido aceptado',
      cuerpo: cuerpoAceptada,
      data: {
        type: 'tienda_reserva_aceptada',
        pedidoId: String(id),
      },
    }).catch(err => console.warn('⚠ No se pudo notificar al socio (pedido aceptado):', err.message));

    return res.json({ ok: true, pedido_id: id });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST tienda/reservas/aceptar', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/tienda/reservas/:id/rechazar   (:id = pedido_id)
// body: { mensaje? }
// ✅ Devuelve al stock (del talle, si aplica, y al total del producto) la
// cantidad que se había descontado al crear cada línea del pedido.
// ------------------------------------------------------------
router.post('/:clubId/tienda/reservas/:id/rechazar', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { mensaje = null } = req.body || {};
  const adminUserId = req.user?.userId || req.user?.id || null;

  try {
    await db.query('BEGIN');

    const rRows = await db.query(
      `
      SELECT r.id, r.estado, r.socio_id, r.producto_id, r.talle_id, r.cantidad, p.nombre AS producto_nombre
      FROM tienda_reservas r
      JOIN tienda_productos p ON p.id = r.producto_id
      WHERE r.pedido_id = $1 AND r.club_id = $2
      FOR UPDATE OF r
      `,
      [id, clubId]
    );
    if (!rRows.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }
    const filas = rRows.rows;
    if (filas.some(f => f.estado !== 'pendiente')) {
      await db.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'El pedido ya fue gestionado' });
    }

    const nombresProductos = [];
    let socioId = null;

    for (const fila of filas) {
      socioId = fila.socio_id;
      nombresProductos.push(fila.producto_nombre);

      await db.query(
        `
        UPDATE tienda_reservas
        SET estado = 'rechazada', mensaje_admin = $1, gestionada_por = $2, gestionada_at = NOW(), updated_at = NOW()
        WHERE id = $3
        `,
        [mensaje?.trim() || null, adminUserId, fila.id]
      );

      if (fila.talle_id) {
        await db.query(
          `UPDATE tienda_producto_talles SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
          [fila.cantidad, fila.talle_id]
        );
      }
      await db.query(
        `UPDATE tienda_productos SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
        [fila.cantidad, fila.producto_id]
      );
    }

    await db.query('COMMIT');

    // ✅ paso 6: avisar al socio por push que su pedido fue rechazado.
    const listaProductos = nombresProductos.join(', ');
    const cuerpoRechazada = mensaje?.trim()
      ? `Tu pedido (${listaProductos}) fue rechazado. Motivo: ${mensaje.trim()}`
      : `Tu pedido (${listaProductos}) fue rechazado.`;

    notificarSocio({
      clubId,
      socioId,
      titulo: '🛒 Pedido rechazado',
      cuerpo: cuerpoRechazada,
      data: {
        type: 'tienda_reserva_rechazada',
        pedidoId: String(id),
      },
    }).catch(err => console.warn('⚠ No se pudo notificar al socio (pedido rechazado):', err.message));

    return res.json({ ok: true, pedido_id: id });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST tienda/reservas/rechazar', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------
// POST /club/:clubId/tienda/reservas/:id/retirado   (:id = pedido_id)
// Se usa cuando el socio pasa a buscar el pedido por el club.
// ✅ NUEVO: ya NO exige que esté pagado — se puede entregar en cualquier
// estado de pago (el panel admin pide confirmación extra si falta pagar;
// ver pendientes.js). Marca "retirada" todas las líneas del pedido que
// estén en estado "aceptada".
// ------------------------------------------------------------
router.post('/:clubId/tienda/reservas/:id/retirado', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    const rRows = await db.query(
      `SELECT id, estado FROM tienda_reservas WHERE pedido_id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!rRows.rowCount) {
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }
    if (!rRows.rows.some(f => f.estado === 'aceptada')) {
      return res.status(400).json({ ok: false, error: 'El pedido no tiene líneas en estado "aceptada" para marcar como retiradas' });
    }

    const r = await db.query(
      `
      UPDATE tienda_reservas
      SET estado = 'retirada', updated_at = NOW()
      WHERE pedido_id = $1 AND club_id = $2 AND estado = 'aceptada'
      RETURNING id, estado
      `,
      [id, clubId]
    );

    return res.json({ ok: true, pedido_id: id, reservas: r.rows });
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
// PATCH /club/:clubId/tienda/reservas/:id/estado-pago   (:id = pedido_id)
// body: { estado_pago, monto_pagado?, cuenta_id? }
//   estado_pago: 'sin_pago' | 'parcial' | 'pagado'
//   monto_pagado: obligatorio y > 0 solo si estado_pago = 'parcial'
//     (para 'pagado' se calcula solo como la suma de precio × cantidad de
//     TODAS las líneas del pedido; para 'sin_pago' queda en 0).
//   cuenta_id: obligatorio si estado_pago es 'parcial' o 'pagado' — id de
//     responsables_gasto (la misma lista de "cuentas" que se usa al cargar
//     un pago de cuota o un ingreso general). Indica por dónde entró la
//     plata, igual que cualquier otro ingreso del club.
// ✅ El pedido se paga como una sola unidad (carrito): el monto y la cuenta
// se aplican a TODAS las líneas del pedido, y se genera un único ingreso en
// ingresos_generales por el total del pedido (no uno por línea).
//
// ✅ Cada vez que queda un monto > 0, se refleja en ingresos_generales:
// tipo_ingreso = "Tienda" (así se ve agrupado en "Ingresos por tipo") y
// cuenta = la cuenta elegida acá (así "Ingresos por responsable" la cuenta
// correctamente, en vez de mostrar "Tienda" como si fuera una cuenta). Si
// se vuelve a "sin_pago", ese ingreso se desactiva en vez de borrarse, para
// no perder trazabilidad.
// ------------------------------------------------------------
router.patch('/:clubId/tienda/reservas/:id/estado-pago', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { estado_pago, monto_pagado: montoBody, cuenta_id: cuentaIdBody } = req.body || {};

  const ESTADOS_PAGO_VALIDOS = new Set(['sin_pago', 'parcial', 'pagado']);
  if (!ESTADOS_PAGO_VALIDOS.has(estado_pago)) {
    return res.status(400).json({ ok: false, error: 'estado_pago inválido' });
  }

  try {
    await db.query('BEGIN');

    const rRows = await db.query(
      `
      SELECT
        r.id, r.cantidad, r.ingreso_generado_id, r.socio_id,
        p.nombre AS producto_nombre, p.precio,
        s.numero_socio, s.nombre AS socio_nombre, s.apellido AS socio_apellido
      FROM tienda_reservas r
      JOIN tienda_productos p ON p.id = r.producto_id
      JOIN socios s ON s.id = r.socio_id
      WHERE r.pedido_id = $1 AND r.club_id = $2
      FOR UPDATE OF r
      `,
      [id, clubId]
    );
    if (!rRows.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }
    const filas = rRows.rows;
    const primera = filas[0];
    const total = filas.reduce((acc, f) => acc + Number(f.precio) * Number(f.cantidad), 0);
    const ingresoIdExistente = filas.find(f => f.ingreso_generado_id)?.ingreso_generado_id || null;

    let montoPagado = 0;
    let cuentaFinal = null;

    if (estado_pago === 'pagado' || estado_pago === 'parcial') {
      if (!cuentaIdBody) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Seleccioná la cuenta / forma de pago' });
      }
      const rCuenta = await db.query(
        `SELECT nombre FROM responsables_gasto WHERE id = $1 AND club_id = $2 AND activo = true`,
        [cuentaIdBody, clubId]
      );
      if (!rCuenta.rowCount) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'La cuenta seleccionada no existe' });
      }
      cuentaFinal = rCuenta.rows[0].nombre;
    }

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
        return res.status(400).json({ ok: false, error: `El monto no puede superar el total del pedido ($${total})` });
      }
    }
    // estado_pago === 'sin_pago' → montoPagado queda en 0, sin cuenta

    let ingresoId = ingresoIdExistente;

    if (montoPagado > 0) {
      const tipoIngresoId = await getOrCrearTipoIngresoTienda(clubId);
      const socioLabel = `#${primera.numero_socio ?? '—'} ${primera.socio_apellido ?? ''} ${primera.socio_nombre ?? ''}`.trim();
      const detalleProductos = filas.map(f => `${f.producto_nombre} x${f.cantidad}`).join(', ');
      const observacion = `Tienda: ${detalleProductos} — ${socioLabel}`;

      if (ingresoId) {
        await db.query(
          `UPDATE ingresos_generales SET monto = $1, observacion = $2, cuenta = $3, activo = true WHERE id = $4`,
          [montoPagado, observacion, cuentaFinal, ingresoId]
        );
      } else {
        const rIng = await db.query(
          `
          INSERT INTO ingresos_generales (id, club_id, tipo_ingreso_id, fecha, monto, observacion, cuenta, created_at, activo)
          VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE, $3, $4, $5, NOW(), true)
          RETURNING id
          `,
          [clubId, tipoIngresoId, montoPagado, observacion, cuentaFinal]
        );
        ingresoId = rIng.rows[0].id;
      }
    } else if (ingresoId) {
      // Volvió a "sin_pago": el ingreso ya generado se desactiva (no se
      // borra, para no perder el registro histórico).
      await db.query(`UPDATE ingresos_generales SET activo = false WHERE id = $1`, [ingresoId]);
    }

    await db.query(
      `
      UPDATE tienda_reservas
      SET estado_pago = $1, monto_pagado = $2, ingreso_generado_id = $3, updated_at = NOW()
      WHERE pedido_id = $4 AND club_id = $5
      `,
      [estado_pago, montoPagado, ingresoId, id, clubId]
    );

    await db.query('COMMIT');
    return res.json({
      ok: true,
      pedido: { pedido_id: id, estado_pago, monto_pagado: montoPagado, total, forma_pago: cuentaFinal },
    });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ PATCH tienda/reservas/estado-pago', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------
// DELETE /:clubId/tienda/reservas/:id  (:id = pedido_id)
// ✅ NUEVO: elimina definitivamente una compra del Historial de ventas
// (pedido con estado 'aceptada' o 'retirada' — de la app o venta manual).
// No restituye stock (se asume que el producto ya salió/se entregó del
// club de verdad). Si el pedido tenía un pago registrado, se borra
// también la fila de ingresos_generales asociada para no dejar un
// ingreso "fantasma" sin la venta que lo originó. Es un borrado
// definitivo (no soft-delete): no queda rastro en la base.
// ------------------------------------------------------
router.delete('/:clubId/tienda/reservas/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;

  try {
    await db.query('BEGIN');

    const rRows = await db.query(
      `SELECT id, estado, ingreso_generado_id FROM tienda_reservas WHERE pedido_id = $1 AND club_id = $2 FOR UPDATE`,
      [id, clubId]
    );
    if (!rRows.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }

    const filas = rRows.rows;
    const estadosValidos = new Set(['aceptada', 'retirada']);
    if (!filas.every(f => estadosValidos.has(f.estado))) {
      await db.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        error: 'Solo se pueden eliminar compras del Historial de ventas (aceptadas o retiradas)',
      });
    }

    // Puede haber más de un ingreso si el pedido se creó antes de que el
    // pago pasara a gestionarse a nivel de pedido; se borran todos los
    // que queden referenciados por alguna de las filas.
    const ingresoIds = [...new Set(filas.map(f => f.ingreso_generado_id).filter(Boolean))];

    await db.query(`DELETE FROM tienda_reservas WHERE pedido_id = $1 AND club_id = $2`, [id, clubId]);

    for (const ingresoId of ingresoIds) {
      await db.query(`DELETE FROM ingresos_generales WHERE id = $1`, [ingresoId]);
    }

    await db.query('COMMIT');
    return res.json({ ok: true, eliminado: true, ingresos_eliminados: ingresoIds.length });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ DELETE tienda/reservas', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// TALLES POR PRODUCTO (helper usado por POST/PUT productos)
// ============================================================

// Reemplaza por completo la lista de talles de un producto. Simple a
// propósito (borra e inserta de nuevo) en vez de diffear; el nombre del
// talle queda igual como snapshot en las reservas ya hechas (tienda_reservas.talle)
// aunque la fila de tienda_producto_talles se vuelva a crear con otro id.
async function reemplazarTallesProducto(productoId, talles) {
  await db.query(`DELETE FROM tienda_producto_talles WHERE producto_id = $1`, [productoId]);

  let total = 0;
  let orden = 0;
  for (const t of talles) {
    const nombreTalle = String(t?.talle ?? '').trim();
    const stockTalle = Number(t?.stock);
    if (!nombreTalle) continue;
    if (!Number.isInteger(stockTalle) || stockTalle < 0) {
      throw new Error(`Stock inválido para el talle "${nombreTalle}"`);
    }
    await db.query(
      `INSERT INTO tienda_producto_talles (producto_id, talle, stock, orden) VALUES ($1, $2, $3, $4)`,
      [productoId, nombreTalle, stockTalle, orden]
    );
    total += stockTalle;
    orden += 1;
  }
  return total;
}

// ============================================================
// VENTA MANUAL (venta en el club, cargada por el admin en Historial)
// ============================================================

// ------------------------------------------------------------
// POST /club/:clubId/tienda/ventas-manuales
// body: {
//   socio_id, producto_id, talle_id?, cantidad,
//   estado_pago ('sin_pago'|'parcial'|'pagado'), monto_pagado?, cuenta_id?,
//   marcar_retirado (bool)
// }
// Crea una reserva con origen = 'manual' para una venta que se hizo en el
// club (no por la app): descuenta stock igual que una reserva normal, pero
// queda directamente en estado "aceptada" (o "retirada" si marcar_retirado)
// y aparece en el Historial de ventas junto con las de la app.
// ------------------------------------------------------------
router.post('/:clubId/tienda/ventas-manuales', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    socio_id,
    producto_id,
    talle_id = null,
    cantidad,
    estado_pago = 'sin_pago',
    monto_pagado: montoBody = null,
    cuenta_id: cuentaIdBody = null,
    marcar_retirado = false,
  } = req.body || {};
  const adminUserId = req.user?.userId || req.user?.id || null;

  const ESTADOS_PAGO_VALIDOS = new Set(['sin_pago', 'parcial', 'pagado']);
  if (!ESTADOS_PAGO_VALIDOS.has(estado_pago)) {
    return res.status(400).json({ ok: false, error: 'estado_pago inválido' });
  }

  const cantidadNum = Number(cantidad);
  if (!socio_id) return res.status(400).json({ ok: false, error: 'Falta seleccionar el socio' });
  if (!producto_id) return res.status(400).json({ ok: false, error: 'Falta seleccionar el producto' });
  if (!Number.isInteger(cantidadNum) || cantidadNum < 1) {
    return res.status(400).json({ ok: false, error: 'Cantidad inválida' });
  }

  try {
    await db.query('BEGIN');

    const rSocio = await db.query(`SELECT id, numero_socio, nombre, apellido FROM socios WHERE id = $1 AND club_id = $2`, [socio_id, clubId]);
    if (!rSocio.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }

    const rProd = await db.query(
      `SELECT id, nombre, precio, stock, tiene_talles FROM tienda_productos WHERE id = $1 AND club_id = $2 FOR UPDATE`,
      [producto_id, clubId]
    );
    if (!rProd.rowCount) {
      await db.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }
    const producto = rProd.rows[0];

    let talleNombre = null;
    if (producto.tiene_talles) {
      if (!talle_id) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Este producto se vende por talle: falta seleccionar el talle' });
      }
      const rTalle = await db.query(
        `SELECT id, talle, stock FROM tienda_producto_talles WHERE id = $1 AND producto_id = $2 FOR UPDATE`,
        [talle_id, producto_id]
      );
      if (!rTalle.rowCount) {
        await db.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'Talle no encontrado' });
      }
      if (rTalle.rows[0].stock < cantidadNum) {
        await db.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: `No hay stock suficiente del talle ${rTalle.rows[0].talle} (disponible: ${rTalle.rows[0].stock})` });
      }
      talleNombre = rTalle.rows[0].talle;
      await db.query(`UPDATE tienda_producto_talles SET stock = stock - $1, updated_at = NOW() WHERE id = $2`, [cantidadNum, talle_id]);
    } else {
      if (producto.stock < cantidadNum) {
        await db.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: `No hay stock suficiente (disponible: ${producto.stock})` });
      }
    }

    await db.query(`UPDATE tienda_productos SET stock = stock - $1, updated_at = NOW() WHERE id = $2`, [cantidadNum, producto_id]);

    const pedidoId = require('crypto').randomUUID();
    const estadoInicial = marcar_retirado ? 'retirada' : 'aceptada';

    const rIns = await db.query(
      `
      INSERT INTO tienda_reservas (
        id, club_id, producto_id, socio_id, cantidad, estado,
        talle_id, talle, pedido_id, origen,
        mensaje_admin, gestionada_por, gestionada_at, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5,
        $6, $7, $8, 'manual',
        'Venta cargada manualmente en el club', $9, NOW(), NOW(), NOW()
      )
      RETURNING id
      `,
      [clubId, producto_id, socio_id, cantidadNum, estadoInicial, talle_id, talleNombre, pedidoId, adminUserId]
    );
    const reservaId = rIns.rows[0].id;

    // Reutiliza exactamente la misma lógica de pago que /estado-pago: si
    // corresponde, genera el ingreso en ingresos_generales con tipo
    // "Tienda" y la cuenta elegida.
    let montoPagado = 0;
    let cuentaFinal = null;
    const total = Number(producto.precio) * cantidadNum;

    if (estado_pago === 'pagado' || estado_pago === 'parcial') {
      if (!cuentaIdBody) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Seleccioná la cuenta / forma de pago' });
      }
      const rCuenta = await db.query(
        `SELECT nombre FROM responsables_gasto WHERE id = $1 AND club_id = $2 AND activo = true`,
        [cuentaIdBody, clubId]
      );
      if (!rCuenta.rowCount) {
        await db.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'La cuenta seleccionada no existe' });
      }
      cuentaFinal = rCuenta.rows[0].nombre;
    }

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
        return res.status(400).json({ ok: false, error: `El monto no puede superar el total ($${total})` });
      }
    }

    let ingresoId = null;
    if (montoPagado > 0) {
      const tipoIngresoId = await getOrCrearTipoIngresoTienda(clubId);
      const socioLabel = `#${rSocio.rows[0].numero_socio ?? '—'} ${rSocio.rows[0].apellido ?? ''} ${rSocio.rows[0].nombre ?? ''}`.trim();
      const observacion = `Tienda (venta manual): ${producto.nombre}${talleNombre ? ` (talle ${talleNombre})` : ''} x${cantidadNum} — ${socioLabel}`;
      const rIng = await db.query(
        `
        INSERT INTO ingresos_generales (id, club_id, tipo_ingreso_id, fecha, monto, observacion, cuenta, created_at, activo)
        VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE, $3, $4, $5, NOW(), true)
        RETURNING id
        `,
        [clubId, tipoIngresoId, montoPagado, observacion, cuentaFinal]
      );
      ingresoId = rIng.rows[0].id;
    }

    await db.query(
      `UPDATE tienda_reservas SET estado_pago = $1, monto_pagado = $2, ingreso_generado_id = $3, updated_at = NOW() WHERE id = $4`,
      [estado_pago, montoPagado, ingresoId, reservaId]
    );

    await db.query('COMMIT');
    return res.status(201).json({ ok: true, reserva_id: reservaId, pedido_id: pedidoId });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ POST tienda/ventas-manuales', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
