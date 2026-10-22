-- =====================================================================================
-- ##################################################################################
-- ##                                                                              ##
-- ##   NO CORRER TODAVIA.  ESTE ES EL RELEASE 2 (EL CIERRE) DE LA FASE 4.         ##
-- ##                                                                              ##
-- ##   No correrlo hasta que se cumplan LAS TRES cosas:                           ##
-- ##     1. `private.equipos_vistos` muestre TODOS los equipos activos con        ##
-- ##        con_clave = true (ver la consulta del README), y                      ##
-- ##     2. los scripts de la PC que usan la llave publica ya usen la clave       ##
-- ##        privada (SUPABASE_SECRET_KEY), y                                      ##
-- ##     3. el Tablero de Sanidad ya publicado manda la clave del campo.          ##
-- ##                                                                              ##
-- ##   Un equipo sin clave, o un script con la llave publica, deja de leer y de   ##
-- ##   escribir en cuanto este script corre (en la app: el cartel rojo "trabados" ##
-- ##   con "revisa la clave del campo").                                          ##
-- ##                                                                              ##
-- ##################################################################################
--
-- Auditoria de las apps de potreros -- FASE 4, RELEASE 2: EL CIERRE.
--
-- REVISADO el 21/10/2026 (a pedido de Pedro): Pone Chico NO usa clave y el Tablero de Sanidad si.
--   * `private.campos_abiertos` + `public.establecimientos_permitidos()`: los campos sin clave a proposito
--     (hoy solo pone_chico) pasan igual en SU PROPIO stream (eventos_sync, stock_potreros, sanidad_carga_pone_chico,
--     sanidad_ultimos, sanidad_proximos). Para ponerle clave mas adelante basta borrarlo de esa tabla
--     (y NO volver a correr este script despues: lo reinserta, `on conflict do nothing`; probado en probar_cierre.js).
--   * Las excepciones entre campos (traslado_entrada, anular_traslado) y las tablas que Pone Chico no usa
--     (sanidad_carga, sanidad_carga_maria_laura, animales_caravana, maestros_dicose) siguen exigiendo una clave REAL
--     (`establecimientos_con_clave()`), asi nadie puede hacerse pasar por un campo abierto para escribir en otro.
--   * productos_catalogo queda legible para todos (lista de referencia que nadie puede escribir desde la Fase 2).
--   * sanidad_ultimos y sanidad_proximos se leen con la clave del campo (el tablero la manda), ya no se cierran del todo.
--
-- Despues de fase4_clave_campo.sql (release 1) y de que todos los equipos manden el encabezado
-- `x-clave-campo`, las politicas dejan de ser abiertas: cada tabla solo contesta a quien trae la clave
-- del campo al que pertenece la fila (public.establecimientos_con_clave()).
--
-- Scripts de la PC que tienen que usar la clave privada (service_role, que no pasa por estas politicas)
-- ANTES de correr esto:
--   Ganaderia\Macros & phyton\pasar_traslados_a_excel.py
--   Lector XRS2\sanidad_puente.py              (escribe sanidad_carga)
--   Sanidad\Automatizacion\bajar_sanidad_de_potreros.py
--   Sanidad\regenerar_stock_potreros_excel.py
--   Sanidad\Automatizacion\vigilar_tareas_sanidad.py  (cae a la publica si no hay privada)
--   Proyecto Gestion ganadera\Automatizacion\enviar_informe_nacimientos.py  (abre la app: necesita la
--     clave del campo cargada en su localStorage, o ver el README)
--   Tablero de Sanidad (tablero-sanidad/): ya manda la clave si esta cargada; publicarlo ANTES del cierre.
-- El keep-alive de GitHub (mantener_activo.yml) sigue andando: una consulta con la llave publica contesta
-- 200 con lista vacia.
--
-- Que hace (todo en UNA transaccion: si algo falla, no queda nada aplicado):
--   0. Guarda las politicas actuales y los permisos de anon sobre estas tablas en
--      `auditoria_politicas_antes_fase4` y `auditoria_privilegios_antes_fase4` (para poder deshacer).
--   1. Borra TODAS las politicas de `anon`/`public` de las 10 tablas de abajo (sin importar el nombre).
--   2. Crea las nuevas, siempre `to anon`:
--
--        tabla                       leer                      escribir
--        --------------------------  ------------------------  --------------------------------------------
--        eventos_sync                clave o campo abierto     INSERT con la clave (o campo abierto); excepcion:
--                                                              traslado_entrada si la clave es la del campo de
--                                                              origen (detalle.origen.establecimiento) y la
--                                                              correccion anular_traslado si es la del campo
--                                                              de origen (detalle.origenEstablecimiento).
--                                                              Sin UPDATE ni DELETE (como hoy).
--        stock_potreros              clave o campo abierto     todo, con la clave de su establecimiento
--        sanidad_carga (La Vuelta)   clave de la_vuelta        INSERT con la clave; UPDATE/DELETE con la clave
--                                                              y solo filas con importado_en vacio
--        sanidad_carga_maria_laura   clave de maria_laura      todo con la clave de maria_laura
--        sanidad_carga_pone_chico    campo abierto (o clave)   todo, mientras pone_chico este en campos_abiertos
--        animales_caravana           clave del campo           nadie (la escribe la PC con la clave privada)
--        productos_catalogo          todos (sin clave)         nadie (la escribe la PC con la clave privada)
--        maestros_dicose             cualquier campo           INSERT con la clave de cualquier campo
--        sanidad_ultimos             clave o campo abierto     nadie (la escribe la PC con la clave privada)
--        sanidad_proximos            clave o campo abierto     nadie (la escribe la PC con la clave privada)
--
--   3. Ajusta los permisos de tabla de anon: donde conserva algo bajo politica, el permiso de tabla sigue
--      (sin el permiso de tabla la politica no alcanza); sanidad_ultimos y sanidad_proximos quedan solo de lectura.
--
-- NO toca: movimientos_dicose (ya cerrada a anon), el trigger eventos_sync_fijar_creado_en (Fase 2) ni el
-- de equipos vistos (release 1).
--
-- Para deshacer: scripts/seguridad/fase4_cierre_deshacer.sql
-- Verificacion despues: python scripts/seguridad/verificar_fase4.py --cierre
-- =====================================================================================

begin;

-- Sin el release 1 no hay con que comprobar la clave: mejor frenar antes de tocar nada.
do $$
begin
  if to_regprocedure('public.establecimientos_con_clave()') is null then
    raise exception 'Falta public.establecimientos_con_clave(): correr primero fase4_clave_campo.sql';
  end if;
  if not exists (select 1 from private.claves_campo) then
    raise exception 'private.claves_campo esta vacia: cargar las claves con private.cargar_clave antes del cierre';
  end if;
end
$$;

-- Campos sin clave a proposito (hoy solo Pone Chico). Pasan en su PROPIO stream; ver el encabezado.
create table if not exists private.campos_abiertos (establecimiento text primary key);
alter table private.campos_abiertos enable row level security;
revoke all on table private.campos_abiertos from public, anon, authenticated;
insert into private.campos_abiertos (establecimiento) values ('pone_chico') on conflict do nothing;

-- Campos con clave valida en este pedido + campos abiertos. NO usar para las excepciones entre campos ni para
-- las tablas que un campo abierto no usa: ahi va establecimientos_con_clave() (clave real).
create or replace function public.establecimientos_permitidos()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct e order by e), array[]::text[])
  from (
    select unnest(public.establecimientos_con_clave()) as e
    union
    select establecimiento from private.campos_abiertos
  ) t;
$$;
revoke all on function public.establecimientos_permitidos() from public;
grant execute on function public.establecimientos_permitidos() to anon, authenticated;

-- 0. Respaldo (solo la primera vez: una segunda corrida no lo pisa).
create table if not exists public.auditoria_politicas_antes_fase4 (
  guardado_en timestamptz not null default now(),
  tablename   text        not null,
  policyname  text        not null,
  permissive  text,
  roles       name[],
  cmd         text,
  qual        text,
  with_check  text
);
alter table public.auditoria_politicas_antes_fase4 enable row level security;
revoke all on table public.auditoria_politicas_antes_fase4 from anon, authenticated;

insert into public.auditoria_politicas_antes_fase4 (tablename, policyname, permissive, roles, cmd, qual, with_check)
select p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('eventos_sync', 'stock_potreros', 'sanidad_carga', 'sanidad_carga_maria_laura',
                      'sanidad_carga_pone_chico', 'animales_caravana', 'productos_catalogo',
                      'maestros_dicose', 'sanidad_ultimos', 'sanidad_proximos')
  and not exists (select 1 from public.auditoria_politicas_antes_fase4);

create table if not exists public.auditoria_privilegios_antes_fase4 (
  guardado_en timestamptz not null default now(),
  tablename   text        not null,
  privilegio  text        not null
);
alter table public.auditoria_privilegios_antes_fase4 enable row level security;
revoke all on table public.auditoria_privilegios_antes_fase4 from anon, authenticated;

insert into public.auditoria_privilegios_antes_fase4 (tablename, privilegio)
select t.tablename, g.privilegio
from (values ('eventos_sync'), ('stock_potreros'), ('sanidad_carga'), ('sanidad_carga_maria_laura'),
             ('sanidad_carga_pone_chico'), ('animales_caravana'), ('productos_catalogo'),
             ('maestros_dicose'), ('sanidad_ultimos'), ('sanidad_proximos')) as t(tablename)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as g(privilegio)
where has_table_privilege('anon', format('public.%I', t.tablename)::regclass, g.privilegio)
  and not exists (select 1 from public.auditoria_privilegios_antes_fase4);

-- 1. Fuera las politicas que alcanzan a anon (las propias de la clave tambien, por si se corre de nuevo).
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
                        'maestros_dicose', 'sanidad_ultimos', 'sanidad_proximos')
      and roles && array['anon', 'public']::name[]
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;

-- 2. Politicas nuevas. `(select public.f())` se evalua una vez por consulta.
--    OJO con la sintaxis: `= any ((select public.f()))` NO anda. Postgres lo lee como "ANY de una subconsulta" y
--    falla con `operator does not exist: text = text[]` (con eso este script abortaba entero). Hay que castear el
--    arreglo: `= any ((select public.f())::text[])`. Lo prueba scripts/seguridad/probar_cierre.js.

-- eventos_sync: registro de solo-agregar (sin UPDATE ni DELETE).
create policy eventos_sync_select_clave on public.eventos_sync
  for select to anon
  using (establecimiento = any ((select public.establecimientos_permitidos())::text[]));

create policy eventos_sync_insert_clave on public.eventos_sync
  for insert to anon
  with check (
    establecimiento = any ((select public.establecimientos_permitidos())::text[])
    -- traslado entre campos (clave REAL del origen, no campos abiertos): el espejo de entrada se escribe en el stream del destino con la clave del origen
    or (tipo = 'traslado_entrada'
        and (detalle -> 'origen' ->> 'establecimiento') = any ((select public.establecimientos_con_clave())::text[]))
    -- borrar la salida de un traslado anula la entrada en el destino: correccion en el stream del destino
    or (tipo = 'correccion'
        and (detalle ->> 'accion') = 'anular_traslado'
        and (detalle ->> 'origenEstablecimiento') = any ((select public.establecimientos_con_clave())::text[]))
  );

-- stock_potreros: la app lo escribe (upsert + delete), nunca lo lee.
create policy stock_potreros_all_clave on public.stock_potreros
  for all to anon
  using (establecimiento = any ((select public.establecimientos_permitidos())::text[]))
  with check (establecimiento = any ((select public.establecimientos_permitidos())::text[]));

-- sanidad_carga (La Vuelta; tabla compartida con columna `establecimiento` y puente a Excel).
create policy sanidad_carga_select_clave on public.sanidad_carga
  for select to anon
  using (establecimiento = any ((select public.establecimientos_con_clave())::text[]));
create policy sanidad_carga_insert_clave on public.sanidad_carga
  for insert to anon
  with check (establecimiento = any ((select public.establecimientos_con_clave())::text[]));
create policy sanidad_carga_update_clave on public.sanidad_carga
  for update to anon
  using (establecimiento = any ((select public.establecimientos_con_clave())::text[]) and importado_en is null)
  with check (establecimiento = any ((select public.establecimientos_con_clave())::text[]) and importado_en is null);
create policy sanidad_carga_delete_clave on public.sanidad_carga
  for delete to anon
  using (establecimiento = any ((select public.establecimientos_con_clave())::text[]) and importado_en is null);

-- sanidad_carga_maria_laura / sanidad_carga_pone_chico: tabla propia, sin columna `establecimiento`.
create policy sanidad_carga_maria_laura_all_clave on public.sanidad_carga_maria_laura
  for all to anon
  using ('maria_laura' = any ((select public.establecimientos_con_clave())::text[]))
  with check ('maria_laura' = any ((select public.establecimientos_con_clave())::text[]));
create policy sanidad_carga_pone_chico_all_clave on public.sanidad_carga_pone_chico
  for all to anon
  using ('pone_chico' = any ((select public.establecimientos_permitidos())::text[]))
  with check ('pone_chico' = any ((select public.establecimientos_permitidos())::text[]));

-- animales_caravana: padron por animal; solo lectura con la clave del campo (lo publica la PC con la privada).
create policy animales_caravana_select_clave on public.animales_caravana
  for select to anon
  using (establecimiento = any ((select public.establecimientos_con_clave())::text[]));

-- productos_catalogo: lista de referencia compartida; la lee cualquiera (Pone Chico y Completar sanidad no mandan clave).
-- Nadie la escribe con la llave publica desde la Fase 2.
create policy productos_catalogo_select_publico on public.productos_catalogo
  for select to anon
  using (true);

-- maestros_dicose: referencia compartida por los campos con DICOSE (sin columna `establecimiento`):
-- alcanza con la clave de cualquiera.

create policy maestros_dicose_select_clave on public.maestros_dicose
  for select to anon
  using (cardinality((select public.establecimientos_con_clave())) > 0);
create policy maestros_dicose_insert_clave on public.maestros_dicose
  for insert to anon
  with check (cardinality((select public.establecimientos_con_clave())) > 0);

-- sanidad_ultimos y sanidad_proximos: las lee el Tablero de Sanidad (manda la clave del campo). Las escribe la PC.
create policy sanidad_ultimos_select_clave on public.sanidad_ultimos
  for select to anon
  using (establecimiento = any ((select public.establecimientos_permitidos())::text[]));
create policy sanidad_proximos_select_clave on public.sanidad_proximos
  for select to anon
  using (establecimiento = any ((select public.establecimientos_permitidos())::text[]));

-- 3. Permisos de tabla (anon). Hace falta politica Y permiso de tabla.
grant select, insert on table public.eventos_sync to anon;
grant select, insert, update, delete on table
  public.stock_potreros, public.sanidad_carga,
  public.sanidad_carga_maria_laura, public.sanidad_carga_pone_chico
to anon;
grant select on table public.animales_caravana, public.productos_catalogo,
  public.sanidad_ultimos, public.sanidad_proximos to anon;
grant select, insert on table public.maestros_dicose to anon;

-- 4. Resultado: que le queda permitido a anon en cada tabla (se ve al correr el script).
select p.tablename as tabla,
       string_agg(p.cmd || ' (' || array_to_string(p.roles, ',') || ')', ' + ' order by p.cmd) as politicas
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('eventos_sync', 'stock_potreros', 'sanidad_carga', 'sanidad_carga_maria_laura',
                      'sanidad_carga_pone_chico', 'animales_caravana', 'productos_catalogo',
                      'maestros_dicose', 'sanidad_ultimos', 'sanidad_proximos')
group by p.tablename
order by p.tablename;

commit;
