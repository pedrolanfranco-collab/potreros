/*
 * probar_asignar_dueno.js — "Dueño destino" en "⇄ Mover una categoría"
 * (16/9/2026): reasignar el dueño de animales ya cargados sin moverlos
 * de potrero ni de categoría, para el caso de Pedro identificando de a
 * poco a quién pertenece cada animal "sin asignar"/placeholder.
 *
 * Antes de este cambio el formulario dejaba cambiar la categoría destino
 * pero el dueño quedaba fijo a propósito ("el dueño no cambia", texto de
 * ayuda del propio formulario) -- no había ningún camino rápido para
 * reasignar dueño.
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
  return { filas, createClient(){ return { from(){
    const q = { _filtros: [],
      insert(obj){ filas.push(Object.assign({}, obj)); return Promise.resolve({ error: null }); },
      select(){ return q; }, eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
      gt(col, val){ q._filtros.push(r => r[col] > val); return q; }, order(){ return q; },
      then(res){ const data = filas.filter(r => q._filtros.every(f => f(r))); return Promise.resolve(res({ data, error: null })); }
    };
    return q;
  } }; } };
}

function limites(){
  const b = { getCenter(){ return { lat: -31.98, lng: -56.34 }; }, extend(){ return b; }, isValid(){ return true; }, pad(){ return b; },
    getNorth(){ return -31.9; }, getSouth(){ return -32.0; }, getEast(){ return -56.3; }, getWest(){ return -56.4; }, contains(){ return true; } };
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
      }, has(){ return true; }
    });
    return o;
  };
  const mapa = { _capas: new Set(), setView(){ return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); return mapa; }, removeLayer(l){ mapa._capas.delete(l); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); }, getZoom(){ return 14; }, invalidateSize(){ return mapa; },
    setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); }, circle(){ return capa(); },
    divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; }, latLngBounds(){ return limites(); } };
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
      '\n;window.__potrerosGeo = POTREROS_GEO;' +
      '\n;window.__duenos = DUENOS;' +
      '\n;window.__CONFIG = CONFIG;' +
      '\n;window.__sync = sincronizar;' +
      '\n;window.__borrarHistorial = function(id){ return borrarHistorial(id); };');
  }catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 80));
  return { win, errores, servidor };
}

function crearPotreroConStock(win, nombre, animales){
  const geo = {nombre, area:null, coords:[[-31.98,-56.34],[-31.981,-56.34],[-31.981,-56.341]]};
  win.__potrerosGeo.push(geo);
  win.__est().potreros[nombre] = {animales: Object.assign({}, animales), historial: [], fechaIngreso: null, fechaSalida: null};
  win.dibujarPotrero(geo);
  return nombre;
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores, servidor } = await levantar(archivo);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const duenos = win.__duenos;
  const duenoObligatorio = !!win.__CONFIG.duenoObligatorio;
  const duenoA = duenos[0];
  const est = () => win.__est();

  // --- A: reasignar dueño sin cambiar categoría ni potrero ---
  const pA = crearPotreroConStock(win, 'DUENO-TEST-A', {'Vacas||': 10});
  win.seleccionarPotrero(pA);
  win.mostrarFormulario(pA, 'mover');
  chequear('el formulario trae la categoría sembrada', !!doc.querySelector('.mov-check[data-key="Vacas||"]'));
  doc.getElementById('f-destino').value = pA;
  doc.getElementById('f-dueno-destino').value = duenoA;
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('el total del potrero no cambia', win.totalPotrero(pA) === 10);
  chequear('la cantidad quedó bajo la clave del dueño nuevo',
    (est().potreros[pA].animales[win.claveAnimal('Vacas', duenoA)]||0) === 10, JSON.stringify(est().potreros[pA].animales));
  chequear('la clave vieja (sin asignar) quedó en 0',
    (est().potreros[pA].animales['Vacas||']||0) === 0);
  chequear('se mandó el evento con duenoDestino',
    servidor.filas.some(e=>e.tipo==='movimiento_multi' && e.detalle.items.some(it=>it.duenoDestino===duenoA)));

  // --- B: elegir "— sin asignar —" A PROPÓSITO (solo tiene sentido si el dueño es opcional) ---
  if(!duenoObligatorio){
    win.mostrarFormulario(pA, 'mover');
    doc.getElementById('f-destino').value = pA;
    doc.getElementById('f-dueno-destino').value = '';
    doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('elegir "sin asignar" a propósito SÍ cambia el dueño (no se trata "" como "no elegido")',
      (est().potreros[pA].animales['Vacas||']||0) === 10 && (est().potreros[pA].animales[win.claveAnimal('Vacas', duenoA)]||0) === 0,
      JSON.stringify(est().potreros[pA].animales));
  } else {
    const opciones = Array.from(doc.getElementById('f-dueno-destino').options).map(o=>o.value);
    chequear('dueño obligatorio: el selector de destino no ofrece "— sin asignar —"', !opciones.includes(''), JSON.stringify(opciones));
  }

  // --- C: cambiar categoría Y dueño en la misma acción ---
  const pC = crearPotreroConStock(win, 'DUENO-TEST-C', {'Terneros||': 7});
  win.seleccionarPotrero(pC);
  win.mostrarFormulario(pC, 'mover');
  doc.getElementById('f-destino').value = pC;
  doc.getElementById('f-cat-destino').value = 'Novillitos 1-2 años';
  doc.getElementById('f-dueno-destino').value = duenoA;
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('cambiar categoría y dueño a la vez mueve a la clave combinada nueva',
    (est().potreros[pC].animales[win.claveAnimal('Novillitos 1-2 años', duenoA)]||0) === 7, JSON.stringify(est().potreros[pC].animales));
  chequear('el total del potrero sigue igual', win.totalPotrero(pC) === 7);

  // --- D: dejar "Dueño destino" en "mantener" no toca el dueño (regresión de recategorización pura) ---
  const pD = crearPotreroConStock(win, 'DUENO-TEST-D', {['Vacas||' + '']: 4}); // sin asignar, a proposito
  win.seleccionarPotrero(pD);
  win.mostrarFormulario(pD, 'mover');
  doc.getElementById('f-destino').value = pD;
  doc.getElementById('f-cat-destino').value = 'Vaquillonas 1-2 años'; // solo categoria; f-dueno-destino queda en "__mantener__"
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('recategorizar sin tocar "Dueño destino" mantiene el dueño de antes (sin asignar)',
    (est().potreros[pD].animales[win.claveAnimal('Vaquillonas 1-2 años', '')]||0) === 4, JSON.stringify(est().potreros[pD].animales));

  // --- E: la reasignación sincroniza a un segundo dispositivo ---
  const pE = crearPotreroConStock(win, 'DUENO-TEST-E', {'Vacas||': 6});
  win.seleccionarPotrero(pE);
  win.mostrarFormulario(pE, 'mover');
  doc.getElementById('f-destino').value = pE;
  doc.getElementById('f-dueno-destino').value = duenoA;
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));

  const remoto = await levantar(archivo, servidor);
  crearPotreroConStock(remoto.win, pE, {'Vacas||': 6}); // mismo estado inicial que tenía "win" antes de reasignar
  await remoto.win.__sync(false);
  chequear('el otro dispositivo recibe la reasignación de dueño por sync',
    (remoto.win.__est().potreros[pE].animales[remoto.win.claveAnimal('Vacas', duenoA)]||0) === 6 &&
    (remoto.win.__est().potreros[pE].animales['Vacas||']||0) === 0,
    JSON.stringify(remoto.win.__est().potreros[pE].animales));

  // --- F: borrar la corrección revierte al dueño ORIGINAL, no al nuevo ---
  const pF = crearPotreroConStock(win, 'DUENO-TEST-F', {'Vacas||': 5});
  win.seleccionarPotrero(pF);
  win.mostrarFormulario(pF, 'mover');
  doc.getElementById('f-destino').value = pF;
  doc.getElementById('f-dueno-destino').value = duenoA;
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('(previo) quedó bajo el dueño nuevo', (est().potreros[pF].animales[win.claveAnimal('Vacas', duenoA)]||0) === 5);
  const entry = est().potreros[pF].historial.find(h=>!h.eliminado && h.tipo==='movimiento_multi');
  chequear('hay una entrada de historial para borrar', !!entry);
  if(entry){
    win.__borrarHistorial(entry.id);
    chequear('borrar revierte al dueño ORIGINAL (sin asignar), no se queda en el nuevo',
      (est().potreros[pF].animales['Vacas||']||0) === 5 && (est().potreros[pF].animales[win.claveAnimal('Vacas', duenoA)]||0) === 0,
      JSON.stringify(est().potreros[pF].animales));
    chequear('el total del potrero no cambió con la reversión', win.totalPotrero(pF) === 5);
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
