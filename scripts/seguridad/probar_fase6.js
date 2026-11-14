// Prueba de la Fase 6 (fase6_endurecer.sql + su _deshacer.sql) contra un Postgres real (PGlite, en WASM), SIN tocar
// Supabase: arma las tablas, vistas, funciones, permisos y defaults de hoy (copiados de produccion el 14/11/2026),
// aplica el endurecimiento, prueba como anon / authenticated / service_role, y despues corre el deshacer y comprueba
// que permisos, politicas, defaults y funciones vuelven exactamente a como estaban.
//
// PGlite no es una dependencia del repo. Se instala aparte, en una carpeta temporal (igual que probar_cierre.js):
//     mkdir %TEMP%\pglite && cd %TEMP%\pglite && npm init -y && npm install @electric-sql/pglite@0.2.17
//     set PGLITE_DIR=%TEMP%\pglite\node_modules\@electric-sql\pglite
//     node scripts/seguridad/probar_fase6.js
// Sale con codigo 1 si algo falla.
const fs = require('fs');
const path = require('path');
const { PGlite } = require(process.env.PGLITE_DIR || '@electric-sql/pglite');

const DIR = __dirname + path.sep;
const sqlFase6 = fs.readFileSync(DIR + 'fase6_endurecer.sql', 'utf8');
const sqlDeshacer = fs.readFileSync(DIR + 'fase6_endurecer_deshacer.sql', 'utf8');

const fallas = [];
let n = 0;
function check(nombre, ok, detalle) {
  n++;
  console.log((ok ? '  OK  ' : '  MAL ') + nombre + (ok ? '' : '   -> ' + detalle));
  if (!ok) fallas.push(nombre);
}

// Lo que hay hoy en produccion, reducido a lo que toca la Fase 6.
const ESQUEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create schema private;
create table private.campos_abiertos (establecimiento text primary key);
insert into private.campos_abiertos values ('pone_chico');
create function public.establecimientos_permitidos() returns text[] language sql stable security definer set search_path = ''
  as $f$ select coalesce(array_agg(establecimiento), array[]::text[]) from private.campos_abiertos $f$;

create table public.proveedores (id bigserial primary key, nombre text);
create table public.comprobantes (id bigserial primary key, proveedor_id bigint, numero text, total numeric, establecimiento text, fecha date);
create table public.precios_vet (id bigserial primary key, comprobante_id bigint, proveedor_id bigint, producto text, fecha date, cantidad numeric, contenido_envase numeric, precio_unitario numeric);
create table public.cotizaciones (fecha date, moneda text, usd_por_unidad numeric);
create table public.alias_productos (id bigserial primary key, producto text);
create table public.insumos_alias (texto text, producto text);
create table public.insumos_ajustes (id bigserial primary key, establecimiento text, producto text, fecha date, tipo text, cantidad_ml numeric);
create table public.eventos_sync (id uuid primary key default gen_random_uuid(), establecimiento text not null, dispositivo text,
  tipo text not null, potrero text, detalle jsonb, fecha_cliente text, creado_en timestamptz not null default now(), event_id uuid unique);

create view public.precio_ultimo with (security_invoker = true) as
  select distinct on (p.producto) p.producto, pr.nombre as proveedor, p.fecha, p.precio_unitario
  from public.precios_vet p join public.proveedores pr on pr.id = p.proveedor_id order by p.producto, p.fecha desc;
create view public.precio_vigente with (security_invoker = true) as select * from public.precio_ultimo;
create view public.comparacion_catalogo with (security_invoker = true) as select * from public.precio_ultimo;
create view public.movimientos_insumo with (security_invoker = true) as
  select c.establecimiento, p.producto, p.fecha, p.cantidad * p.contenido_envase as ml
  from public.precios_vet p join public.comprobantes c on c.id = p.comprobante_id;
create view public.stock_insumos with (security_invoker = true) as
  select i.establecimiento, i.producto, i.cantidad_ml + coalesce(sum(m.ml), 0) as stock_ml
  from public.insumos_ajustes i left join public.movimientos_insumo m on m.establecimiento = i.establecimiento and m.producto = i.producto
  where i.tipo = 'inicial' group by i.establecimiento, i.producto, i.cantidad_ml;

create function public.stock_insumos_app() returns setof public.stock_insumos language sql stable security definer
  set search_path = public
  as $f$ select * from public.stock_insumos where establecimiento = any (public.establecimientos_permitidos()) order by establecimiento, producto $f$;
create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path = pg_catalog
  as $f$ begin null; end $f$;
grant execute on function public.rls_auto_enable() to public;

alter table public.proveedores enable row level security;
alter table public.comprobantes enable row level security;
alter table public.precios_vet enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.alias_productos enable row level security;
alter table public.insumos_alias enable row level security;
alter table public.insumos_ajustes enable row level security;
alter table public.eventos_sync enable row level security;
create policy lectura_anon on public.comprobantes for select to anon, authenticated using (true);
create policy lectura_anon on public.proveedores for select to anon, authenticated using (true);
create policy lectura_anon on public.precios_vet for select to anon, authenticated using (true);
create policy lectura_anon on public.cotizaciones for select to anon, authenticated using (true);
create policy lectura_anon on public.alias_productos for select to anon, authenticated using (true);
create policy insumos_ajustes_select_clave on public.insumos_ajustes for select to anon
  using (establecimiento = any ((select public.establecimientos_permitidos())::text[]));
create policy eventos_sync_select_clave on public.eventos_sync for select to anon
  using (establecimiento = any ((select public.establecimientos_permitidos())::text[]));
create policy eventos_sync_insert_clave on public.eventos_sync for insert to anon
  with check (establecimiento = any ((select public.establecimientos_permitidos())::text[]));

insert into public.proveedores (nombre) values ('El Gaucho');
insert into public.comprobantes (proveedor_id, numero, total, establecimiento, fecha) values (1, 'A-1', 100, 'pone_chico', '2026-11-01');
insert into public.precios_vet (comprobante_id, proveedor_id, producto, fecha, cantidad, contenido_envase, precio_unitario)
  values (1, 1, 'Ivermectina', '2026-11-01', 2, 500, 40);
insert into public.cotizaciones values ('2026-11-01', 'UYU', 0.025);
insert into public.alias_productos (producto) values ('Ivermectina');
insert into public.insumos_ajustes (establecimiento, producto, fecha, tipo, cantidad_ml) values ('pone_chico', 'Ivermectina', '2026-10-01', 'inicial', 100);
insert into public.eventos_sync (establecimiento, tipo, potrero, detalle, fecha_cliente) values ('pone_chico', 'lluvia', 'P1', '{"mm": 12}', '2026-11-01');
`;

async function como(db, rol, sql) {
  try {
    await db.exec('reset role');
    await db.exec('set role ' + rol);
    const r = await db.query(sql);
    return { filas: r.rows.length, rows: r.rows, error: null };
  } catch (e) {
    return { filas: 0, rows: [], error: e.message };
  } finally {
    await db.exec('reset role');
  }
}

const FOTO_PERMISOS = `select c.relname || ':' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type as p
  from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','S','p')
    and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
    and c.relname not like 'auditoria_%' order by 1`;
const FOTO_POLITICAS = `select tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') as p
  from pg_policies where schemaname = 'public' order by 1`;
const FOTO_DEFAULTS = `select defaclobjtype::text || ':' || defaclacl::text as p from pg_default_acl
  where defaclnamespace = 'public'::regnamespace order by 1`;
// los permisos de cada funcion como conjunto (Postgres puede reordenar las entradas del ACL al volver a darlos)
const FOTO_FUNCIONES = `select p.proname || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':' ||
    coalesce((select string_agg(x, ',' order by x) from (
                select case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end || '=' || a.privilege_type as x
                from aclexplode(p.proacl) a) s), '') as p
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('stock_insumos_app', 'rls_auto_enable') order by 1`;
const foto = async (db, q) => (await db.query(q)).rows.map(r => r.p);

async function main() {
  const db = new PGlite();
  await db.exec(ESQUEMA);

  console.log('\n=== antes de la Fase 6 (como esta hoy)');
  check('anon lee comprobantes con la llave publica', (await como(db, 'anon', 'select * from public.comprobantes')).filas === 1);
  check('anon lee precio_ultimo', (await como(db, 'anon', 'select * from public.precio_ultimo')).filas === 1);

  const permAntes = await foto(db, FOTO_PERMISOS);
  const polAntes = await foto(db, FOTO_POLITICAS);
  const defAntes = await foto(db, FOTO_DEFAULTS);
  const funAntes = await foto(db, FOTO_FUNCIONES);

  await db.exec(sqlFase6);
  await db.exec(sqlFase6);   // idempotente
  check('el script corre dos veces sin error (y el respaldo queda de la primera)',
    (await db.query('select count(distinct guardado_en)::int n from public.auditoria_privilegios_antes_fase6')).rows[0].n === 1);

  console.log('\n=== compras y precios');
  for (const t of ['comprobantes', 'proveedores', 'precios_vet', 'cotizaciones', 'alias_productos', 'insumos_alias',
                   'precio_ultimo', 'precio_vigente', 'comparacion_catalogo', 'movimientos_insumo', 'stock_insumos']) {
    const r = await como(db, 'anon', `select * from public.${t}`);
    check(`anon no lee ${t} (permiso denegado, no lista vacia)`, /permission denied/.test(r.error || ''), r.error || r.filas + ' filas');
  }
  const ins = await como(db, 'anon', `insert into public.comprobantes (numero) values ('X')`);
  check('anon no escribe comprobantes', /permission denied/.test(ins.error || ''), ins.error);
  const sia = await como(db, 'anon', 'select * from public.stock_insumos_app()');
  check('la app sigue leyendo el stock de insumos por stock_insumos_app() (Pone Chico, campo abierto)',
    !sia.error && sia.filas === 1 && Number(sia.rows[0].stock_ml) === 1100, sia.error || JSON.stringify(sia.rows));
  await db.exec('grant all on all tables in schema public to service_role');
  check('service_role (clave privada: scripts y skill de precios) sigue leyendo comprobantes',
    (await como(db, 'service_role', 'select * from public.comprobantes')).filas === 1);
  check('las politicas lectura_anon ya no existen',
    (await db.query(`select count(*)::int n from pg_policies where policyname = 'lectura_anon'`)).rows[0].n === 0);

  console.log('\n=== tope de tamano en eventos_sync');
  const ok = await como(db, 'anon', `insert into public.eventos_sync (establecimiento, tipo, potrero, detalle, fecha_cliente, dispositivo)
    values ('pone_chico', 'movimiento_multi', 'Potrero del bajo', '{"items": [{"categoria": "Vacas", "cantidad": 30}]}', '2026-11-14T10:00:00', 'movil-abc')`);
  check('un evento normal entra', !ok.error, ok.error);
  const grande = await como(db, 'anon', `insert into public.eventos_sync (establecimiento, tipo, detalle)
    values ('pone_chico', 'lluvia', jsonb_build_object('relleno', repeat('x', 20000)))`);
  check('un detalle de 20 KB se rechaza', /eventos_sync_tamanos/.test(grande.error || ''), grande.error || 'entro');
  const justo = await como(db, 'anon', `insert into public.eventos_sync (establecimiento, tipo, detalle)
    values ('pone_chico', 'lluvia', jsonb_build_object('r', repeat('x', 16000)))`);
  check('un detalle de 16 000 caracteres todavia entra', !justo.error, justo.error);
  const tipoLargo = await como(db, 'anon', `insert into public.eventos_sync (establecimiento, tipo) values ('pone_chico', repeat('t', 61))`);
  check('un tipo de 61 caracteres se rechaza', /eventos_sync_tamanos/.test(tipoLargo.error || ''), tipoLargo.error || 'entro');
  const potLargo = await como(db, 'anon', `insert into public.eventos_sync (establecimiento, tipo, potrero) values ('pone_chico', 'lluvia', repeat('p', 121))`);
  check('un potrero de 121 caracteres se rechaza', /eventos_sync_tamanos/.test(potLargo.error || ''), potLargo.error || 'entro');
  const nulos = await como(db, 'anon', `insert into public.eventos_sync (establecimiento, tipo) values ('pone_chico', 'lluvia')`);
  check('detalle, potrero y dispositivo vacios (null) entran', !nulos.error, nulos.error);

  console.log('\n=== permisos de mas');
  check('authenticated sin ningun permiso de tabla ni secuencia en public',
    (await db.query(`select count(*)::int n from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace and a.grantee = 'authenticated'::regrole`)).rows[0].n === 0);
  const tr = await como(db, 'anon', 'truncate public.eventos_sync');
  check('anon no puede TRUNCATE eventos_sync', /permission denied/.test(tr.error || ''), tr.error || 'borro todo');
  check('anon sigue con SELECT e INSERT en eventos_sync (la app no cambia)',
    (await db.query(`select has_table_privilege('anon','public.eventos_sync','select') and has_table_privilege('anon','public.eventos_sync','insert') ok`)).rows[0].ok);
  await db.exec('create table public.tabla_nueva (id bigserial primary key, x text)');
  check('una tabla nueva no nace con permisos para anon',
    !(await db.query(`select has_table_privilege('anon','public.tabla_nueva','select') ok`)).rows[0].ok);
  check('ni para authenticated',
    !(await db.query(`select has_table_privilege('authenticated','public.tabla_nueva','select') ok`)).rows[0].ok);
  check('ni su secuencia',
    !(await db.query(`select has_sequence_privilege('anon','public.tabla_nueva_id_seq','usage') ok`)).rows[0].ok);
  await db.exec('drop table public.tabla_nueva');

  console.log('\n=== funciones');
  check('stock_insumos_app con search_path vacio',
    (await db.query(`select array_to_string(proconfig, ',') c from pg_proc where proname = 'stock_insumos_app'`)).rows[0].c === 'search_path=""');
  check('rls_auto_enable ya no es ejecutable por anon',
    !(await db.query(`select has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') ok`)).rows[0].ok);

  console.log('\n=== deshacer');
  await db.exec(`delete from public.eventos_sync where octet_length(detalle::text) > 1000`);   // el de 16 000 de la prueba
  await db.exec(sqlDeshacer);
  const permDespues = await foto(db, FOTO_PERMISOS);
  const polDespues = await foto(db, FOTO_POLITICAS);
  const defDespues = await foto(db, FOTO_DEFAULTS);
  const funDespues = await foto(db, FOTO_FUNCIONES);
  const dif = (a, b) => a.filter(x => !b.includes(x)).concat(b.filter(x => !a.includes(x)).map(x => '+' + x)).join(' | ');
  check('permisos de anon y authenticated identicos a los de antes', dif(permAntes, permDespues) === '', dif(permAntes, permDespues));
  check('politicas identicas', dif(polAntes, polDespues) === '', dif(polAntes, polDespues));
  check('defaults de lo nuevo identicos', dif(defAntes, defDespues) === '', dif(defAntes, defDespues));
  check('funciones identicas (permisos y search_path)', dif(funAntes, funDespues) === '', dif(funAntes, funDespues));
  check('anon vuelve a leer comprobantes', (await como(db, 'anon', 'select * from public.comprobantes')).filas === 1);
  check('sin tope de tamano',
    (await db.query(`select count(*)::int n from pg_constraint where conname = 'eventos_sync_tamanos'`)).rows[0].n === 0);

  console.log('\n=== una fila vieja que no cumple el tope aborta TODO (nada queda a medias)');
  const db2 = new PGlite();
  await db2.exec(ESQUEMA);
  await db2.exec(`insert into public.eventos_sync (establecimiento, tipo, detalle) values ('pone_chico', 'lluvia', jsonb_build_object('r', repeat('x', 20000)))`);
  let error = null;
  try { await db2.exec(sqlFase6); } catch (e) { error = e.message; }
  check('el script falla en VALIDATE', /eventos_sync_tamanos/.test(error || ''), error || 'no fallo');
  await db2.exec('rollback').catch(() => {});
  check('y anon sigue leyendo comprobantes (no se aplico nada)', (await como(db2, 'anon', 'select * from public.comprobantes')).filas === 1);
  check('ni quedo el respaldo', (await db2.query(`select to_regclass('public.auditoria_privilegios_antes_fase6') t`)).rows[0].t === null);

  console.log(`\n${n - fallas.length} de ${n} verificaciones bien` + (fallas.length ? `; FALLARON: ${fallas.join('; ')}` : ''));
  process.exit(fallas.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
