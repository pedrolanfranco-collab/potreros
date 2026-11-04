/*
 * Tablero de Campos: abre tablero-campos/index.html en jsdom con un Leaflet falso (el CDN no carga en jsdom) y un fetch
 * falso que devuelve filas de stock_potreros por establecimiento. Verifica: carga sin errores de JS; que TABLERO (embebido
 * en index.html) coincide con config.js y con potrerosGeo de template/configs/*.js; generar.js --check; que solo se lee
 * (GET) salvo el guardado de una clave (POST a rpc/verificar_clave); que la clave va en x-clave-campo solo a La Vuelta y
 * María Laura; que no hay botón ni lectura de Pone Chico (tampoco en Todos); totales, potrero sin mapa, clic en la tabla y
 * en el polígono, escape de HTML, aviso de clave, copia guardada cuando la lectura falla o viene vacía. Y el generador,
 * probado en una copia temporal (campo sin clave con GeoJSON, título escapado, ids inválidos o repetidos).
 * Uso: node tests/probar_tablero_campos.js tablero-campos/index.html
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
const chequear = (n, c, d) => { console.log((c ? '  OK  ' : '  MAL ') + n + (c ? '' : ' — ' + (d || ''))); if(!c) fallas++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));

const raiz = path.join(__dirname, '..');
const archivo = process.argv[2] || 'tablero-campos/index.html';
const html = fs.readFileSync(archivo, 'utf8');
const CONFIG = { la_vuelta: 'la-vuelta', maria_laura: 'maria-laura' };
const CLAVE = { la_vuelta: 'clavelavuelta1', maria_laura: 'clavemarialaura2' };
const CLAVE_BUENA = 'clavecorrecta1';           // la única que verificar_clave acepta en esta prueba
const AHORA = new Date().toISOString();
const respuesta = x => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(x)) });

const f = (potrero, categoria, especie, dueno, cantidad, ug) => ({ potrero, categoria, especie, dueno, cantidad, ug, actualizado_en: AHORA });
const STOCK = {
  la_vuelta: [
    f('12', 'Vaca', 'Bovino', 'Pedro Lanfranco', 50, 50),
    f('12', 'Ternero', 'Bovino', '', 30, 12),
    f('13', 'Novillo 2-3', 'Bovino', 'Silvia Dutra', 40, 32),
    f('5', 'Oveja', 'Ovino', 'Silvia Dutra', 100, 17),
    f('Piquete', 'Vaca', 'Bovino', 'Pedro Lanfranco', 20, 20),     // no está en el mapa
    f('7', 'Vaca', 'Bovino', '', 0, 5),                             // cantidad 0: no cuenta
    f('Fantasma', 'Vaca', 'Bovino', '', 0, 0),                      // cantidad 0: el potrero no debe aparecer
    f('5', '<img src=x onerror=window.pwn=1>', 'Bovino', '', 1, 0)  // categoría con HTML: debe verse como texto
  ],
  maria_laura: [
    f('Tajamar', 'Vaca', 'Bovino', 'Silvia', 60, 60),
    f('Casco', 'Vaquillona 1-2', 'Bovino', 'Perico', 25, 15),
    f('Uno', 'Novillo', 'Bovino', 'Mili', 35, 28),
    f('Rincon', 'Ternero', 'Bovino', 'Pedro', 45, 18),
    f('Manantial', 'Vaca', 'Bovino', 'Perico', 10, 10)
  ],
  // Pone Chico ya no está en config.js: si aparece una lectura de esta fila, la página la está pidiendo mal.
  pone_chico: [f('PC-1', 'Vaca', 'Bovino', '', 15, 15)]
};
const sumaCab = filas => filas.filter(x => Number(x.cantidad) !== 0).reduce((s, x) => s + Number(x.cantidad), 0);
const sumaUG = filas => filas.filter(x => Number(x.cantidad) !== 0).reduce((s, x) => s + Number(x.ug), 0);
const num = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));

const LS_CLAVES = { clave_campo_la_vuelta: CLAVE.la_vuelta, clave_campo_maria_laura: CLAVE.maria_laura };

/* Leaflet falso: registra polígonos (con su handler de clic) en la capa activa. */
function fakeLeaflet(){
  const estado = { capa: null, encuadres: 0, poligonos: [] };
  const api = {
    map(){ const m = { setView(){ return m; }, fitBounds(){ estado.encuadres++; return m; } }; return m; },
    tileLayer(){ const t = { addTo(){ return t; } }; return t; },
    layerGroup(){
      const g = { capas: [], addTo(){ return g; }, clearLayers(){ g.capas.length = 0; return g; }, addLayer(l){ g.capas.push(l); return g; } };
      estado.capa = g; return g;
    },
    polygon(coords, opts){
      const p = { coords, opts, handlers: {}, on(ev, fn){ p.handlers[ev] = fn; return p; }, bindTooltip(t){ p.tooltip = t; return p; } };
      estado.poligonos.push(p);
      return p;
    },
    latLngBounds(pts){ return { pts }; }
  };
  return { api, estado };
}

/* o.html: otro index.html (por defecto el de la prueba). o.stock, o.ls, o.vacio, o.caido, o.sinL: escenas. */
async function abrir(o = {}){
  const llamadas = [], errores = [], consola = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push(String((e && e.message) || e)));
  vc.on('error', (...a) => consola.push(a.map(String).join(' ')));   // console.error de la página (p. ej. un paso de pintar que falla)
  const fl = fakeLeaflet();
  const sinLeaflet = (o.html || html)
    .replace(/<link rel="stylesheet" href="https:\/\/cdnjs[^>]*>/, '')
    .replace(/<script src="https:\/\/cdnjs[^"]*leaflet[^"]*"[^>]*><\/script>/, '');
  const dom = new JSDOM(sinLeaflet, { runScripts: 'dangerously', url: 'https://x.github.io/potreros/tablero-campos/', virtualConsole: vc,
    beforeParse(win){
      win.addEventListener('error', e => errores.push('window.error: ' + e.message));
      if(!o.sinL) win.L = fl.api;   // sinL: L queda indefinido (el CDN de Leaflet no cargó)
      for(const k in (o.ls || {})) win.localStorage.setItem(k, o.ls[k]);
      win.fetch = async (url, opt = {}) => {
        const metodo = opt.method || 'GET';
        llamadas.push({ url, metodo, headers: opt.headers || {}, body: opt.body });
        if(url.includes('rpc/verificar_clave')) return respuesta(JSON.parse(opt.body).clave === CLAVE_BUENA);
        if(url.includes('stock_potreros')){
          const campo = /establecimiento=eq\.([a-z_]+)/.exec(url)[1];
          if(o.caido && o.caido.includes(campo)) throw new Error('sin red');
          if(o.vacio && o.vacio.includes(campo)) return respuesta([]);
          const off = Number(/offset=(\d+)/.exec(url)[1]);
          return respuesta((o.stock || STOCK)[campo] ? (o.stock || STOCK)[campo].slice(off, off + 1000) : []);
        }
        return respuesta([]);
      };
    } });
  await dormir(80);
  return { win: dom.window, doc: dom.window.document, llamadas, errores, consola, mapa: fl.estado, dom };
}
const kpi = (a, i) => num(a.doc.querySelectorAll('#kpis .kpi b')[i].textContent);   // 0 cabezas, 1 UG, 2 carga, 3 potreros
const filaPot = (a, campo, nombre) => [...a.doc.querySelectorAll('#tabla-pot tr.fila-pot')].find(tr => tr.dataset.campo === campo && tr.dataset.nombre === nombre);
const elegirCampo = async (a, campo) => { a.doc.querySelector('.campo-btn[data-campo="' + campo + '"]').click(); await dormir(80); };
const llamadasA = (a, campo) => a.llamadas.filter(l => l.url.includes('stock_potreros') && l.url.includes('establecimiento=eq.' + campo));

/* Copia temporal del generador: no toca el repo. Usa su propio fuente.html y generar.js, y un config.js escrito acá. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tablero-campos-prueba-'));
const GEOJSON_X = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { nombre: 'Potrero A', area: 120 },
    geometry: { type: 'Polygon', coordinates: [[[-55.10, -31.20], [-55.11, -31.20], [-55.11, -31.21], [-55.10, -31.21], [-55.10, -31.20]]] } },
  { type: 'Feature', properties: { name: 'Potrero B' },
    geometry: { type: 'Polygon', coordinates: [[[-55.20, -31.30], [-55.21, -31.30], [-55.21, -31.31], [-55.20, -31.31], [-55.20, -31.30]]] } }
] };
const CAMPO_X = { id: 'campo_x', nombre: 'Campo <X>', usaClave: false, etiquetaDueno: 'Dueño', potreros: { geojson: 'x.geojson' } };
const STOCK_X = [f('Potrero A', 'Vaca', 'Bovino', '', 5, 3), f('Potrero B', 'Novillo', 'Bovino', '', 4, 2)];
/* cfgTexto: el config.js tal cual (puede ser roto a propósito). archivos: { nombre: texto } extra en tablero-campos/. */
function generarCon(nombre, cfgTexto, archivos = {}){
  const dir = path.join(TMP, nombre), tab = path.join(dir, 'tablero-campos');
  fs.mkdirSync(tab, { recursive: true });
  fs.mkdirSync(path.join(dir, 'template'), { recursive: true });
  fs.symlinkSync(path.join(raiz, 'template', 'configs'), path.join(dir, 'template', 'configs'), 'dir');
  fs.copyFileSync(path.join(raiz, 'tablero-campos', 'fuente.html'), path.join(tab, 'fuente.html'));
  fs.copyFileSync(path.join(raiz, 'tablero-campos', 'generar.js'), path.join(tab, 'generar.js'));
  fs.writeFileSync(path.join(tab, 'x.geojson'), JSON.stringify(GEOJSON_X));
  for(const n in archivos) fs.writeFileSync(path.join(tab, n), archivos[n]);
  fs.writeFileSync(path.join(tab, 'config.js'), cfgTexto);
  const gen = spawnSync(process.execPath, [path.join(tab, 'generar.js')], { cwd: dir, encoding: 'utf8' });
  return { gen, index: path.join(tab, 'index.html') };
}
const BASE_CFG = { titulo: 'Tablero de Campos', supabaseUrl: 'https://x.supabase.co', supabaseKey: 'clave-de-prueba', cortesCarga: [0.5, 0.8, 1.2] };
const aCfgTexto = cfg => 'module.exports = ' + JSON.stringify(cfg, null, 2) + ';\n';
function generadorTmp(nombre, campos, titulo = 'Tablero de Campos', extra = {}){
  return generarCon(nombre, aCfgTexto({ ...BASE_CFG, titulo, campos, ...extra }));
}

(async () => {
  const abiertas = [];

  console.log('Carga, TABLERO y generador');
  const a = await abrir({ ls: LS_CLAVES }); abiertas.push(a);
  chequear('el <script> de Leaflet del CDN está y se reemplaza por el falso', /<script src="https:\/\/cdnjs[^"]*leaflet/.test(html));
  chequear('la página carga sin errores de JS', a.errores.length === 0, a.errores.join(' | '));
  chequear('la página dibujó los 5 KPI', a.doc.querySelectorAll('#kpis .kpi').length === 5);
  const botones = [...a.doc.querySelectorAll('.campo-btn')].map(b => b.dataset.campo);
  chequear('botones de campo: La Vuelta, María Laura y Todos (sin Pone Chico)', botones.join(',') === 'la_vuelta,maria_laura,todos', botones.join(','));
  chequear('no hay botón de Pone Chico', !a.doc.querySelector('.campo-btn[data-campo="pone_chico"]'));

  const TAB_INI = 'const TABLERO = ';
  const ini = html.indexOf(TAB_INI), fin = ini === -1 ? -1 : html.indexOf(';\n', ini);
  let TAB = null;
  try{ TAB = JSON.parse(html.slice(ini + TAB_INI.length, fin)); }catch(e){ TAB = null; }
  chequear('index.html trae TABLERO como JSON válido', !!TAB, 'no se pudo leer');
  const cfgCampos = require(path.join(raiz, 'tablero-campos', 'config.js')).campos;
  const tabCampos = (TAB && TAB.campos) || [];
  const idsCfg = cfgCampos.map(c => ({ id: c.id, nombre: c.nombre, usaClave: !!c.usaClave }));
  const idsTab = tabCampos.map(c => ({ id: c.id, nombre: c.nombre, usaClave: c.usaClave }));
  chequear('TABLERO: campos (id, nombre, usaClave) = config.js (' + idsCfg.length + ' campos)', JSON.stringify(idsTab) === JSON.stringify(idsCfg),
    JSON.stringify(idsTab) + ' vs ' + JSON.stringify(idsCfg));
  for(const cc of cfgCampos){
    const tab = (tabCampos.find(x => x.id === cc.id) || {}).potreros || [];
    if(!(cc.potreros && cc.potreros.desdeConfig)){ chequear('TABLERO de ' + cc.id + ': potreros de GeoJSON', Array.isArray(tab)); continue; }
    const esp = (require(path.join(raiz, 'template', 'configs', cc.potreros.desdeConfig + '.js')).potrerosGeo || [])
      .map(p => ({ nombre: p.nombre, area: p.area, coords: p.coords }));
    chequear('TABLERO de ' + cc.id + ' = potrerosGeo de ' + cc.potreros.desdeConfig + ' (' + esp.length + ' potreros)',
      JSON.stringify(tab) === JSON.stringify(JSON.parse(JSON.stringify(esp))));
  }
  const gen = spawnSync(process.execPath, [path.join(raiz, 'tablero-campos', 'generar.js'), '--check'], { cwd: raiz, encoding: 'utf8' });
  chequear('node tablero-campos/generar.js --check sale con 0', gen.status === 0, (gen.stderr || gen.stdout || '').trim());

  console.log('Clave del campo y lectura de solo GET');
  const pedidosLV = llamadasA(a, 'la_vuelta');
  chequear('La Vuelta: se manda x-clave-campo con su clave', pedidosLV.length > 0 && pedidosLV.every(l => l.headers['x-clave-campo'] === CLAVE.la_vuelta), JSON.stringify(pedidosLV.map(l => l.headers)));
  await elegirCampo(a, 'maria_laura');
  const pedidosML = llamadasA(a, 'maria_laura');
  chequear('María Laura: se manda x-clave-campo con su clave', pedidosML.length > 0 && pedidosML.every(l => l.headers['x-clave-campo'] === CLAVE.maria_laura), JSON.stringify(pedidosML.map(l => l.headers)));
  await elegirCampo(a, 'la_vuelta');

  console.log('La Vuelta: totales, potrero sin mapa, escape');
  const LV = STOCK.la_vuelta;
  chequear('KPI cabezas = suma de La Vuelta sin las filas en 0', kpi(a, 0) === sumaCab(LV), 'KPI ' + kpi(a, 0) + ' vs ' + sumaCab(LV));
  chequear('KPI UG = suma sin las filas en 0', kpi(a, 1) === sumaUG(LV), 'KPI ' + kpi(a, 1) + ' vs ' + sumaUG(LV));
  const piq = filaPot(a, 'la_vuelta', 'Piquete');
  chequear('"Piquete" (en stock, fuera del mapa) aparece en la tabla con "sin mapa"', !!piq && piq.textContent.includes('sin mapa'), piq ? piq.textContent : 'no está');
  chequear('un potrero con solo filas en 0 no aparece', !filaPot(a, 'la_vuelta', 'Fantasma'));
  chequear('categoría con HTML: no crea una imagen ni ejecuta código', a.win.pwn === undefined && a.doc.querySelectorAll('img').length === 0);
  chequear('categoría con HTML se ve como texto', a.doc.getElementById('tabla-cat').textContent.includes('<img src=x onerror=window.pwn=1>'));

  console.log('Clic en tabla y en polígono');
  filaPot(a, 'la_vuelta', '12').click(); await dormir(80);
  chequear('clic en la fila "12" muestra "12" en el panel', a.doc.querySelector('#panel h2').textContent === '12', a.doc.querySelector('#panel h2').textContent);
  const poligono = (campo, nombre) => {
    const p = (TAB.campos.find(x => x.id === campo).potreros).find(x => x.nombre === nombre);
    return a.mapa.capa.capas.find(pol => JSON.stringify(pol.coords) === JSON.stringify(p.coords));
  };
  const p5 = poligono('la_vuelta', '5');
  chequear('hay un polígono dibujado para el potrero "5"', !!p5);
  p5.handlers.click(); await dormir(80);
  chequear('clic en el polígono "5" muestra "5" en el panel', a.doc.querySelector('#panel h2').textContent === '5', a.doc.querySelector('#panel h2').textContent);

  console.log('María Laura: dueño');
  await elegirCampo(a, 'maria_laura');
  const dueno = a.doc.getElementById('dueno');
  chequear('el filtro de dueño lista a Perico', [...dueno.options].some(o => o.value === 'Perico'));
  const perico = STOCK.maria_laura.filter(x => x.dueno === 'Perico');
  dueno.value = 'Perico'; dueno.dispatchEvent(new a.win.Event('change')); await dormir(80);
  chequear('con dueño Perico, KPI cabezas = solo sus animales', kpi(a, 0) === sumaCab(perico), 'KPI ' + kpi(a, 0) + ' vs ' + sumaCab(perico));
  chequear('con dueño Perico, KPI UG = solo sus animales', kpi(a, 1) === sumaUG(perico), 'KPI ' + kpi(a, 1) + ' vs ' + sumaUG(perico));
  dueno.value = ''; dueno.dispatchEvent(new a.win.Event('change')); await dormir(80);

  console.log('Todos (solo La Vuelta y María Laura)');
  const b = await abrir({ ls: { ...LS_CLAVES, tablero_campos_elegido: 'todos' } }); abiertas.push(b);
  const todosCab = sumaCab(STOCK.la_vuelta) + sumaCab(STOCK.maria_laura);
  chequear('Todos: KPI cabezas = suma de los 2 campos', kpi(b, 0) === todosCab, 'KPI ' + kpi(b, 0) + ' vs ' + todosCab);
  chequear('Todos: pide stock a La Vuelta y María Laura', ['la_vuelta', 'maria_laura'].every(c => llamadasA(b, c).length > 0));
  chequear('Todos: no pide stock de Pone Chico', llamadasA(b, 'pone_chico').length === 0);
  chequear('Todos: la tabla tiene columna Campo', [...b.doc.querySelectorAll('#tabla-pot th')].some(th => th.textContent.trim().startsWith('Campo')));
  chequear('Todos: el filtro de dueño dice "Dueño / firma"', b.doc.querySelector('#dueno option').textContent.includes('Dueño / firma'));

  console.log('Sin clave: aviso y guardado');
  const c = await abrir({ ls: {} }); abiertas.push(c);
  chequear('sin clave: aparece el aviso de clave', !c.doc.getElementById('clave-aviso').hidden);
  chequear('sin clave: no se pide el stock de La Vuelta', llamadasA(c, 'la_vuelta').length === 0);
  c.doc.getElementById('clave-input').value = 'clavemala12';
  c.doc.getElementById('clave-guardar').click(); await dormir(80);
  chequear('clave que el servidor rechaza: mensaje y no se guarda', c.doc.getElementById('clave-error').textContent.includes('Esa no es la clave de La Vuelta') && !c.win.localStorage.getItem('clave_campo_la_vuelta'));
  c.doc.getElementById('clave-input').value = CLAVE_BUENA;
  c.doc.getElementById('clave-guardar').click(); await dormir(120);
  chequear('clave correcta: se guarda y el aviso se cierra', c.win.localStorage.getItem('clave_campo_la_vuelta') === CLAVE_BUENA && c.doc.getElementById('clave-aviso').hidden);
  const post = c.llamadas.filter(l => l.metodo === 'POST');
  chequear('el único POST es a rpc/verificar_clave con la clave', post.length === 2 && post.every(l => l.url.includes('rpc/verificar_clave')) && JSON.parse(post[1].body).est === 'la_vuelta' && JSON.parse(post[1].body).clave === CLAVE_BUENA, JSON.stringify(post.map(l => l.body)));
  chequear('después de guardar, La Vuelta se lee con x-clave-campo', llamadasA(c, 'la_vuelta').some(l => l.headers['x-clave-campo'] === CLAVE_BUENA));
  chequear('después de guardar, KPI cabezas de La Vuelta', kpi(c, 0) === sumaCab(STOCK.la_vuelta), 'KPI ' + kpi(c, 0));

  console.log('Lectura vacía o sin red: se queda la copia guardada');
  const cache = { la_vuelta: { filas: STOCK.la_vuelta.filter(x => Number(x.cantidad) !== 0), leido: AHORA } };
  const lsCache = { ...LS_CLAVES, tablero_campos_v1: JSON.stringify(cache) };
  const d = await abrir({ ls: lsCache, vacio: ['la_vuelta'] }); abiertas.push(d);
  chequear('lectura vacía: KPI cabezas sigue con la copia', kpi(d, 0) === sumaCab(STOCK.la_vuelta), 'KPI ' + kpi(d, 0));
  chequear('lectura vacía: #estado en rojo', d.doc.getElementById('estado').className === 'mal', d.doc.getElementById('estado').className);
  const e = await abrir({ ls: lsCache, caido: ['la_vuelta'] }); abiertas.push(e);
  chequear('sin red: KPI cabezas muestra la copia', kpi(e, 0) === sumaCab(STOCK.la_vuelta), 'KPI ' + kpi(e, 0));
  chequear('sin red: #estado en rojo y dice sin conexión', e.doc.getElementById('estado').className === 'mal' && e.doc.getElementById('estado').textContent.includes('sin conexión'), e.doc.getElementById('estado').textContent);

  console.log('Sin Leaflet (L indefinido)');
  const s = await abrir({ ls: LS_CLAVES, sinL: true }); abiertas.push(s);
  chequear('sin L: no hay error de JS sin capturar', s.errores.length === 0, s.errores.join(' | '));
  chequear('sin L: ningún paso de pintar falla (sin console.error)', s.consola.length === 0, s.consola.join(' | '));
  chequear('sin L: se dibujan los 5 KPI con las cabezas de La Vuelta', s.doc.querySelectorAll('#kpis .kpi').length === 5 && kpi(s, 0) === sumaCab(LV), 'KPI ' + kpi(s, 0));
  chequear('sin L: #map dice que no se pudo cargar', s.doc.getElementById('map').textContent.includes('No se pudo cargar'), s.doc.getElementById('map').textContent);
  chequear('sin L: #tabla-pot tiene filas de potreros', s.doc.querySelectorAll('#tabla-pot tr.fila-pot').length > 0);
  chequear('sin L: #leyenda no está vacía', s.doc.getElementById('leyenda').innerHTML.trim() !== '');

  console.log('Potreros importados con coordenadas rotas');
  const ROTO = { nombre: 'Roto', coords: [[-31, -55], null, [-31.1, -55.1]] };
  const NUEVO = { nombre: 'Nuevo OK', coords: [[-31.4, -55.4], [-31.41, -55.4], [-31.41, -55.41]] };
  const r = await abrir({ ls: { ...LS_CLAVES, la_vuelta_potreros_nuevos: JSON.stringify([ROTO, NUEVO]) } }); abiertas.push(r);
  chequear('con "Roto" y "Nuevo OK": se ven los 5 KPI y las cabezas', r.doc.querySelectorAll('#kpis .kpi').length === 5 && kpi(r, 0) === sumaCab(LV), 'KPI ' + kpi(r, 0));
  chequear('"Nuevo OK" aparece en #tabla-pot', !!filaPot(r, 'la_vuelta', 'Nuevo OK'));
  chequear('"Nuevo OK" se dibuja como polígono', r.mapa.poligonos.some(p => JSON.stringify(p.coords) === JSON.stringify(NUEVO.coords)));
  chequear('"Roto" no se dibuja: ningún polígono con coords nulas', r.mapa.poligonos.every(p => p.coords.every(q => Array.isArray(q))), JSON.stringify(r.mapa.poligonos.map(p => p.coords)).slice(0, 200));
  chequear('"Roto" no aparece como tooltip de polígono', !r.mapa.poligonos.some(p => String(p.tooltip || '').includes('Roto')));
  chequear('"Roto" no aparece en #tabla-pot', !filaPot(r, 'la_vuelta', 'Roto'));

  console.log('Lectura vacía con clave que el servidor rechaza');
  const g1 = await abrir({ ls: lsCache, vacio: ['la_vuelta'] }); abiertas.push(g1);
  chequear('clave mala + lectura vacía: KPI cabezas conserva la copia', kpi(g1, 0) === sumaCab(STOCK.la_vuelta), 'KPI ' + kpi(g1, 0));
  chequear('clave mala + lectura vacía: se pidió verificar la clave guardada', g1.llamadas.some(l => l.metodo === 'POST' && JSON.parse(l.body).clave === CLAVE.la_vuelta));
  chequear('clave mala + lectura vacía: #clave-aviso visible con "ya no sirve"', !g1.doc.getElementById('clave-aviso').hidden && g1.doc.getElementById('clave-msg').textContent.includes('ya no sirve'), g1.doc.getElementById('clave-msg').textContent);

  console.log('Lectura vacía con clave buena (campo sin animales)');
  const g2 = await abrir({ ls: { ...LS_CLAVES, clave_campo_la_vuelta: CLAVE_BUENA, tablero_campos_v1: JSON.stringify(cache) }, vacio: ['la_vuelta'] }); abiertas.push(g2);
  chequear('clave buena + lectura vacía: KPI cabezas = 0', kpi(g2, 0) === 0, 'KPI ' + kpi(g2, 0));
  chequear('clave buena + lectura vacía: la copia guardada se reemplaza por vacío', JSON.parse(g2.win.localStorage.getItem('tablero_campos_v1')).la_vuelta.filas.length === 0);
  chequear('clave buena: #clave-aviso sigue oculto', g2.doc.getElementById('clave-aviso').hidden);

  console.log('María Laura: filtro de dueño y carga');
  const h = await abrir({ ls: { ...LS_CLAVES, tablero_campos_elegido: 'maria_laura' } }); abiertas.push(h);
  const kpiTxt = (x, i) => x.doc.querySelectorAll('#kpis .kpi b')[i].textContent;
  const sinFiltro = { carga: kpiTxt(h, 2), cab: kpiTxt(h, 0) };
  h.doc.getElementById('dueno').value = 'Perico'; h.doc.getElementById('dueno').dispatchEvent(new h.win.Event('change')); await dormir(80);
  const conFiltro = { carga: kpiTxt(h, 2), cab: kpiTxt(h, 0) };
  const peric = STOCK.maria_laura.filter(x => x.dueno === 'Perico');
  chequear('filtro Perico: KPI Carga no cambia (usa todos los dueños)', sinFiltro.carga === conFiltro.carga, sinFiltro.carga + ' vs ' + conFiltro.carga);
  chequear('filtro Perico: KPI cabezas sí cambia y es la de Perico', sinFiltro.cab !== conFiltro.cab && kpi(h, 0) === sumaCab(peric), 'KPI ' + conFiltro.cab);

  console.log('Potreros con animales: ocupados <= total');
  const k = await abrir({ ls: LS_CLAVES }); abiertas.push(k);
  const [ocup, tot] = kpiTxt(k, 3).split('/').map(x => Number(x.trim()));
  const geoLV = TAB.campos.find(x => x.id === 'la_vuelta').potreros;
  const ocupEsp = new Set(LV.filter(x => Number(x.cantidad) !== 0 && geoLV.some(p => p.nombre === x.potrero)).map(x => x.potrero)).size;
  const totEsp = geoLV.filter(p => p.coords && Number(p.area) > 0).length;
  chequear('ocupados <= total con un potrero solo en stock ("Piquete")', ocup <= tot, kpiTxt(k, 3));
  chequear('ocupados y total = los esperados (sin contar "Piquete")', ocup === ocupEsp && tot === totEsp, kpiTxt(k, 3) + ' vs ' + ocupEsp + ' / ' + totEsp);

  console.log('Nombre de potrero con HTML');
  const EVIL = '"><img src=x onerror=window.pwn2=1>';
  const evilStock = { ...STOCK, la_vuelta: [...STOCK.la_vuelta, f(EVIL, 'Vaca', 'Bovino', '', 4, 4)] };
  const ev = await abrir({ ls: { ...LS_CLAVES, la_vuelta_potreros_nuevos: JSON.stringify([{ nombre: EVIL, coords: [[-31.5, -55.5], [-31.51, -55.5], [-31.51, -55.51]] }]) }, stock: evilStock });
  abiertas.push(ev);
  const filaEv = filaPot(ev, 'la_vuelta', EVIL);
  chequear('nombre con HTML: window.pwn2 no existe', ev.win.pwn2 === undefined);
  chequear('nombre con HTML: ningún <img> dentro de #tabla-pot', ev.doc.querySelectorAll('#tabla-pot img').length === 0);
  chequear('nombre con HTML: la fila existe y muestra el nombre como texto', !!filaEv && filaEv.textContent.includes(EVIL), filaEv ? filaEv.textContent : 'no está');
  const tips = ev.mapa.capa.capas.map(p => String(p.tooltip || ''));
  chequear('tooltips de polígonos sin "<img" crudo', !tips.some(t => t.includes('<img')) && tips.some(t => t.includes('&lt;img')), tips.join(' | ').slice(0, 200));

  console.log('Generador en copia temporal: campo sin clave, GeoJSON, título escapado');
  const gx = generadorTmp('uno', [CAMPO_X], 'Tablero <Campo> & "X"');
  chequear('generar.js con un campo GeoJSON sale con 0', gx.gen.status === 0, (gx.gen.stderr || gx.gen.stdout || '').trim());
  const htmlX = fs.existsSync(gx.index) ? fs.readFileSync(gx.index, 'utf8') : '';
  const xs = await abrir({ html: htmlX, ls: {}, stock: { campo_x: STOCK_X } }); abiertas.push(xs);
  chequear('campo_x: la página carga sin errores de JS', xs.errores.length === 0, xs.errores.join(' | '));
  const botonesX = xs.doc.querySelectorAll('.campo-btn');
  chequear('campo_x: exactamente un botón de campo', botonesX.length === 1, botonesX.length + ' botones');
  chequear('campo_x: no hay botón "todos"', !xs.doc.querySelector('.campo-btn[data-campo="todos"]'));
  chequear('campo_x: el nombre "Campo <X>" se ve como texto y no crea elementos', botonesX.length === 1 && botonesX[0].textContent === 'Campo <X>' && botonesX[0].children.length === 0,
    botonesX[0] ? botonesX[0].innerHTML : 'sin botón');
  const polX = xs.mapa.capa ? xs.mapa.capa.capas : [];
  chequear('campo_x: se dibujan 2 polígonos', polX.length === 2, polX.length + ' polígonos');
  const lat = (pol, i) => pol.coords[0][i];
  chequear('campo_x: las coordenadas llegan como [lat, lon] (lat ≈ -31, lon ≈ -55)',
    polX.length === 2 && Math.abs(lat(polX[0], 0) + 31.2) < 0.5 && Math.abs(lat(polX[0], 1) + 55.1) < 0.5 && Math.abs(lat(polX[1], 0) + 31.3) < 0.5 && Math.abs(lat(polX[1], 1) + 55.2) < 0.5,
    polX.length ? JSON.stringify(polX[0].coords[0]) : 'sin polígonos');
  const llX = xs.llamadas.filter(l => l.url.includes('establecimiento=eq.campo_x'));
  chequear('campo_x: la lectura se hace sin x-clave-campo', llX.length > 0 && llX.every(l => !('x-clave-campo' in l.headers)), JSON.stringify(llX.map(l => l.headers)));
  chequear('campo_x: <title> con el título escapado', htmlX.includes('<title>Tablero &lt;Campo&gt; &amp; &quot;X&quot;</title>') && xs.doc.title === 'Tablero <Campo> & "X"', xs.doc.title);

  console.log('Generador en copia temporal: ids inválidos o repetidos');
  const malo = generadorTmp('mal_id', [{ ...CAMPO_X, id: 'Mal Id' }]);
  chequear('id "Mal Id" hace fallar generar.js', malo.gen.status !== 0, 'sale con ' + malo.gen.status);
  const dup = generadorTmp('dup', [CAMPO_X, { ...CAMPO_X, nombre: 'Otro' }]);
  chequear('id repetido "campo_x" hace fallar generar.js', dup.gen.status !== 0, 'sale con ' + dup.gen.status);

  console.log('Dos campos con HTML en nombre y etiqueta; prefijoAlmacen');
  const dosCampos = [
    { id: 'a', nombre: 'Santa & <b>Hijos</b>', usaClave: false, etiquetaDueno: 'Dueño <i>x</i>', potreros: { geojson: 'x.geojson' } },
    { id: 'b', nombre: 'Campo B', usaClave: false, etiquetaDueno: 'Dueño', potreros: { desdeConfig: 'maria-laura' } }
  ];
  const gd = generadorTmp('dos_campos', dosCampos, 'Tablero de Campos', { prefijoAlmacen: 'tablero_x' });
  chequear('dos campos: generar.js sale con 0', gd.gen.status === 0, (gd.gen.stderr || gd.gen.stdout || '').trim());
  const htmlD = fs.existsSync(gd.index) ? fs.readFileSync(gd.index, 'utf8') : '';
  const STOCK_DOS = {
    a: [f('Potrero A', 'Vaca', 'Bovino', 'Juan', 5, 3), f('Potrero B', 'Novillo', 'Bovino', 'Juan', 4, 2)],
    b: [f('Tajamar', 'Vaca', 'Bovino', 'Silvia', 60, 60), f('Casco', 'Vaquillona 1-2', 'Bovino', 'Perico', 25, 15)]
  };
  const dd = await abrir({ html: htmlD, ls: {}, stock: STOCK_DOS }); abiertas.push(dd);
  chequear('dos campos: la página carga sin errores de JS', dd.errores.length === 0, dd.errores.join(' | '));
  chequear('prefijoAlmacen tablero_x: el caché va a tablero_x_v1 y no a tablero_campos_v1',
    dd.win.localStorage.getItem('tablero_x_v1') !== null && dd.win.localStorage.getItem('tablero_campos_v1') === null,
    Object.keys(dd.win.localStorage).join(', ') || 'localStorage vacío');
  dd.doc.querySelector('.campo-btn[data-campo="todos"]').click(); await dormir(80);
  chequear('prefijoAlmacen tablero_x: la elección va a tablero_x_elegido', dd.win.localStorage.getItem('tablero_x_elegido') === 'todos' && dd.win.localStorage.getItem('tablero_campos_elegido') === null,
    Object.keys(dd.win.localStorage).join(', '));
  const contenedores = ['#panel', '#dueno', '#tabla-pot', '#campos'];
  chequear('Todos: ningún <b> ni <i> dentro de #panel, #dueno, #tabla-pot ni #campos',
    contenedores.every(s => dd.doc.querySelectorAll(s + ' b, ' + s + ' i').length === 0),
    contenedores.map(s => s + ':' + dd.doc.querySelectorAll(s + ' b, ' + s + ' i').length).join(' '));
  chequear('Todos: el nombre "Santa & <b>Hijos</b>" se ve como texto en el botón de campo',
    [...dd.doc.querySelectorAll('#campos .campo-btn')].some(bt => bt.textContent === 'Santa & <b>Hijos</b>'));
  chequear('Todos: el nombre se ve como texto en #panel (Por campo)', dd.doc.getElementById('panel').textContent.includes('Santa & <b>Hijos</b>'), dd.doc.getElementById('panel').textContent.slice(0, 200));
  chequear('Todos: el nombre se ve como texto en #tabla-pot (columna Campo)', dd.doc.getElementById('tabla-pot').textContent.includes('Santa & <b>Hijos</b>'));
  await elegirCampo(dd, 'a');
  chequear('campo a: la etiqueta del dueño "Dueño <i>x</i>" se ve como texto en #dueno', dd.doc.getElementById('dueno').textContent.includes('Dueño <i>x</i>: todos'), dd.doc.getElementById('dueno').textContent);
  chequear('campo a: ningún <b> ni <i> en #dueno ni #panel', ['#dueno', '#panel'].every(s => dd.doc.querySelectorAll(s + ' b, ' + s + ' i').length === 0));

  console.log('Generador: errores en español (✗, sin pila) y MultiPolygon (⚠)');
  const { supabaseUrl: _sinUrl, ...sinUrl } = BASE_CFG;
  const DUP_GEO = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { nombre: 'Repetido' }, geometry: { type: 'Polygon', coordinates: [[[-55.10, -31.20], [-55.11, -31.20], [-55.11, -31.21], [-55.10, -31.20]]] } },
    { type: 'Feature', properties: { nombre: 'Repetido' }, geometry: { type: 'Polygon', coordinates: [[[-55.20, -31.30], [-55.21, -31.30], [-55.21, -31.31], [-55.20, -31.30]]] } }
  ] };
  const MULTI = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { nombre: 'Multi', area: 50 }, geometry: { type: 'MultiPolygon', coordinates: [
      [[[-55.10, -31.20], [-55.11, -31.20], [-55.11, -31.21], [-55.10, -31.20]]],
      [[[-55.20, -31.30], [-55.21, -31.30], [-55.21, -31.31], [-55.20, -31.30]]]
    ] } }
  ] };
  const casos = [
    ['geojson "../../etc/hostname" (fuera de tablero-campos)', generarCon('err_trav', aCfgTexto({ ...BASE_CFG, campos: [{ ...CAMPO_X, potreros: { geojson: '../../etc/hostname' } }] }))],
    ['falta supabaseUrl', generarCon('err_url', aCfgTexto({ ...sinUrl, campos: [CAMPO_X] }))],
    ['cortesCarga [1, 0.5, 2]', generarCon('err_cortes', aCfgTexto({ ...BASE_CFG, cortesCarga: [1, 0.5, 2], campos: [CAMPO_X] }))],
    ['desdeConfig "zzz"', generarCon('err_zzz', aCfgTexto({ ...BASE_CFG, campos: [{ ...CAMPO_X, potreros: { desdeConfig: 'zzz' } }] }))],
    ['config.js con error de sintaxis', generarCon('err_sint', 'module.exports = {\n  titulo: "Roto",\n  campos: [\n')],
    ['dos features con el mismo nombre', generarCon('err_dup', aCfgTexto({ ...BASE_CFG, campos: [{ ...CAMPO_X, potreros: { geojson: 'dup.geojson' } }] }), { 'dup.geojson': JSON.stringify(DUP_GEO) })]
  ];
  for(const [nombre, r] of casos){
    const salida = (r.gen.stderr || '') + (r.gen.stdout || '');
    chequear('error ' + nombre + ': sale con código distinto de 0, dice ✗ y sin pila', r.gen.status !== 0 && salida.includes('✗') && !/^ {4}at /m.test(salida), 'sale con ' + r.gen.status + ': ' + salida.trim().slice(0, 240));
  }
  const mp = generarCon('multi', aCfgTexto({ ...BASE_CFG, campos: [{ ...CAMPO_X, potreros: { geojson: 'multi.geojson' } }] }), { 'multi.geojson': JSON.stringify(MULTI) });
  const salidaMp = (mp.gen.stderr || '') + (mp.gen.stdout || '');
  chequear('MultiPolygon de 2 partes: generar.js sale con 0', mp.gen.status === 0, salidaMp.trim());
  chequear('MultiPolygon de 2 partes: avisa con ⚠', salidaMp.includes('⚠'), salidaMp.trim());

  console.log('Solo lectura en todo el recorrido');
  const todas = abiertas.flatMap(x => x.llamadas);
  const noGet = todas.filter(l => l.metodo !== 'GET');
  chequear('solo GET, salvo POST a rpc/verificar_clave', noGet.every(l => l.metodo === 'POST' && l.url.includes('rpc/verificar_clave')), noGet.map(l => l.metodo + ' ' + l.url).join(', '));
  chequear('ninguna lectura de pone_chico en ninguna escena', todas.every(l => !l.url.includes('establecimiento=eq.pone_chico')));
  chequear('ninguna escena dio errores de JS', abiertas.every(x => x.errores.length === 0), abiertas.map(x => x.errores.join('|')).join(' ; '));

  for(const x of abiertas) x.win.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fallas ? '\n' + fallas + ' FALLAS' : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
})();
