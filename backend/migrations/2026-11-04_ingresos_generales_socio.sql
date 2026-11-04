-- ============================================================
-- Otros ingresos: socio asociado (opcional)
-- Fecha: 2026-11-04
-- Permite asignar un ingreso general ("otros ingresos") a un socio y
-- verlo después en Reportes > Ingresos por socio.
-- EJECUTAR ANTES de desplegar el backend con este cambio.
-- (Requiere además haber corrido 2026-11-03_tienda_reserva_ingresos.sql)
-- ============================================================

ALTER TABLE ingresos_generales
  ADD COLUMN IF NOT EXISTS socio_id uuid NULL REFERENCES socios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingresos_generales_socio
  ON ingresos_generales (club_id, socio_id)
  WHERE socio_id IS NOT NULL;
