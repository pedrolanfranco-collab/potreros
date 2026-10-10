-- =====================================================================================
-- Auditoria de las apps de potreros -- FASE 2: CARENCIA PROTEGIDA (10/10/2026)
--
-- Problema: la llave publica de Supabase (anon) esta dentro de cada app, y el repo es
-- publico. Con ella cualquiera podia:
--   * insertar o borrar productos en `productos_catalogo` (de ahi salen los plazos de espera),
--   * escribir o borrar el padron de `animales_caravana` (de ahi sale APTO / NO APTO),
--   * escribir o borrar `sanidad_ultimos` y `sanidad_proximos`.
-- O sea: alterar si un animal figura apto para faena.
--
-- Que hace este script (todo en UNA transaccion: si algo falla, no queda nada aplicado):
--   0. Guarda las politicas actuales en `auditoria_politicas_antes_fase2` (para poder deshacer).
--   1. Borra las politicas de ESCRITURA (INSERT / UPDATE / DELETE / ALL) de esas 4 tablas.
--   2. Se asegura de que anon siga pudiendo LEER (las apps y los scripts leen estas tablas).
--   3. Le saca a anon los permisos de tabla INSERT / UPDATE / DELETE / TRUNCATE (defensa
--      doble: ademas de la politica, un intento de escribir da "permission denied" en vez de
--      un 200 vacio que parece exito).
--   4. Fuerza `creado_en` de `eventos_sync` con la hora del servidor (con la llave publica
--      se podia insertar una fila fechada en 2099 y dejar a todos sin recibir eventos nuevos).
--
-- Quien escribe ahora: los scripts de la PC, con la clave privada (secret / service_role) que
-- esta en C:\Users\<usuario>\.potreros\.env (fuera del repo y de OneDrive). Ya estan cambiados
-- (publicar_animales.py y actualizar_sanidad_supabase.py).
--
-- NO toca: eventos_sync, sanidad_carga*, stock_potreros, maestros_dicose (las apps escriben
-- ahi; se cierran en la Fase 4 con la clave del campo).
--
-- Para deshacer: scripts/seguridad/fase2_carencia_deshacer.sql
-- Verificacion despues: ver el SELECT del final y scripts/seguridad/README.md
-- =====================================================================================

begin;

-- 0. Respaldo de las politicas actuales (solo la primera vez: una segunda corrida no lo pisa).
create table if not exists public.auditoria_politicas_antes_fase2 (
  guardado_en timestamptz not null default now(),
  tablename   text        not null,
  policyname  text        not null,
  permissive  text,
  roles       name[],
  cmd         text,
  qual        text,
  with_check  text
);
alter table public.auditoria_politicas_antes_fase2 enable row level security;
revoke all on table public.auditoria_politicas_antes_fase2 from anon, authenticated;

insert into public.auditoria_politicas_antes_fase2 (tablename, policyname, permissive, roles, cmd, qual, with_check)
select p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('productos_catalogo', 'animales_caravana', 'sanidad_ultimos', 'sanidad_proximos')
  and not exists (select 1 from public.auditoria_politicas_antes_fase2);

-- 1. Fuera las politicas que dejan escribir (sin importar como se llamen).
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('productos_catalogo', 'animales_caravana', 'sanidad_ultimos', 'sanidad_proximos')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

-- 2. Lectura: si una tabla se quedo sin politica de SELECT para anon (las que tenian "ALL"),
--    se le crea una. Las que ya tenian una, no se tocan.
do $$
declare
  t text;
begin
  foreach t in array array['productos_catalogo', 'animales_caravana', 'sanidad_ultimos', 'sanidad_proximos']
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
        and (roles && array['anon', 'public']::name[])
    ) then
      execute format('create policy %I on public.%I for select to anon using (true)', t || '_select_anon', t);
    end if;
  end loop;
end
$$;

-- 3. Permisos de tabla: anon solo lee.
revoke insert, update, delete, truncate on table
  public.productos_catalogo,
  public.animales_caravana,
  public.sanidad_ultimos,
  public.sanidad_proximos
from anon;

-- 4. `creado_en` de eventos_sync lo pone siempre el servidor. La excepcion es service_role
--    (la clave privada de la PC), para poder restaurar un backup conservando el orden.
create or replace function public.eventos_sync_fijar_creado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rol text;
begin
  rol := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if rol <> 'service_role' then
    new.creado_en := now();
  end if;
  return new;
end
$$;

drop trigger if exists eventos_sync_fijar_creado_en on public.eventos_sync;
create trigger eventos_sync_fijar_creado_en
  before insert on public.eventos_sync
  for each row execute function public.eventos_sync_fijar_creado_en();

-- 5. Resultado: que le queda permitido a cada tabla (lo que se ve al correr el script).
select p.tablename as tabla,
       string_agg(p.cmd || ' (' || array_to_string(p.roles, ',') || ')', ' + ' order by p.cmd) as politicas
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('productos_catalogo', 'animales_caravana', 'sanidad_ultimos', 'sanidad_proximos')
group by p.tablename
order by p.tablename;

commit;
