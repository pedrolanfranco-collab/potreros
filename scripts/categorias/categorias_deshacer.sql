-- =====================================================================================
-- DESHACER categorias.sql: saca la funcion, las dos tablas y las marcas "Ya se hizo" que ese script copio con el
-- nombre del patron (las reconoce porque tienen la misma fecha, sanidad y marcado_en que una marca con nombre viejo).
-- Las marcas originales no se tocan. Despues de esto, actualizar_sanidad_supabase.py sube los nombres sin traducir
-- (no falla: si no puede leer categorias_alias, avisa en su log y sigue como antes).
-- =====================================================================================

begin;

delete from public.sanidad_proximos_hechos n
where exists (select 1 from public.categorias c where c.nombre = n.categoria)
  and exists (select 1 from public.sanidad_proximos_hechos o
              where o.id <> n.id and o.establecimiento = n.establecimiento and o.sanidad = n.sanidad
                and o.fecha_prevista = n.fecha_prevista and o.marcado_en = n.marcado_en
                and public.categoria_patron(o.categoria) = n.categoria and o.categoria <> n.categoria);

drop function if exists public.categoria_patron(text);
drop table if exists public.categorias_alias;
drop table if exists public.categorias;

commit;
