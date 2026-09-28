-- Migración: módulo "Tienda Online" (catálogo de productos por club + reservas de socios)
-- Ejecutar UNA sola vez contra la base Postgres (DATABASE_URL), por ejemplo con psql
-- o desde el panel de Render.
--
-- ⚠️ clubs.id y socios.id son UUID en este proyecto (confirmado en
-- migrations/2026-08-14_bienvenida_envios_programados.sql). users.id se
-- asume también UUID por consistencia con el resto del esquema; si al
-- correr esto da error de tipo en la FK de gestionada_por, confirmar con
-- \d users en psql y ajustar esa columna a INTEGER si corresponde.

-- 1) Flag por club (mismo patrón que whatsapp_habilitado / mp_habilitado)
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS tienda_habilitada BOOLEAN NOT NULL DEFAULT false;

-- 2) Catálogo de productos
CREATE TABLE IF NOT EXISTS tienda_productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  precio NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  imagen_url TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tienda_productos_club ON tienda_productos(club_id);

-- 3) Reservas de socios
CREATE TABLE IF NOT EXISTS tienda_reservas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES tienda_productos(id) ON DELETE CASCADE,
  socio_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  cantidad INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','aceptada','rechazada','retirada','cancelada')),
  mensaje_admin TEXT,
  gestionada_por UUID REFERENCES users(id),
  gestionada_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tienda_reservas_club_estado ON tienda_reservas(club_id, estado);
CREATE INDEX IF NOT EXISTS idx_tienda_reservas_socio ON tienda_reservas(socio_id);
