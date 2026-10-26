-- 2026-10-27 · Categorías deportivas con rango de edad (opcional)
--
-- 1) categorias_deportivas.edad_desde / edad_hasta (ambas opcionales, inclusivas):
--      MENOR  0 a 11    -> edad_desde = 0,  edad_hasta = 11
--      CADETE 12 a 17   -> edad_desde = 12, edad_hasta = 17
--      MAYOR  18 o más  -> edad_desde = 18, edad_hasta = NULL (sin tope)
--    Si ambas son NULL la categoría NO es por edad (se asigna a mano, como hasta ahora).
--
-- 2) socios.categoria_manual: true cuando el admin eligió a mano una categoría
--    distinta a la que le corresponde por edad. Esos socios NO se mueven solos.
--
-- Es idempotente: se puede correr más de una vez sin problemas.

ALTER TABLE categorias_deportivas
  ADD COLUMN IF NOT EXISTS edad_desde integer,
  ADD COLUMN IF NOT EXISTS edad_hasta integer;

ALTER TABLE socios
  ADD COLUMN IF NOT EXISTS categoria_manual boolean NOT NULL DEFAULT false;
