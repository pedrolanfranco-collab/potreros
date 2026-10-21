-- Deshace proximos_hechos.sql: borra la tabla de vencimientos marcados como hechos (y con ella lo marcado).
-- El tablero sigue andando: sin la tabla, muestra todos los vencidos y no ofrece el botón "Ya se hizo".
begin;
drop table if exists public.sanidad_proximos_hechos;
commit;
