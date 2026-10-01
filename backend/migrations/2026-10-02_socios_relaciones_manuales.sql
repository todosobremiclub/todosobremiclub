-- Relación manual entre socios: permite, desde el panel admin (ficha del
-- socio > pestaña "Excepciones y Planes"), vincular un socio con otro(s)
-- socio(s) del mismo club sin pasar por un Grupo Familiar. Se usa, junto
-- con grupos_familiares/grupos_familiares_miembros, para armar el selector
-- "Cambiar de socio" dentro de la app (ver claude/relacionar-socios-plan.md).
--
-- La relación es SIEMPRE mutua: al guardar desde el panel se insertan las
-- dos filas (A→B y B→A) para que cada lado pueda consultar "a quién veo"
-- con un simple WHERE socio_id = $1, sin necesidad de UNION.
CREATE TABLE IF NOT EXISTS socios_relaciones_manuales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

  socio_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  socio_relacionado_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ux_socios_relaciones_par UNIQUE (socio_id, socio_relacionado_id),
  CONSTRAINT ck_socios_relaciones_no_self CHECK (socio_id <> socio_relacionado_id)
);

CREATE INDEX IF NOT EXISTS idx_socios_relaciones_socio_id ON socios_relaciones_manuales (socio_id);
CREATE INDEX IF NOT EXISTS idx_socios_relaciones_club_id ON socios_relaciones_manuales (club_id);
