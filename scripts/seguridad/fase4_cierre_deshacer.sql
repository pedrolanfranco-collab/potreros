-- =====================================================================================
-- DESHACER el cierre de la Fase 4 (Release 2): vuelve a las politicas y permisos de anon de antes.
--
-- Usa los respaldos `auditoria_politicas_antes_fase4` y `auditoria_privilegios_antes_fase4` que guardo
-- fase4_cierre.sql, asi que solo sirve si ese script llego a correr. REABRE lo que el cierre cerro (la llave
-- publica vuelve a poder leer y escribir como antes del cierre): usarlo solo si algo dejo de funcionar y se
-- necesita volver atras mientras se arregla.
--
-- No toca el release 1 (funciones, claves y equipos vistos siguen): la app sigue mandando la clave.
-- =====================================================================================

begin;

do $$
begin
  if not exists (select 1 from public.auditoria_politicas_antes_fase4) then
    raise exception 'No hay respaldo de politicas (auditoria_politicas_antes_fase4 esta vacia): no se toca nada';
  end if;
end
$$;

-- 1. Fuera las politicas del cierre (y cualquier otra que alcance a anon en estas tablas).
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('eventos_sync', 'stock_potreros', 'sanidad_carga', 'sanidad_carga_maria_laura',
                        'sanidad_carga_pone_chico', 'animales_caravana', 'productos_catalogo',
                        'maestros_dicose', 'sanidad_ultimos', 'sanidad_proximos', 'sanidad_proximos_hechos')
      and roles && array['anon', 'public']::name[]
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

-- 2. Las de antes, tal como estaban.
do $$
declare
  r record;
  usando text;
  con_check text;
begin
  for r in select * from public.auditoria_politicas_antes_fase4 order by guardado_en loop
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

-- 3. Permisos de tabla de anon: los que tenia.
revoke select, insert, update, delete on table
  public.eventos_sync, public.stock_potreros, public.sanidad_carga, public.sanidad_carga_maria_laura,
  public.sanidad_carga_pone_chico, public.animales_caravana, public.productos_catalogo,
  public.maestros_dicose, public.sanidad_ultimos, public.sanidad_proximos,
  public.sanidad_proximos_hechos
from anon;

do $$
declare
  r record;
begin
  for r in select tablename, privilegio from public.auditoria_privilegios_antes_fase4 loop
    execute format('grant %s on table public.%I to anon', r.privilegio, r.tablename);
  end loop;
end
$$;

-- 5. Fotos: las politicas de antes del cierre (fotos_reportes.sql), abiertas a las carpetas de los 3 campos.
drop policy if exists fotos_reportes_insert on storage.objects;
create policy fotos_reportes_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'fotos-reportes' and (storage.foldername(name))[1] in ('la_vuelta', 'maria_laura', 'pone_chico'));
drop policy if exists fotos_reportes_select on storage.objects;
create policy fotos_reportes_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'fotos-reportes' and (storage.foldername(name))[1] in ('la_vuelta', 'maria_laura', 'pone_chico'));

-- 4. Fuera lo que agrego la version revisada del cierre (21/10/2026). Ya no hay politicas que las usen.
drop function if exists public.establecimientos_permitidos();
drop table if exists private.campos_abiertos;

select tablename as tabla, policyname as politica, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('eventos_sync', 'stock_potreros', 'sanidad_carga', 'sanidad_carga_maria_laura',
                    'sanidad_carga_pone_chico', 'animales_caravana', 'productos_catalogo',
                    'maestros_dicose', 'sanidad_ultimos', 'sanidad_proximos', 'sanidad_proximos_hechos')
order by tablename, cmd;

commit;
