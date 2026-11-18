-- =====================================================================================
-- Categorias de animales: un patron unico y una tabla de equivalencias (18/11/2026, a pedido de Pedro).
--
-- Hoy la misma categoria se escribe de 4 formas: la app ("Vacas de invernada"), la Planilla Sanitaria vieja
-- ("V. Inv."), el baston/SNIG ("Vaca de invernada", "VINV") y el Excel de DICOSE ("VINV"). Por eso los vencimientos
-- con nombres viejos de sanidad_proximos nunca se cerraban solos.
--
--   * public.categorias        el patron: las 24 categorias de la app (ESPECIES del template), con su especie.
--   * public.categorias_alias  nombre viejo o de otro sistema (en minusculas) -> categoria del patron.
--                              Equivalencias revisadas y aprobadas por Pedro el 18/11/2026.
--   * public.categoria_patron(t)  traduce un nombre: alias -> patron; un nombre del patron en otra mayuscula ->
--                              el del patron; cualquier otro (p. ej. "Consumo", "Sin categoria") queda igual.
--
-- No reescribe ningun dato historico (sanidad_carga sigue como esta, igual que el Excel). La traduccion se aplica al
-- publicar Proximos y Ultimos (scripts/sanidad/actualizar_sanidad_supabase.py). Aditivo: no cambia nada que usen las
-- apps. Desde la Fase 6 lo nuevo en public no nace con permisos para la llave publica: estas tablas solo las lee la
-- clave privada (los scripts de la PC).
--
-- Ademas copia cada "Ya se hizo" del tablero de Sanidad (sanidad_proximos_hechos) a su nombre del patron, con la misma
-- fecha y el mismo marcado_en, para que las tarjetas viejas ya ocultas no reaparezcan con el nombre nuevo. No borra
-- las marcas originales.
--
-- Todo en una transaccion; se puede correr dos veces. Se deshace con categorias_deshacer.sql.
-- Probado contra Postgres real con probar_categorias.js (PGlite, sin tocar Supabase).
-- =====================================================================================

begin;

create table if not exists public.categorias (
  nombre  text primary key,
  especie text not null check (especie in ('bovino', 'ovino', 'equino')),
  orden   int  not null
);
alter table public.categorias enable row level security;

insert into public.categorias (nombre, especie, orden) values
  ('Terneros', 'bovino', 1), ('Terneras', 'bovino', 2),
  ('Novillitos 1-2 años', 'bovino', 3), ('Novillos 2-3 años', 'bovino', 4), ('Novillos +3 años', 'bovino', 5),
  ('Vaquillonas 1-2 años', 'bovino', 6), ('Vaquillonas 2-3 años', 'bovino', 7), ('Vaquillona de invernada', 'bovino', 8),
  ('Vacas', 'bovino', 9), ('Vacas de invernada', 'bovino', 10), ('Toros', 'bovino', 11), ('Bueyes', 'bovino', 12),
  ('Otros bovinos', 'bovino', 13),
  ('Corderos/as', 'ovino', 14), ('Ovejas', 'ovino', 15), ('Capones', 'ovino', 16), ('Carneros', 'ovino', 17),
  ('Borregos DL', 'ovino', 18), ('Borregas DL', 'ovino', 19), ('Otros ovinos', 'ovino', 20),
  ('Potros/as', 'equino', 21), ('Yeguas', 'equino', 22), ('Caballos', 'equino', 23), ('Otros equinos', 'equino', 24)
on conflict (nombre) do nothing;

create table if not exists public.categorias_alias (
  alias     text primary key check (alias = lower(btrim(alias)) and alias <> ''),
  categoria text not null references public.categorias (nombre),
  origen    text,
  nota      text
);
alter table public.categorias_alias enable row level security;

insert into public.categorias_alias (alias, categoria, origen, nota) values
  ('vaca',              'Vacas',                'Planilla, bastón, DICOSE', null),
  ('vaca cut',          'Vacas',                'bastón',   'regla del bastón del 7/10/2026'),
  ('v. cut',            'Vacas',                'Planilla', 'misma regla que Vaca CUT'),
  ('vaca de invernada', 'Vacas de invernada',   'bastón',   null),
  ('v. inv.',           'Vacas de invernada',   'Planilla', null),
  ('vinv',              'Vacas de invernada',   'bastón, DICOSE', null),
  ('ternero',           'Terneros',             'bastón, DICOSE', null),
  ('ternera',           'Terneras',             'bastón, DICOSE', null),
  ('ternero/a',         'Terneros',             'bastón',   'regla del bastón del 7/10/2026'),
  ('terneros/as',       'Terneros',             'DICOSE',   null),
  ('teros/as',          'Terneros',             'Planilla, bastón', 'Pedro 18/11/2026'),
  ('novillito 1-2',     'Novillitos 1-2 años',  'bastón',   null),
  ('nov12',             'Novillitos 1-2 años',  'bastón',   null),
  ('nov. 1 a 2',        'Novillitos 1-2 años',  'Planilla', null),
  ('novillo 2-3',       'Novillos 2-3 años',    'bastón',   null),
  ('nov. 2 a 3',        'Novillos 2-3 años',    'Planilla', null),
  ('nov +3',            'Novillos +3 años',     'Planilla', null),
  ('vaquillona',        'Vaquillonas 2-3 años', 'bastón',   'regla del bastón del 13/10/2026'),
  ('vaq',               'Vaquillonas 2-3 años', 'bastón',   null),
  ('vaq. 1 a 2',        'Vaquillonas 1-2 años', 'Planilla', null),
  ('vaq. +2',           'Vaquillonas 2-3 años', 'Planilla', 'Pedro 18/11/2026'),
  ('toro',              'Toros',                'bastón',   null),
  ('toritos',           'Toros',                'Planilla', 'Pedro 18/11/2026'),
  ('bgas dl',           'Borregas DL',          'Planilla', null),
  ('bgos dl',           'Borregos DL',          'Planilla', null)
on conflict (alias) do nothing;

create or replace function public.categoria_patron(t text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select a.categoria from public.categorias_alias a where a.alias = lower(btrim(t))),
    (select c.nombre from public.categorias c where lower(c.nombre) = lower(btrim(t))),
    t
  );
$$;

-- Permisos: solo la clave privada (service_role). Nada para anon ni authenticated.
revoke all on table public.categorias, public.categorias_alias from anon, authenticated;
grant select on table public.categorias, public.categorias_alias to service_role;
revoke all on function public.categoria_patron(text) from public, anon, authenticated;
grant execute on function public.categoria_patron(text) to service_role;

-- "Ya se hizo" del tablero: la misma marca con el nombre del patron (no se borra la original).
-- (el id lo pone la base: es "generated always as identity")
insert into public.sanidad_proximos_hechos (establecimiento, categoria, sanidad, fecha_prevista, marcado_en)
select distinct on (h.establecimiento, public.categoria_patron(h.categoria), h.sanidad, h.fecha_prevista)
       h.establecimiento, public.categoria_patron(h.categoria), h.sanidad, h.fecha_prevista, h.marcado_en
from public.sanidad_proximos_hechos h
where public.categoria_patron(h.categoria) <> h.categoria
  and not exists (select 1 from public.sanidad_proximos_hechos x
                  where x.establecimiento = h.establecimiento and x.categoria = public.categoria_patron(h.categoria)
                    and x.sanidad = h.sanidad and x.fecha_prevista = h.fecha_prevista);

-- Resultado.
select 'categorias del patron' as control, count(*)::text as detalle from public.categorias
union all select 'equivalencias', count(*)::text from public.categorias_alias
union all select 'prueba: V. Inv. -> ' || public.categoria_patron('V. Inv.') || ' | VACA -> ' || public.categoria_patron('VACA')
                 || ' | Consumo -> ' || public.categoria_patron('Consumo'), ''
union all select 'marcas "Ya se hizo" con nombre del patron',
       (select count(*)::text from public.sanidad_proximos_hechos h
        where exists (select 1 from public.categorias c where c.nombre = h.categoria));

commit;
