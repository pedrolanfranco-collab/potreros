-- Fase reproductiva (tacto y DAO) por animal, 3/11/2026.
-- La app muestra solo TACTO y DAO. Si el Lector publica eventos IATF en repro, la app los ignora.
-- Correr en el SQL Editor de Supabase ANTES de publicar con
-- publicar_animales.py (si falta la columna el publicador la saca solo y avisa,
-- pero la app PC queda sin el dato).
--
-- repro: [{f:'2026-06-11', t:'IATF', e:'D0', r:'', p:'IMPLANTE + BENZOATO HC', s:'1089_DIA_1_IATF', o:'8'}]
--   f fecha, t tipo (TACTO | DAO | IATF), e etapa de IATF (D0 | D8 | IA, vacia si no es IATF),
--   r resultado normalizado (PRENEZ_GRANDE, PRENEZ_MEDIA, PRENEZ_CHICA, PRENEZ, VACIA, DUDA,
--   CICLANDO, ANESTRO_SUP, ANESTRO_PROF, ANESTRO; vacio en D0/D8/IA), p productos aplicados,
--   s nombre de la sesion (archivo del baston sin carpeta ni extension), o potrero del baston
--   (puede venir vacio).
-- estado_repro: estado actual (ej. PRENEZ_GRANDE, VACIA, CICLANDO, IATF_D0, IATF_D8, IATF_IA).
-- repro_fecha: fecha del evento que fijo ese estado.
-- La RLS ya existe para la tabla: no se toca.

ALTER TABLE animales_caravana
  ADD COLUMN IF NOT EXISTS repro jsonb,
  ADD COLUMN IF NOT EXISTS estado_repro text,
  ADD COLUMN IF NOT EXISTS repro_fecha date;
