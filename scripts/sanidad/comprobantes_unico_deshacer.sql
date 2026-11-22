-- Deshace comprobantes_unico.sql (17/11/2026). Sin el indice, cargar_factura.py sigue andando (mira antes si la
-- factura ya estaba, y comprobantes_uq, el parcial que ya existia, sigue frenando un numero repetido); solo pierde
-- el on_conflict de PostgREST.
drop index if exists public.comprobantes_proveedor_tipo_numero_key;
