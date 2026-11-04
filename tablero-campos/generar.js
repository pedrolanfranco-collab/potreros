// Genera tablero-campos/index.html desde fuente.html + config.js (campos, Supabase, cortes) + los dibujos de los potreros.
// Uso (desde la raíz del repo):  node tablero-campos/generar.js          -> escribe index.html
//                                node tablero-campos/generar.js --check  -> falla si index.html está desfasado
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const ID_RE = /^[a-z0-9_]{1,40}$/;
const PREFIJO_RE = /^[a-z0-9_]{1,40}$/;
const avisos = [];

function falla(msg) { const e = new Error(msg); e.propio = true; throw e; }

function coordsDeGeojson(geom, nombre, campoId) {
  // GeoJSON es [lon, lat]; la página usa [lat, lon]. Se toma el anillo exterior.
  if (!geom || !Array.isArray(geom.coordinates)) return null;
  let anillo = null;
  if (geom.type === 'Polygon') anillo = geom.coordinates[0];
  else if (geom.type === 'MultiPolygon') {
    anillo = geom.coordinates[0] && geom.coordinates[0][0];
    if (geom.coordinates.length > 1)
      avisos.push('Campo "' + campoId + '", potrero "' + nombre + '": tiene ' + geom.coordinates.length +
        ' partes; se dibuja solo la primera. Si no trae "area", la superficie va a salir más chica.');
  }
  if (!Array.isArray(anillo)) return null;
  const pts = anillo.map(q => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]) ? [Number(q[1]), Number(q[0])] : null);
  return pts.length >= 3 && pts.every(Boolean) ? pts : null;
}

function leerGeojson(campo, archivo) {
  const ruta = path.resolve(__dirname, String(archivo));
  const rel = path.relative(__dirname, ruta);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
    falla('config.js: el GeoJSON del campo "' + campo.id + '" tiene que estar dentro de la carpeta tablero-campos/');
  if (!fs.existsSync(ruta)) falla('No encuentro el archivo ' + rel + ' (campo "' + campo.id + '"). Copialo a la carpeta tablero-campos/.');
  let g;
  try { g = JSON.parse(fs.readFileSync(ruta, 'utf8')); }
  catch (e) { falla(rel + ' no es un GeoJSON válido (campo "' + campo.id + '"). Volvé a exportarlo como GeoJSON.'); }
  const lista = [], ignorados = [];
  (g.features || []).forEach((f, i) => {
    const pr = f.properties || {};
    const nombre = String(pr.nombre || pr.name || '').trim();
    const coords = nombre ? coordsDeGeojson(f.geometry, nombre, campo.id) : null;
    if (!nombre || !coords) { ignorados.push(nombre || '(sin nombre, nº ' + (i + 1) + ')'); return; }
    lista.push({ nombre, area: pr.area == null ? '' : pr.area, coords });
  });
  if (ignorados.length)
    avisos.push('Campo "' + campo.id + '": ' + ignorados.length + ' dibujo(s) ignorado(s) por no tener nombre o no ser un polígono: ' + ignorados.join(', '));
  if (!lista.length) falla(rel + ' no tiene ningún potrero con nombre y polígono (campo "' + campo.id + '").');
  return lista;
}

function potrerosDe(campo) {
  const p = campo.potreros || {};
  let lista;
  if (p.desdeConfig) {
    const ruta = path.join(raiz, 'template', 'configs', String(p.desdeConfig) + '.js');
    if (!fs.existsSync(ruta)) falla('config.js: no existe template/configs/' + p.desdeConfig + '.js (campo "' + campo.id + '").');
    lista = (require(ruta).potrerosGeo || []).map(x => ({ nombre: x.nombre, area: x.area, coords: x.coords }));
  } else if (p.geojson) lista = leerGeojson(campo, p.geojson);
  else { avisos.push('Campo "' + campo.id + '": no tiene potreros (falta "desdeConfig" o "geojson"); se verá sin mapa.'); lista = []; }
  const vistos = new Set();
  for (const x of lista) {
    const k = String(x.nombre).trim().toLowerCase();
    if (vistos.has(k)) falla('Campo "' + campo.id + '": el potrero "' + x.nombre + '" está dos veces. Cada potrero necesita un nombre único.');
    vistos.add(k);
  }
  return lista;
}

// Potreros dobles ({doble: [partes]}): de config.js ("dobles") o, si no, del config de las apps (potrerosDobles).
function doblesDe(campo, potreros) {
  let d = campo.dobles;
  if (d == null && campo.potreros && campo.potreros.desdeConfig)
    d = require(path.join(raiz, 'template', 'configs', String(campo.potreros.desdeConfig) + '.js')).potrerosDobles;
  d = d || {};
  const nombres = new Set(potreros.map(p => String(p.nombre)));
  for (const [doble, partes] of Object.entries(d)) {
    if (!nombres.has(doble) || !Array.isArray(partes) || !partes.every(x => nombres.has(String(x))))
      falla('Campo "' + campo.id + '": el potrero doble "' + doble + '" o alguna de sus partes no tiene dibujo.');
  }
  return d;
}

function construir() {
  const rutaCfg = path.join(__dirname, 'config.js');
  if (!fs.existsSync(rutaCfg)) falla('Falta tablero-campos/config.js');
  delete require.cache[require.resolve(rutaCfg)];
  let cfg;
  try { cfg = require(rutaCfg); }
  catch (e) { falla('config.js tiene un error de escritura (una coma, comilla o llave de más o de menos): ' + e.message.split('\n')[0]); }
  if (typeof cfg.supabaseUrl !== 'string' || !/^https:\/\/\S+$/.test(cfg.supabaseUrl)) falla('config.js: falta "supabaseUrl" (empieza con https://).');
  if (typeof cfg.supabaseKey !== 'string' || !cfg.supabaseKey.trim()) falla('config.js: falta "supabaseKey" (la clave pública de Supabase).');
  const cortes = cfg.cortesCarga || [0.5, 0.8, 1.2];
  if (!Array.isArray(cortes) || cortes.length !== 3 || !cortes.every(n => typeof n === 'number' && n > 0) || !(cortes[0] < cortes[1] && cortes[1] < cortes[2]))
    falla('config.js: "cortesCarga" tienen que ser 3 números de menor a mayor, por ejemplo [0.5, 0.8, 1.2].');
  if (cfg.prefijoAlmacen != null && !PREFIJO_RE.test(cfg.prefijoAlmacen)) falla('config.js: "prefijoAlmacen" solo minúsculas, números y _.');
  if (!Array.isArray(cfg.campos) || !cfg.campos.length) falla('config.js: la lista "campos" está vacía');
  const vistos = new Set();
  const tablero = {
    titulo: String(cfg.titulo || 'Tablero de Campos'),
    supabaseUrl: cfg.supabaseUrl,
    supabaseKey: cfg.supabaseKey,
    cortesCarga: cortes,
    prefijoAlmacen: cfg.prefijoAlmacen || 'tablero_campos',
    campos: cfg.campos.map(c => {
      if (!ID_RE.test((c && c.id) || '')) falla('config.js: id inválido "' + (c && c.id) + '" (solo minúsculas, números y _, igual que "establecimiento" en Supabase)');
      if (c.id === 'todos' || vistos.has(c.id)) falla('config.js: id repetido o reservado "' + c.id + '"');
      vistos.add(c.id);
      const potreros = potrerosDe(c);
      return { id: c.id, nombre: String(c.nombre || c.id), usaClave: !!c.usaClave, etiquetaDueno: String(c.etiquetaDueno || 'Dueño'),
               potreros, dobles: doblesDe(c, potreros) };
    }),
  };
  const fuente = fs.readFileSync(path.join(__dirname, 'fuente.html'), 'utf8');
  if (!fuente.includes('/*__TABLERO__*/{}')) falla('fuente.html no tiene el marcador /*__TABLERO__*/{}');
  const titulo = tablero.titulo.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return fuente
    .replace('/*__TABLERO__*/{}', () => JSON.stringify(tablero).replace(/</g, '\\u003c'))
    .replace('<title>Tablero de Campos</title>', () => '<title>' + titulo + '</title>');
}

const salida = path.join(__dirname, 'index.html');
let nuevo;
try { nuevo = construir(); }
catch (e) { console.error('✗ ' + (e.propio ? e.message : 'Error inesperado: ' + e.message)); process.exit(1); }
for (const a of avisos) console.warn('⚠ ' + a);
if (process.argv.includes('--check')) {
  const actual = fs.existsSync(salida) ? fs.readFileSync(salida, 'utf8') : '';
  if (actual !== nuevo) { console.error('tablero-campos/index.html desfasado: correr node tablero-campos/generar.js'); process.exit(1); }
  console.log('tablero-campos/index.html al día');
} else {
  fs.writeFileSync(salida, nuevo);
  console.log('✓ escrito', path.relative(raiz, salida), (nuevo.length / 1024).toFixed(0) + ' KB');
}
