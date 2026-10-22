-- =====================================================================
-- Espacios y Clases — Release A (Espacios: recursos, disponibilidad,
-- reservas y abonos).  Plan: claude/espacios-y-clases-plan.md
--
-- Idempotente: se puede correr más de una vez sin romper nada.
-- NO incluye las tablas de Clases (van en la migración del Release B).
-- Convención del proyecto: ids UUID, días de semana 0=Domingo..6=Sábado,
-- fechas/horas locales de Argentina (DATE + TIME sin zona horaria).
-- =====================================================================

BEGIN;

-- 1) Flag por club (lo activa el superadmin)
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS espacios_habilitado BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Recursos (canchas, salones, espacios)
CREATE TABLE IF NOT EXISTS recursos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'cancha',                    -- 'cancha' | 'salon' | 'espacio' | 'otro'
  descripcion TEXT,
  capacidad INTEGER,                                      -- informativo (personas)
  imagen_url TEXT,
  duracion_turno_min INTEGER NOT NULL DEFAULT 60
    CHECK (duracion_turno_min BETWEEN 15 AND 720),
  anticipacion_min_horas INTEGER NOT NULL DEFAULT 0       -- 0 = se puede reservar hasta la hora de inicio
    CHECK (anticipacion_min_horas >= 0),
  anticipacion_max_dias INTEGER NOT NULL DEFAULT 30
    CHECK (anticipacion_max_dias BETWEEN 1 AND 365),
  cancelar_hasta_horas INTEGER NOT NULL DEFAULT 12        -- el socio puede cancelar hasta X hs antes
    CHECK (cancelar_hasta_horas >= 0),
  reservable_app BOOLEAN NOT NULL DEFAULT TRUE,           -- FALSE = solo lo carga el club desde el panel
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recursos_club_idx ON recursos (club_id, activo);

-- 3) Disponibilidad: regular (semanal), día específico (fecha) y bloqueos
CREATE TABLE IF NOT EXISTS recursos_disponibilidad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id),
  recurso_id UUID NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
  modo TEXT NOT NULL DEFAULT 'disponible' CHECK (modo IN ('disponible','bloqueado')),
  tipo TEXT NOT NULL CHECK (tipo IN ('semanal','fecha')),
  dia_semana SMALLINT CHECK (dia_semana BETWEEN 0 AND 6),   -- solo tipo 'semanal'
  fecha DATE,                                               -- solo tipo 'fecha'
  hora_desde TIME,                                          -- NULL en 'bloqueado' = todo el día
  hora_hasta TIME,
  vigente_desde DATE,                                       -- solo 'semanal' (opcional)
  vigente_hasta DATE,                                       -- solo 'semanal' (opcional)
  motivo TEXT,                                              -- ej. "Feriado", "Mantenimiento"
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((tipo = 'semanal' AND dia_semana IS NOT NULL AND fecha IS NULL)
      OR (tipo = 'fecha'   AND fecha IS NOT NULL AND dia_semana IS NULL)),
  CHECK (modo = 'bloqueado'
      OR (hora_desde IS NOT NULL AND hora_hasta IS NOT NULL AND hora_desde < hora_hasta))
);
CREATE INDEX IF NOT EXISTS recursos_disp_idx ON recursos_disponibilidad (recurso_id, activo);

-- 4) Reservas de recursos (las pide el socio desde la app o las carga el club)
CREATE TABLE IF NOT EXISTS recursos_reservas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id),
  recurso_id UUID NOT NULL REFERENCES recursos(id),
  socio_id UUID REFERENCES socios(id),                      -- NULL si la carga el club para un externo
  nombre_externo TEXT,
  contacto_externo TEXT,
  fecha DATE NOT NULL,
  hora_desde TIME NOT NULL,
  hora_hasta TIME NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','aceptada','rechazada','cancelada','vencida')),
  origen TEXT NOT NULL DEFAULT 'app' CHECK (origen IN ('app','panel')),
  comentario_socio TEXT,
  mensaje_admin TEXT,
  gestionada_por UUID REFERENCES users(id),
  gestionada_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hora_desde < hora_hasta),
  CHECK (socio_id IS NOT NULL OR nombre_externo IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS recursos_reservas_rec_fecha_idx
  ON recursos_reservas (recurso_id, fecha) WHERE estado IN ('pendiente','aceptada');
CREATE INDEX IF NOT EXISTS recursos_reservas_club_estado_idx ON recursos_reservas (club_id, estado);
CREATE INDEX IF NOT EXISTS recursos_reservas_socio_idx ON recursos_reservas (socio_id);

-- 5) Abonos: reserva fija semanal, sin fecha de finalización
--    (no se guardan filas por semana: las ocurrencias se calculan al vuelo)
CREATE TABLE IF NOT EXISTS recursos_abonos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id),
  recurso_id UUID NOT NULL REFERENCES recursos(id),
  socio_id UUID REFERENCES socios(id),                      -- NULL si el abono es de un externo / equipo
  nombre_externo TEXT,
  contacto_externo TEXT,
  dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_desde TIME NOT NULL,
  hora_hasta TIME NOT NULL,
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,                                       -- NULL = sin fecha de finalización
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','baja')),
  notas TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hora_desde < hora_hasta),
  CHECK (socio_id IS NOT NULL OR nombre_externo IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS recursos_abonos_rec_idx
  ON recursos_abonos (recurso_id, dia_semana) WHERE estado = 'activo';
CREATE INDEX IF NOT EXISTS recursos_abonos_socio_idx ON recursos_abonos (socio_id);

-- Fechas en las que un abono NO ocupa el turno (vacaciones, "esta semana no viene")
CREATE TABLE IF NOT EXISTS recursos_abonos_excepciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  abono_id UUID NOT NULL REFERENCES recursos_abonos(id) ON DELETE CASCADE,
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE NOT NULL,                                -- igual a fecha_desde si es un solo día
  motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (fecha_hasta >= fecha_desde)
);
CREATE INDEX IF NOT EXISTS recursos_abonos_exc_idx ON recursos_abonos_excepciones (abono_id);

COMMIT;

-- Verificación rápida (debería listar las 5 tablas y el flag):
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('recursos','recursos_disponibilidad','recursos_reservas',
--                       'recursos_abonos','recursos_abonos_excepciones');
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'clubs' AND column_name = 'espacios_habilitado';
