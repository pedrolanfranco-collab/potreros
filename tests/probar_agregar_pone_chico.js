/*
 * Pone Chico arranca sin potreros (POTREROS_GEO=[]). Prueba reducida del
 * mismo cambio: se sintetiza un potrero vacio (no hace falta simular todo
 * el flujo de importar KML), se confirma que "agregar" funciona como carga
 * inicial, y que una vez con stock se bloquea igual que en las demas apps.
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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8')
    .replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient(){ return { from(){ const q = { insert(){ return Promise.resolve({error:null}); },
    select(){ return q; }, eq(){ return q; }, gt(){ return q; }, order(){ return q; },
    then(res){ return Promise.resolve(res({data:[], error:null})); } }; return q; } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script'))
    .map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__crearPotrero = function(n){ estado.potreros[n] = {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null}; guardarEstado(); };');
    win.toast = () => {};
  }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  chequear('arranca sin potreros (todavia no se cargo ningun limite)', Object.keys(win.__est().potreros).length === 0);

  // 10/9/2026: el boton "+ Agregar animales" se saco de la version movil.
  // Pone Chico no pasa por renderDetalle en esta prueba (sin info geografica
  // todavia), asi que se chequea directo en el HTML fuente en vez de en el DOM.
  const variante = win.document.getElementById('btn-gps') ? 'movil' : 'PC';
  const tieneBotonAgregar = /data-accion="agregar"/.test(fs.readFileSync(archivo, 'utf-8'));
  chequear('boton "+ Agregar animales" ' + (variante==='PC' ? 'presente en PC' : 'ausente en movil'),
    tieneBotonAgregar === (variante === 'PC'));

  const nombre = 'PotreroPrueba';
  win.__crearPotrero(nombre);
  const doc = win.document;
  // No pasamos por seleccionarPotrero/renderDetalle: esas funciones esperan
  // que el potrero tenga info geografica (POTREROS_GEO/POTREROS_NUEVOS_KEY),
  // que "Importar KML/KMZ" completaria en el uso real. mostrarFormulario solo
  // necesita el contenedor #form-zona y la entrada en estado.potreros.
  const zonaDiv = doc.createElement('div');
  zonaDiv.id = 'form-zona';
  doc.body.appendChild(zonaDiv);
  win.mostrarFormulario(nombre, 'agregar');
  chequear('se puede usar "Agregar animales" como carga inicial en el potrero recien creado', !!doc.getElementById('f-confirmar'));

  const cat = doc.getElementById('f-cat').options[0].value;
  doc.getElementById('f-cat').value = cat;
  const due = doc.getElementById('f-dueno');
  if(due) due.value = due.options[0].value;
  doc.getElementById('f-cant').value = '30';
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('la carga inicial se aplico', win.totalPotrero(nombre) === 30, 'quedo ' + win.totalPotrero(nombre));

  win.mostrarFormulario(nombre, 'agregar');
  chequear('una vez con stock, "Agregar animales" ya no ofrece el formulario', !doc.getElementById('f-confirmar'));
  chequear('en cambio muestra el aviso de "solo carga inicial"', /stock inicial/.test(doc.getElementById('form-zona').innerHTML));
  chequear('el stock sigue en 30 (no se toco)', win.totalPotrero(nombre) === 30);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
