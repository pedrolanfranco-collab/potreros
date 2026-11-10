-- Propietario del SNIG en el padron por caravana (9/11/2026).
--
-- Tres columnas NUEVAS en animales_caravana, todas opcionales. Es aditivo: no
-- renombra ni borra nada, asi que las apps con version vieja siguen andando.
--
--   propietario_snig  nombre del propietario segun el SNIG (nunca el codigo DICOSE)
--   en_snig           true: el SNIG la tiene; false: el SNIG no la tiene aunque
--                     hay export de ese campo; null: no hay export de ese campo
--   campo_snig        campo donde el SNIG ubica el animal (la_vuelta, maria_laura)
--
-- Correr en el SQL Editor de Supabase ANTES de publicar con publicar_animales.py
-- (regla 11 del CLAUDE.md). Si se publica antes, el Lector igual funciona: saca
-- las columnas que la tabla no tiene y avisa en el log.
alter table animales_caravana add column if not exists propietario_snig text;
alter table animales_caravana add column if not exists en_snig boolean;
alter table animales_caravana add column if not exists campo_snig text;

-- Segunda parte (9/11/2026, mismo dia): fecha de ingreso al predio segun el SNIG.
-- Sirve para los animales que estan en el SNIG pero el baston nunca leyo: pasados
-- 6 meses desde esa fecha sin lectura, la app los marca "Vivo sin registro en el
-- predio" (la cuenta la hace el celular con su fecha de hoy, igual que la carencia).
alter table animales_caravana add column if not exists snig_ingreso date;
