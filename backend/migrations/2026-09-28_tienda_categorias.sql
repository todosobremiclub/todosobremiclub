-- Tipificación de productos de la Tienda Online: tabla de categorías
-- configurable por club (panel Configuración, debajo de "Cuentas $"), y
-- columna en tienda_productos para asignarle una categoría a cada producto
-- al publicarlo o editarlo.
--
-- Ejecutar una sola vez contra la base de Postgres del backend.

CREATE TABLE IF NOT EXISTS tienda_categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL,
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tienda_categorias_club_nombre_uq UNIQUE (club_id, nombre)
);

ALTER TABLE tienda_productos
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES tienda_categorias(id);
