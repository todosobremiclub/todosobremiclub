-- =====================================================================
-- Recursos — varios socios por reserva y por abono (titular + participantes)
-- Idempotente. Ejecutar DESPUÉS de 2026-10-22_espacios_recursos.sql.
--   - El titular sigue en recursos_reservas.socio_id / recursos_abonos.socio_id.
--   - Los participantes (socios adicionales) van en estas tablas.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS recursos_reservas_socios (
  reserva_id UUID NOT NULL REFERENCES recursos_reservas(id) ON DELETE CASCADE,
  socio_id   UUID NOT NULL REFERENCES socios(id)            ON DELETE CASCADE,
  club_id    UUID NOT NULL REFERENCES clubs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reserva_id, socio_id)
);
CREATE INDEX IF NOT EXISTS recursos_reservas_socios_socio_idx ON recursos_reservas_socios (socio_id);

CREATE TABLE IF NOT EXISTS recursos_abonos_socios (
  abono_id   UUID NOT NULL REFERENCES recursos_abonos(id) ON DELETE CASCADE,
  socio_id   UUID NOT NULL REFERENCES socios(id)          ON DELETE CASCADE,
  club_id    UUID NOT NULL REFERENCES clubs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (abono_id, socio_id)
);
CREATE INDEX IF NOT EXISTS recursos_abonos_socios_socio_idx ON recursos_abonos_socios (socio_id);

COMMIT;

-- Verificación:
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('recursos_reservas_socios','recursos_abonos_socios');
