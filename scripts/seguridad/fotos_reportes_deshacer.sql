-- =====================================================================================
--   VUELTA ATRÁS de fotos_reportes.sql (fotos de los reportes de campo, 24/10/2026).
--
--   Saca las dos políticas del bucket. El bucket `fotos-reportes` se borra SOLO si está
--   vacío: si ya hay fotos subidas, no se toca (borrarlo perdería las fotos). Con las
--   políticas sacadas, la app sigue andando, pero sin poder subir ni ver fotos nuevas.
--   Transacción: si algo falla, no queda nada aplicado.
-- =====================================================================================

begin;

drop policy if exists fotos_reportes_insert on storage.objects;
drop policy if exists fotos_reportes_select on storage.objects;

delete from storage.buckets
where id = 'fotos-reportes'
  and not exists (select 1 from storage.objects where bucket_id = 'fotos-reportes');

commit;
