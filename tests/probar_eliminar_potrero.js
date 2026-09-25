/*
 * probar_eliminar_potrero.js — prueba ad hoc para "🗑 Eliminar potrero",
 * la contraparte de "Importar KML/KMZ". Reusa los stubs de
 * probar_importar_kml_ml.js.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

function crearServidor(){
  // stock_potreros se guarda aparte de eventos_sync (filas): desde que
  // stockSupabase se activó en Pone Chico, eliminarPotrero() llama de
  // verdad a borrarStockPotrero() -> client.from('stock_potreros').delete(),
  // que sin este soporte tira "delete is not a function" (ver
  // probar_stock_potreros.js, que ya lo necesitaba para La Vuelta).
  const filas = [];
  const stock = [];
  const tablas = { eventos_sync: filas, stock_potreros: stock };
  return { filas, createClient(){ return { from(tabla){
    const arr = tablas[tabla] || (tablas[tabla] = []);
    const q = { _filtros: [], _delete: false,
      insert(obj){ arr.push(obj); return Promise.resolve({ error: null }); },
      upsert(objs, opts){
        const claves = ((opts && opts.onConflict) || '').split(',');
        (Array.isArray(objs) ? objs : [objs]).forEach(obj=>{
          const idx = arr.findIndex(r=> claves.every(c=>r[c]===obj[c]));
          if(idx>=0) arr[idx] = Object.assign({}, arr[idx], obj); else arr.push(Object.assign({}, obj));
        });
        return Promise.resolve({ error: null });
      },
      select(){ return q; }, eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
      gt(col, val){ q._filtros.push(r => r[col] > val); return q; }, order(){ return q; },
      not(col, op, val){
        const lista = String(val).replace(/^\(|\)$/g,'').split(',').filter(Boolean).map(s=>s.replace(/^"|"$/g,''));
        q._filtros.push(r=> !lista.includes(r[col]));
        return q;
      },
      delete(){ q._delete = true; return q; },
      then(res){
        if(q._delete){
          tablas[tabla] = arr.filter(r => !q._filtros.every(f => f(r)));
          return Promise.resolve(res({ error: null }));
        }
        const data = arr.filter(r => q._filtros.every(f => f(r)));
        return Promise.resolve(res({ data, error: null }));
      }
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
    _capas: new Set(), _maxBoundsCalls: 0, setView(){ return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); return mapa; }, removeLayer(l){ mapa._capas.delete(l); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); }, getZoom(){ return 14; }, invalidateSize(){ return mapa; },
    setMaxBounds(){ mapa._maxBoundsCalls++; return mapa; }
  };
  win.__mapa = mapa;
  win.L = {
    map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); }, circle(){ return capa(); },
    divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; }, latLngBounds(){ return limites(); }
  };
}

async function levantar(archivo, seedLocalStorage, servidorCompartido){
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
  win.__alerts = [];
  win.alert = (msg)=>{ win.__alerts.push(msg); };
  win.confirm = () => win.__confirmRespuesta !== undefined ? win.__confirmRespuesta : true;
  win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  win.__recargoLlamado = false;
  try{ Object.defineProperty(win, 'location', { value: Object.assign(Object.create(win.location), { reload: ()=>{ win.__recargoLlamado = true; } }), configurable: true }); }
  catch(e){ win.location.reload = ()=>{ win.__recargoLlamado = true; }; }
  if(seedLocalStorage){
    Object.entries(seedLocalStorage).forEach(([k,v]) => win.localStorage.setItem(k, v));
  }

  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; };' +
    '\nwindow.__potreros = function(){ return POTREROS_GEO; };' +
    '\nwindow.__potrerosNuevosKey = function(){ return POTREROS_NUEVOS_KEY; };' +
    '\nwindow.__limitesKey = function(){ return LIMITES_KEY; };' +
    '\nwindow.__sync = sincronizar;'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 80));
  return { win, errores, servidor };
}

function archivoFalso(nombre, contenidoBuffer){
  return Object.assign(contenidoBuffer, { name: nombre, text: async () => contenidoBuffer.toString('utf-8') });
}
function kmlConPlacemarks(placemarks){
  const cuerpo = placemarks.map(p => `<Placemark><name>${p.nombre}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${p.coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${cuerpo}</Document></kml>`;
}

// --- Caso 1: La Vuelta (con potreros originales de fábrica) ---
async function probarLaVuelta(archivo){
  console.log('\n=== ' + archivo + ' (con potreros originales) ===');
  const { win, errores, servidor } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores de JS', false, errores[0]); return; }
  chequear('carga sin errores de JS', true);

  const nombreOriginal = win.__potreros()[0].nombre;
  const coordsOriginales = win.__potreros()[0].coords;

  // 1a. Bloqueado por tener animales
  win.__est().potreros[nombreOriginal].animales['Vacas'] = 3;
  win.eliminarPotrero(nombreOriginal);
  chequear('bloquea si el potrero tiene animales',
    win.__alerts.some(a=>a.includes('todavía tiene animales')) && !win.__alerts.some(a=>a.includes('recargar')));
  win.__est().potreros[nombreOriginal].animales['Vacas'] = 0;
  win.__alerts = [];

  // 1b. Bloqueado por no venir de una importación (potrero de fábrica, sin tocar)
  win.eliminarPotrero(nombreOriginal);
  chequear('bloquea si el potrero no fue tocado por Importar KML/KMZ',
    win.__alerts.some(a=>a.includes('no fue creado ni modificado')) && !win.__alerts.some(a=>a.includes('recargar')));
  win.__alerts = [];

  // 1c. Actualizar límite de un potrero original -- tiene que subir como evento
  // (13/9/2026, a pedido: antes esto era 100% local, ver "potrero_limite_actualizado")
  chequear('al arrancar con potreros ya se fijó un límite de paneo', win.__mapa._maxBoundsCalls >= 1);
  const llamadasAntes = win.__mapa._maxBoundsCalls;
  const coordsNuevas = '-55.400,-31.390,0 -55.401,-31.391,0 -55.402,-31.389,0 -55.400,-31.390,0';
  const kmlTxt = kmlConPlacemarks([{ nombre: nombreOriginal, coords: coordsNuevas }]);
  await win.importarLimitesKML(archivoFalso('limites.kml', Buffer.from(kmlTxt, 'utf-8')));
  chequear('Importar KML/KMZ recalcula el límite de paneo', win.__mapa._maxBoundsCalls > llamadasAntes);
  let guardado = JSON.parse(win.localStorage.getItem(win.__limitesKey()) || '{}');
  chequear('(previo) el límite importado quedó guardado', !!guardado[nombreOriginal]);
  chequear('actualizar límite: se mandó el evento potrero_limite_actualizado',
    servidor.filas.some(e=>e.tipo==='potrero_limite_actualizado' && e.potrero===nombreOriginal));

  // 1d. Un SEGUNDO dispositivo (de fábrica) que sincroniza tiene que recibir
  // el límite nuevo -- esto es lo que Pedro pidió: "si se importa un mapa
  // desde cualquier app se tiene que subir al mapa original como evento".
  const remoto1 = await levantar(archivo, null, servidor);
  await remoto1.win.__sync(false);
  const pRemoto1 = remoto1.win.__potreros().find(p=>p.nombre===nombreOriginal);
  chequear('otro dispositivo recibe el límite actualizado por sync',
    JSON.stringify(pRemoto1 && pRemoto1.coords) === JSON.stringify(win.__potreros().find(p=>p.nombre===nombreOriginal).coords));

  // 1e. Revertir límite importado sobre un potrero original
  win.__confirmRespuesta = true;
  await win.eliminarPotrero(nombreOriginal);
  guardado = JSON.parse(win.localStorage.getItem(win.__limitesKey()) || '{}');
  chequear('revertir: el límite importado se sacó de localStorage', !guardado[nombreOriginal]);
  chequear('revertir: el potrero NO se borra de POTREROS_GEO', win.__potreros().some(p=>p.nombre===nombreOriginal));
  chequear('revertir: pide recargar la página', win.__alerts.some(a=>a.includes('recargar')));
  chequear('revertir: se mandó el evento potrero_limite_revertido',
    servidor.filas.some(e=>e.tipo==='potrero_limite_revertido' && e.potrero===nombreOriginal));

  // 1f. Ese mismo segundo dispositivo, al volver a sincronizar, tiene que
  // volver al contorno original -- sin haber tenido que recargar la página.
  await remoto1.win.__sync(false);
  const pRemoto1b = remoto1.win.__potreros().find(p=>p.nombre===nombreOriginal);
  chequear('otro dispositivo revierte al límite original por sync',
    JSON.stringify(pRemoto1b.coords) === JSON.stringify(coordsOriginales));
}

// --- Caso 2: establecimiento sin potreros originales (Pone Chico) ---
async function probarPoneChico(archivo){
  console.log('\n=== ' + archivo + ' (todo creado por import) ===');
  const { win, errores, servidor } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores de JS', false, errores[0]); return; }
  chequear('carga sin errores de JS', true);

  chequear('sin potreros todavía no hay límite de paneo', win.__mapa._maxBoundsCalls === 0);
  const coordsNuevas = '-55.400,-31.390,0 -55.401,-31.391,0 -55.402,-31.389,0 -55.400,-31.390,0';
  const kmlTxt = kmlConPlacemarks([{ nombre: 'Potrero Mal Importado', coords: coordsNuevas }]);
  win.__confirmRespuesta = true;
  await win.importarLimitesKML(archivoFalso('limites.kml', Buffer.from(kmlTxt, 'utf-8')));
  chequear('(previo) el potrero de prueba quedó creado', win.__potreros().some(p=>p.nombre==='Potrero Mal Importado'));
  chequear('al crear el primer potrero por KML se fija el límite de paneo', win.__mapa._maxBoundsCalls >= 1);
  chequear('crear: se mandó el evento potrero_creado',
    servidor.filas.some(e=>e.tipo==='potrero_creado' && e.potrero==='Potrero Mal Importado'));

  // Un dispositivo que NUNCA importó este KML (el caso real de "Piquete" en
  // La Vuelta: importado en el celular, la PC nunca lo vio) tiene que verlo
  // aparecer solo con sincronizar, coordenadas incluidas -- sin tener que
  // importar el KML de nuevo ahí.
  const remoto = await levantar(archivo, null, servidor);
  await remoto.win.__sync(false);
  chequear('otro dispositivo recibe el potrero nuevo por sync (sin re-importar)',
    remoto.win.__potreros().some(p=>p.nombre==='Potrero Mal Importado'));
  chequear('otro dispositivo puede cargarle animales tras el sync (no lo ignora)',
    !!remoto.win.__est().potreros['Potrero Mal Importado']);

  win.__confirmRespuesta = true;
  win.__alerts = [];
  await win.eliminarPotrero('Potrero Mal Importado');
  const nuevos = JSON.parse(win.localStorage.getItem(win.__potrerosNuevosKey()) || '[]');
  chequear('eliminar: se sacó de POTREROS_NUEVOS_KEY', !nuevos.some(p=>p.nombre==='Potrero Mal Importado'));
  chequear('eliminar: se borró estado.potreros[...]', !win.__est().potreros['Potrero Mal Importado']);
  chequear('eliminar: pide recargar la página', win.__alerts.some(a=>a.includes('recargar')));
  chequear('eliminar: se mandó el evento potrero_eliminado',
    servidor.filas.some(e=>e.tipo==='potrero_eliminado' && e.potrero==='Potrero Mal Importado'));

  // El dispositivo remoto, que ya lo tenía, tiene que perderlo también.
  await remoto.win.__sync(false);
  chequear('otro dispositivo pierde el potrero eliminado por sync',
    !remoto.win.__potreros().some(p=>p.nombre==='Potrero Mal Importado'));
  chequear('otro dispositivo: estado.potreros[...] también se borra',
    !remoto.win.__est().potreros['Potrero Mal Importado']);
}

(async () => {
  const [laVuelta, poneChico] = process.argv.slice(2).length === 2 ? process.argv.slice(2) : [
    'C:/Users/Pedro/OneDrive/Proyecto Gestion ganadera/potreros_la_vuelta_movil.html',
    'C:/Users/Pedro/OneDrive/Proyecto Gestion ganadera/pone_chico_movil.html'
  ];
  await probarLaVuelta(laVuelta);
  await probarPoneChico(poneChico);
  console.log('\n' + (fallas === 0 ? 'TODO OK' : fallas + ' verificacion(es) fallaron'));
  process.exit(fallas === 0 ? 0 : 1);
})();
