-- Deshace sesiones_baston.sql. Solo borra la tabla nueva; no toca nada mas.
drop policy if exists sesiones_baston_select_clave on public.sesiones_baston;
drop table if exists public.sesiones_baston;
