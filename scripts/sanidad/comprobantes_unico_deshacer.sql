-- Deshace comprobantes_unico.sql (17/11/2026). Sin el indice, cargar_factura.py sigue andando (mira antes si la
-- factura ya estaba), pero una respuesta perdida podria dejar la misma factura dos veces.
drop index if exists public.comprobantes_proveedor_tipo_numero_key;
