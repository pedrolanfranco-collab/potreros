/*
 * Prueba ad-hoc: todos los historiales / listas de registros quedan OCULTOS detrás de un botón
 * (11/10/2026, a pedido de Pedro), en todas las ventanas y todas las apps: lluvias, eventos, abortos,
 * señaladas, campo ajeno, traslados, movimientos con guía, mis cargas de Sanidad y pesadas de la ficha
 * de caravana (el historial de cada potrero lo cubre probar_campo_visualizacion.js).
 *
 * Uso: node probar_historiales_ocultos.js la-vuelta-pc/index.html la-vuelta-movil/index.html ...
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

function limites(){
  const b = { getCenter(){ return { lat: -31.98, lng: -56.34 }; }, extend(){ return b; },
    isValid(){ return true; }, pad(){ return b; }, getNorth(){ return -31.9; },
    getSouth(){ return -32.0; }, getEast(){ return -56.3; }, getWest(){ return -56.4; },
    contains(){ return true; } };
  return b;
}
function stubLeaflet(win){
  const conocidos = {
    getBounds: () => limites(), getLatLng: () => ({ lat: -31.98, lng: -56.34 }),
    getElement: () => win.document.createElement('div'),
    getTooltip: () => ({ setContent(){}, getElement(){ return win.document.createElement('div'); } }),
    getPopup: () => ({ setContent(){}, isOpen(){ return false; } }), isPopupOpen: () => false
  };
  const capa = () => {
    const o = new Proxy({ __capa: true }, {
      get(t, prop){
        if(prop in t) return t[prop];
        if(typeof prop !== 'string') return undefined;
        if(conocidos[prop]) return conocidos[prop];
        return () => o;
      }, has(){ return true; } });
    return o;
  };
  const mapa = { _capas: new Set(), setView(){ return mapa; }, fitBounds(){ return mapa; },
    on(){ return mapa; }, addLayer(l){ mapa._capas.add(l); return mapa; },
    removeLayer(l){ mapa._capas.delete(l); return mapa; }, hasLayer(l){ return mapa._capas.has(l); },
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; },
    doubleClickZoom: { disable(){}, enable(){} } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); }, DomEvent: { stopPropagation(){} } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient(){ return null; } };
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo); } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}


const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
// id del contenedor de cada historial: tiene que estar dentro de un <details> cerrado
const LISTAS = ['eventos-clima-lista', 'abortos-lista', 'senaladas-lista', 'sanidad-mis-cargas',
  'campo-ajeno-lista', 'traslado-lista', 'mg-lista'];

async function probar(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  chequear('carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const doc = win.document;
  let vistas = 0;
  LISTAS.forEach(id => {
    const el = doc.getElementById(id);
    if(!el) return;   // esa lista no existe en esta variante
    vistas++;
    const d = el.closest('details.historial-det');
    chequear(id + ' está detrás de un botón y cerrado', !!d && !d.open && !!d.querySelector('summary'));
  });
  // lluvias: en las completas ya tenía el botón "Ver historial" (lista oculta); en Campo ahora es un desplegable
  const ll = doc.getElementById('lluvias-lista');
  const btn = doc.getElementById('btn-lluvias-historial');
  if(ll){
    vistas++;
    const d = ll.closest('details.historial-det');
    chequear('lluvias-lista está oculta y se llama con un botón',
      (!!btn && ll.style.display === 'none') || (!!d && !d.open));
  }
  // pesadas de la ficha: el resumen a la vista y la tabla plegada
  if(typeof win.pesadasFichaHTML === 'function'){
    const h = win.pesadasFichaHTML({ pesadas: [{ f: '2026-09-01', p: 320, g: 0.8, s: false, a: 'x' }, { f: '2026-10-01', p: 345, g: 0.8, s: false, a: 'y' }], ganancia_diaria: 0.8 });
    chequear('las pesadas de la ficha van en un desplegable cerrado',
      /<details class="historial-det[^"]*"><summary>Historial de pesadas \(2\)<\/summary>/.test(h) && !/<details[^>]* open/.test(h), h.slice(0, 160));
  }
  chequear('hay al menos un historial en esta variante', vistas >= 1, vistas);
}

(async () => {
  for(const a of process.argv.slice(2)) await probar(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
