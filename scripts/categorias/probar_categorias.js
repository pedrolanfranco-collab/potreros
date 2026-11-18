// Prueba de categorias.sql + categorias_deshacer.sql contra un Postgres real (PGlite, en WASM), SIN tocar Supabase.
// Tambien comprueba que las 24 categorias del SQL son exactamente las de ESPECIES en el template de la app.
//
// PGlite no es una dependencia del repo (igual que en scripts/seguridad/probar_cierre.js):
//     mkdir %TEMP%\pglite && cd %TEMP%\pglite && npm init -y && npm install @electric-sql/pglite@0.2.17
//     set PGLITE_DIR=%TEMP%\pglite\node_modules\@electric-sql\pglite
//     node scripts/categorias/probar_categorias.js
// Sale con codigo 1 si algo falla.
const fs = require('fs');
const path = require('path');
const { PGlite } = require(process.env.PGLITE_DIR || '@electric-sql/pglite');

const DIR = __dirname + path.sep;
const sql = fs.readFileSync(DIR + 'categorias.sql', 'utf8');
const deshacer = fs.readFileSync(DIR + 'categorias_deshacer.sql', 'utf8');
const template = fs.readFileSync(path.join(DIR, '..', '..', 'template', 'potreros.template.html'), 'utf8');

const fallas = [];
let n = 0;
function check(nombre, ok, detalle) {
  n++;
  console.log((ok ? '  OK  ' : '  MAL ') + nombre + (ok ? '' : '   -> ' + detalle));
  if (!ok) fallas.push(nombre);
}

// Lo que hay hoy en produccion, reducido a lo que toca el script.
const ESQUEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.sanidad_proximos_hechos (
  id bigint generated always as identity primary key,
  establecimiento text not null check (establecimiento in ('la_vuelta', 'maria_laura', 'pone_chico')),
  categoria text not null check (length(categoria) between 1 and 80),
  sanidad text not null check (length(sanidad) between 1 and 80),
  fecha_prevista date not null,
  marcado_en timestamptz not null default now(),
  constraint sanidad_proximos_hechos_unico unique (establecimiento, categoria, sanidad, fecha_prevista));
insert into public.sanidad_proximos_hechos (establecimiento, categoria, sanidad, fecha_prevista, marcado_en) values
  ('la_vuelta', 'Vaca',       'Garrapata', '2026-06-26', '2026-10-21 10:00+00'),
  ('la_vuelta', 'VACA',       'Garrapata', '2026-06-26', '2026-10-21 10:05+00'),   -- mismo destino que la anterior
  ('la_vuelta', 'V. Inv.',    'Garrapata', '2026-06-26', '2026-10-21 10:01+00'),
  ('la_vuelta', 'Teros/as',   'Vacunas',   '2026-09-30', '2026-10-21 10:02+00'),
  ('la_vuelta', 'Toritos',    'Garrapata', '2026-01-28', '2026-10-21 10:03+00'),
  ('la_vuelta', 'Consumo',    'Otros',     '2026-05-01', '2026-10-21 10:04+00'),   -- no es categoria: queda igual
  ('la_vuelta', 'Terneros',   'Vacunas',   '2026-06-19', '2026-10-22 09:00+00');   -- ya con el nombre del patron
`;

async function main() {
  console.log('\n=== las 24 categorias del SQL son las de ESPECIES del template');
  const bloque = template.slice(template.indexOf('const ESPECIES = {'));
  const especies = bloque.slice(0, bloque.indexOf('\n};'));
  const delTemplate = [...especies.matchAll(/^\s*"([^"]+)":\s*[\d.]+/gm)].map(m => m[1]);
  const delSql = [...sql.matchAll(/\('([^']+)', '(?:bovino|ovino|equino)', \d+\)/g)].map(m => m[1]);
  check('el template tiene 24 categorias', delTemplate.length === 24, delTemplate.length);
  check('mismas categorias y en el mismo orden', JSON.stringify(delSql) === JSON.stringify(delTemplate),
    'solo en SQL: ' + delSql.filter(x => !delTemplate.includes(x)) + ' | solo en template: ' + delTemplate.filter(x => !delSql.includes(x)));

  const db = new PGlite();
  await db.exec(ESQUEMA);
  const marcasAntes = (await db.query('select establecimiento, categoria, sanidad, fecha_prevista::text f, marcado_en::text m from public.sanidad_proximos_hechos order by id')).rows;

  await db.exec(sql);
  await db.exec(sql);   // se puede correr dos veces
  check('corre dos veces sin error', true);
  const q = async (s, p) => (await db.query(s, p)).rows;

  console.log('\n=== traduccion');
  const casos = [
    ['V. Inv.', 'Vacas de invernada'], ['VACA', 'Vacas'], ['  teros/as ', 'Terneros'], ['vacas', 'Vacas'],
    ['Toritos', 'Toros'], ['Vaq. +2', 'Vaquillonas 2-3 años'], ['NOV12', 'Novillitos 1-2 años'], ['Bgas DL', 'Borregas DL'],
    ['Vaca CUT', 'Vacas'], ['Consumo', 'Consumo'], ['Sin categoría', 'Sin categoría'], ['Terneros', 'Terneros'],
  ];
  for (const [entra, sale] of casos) {
    const r = (await q('select public.categoria_patron($1) c', [entra]))[0].c;
    check(`"${entra}" -> "${sale}"`, r === sale, r);
  }
  check('null queda null', (await q('select public.categoria_patron(null) c'))[0].c === null);
  check('25 equivalencias, todas a una categoria del patron', (await q(
    'select count(*)::int n from public.categorias_alias a join public.categorias c on c.nombre = a.categoria'))[0].n === 25);

  console.log('\n=== permisos');
  await db.exec('set role anon');
  let error = null;
  try { await db.query('select * from public.categorias_alias'); } catch (e) { error = e.message; }
  await db.exec('reset role');
  check('la llave publica no lee las equivalencias', /permission denied/.test(error || ''), error || 'leyo');
  await db.exec('set role service_role');
  const sr = (await db.query("select public.categoria_patron('V. Inv.') c")).rows[0].c;
  await db.exec('reset role');
  check('la clave privada usa la funcion', sr === 'Vacas de invernada', sr);

  console.log('\n=== "Ya se hizo": copia con el nombre del patron, sin borrar las originales');
  const marcas = await q('select categoria, sanidad, fecha_prevista::text f, marcado_en::text m from public.sanidad_proximos_hechos order by categoria, sanidad');
  const tiene = (c, s, f) => marcas.some(x => x.categoria === c && x.sanidad === s && x.f === f);
  check('Vacas / Garrapata / 26-06 (una sola, aunque venia de Vaca y de VACA)',
    marcas.filter(x => x.categoria === 'Vacas' && x.sanidad === 'Garrapata').length === 1);
  check('Vacas de invernada / Garrapata', tiene('Vacas de invernada', 'Garrapata', '2026-06-26'));
  check('Terneros / Vacunas / 30-09', tiene('Terneros', 'Vacunas', '2026-09-30'));
  check('Toros / Garrapata', tiene('Toros', 'Garrapata', '2026-01-28'));
  check('Consumo no se copia', marcas.filter(x => x.categoria === 'Consumo').length === 1);
  check('las 7 marcas originales siguen', marcasAntes.every(a => marcas.some(x => x.categoria === a.categoria && x.sanidad === a.sanidad && x.f === a.f)));
  check('la copia conserva la hora de la marca', marcas.find(x => x.categoria === 'Toros').m === marcasAntes.find(x => x.categoria === 'Toritos').m);
  check('11 marcas en total (7 + 4 copias)', marcas.length === 11, marcas.length);

  console.log('\n=== deshacer');
  await db.exec("insert into public.sanidad_proximos_hechos (establecimiento, categoria, sanidad, fecha_prevista) values ('la_vuelta', 'Vacas', 'Vacunas', '2026-11-14')");
  await db.exec(deshacer);
  const despues = await q('select categoria, sanidad, fecha_prevista::text f from public.sanidad_proximos_hechos order by id');
  check('quedan las 7 originales y la marca nueva hecha despues (8)', despues.length === 8, JSON.stringify(despues));
  check('la marca hecha despues con nombre del patron no se toca', despues.some(x => x.categoria === 'Vacas' && x.sanidad === 'Vacunas'));
  check('la de Terneros que ya existia antes no se toca', despues.some(x => x.categoria === 'Terneros' && x.f === '2026-06-19'));
  check('sin tablas ni funcion',
    (await q("select to_regclass('public.categorias') a, to_regclass('public.categorias_alias') b, to_regprocedure('public.categoria_patron(text)') c"))
      .every(r => r.a === null && r.b === null && r.c === null));

  console.log(`\n${n - fallas.length} de ${n} verificaciones bien` + (fallas.length ? `; FALLARON: ${fallas.join('; ')}` : ''));
  process.exit(fallas.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
