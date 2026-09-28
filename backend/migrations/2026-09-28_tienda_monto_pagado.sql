-- Migración: monto abonado en las reservas de la Tienda Online + vínculo
-- con los reportes financieros (tabla ingresos_generales).
-- Ejecutar UNA sola vez contra la base Postgres, después de
-- migrations/2026-09-28_tienda_estado_pago.sql.
--
-- monto_pagado: cuánto pagó el socio hasta ahora (0 si "sin_pago", el total
-- de la reserva si "pagado", o lo que el admin cargue si "parcial").
--
-- ingreso_generado_id: apunta a la fila de ingresos_generales que representa
-- este cobro, para que aparezca en los reportes financieros (Ingresos por
-- tipo, Ingresos vs Gastos, etc.) bajo el tipo de ingreso "Tienda". Se
-- actualiza en vez de duplicarse cada vez que cambia el estado de pago de
-- la misma reserva.

ALTER TABLE tienda_reservas
  ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE tienda_reservas
  ADD COLUMN IF NOT EXISTS ingreso_generado_id UUID REFERENCES ingresos_generales(id);
