-- Migración: estado de pago de las reservas de la Tienda Online
-- Ejecutar UNA sola vez contra la base Postgres (DATABASE_URL), después de
-- migrations/2026-09-28_tienda_online.sql (que crea tienda_reservas).
--
-- Agrega a cada reserva si el socio está en falta de pago, hizo un pago
-- parcial (seña) o pagó completo. Lo gestiona el admin desde el panel
-- (sección Pendientes -> "Tienda: a retirar" y sección Tienda ->
-- "Historial de ventas").

-- 1) Columna nueva, arranca en 'sin_pago' para no romper reservas existentes.
ALTER TABLE tienda_reservas
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'sin_pago';

-- 2) Restricción de valores válidos (solo se agrega si todavía no existe,
-- para poder re-ejecutar este archivo sin que falle).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tienda_reservas_estado_pago_check'
  ) THEN
    ALTER TABLE tienda_reservas
      ADD CONSTRAINT tienda_reservas_estado_pago_check
      CHECK (estado_pago IN ('sin_pago', 'parcial', 'pagado'));
  END IF;
END $$;
