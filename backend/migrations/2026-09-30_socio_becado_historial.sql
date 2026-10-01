-- Migración: historial de cambios de "becado" por socio.
-- Ejecutar UNA sola vez contra la base Postgres (DATABASE_URL).
--
-- Objetivo: hasta ahora los reportes que dependen de si un socio estaba
-- becado (Cuotas impagas por mes, Monto esperado mensual, Esperado vs
-- Recaudado) consultaban el campo socios.becado EN VIVO, sin importar de
-- qué mes se tratara el reporte. Eso significa que si hoy le sacás el
-- tilde de becado a un socio que estuvo becado en Abril/Mayo/Junio, al
-- volver a mirar esos meses el sistema lo trata como si NUNCA hubiese
-- estado becado, y esos reportes pasados cambian solos.
--
-- Esta tabla guarda, con fecha, cada cambio de becado de cada socio, para
-- que los reportes puedan reconstruir "¿estaba becado en tal mes?" en vez
-- de usar siempre el valor actual. No reconstruye el pasado anterior a
-- esta migración (eso no se puede recuperar porque nunca se guardó), pero
-- de acá en adelante todo cambio queda registrado con su fecha.

CREATE TABLE IF NOT EXISTS socio_becado_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id UUID NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  club_id UUID NOT NULL,
  becado BOOLEAN NOT NULL,
  -- Fecha a partir de la cual rige este valor de "becado" (inclusive).
  -- Se usa a nivel mes: un reporte de un mes/año consulta el último
  -- registro con vigente_desde <= último día de ese mes.
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para reconstruir rápido "el último estado de becado antes de tal fecha,
-- para tal socio" (la consulta que van a usar los reportes).
CREATE INDEX IF NOT EXISTS idx_socio_becado_historial_socio_fecha
  ON socio_becado_historial (socio_id, vigente_desde DESC);

CREATE INDEX IF NOT EXISTS idx_socio_becado_historial_club
  ON socio_becado_historial (club_id);
