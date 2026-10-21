-- Tablero de Sanidad: "Ya se hizo" en un tratamiento vencido de Próximos (21/10/2026, a pedido de Pedro).
--
-- `sanidad_proximos` la regenera la PC desde la Planilla cada hora (actualizar_sanidad_supabase.py), así que
-- borrar ahí una fila no sirve: vuelve. Esta tabla guarda qué vencimientos ya se hicieron y el tablero
-- (tablero-sanidad/index.html) los oculta en todos los equipos. La clave es el vencimiento puntual
-- (establecimiento + categoría + sanidad + fecha prevista): cuando la Planilla registra un tratamiento nuevo, la
-- fecha prevista cambia y el próximo vencimiento vuelve a aparecer solo.
--
-- Solo oculta una tarjeta del tablero: no toca la Planilla, la carencia ni ninguna otra tabla.
-- `anon` (la llave pública del tablero) puede leer, marcar y deshacer; nada más. Fase 4: esta tabla NO está en
-- fase4_cierre.sql; cuando se cierre la lectura anónima hay que sumarla ahí (y darle la clave al tablero).
--
-- Correrlo UNA vez en el SQL Editor de Supabase ANTES de publicar el tablero nuevo (sin la tabla, el tablero
-- funciona igual pero sin el botón). Transaccional e idempotente. Se deshace con proximos_hechos_deshacer.sql.

begin;

create table if not exists public.sanidad_proximos_hechos (
  id bigint generated always as identity primary key,
  establecimiento text not null check (establecimiento in ('la_vuelta', 'maria_laura', 'pone_chico')),
  categoria text not null check (length(categoria) between 1 and 80),
  sanidad text not null check (length(sanidad) between 1 and 80),
  fecha_prevista date not null,
  marcado_en timestamptz not null default now(),
  constraint sanidad_proximos_hechos_unico unique (establecimiento, categoria, sanidad, fecha_prevista)
);

alter table public.sanidad_proximos_hechos enable row level security;

-- permisos explícitos (desde el 30/10/2026 Supabase deja de darlos solo a las tablas nuevas)
revoke all on public.sanidad_proximos_hechos from anon, authenticated;
grant select, insert, delete on public.sanidad_proximos_hechos to anon;
grant all on public.sanidad_proximos_hechos to service_role;

drop policy if exists sanidad_proximos_hechos_select on public.sanidad_proximos_hechos;
drop policy if exists sanidad_proximos_hechos_insert on public.sanidad_proximos_hechos;
drop policy if exists sanidad_proximos_hechos_delete on public.sanidad_proximos_hechos;
create policy sanidad_proximos_hechos_select on public.sanidad_proximos_hechos for select to anon using (true);
create policy sanidad_proximos_hechos_insert on public.sanidad_proximos_hechos for insert to anon with check (true);
create policy sanidad_proximos_hechos_delete on public.sanidad_proximos_hechos for delete to anon using (true);

commit;

-- Verificación (solo lee): tiene que dar rls = true y las 3 políticas.
select relrowsecurity as rls from pg_class where oid = 'public.sanidad_proximos_hechos'::regclass;
select policyname, cmd, roles from pg_policies where tablename = 'sanidad_proximos_hechos' order by policyname;
