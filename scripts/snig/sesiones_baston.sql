-- Lecturas del baston vs stock del potrero (8/11/2026).
-- Una fila por sesion del baston de los ultimos dias, con lo que se leyo y, si la sesion
-- trae un potrero conocido, los animales del padron que figuran en ese potrero y NO se leyeron.
-- La app PC compara "leidos" contra su propio stock en vivo; el Lector solo publica los hechos.
-- Correr en el SQL Editor de Supabase ANTES de publicar la app que la lee (regla 11 de CLAUDE.md).
-- Aditivo e idempotente: se puede correr dos veces. Se deshace con sesiones_baston_deshacer.sql.
--
--   sesion          nombre de la sesion del baston (sesiones.csv)
--   comparado       true si la sesion trae un potrero conocido; false = "sin comparar" (motivo dice por que)
--   por_categoria   {"Vacas": 12, "Terneros": 3}  leidos por categoria de la app
--   faltan          [{"id8": "...", "c": "Vacas"}] animales ACTIVOS del potrero que no se leyeron
-- La escribe el Lector con la clave privada (service_role ignora RLS); anon solo lee, con la clave del campo.

create table if not exists public.sesiones_baston (
  establecimiento text not null,
  sesion          text not null,
  fecha           date,
  archivo         text,
  potrero         text,
  comparado       boolean not null default false,
  motivo          text,
  leidos          integer not null default 0,
  por_categoria   jsonb,
  faltan          jsonb,
  actualizado     timestamptz not null default now(),
  primary key (establecimiento, sesion)
);

alter table public.sesiones_baston enable row level security;

drop policy if exists sesiones_baston_select_clave on public.sesiones_baston;
create policy sesiones_baston_select_clave on public.sesiones_baston
  for select to anon
  using (establecimiento = any ((select public.establecimientos_con_clave())::text[]));

grant select on table public.sesiones_baston to anon;

-- Control de seguridad (8/11/2026): anon solo lee. Supabase da ALL por defecto en tablas nuevas.
revoke insert, update, delete, truncate on public.sesiones_baston from anon, authenticated;
