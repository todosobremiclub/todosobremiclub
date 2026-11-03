-- ============================================================
-- Tienda: cada cobro (seña, saldo) es un ingreso propio
-- Fecha: 2026-11-03
-- Motivo: al pasar una reserva de "parcial" a "pagado" se pisaba el mismo
-- ingreso conservando la fecha de la seña, y el saldo no aparecía en los
-- reportes del mes en que se cobró. Ahora una reserva puede tener varios
-- ingresos en ingresos_generales; esta tabla los enlaza.
-- EJECUTAR ANTES de desplegar el backend con este cambio.
-- ============================================================

CREATE TABLE IF NOT EXISTS tienda_reserva_ingresos (
  ingreso_id uuid PRIMARY KEY REFERENCES ingresos_generales(id) ON DELETE CASCADE,
  reserva_id uuid NOT NULL REFERENCES tienda_reservas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tienda_reserva_ingresos_reserva
  ON tienda_reserva_ingresos (reserva_id);

-- Enlaza los ingresos que ya existían (1 por reserva, en ingreso_generado_id)
INSERT INTO tienda_reserva_ingresos (ingreso_id, reserva_id)
SELECT r.ingreso_generado_id, r.id
FROM tienda_reservas r
JOIN ingresos_generales ig ON ig.id = r.ingreso_generado_id
WHERE r.ingreso_generado_id IS NOT NULL
ON CONFLICT DO NOTHING;
