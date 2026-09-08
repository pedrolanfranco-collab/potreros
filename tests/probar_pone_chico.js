/*
 * probar_pone_chico.js — prueba ad hoc para el establecimiento nuevo
 * "Pone Chico" (clonado de María Laura, sin potreros ni carga inicial
 * todavía). Cubre lo que probar_app.js no puede probar porque asume que ya
 * hay potreros cargados: arranque en vacío, crear el primer potrero por
 * "Importar KML/KMZ", movimiento con dueño, y que los eventos salen
 * etiquetados con el establecimiento correcto (no se mezclan con otros).
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

function crearServidor(){
  const filas = [];
  let n = 0;
  return { filas, createClient(){ return { from(){
    const q = { _filtros: [],
      insert(obj){ n++; filas.push(Object.assign({}, obj, { id: 'row' + n })); return Promise.resolve({ error: null }); },
      select(){ return q; }, eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
      gt(col, val){ q._filtros.push(r => r[col] > val); return q; }, order(){ return q; },
      then(res){ const data = filas.filter(r => q._filtros.every(f => f(r))); return Promise.resolve(res({ data, error: null })); }
    };
    return q;
  } }; } };
}

function limites(){
  const b = { getCenter(){ return { lat: -31.385, lng: -55.426 }; }, extend(){ return b; }, isValid(){ return true; }, pad(){ return b; },
    getNorth(){ return -31.3; }, getSouth(){ return -31.4; }, getEast(){ return -55.4; }, getWest(){ return -55.5; }, contains(){ return true; } };
  return b;
}
function stubLeaflet(win){
  const conocidos = {
    getBounds: () => limites(), getLatLng: () => ({ lat: -31.385, lng: -55.426 }),
    getElement: () => win.document.createElement('div'),
    getTooltip: () => ({ setContent(){}, getElement(){ return win.document.createElement('div'); } }),
    getPopup: () => ({ setContent(){}, isOpen(){ return false; } }), isPopupOpen: () => false
  };
  const capa = () => {
    const o = new Proxy({ __capa: true, _latlngs: null }, {
      get(t, prop){
        if(prop === 'setLatLngs') return (ll)=>{ t._latlngs = ll; return o; };
        if(prop === '_getLatLngs') return () => t._latlngs;
        if(prop in t) return t[prop];
        if(typeof prop !== 'string') return undefined;
        if(conocidos[prop]) return conocidos[prop];
        return () => o;
      },
      has(){ return true; }
    });
    return o;
  };
  const mapa = {
    _capas: new Set(), _view: null,
    setView(c,z){ mapa._view = [c,z]; return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); return mapa; }, removeLayer(l){ mapa._capas.delete(l); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); }, getZoom(){ return 14; }, invalidateSize(){ return mapa; }
  };
  win.__mapa = mapa;
  win.L = {
    map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); }, circle(){ return capa(); },
    divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; }
  };
}

async function levantar(archivo, seedLocalStorage){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const servidor = crearServidor();
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.JSZip = require('jszip');
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = (msg)=>{ win.__ultimoAlert = msg; };
  win.confirm = () => win.__confirmRespuesta !== undefined ? win.__confirmRespuesta : true;
  win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  if(seedLocalStorage){
    Object.entries(seedLocalStorage).forEach(([k,v]) => win.localStorage.setItem(k, v));
  }

  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; };' +
    '\nwindow.__potreros = function(){ return POTREROS_GEO; };' +
    '\nwindow.__potrerosNuevosKey = function(){ return POTREROS_NUEVOS_KEY; };' +
    '\nwindow.__establecimiento = function(){ return ESTABLECIMIENTO; };' +
    '\nwindow.__duenos = function(){ return DUENOS; };'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 80));
  return { win, errores, servidor };
}

function archivoFalso(nombre, contenidoBuffer){
  return Object.assign(contenidoBuffer, {
    name: nombre,
    text: async () => contenidoBuffer.toString('utf-8')
  });
}

function kmlConPlacemarks(placemarks){
  const cuerpo = placemarks.map(p => `<Placemark><name>${p.nombre}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${p.coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${cuerpo}</Document></kml>`;
}

async function probarArchivo(archivo){
  const { win, errores, servidor } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores de JS', false, errores[0]); return; }
  chequear('carga sin errores de JS', true);

  chequear('arranca con establecimiento = pone_chico', win.__establecimiento() === 'pone_chico');
  chequear('arranca sin potreros', win.__potreros().length === 0);
  chequear('estado.potreros arranca vacío', Object.keys(win.__est().potreros).length === 0);
  chequear('el mapa se centró con el fallback (sin bounds)',
    JSON.stringify(win.__mapa._view && win.__mapa._view[0]) === JSON.stringify([-31.385, -55.426]));
  chequear('lista de dueños trae al menos "Pedro"', win.__duenos().includes('Pedro'));

  // --- crear el primer potrero desde cero, vía "Importar KML/KMZ" ---
  const coordsNuevas = '-55.400,-31.390,0 -55.401,-31.391,0 -55.402,-31.389,0 -55.400,-31.390,0';
  const kmlTxt = kmlConPlacemarks([{ nombre: 'Potrero 1', coords: coordsNuevas }]);
  win.__confirmRespuesta = true;
  await win.importarLimitesKML(archivoFalso('limites.kml', Buffer.from(kmlTxt, 'utf-8')));

  chequear('el potrero nuevo quedó en POTREROS_GEO', win.__potreros().some(p=>p.nombre==='Potrero 1'));
  chequear('el potrero nuevo tiene entrada en estado.potreros', !!win.__est().potreros['Potrero 1']);
  const guardadosNuevos = JSON.parse(win.localStorage.getItem(win.__potrerosNuevosKey()) || '[]');
  chequear('quedó persistido en localStorage (POTREROS_NUEVOS_KEY)', guardadosNuevos.some(p=>p.nombre==='Potrero 1'));

  // --- "recargar la app" ya con ese potrero guardado ---
  const { win: win2 } = await levantar(archivo, { [win.__potrerosNuevosKey()]: JSON.stringify(guardadosNuevos) });
  chequear('tras recargar, el potrero sigue en POTREROS_GEO', win2.__potreros().some(p=>p.nombre==='Potrero 1'));
  chequear('tras recargar, estado.potreros ya lo trae solo (cargarEstado recorre POTREROS_GEO)',
    !!win2.__est().potreros['Potrero 1']);

  // --- movimiento con dueño sobre el potrero recién creado ---
  const clave = win.claveAnimal('Vacas', 'Pedro');
  win.__est().potreros['Potrero 1'].animales[clave] = 5;
  const detalle = win.detalleAnimales(win.__est().potreros['Potrero 1'].animales);
  chequear('detalleAnimales separa categoría y dueño correctamente',
    detalle.length === 1 && detalle[0].cat === 'Vacas' && detalle[0].dueno === 'Pedro' && detalle[0].cant === 5);
  const resumen = win.resumenPorCategoria(win.__est().potreros['Potrero 1'].animales);
  chequear('resumenPorCategoria suma por categoría sin importar el dueño', resumen['Vacas'] === 5);

  // --- el evento enviado a Supabase lleva el establecimiento correcto ---
  await win.enviarEvento('ingreso', 'Potrero 1', {animales:{[clave]:5}}, '05/09/2026');
  const ultimaFila = servidor.filas[servidor.filas.length - 1];
  chequear('el evento enviado a Supabase queda con establecimiento = pone_chico',
    !!ultimaFila && ultimaFila.establecimiento === 'pone_chico');
}

(async () => {
  const archivos = process.argv.slice(2).length ? process.argv.slice(2) : [
    'C:/Users/Pedro/OneDrive/Proyecto Gestion ganadera/pone_chico_pc.html',
    'C:/Users/Pedro/OneDrive/Proyecto Gestion ganadera/pone_chico_movil.html'
  ];
  for (const ruta of archivos) {
    console.log('\n=== ' + ruta + ' ===');
    await probarArchivo(ruta);
  }
  console.log('\n' + (fallas === 0 ? 'TODO OK' : fallas + ' verificacion(es) fallaron'));
  process.exit(fallas === 0 ? 0 : 1);
})();
