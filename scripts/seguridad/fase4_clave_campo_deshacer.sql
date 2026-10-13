-- =====================================================================================
-- DESHACER la Fase 4, Release 1 (clave del campo, modo suave).
--
-- Saca todo lo que creo fase4_clave_campo.sql: el trigger de equipos vistos, las funciones
-- (establecimientos_con_clave, verificar_clave, cargar_clave), las dos tablas del esquema `private` y el
-- esquema. Las politicas y permisos de las tablas no los toco ese script, asi que no hay nada que restaurar.
--
-- ATENCION:
--   * BORRA las claves cargadas con private.cargar_clave y la lista de equipos vistos. Si despues se vuelve
--     a correr fase4_clave_campo.sql, hay que cargar las 3 claves de nuevo.
--   * Si ya se corrio el cierre (fase4_cierre.sql), las politicas dependen de
--     public.establecimientos_con_clave() y este script FALLA a proposito (la transaccion no deja nada a
--     medias). En ese caso primero hay que deshacer el cierre con fase4_cierre_deshacer.sql.
--   * Con la app nueva ya publicada, sin verificar_clave la pantalla "Clave del campo" avisa "no se pudo
--     comprobar la clave" y la app sigue andando igual (en el modo suave la clave no corta nada).
-- =====================================================================================

begin;

drop trigger if exists eventos_sync_equipos_vistos on public.eventos_sync;
drop function if exists private.registrar_equipo_visto();

drop function if exists public.verificar_clave(text, text);
drop function if exists public.establecimientos_con_clave();
drop function if exists private.cargar_clave(text, text);

drop table if exists private.equipos_vistos;
drop table if exists private.claves_campo;

-- Falla si quedo algo adentro que no creo este script (no se pierde nada ajeno).
drop schema if exists private;

notify pgrst, 'reload schema';

select 'Fase 4 (release 1) deshecha' as resultado;

commit;
