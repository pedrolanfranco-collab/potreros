/*
 * Prueba ad-hoc: parseComandoVoz() debe resolver bien el potrero cuando el
 * comando usa "en el N"/"al potrero N"/"del potrero N" (con relleno "el"/
 * "la"/"potrero" entre la preposicion y el numero -- antes solo andaba
 * "en 9", no "en el 9", pese a que ese es el ejemplo que la propia app
 * sugiere). Tambien verifica que la cantidad no se confunda con el numero
 * del potrero cuando no se dice una cantidad explicita, y que decir
 * "potrero" sin mencionar ningun animal no dispare la categoria "Potros/as".
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
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient(){ return { from(){ const q = { insert(){ return Promise.resolve({error:null}); }, select(){return q;}, eq(){return q;}, order(){return q;}, then(res){ return Promise.resolve(res({data:[],error:null})); } }; return q; } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + `
    ;if(!POTREROS_GEO.length){
      // Pone Chico arranca sin potreros geograficos -- se agregan dos a mano
      // para poder probar la resolucion de nombres por voz.
      POTREROS_GEO.push({nombre:'9', area:'10', coords:[[0,0],[0,1],[1,1]]});
      POTREROS_GEO.push({nombre:'CERRO', area:'10', coords:[[2,2],[2,3],[3,3]]});
      estado.potreros['9'] = { animales:{}, historial:[], fechaIngreso:null, fechaSalida:null };
      estado.potreros['CERRO'] = { animales:{}, historial:[], fechaIngreso:null, fechaSalida:null };
    }
    window.__parse = parseComandoVoz; window.__detectarCategoria = detectarCategoria; window.__est = function(){ return estado; }; window.__potreros = POTREROS_GEO.map(p=>p.nombre);
  `); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 30));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const nombres = win.__potreros;
  // usamos el primer potrero numerico si existe, o el primero de la lista
  const pNum = nombres.find(n => /^\d+$/.test(n)) || nombres[0];
  const pOtro = nombres.find(n => n !== pNum) || nombres[1] || nombres[0];

  // Fix 4/5: "en el N" y variantes con relleno
  let r = win.__parse(`nació un ternero en el ${pNum}`);
  chequear(`"en el ${pNum}" resuelve el potrero (origen y destino)`, r.origen === pNum && r.destino === pNum, JSON.stringify(r));

  r = win.__parse(`nació un ternero en potrero ${pNum}`);
  chequear(`"en potrero ${pNum}" resuelve el potrero`, r.origen === pNum, JSON.stringify(r));

  r = win.__parse(`mover 10 vacas al potrero ${pOtro}`);
  chequear(`"al potrero ${pOtro}" resuelve destino`, r.destino === pOtro, JSON.stringify(r));
  chequear(`cantidad explícita (10) no se pierde con relleno "potrero"`, r.cantidad === 10, JSON.stringify(r));

  r = win.__parse(`del potrero ${pNum} al potrero ${pOtro} mover vacas`);
  chequear(`"del potrero X al potrero Y" resuelve ambos`, r.origen === pNum && r.destino === pOtro, JSON.stringify(r));

  // Fix 5: sin cantidad explícita, no debe tomar el número del potrero como cantidad
  r = win.__parse(`mover vacas al potrero ${pOtro}`);
  chequear(`sin cantidad explícita, no usa el número del potrero (da 1, no ${pOtro})`,
    r.cantidad === 1, JSON.stringify(r));

  // Fix 6: decir "potrero" sin mencionar ningún animal no debe dar "Potros/as"
  const cat = win.__detectarCategoria(`agregar 5 al potrero 4`);
  chequear('sin mencionar un animal, no detecta "Potros/as" por decir "potrero"', cat !== 'Potros/as', 'detectó: ' + cat);
  // pero un animal real que empieza con "potr" (potrillo) sigue funcionando
  const catPotro = win.__detectarCategoria(`nació un potrillo en el ${pNum}`);
  chequear('"potrillo" sigue detectando Potros/as', catPotro === 'Potros/as', 'detectó: ' + catPotro);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
