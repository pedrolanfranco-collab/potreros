-- =====================================================================================
-- DESHACER la Fase 6 (endurecimiento): vuelve los permisos, las politicas, los defaults y las funciones a como
-- estaban antes de fase6_endurecer.sql, y saca el tope de tamano de eventos_sync.
--
-- Usa los respaldos `auditoria_privilegios_antes_fase6` y `auditoria_politicas_antes_fase6` que guardo
-- fase6_endurecer.sql, asi que solo sirve si ese script llego a correr. REABRE la lectura de compras y precios con la
-- llave publica: usarlo solo si algo dejo de funcionar y se necesita volver atras mientras se arregla.
-- Todo en una transaccion. Probado con probar_fase6.js.
-- =====================================================================================

begin;

do $$
begin
  if not exists (select 1 from public.auditoria_privilegios_antes_fase6) then
    raise exception 'No hay respaldo de permisos (auditoria_privilegios_antes_fase6 esta vacia): no se toca nada';
  end if;
end
$$;

-- 1. Permisos de tabla, vista y secuencia de anon y authenticated, tal cual estaban.
do $$
declare
  r record;
begin
  for r in
    select a.objeto, a.tipo, a.rol, a.privilegio
    from public.auditoria_privilegios_antes_fase6 a
    join pg_class c on c.relname = a.objeto and c.relnamespace = 'public'::regnamespace
  loop
    if r.tipo = 'S' then
      execute format('grant %s on sequence public.%I to %I', r.privilegio, r.objeto, r.rol);
    else
      execute format('grant %s on table public.%I to %I', r.privilegio, r.objeto, r.rol);
    end if;
  end loop;
end
$$;

-- 2. Politicas de compras y precios.
do $$
declare
  r record;
begin
  for r in
    select * from public.auditoria_politicas_antes_fase6
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tablename and policyname = r.policyname) then
      execute format('create policy %I on public.%I as %s for %s to %s%s%s',
        r.policyname, r.tablename, r.permissive, r.cmd,
        (select string_agg(quote_ident(x), ', ') from unnest(r.roles) x),
        case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
        case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
    end if;
  end loop;
end
$$;

-- 3. Tope de tamano.
alter table public.eventos_sync drop constraint if exists eventos_sync_tamanos;

-- 4. Defaults de lo nuevo en public (como estaban: todo para anon y authenticated).
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;

-- 5. Funciones.
alter function public.stock_insumos_app() set search_path = public;
grant execute on function public.rls_auto_enable() to public, anon, authenticated;

commit;
