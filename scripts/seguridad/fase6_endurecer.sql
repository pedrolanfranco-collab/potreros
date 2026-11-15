-- =====================================================================================
-- Auditoria del 12/11/2026 -- FASE 6: ENDURECIMIENTO (hallazgos 3, 6, 8 y 15).
--
-- Lo corre Pedro (o el conector de Supabase, a pedido de Pedro). Todo en UNA transaccion: si algo falla, no queda
-- nada aplicado. Se puede correr dos veces (los respaldos se guardan solo la primera). Se deshace con
-- fase6_endurecer_deshacer.sql. Probado contra un Postgres real con probar_fase6.js (PGlite, sin tocar Supabase).
--
-- NO cambia nada de lo que usan las apps, los tableros, Hermes ni los scripts de la PC:
--   * las apps leen y escriben con la llave publica + la clave del campo, y eso queda igual;
--   * los scripts de la PC usan la clave privada (service_role), que no pasa por nada de esto;
--   * el stock de insumos se lee por la funcion stock_insumos_app() (SECURITY DEFINER), que sigue andando.
--
-- Que hace:
--   1. Compras y precios cerrados a la llave publica (hallazgo 6). `comprobantes`, `proveedores`, `precios_vet`,
--      `cotizaciones`, `alias_productos` e `insumos_alias` (y las vistas que los leen: `precio_ultimo`,
--      `precio_vigente`, `comparacion_catalogo`, `movimientos_insumo`, `stock_insumos`) se leian con la llave
--      publica, que esta en este repo publico. Se borran las politicas "lectura_anon" y anon/authenticated pierden
--      todo permiso sobre esas tablas y vistas. En las 24 h previas (13-14/11/2026) los registros de Supabase no
--      muestran ninguna lectura directa de estas tablas: solo la RPC stock_insumos_app.
--   2. Tope de tamano en `eventos_sync` (hallazgo 3): `detalle` hasta 16 KB (el mas grande guardado: 973 bytes) y
--      los textos cortos con un largo razonable. Un evento normal no se acerca; uno gigante (alguien llenando la base
--      gratuita con la llave publica en el stream abierto de Pone Chico) se rechaza con 23514. El cierre de verdad es
--      la etapa 2 de Pone Chico.
--   3. Permisos de mas fuera (hallazgo 8):
--        - `authenticated` (usuarios con login: hoy no hay ninguno y ninguna politica los nombra) pierde todo
--          permiso de tabla y de secuencia en `public`.
--        - anon pierde TRUNCATE, REFERENCES, TRIGGER y MAINTAIN en todas las tablas de `public` (ninguno lo usa la
--          API; TRUNCATE ni siquiera pasa por RLS).
--        - Lo que se cree DESDE AHORA en `public` (tablas, vistas, secuencias) ya no nace con permisos para anon ni
--          authenticated: cada tabla nueva que use una app necesita su `grant` explicito (como ya hacen los SQL del
--          repo). Las funciones nuevas siguen naciendo ejecutables por todos (default de Postgres, global): cada una
--          hace su `revoke`/`grant`, como verificar_clave.
--   4. Funciones (hallazgo 15): `stock_insumos_app()` pasa a `search_path = ''` (como las demas SECURITY DEFINER;
--      su cuerpo ya nombra todo con `public.`) y `rls_auto_enable()` (disparador de eventos, no se llama por la API)
--      deja de ser ejecutable por anon/authenticated/public.
--
-- No entra (a proposito):
--   * Pone Chico, etapa 2: sus equipos todavia no mandan la clave (al 14/11/2026 ninguno se actualizo). Sacarlo de
--     private.campos_abiertos ahora lo dejaria sin sincronizar.
--   * La sanidad "importada" de Maria Laura y Pone Chico: esas tablas no tienen `importado_en` ni importador; no hay
--     nada que proteger todavia (el informe de la auditoria lo listaba por error).
-- =====================================================================================

begin;

-- 0. Respaldos (solo la primera vez), para poder deshacer.
create table if not exists public.auditoria_privilegios_antes_fase6 (
  guardado_en timestamptz not null default now(),
  objeto      text        not null,   -- nombre en public
  tipo        "char"      not null,   -- relkind: r tabla, v vista, m vista materializada, S secuencia, p particionada
  rol         text        not null,
  privilegio  text        not null
);
alter table public.auditoria_privilegios_antes_fase6 enable row level security;
revoke all on table public.auditoria_privilegios_antes_fase6 from anon, authenticated;

insert into public.auditoria_privilegios_antes_fase6 (objeto, tipo, rol, privilegio)
select c.relname, c.relkind, pg_get_userbyid(a.grantee), a.privilege_type
from pg_class c
cross join lateral aclexplode(c.relacl) a
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r', 'v', 'm', 'S', 'p')
  and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  and not exists (select 1 from public.auditoria_privilegios_antes_fase6);

create table if not exists public.auditoria_politicas_antes_fase6 (
  guardado_en timestamptz not null default now(),
  tablename   text        not null,
  policyname  text        not null,
  permissive  text,
  roles       name[],
  cmd         text,
  qual        text,
  with_check  text
);
alter table public.auditoria_politicas_antes_fase6 enable row level security;
revoke all on table public.auditoria_politicas_antes_fase6 from anon, authenticated;

insert into public.auditoria_politicas_antes_fase6 (tablename, policyname, permissive, roles, cmd, qual, with_check)
select p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('comprobantes', 'proveedores', 'precios_vet', 'cotizaciones', 'alias_productos', 'insumos_alias')
  and not exists (select 1 from public.auditoria_politicas_antes_fase6);

-- 1. Compras y precios: fuera las politicas de anon/authenticated y todo permiso de anon/authenticated.
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('comprobantes', 'proveedores', 'precios_vet', 'cotizaciones', 'alias_productos', 'insumos_alias')
      and roles && array['anon', 'authenticated', 'public']::name[]
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;

  for r in
    select c.relname, c.relkind
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and (c.relname in ('comprobantes', 'proveedores', 'precios_vet', 'cotizaciones', 'alias_productos', 'insumos_alias',
                         'precio_ultimo', 'precio_vigente', 'comparacion_catalogo', 'movimientos_insumo', 'stock_insumos')
           or (c.relkind = 'S' and c.relname in ('comprobantes_id_seq', 'proveedores_id_seq', 'precios_vet_id_seq',
                                                 'alias_productos_id_seq')))
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence public.%I from anon, authenticated', r.relname);
    else
      execute format('revoke all on table public.%I from anon, authenticated', r.relname);
    end if;
  end loop;
end
$$;

-- 2. Tope de tamano en eventos_sync. NOT VALID + VALIDATE: si alguna fila vieja no cumpliera, la transaccion
--    entera aborta y no queda nada aplicado.
alter table public.eventos_sync drop constraint if exists eventos_sync_tamanos;
alter table public.eventos_sync add constraint eventos_sync_tamanos check (
  octet_length(detalle::text) <= 16384
  and length(tipo) <= 60
  and length(establecimiento) <= 40
  and length(coalesce(potrero, '')) <= 120
  and length(coalesce(dispositivo, '')) <= 120
  and length(coalesce(fecha_cliente, '')) <= 40
) not valid;
alter table public.eventos_sync validate constraint eventos_sync_tamanos;

-- 3. Permisos de mas.
--    a) authenticated: nada en tablas, vistas ni secuencias de public.
--    b) anon: fuera TRUNCATE, REFERENCES, TRIGGER y MAINTAIN (se arma con aclexplode para no nombrar MAINTAIN,
--       que no existe antes de Postgres 17).
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind, pg_get_userbyid(a.grantee) as rol, a.privilege_type as priv
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'v', 'm', 'S', 'p')
      and (a.grantee = 'authenticated'::regrole
           or (a.grantee = 'anon'::regrole and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')))
  loop
    if r.relkind = 'S' then
      execute format('revoke %s on sequence public.%I from %I', r.priv, r.relname, r.rol);
    else
      execute format('revoke %s on table public.%I from %I', r.priv, r.relname, r.rol);
    end if;
  end loop;
end
$$;

--    c) Lo nuevo en public ya no nace abierto (tablas, vistas y secuencias que cree postgres).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- 4. Funciones.
alter function public.stock_insumos_app() set search_path = '';
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 5. Resultado (se ve al correr el script).
select 'anon todavia lee compras/precios' as control,
       coalesce(string_agg(c.relname, ', '), '(ninguna: bien)') as detalle
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('comprobantes', 'proveedores', 'precios_vet', 'cotizaciones', 'alias_productos', 'insumos_alias',
                    'precio_ultimo', 'precio_vigente', 'comparacion_catalogo', 'movimientos_insumo', 'stock_insumos')
  and has_table_privilege('anon', c.oid, 'select')
union all
select 'objetos con permisos para authenticated',
       (select count(distinct c.oid)::text from pg_class c cross join lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and a.grantee = 'authenticated'::regrole)
union all
select 'tope de tamano en eventos_sync',
       (select coalesce(string_agg(conname || (case when convalidated then ' (validado)' else ' (SIN validar)' end), ', '), '(falta)')
        from pg_constraint where conrelid = 'public.eventos_sync'::regclass and conname = 'eventos_sync_tamanos');

commit;
