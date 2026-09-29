-- Tienda Online: talles con stock por talle, carrito (pedidos con varios
-- productos), ventas cargadas a mano por el admin, y permitir marcar
-- "retirado" aunque no esté pagado (con aviso, ver tiendaRoutes.js).
--
-- Ejecutar una sola vez contra la base de Postgres del backend, DESPUÉS de
-- 2026-09-28_tienda_categorias.sql (usa tienda_productos y tienda_reservas
-- ya existentes).

-- 1) Productos: flag de si el producto se vende por talle. Si es false, se
--    sigue usando tienda_productos.stock como hasta ahora (compatibilidad
--    con productos ya cargados).
ALTER TABLE tienda_productos
  ADD COLUMN IF NOT EXISTS tiene_talles BOOLEAN NOT NULL DEFAULT false;

-- 2) Talles por producto, cada uno con su propio stock.
CREATE TABLE IF NOT EXISTS tienda_producto_talles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID NOT NULL REFERENCES tienda_productos(id) ON DELETE CASCADE,
  talle TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tienda_producto_talles_uq UNIQUE (producto_id, talle)
);

CREATE INDEX IF NOT EXISTS idx_tienda_producto_talles_producto
  ON tienda_producto_talles(producto_id);

-- 3) Reservas: a qué talle corresponden (si el producto tiene talles), y a
--    qué "pedido" (carrito) pertenecen — varias reservas compradas juntas
--    comparten el mismo pedido_id y se gestionan como una sola unidad
--    (aceptar/rechazar/marcar retirado aplican a todas las líneas del pedido).
ALTER TABLE tienda_reservas
  ADD COLUMN IF NOT EXISTS talle_id UUID REFERENCES tienda_producto_talles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS talle TEXT,
  ADD COLUMN IF NOT EXISTS pedido_id UUID,
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'app';
-- origen: 'app' (reserva hecha por el socio desde la app) | 'manual' (venta
-- cargada a mano por el admin para alguien que compró en el club).

-- Cada reserva ya existente pasa a ser su propio "pedido" de un solo
-- producto (no rompe nada de lo que ya funciona).
UPDATE tienda_reservas SET pedido_id = id WHERE pedido_id IS NULL;

ALTER TABLE tienda_reservas ALTER COLUMN pedido_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tienda_reservas_pedido ON tienda_reservas(pedido_id);

ALTER TABLE tienda_reservas
  ADD CONSTRAINT tienda_reservas_origen_chk CHECK (origen IN ('app', 'manual'));
