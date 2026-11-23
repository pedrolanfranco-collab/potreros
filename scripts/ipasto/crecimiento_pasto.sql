-- iPasto: crecimiento del pasto por potrero y por mes (kg de materia seca por ha y por dia).
-- Lo escribe solo el script de la PC (scripts/ipasto/bajar_crecimiento.py) con la clave privada.
-- Las apps (anon) solo leen, y solo con la clave del campo (mismo criterio que sanidad_ultimos, Fase 4).
-- Aditivo: tabla nueva, no toca nada existente. Se deshace con crecimiento_pasto_deshacer.sql.
-- Transaccional e idempotente (se puede correr dos veces).

begin;

do $$
begin
  if to_regprocedure('public.establecimientos_permitidos()') is null then
    raise exception 'Falta public.establecimientos_permitidos(): correr primero la Fase 4';
  end if;
end $$;

create table if not exists public.crecimiento_pasto (
  establecimiento text        not null,
  potrero_ipasto  text        not null,
  anio            int         not null check (anio between 2000 and 2100),
  mes             int         not null check (mes between 1 and 12),
  tc_actual       numeric,
  tc_promedio     numeric,
  tc_min          numeric,
  tc_max          numeric,
  actualizado_en  timestamptz not null default now(),
  primary key (establecimiento, potrero_ipasto, anio, mes)
);

comment on table public.crecimiento_pasto is
  'Tasa de crecimiento del pasto (kg MS/ha/dia) bajada de iPasto (Plan Agropecuario). La escribe la PC con la clave privada; las apps solo leen con la clave del campo.';

alter table public.crecimiento_pasto enable row level security;

drop policy if exists crecimiento_pasto_select_clave on public.crecimiento_pasto;
create policy crecimiento_pasto_select_clave on public.crecimiento_pasto
  for select to anon
  using (establecimiento = any ((select public.establecimientos_permitidos())::text[]));

-- Fase 6: una tabla nueva no nace con permisos para anon. Solo lectura.
revoke all on table public.crecimiento_pasto from anon, authenticated;
grant select on table public.crecimiento_pasto to anon;
grant select, insert, update, delete on table public.crecimiento_pasto to service_role;

-- Resultado: que puede hacer anon en la tabla nueva (tiene que decir solo SELECT).
select g.privilegio, has_table_privilege('anon', 'public.crecimiento_pasto', g.privilegio) as permitido
from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as g(privilegio);

commit;
