-- 17/11/2026, a pedido de Pedro: facturas de veterinaria por Hermes (scripts/hermes/cargar_factura.py).
-- Que la MISMA factura no se pueda cargar dos veces: si se duplicara, el stock de Insumos contaria la compra doble
-- (movimientos_insumo suma precios_vet x comprobantes). Hasta hoy comprobantes no tenia ningun unico.
--
-- Aditivo: solo agrega un indice unico. No cambia permisos (comprobantes sigue cerrado a la llave publica desde la
-- Fase 6; lo escribe la clave privada). No es parcial a proposito: PostgREST (on_conflict) no puede usar un indice
-- parcial. Los numero NULL no chocan entre si (NULL distinto de NULL), asi que listas sin numero siguen entrando.
-- El script ademas compara el numero normalizado ("e-Factura A 106208" = "A-106208"), que el indice no ve.
--
-- Como se corre: SQL Editor de Supabase, pegar todo, Run. Si ya hubiera dos comprobantes iguales, aborta sin crear
-- nada y lista cuales (se arreglan a mano con Pedro). Se deshace con comprobantes_unico_deshacer.sql.
begin;

do $$
declare
  dup text;
begin
  select string_agg(format('proveedor %s %s %s (ids %s)', proveedor_id, tipo, numero, ids), '; ')
    into dup
    from (select proveedor_id, tipo, numero, string_agg(id::text, ',') as ids
            from public.comprobantes
           where numero is not null
           group by proveedor_id, tipo, numero
          having count(*) > 1) d;
  if dup is not null then
    raise exception 'Hay comprobantes repetidos; arreglarlos antes: %', dup;
  end if;
end
$$;

create unique index if not exists comprobantes_proveedor_tipo_numero_key
  on public.comprobantes (proveedor_id, tipo, numero);

-- Verificacion: tiene que listar el indice.
select indexname, indexdef from pg_indexes
 where schemaname = 'public' and tablename = 'comprobantes' and indexname = 'comprobantes_proveedor_tipo_numero_key';

commit;
