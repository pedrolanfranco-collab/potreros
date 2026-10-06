/*
 * Prueba ad-hoc: la móvil completa y Campo comparten localStorage (misma
 * dirección, misma clave de guardado y mismo ID de dispositivo) y por eso NO se
 * sincronizan entre sí por Supabase. Desde el 6/10/2026 una página abierta
 * vuelve a leer lo guardado cuando otra guarda (evento `storage`) o cuando
 * vuelve a estar visible, y se redibuja -- y no pisa lo de la otra al guardar.
 *
 * Se simula "la otra página" escribiendo directo en el localStorage de la
 * ventana (jsdom no comparte almacenamiento entre ventanas) y disparando el
 * evento `storage` que dispararía el navegador.
 *
 * Uso: node probar_actualizar_solo.js <index.html> [...]
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
  // sin Supabase: la prueba es solo del almacenamiento local compartido
  win.supabase = { createClient(){ return null; } };
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__storageKey = function(){ return STORAGE_KEY; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  chequear('carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const geo = win.__potrerosGeo();
  if(!geo.length){ console.log('  (sin potreros -- se saltea)'); return; }
  const p = geo[0].nombre;
  const clave = win.__storageKey();

  // la "otra página" guarda un cambio en el almacenamiento compartido
  const guardado = JSON.parse(win.localStorage.getItem(clave) || JSON.stringify(win.__est()));
  guardado.potreros[p].animales['Categoria de prueba||'] = 7;
  guardado.lluvias = [{ id: 'otra-pagina', fecha: '01/01/2026', mm: 12.5, dispositivo: 'x', usuario: null }];
  win.localStorage.setItem(clave, JSON.stringify(guardado));
  chequear('antes del aviso, esta página todavía no lo ve', !win.__est().potreros[p].animales['Categoria de prueba||']);

  win.dispatchEvent(new win.StorageEvent('storage', { key: clave, newValue: win.localStorage.getItem(clave) }));
  chequear('con el evento storage, esta página incorpora el cambio de la otra',
    win.__est().potreros[p].animales['Categoria de prueba||'] === 7 && win.__est().lluvias.some(l => l.id === 'otra-pagina'));

  // el evento de otra clave se ignora
  const antes = JSON.stringify(win.__est());
  win.dispatchEvent(new win.StorageEvent('storage', { key: 'otra_cosa', newValue: 'x' }));
  chequear('un evento storage de otra clave no cambia nada', JSON.stringify(win.__est()) === antes);

  // guardar después NO pisa lo de la otra página
  win.guardarEstado();
  const releido = JSON.parse(win.localStorage.getItem(clave));
  chequear('guardar desde esta página conserva lo que había cargado la otra', releido.potreros[p].animales['Categoria de prueba||'] === 7 && releido.lluvias.length === 1);

  // sin evento storage (la app estaba en segundo plano): al volver a estar visible también se actualiza
  const g2 = JSON.parse(win.localStorage.getItem(clave));
  g2.potreros[p].animales['Otra categoria||'] = 3;
  win.localStorage.setItem(clave, JSON.stringify(g2));
  win.document.dispatchEvent(new win.Event('visibilitychange'));
  chequear('al volver a estar visible, si otra página guardó, se actualiza (el navegador no siempre avisa en segundo plano)',
    win.__est().potreros[p].animales['Otra categoria||'] === 3);

  // un formulario abierto no se pierde
  win.seleccionarPotrero(p);
  win.mostrarFormulario(p, 'mover');
  const g3 = JSON.parse(win.localStorage.getItem(clave));
  g3.potreros[p].animales['Tercera||'] = 1;
  win.localStorage.setItem(clave, JSON.stringify(g3));
  win.dispatchEvent(new win.StorageEvent('storage', { key: clave, newValue: win.localStorage.getItem(clave) }));
  chequear('se actualiza el estado pero no se borra un formulario que se está llenando',
    win.__est().potreros[p].animales['Tercera||'] === 1 && !!win.document.querySelector('#form-zona .form-accion'));
}

(async () => {
  for(const a of process.argv.slice(2)) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
