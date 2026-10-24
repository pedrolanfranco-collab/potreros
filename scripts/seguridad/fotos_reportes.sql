-- =====================================================================================
--   FOTOS DE LOS REPORTES DE CAMPO (Infraestructura / Capín Annoni), 24/10/2026.
--
--   Crea el bucket PRIVADO `fotos-reportes` (un JPEG por foto, máximo 1 MB) y deja que la
--   llave pública (`anon`) solo SUBA (INSERT) y MIRE (SELECT) fotos dentro de la carpeta de
--   un establecimiento conocido. Sin UPDATE ni DELETE, igual que eventos_sync: una foto
--   subida no se cambia ni se borra desde la app.
--
--   Ruta de cada foto: <establecimiento>/<reporteId>/<fotoId>.jpg
--
--   ORDEN: correr ESTE SQL en el SQL Editor ANTES de publicar la versión de la app que sube
--   fotos (si no, la subida falla y las fotos quedan en la cola del equipo, sin perderse).
--   Es una transacción: si algo falla, no queda nada aplicado. Se puede volver a correr.
--
--   Pone Chico no usa clave del campo (CONFIG.claveCampo = false): por eso el SELECT y el
--   INSERT siguen abiertos a `anon` aquí. Cuando se cierre la Fase 4 (fase4_cierre.sql), este
--   bucket tiene que sumarse a esas políticas (ver scripts/seguridad/README.md).
-- =====================================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-reportes', 'fotos-reportes', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fotos_reportes_insert on storage.objects;
create policy fotos_reportes_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'fotos-reportes'
    and (storage.foldername(name))[1] in ('la_vuelta', 'maria_laura', 'pone_chico')
  );

drop policy if exists fotos_reportes_select on storage.objects;
create policy fotos_reportes_select on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'fotos-reportes'
    and (storage.foldername(name))[1] in ('la_vuelta', 'maria_laura', 'pone_chico')
  );

commit;

-- Consulta de verificación (solo lectura): debe mostrar el bucket y las 2 políticas.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'fotos-reportes';
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'fotos_reportes_%';
