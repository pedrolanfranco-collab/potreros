-- Historial de pesadas por animal (gestion de pesadas, 2/10/2026).
-- Correr en el SQL Editor de Supabase ANTES de publicar con
-- publicar_animales.py (si falta la columna el publicador la saca solo y avisa,
-- pero el celular queda sin el dato).
--
-- pesadas: [{f:'2026-03-02', p:312, g:0.85|null, s:true|false, o:'13', c:'Vaquillona', a:'1043_VAQ_G4'}]
--   f fecha, p peso kg, g ganancia diaria del intervalo (kg/dia) o null,
--   s pesada sospechosa (fuera de 80-900 kg), o potrero cargado en el baston
--   (puede venir vacio), c categoria en esa pesada, a nombre de la sesion
--   (archivo del baston sin carpeta ni extension).
-- La RLS ya existe para la tabla (politica ALL para anon): no se toca.

ALTER TABLE animales_caravana
  ADD COLUMN IF NOT EXISTS pesadas jsonb,
  ADD COLUMN IF NOT EXISTS ganancia_diaria numeric,
  ADD COLUMN IF NOT EXISTS pesadas_totales int;
