-- Libro ordenado de movimientos con guía (compras, ventas, ventas entre dueños, campo ajeno, traslados).
-- Es la versión "limpia" de lo que las apps guardan como eventos en eventos_sync: una fila por
-- movimiento con todos sus datos (kilos, precios, comisión, descuentos...), vigente o anulado.
-- La llena el script pasar_traslados_a_excel.py (upsert idempotente por event_id) a la vez que
-- escribe el Excel, que queda como respaldo. Se corre UNA VEZ en el SQL Editor de Supabase.
--
-- SEGURIDAD: esta tabla lleva importes, descuentos y DICOSE de terceros, y el repo es PÚBLICO (la clave
-- anon está en cada app). Por eso anon NO tiene ningún permiso acá: ni select, ni insert, ni update.
-- La lee y la llena solo el script de la PC con la clave privada (secret / service_role), que vive en un
-- .env fuera del repo (ver INSTRUCCIONES_traslados_a_excel.txt). Ninguna pantalla de las apps la lee.

create table if not exists public.movimientos_dicose (
  event_id           uuid primary key,                 -- el del evento original en eventos_sync
  establecimiento    text not null,                    -- la_vuelta | maria_laura
  fecha              date not null,
  tipo               text not null,                    -- compra | venta | movimiento_guia | envio_campo_ajeno | retorno_campo_ajeno | traslado_salida | traslado_entrada
  guia               text,
  potrero            text,
  categoria          text,                             -- categoría de la app
  categoria_excel    text,                             -- código/nombre en el Excel (VINV, VCUT, Vacas Inv ...)
  cantidad           integer,
  dueno              text,                             -- propietario / comprador (como en la app)
  contraparte        text,                             -- origen (compra) o destino (venta)
  contraparte_dicose text,
  -- compra
  comprador          text,
  tipo_precio        text,                             -- Kg | Pieza
  kilos_brutos       numeric,
  destare            numeric,                          -- fracción (0.05 = 5 %)
  kilos_neto         numeric,
  precio             numeric,                          -- U$S por kg o por pieza, según tipo_precio
  importe            numeric,
  pct_comision       numeric,                          -- fracción
  importe_comision   numeric,
  comisionista       text,
  flete              numeric,
  pagado             boolean,
  km                 numeric,
  costo_total        numeric,
  -- venta
  precio_tipo        text,                             -- 1ª | 2ª
  precio_kg          numeric,
  kilos_pie          numeric,
  kilos_res          numeric,
  rendimiento        numeric,
  importe_bruto      numeric,
  plazo_dias         integer,
  imeba              numeric,
  inia               numeric,
  mevir              numeric,
  inac               numeric,
  mgap_tva           numeric,
  sepb               numeric,
  gastos             numeric,
  neto               numeric,
  -- control
  obs                text,
  estado             text not null default 'vigente' check (estado in ('vigente','anulado')),
  datos_completos    boolean not null default false,   -- true si trae kilos/precio (se completó en la PC)
  asentado_excel     boolean not null default false,
  asentado_excel_en  timestamptz,
  detalle            jsonb,                            -- el detalle crudo del evento
  creado_en          timestamptz,                      -- cuando se cargó (eventos_sync.creado_en)
  actualizado_en     timestamptz not null default now()
);

create index if not exists movimientos_dicose_fecha_idx on public.movimientos_dicose (establecimiento, fecha desc);
create index if not exists movimientos_dicose_guia_idx  on public.movimientos_dicose (guia);

alter table public.movimientos_dicose enable row level security;

-- Sin ninguna política para anon / authenticated: con RLS activa eso ya los deja afuera. Se quitan además los
-- permisos que Supabase da por defecto a las tablas nuevas, por si alguien desactiva la RLS sin querer.
-- (service_role se saltea la RLS: es la clave privada que usa el script.)
drop policy if exists movimientos_dicose_select on public.movimientos_dicose;
drop policy if exists movimientos_dicose_insert on public.movimientos_dicose;
drop policy if exists movimientos_dicose_update on public.movimientos_dicose;

revoke all on public.movimientos_dicose from anon, authenticated;
grant all on public.movimientos_dicose to service_role;

-- Solo lo vigente, listo para reportes. security_invoker = true: la vista usa los permisos de quien la consulta
-- (si no, correría con los del dueño y dejaría pasar a anon por la puerta de atrás).
create or replace view public.movimientos_dicose_vigentes
  with (security_invoker = true) as
  select * from public.movimientos_dicose where estado = 'vigente';

revoke all on public.movimientos_dicose_vigentes from anon, authenticated;
grant select on public.movimientos_dicose_vigentes to service_role;
