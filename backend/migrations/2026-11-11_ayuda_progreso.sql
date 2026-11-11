-- ============================================================
-- Ayuda: avance del asistente "Configuración inicial" por club
-- Fecha: 2026-11-11
-- Una fila por club y guía. Guarda el paso actual, qué pasos se
-- completaron / omitieron y las respuestas Sí/No del asistente.
-- EJECUTAR ANTES de desplegar el backend con este cambio
-- Sin clave foránea a propósito: no depende del nombre/esquema de la tabla de clubes.
-- (si la tabla no existe, el panel igual funciona y guarda el
-- avance solo en el navegador).
-- ============================================================

CREATE TABLE IF NOT EXISTS ayuda_progreso (
  club_id     uuid        NOT NULL,
  guia        text        NOT NULL,
  paso_actual text,
  pasos       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  respuestas  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  completado  boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, guia)
);
