-- Renombra el tratamiento histórico "Tickxan plus" a "Tickxan Pour on plus" (20/10/2026).
-- Es 1 sola fila en todo el proyecto: sanidad_carga (La Vuelta), id sc_1789781703541_f681d4b1,
-- 24/7/2025, 54 animales V. Inv. Se corre a mano en el SQL Editor de Supabase (rol postgres:
-- la app no puede, porque la fila ya fue importada por el Excel y la política lo impide).
-- Hacer ANTES el cambio de nombre en la Planilla Sanitaria v22, o el Excel conserva el nombre viejo.

begin;

update sanidad_carga
   set producto1 = 'Tickxan Pour on plus'
 where id = 'sc_1789781703541_f681d4b1'
   and producto1 = 'Tickxan plus';          -- debe decir "UPDATE 1"

-- Verificación: no debe quedar ninguna con el nombre viejo, y debe haber 1 con el nuevo.
select producto1, count(*) from sanidad_carga
 where producto1 ilike 'tickxan%' or producto2 ilike 'tickxan%'
 group by 1;

commit;
