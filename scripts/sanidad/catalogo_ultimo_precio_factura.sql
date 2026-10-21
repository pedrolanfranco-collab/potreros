-- 21/10/2026, a pedido de Pedro. Aplicado en Supabase como migración "catalogo_conserva_ultimo_precio_factura".
-- La Planilla republica productos_catalogo (DELETE + POST) con costos calculados por fórmulas, que no se pueden
-- tocar. Este trigger, al insertar cada fila, reemplaza valor_dosis_ml por el USD/ml de precio_ultimo (la última
-- factura cargada) si el producto tiene una; sin factura queda lo que publica la Planilla.
-- Para quitarlo: drop trigger trg_catalogo_ultimo_precio on public.productos_catalogo;
--                drop function public.catalogo_aplicar_ultimo_precio();
create or replace function public.catalogo_aplicar_ultimo_precio()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v numeric;
begin
  select u.usd_por_ml into v
    from precio_ultimo u
   where u.producto = new.producto
     and u.usd_por_ml is not null;
  if found then
    new.valor_dosis_ml := v;
  end if;
  return new;
end $$;

create or replace trigger trg_catalogo_ultimo_precio
  before insert on public.productos_catalogo
  for each row execute function public.catalogo_aplicar_ultimo_precio();
