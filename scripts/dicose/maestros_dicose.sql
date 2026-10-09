-- Catálogos compartidos de la empresa ganadera (La Vuelta y María Laura usan los mismos):
--   comprador    : quién compra por la empresa (Pedro, Silvia, Caro, ...)
--   comisionista : intermediario de una compra (Julio Xavier, Fabian Braga, Directo, ...)
--   contraparte  : clientes y proveedores (origen de una compra / destino de una venta), con DICOSE y tipo
-- Se corre UNA VEZ en el SQL Editor de Supabase (proyecto "Gestion ganadera").
-- Las apps (PC y móvil) lo leen al abrir Movimientos DICOSE; la PC agrega nuevos. Sin DELETE: para sacar
-- una entrada de las listas se pone activo = false (con la clave privada).

create table if not exists public.maestros_dicose (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null check (tipo in ('comprador','comisionista','contraparte')),
  nombre           text not null,
  dicose           text,
  tipo_contraparte text check (tipo_contraparte in ('Cliente','Productor','Destinatario','Intermediario')),
  activo           boolean not null default true,
  creado_por       text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint maestros_dicose_unico unique (tipo, nombre)
);

alter table public.maestros_dicose enable row level security;

-- Las apps (clave anon, sin login) solo pueden LEER y AGREGAR entradas nuevas; NO actualizar ni borrar
-- (el repo es público: así nadie con la clave anon puede pisar un DICOSE ni vaciar las listas). La app agrega
-- con upsert + ignoreDuplicates (ON CONFLICT DO NOTHING), que no necesita UPDATE.
-- Corregir un DICOSE o desactivar una entrada (activo = false) lo hace solo la clave privada de la PC
-- (sembrar_maestros_dicose.py) o el panel de Supabase.
drop policy if exists maestros_dicose_select on public.maestros_dicose;
drop policy if exists maestros_dicose_insert on public.maestros_dicose;
drop policy if exists maestros_dicose_update on public.maestros_dicose;
create policy maestros_dicose_select on public.maestros_dicose for select to anon using (true);
create policy maestros_dicose_insert on public.maestros_dicose for insert to anon with check (true);

revoke all on public.maestros_dicose from anon, authenticated;
grant select, insert on public.maestros_dicose to anon;
grant all on public.maestros_dicose to service_role;
