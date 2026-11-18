/*
 * Content-Security-Policy de las apps (18/11/2026, punto 9 del informe de auditoría).
 *
 * template/generar.js escribe en cada index.html un <meta http-equiv="Content-Security-Policy"> calculado sobre el
 * HTML generado (ver politicaCsp() en el generador). jsdom NO aplica CSP, así que ninguna otra prueba se daría cuenta
 * si la política deja afuera algo que la app necesita: en el celular, la app quedaría sin cargar o sin mapa.
 *
 * Por cada index.html controla:
 *   - hay un solo <meta> CSP y va antes de cualquier <script> o <link> (si va después, no protege lo anterior);
 *   - cada <script> en línea tiene su hash sha256 en script-src (si no, el navegador no lo corre: app en blanco);
 *   - no hay 'unsafe-inline' ni 'unsafe-eval' en script-src;
 *   - cada onXXX="..." del HTML tiene su hash (con 'unsafe-hashes');
 *   - cada <script src> y <link rel=stylesheet> externo está permitido por su directiva;
 *   - la capa del mapa (L.tileLayer) está en img-src;
 *   - el Supabase de la app (SUPABASE_URL) está en connect-src (https y wss) e img-src (fotos); la copia de prueba
 *     no tiene Supabase y su connect-src no deja salir a ningún servidor de afuera;
 *   - object-src 'none' y base-uri 'self'.
 *   - cada <script src> externo lleva integrity (SRI) y crossorigin.
 *
 * Uso: node tests/probar_csp.js <index.html> [<index.html> ...]
 */
const fs = require('fs');
const crypto = require('crypto');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const sha256 = t => 'sha256-' + crypto.createHash('sha256').update(t, 'utf8').digest('base64');
const origen = u => { const x = new URL(u); return x.protocol + '//' + x.host; };

function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const html = fs.readFileSync(archivo, 'utf-8');
  const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];
  chequear('un solo <meta> CSP', metas.length === 1, String(metas.length));
  if(metas.length !== 1) return;
  const posMeta = metas[0].index;
  const primerRecurso = html.search(/<script|<link/);
  chequear('el <meta> CSP va antes del primer <script> o <link>', posMeta < primerRecurso, `${posMeta} vs ${primerRecurso}`);

  const dir = {};
  for(const parte of metas[0][1].split(';')){
    const [nombre, ...valores] = parte.trim().split(/\s+/);
    if(nombre) dir[nombre] = valores;
  }
  const permite = (directiva, u) => {
    const lista = dir[directiva] || dir['default-src'] || [];
    return lista.includes(origen(u)) || lista.includes(u);
  };

  const scriptSrc = dir['script-src'] || [];
  chequear("script-src sin 'unsafe-inline' ni 'unsafe-eval'",
    !scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"), scriptSrc.join(' '));

  const enLinea = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  chequear('hay scripts en línea', enLinea.length > 0);
  enLinea.forEach((s, i) => chequear(`script en línea #${i + 1} tiene su hash`, scriptSrc.includes(`'${sha256(s)}'`), sha256(s)));
  const hashes = scriptSrc.filter(v => /^'sha256-/.test(v));
  const manejadoresEsperados = [...new Set([...html.replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1]))];
  manejadoresEsperados.forEach(h => chequear(`onXXX="${h}" tiene su hash`, scriptSrc.includes(`'${sha256(h)}'`)));
  if(manejadoresEsperados.length) chequear("'unsafe-hashes' presente (para los onXXX)", scriptSrc.includes("'unsafe-hashes'"));
  chequear('no sobran hashes', hashes.length === enLinea.length + manejadoresEsperados.length, `${hashes.length} vs ${enLinea.length}+${manejadoresEsperados.length}`);

  for(const m of html.matchAll(/<script src="([^"]+)"([^>]*)>/g)){
    if(!/^https?:/.test(m[1])) continue;
    chequear(`script permitido: ${m[1]}`, permite('script-src', m[1]));
    chequear(`script con integrity y crossorigin: ${m[1]}`, /integrity="sha384-[^"]+"/.test(m[2]) && /crossorigin="anonymous"/.test(m[2]));
  }
  for(const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>|<link[^>]*href="[^"]*"[^>]*rel="stylesheet"[^>]*>/g)){
    const href = (m[0].match(/href="([^"]+)"/) || [])[1];
    if(href && /^https?:/.test(href)) chequear(`hoja de estilo permitida: ${href.slice(0, 60)}…`, permite('style-src', href.replace(/&amp;/g, '&')));
  }
  chequear('las fuentes de Google (fonts.gstatic.com) en font-src', (dir['font-src'] || []).includes('https://fonts.gstatic.com'));

  const capas = [...html.matchAll(/L\.tileLayer\('([^']+)'/g)].map(m => m[1].replace(/\{[a-z]\}/g, '0'));
  chequear('hay capa de mapa', capas.length > 0);
  capas.forEach(u => chequear(`capa del mapa en img-src: ${origen(u)}`, permite('img-src', u)));
  chequear('íconos de Leaflet (cdnjs) en img-src', permite('img-src', 'https://cdnjs.cloudflare.com/x.png'));

  const supa = (html.match(/const SUPABASE_URL = '([^']*)';/) || [])[1];
  const connect = dir['connect-src'] || [];
  if(supa){
    chequear('Supabase en connect-src (https)', connect.includes(supa), connect.join(' '));
    chequear('Supabase en connect-src (wss)', connect.includes(supa.replace('https://', 'wss://')), connect.join(' '));
    chequear('Supabase en img-src (fotos)', permite('img-src', supa + '/storage/v1/object/sign/x'));
    chequear('connect-src no deja salir a otros servidores', connect.every(v => v === "'self'" || v.includes(new URL(supa).host)), connect.join(' '));
  } else {
    chequear('copia sin Supabase: connect-src solo el propio sitio', connect.length === 1 && connect[0] === "'self'", connect.join(' '));
  }
  chequear("object-src 'none'", (dir['object-src'] || []).join(' ') === "'none'");
  chequear("base-uri 'self'", (dir['base-uri'] || []).join(' ') === "'self'");
}

const archivos = process.argv.slice(2);
if(!archivos.length){ console.log('Uso: node tests/probar_csp.js <index.html> [...]'); process.exit(2); }
for(const a of archivos) probarArchivo(a);
console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
