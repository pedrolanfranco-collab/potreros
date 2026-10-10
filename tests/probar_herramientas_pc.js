/*
 * Prueba ad-hoc: la caja "🛠 Herramientas" de la PC está ordenada por funciones
 * (10/10/2026, a pedido de Pedro): 4 grupos en 2 columnas y 5 sub-menús
 * (Agregar potrero, Puntos, Reportes de campo, Exportar, Backup) que abren
 * dentro de la misma caja, con "← Volver". Los botones originales conservan su
 * id y su acción. "Exportar MD" se sacó. La móvil completa y Campo no cambian.
 *
 * Uso: node probar_herramientas_pc.js la-vuelta-pc/index.html maria-laura-pc/index.html [...]
 *      (por cada "<prefijo>-pc" mira también "<prefijo>-movil" y "<prefijo>-movil-campo")
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
const visible = (el) => { for(let e = el; e && e.nodeType === 1; e = e.parentElement){ if(e.style.display === 'none') return false; } return true; };

const SUBMENUS = {
  potrero:  ['btn-importar-kml', 'btn-dibujar-potrero'],
  puntos:   ['btn-puntos', 'btn-resync-puntos'],
  reportes: ['btn-infraestructura', 'btn-capin-annoni'],
  exportar: ['btn-exportar-kmz', 'btn-exportar-pdf', 'btn-exportar-pdf-animales', 'btn-exportar-pdf-historial', 'btn-exportar-excel'],
  backup:   ['btn-exportar-json', 'btn-importar-json']
};
const DIRECTOS = ['btn-stock', 'btn-sanidad', 'btn-lluvias', 'btn-desaparecidos', 'btn-alertas',
  'btn-coeficientes', 'btn-sincronizar', 'btn-usuario', 'btn-restablecer'];

async function probarPc(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  chequear('carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const doc = win.document;
  const modal = doc.getElementById('modal-herramientas');
  const menu = doc.getElementById('menu-herramientas');

  click(win, doc.getElementById('btn-herramientas'));
  chequear('la caja se abre', modal.style.display === 'flex');
  chequear('hay 4 grupos con título', menu.querySelectorAll('#hmenu-grupos .hg').length === 4 && menu.querySelectorAll('.hg-titulo').length >= 4);
  chequear('"Exportar MD" ya no existe', !doc.getElementById('btn-exportar-md'));

  // botones a la vista (los 17 menos los ocultos por configuración)
  const enVista = Array.from(menu.querySelectorAll('button')).filter(b => visible(b));
  const grupos = enVista.filter(b => b.hasAttribute('data-sub'));
  chequear('5 botones de grupo en la vista principal', grupos.length === 5, grupos.length);
  chequear('ningún botón de sub-menú está a la vista de entrada',
    Object.values(SUBMENUS).flat().every(id => !visible(doc.getElementById(id))));
  chequear('los botones directos siguen a la vista', DIRECTOS.every(id => doc.getElementById(id) && visible(doc.getElementById(id))),
    DIRECTOS.filter(id => !doc.getElementById(id) || !visible(doc.getElementById(id))).join(','));
  chequear('"Restablecer" va aparte, ocupando las dos columnas', doc.getElementById('btn-restablecer').classList.contains('hg-ancho'));

  // cada sub-menú: abre con sus botones originales y "Volver" regresa sin cerrar la caja
  for(const [sub, ids] of Object.entries(SUBMENUS)){
    const entrada = menu.querySelector(`[data-sub="${sub}"]`);
    chequear(`[${sub}] existe el botón del grupo`, !!entrada);
    if(!entrada) continue;
    click(win, entrada);
    chequear(`[${sub}] abre dentro de la misma caja`, modal.style.display === 'flex' && !visible(doc.getElementById('hmenu-grupos')));
    chequear(`[${sub}] muestra sus botones originales`, ids.every(id => doc.getElementById(id) && visible(doc.getElementById(id))),
      ids.filter(id => !doc.getElementById(id) || !visible(doc.getElementById(id))).join(','));
    chequear(`[${sub}] los otros sub-menús siguen ocultos`,
      Object.entries(SUBMENUS).filter(([k]) => k !== sub).every(([, otros]) => otros.every(id => !visible(doc.getElementById(id)))));
    click(win, menu.querySelector(`.hsub[data-sub-panel="${sub}"] [data-volver]`));
    chequear(`[${sub}] "Volver" regresa a los grupos sin cerrar la caja`, modal.style.display === 'flex' && visible(doc.getElementById('hmenu-grupos')));
  }

  // un botón de un sub-menú hace lo suyo y cierra la caja
  click(win, menu.querySelector('[data-sub="puntos"]'));
  click(win, doc.getElementById('btn-puntos'));
  chequear('un botón dentro de un sub-menú cierra la caja', modal.style.display === 'none');
  // y al reabrir vuelve a la vista de grupos
  click(win, doc.getElementById('btn-herramientas'));
  chequear('al reabrir se ve la vista de grupos', modal.style.display === 'flex' && visible(doc.getElementById('hmenu-grupos')));
  // un botón directo cierra la caja, como antes
  click(win, doc.getElementById('btn-stock'));
  chequear('un botón directo cierra la caja', modal.style.display === 'none');
}

async function probarMovil(archivo, etiqueta){
  if(!fs.existsSync(archivo)){ chequear('existe ' + archivo, false, 'no se encontró'); return; }
  const { win, errores } = await levantar(archivo);
  chequear(etiqueta + ' carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const doc = win.document;
  chequear(etiqueta + ' conserva su lista de siempre (sin grupos ni sub-menús)',
    !doc.getElementById('hmenu-grupos') && !doc.querySelector('#menu-herramientas [data-sub]') && !!doc.getElementById('btn-sanidad'));
  click(win, doc.getElementById('btn-herramientas'));
  click(win, doc.getElementById('btn-sanidad'));
  chequear(etiqueta + ': un botón cierra la caja como antes', doc.getElementById('modal-herramientas').style.display === 'none');
}

(async () => {
  for(const pc of process.argv.slice(2)){
    await probarPc(pc);
    const base = pc.replace(/-pc[\\/]index\.html$/, '');
    console.log('  -- móvil y Campo (sin cambios)');
    await probarMovil(base + '-movil/index.html', 'móvil completa');
    await probarMovil(base + '-movil-campo/index.html', 'Campo');
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
