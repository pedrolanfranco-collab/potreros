/*
 * Prueba: "Potreros dobles" de La Vuelta (4/11/2026, a pedido de Pedro). Los potreros "1+2" y "19+20" son el dibujo
 * de dos potreros juntos (CONFIG.potrerosDobles). Verifica en la PC, la móvil completa y la móvil simple (Campo) de
 * La Vuelta:
 *  1. al arrancar, "1+2" y "19+20" están FUERA del mapa (oculto) y sus partes se ven normales (sin rayas);
 *  2. con animales en "1+2" (estado + actualizarTodo), el "1+2" vuelve al mapa y las partes "1" y "2" quedan con
 *     línea de rayas ('4 4');
 *  3. un clic en el polígono de la parte "1" selecciona "1+2";
 *  4. la lista muestra "🔗 1 y 2 unidos" en el doble y "🔗 Unido en 1+2" en cada parte;
 *  5. al vaciar "1+2", el doble sale del mapa otra vez y las partes vuelven a verse normales;
 *  6. (solo móvil) detectarPotreroActual de un punto dentro de la parte "1" da "1" cuando está vacío y "1+2" con animales;
 *  7. María Laura (PC) carga sin errores y no tiene ningún comportamiento de dobles;
 *  8. ninguna variante dio errores de JS.
 * Los dos sitios que pintan el mapa (L.polygon, L.marker, L.map) son un Leaflet falso que registra lo que se agrega y
 * se saca del mapa. Usa el mismo arnés que probar_capas_puntos.js (Supabase falso, GPS falso, sin red).
 * Uso: node tests/probar_potreros_dobles.js la-vuelta-pc/index.html la-vuelta-movil/index.html la-vuelta-movil-campo/index.html maria-laura-pc/index.html
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

function limites(){
  const b = { getCenter(){ return { lat: -31.98, lng: -56.34 }; }, extend(){ return b; },
    isValid(){ return true; }, pad(){ return b; }, getNorth(){ return -31.9; },
    getSouth(){ return -32.0; }, getEast(){ return -56.3; }, getWest(){ return -56.4; },
    contains(){ return true; } };
  return b;
}
function centroDe(coords){
  const lat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lon = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return { lat, lon };
}

/* Marcador/etiqueta: addTo lo registra en el mapa falso (así se sabe si está visible). */
function marcador(ll){
  const m = { _lat: Array.isArray(ll) ? ll[0] : (ll && ll.lat), _lon: Array.isArray(ll) ? ll[1] : (ll && ll.lng), _listeners: {} };
  const o = new Proxy(m, {
    get(t, prop){
      if(prop in t) return t[prop];
      if(typeof prop !== 'string') return undefined;
      if(prop === 'addTo') return mapa => { mapa.addLayer(o); return o; };
      if(prop === 'on') return (ev, fn) => { (t._listeners[ev] = t._listeners[ev] || []).push(fn); return o; };
      if(prop === 'getLatLng') return () => ({ lat: t._lat, lng: t._lon });
      return () => o;
    }
  });
  return o;
}

/* Polígono: guarda coords, opciones, el último estilo (setStyle) y sus clics. */
function poligono(coords, opts){
  const p = { coords, opciones: Object.assign({}, opts), estilo: Object.assign({}, opts), handlers: {}, estilos: [] };
  const c = centroDe(coords);
  Object.assign(p, {
    on(ev, fn){ (p.handlers[ev] = p.handlers[ev] || []).push(fn); return p; },
    addTo(mapa){ mapa.addLayer(p); return p; },
    setStyle(s){ Object.assign(p.estilo, s); p.estilos.push(Object.assign({}, s)); return p; },
    bindTooltip(){ return p; }, bindPopup(){ return p; }, setPopupContent(){ return p; }, openPopup(){ return p; },
    getBounds(){ return { getCenter(){ return { lat: c.lat, lng: c.lon }; }, pad(){ return this; } }; },
    getLatLngs(){ return coords; }
  });
  return p;
}

function stubLeaflet(win){
  const mapa = {
    _capas: new Set(), _movimientos: [],
    setView(){ return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); mapa._movimientos.push(['add', l]); return mapa; },
    removeLayer(l){ mapa._capas.delete(l); mapa._movimientos.push(['remove', l]); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); },
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; },
    panTo(){ return mapa; }, setZoom(){ return mapa; }, flyTo(){ return mapa; }, getBounds(){ return limites(); }
  };
  const generico = () => {
    const o = new Proxy({}, {
      get(t, prop){
        if(prop in t) return t[prop];
        if(typeof prop !== 'string') return undefined;
        if(prop === 'getBounds') return () => limites();
        if(prop === 'getCenter') return () => ({ lat: -31.98, lng: -56.34 });
        if(prop === 'getElement') return () => win.document.createElement('div');
        if(prop === 'getLatLng') return () => ({ lat: -31.98, lng: -56.34 });
        if(prop === 'addTo') return mapaDestino => { if(mapaDestino && mapaDestino.addLayer) mapaDestino.addLayer(o); return o; };
        return () => o;
      }
    });
    return o;
  };
  win.L = {
    map(){ return mapa; },
    tileLayer(){ const c = generico(); mapa._capas.add(c); return c; },
    polygon(coords, opts){ return poligono(coords, opts); },
    marker(ll){ return marcador(ll); },
    circleMarker(){ return generico(); }, circle(){ return generico(); },
    layerGroup(){ return generico(); }, featureGroup(){ return generico(); },
    divIcon(){ return {}; }, icon(){ return {}; },
    latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); },
    DomEvent: { stopPropagation(){}, preventDefault(){}, disableClickPropagation(){} },
    control: generico()
  };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
  return mapa;
}

/* Supabase falso: cualquier cadena de llamadas responde vacío (sin red). */
function supabaseFalso(){
  const respuesta = () => ({ data: [], error: null, status: 200, count: 0 });
  const cadena = () => new Proxy(function(){}, {
    get(t, prop){
      if(prop === 'then') return (res, rej) => Promise.resolve(respuesta()).then(res, rej);
      if(prop === 'catch' || prop === 'finally') return () => cadena();
      return cadena();
    },
    apply(){ return cadena(); }
  });
  return { createClient(){ return new Proxy({}, { get(){ return cadena(); } }); } };
}

async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  const mapa = stubLeaflet(win);
  win.supabase = supabaseFalso();
  win.fetch = async () => ({ ok: false, status: 0, json: async () => [], text: async () => '' });
  win.__gpsCoords = { lat: -31.40, lon: -55.43, acc: 12 };
  Object.defineProperty(win.navigator, 'geolocation', {
    value: { getCurrentPosition(ok){ ok({ coords: { latitude: win.__gpsCoords.lat, longitude: win.__gpsCoords.lon, accuracy: 12 } }); },
             watchPosition(){ return 0; }, clearWatch(){} },
    configurable: true
  });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo +
      '\n;window.__t = {' +
      ' poligonos: () => poligonos,' +
      ' estado: () => estado,' +
      ' actualizarTodo: () => actualizarTodo(),' +
      ' renderLista: (f) => renderLista(f || ""),' +
      ' seleccionar: (n) => seleccionarPotrero(n),' +
      ' sel: () => seleccionActual,' +
      ' desel: () => { seleccionActual = null; },' +
      ' dobles: () => POTREROS_DOBLES,' +
      ' esDoble: (n) => esDoble(n),' +
      ' detectar: (la, lo) => typeof detectarPotreroActual === "function" ? detectarPotreroActual(la, lo) : undefined,' +
      ' pip: (la, lo, c) => puntoEnPoligono(la, lo, c),' +
      ' geo: () => POTREROS_GEO,' +
      ' pendientes: (sucios) => aplicarPendientesYaConocidos(sucios),' +
      ' haFisicas: () => haFisicas(),' +
      ' fisicos: () => potrerosFisicos().length,' +
      ' total: (n) => totalPotrero(n)' +
      ' };');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await esperar(80);
  return { win, errores, mapa, t: win.__t };
}

const notasDoble = doc => [...doc.querySelectorAll('.nota-doble')].map(x => x.textContent.trim());
// poligonos[nombre] = {layer, label, area}: el polígono (con su estilo y clics) es .layer
const estiloParte = (p, nombre) => p[nombre] ? (p[nombre].layer.estilo.dashArray || null) : 'SIN POLIGONO';

async function probarLaVuelta(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const L = await levantar(archivo);
  const t = L.t;
  if(L.errores.length){ chequear('carga sin errores de JS', false, L.errores[0]); return; }
  chequear('carga sin errores de JS', true);
  const p = t.poligonos();
  const doc = L.win.document;
  const dobles = t.dobles();
  chequear('los dobles son 1+2 y 19+20 (config)', JSON.stringify(dobles) === JSON.stringify({ '1+2': ['1', '2'], '19+20': ['19', '20'] }), JSON.stringify(dobles));
  chequear('"1+2" y "19+20" tienen polígono propio', !!p['1+2'] && !!p['19+20']);

  // 1. arranque: dobles vacíos fuera del mapa, partes normales
  for(const d of ['1+2', '19+20']){
    chequear(`arranque: "${d}" vacío está oculto y fuera del mapa`, p[d].oculto === true && !L.mapa.hasLayer(p[d].layer));
  }
  for(const n of ['1', '2', '19', '20']){
    chequear(`arranque: parte "${n}" está en el mapa y sin rayas`, L.mapa.hasLayer(p[n].layer) && !estiloParte(p, n));
  }

  // 2. con animales en 1+2: el doble vuelve y las partes quedan con rayas
  // como en el campo al unir: las partes quedan vacías ("Mover todo" al doble)
  for(const parte of ['1', '2']) t.estado().potreros[parte].animales = {};
  t.estado().potreros['1+2'].animales['Vacas||Pedro Lanfranco'] = 10;
  t.actualizarTodo();
  chequear('con animales en "1+2": el doble vuelve al mapa', L.mapa.hasLayer(p['1+2'].layer) && p['1+2'].oculto === false);
  chequear('con animales en "1+2": parte "1" con rayas (4 4)', estiloParte(p, '1') === '4 4', String(estiloParte(p, '1')));
  chequear('con animales en "1+2": parte "2" con rayas (4 4)', estiloParte(p, '2') === '4 4', String(estiloParte(p, '2')));
  chequear('con animales en "1+2": "19+20" sigue oculto y sus partes sin rayas',
    p['19+20'].oculto === true && !estiloParte(p, '19') && !estiloParte(p, '20'));

  // 3. clic en la parte "1" selecciona el doble
  t.desel();
  const clic = p['1'].layer.handlers.click;
  chequear('la parte "1" tiene manejador de clic', !!clic && clic.length > 0);
  if(clic && clic.length) clic[0]({ latlng: { lat: centroDe(p['1'].layer.coords).lat, lng: centroDe(p['1'].layer.coords).lon } });
  await esperar(20);
  chequear('clic en la parte "1" selecciona "1+2"', t.sel() === '1+2', String(t.sel()));

  // 4. lista: textos de unión
  t.renderLista('');
  const notas = notasDoble(doc);
  chequear('la lista muestra "🔗 1 y 2 unidos" en el doble', notas.includes('🔗 1 y 2 unidos'), JSON.stringify(notas));
  chequear('la lista muestra "🔗 Unido en 1+2" en la parte 1 y la 2', notas.filter(x => x === '🔗 Unido en 1+2').length === 2, JSON.stringify(notas));

  // 6 (solo móvil). detectarPotreroActual dentro de la parte 1
  const dentro = centroDe(p['1'].layer.coords);
  const esMovil = /movil/.test(archivo);
  if(esMovil){
    chequear('la parte 1 contiene su propio centro (puntoEnPoligono)', t.pip(dentro.lat, dentro.lon, p['1'].layer.coords));
    chequear('detectarPotreroActual en la parte 1 con "1+2" con animales devuelve "1+2"', t.detectar(dentro.lat, dentro.lon) === '1+2', String(t.detectar(dentro.lat, dentro.lon)));
  }

  // 5. vaciar 1+2: el doble sale del mapa y las partes vuelven normales
  delete t.estado().potreros['1+2'].animales['Vacas||Pedro Lanfranco'];
  t.desel();
  t.actualizarTodo();
  chequear('al vaciar "1+2": sale del mapa otra vez (oculto)', p['1+2'].oculto === true && !L.mapa.hasLayer(p['1+2'].layer));
  chequear('al vaciar "1+2": partes "1" y "2" sin rayas', !estiloParte(p, '1') && !estiloParte(p, '2'));
  chequear('al vaciar "1+2": la lista ya no dice "Unido en 1+2" en las partes', !notasDoble(doc).includes('🔗 Unido en 1+2'), JSON.stringify(notasDoble(doc)));
  if(esMovil){
    chequear('detectarPotreroActual en la parte 1 vacía devuelve "1"', t.detectar(dentro.lat, dentro.lon) === '1', String(t.detectar(dentro.lat, dentro.lon)));
  }

  // 6. superficie y cantidad: el doble no se suma (se pisa con sus partes)
  const geoFis = t.geo().filter(x => !t.esDoble(x.nombre));
  chequear('potreros físicos = los de la config sin los dobles', t.fisicos() === geoFis.length, t.fisicos() + ' vs ' + geoFis.length);
  const resPot = doc.getElementById('res-potreros');
  if(resPot) chequear('tarjeta de resumen: cantidad de potreros sin los dobles', resPot.textContent.trim() === String(geoFis.length), resPot.textContent);
  const conDobles = t.geo().reduce((s, x) => s + (parseFloat(x.area) || 0), 0), sinDobles = geoFis.reduce((s, x) => s + (parseFloat(x.area) || 0), 0);
  chequear('las ha totales no suman los dobles', Math.abs(t.haFisicas() - sinDobles) < Math.abs(t.haFisicas() - conDobles), t.haFisicas() + ' (sin dobles ' + sinDobles + ', con ' + conDobles + ')');

  // 7. una parte con animales propios sigue a la vista aunque el doble tenga animales
  for(const parte of ['1', '2']) t.estado().potreros[parte].animales = {};
  t.estado().potreros['1+2'].animales['Vacas||Pedro Lanfranco'] = 5;
  t.estado().potreros['1'].animales['Toros||Pedro Lanfranco'] = 1;
  t.desel(); t.actualizarTodo();
  chequear('parte "1" con animales propios: sin rayas (se puede tocar)', !estiloParte(p, '1'));
  chequear('parte "2" vacía: con rayas', estiloParte(p, '2') === '4 4');
  t.estado().potreros['1'].animales = {};
  t.estado().potreros['1+2'].animales = {};

  // 8. eventos estacionados hacia "1+2" (llegaron cuando este equipo no conocía el doble) se aplican al sincronizar
  const antes = t.total('1+2');
  t.estado().pendientesPotrero = { '1+2': [{ event_id: '11111111-1111-4111-8111-111111111111', tipo: 'ingreso', potrero: '1+2',
    detalle: { categoria: 'Vacas', dueno: 'Pedro Lanfranco', cantidad: 7 }, fecha_cliente: '04/11/2026', creado_en: new Date().toISOString(), dispositivo: 'otro' }] };
  t.pendientes(new L.win.Set());
  chequear('evento estacionado hacia "1+2" se aplica (stock +7)', t.total('1+2') === antes + 7, antes + ' -> ' + t.total('1+2'));
  chequear('y ya no queda estacionado', !(t.estado().pendientesPotrero || {})['1+2']);
  t.estado().potreros['1+2'].animales = {};
  t.actualizarTodo();

  chequear('sin errores de JS al final', L.errores.length === 0, L.errores.join(' | ').slice(0, 300));
  L.win.close();
}

async function probarMariaLaura(archivo){
  console.log('\n=== ' + archivo + ' (sin dobles) ===');
  const L = await levantar(archivo);
  if(L.errores.length){ chequear('carga sin errores de JS', false, L.errores[0]); return; }
  chequear('carga sin errores de JS', true);
  const t = L.t;
  chequear('no hay potreros dobles configurados', Object.keys(t.dobles()).length === 0, JSON.stringify(t.dobles()));
  chequear('"1+2" no es un doble ni existe como potrero', !t.esDoble('1+2') && !t.poligonos()['1+2'] && !t.geo().some(x => x.nombre === '1+2'));
  chequear('los potreros de María Laura se dibujan todos en el mapa', t.geo().every(x => !!t.poligonos()[x.nombre] && L.mapa.hasLayer(t.poligonos()[x.nombre].layer)));
  chequear('sin errores de JS al final', L.errores.length === 0, L.errores.join(' | ').slice(0, 300));
  L.win.close();
}

(async () => {
  const archivos = process.argv.slice(2).length ? process.argv.slice(2) : [
    'la-vuelta-pc/index.html', 'la-vuelta-movil/index.html', 'la-vuelta-movil-campo/index.html', 'maria-laura-pc/index.html'];
  for(const a of archivos){
    if(/maria-laura/.test(a)) await probarMariaLaura(a);
    else await probarLaVuelta(a);
  }
  console.log(fallas ? '\n' + fallas + ' FALLAS' : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
})();
