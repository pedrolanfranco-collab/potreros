-- =====================================================================================
-- DESHACER la Fase 2 (carencia protegida): vuelve a los permisos de antes del 10/10/2026.
--
-- Usa el respaldo `auditoria_politicas_antes_fase2` que guardo fase2_carencia.sql, asi que
-- solo sirve si ese script llego a correr. Devuelve a la llave publica la escritura en
-- productos_catalogo, animales_caravana, sanidad_ultimos y sanidad_proximos, o sea que
-- REABRE el riesgo que la Fase 2 cerro: usarlo solo si algo dejo de funcionar y se necesita
-- volver atras mientras se arregla.
--
-- El trigger de `creado_en` tambien se quita. La politica de SELECT que creo el script
-- (`<tabla>_select_anon`) se deja: es inofensiva.
-- =====================================================================================

begin;

grant insert, update, delete on table
  public.productos_catalogo,
  public.animales_caravana,
  public.sanidad_ultimos,
  public.sanidad_proximos
to anon;

do $$
declare
  r record;
  usando text;
  con_check text;
begin
  for r in select * from public.auditoria_politicas_antes_fase2 order by guardado_en loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = r.tablename and policyname = r.policyname
    ) then
      usando := case when r.cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')
                     then ' using (' || coalesce(r.qual, 'true') || ')' else '' end;
      con_check := case when r.cmd in ('INSERT', 'UPDATE', 'ALL')
                        then ' with check (' || coalesce(r.with_check, r.qual, 'true') || ')' else '' end;
      execute format('create policy %I on public.%I as %s for %s to %s%s%s',
                     r.policyname, r.tablename, lower(coalesce(r.permissive, 'PERMISSIVE')), r.cmd,
                     array_to_string(r.roles, ', '), usando, con_check);
    end if;
  end loop;
end
$$;

drop trigger if exists eventos_sync_fijar_creado_en on public.eventos_sync;
drop function if exists public.eventos_sync_fijar_creado_en();

select tablename as tabla, policyname as politica, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('productos_catalogo', 'animales_caravana', 'sanidad_ultimos', 'sanidad_proximos')
order by tablename, cmd;

commit;
