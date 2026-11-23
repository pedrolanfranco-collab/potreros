-- Deshace crecimiento_pasto.sql: borra la tabla (y sus datos de iPasto, que se pueden volver a bajar).
begin;
drop table if exists public.crecimiento_pasto;
commit;
