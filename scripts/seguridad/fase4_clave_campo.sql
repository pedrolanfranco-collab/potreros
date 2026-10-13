-- =====================================================================================
-- Auditoria de las apps de potreros -- FASE 4, RELEASE 1: CLAVE DEL CAMPO, MODO SUAVE
--
-- Problema (hallazgos 12, 15 y 18): la llave publica de Supabase (anon) esta dentro de cada app y el
-- repo es publico, asi que cualquiera puede insertar eventos falsos en `eventos_sync` (y todos los
-- equipos los aplican) y leer el padron y los datos comerciales.
--
-- Idea: cada establecimiento tiene una CLAVE (la que elige Pedro, la misma para la PC, la movil y
-- Campo de ese campo). La app la manda en el encabezado `x-clave-campo` de cada pedido, y las
-- politicas (Release 2, `fase4_cierre.sql`) dejan pasar solo lo que trae la clave de ese campo.
--
-- ESTE script es el RELEASE 1, el "modo suave": deja todo listo SIN cortar nada.
--   * las politicas de las tablas siguen EXACTAMENTE como estaban (abiertas);
--   * agrega la comprobacion de claves y la tabla de "equipos vistos", para saber cuando todos los
--     equipos ya mandan la clave y se puede cerrar.
--
-- Que crea (todo en UNA transaccion: si algo falla, no queda nada aplicado; se puede correr de nuevo):
--   1. esquema `private` (no expuesto a la API) con
--        private.claves_campo   (establecimiento, sal, hash)  -- solo el hash de cada clave, nunca la clave
--        private.equipos_vistos (que equipos publicaron, con que version y si ya mandaron clave)
--   2. public.establecimientos_con_clave()  -- lee el encabezado y devuelve los campos cuya clave coincide
--   3. public.verificar_clave(est, clave)   -- RPC que usa la pantalla "Clave del campo" de la app
--   4. private.cargar_clave(est, clave)     -- la corre SOLO Pedro, a mano, para cargar/cambiar una clave
--   5. un trigger AFTER INSERT en eventos_sync que anota cada equipo (no puede romper un insert)
--
-- NO toca: ninguna politica, ningun GRANT de tabla, ni el trigger eventos_sync_fijar_creado_en (Fase 2).
--
-- DESPUES DE CORRER ESTE SCRIPT (ver scripts/seguridad/README.md, "Fase 4"):
--   - cargar las 3 claves con private.cargar_clave (ejemplo mas abajo);
--   - python scripts/seguridad/verificar_fase4.py;
--   - recien ahi publicar la app. El SQL va ANTES que el codigo: una app nueva que llama a
--     verificar_clave antes de que exista la funcion mostraria "no se pudo comprobar".
--
-- Para deshacer: scripts/seguridad/fase4_clave_campo_deshacer.sql
-- =====================================================================================

begin;

-- 1. Esquema privado. La API (PostgREST) solo expone `public`; igual se le saca todo a los roles de la API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.claves_campo (
  establecimiento text primary key,
  sal             text not null,
  hash            text not null
);
alter table private.claves_campo enable row level security;
revoke all on table private.claves_campo from public, anon, authenticated;

create table if not exists private.equipos_vistos (
  establecimiento text        not null,
  dispositivo     text        not null,
  version         text,
  usuario         text,
  con_clave       boolean     not null default false,
  primera         timestamptz not null default now(),
  ultima          timestamptz not null default now(),
  primary key (establecimiento, dispositivo)
);
alter table private.equipos_vistos enable row level security;
revoke all on table private.equipos_vistos from public, anon, authenticated;

-- 2. Que campos tienen la clave que trae este pedido.
--    Lee el encabezado `x-clave-campo` que PostgREST deja en `request.headers`; lo pasa a minusculas y le
--    saca los espacios (igual que la app); si no viene o no tiene la forma de una clave, devuelve un arreglo
--    vacio. Esta pensada para usarse en las politicas como `(select public.establecimientos_con_clave())`,
--    asi se evalua una sola vez por consulta y no una vez por fila.
create or replace function public.establecimientos_con_clave()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.establecimiento order by c.establecimiento), array[]::text[])
  from private.claves_campo c,
       lateral (
         select lower(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-clave-campo')) as clave
       ) k
  where k.clave ~ '^[a-z0-9]{8,64}$'
    and c.hash = encode(sha256(convert_to(c.sal || k.clave, 'UTF8')), 'hex');
$$;
revoke all on function public.establecimientos_con_clave() from public;
grant execute on function public.establecimientos_con_clave() to anon, authenticated;

-- 3. RPC para la pantalla de la app: dice si `clave` es la de `est`. Una clave mala hace una espera corta
--    antes de contestar, para encarecer probar claves en serie (la espera no afecta a quien acierta).
create or replace function public.verificar_clave(est text, clave text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k  text := lower(btrim(coalesce(clave, '')));
  ok boolean;
begin
  if k ~ '^[a-z0-9]{8,64}$' then
    select (c.hash = encode(sha256(convert_to(c.sal || k, 'UTF8')), 'hex'))
      into ok
      from private.claves_campo c
     where c.establecimiento = est;
  end if;
  if coalesce(ok, false) then
    return true;
  end if;
  perform pg_sleep(0.5);
  return false;
end
$$;
revoke all on function public.verificar_clave(text, text) from public;
grant execute on function public.verificar_clave(text, text) to anon, authenticated;

-- 4. Cargar o cambiar la clave de un campo. LA CORRE SOLO PEDRO, a mano, en el SQL Editor (sin permisos
--    para anon ni authenticated). Guarda una sal nueva y el hash; la clave en si no queda en ningun lado.
--    Ejemplo de uso (con una clave de JUGUETE; poner la real, ver README):
--
--        select private.cargar_clave('la_vuelta', 'claveprueba1');
--
--    Los ids de campo son los de la columna `establecimiento` de eventos_sync: la_vuelta, maria_laura,
--    pone_chico. Cada llamada reemplaza la clave anterior de ese campo.
--
--    ATENCION: el SQL Editor de Supabase GUARDA EL HISTORIAL de las consultas que corres, y ahi quedaria la
--    clave en texto. Despues de cargar las 3, borra esas entradas del historial del editor (Query history ->
--    borrar). La clave tampoco va a un chat ni al repo.
create or replace function private.cargar_clave(est text, clave text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k text := lower(btrim(coalesce(clave, '')));
  s text;
begin
  if est is null or btrim(est) = '' then
    raise exception 'Falta el id del establecimiento (la_vuelta, maria_laura o pone_chico).';
  end if;
  if k !~ '^[a-z0-9]{8,64}$' then
    raise exception 'La clave tiene que ser de 8 a 64 caracteres: solo letras sin tildes ni enie, y numeros, sin espacios.';
  end if;
  s := gen_random_uuid()::text;
  insert into private.claves_campo (establecimiento, sal, hash)
  values (est, s, encode(sha256(convert_to(s || k, 'UTF8')), 'hex'))
  on conflict (establecimiento) do update set sal = excluded.sal, hash = excluded.hash;
  return 'Clave de ' || est || ' cargada.';
end
$$;
revoke all on function private.cargar_clave(text, text) from public, anon, authenticated;

-- 5. Equipos vistos. Cada evento que entra anota el equipo que lo mando: version de la app (`detalle.v`),
--    nombre de quien lo usa (`detalle.usuario`, solo en movil/Campo) y si el pedido traia la clave de ese
--    campo. Asi Pedro ve que equipos ya la tienen y cuando se puede cerrar.
--    - Es AFTER INSERT y todo va dentro de un bloque con manejo de excepciones: NUNCA puede romper el
--      insert de un evento.
--    - Los espejos que un equipo escribe en el stream del OTRO campo (traslado_entrada y la correccion
--      anular_traslado) no se anotan: llevan el id del equipo de origen con el `establecimiento` de
--      destino y harian aparecer un equipo "sin clave" en un campo donde no usa la app.
--    - No toca eventos_sync_fijar_creado_en (el trigger BEFORE INSERT de la Fase 2): es otro trigger.
create or replace function private.registrar_equipo_visto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.dispositivo is not null
       and new.tipo is distinct from 'traslado_entrada'
       and not (new.tipo is not distinct from 'correccion' and coalesce(new.detalle ->> 'accion', '') = 'anular_traslado') then
      insert into private.equipos_vistos (establecimiento, dispositivo, version, usuario, con_clave, primera, ultima)
      values (
        new.establecimiento,
        new.dispositivo,
        new.detalle ->> 'v',
        nullif(btrim(new.detalle ->> 'usuario'), ''),
        coalesce(new.establecimiento = any (public.establecimientos_con_clave()), false),
        now(),
        now()
      )
      on conflict (establecimiento, dispositivo) do update
        set version   = coalesce(excluded.version, private.equipos_vistos.version),
            usuario   = coalesce(excluded.usuario, private.equipos_vistos.usuario),
            con_clave = excluded.con_clave,
            ultima    = now();
    end if;
  exception when others then
    null; -- anotar equipos es secundario: ante cualquier problema el evento entra igual
  end;
  return null;
end
$$;
revoke all on function private.registrar_equipo_visto() from public, anon, authenticated;

drop trigger if exists eventos_sync_equipos_vistos on public.eventos_sync;
create trigger eventos_sync_equipos_vistos
  after insert on public.eventos_sync
  for each row execute function private.registrar_equipo_visto();

-- 6. Lo que ya habia: los equipos que alguna vez escribieron en eventos_sync, con su ultima version y
--    ultimo usuario, y `con_clave = false` hasta que manden un evento con la clave. Sin esto, un equipo
--    que no publico desde hoy no aparece y no se sabe que existe. Los equipos viejos o reiniciados quedan
--    con `ultima` antigua (se ignoran mirando esa columna). Si se corre de nuevo, no pisa lo que ya hay.
insert into private.equipos_vistos (establecimiento, dispositivo, version, usuario, con_clave, primera, ultima)
select e.establecimiento,
       e.dispositivo,
       (array_agg(e.detalle ->> 'v' order by e.creado_en desc) filter (where e.detalle ->> 'v' is not null))[1],
       (array_agg(nullif(btrim(e.detalle ->> 'usuario'), '') order by e.creado_en desc)
          filter (where nullif(btrim(e.detalle ->> 'usuario'), '') is not null))[1],
       false,
       min(e.creado_en),
       max(e.creado_en)
from public.eventos_sync e
where e.dispositivo is not null
  and e.tipo is distinct from 'traslado_entrada'
  and not (e.tipo is not distinct from 'correccion' and coalesce(e.detalle ->> 'accion', '') = 'anular_traslado')
group by e.establecimiento, e.dispositivo
on conflict (establecimiento, dispositivo) do nothing;

-- Que PostgREST vea las funciones nuevas al toque (se entrega al confirmar la transaccion).
notify pgrst, 'reload schema';

-- 7. Resultado: lo que quedo creado (se ve al correr el script).
select 'claves cargadas' as que, count(*)::text as valor from private.claves_campo
union all
select 'equipos vistos (historicos)', count(*)::text from private.equipos_vistos
union all
select 'funcion ' || p.proname, 'ok'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in ('establecimientos_con_clave', 'verificar_clave'))
   or (n.nspname = 'private' and p.proname in ('cargar_clave', 'registrar_equipo_visto'));

commit;
