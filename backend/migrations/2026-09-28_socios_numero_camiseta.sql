-- Migración: número de camiseta del socio.
-- Ejecutar UNA sola vez contra la base Postgres (DATABASE_URL).
--
-- Se guarda como TEXT (no INTEGER) para admitir camisetas con letras o
-- ceros a la izquierda (por ejemplo "00" o "GK"), igual criterio que
-- obra_social_numero en esta misma tabla.

ALTER TABLE socios ADD COLUMN IF NOT EXISTS numero_camiseta TEXT;
