/*
 * Instructivos (29/10/2026 Campo; 30/10/2026 móvil completa y PC, a pedido de Pedro): tres páginas escritas a mano
 * (no generadas), una por tipo de app, con TODAS sus funciones:
 *     instructivo-campo/index.html   la app Campo        (<campo>-movil-campo/)
 *     instructivo-movil/index.html   la móvil completa   (<campo>-movil/)
 *     instructivo-pc/index.html      la PC               (<campo>-pc/)
 * Esta prueba hace fallar el CI cuando una página se queda atrás de su app (reemplaza a probar_instructivo_campo.js):
 *   1. cada botón de las 3 variantes de la página (los `id="btn-..."`, los `data-accion` / `data-sub`, los de las
 *      ventanas Desaparecidos y Vecinos y, en general, todo botón con id o data-* cuyo texto lleva un emoji o una
 *      flecha) tiene que figurar, con su emoji, en la página; los que no, van a EXCEPCIONES con su motivo.
 *      Un botón oculto en el HTML (display:none) y sin explicación también falla: hay que decidir;
 *   2. las versiones de "Actualizado para" (data-version) coinciden con versionMovilSimple (Campo), versionMovil (móvil
 *      completa) o versionPc (PC) de los 3 config, y con el encabezado que muestra la app;
 *   3. cada `href="#x"` de la página tiene su `id="x"` (y no hay ids repetidos);
 *   4. el botón "📖 Instructivo" está en las 3 variantes de su página (en la PC, dentro de "Este dispositivo") y en
 *      ninguna otra, abre la carpeta que corresponde (también sin señal, desde la caché, como blob:) y el sw.js de
 *      las 3 variantes precarga SU página y ninguna otra;
 *   5. la tabla "Según tu campo" da por hecho lo que dicen los config (clave del campo, caravanas, DICOSE, pesadas...):
 *      si un flag cambia, hay que actualizar la tabla y esta prueba;
 *   6. cada página sigue siendo liviana y sin red: sin scripts, sin enlaces externos, con modo oscuro y viewport.
 * Los textos con una parte que cambia ("☀ Modo sol: NO", "🛰 Satelital: ON") o con un "›" de sub-menú se comparan por su
 * parte fija.
 * Uso: node tests/probar_instructivos.js   (sin argumentos; lee las carpetas del repo)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const raiz = path.join(__dirname, '..');
let fallas = 0;
const chequear = (n, c, d) => { console.log((c ? '  OK  ' : '  MAL ') + n + (c ? '' : ' — ' + (d || ''))); if (!c) fallas++; };
const leer = r => fs.readFileSync(path.join(raiz, r), 'utf8');
const dormir = ms => new Promise(r => setTimeout(r, ms));

const CAMPOS = ['la-vuelta', 'maria-laura', 'pone-chico'];
const cfgs = Object.fromEntries(CAMPOS.map(c => [c, require(path.join(raiz, 'template', 'configs', c + '.js'))]));

/* Una entrada por página. `variante(campo)` = carpeta de la app; `version` = campo del config con el número que la app
   muestra; `encabezado(v)` = el texto exacto del encabezado de la app con ese número. */
/* Lo que está en el código de Campo y de la móvil completa pero no se puede alcanzar desde la pantalla (solo la PC lo ve). */
const SOLO_PC = {
  'btn-puntos': 'Está en la lista de Herramientas con display:none y ningún código lo muestra en la móvil ni en Campo (solo la PC lo ve).',
  'btn-resync-puntos': 'Igual que btn-puntos: oculto con display:none en la móvil y en Campo, solo lo ve la PC.',
  'np-colocar': 'Botón de la ventana de Aguadas / instalaciones, que solo se abre con btn-puntos (oculto en la móvil y en Campo): solo la PC la ve.',
  'np-importar': 'Botón de la ventana de Aguadas / instalaciones, que solo se abre con btn-puntos (oculto en la móvil y en Campo): solo la PC la ve.',
  'np-cargar-seed': 'Botón de la ventana de Aguadas / instalaciones, que solo se abre con btn-puntos (oculto en la móvil y en Campo): solo la PC la ve.',
  'db-deshacer': 'Control de "Dibujar potrero", que solo se inicia desde btn-dibujar-potrero (solo la PC): en la móvil y en Campo el código está pero no hay cómo llegar.',
  'db-terminar': 'Control de "Dibujar potrero", que solo se inicia desde btn-dibujar-potrero (solo la PC): en la móvil y en Campo el código está pero no hay cómo llegar.',
  'db-cancelar': 'Control de "Dibujar potrero", que solo se inicia desde btn-dibujar-potrero (solo la PC): en la móvil y en Campo el código está pero no hay cómo llegar.',
};
const PAGINAS = [
  {
    id: 'campo', dir: 'instructivo-campo', nombre: 'Campo', version: 'versionMovilSimple',
    variante: c => c + '-movil-campo',
    encabezado: v => `<div class="sub">v${v}</div>`,
    excepciones: SOLO_PC,
    ocultoPorConfig: { 'btn-caravana': 'caravanasHabilitado' },
    /* lo que la tabla "Según tu campo" de esta página da por hecho */
    esperado: {
      'la-vuelta':   { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Firma', padronOffline: true },
      'maria-laura': { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Dueño', padronOffline: false },
      'pone-chico':  { claveCampo: false, caravanasHabilitado: false, duenoLabel: 'Dueño', padronOffline: false },
    },
  },
  {
    id: 'movil', dir: 'instructivo-movil', nombre: 'móvil completa', version: 'versionMovil',
    variante: c => c + '-movil',
    encabezado: v => `· v${v}</div>`,
    excepciones: SOLO_PC,
    ocultoPorConfig: { 'btn-caravana': 'caravanasHabilitado', 'btn-guias': 'guiasHabilitado', 'btn-pesadas': 'pesadasHistorial', 'btn-voz': 'siempre' },
    esperado: {
      'la-vuelta':   { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Firma',  duenoObligatorio: false, guiasHabilitado: true,  dicoseHabilitado: true,  trasladoHabilitado: true,  pesadasHistorial: true,  usaExcelBridge: true,  mapLabels: false, padronOffline: true },
      'maria-laura': { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Dueño', duenoObligatorio: true,  guiasHabilitado: true,  dicoseHabilitado: false, trasladoHabilitado: false, pesadasHistorial: false, usaExcelBridge: false, mapLabels: true, padronOffline: false },
      'pone-chico':  { claveCampo: false, caravanasHabilitado: false, duenoLabel: 'Dueño', duenoObligatorio: true,  guiasHabilitado: false, dicoseHabilitado: false, trasladoHabilitado: false, pesadasHistorial: false, usaExcelBridge: false, mapLabels: true, padronOffline: false },
    },
  },
  {
    id: 'pc', dir: 'instructivo-pc', nombre: 'PC', version: 'versionPc',
    variante: c => c + '-pc',
    encabezado: v => `· v${v} (completa)</div>`,
    excepciones: {},
    ocultoPorConfig: { 'btn-caravana': 'caravanasHabilitado', 'btn-guias': 'guiasHabilitado', 'btn-pesadas': 'pesadasHistorial',
      'btn-faltantes': 'datosFaltantes', 'btn-csv-baston': 'completarCsvBaston', 'btn-voz': 'siempre',
      'vs-csv': 'siempre', 'df-csv': 'datosFaltantes' },
    esperado: {
      'la-vuelta':   { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Firma',  duenoObligatorio: false, guiasHabilitado: true,  dicoseHabilitado: true,  trasladoHabilitado: true,  pesadasHistorial: true,  datosFaltantes: true,  completarCsvBaston: true,  usaExcelBridge: true,  mapLabels: false, puntosSeed: true },
      'maria-laura': { claveCampo: true,  caravanasHabilitado: true,  duenoLabel: 'Dueño', duenoObligatorio: true,  guiasHabilitado: true,  dicoseHabilitado: false, trasladoHabilitado: false, pesadasHistorial: false, datosFaltantes: false, completarCsvBaston: false, usaExcelBridge: false, mapLabels: true,  puntosSeed: false },
      'pone-chico':  { claveCampo: false, caravanasHabilitado: false, duenoLabel: 'Dueño', duenoObligatorio: true,  guiasHabilitado: false, dicoseHabilitado: false, trasladoHabilitado: false, pesadasHistorial: false, datosFaltantes: false, completarCsvBaston: false, usaExcelBridge: false, mapLabels: true,  puntosSeed: false },
    },
  },
];
/* Botones que no se nombran en ninguna página porque son solo un signo (cerrar, anterior / siguiente de un visor...). */
const GLIFOS_SIN_NOMBRE = new Set(['✕', '‹', '›', '×']);

const normalizar = t => t.replace(/️/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const sinTags = t => t.replace(/<[^>]*>/g, '');
/* Parte fija de un texto con estado o con marca de sub-menú: "☀ Modo sol: NO" -> "☀ Modo sol"; "➕ Agregar potrero ›" -> "➕ Agregar potrero". */
const parteFija = t => normalizar(t.split(':')[0].replace(/\s*›\s*$/, ''));
const tieneEmoji = t => /[\p{Extended_Pictographic}⬇⬆↩↻←→＋＋⇄]/u.test(t);
const VENTANA_ATTR = /\b(data-(?:encontrado|perdido|muerte-desap|vecino-desap|vec-accion|vec-agregar-fila))=/;

/* Botones de un index.html que la página tiene que nombrar: [{clave, id, texto, oculto}] */
function botonesDe(html) {
  const salida = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], crudo = m[2];
    if (crudo.includes('${')) continue;           // texto armado por el código (Guardar / Registrar...): no es una función con nombre fijo
    const texto = normalizar(sinTags(crudo));
    if (!texto || /[{}<>=$]/.test(texto)) continue;   // la "etiqueta" que se rompió por un `>` dentro de un atributo con ${...}
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    const data = (attrs.match(/\b(data-[\w-]+)/) || [])[1];
    const accion = (attrs.match(/\bdata-accion="([^"]+)"/) || [])[1];
    const sub = (attrs.match(/\bdata-sub="([^"]+)"/) || [])[1];
    const ventana = (attrs.match(VENTANA_ATTR) || [])[1];
    if (!id && !data) continue;
    const exigido = (id && /^btn-/.test(id)) || accion || sub || ventana || (tieneEmoji(texto) && !GLIFOS_SIN_NOMBRE.has(texto));
    if (!exigido) continue;
    const oculto = /display\s*:\s*none/.test(attrs);
    salida.push({ id, texto, oculto, clave: id || (accion ? 'data-accion=' + accion : sub ? 'data-sub=' + sub : data + ':' + texto) });
  }
  return salida;
}

/* ---------- mini-entorno jsdom, para apretar el botón de verdad ---------- */
function limites() {
  const b = { getCenter() { return { lat: -31.98, lng: -56.34 }; }, extend() { return b; }, isValid() { return true; }, pad() { return b; },
    getNorth() { return -31.9; }, getSouth() { return -32.0; }, getEast() { return -56.3; }, getWest() { return -56.4; }, contains() { return true; } };
  return b;
}
function stubLeaflet(win) {
  const conocidos = { getBounds: () => limites(), getLatLng: () => ({ lat: -31.98, lng: -56.34 }), getElement: () => win.document.createElement('div'),
    getTooltip: () => ({ setContent() {}, getElement() { return win.document.createElement('div'); } }), getPopup: () => ({ setContent() {}, isOpen() { return false; } }), isPopupOpen: () => false };
  const capa = () => { const o = new Proxy({ __capa: true }, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; if (conocidos[p]) return conocidos[p]; return () => o; }, has() { return true; } }); return o; };
  const mapa = { _capas: new Set(), setView() { return mapa; }, fitBounds() { return mapa; }, on() { return mapa; }, addLayer(l) { mapa._capas.add(l); return mapa; },
    removeLayer(l) { mapa._capas.delete(l); return mapa; }, hasLayer(l) { return mapa._capas.has(l); }, getZoom() { return 14; }, invalidateSize() { return mapa; },
    setMaxBounds() { return mapa; }, doubleClickZoom: { disable() {}, enable() {} } };
  win.L = { map() { return mapa; }, tileLayer() { const c = capa(); mapa._capas.add(c); return c; }, polygon() { return capa(); }, marker() { return capa(); },
    circleMarker() { return capa(); }, circle() { return capa(); }, divIcon() { return {}; }, latLng(a, b) { return { lat: a, lng: b }; }, latLngBounds() { return limites(); }, DomEvent: { stopPropagation() {} } };
  win.JSZip = function () { return { file() {}, generateAsync() { return Promise.resolve(new win.Blob([])); } }; };
}
async function levantar(archivo, enLinea, cache) {
  const html = fs.readFileSync(path.join(raiz, archivo), 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/' + archivo.replace(/index\.html$/, ''), virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient() { return null; } };
  Object.defineProperty(win.navigator, 'onLine', { value: enLinea, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:instructivo'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLAnchorElement.prototype.click = function () {};
  const abiertas = [];
  win.open = (...a) => { abiertas.push(a); return null; };
  const pedidas = [];
  if (cache !== undefined) {
    Object.defineProperty(win, 'caches', { configurable: true, value: { match: async (url) => { pedidas.push(url); return cache; } } });
  }
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo); } catch (e) { errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores, abiertas, pedidas };
}

(async () => {
  for (const P of PAGINAS) {
    console.log(`\n================ ${P.dir} (app ${P.nombre}) ================`);
    const pagina = leer(P.dir + '/index.html');
    const textoPagina = normalizar(sinTags(pagina.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<head>[\s\S]*?<\/head>/, '')));

    // ---- 1. Todas las funciones de la app figuran en la página ----
    console.log('\n[1] cada botón de la app figura (con su emoji) en la página');
    const requeridos = new Map();   // texto fijo -> quién lo pide
    for (const c of CAMPOS) {
      const dir = P.variante(c);
      const html = leer(dir + '/index.html');
      const botones = botonesDe(html);
      chequear(`${dir}: se leyeron botones (esperado más de 20)`, botones.length > 20, 'leídos: ' + botones.length);
      for (const b of botones) {
        if (b.id && P.excepciones[b.id]) continue;
        if (b.oculto) {
          const flag = P.ocultoPorConfig[b.id];
          if (!flag) { chequear(`${dir}: ${b.clave} está oculto en el HTML y no figura en excepciones ni en ocultoPorConfig`, false, `"${b.texto}": decidí si se documenta o va a excepciones con su motivo`); continue; }
          if (flag !== 'siempre' && !cfgs[c][flag]) continue;   // 'siempre': lo muestra el código según el navegador (🎤 con reconocimiento de voz) o según el resultado (⬇ Descargar detalle (CSV) cuando hay diferencias), no un config
        }
        const fijo = parteFija(b.texto);
        if (GLIFOS_SIN_NOMBRE.has(fijo)) continue;
        if (!requeridos.has(fijo)) requeridos.set(fijo, []);
        requeridos.get(fijo).push(`${c}:${b.clave}`);
      }
    }
    /* Con borde de palabra al final: "❓ Desaparecido" (la acción de la ficha) no se da por nombrado por "❓ Desaparecidos" (la ventana). */
    const nombra = fijo => new RegExp(normalizar(fijo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'u').test(textoPagina);
    for (const [fijo, quienes] of requeridos) {
      chequear(`la página nombra "${fijo}"`, nombra(fijo), 'lo piden ' + quienes.join(', '));
    }
    // las excepciones tienen que seguir existiendo (si no, sobran) y llevar un motivo
    for (const id of Object.keys(P.excepciones)) {
      const existe = CAMPOS.every(c => leer(P.variante(c) + '/index.html').includes(`id="${id}"`));
      chequear(`la excepción ${id} sigue existiendo en las 3 variantes (si ya no existe, sacala de excepciones)`, existe);
      chequear(`la excepción ${id} tiene motivo`, P.excepciones[id].length > 20);
    }

    // ---- 1b. La tabla "Según tu campo" ----
    console.log('\n[5] las diferencias por campo de la página coinciden con los config');
    for (const c of CAMPOS) for (const k of Object.keys(P.esperado[c])) {
      const real = k === 'puntosSeed' ? (cfgs[c].puntosSeed || []).length > 0 : (typeof P.esperado[c][k] === 'boolean' ? !!cfgs[c][k] : cfgs[c][k]);
      chequear(`config ${c}.${k} = ${P.esperado[c][k]} (la tabla "Según tu campo" lo da por hecho)`, real === P.esperado[c][k], `hoy: ${real}; si cambió, actualizá la tabla de ${P.dir} y esta prueba`);
    }
    chequear('la página tiene su tabla "Según tu campo"', /id="campos"[\s\S]*?<table>/.test(pagina));

    // ---- 2. Versiones ----
    console.log('\n[2] versiones anotadas en "Actualizado para"');
    const versionesPagina = {};
    for (const m of pagina.matchAll(/data-version="([^"]+)"[^>]*>([^<]*)</g)) versionesPagina[m[1]] = m[2].trim();
    chequear('la página anota las versiones de los 3 campos (y no más)', Object.keys(versionesPagina).sort().join() === CAMPOS.slice().sort().join(), JSON.stringify(versionesPagina));
    for (const c of CAMPOS) {
      const real = cfgs[c][P.version];
      chequear(`${c}: la página dice ${versionesPagina[c]} y ${P.version} es ${real}`, versionesPagina[c] === real,
        `actualizá "Actualizado para" y "Novedades de esta versión" en ${P.dir}/index.html`);
      const html = leer(P.variante(c) + '/index.html');
      chequear(`${P.variante(c)}: el encabezado de la app muestra v${real}`, html.includes(P.encabezado(real)), 'regenerá con node template/generar.js');
    }
    const cajaNovedades = (pagina.match(/id="novedades"[\s\S]*?<\/div>/) || [''])[0];   // solo la caja, no un <li> cualquiera más abajo
    chequear('hay una sección "Novedades de esta versión" con al menos un renglón', /<h2>Novedades de esta versión<\/h2>/.test(cajaNovedades) && /<li>/.test(cajaNovedades));
    chequear('el <title> dice que es el instructivo', /<title>Instructivo de [^<]+<\/title>/.test(pagina));

    // ---- 3. Enlaces internos ----
    console.log('\n[3] enlaces internos');
    const ids = [...pagina.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const repetidos = ids.filter((x, i) => ids.indexOf(x) !== i);
    chequear('no hay ids repetidos', repetidos.length === 0, repetidos.join(', '));
    const enlaces = [...pagina.matchAll(/\bhref="#([^"]*)"/g)].map(m => m[1]);
    chequear('hay enlaces internos (índice)', enlaces.length > 20, 'encontrados: ' + enlaces.length);
    const rotos = [...new Set(enlaces.filter(h => !ids.includes(h)))];
    chequear('todo href="#x" tiene su id="x"', rotos.length === 0, 'sin destino: ' + rotos.join(', '));

    // ---- 5. Página liviana, sin red, legible ----
    console.log('\n[6] la página es liviana y no usa red');
    chequear('tiene <meta name="viewport">', /<meta name="viewport"[^>]*width=device-width/.test(pagina));
    chequear('letra base de 17 px', /body\{[^}]*font:\s*17px/.test(pagina));
    chequear('tiene modo oscuro (prefers-color-scheme: dark)', /prefers-color-scheme:\s*dark/.test(pagina));
    chequear('ancho de lectura acotado (max-width en .pagina)', /\.pagina\{[^}]*max-width:\s*\d+(\.\d+)?rem/.test(pagina));
    chequear('sin <script>', !/<script\b/i.test(pagina));
    chequear('sin <link> ni librerías externas', !/<link\b/i.test(pagina));
    chequear('sin direcciones http(s):// (nada de red)', !/https?:\/\//i.test(pagina), (pagina.match(/https?:\/\/\S+/) || [''])[0]);
    chequear('sin imágenes ni @import (nada que bajar)', !/<img\b|@import|url\(/i.test(pagina));
    chequear('pesa menos de 120 KB', Buffer.byteLength(pagina) < 120 * 1024, Buffer.byteLength(pagina) + ' bytes');
  }

  // ---- 4. El botón y el service worker, en las 9 variantes ----
  console.log('\n================ [4] botón 📖 Instructivo, precarga y apertura ================');
  const todas = [];
  for (const P of PAGINAS) for (const c of CAMPOS) todas.push({ P, c, dir: P.variante(c) });
  for (const { P, c, dir } of todas) {
    const html = leer(dir + '/index.html');
    const sw = leer(dir + '/sw.js');
    const cuantos = (html.match(/id="btn-instructivo"/g) || []).length;
    chequear(`${dir}: tiene UN botón btn-instructivo con su texto`, cuantos === 1 && /<button[^>]*id="btn-instructivo"[^>]*>📖 Instructivo<\/button>/.test(html), 'botones: ' + cuantos);
    chequear(`${dir}: el botón abre ../${P.dir}/`, html.includes(`abrirInstructivo('../${P.dir}/')`));
    for (const Q of PAGINAS.filter(q => q !== P)) {
      chequear(`${dir}: no apunta a ../${Q.dir}/ (es de la app ${Q.nombre})`, !html.includes(`../${Q.dir}/`) && !sw.includes(Q.dir));
    }
    const lista = (sw.match(/const PRECACHE_URLS = (\[.*?\]);/) || [])[1];
    let urls = [];
    try { urls = JSON.parse(lista); } catch (e) { /* queda vacío y falla abajo */ }
    chequear(`${dir}/sw.js: PRECACHE_URLS incluye '../${P.dir}/'`, urls.includes(`../${P.dir}/`), 'lista: ' + lista);
    chequear(`${dir}/sw.js: la instalación precarga de a una (un recurso que falla no la rompe)`, /PRECACHE_URLS\.map\(u => cache\.add\(u\)\.catch\(/.test(sw));
  }
  for (const c of CAMPOS) {
    const pc = leer(PAGINAS[2].variante(c) + '/index.html');
    const grupo = (pc.match(/<div class="hg-titulo">Este dispositivo<\/div>[\s\S]*?(?=<div class="hg">|<div class="hsub")/) || [''])[0];
    chequear(`${PAGINAS[2].variante(c)}: el botón está en Herramientas › Este dispositivo`, grupo.includes('id="btn-instructivo"'));
  }
  chequear('la-vuelta-test: la copia de prueba no tiene instructivo', !/btn-instructivo|instructivo-/.test(leer('la-vuelta-test/index.html') + leer('la-vuelta-test/sw.js')));

  console.log('\n[4b] apretar el botón en las 9 apps (con señal y sin señal)');
  for (const { P, dir } of todas) {
    const archivo = dir + '/index.html';
    const esperado = `../${P.dir}/`;
    // con señal: abre la carpeta en otra pestaña
    let r = await levantar(archivo, true);
    chequear(`${dir}: carga sin errores`, r.errores.length === 0, r.errores.join(' | '));
    if (r.errores.length) continue;
    r.win.document.getElementById('btn-instructivo').dispatchEvent(new r.win.Event('click', { bubbles: true }));
    await dormir(30);
    chequear(`${dir}: con señal abre ${esperado} en otra pestaña`, r.abiertas.length === 1 && r.abiertas[0][0] === esperado && r.abiertas[0][1] === '_blank', JSON.stringify(r.abiertas));
    // sin señal y con la copia precargada: la lee de la caché y la abre como blob:
    const copia = { arrayBuffer: async () => new TextEncoder().encode('<!doctype html><title>copia</title>').buffer };
    r = await levantar(archivo, false, copia);
    r.win.document.getElementById('btn-instructivo').dispatchEvent(new r.win.Event('click', { bubbles: true }));
    await dormir(60);
    chequear(`${dir}: sin señal lee la copia de la caché (${esperado}) y la abre como blob:`,
      r.pedidas.length === 1 && r.pedidas[0] === new URL(esperado, 'https://local.test/' + dir + '/').href && r.abiertas.length === 1 && /^blob:/.test(String(r.abiertas[0][0])),
      JSON.stringify({ pedidas: r.pedidas, abiertas: r.abiertas }));
    // sin señal y sin copia: avisa y no abre nada
    r = await levantar(archivo, false, undefined);
    Object.defineProperty(r.win, 'caches', { configurable: true, value: { match: async () => undefined } });
    r.win.document.getElementById('btn-instructivo').dispatchEvent(new r.win.Event('click', { bubbles: true }));
    await dormir(60);
    chequear(`${dir}: sin señal y sin copia avisa y no abre nada`, r.abiertas.length === 0 && /todavía no se bajó a este (celular|equipo)/.test(r.win.document.getElementById('toast').textContent), r.win.document.getElementById('toast').textContent);
  }

  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
