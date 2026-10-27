// Prueba del cierre de la Fase 4 (fase4_cierre.sql + su _deshacer.sql) contra un Postgres 16 real (PGlite, en
// WASM), SIN tocar Supabase: arma las tablas y las politicas de hoy, corre el release 1 de verdad, carga claves
// de JUGUETE, aplica el cierre y prueba lectura y escritura de anon sin clave, con clave mala y con la clave de
// cada campo; despues corre el deshacer y comprueba que todo vuelve a como estaba.
//
// PGlite no es una dependencia del repo. Se instala aparte, en una carpeta temporal:
//     mkdir %TEMP%\pglite && cd %TEMP%\pglite && npm init -y && npm install @electric-sql/pglite@0.2.17
//     set PGLITE_DIR=%TEMP%\pglite\node_modules\@electric-sql\pglite
//     node scripts/seguridad/probar_cierre.js
// Uso: node probar_cierre.js [<fase4_cierre.sql> [<fase4_cierre_deshacer.sql>]]   (por defecto, los de esta carpeta)
// Sale con codigo 1 si algo falla. Las claves de aca son de juguete; no hay ningun secreto.
const fs = require('fs');
const path = require('path');
const { PGlite } = require(process.env.PGLITE_DIR || '@electric-sql/pglite');

const REPO = __dirname + path.sep;
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const cierreSql = fs.readFileSync(args[0] || REPO + 'fase4_cierre.sql', 'utf8');
const deshacerSql = fs.readFileSync(args[1] || REPO + 'fase4_cierre_deshacer.sql', 'utf8');

const KEYS = { la_vuelta: 'clavelavuelta1', maria_laura: 'clavemarialaura1', pone_chico: 'clavepone00001' };
const fallas = [];
let n = 0;

function check(nombre, ok, detalle) {
  n++;
  console.log((ok ? '  OK  ' : '  MAL ') + nombre + (ok ? '' : '   -> ' + detalle));
  if (!ok) fallas.push(nombre);
}

const ESQUEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.eventos_sync (id bigserial primary key, event_id text, establecimiento text not null, tipo text, detalle jsonb default '{}'::jsonb, dispositivo text, creado_en timestamptz default now());
create table public.stock_potreros (establecimiento text not null, potrero text not null, categoria text not null, dueno text not null default '', cantidad int, actualizado_en timestamptz default now(), primary key (establecimiento, potrero, categoria, dueno));
create table public.sanidad_carga (id bigserial primary key, establecimiento text not null, producto text, importado_en timestamptz);
create table public.sanidad_carga_maria_laura (id bigserial primary key, producto text, importado_en timestamptz);
create table public.sanidad_carga_pone_chico (id bigserial primary key, producto text, importado_en timestamptz);
create table public.animales_caravana (id8 text primary key, establecimiento text not null);
create table public.productos_catalogo (producto text primary key, valor_dosis_ml numeric);
create table public.maestros_dicose (id bigserial primary key, tipo text, nombre text, dicose text);
create table public.sanidad_ultimos (id bigserial primary key, establecimiento text);
create table public.sanidad_proximos (id bigserial primary key, establecimiento text);
create table public.sanidad_proximos_hechos (id bigserial primary key, establecimiento text not null, categoria text, sanidad text, fecha_prevista date, marcado_en timestamptz default now());
create schema storage;
create table storage.buckets (id text primary key, name text);
insert into storage.buckets values ('fotos-reportes','fotos-reportes');
create table storage.objects (id bigserial primary key, bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
grant usage, select on all sequences in schema storage to anon, authenticated;
alter table storage.objects enable row level security;
create policy fotos_reportes_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'fotos-reportes' and (storage.foldername(name))[1] in ('la_vuelta', 'maria_laura', 'pone_chico'));
create policy fotos_reportes_select on storage.objects for select to anon, authenticated using (bucket_id = 'fotos-reportes' and (storage.foldername(name))[1] in ('la_vuelta', 'maria_laura', 'pone_chico'));
grant all on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
alter table public.eventos_sync enable row level security;
alter table public.stock_potreros enable row level security;
alter table public.sanidad_carga enable row level security;
alter table public.sanidad_carga_maria_laura enable row level security;
alter table public.sanidad_carga_pone_chico enable row level security;
alter table public.animales_caravana enable row level security;
alter table public.productos_catalogo enable row level security;
alter table public.maestros_dicose enable row level security;
alter table public.sanidad_ultimos enable row level security;
alter table public.sanidad_proximos enable row level security;
alter table public.sanidad_proximos_hechos enable row level security;
create policy sanidad_proximos_hechos_select on public.sanidad_proximos_hechos for select to anon using (true);
create policy sanidad_proximos_hechos_insert on public.sanidad_proximos_hechos for insert to anon with check (true);
create policy sanidad_proximos_hechos_delete on public.sanidad_proximos_hechos for delete to anon using (true);
-- las politicas de hoy en produccion (consultadas el 21/10/2026)
create policy animales_caravana_select_anon on public.animales_caravana for select to anon using (true);
create policy eventos_sync_insert on public.eventos_sync for insert to anon with check (true);
create policy eventos_sync_select on public.eventos_sync for select to anon using (true);
create policy maestros_dicose_insert on public.maestros_dicose for insert to anon with check (true);
create policy maestros_dicose_select on public.maestros_dicose for select to anon using (true);
create policy "anon puede leer" on public.productos_catalogo for select to anon using (true);
create policy sanidad_carga_delete_no_importado on public.sanidad_carga for delete to anon using (importado_en is null);
create policy "anon puede insertar" on public.sanidad_carga for insert to anon with check (true);
create policy "anon puede leer" on public.sanidad_carga for select to anon using (true);
create policy "anon puede actualizar" on public.sanidad_carga for update to anon using (true);
create policy sanidad_carga_maria_laura_delete on public.sanidad_carga_maria_laura for delete to anon using (true);
create policy "anon puede insertar" on public.sanidad_carga_maria_laura for insert to anon with check (true);
create policy "anon puede leer" on public.sanidad_carga_maria_laura for select to anon using (true);
create policy sanidad_carga_maria_laura_update on public.sanidad_carga_maria_laura for update to anon using (true) with check (true);
create policy sanidad_carga_pone_chico_delete on public.sanidad_carga_pone_chico for delete to anon using (true);
create policy "anon puede insertar" on public.sanidad_carga_pone_chico for insert to anon with check (true);
create policy "anon puede leer" on public.sanidad_carga_pone_chico for select to anon using (true);
create policy sanidad_carga_pone_chico_update on public.sanidad_carga_pone_chico for update to anon using (true) with check (true);
create policy sanidad_proximos_select_anon on public.sanidad_proximos for select to anon using (true);
create policy sanidad_ultimos_select_anon on public.sanidad_ultimos for select to anon using (true);
create policy stock_potreros_anon_all on public.stock_potreros for all to anon using (true) with check (true);
`;

const SEMILLA = `
insert into public.eventos_sync (event_id, establecimiento, tipo, dispositivo) values
  ('e-lv','la_vuelta','movimiento','d1'),('e-ml','maria_laura','movimiento','d2'),('e-pc','pone_chico','movimiento','d3');
insert into public.stock_potreros values ('la_vuelta','1','Vacas','',5),('maria_laura','1','Vacas','',6),('pone_chico','1','Vacas','',7);
insert into public.sanidad_carga (establecimiento, producto, importado_en) values
  ('la_vuelta','lv-pendiente',null),('la_vuelta','lv-importada',now()),('pone_chico','pc-en-tabla-lv',null);
insert into public.sanidad_carga_maria_laura (producto) values ('ml');
insert into public.sanidad_carga_pone_chico (producto) values ('pc');
insert into public.animales_caravana values ('11111111','la_vuelta');
insert into public.productos_catalogo values ('Ivomec', 1.5);
insert into public.maestros_dicose (tipo, nombre, dicose) values ('comprador','Fulano','123');
insert into public.sanidad_ultimos (establecimiento) values ('la_vuelta'),('maria_laura'),('pone_chico');
insert into public.sanidad_proximos (establecimiento) values ('la_vuelta'),('maria_laura'),('pone_chico');
insert into public.sanidad_proximos_hechos (establecimiento, categoria, sanidad, fecha_prevista) values
  ('la_vuelta','Vacas','X','2026-01-01'),('maria_laura','Vacas','X','2026-01-01'),('pone_chico','Vacas','X','2026-01-01');
insert into storage.objects (bucket_id, name) values
  ('fotos-reportes','la_vuelta/r1/f1.jpg'),('fotos-reportes','maria_laura/r1/f1.jpg'),('fotos-reportes','pone_chico/r1/f1.jpg'),('otro','la_vuelta/r1/f1.jpg');
`;

// Corre `sql` como anon con la clave `campo` (o sin clave / con una mala). Devuelve {filas, error}.
async function comoAnon(db, clave, sql) {
  const hdr = clave === null ? '{}' : JSON.stringify({ 'x-clave-campo': clave });
  try {
    await db.exec('reset role');
    await db.query("select set_config('request.headers', $1, false)", [hdr]);
    await db.exec('set role anon');
    const r = await db.query(sql);
    return { filas: r.affectedRows !== undefined && r.rows.length === 0 && /^\s*(insert|update|delete)/i.test(sql) ? r.affectedRows : r.rows.length, error: null, rows: r.rows };
  } catch (e) {
    return { filas: 0, error: e.message, rows: [] };
  } finally {
    await db.exec('reset role');
  }
}
const bloqueado = (r) => r.error !== null || r.filas === 0;

async function main() {
  const db = new PGlite();
  await db.exec(ESQUEMA);
  await db.exec(SEMILLA);
  await db.exec(fs.readFileSync(REPO + 'fase4_clave_campo.sql', 'utf8'));
  for (const [est, k] of Object.entries(KEYS)) await db.query('select private.cargar_clave($1,$2)', [est, k]);
  const politicasAntes = (await db.query("select tablename, policyname, cmd from pg_policies where schemaname in ('public','storage') order by 1,2,3")).rows;
  const privAntes = (await db.query("select c.relname t, p.priv from pg_class c cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv) where c.relnamespace='public'::regnamespace and c.relkind='r' and has_table_privilege('anon', c.oid, p.priv) order by 1,2")).rows;

  console.log('Aplicando el cierre...');
  await db.exec(cierreSql);
  await db.exec(cierreSql); // idempotente: segunda corrida sin error
  check('el cierre corre dos veces seguidas sin error', true);

  const LV = KEYS.la_vuelta, ML = KEYS.maria_laura, PC = KEYS.pone_chico, MALA = 'clavemalamala1';
  const cuenta = async (clave, tabla, filtro = '') => (await comoAnon(db, clave, `select * from public.${tabla} ${filtro}`));

  console.log('\nLECTURA');
  for (const [tabla, col] of [['eventos_sync', 'establecimiento'], ['stock_potreros', 'establecimiento']]) {
    const sin = await cuenta(null, tabla);
    check(`${tabla}: sin clave solo se ve pone_chico`, !sin.error && sin.rows.length === 1 && sin.rows[0][col] === 'pone_chico', JSON.stringify(sin));
    const mala = await cuenta(MALA, tabla);
    check(`${tabla}: clave mala = igual que sin clave`, !mala.error && mala.rows.length === 1 && mala.rows[0][col] === 'pone_chico', JSON.stringify(mala));
    const lv = await cuenta(LV, tabla);
    check(`${tabla}: con clave de La Vuelta ve La Vuelta + Pone Chico, no Maria Laura`,
      !lv.error && lv.rows.map(r => r[col]).sort().join() === 'la_vuelta,pone_chico', JSON.stringify(lv.rows));
    const ml = await cuenta(ML, tabla);
    check(`${tabla}: con clave de Maria Laura ve Maria Laura + Pone Chico, no La Vuelta`,
      !ml.error && ml.rows.map(r => r[col]).sort().join() === 'maria_laura,pone_chico', JSON.stringify(ml.rows));
  }
  check('sanidad_carga (La Vuelta): sin clave no se ve nada (ni la fila de pone_chico)', (await cuenta(null, 'sanidad_carga')).rows.length === 0);
  check('sanidad_carga: con clave de La Vuelta ve sus 2 filas, no la de pone_chico', (await cuenta(LV, 'sanidad_carga')).rows.length === 2);
  check('sanidad_carga: con clave de Maria Laura no ve nada', (await cuenta(ML, 'sanidad_carga')).rows.length === 0);
  check('sanidad_carga_maria_laura: sin clave 0, con la suya 1, con la de La Vuelta 0',
    (await cuenta(null, 'sanidad_carga_maria_laura')).rows.length === 0 && (await cuenta(ML, 'sanidad_carga_maria_laura')).rows.length === 1 && (await cuenta(LV, 'sanidad_carga_maria_laura')).rows.length === 0);
  check('sanidad_carga_pone_chico: se lee sin clave (abierta a proposito)', (await cuenta(null, 'sanidad_carga_pone_chico')).rows.length === 1);
  check('animales_caravana: sin clave 0, con la de La Vuelta 1, con la de Maria Laura 0',
    (await cuenta(null, 'animales_caravana')).rows.length === 0 && (await cuenta(LV, 'animales_caravana')).rows.length === 1 && (await cuenta(ML, 'animales_caravana')).rows.length === 0);
  check('productos_catalogo: lista de referencia pública a propósito (sin clave y con cualquier clave se lee)',
    (await cuenta(null, 'productos_catalogo')).rows.length === 1 && (await cuenta(ML, 'productos_catalogo')).rows.length === 1 && (await cuenta(MALA, 'productos_catalogo')).rows.length === 1);
  check('maestros_dicose: sin clave 0, con clave 1',
    (await cuenta(null, 'maestros_dicose')).rows.length === 0 && (await cuenta(LV, 'maestros_dicose')).rows.length === 1);
  for (const t of ['sanidad_ultimos', 'sanidad_proximos']) {
    // las lee el Tablero de Sanidad con la clave del campo
    const sin = await cuenta(null, t), lv = await cuenta(LV, t), ml = await cuenta(ML, t), mala = await cuenta(MALA, t);
    check(`${t}: sin clave solo se ve pone_chico (abierto a proposito)`, !sin.error && sin.rows.length === 1 && sin.rows[0].establecimiento === 'pone_chico', JSON.stringify(sin));
    check(`${t}: clave mala = igual que sin clave`, !mala.error && mala.rows.length === 1 && mala.rows[0].establecimiento === 'pone_chico', JSON.stringify(mala));
    check(`${t}: con la clave de La Vuelta ve La Vuelta + Pone Chico, no Maria Laura`, !lv.error && lv.rows.map(r => r.establecimiento).sort().join() === 'la_vuelta,pone_chico', JSON.stringify(lv.rows));
    check(`${t}: con la clave de Maria Laura ve Maria Laura + Pone Chico, no La Vuelta`, !ml.error && ml.rows.map(r => r.establecimiento).sort().join() === 'maria_laura,pone_chico', JSON.stringify(ml.rows));
    check(`${t}: anon no escribe (ni con clave): insert, update y delete`,
      bloqueado(await comoAnon(db, LV, `insert into public.${t} (establecimiento) values ('la_vuelta')`)) &&
      bloqueado(await comoAnon(db, LV, `update public.${t} set establecimiento='la_vuelta' where establecimiento='la_vuelta'`)) &&
      bloqueado(await comoAnon(db, LV, `delete from public.${t} where establecimiento='la_vuelta'`)) &&
      bloqueado(await comoAnon(db, null, `insert into public.${t} (establecimiento) values ('pone_chico')`)));
  }

  console.log('\nESCRIBIR: eventos_sync');
  const ev = (est, tipo, detalle) => `insert into public.eventos_sync (event_id, establecimiento, tipo, detalle, dispositivo) values ('x${Math.random()}', '${est}', '${tipo}', '${JSON.stringify(detalle || {})}'::jsonb, 'dx')`;
  check('pone_chico sin clave: puede insertar en su stream', !(await comoAnon(db, null, ev('pone_chico', 'movimiento'))).error);
  check('la_vuelta sin clave: NO puede insertar', bloqueado(await comoAnon(db, null, ev('la_vuelta', 'movimiento'))));
  check('la_vuelta con clave mala: NO puede insertar', bloqueado(await comoAnon(db, MALA, ev('la_vuelta', 'movimiento'))));
  check('la_vuelta con su clave: puede insertar', !(await comoAnon(db, LV, ev('la_vuelta', 'movimiento'))).error);
  check('maria_laura con la clave de La Vuelta: NO puede insertar', bloqueado(await comoAnon(db, LV, ev('maria_laura', 'movimiento'))));
  check('pone_chico con la clave de La Vuelta: tambien puede (el stream de pone_chico esta abierto a todos)', !(await comoAnon(db, LV, ev('pone_chico', 'movimiento'))).error);
  const entrada = (origen) => ev('maria_laura', 'traslado_entrada', { origen: { establecimiento: origen } });
  check('traslado_entrada en Maria Laura con la clave de La Vuelta (origen la_vuelta): permitido', !(await comoAnon(db, LV, entrada('la_vuelta'))).error);
  check('traslado_entrada en Maria Laura SIN clave (origen la_vuelta): NO', bloqueado(await comoAnon(db, null, entrada('la_vuelta'))));
  check('traslado_entrada en Maria Laura SIN clave diciendo origen pone_chico: NO (no se abre el espejo)', bloqueado(await comoAnon(db, null, entrada('pone_chico'))));
  check('traslado_entrada en Maria Laura con la clave de Maria Laura: permitido (es su propio stream)', !(await comoAnon(db, ML, entrada('la_vuelta'))).error);
  check('traslado_entrada en Maria Laura con la clave de La Vuelta pero origen maria_laura: NO (la clave no es la del origen)', bloqueado(await comoAnon(db, LV, entrada('maria_laura'))));
  const anula = (origen) => ev('maria_laura', 'correccion', { accion: 'anular_traslado', origenEstablecimiento: origen });
  check('correccion anular_traslado con la clave del origen: permitida', !(await comoAnon(db, LV, anula('la_vuelta'))).error);
  check('correccion anular_traslado sin clave (origen la_vuelta): NO', bloqueado(await comoAnon(db, null, anula('la_vuelta'))));
  check('correccion anular_traslado sin clave diciendo origen pone_chico: NO', bloqueado(await comoAnon(db, null, anula('pone_chico'))));
  check('eventos_sync: UPDATE y DELETE imposibles aun con clave',
    bloqueado(await comoAnon(db, LV, "update public.eventos_sync set tipo='x' where establecimiento='la_vuelta'")) &&
    bloqueado(await comoAnon(db, LV, "delete from public.eventos_sync where establecimiento='la_vuelta'")) &&
    bloqueado(await comoAnon(db, null, "update public.eventos_sync set tipo='x' where establecimiento='pone_chico'")) &&
    bloqueado(await comoAnon(db, null, "delete from public.eventos_sync where establecimiento='pone_chico'")));

  console.log('\nESCRIBIR: stock_potreros');
  const stock = (est, pot) => `insert into public.stock_potreros values ('${est}','${pot}','Toros','',1) on conflict (establecimiento,potrero,categoria,dueno) do update set cantidad = 9`;
  check('pone_chico sin clave: upsert permitido', !(await comoAnon(db, null, stock('pone_chico', '2'))).error);
  check('pone_chico sin clave: delete permitido', (await comoAnon(db, null, "delete from public.stock_potreros where establecimiento='pone_chico' and potrero='2' returning 1")).filas === 1);
  check('la_vuelta sin clave: upsert NO', bloqueado(await comoAnon(db, null, stock('la_vuelta', '2'))));
  check('la_vuelta sin clave: no puede pisar la fila existente (on conflict update)', bloqueado(await comoAnon(db, null, stock('la_vuelta', '1'))));
  check('la_vuelta sin clave: delete NO borra nada', (await comoAnon(db, null, "delete from public.stock_potreros where establecimiento='la_vuelta' returning 1")).filas === 0);
  check('la_vuelta con su clave: upsert y delete permitidos',
    !(await comoAnon(db, LV, stock('la_vuelta', '3'))).error && (await comoAnon(db, LV, "delete from public.stock_potreros where establecimiento='la_vuelta' and potrero='3' returning 1")).filas === 1);

  console.log('\nESCRIBIR: sanidad');
  check('sanidad_carga: insert la_vuelta con clave ok; sin clave NO; est pone_chico sin clave NO',
    !(await comoAnon(db, LV, "insert into public.sanidad_carga (establecimiento, producto) values ('la_vuelta','a')")).error &&
    bloqueado(await comoAnon(db, null, "insert into public.sanidad_carga (establecimiento, producto) values ('la_vuelta','b')")) &&
    bloqueado(await comoAnon(db, null, "insert into public.sanidad_carga (establecimiento, producto) values ('pone_chico','c')")));
  check('sanidad_carga: update/delete de lo pendiente con clave ok; de lo importado NO; sin clave NO',
    (await comoAnon(db, LV, "update public.sanidad_carga set producto='z' where producto='lv-pendiente' returning 1")).filas === 1 &&
    (await comoAnon(db, LV, "update public.sanidad_carga set producto='z' where producto='lv-importada' returning 1")).filas === 0 &&
    (await comoAnon(db, LV, "delete from public.sanidad_carga where producto='lv-importada' returning 1")).filas === 0 &&
    (await comoAnon(db, null, "delete from public.sanidad_carga where producto='z' returning 1")).filas === 0 &&
    (await comoAnon(db, LV, "delete from public.sanidad_carga where producto='z' returning 1")).filas === 1);
  check('sanidad_carga_maria_laura: con su clave todo; sin clave o con otra NO',
    !(await comoAnon(db, ML, "insert into public.sanidad_carga_maria_laura (producto) values ('m')")).error &&
    bloqueado(await comoAnon(db, null, "insert into public.sanidad_carga_maria_laura (producto) values ('m')")) &&
    bloqueado(await comoAnon(db, LV, "insert into public.sanidad_carga_maria_laura (producto) values ('m')")) &&
    (await comoAnon(db, null, "update public.sanidad_carga_maria_laura set producto='q' returning 1")).filas === 0 &&
    (await comoAnon(db, null, "delete from public.sanidad_carga_maria_laura returning 1")).filas === 0);
  check('sanidad_carga_pone_chico: insert, update y delete sin clave (abierta)',
    !(await comoAnon(db, null, "insert into public.sanidad_carga_pone_chico (producto) values ('p')")).error &&
    (await comoAnon(db, null, "update public.sanidad_carga_pone_chico set producto='q' where producto='p' returning 1")).filas === 1 &&
    (await comoAnon(db, null, "delete from public.sanidad_carga_pone_chico where producto='q' returning 1")).filas === 1);

  console.log('\nESCRIBIR: referencias');
  check('maestros_dicose: insert con clave ok, sin clave NO', !(await comoAnon(db, ML, "insert into public.maestros_dicose (tipo,nombre) values ('comprador','Z')")).error &&
    bloqueado(await comoAnon(db, null, "insert into public.maestros_dicose (tipo,nombre) values ('comprador','Y')")));
  check('productos_catalogo y animales_caravana: nadie escribe (ni con clave)',
    bloqueado(await comoAnon(db, LV, "insert into public.productos_catalogo values ('X', 1)")) &&
    bloqueado(await comoAnon(db, LV, "insert into public.animales_caravana values ('22222222','la_vuelta')")));

  console.log('\nSANIDAD_PROXIMOS_HECHOS Y FOTOS');
  const hs = await cuenta(null, 'sanidad_proximos_hechos'), hl = await cuenta(LV, 'sanidad_proximos_hechos'), hm = await cuenta(MALA, 'sanidad_proximos_hechos');
  check('hechos: sin clave y con clave mala solo se ve pone_chico', hs.rows.length === 1 && hs.rows[0].establecimiento === 'pone_chico' && hm.rows.length === 1, JSON.stringify(hs.rows));
  check('hechos: con la clave de La Vuelta ve La Vuelta + Pone Chico, no Maria Laura', hl.rows.map(r => r.establecimiento).sort().join() === 'la_vuelta,pone_chico', JSON.stringify(hl.rows));
  const hins = (est) => `insert into public.sanidad_proximos_hechos (establecimiento, categoria, sanidad, fecha_prevista) values ('${est}','Toros','Y','2026-02-02')`;
  check('hechos: marcar con la clave propia ok; sin clave o con la de otro campo NO; pone_chico sin clave ok',
    !(await comoAnon(db, LV, hins('la_vuelta'))).error && bloqueado(await comoAnon(db, null, hins('la_vuelta'))) &&
    bloqueado(await comoAnon(db, LV, hins('maria_laura'))) && !(await comoAnon(db, null, hins('pone_chico'))).error);
  check('hechos: deshacer (delete) solo con la clave del campo', (await comoAnon(db, null, "delete from public.sanidad_proximos_hechos where establecimiento='la_vuelta' returning 1")).filas === 0 &&
    (await comoAnon(db, LV, "delete from public.sanidad_proximos_hechos where establecimiento='la_vuelta' and categoria='Toros' returning 1")).filas === 1);
  check('hechos: sin UPDATE ni con clave', (await comoAnon(db, LV, "update public.sanidad_proximos_hechos set sanidad='Z' where establecimiento='la_vuelta' returning 1")).filas === 0);
  const fotos = async (clave) => (await comoAnon(db, clave, "select name from storage.objects where bucket_id='fotos-reportes'")).rows.map(r => r.name).sort().join();
  check('fotos: sin clave solo ve las de pone_chico', await fotos(null) === 'pone_chico/r1/f1.jpg', await fotos(null));
  check('fotos: con la clave de La Vuelta ve las suyas y las de pone_chico, no las de Maria Laura', await fotos(LV) === 'la_vuelta/r1/f1.jpg,pone_chico/r1/f1.jpg', await fotos(LV));
  check('fotos: clave mala = sin clave', await fotos(MALA) === 'pone_chico/r1/f1.jpg', await fotos(MALA));
  const sube = (ruta, bucket = 'fotos-reportes') => `insert into storage.objects (bucket_id, name) values ('${bucket}', '${ruta}')`;
  check('fotos: subir a la carpeta propia con clave ok; sin clave o a la de otro campo NO; pone_chico sin clave ok; otro bucket NO',
    !(await comoAnon(db, LV, sube('la_vuelta/r2/f.jpg'))).error && bloqueado(await comoAnon(db, null, sube('la_vuelta/r3/f.jpg'))) &&
    bloqueado(await comoAnon(db, LV, sube('maria_laura/r3/f.jpg'))) && !(await comoAnon(db, null, sube('pone_chico/r3/f.jpg'))).error &&
    bloqueado(await comoAnon(db, LV, sube('la_vuelta/r4/f.jpg', 'otro'))));
  check('fotos: sin UPDATE ni DELETE aun con clave',
    (await comoAnon(db, LV, "update storage.objects set name='la_vuelta/x.jpg' where name='la_vuelta/r1/f1.jpg' returning 1")).filas === 0 &&
    (await comoAnon(db, LV, "delete from storage.objects where name='la_vuelta/r1/f1.jpg' returning 1")).filas === 0);

  console.log('\nFUNCIONES');
  const fn = await comoAnon(db, null, 'select public.establecimientos_permitidos() as a');
  check('establecimientos_permitidos() sin clave = {pone_chico}', !fn.error && JSON.stringify(fn.rows[0].a) === '["pone_chico"]', JSON.stringify(fn));
  const fn2 = await comoAnon(db, LV, 'select public.establecimientos_permitidos() as a');
  check('establecimientos_permitidos() con la clave de La Vuelta = {la_vuelta,pone_chico}', !fn2.error && fn2.rows[0].a.slice().sort().join() === 'la_vuelta,pone_chico', JSON.stringify(fn2));
  const ver = await comoAnon(db, null, "select public.verificar_clave('la_vuelta','" + LV + "') as ok");
  check('verificar_clave sigue andando (release 1)', !ver.error && ver.rows[0].ok === true, JSON.stringify(ver));
  check('private.* sigue cerrado a anon (claves y campos abiertos: ni leer ni escribir)',
    bloqueado(await comoAnon(db, null, 'select * from private.claves_campo')) && bloqueado(await comoAnon(db, null, 'select * from private.campos_abiertos')) &&
    bloqueado(await comoAnon(db, LV, "insert into private.campos_abiertos values ('la_vuelta')")) && bloqueado(await comoAnon(db, LV, 'delete from private.campos_abiertos')));

  console.log('\nPONERLE CLAVE A PONE CHICO MAS ADELANTE (borrarlo de private.campos_abiertos)');
  await db.exec("delete from private.campos_abiertos where establecimiento = 'pone_chico'");
  const cerrado = async (clave) => [...new Set((await cuenta(clave, 'eventos_sync')).rows.map(r => r.establecimiento))].sort().join();
  check('sin clave ya no se ve nada, ni Pone Chico', await cerrado(null) === '', await cerrado(null));
  check('con la clave de Pone Chico se ve solo Pone Chico', await cerrado(PC) === 'pone_chico', await cerrado(PC));
  check('sin clave ya no puede escribir en Pone Chico ni leer su sanidad',
    bloqueado(await comoAnon(db, null, ev('pone_chico', 'movimiento'))) && (await cuenta(null, 'sanidad_carga_pone_chico')).rows.length === 0 &&
    (await cuenta(null, 'sanidad_ultimos')).rows.length === 0);
  check('con la clave de Pone Chico si', !(await comoAnon(db, PC, ev('pone_chico', 'movimiento'))).error && (await cuenta(PC, 'sanidad_carga_pone_chico')).rows.length >= 1);
  await db.exec(cierreSql);
  check('OJO: volver a correr fase4_cierre.sql REINSERTA pone_chico en campos_abiertos (queda abierto otra vez)',
    await cerrado(null) === 'pone_chico', await cerrado(null));

  if (deshacerSql) {
    console.log('\nDESHACER');
    await db.exec(deshacerSql);
    const politicasDespues = (await db.query("select tablename, policyname, cmd from pg_policies where schemaname in ('public','storage') order by 1,2,3")).rows;
    const sinAuditoria = politicasDespues.filter(p => !p.tablename.startsWith('auditoria_'));
    check('las politicas vuelven a ser exactamente las de antes', JSON.stringify(sinAuditoria) === JSON.stringify(politicasAntes),
      JSON.stringify(sinAuditoria.length) + ' vs ' + politicasAntes.length);
    const privDespues = (await db.query("select c.relname t, p.priv from pg_class c cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv) where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname not like 'auditoria_%' and has_table_privilege('anon', c.oid, p.priv) order by 1,2")).rows;
    check('los permisos de tabla de anon vuelven a ser los de antes', JSON.stringify(privDespues) === JSON.stringify(privAntes));
    const f = (await db.query("select count(*)::int n from pg_proc where proname='establecimientos_permitidos'")).rows[0].n;
    check('la funcion establecimientos_permitidos() ya no existe', f === 0, f);
    const t = (await db.query("select count(*)::int n from pg_tables where schemaname='private' and tablename='campos_abiertos'")).rows[0].n;
    check('la tabla private.campos_abiertos ya no existe', t === 0, t);
    check('despues de deshacer todo vuelve a estar abierto', (await cuenta(null, 'eventos_sync')).rows.length >= 3 && (await cuenta(null, 'maestros_dicose')).rows.length >= 1);
  }

  console.log('\n' + (fallas.length ? fallas.length + ' FALLA(S) de ' + n + ': ' + fallas.join(' | ') : 'Todo OK (' + n + ' verificaciones)'));
  process.exit(fallas.length ? 1 : 0);
}
main().catch(e => { console.log('ERROR DEL BANCO DE PRUEBAS:', e.message); process.exit(2); });
