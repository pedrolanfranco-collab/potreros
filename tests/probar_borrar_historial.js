/*
 * Prueba ad-hoc: borrar una entrada del historial revierte bien el stock,
 * para los 3 tipos de movimiento entre potreros (uno solo, TODO el
 * potrero, y varias categorías/recategorización). Nace de un bug real:
 * "Mover TODO el potrero" guardaba su historial local con tipo:'movimiento'
 * en vez de 'movimiento_todo', así que construirAjusteInverso tomaba la
 * rama equivocada al borrar esa entrada y dejaba una clave "undefined"
 * (NaN, persistido como null) en los dos potreros — sin afectar el total,
 * pero ensuciando la lista de categorías para siempre (se reconstruye en
 * cada dispositivo nuevo porque sale de eventos_sync).
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); } };
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
  win.supabase = { createClient(){ return { from(){ const q = { insert(){ return Promise.resolve({error:null}); },
    select(){ return q; }, eq(){ return q; }, order(){ return q; }, then(res){ return Promise.resolve(res({data:[],error:null})); } };
    return q; } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  win.eval(codigo + `
    ;window.__est = function(){ return estado; };
    window.__borrarHistorial = function(id){ return borrarHistorial(id); };
    window.__mostrarFormulario = function(n,a){ seleccionarPotrero(n); return mostrarFormulario(n,a); };
  `);
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo, tieneDueno){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const claveVacas = tieneDueno ? 'Vacas||Pedro' : 'Vacas';
  const claveTerneros = tieneDueno ? 'Terneros||Pedro' : 'Terneros';
  const est = win.__est();
  const potreros = Object.keys(est.potreros);
  const origen = potreros[0], destino = potreros[1];
  // limpiar y sembrar un estado conocido en los dos potreros
  [origen, destino].forEach(n => Object.keys(est.potreros[n].animales).forEach(k => est.potreros[n].animales[k]=0));
  est.potreros[origen].animales[claveVacas] = 20;
  est.potreros[origen].animales[claveTerneros] = 5;

  win.__mostrarFormulario(origen, 'mover-todo');
  doc.getElementById('f-destino').value = destino;
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));

  chequear('mover todo: el origen queda en 0', est.potreros[origen].animales[claveVacas]===0 && est.potreros[origen].animales[claveTerneros]===0);
  chequear('mover todo: el destino recibe las dos categorías', est.potreros[destino].animales[claveVacas]===20 && est.potreros[destino].animales[claveTerneros]===5);

  const entradaVaciado = est.potreros[origen].historial.find(h=>/Potrero vaciado/.test(h.detalle) && !h.eliminado);
  chequear('la entrada de historial quedó etiquetada movimiento_todo (no "movimiento")',
    !!entradaVaciado && entradaVaciado.tipo === 'movimiento_todo',
    JSON.stringify(est.potreros[origen].historial.map(h=>h.tipo)));

  win.__borrarHistorial(entradaVaciado.id);

  chequear('al borrar, el origen recupera sus animales', est.potreros[origen].animales[claveVacas]===20 && est.potreros[origen].animales[claveTerneros]===5,
    JSON.stringify(est.potreros[origen].animales));
  chequear('al borrar, el destino vuelve a 0 (sin quedar clave "undefined")',
    !('undefined' in est.potreros[destino].animales) && (est.potreros[destino].animales[claveVacas]||0)===0 && (est.potreros[destino].animales[claveTerneros]||0)===0,
    JSON.stringify(est.potreros[destino].animales));
  chequear('ningún potrero quedó con la clave "undefined"',
    !Object.values(est.potreros).some(p => Object.prototype.hasOwnProperty.call(p.animales, 'undefined')),
    JSON.stringify(Object.entries(est.potreros).filter(([n,p])=>('undefined' in p.animales))));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a, /maria[_-]laura|pone[_-]chico/.test(a));
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
