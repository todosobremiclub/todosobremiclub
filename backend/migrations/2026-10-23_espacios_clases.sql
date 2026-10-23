-- =====================================================================
-- Espacios y Clases — Release B (Clases con cupo).
-- Plan: claude/espacios-y-clases-plan.md (sección 4.5)
--
-- Requiere haber corrido antes 2026-10-22_espacios_recursos.sql
-- (usa la tabla `recursos`). Idempotente.
-- Ojo: ya existen las tablas `planes_clases_*` (packs de clases por socio);
-- son otra cosa. Estas se llaman `clases` y `clases_*`.
-- Convención: ids UUID, días 0=Domingo..6=Sábado, fechas/horas locales de Argentina.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS clases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  profesor TEXT,                                    -- texto libre (v1)
  recurso_id UUID REFERENCES recursos(id),          -- dónde se dicta (opcional). Si se informa, la clase OCUPA el recurso
  cupo INTEGER CHECK (cupo IS NULL OR cupo > 0),    -- NULL = sin límite
  color TEXT,
  permite_autoinscripcion BOOLEAN NOT NULL DEFAULT FALSE,   -- reservado para v2
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clases_club_idx ON clases (club_id, activo);
CREATE INDEX IF NOT EXISTS clases_recurso_idx ON clases (recurso_id) WHERE recurso_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS clases_horarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clase_id UUID NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('semanal','fecha')),
  dia_semana SMALLINT CHECK (dia_semana BETWEEN 0 AND 6),
  fecha DATE,
  hora_desde TIME NOT NULL,
  hora_hasta TIME NOT NULL,
  vigente_desde DATE,
  vigente_hasta DATE,
  CHECK (hora_desde < hora_hasta),
  CHECK ((tipo = 'semanal' AND dia_semana IS NOT NULL AND fecha IS NULL)
      OR (tipo = 'fecha'   AND fecha IS NOT NULL AND dia_semana IS NULL))
);
CREATE INDEX IF NOT EXISTS clases_horarios_clase_idx ON clases_horarios (clase_id);

-- "Esta semana no hay clase"
CREATE TABLE IF NOT EXISTS clases_excepciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clase_id UUID NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  motivo TEXT,
  UNIQUE (clase_id, fecha)
);

-- Inscriptos (los asigna solo el club)
CREATE TABLE IF NOT EXISTS clases_socios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id),
  clase_id UUID NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
  socio_id UUID NOT NULL REFERENCES socios(id),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','baja')),
  desde DATE NOT NULL DEFAULT CURRENT_DATE,
  hasta DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clases_socios_activo_uq ON clases_socios (clase_id, socio_id) WHERE estado = 'activo';
CREATE INDEX IF NOT EXISTS clases_socios_socio_idx ON clases_socios (socio_id);

COMMIT;

-- Verificación (debería listar las 4 tablas):
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('clases','clases_horarios','clases_excepciones','clases_socios');
