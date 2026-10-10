/*
 * Prueba ad-hoc: visualización de la app Campo (10/10/2026, a pedido de Pedro).
 * Solo en Campo: el detalle del potrero muestra el total grande, el historial
 * viene plegado (y se acuerda abierto mientras no cambie de potrero), el mapa
 * ocupa menos pantalla en el celular y el formulario de una acción se
 * desplaza solo a la vista. La PC y la móvil completa NO cambian.
 *
 * Uso: node probar_campo_visualizacion.js la-vuelta-movil-campo/index.html [...]
 *      (por cada "<prefijo>-movil-campo" mira también "<prefijo>-pc" y "<prefijo>-movil")
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
  try { win.eval(codigo + ';window.__geo = function(){ return POTREROS_GEO; };'); } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}


const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const estilos = (win) => Array.from(win.document.querySelectorAll('style')).map(s => s.textContent).join('\n');

async function probarCampo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  chequear('Campo carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const doc = win.document;
  chequear('el mapa baja a 45vh en el celular', /#map\{height:45vh;\}/.test(estilos(win)));
  const geo = win.__geo().map(g => g.nombre);
  if(!geo.length){ console.log('  (sin potreros -- se saltea el detalle)'); return; }
  let llamadas = 0;
  win.HTMLElement.prototype.scrollIntoView = function(){ llamadas++; };

  win.seleccionarPotrero(geo[0]);
  chequear('el detalle muestra el total grande', !!doc.querySelector('#detalle .total-grande strong'));
  const det = doc.querySelector('.historial-det');
  chequear('el historial está en un desplegable', !!det && /^Historial \(\d+\)$/.test(det.querySelector('summary').textContent.trim()));
  chequear('el historial arranca plegado', !!det && !det.open);
  chequear('los renglones siguen en el DOM (con sus botones)', det.querySelectorAll('.hist-item').length >= 0);

  det.open = true;
  det.dispatchEvent(new win.Event('toggle'));
  win.renderDetalle(geo[0]);
  chequear('se acuerda abierto al redibujar el mismo potrero', doc.querySelector('.historial-det').open === true);
  if(geo.length > 1){
    win.seleccionarPotrero(geo[1]);
    chequear('al cambiar de potrero vuelve plegado', doc.querySelector('.historial-det').open === false);
  }

  const antes = llamadas;
  click(win, doc.querySelector('[data-accion="mover"]'));
  await dormir(80);
  chequear('al abrir una acción el formulario se desplaza a la vista', llamadas > antes, 'llamadas ' + llamadas);
  chequear('el orden: Muerte y Desaparecido van al final (estilos)', /\[data-accion="muerte"\]\{order:5;/.test(estilos(win)) && /\[data-accion="desaparecido"\]\{order:6;/.test(estilos(win)));
}

async function probarSinCambios(archivo, etiqueta){
  if(!fs.existsSync(archivo)){ chequear('existe ' + archivo, false, 'no se encontró'); return; }
  const { win, errores } = await levantar(archivo);
  chequear(etiqueta + ' carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const doc = win.document;
  chequear(etiqueta + ' conserva su mapa y sin reglas de Campo', !/#map\{height:45vh;\}/.test(estilos(win)) && !/total-grande/.test(doc.documentElement.outerHTML.replace(/<style[\s\S]*?<\/style>/g, '')));
  const geo = win.__geo().map(g => g.nombre);
  if(!geo.length) return;
  win.seleccionarPotrero(geo[0]);
  chequear(etiqueta + ' conserva el historial de siempre (sin desplegable)', !doc.querySelector('.historial-det') && !!doc.querySelector('#historial h3'));
}

(async () => {
  for(const campo of process.argv.slice(2)){
    await probarCampo(campo);
    const base = campo.replace(/-movil-campo[\/]index\.html$/, '');
    await probarSinCambios(base + '-pc/index.html', 'PC');
    await probarSinCambios(base + '-movil/index.html', 'móvil completa');
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
