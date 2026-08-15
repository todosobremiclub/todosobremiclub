-- Migración: cola de envíos programados para la bienvenida por email de socios
-- Ejecutar UNA sola vez contra la base Postgres (DATABASE_URL), por ejemplo con psql
-- o desde el panel de Render.
--
-- ⚠️ Antes de correr esto, confirmar que socios.id y clubs.id son UUID
-- (ej. con \d socios en psql). En este proyecto ya se usa gen_random_uuid()
-- para otras tablas de socios, así que debería coincidir.

CREATE TABLE IF NOT EXISTS bienvenida_envios_programados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL,
  socio_id UUID NOT NULL,
  lote INTEGER NOT NULL,
  programado_para TIMESTAMP NOT NULL,
  enviado_at TIMESTAMP NULL,
  error TEXT NULL,
  creado_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bienvenida_envios_pendientes
  ON bienvenida_envios_programados (programado_para)
  WHERE enviado_at IS NULL AND error IS NULL;
