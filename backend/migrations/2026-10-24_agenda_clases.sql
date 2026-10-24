-- =====================================================================
-- Agenda: Clases / entrenamientos con socios asignados.
--
-- Una clase es una actividad de la Agenda (agenda_actividades) con
-- tipo = 'clase'. Puede ser de un día puntual o periódica (reutiliza la
-- recurrencia de la Agenda) y se le asignan uno o varios socios, que la
-- ven en la app en "Mis clases / entrenamientos".
--
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

BEGIN;

-- 1) Si agenda_actividades.tipo tiene un CHECK que solo admite 'actividad' / 'evento',
--    se reemplaza por uno que también admite 'clase'. (No toca los CHECK de
--    recurrencia_tipo: el patrón exige que "tipo" no esté precedido por "_".)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'agenda_actividades'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ '(^|[^_a-z])tipo([^_a-z]|$)'
       AND pg_get_constraintdef(oid) !~ 'recurrencia'
  LOOP
    EXECUTE format('ALTER TABLE agenda_actividades DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE agenda_actividades DROP CONSTRAINT IF EXISTS agenda_actividades_tipo_check;
ALTER TABLE agenda_actividades
  ADD CONSTRAINT agenda_actividades_tipo_check CHECK (tipo IN ('actividad', 'evento', 'clase'));

-- 2) Socios asignados a una clase.
CREATE TABLE IF NOT EXISTS agenda_actividades_socios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id),
  actividad_id UUID NOT NULL REFERENCES agenda_actividades(id) ON DELETE CASCADE,
  socio_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actividad_id, socio_id)
);
CREATE INDEX IF NOT EXISTS agenda_actividades_socios_socio_idx ON agenda_actividades_socios (socio_id);

COMMIT;

-- Verificación:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'agenda_actividades'::regclass AND contype = 'c';
-- SELECT COUNT(*) FROM agenda_actividades_socios;
