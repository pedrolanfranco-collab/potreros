/*
 * probar_importar_puntos.js — Fase 7 (16/9/2026): importador de archivo
 * (KML/KMZ/GPX) para "🛠 Herramientas › Aguadas, instalaciones y caminos",
 * y sincronización de estado.puntos entre dispositivos (antes 100% local:
 * un punto colocado a mano, cargado desde la semilla, o importado por
 * archivo nunca llegaba a los demás dispositivos).
 *
 * Reusa el patrón de harness de probar_eliminar_potrero.js (JSZip real
 * vía require('jszip'), no un stub) para poder construir un .kmz de
 * verdad y probar la descompresión real, no solo el .kml plano.
 */
const fs = require('fs');
const JSZip = require('jszip');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

function crearServidor(){
  const filas = [];
  return { filas, createClient(){ return { from(){
    const q = { _filtros: [],
      insert(obj){ filas.push(obj); return Promise.resolve({ error: null }); },
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
    const o = new Proxy({ __capa: true }, {
      get(t, prop){
        if(prop in t) return t[prop];
        if(typeof prop !== 'string') return undefined;
        if(conocidos[prop]) return conocidos[prop];
        return () => o;
      }, has(){ return true; }
    });
    return o;
  };
  const mapa = {
    _capas: new Set(), setView(){ return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); return mapa; }, removeLayer(l){ mapa._capas.delete(l); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); }, getZoom(){ return 14; }, invalidateSize(){ return mapa; },
    setMaxBounds(){ return mapa; }
  };
  win.L = {
    map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); }, circle(){ return capa(); },
    divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; }, latLngBounds(){ return limites(); }
  };
}

function archivoFalso(nombre, contenidoBuffer){
  return Object.assign(contenidoBuffer, { name: nombre, text: async () => contenidoBuffer.toString('utf-8') });
}
function kmlConPuntos(puntos){
  const cuerpo = puntos.map(p => `<Placemark><name>${p.nombre||''}</name><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${cuerpo}</Document></kml>`;
}
function gpxConWaypoints(puntos){
  const cuerpo = puntos.map(p => `<wpt lat="${p.lat}" lon="${p.lon}"><name>${p.nombre||''}</name></wpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test">${cuerpo}</gpx>`;
}
async function archivoKmzFalso(nombre, kmlTexto){
  const zip = new JSZip();
  zip.file('doc.kml', kmlTexto);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return archivoFalso(nombre, buffer);
}

async function levantar(archivo, servidorCompartido){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const servidor = servidorCompartido || crearServidor();
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.JSZip = require('jszip');
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};

  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try{
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__puntos = function(){ return estado.puntos; };' +
      '\n;window.__sync = sincronizar;');
  }catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 80));
  return { win, errores, servidor };
}

// Abre el modal (puebla np-tipo) y elige un tipo/subtipo concreto, igual
// que haría Pedro antes de tocar "Importar de archivo" o "Elegir ubicación".
function elegirTipoSubtipo(win, tipo, subtipo){
  const doc = win.document;
  doc.getElementById('btn-puntos').dispatchEvent(new win.Event('click', { bubbles: true }));
  doc.getElementById('np-tipo').value = tipo;
  doc.getElementById('np-tipo').dispatchEvent(new win.Event('change', { bubbles: true }));
  doc.getElementById('np-subtipo').value = subtipo;
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores, servidor } = await levantar(archivo);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  // --- A: importar KML plano con 2 puntos ---
  elegirTipoSubtipo(win, 'agua', 'Bebedero');
  const kml1 = kmlConPuntos([{nombre:'Bebedero Norte', lat:-31.390, lon:-55.420}, {nombre:'Bebedero Sur', lat:-31.395, lon:-55.425}]);
  await win.importarPuntosArchivo(archivoFalso('bebederos.kml', Buffer.from(kml1, 'utf-8')));
  let puntos = win.__puntos();
  chequear('KML: se importaron los 2 puntos', puntos.length === 2, JSON.stringify(puntos));
  chequear('KML: quedaron con el tipo/subtipo elegido en los selectores', puntos.every(p=>p.tipo==='agua' && p.subtipo==='Bebedero'));
  chequear('KML: el nombre del placemark se preservó', puntos.some(p=>p.nombre==='Bebedero Norte') && puntos.some(p=>p.nombre==='Bebedero Sur'));
  chequear('KML: se mandaron 2 eventos punto_creado', servidor.filas.filter(e=>e.tipo==='punto_creado').length === 2, JSON.stringify(servidor.filas));

  // --- B: reimportar el mismo archivo no duplica (dedupe por proximidad) ---
  await win.importarPuntosArchivo(archivoFalso('bebederos.kml', Buffer.from(kml1, 'utf-8')));
  chequear('reimportar el mismo archivo no agrega duplicados', win.__puntos().length === 2, JSON.stringify(win.__puntos()));
  chequear('reimportar no manda eventos nuevos', servidor.filas.filter(e=>e.tipo==='punto_creado').length === 2);

  // --- C: KMZ (descompresión real con jszip) ---
  elegirTipoSubtipo(win, 'instalacion', 'Tranquera');
  const kml2 = kmlConPuntos([{nombre:'Tranquera Este', lat:-31.40, lon:-55.43}]);
  await win.importarPuntosArchivo(await archivoKmzFalso('instalaciones.kmz', kml2));
  puntos = win.__puntos();
  chequear('KMZ: se importó el punto (descompresión real)', puntos.some(p=>p.nombre==='Tranquera Este' && p.tipo==='instalacion' && p.subtipo==='Tranquera'), JSON.stringify(puntos));

  // --- D: GPX (waypoints) ---
  elegirTipoSubtipo(win, 'agua', 'Tanque');
  const gpx1 = gpxConWaypoints([{nombre:'Tanque GPS', lat:-31.41, lon:-55.44}]);
  await win.importarPuntosArchivo(archivoFalso('waypoints.gpx', Buffer.from(gpx1, 'utf-8')));
  puntos = win.__puntos();
  chequear('GPX: se importó el waypoint', puntos.some(p=>p.nombre==='Tanque GPS' && p.tipo==='agua' && p.subtipo==='Tanque'), JSON.stringify(puntos));

  const totalTrasImportar = puntos.length;
  chequear('total de puntos tras las 3 importaciones (KML+KMZ+GPX)', totalTrasImportar === 4, JSON.stringify(puntos));

  // --- E: otro dispositivo sincroniza y recibe TODOS los puntos importados ---
  const remoto = await levantar(archivo, servidor);
  await remoto.win.__sync(false);
  chequear('otro dispositivo recibe los puntos importados por sync',
    remoto.win.__puntos().length === totalTrasImportar &&
    remoto.win.__puntos().some(p=>p.nombre==='Bebedero Norte') &&
    remoto.win.__puntos().some(p=>p.nombre==='Tanque GPS'),
    JSON.stringify(remoto.win.__puntos()));

  // --- F: colocar un punto a mano también sincroniza ---
  elegirTipoSubtipo(win, 'agua', 'Represa');
  doc.getElementById('np-nombre').value = 'Represa a mano';
  doc.getElementById('np-colocar').dispatchEvent(new win.Event('click', { bubbles: true }));
  win.colocarPuntoEn({lat:-31.42, lng:-55.45});
  chequear('colocar a mano manda punto_creado', servidor.filas.some(e=>e.tipo==='punto_creado' && e.detalle.nombre==='Represa a mano'));
  await remoto.win.__sync(false);
  chequear('el punto colocado a mano llega al otro dispositivo', remoto.win.__puntos().some(p=>p.nombre==='Represa a mano'));

  // --- G: eliminar un punto localmente lo borra también en el otro dispositivo ---
  const idABorrar = win.__puntos().find(p=>p.nombre==='Bebedero Norte').id;
  win.eliminarPunto(idABorrar);
  chequear('eliminarPunto lo saca de estado.puntos', !win.__puntos().some(p=>p.id===idABorrar));
  chequear('eliminarPunto manda punto_eliminado con el id correcto',
    servidor.filas.some(e=>e.tipo==='punto_eliminado' && e.detalle.id===idABorrar));
  await remoto.win.__sync(false);
  chequear('el otro dispositivo también lo pierde al sincronizar', !remoto.win.__puntos().some(p=>p.id===idABorrar));

  // --- H: un archivo sin ningún punto no rompe nada ---
  const kmlVacio = kmlConPuntos([]);
  const antesLen = win.__puntos().length;
  await win.importarPuntosArchivo(archivoFalso('vacio.kml', Buffer.from(kmlVacio, 'utf-8')));
  chequear('un archivo sin puntos no agrega nada ni rompe', win.__puntos().length === antesLen);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
