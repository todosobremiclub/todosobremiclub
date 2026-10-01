-- Migración: monto opcional por defecto en Tipos de gasto y Tipos de ingreso.
-- Ejecutar UNA sola vez contra la base Postgres (DATABASE_URL).
--
-- Permite configurar, para cada tipo de gasto/ingreso, un monto habitual
-- (opcional). Al registrar un gasto o un ingreso y elegir el tipo, el
-- panel web completa el campo "Monto" automáticamente con ese valor, pero
-- se puede modificar libremente antes de guardar.

ALTER TABLE tipos_gasto   ADD COLUMN IF NOT EXISTS monto NUMERIC(12,2);
ALTER TABLE tipos_ingreso ADD COLUMN IF NOT EXISTS monto NUMERIC(12,2);
