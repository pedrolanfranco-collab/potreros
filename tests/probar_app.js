/*
 * probar_app.js — banco de pruebas para las apps de potreros (La Vuelta / María Laura)
 *
 * Uso:  node probar_app.js archivo1.html [archivo2.html ...]
 *
 * Levanta cada HTML en un DOM simulado (jsdom) con Leaflet, JSZip y Supabase
 * falsos, y ejercita los flujos que de verdad importan en la cancha: alta y
 * movimiento de hacienda, envío de eventos, aplicación de eventos de otro
 * dispositivo, sincronización sin duplicar, cola offline y exportaciones.
 *
 * Sale con código 1 si algo falla, así se puede encadenar en un script.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}

/* ---------- servidor Supabase simulado ---------- */
function crearServidor(){
  const filas = [];
  let n = 0;
  return {
    filas,
    createClient(){
      return { from(){
        const q = {
          _filtros: [],
          insert(obj){
            n++;
            filas.push(Object.assign({}, obj, {
              id: 'row' + n,
              creado_en: new Date(Date.UTC(2026, 0, 1, 12, 0, n)).toISOString()
            }));
            return Promise.resolve({ error: null });
          },
          select(){ return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          gt(col, val){ q._filtros.push(r => r[col] > val); return q; },
          order(){ return q; },
          then(res){
            const data = filas.filter(r => q._filtros.every(f => f(r)));
            return Promise.resolve(res({ data, error: null }));
          }
        };
        return q;
      } };
    }
  };
}

/* ---------- Leaflet simulado ----------
 * Es un Proxy: cualquier método que la app llame y no esté acá devuelve la
 * misma capa, así que sigue encadenando sin romper. Evita perseguir un
 * "bindTooltip is not a function" cada vez que la app usa algo nuevo. */
function limites(){
  const b = {
    getCenter(){ return { lat: -31.98, lng: -56.34 }; },
    extend(){ return b; }, isValid(){ return true; }, pad(){ return b; },
    getNorth(){ return -31.9; }, getSouth(){ return -32.0; },
    getEast(){ return -56.3; }, getWest(){ return -56.4; },
    contains(){ return true; }
  };
  return b;
}
function stubLeaflet(win){
  const conocidos = {
    getBounds: () => limites(),
    getLatLng: () => ({ lat: -31.98, lng: -56.34 }),
    getElement: () => win.document.createElement('div'),
    getTooltip: () => ({ setContent(){}, getElement(){ return win.document.createElement('div'); } }),
    getPopup: () => ({ setContent(){}, isOpen(){ return false; } }),
    isPopupOpen: () => false
  };
  const capa = () => {
    const o = new Proxy({ __capa: true }, {
      get(t, prop){
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
    _capas: new Set(),
    setView(){ return mapa; }, fitBounds(){ return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); return mapa; },
    removeLayer(l){ mapa._capas.delete(l); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); },
    getZoom(){ return 14; }, invalidateSize(){ return mapa; },
    setMaxBounds(){ return mapa; }
  };
  win.L = {
    map(){ return mapa; },
    tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); },
    circleMarker(){ return capa(); }, circle(){ return capa(); },
    divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); }
  };
  win.JSZip = function(){
    return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } };
  };
}

/* ---------- levantar una app ---------- */
async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8')
    .replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));

  const servidor = crearServidor();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://local.test/', virtualConsole: vc
  });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};

  const codigo = Array.from(win.document.querySelectorAll('script'))
    .map(s => s.textContent).filter(Boolean).join('\n');
  // "estado" es un let de nivel superior: no queda en window, así que le
  // agregamos un accesor para poder inspeccionarlo desde las pruebas.
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; };' +
    '\n;window.__vaciar = function(n){ estado.potreros[n].animales = {}; guardarEstado(); };'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }

  await new Promise(r => setTimeout(r, 60));
  return { win, errores, servidor };
}

/* ---------- una corrida completa ---------- */
async function probar(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores, servidor } = await levantar(archivo);
  const doc = win.document;

  chequear('carga sin errores de JS', errores.length === 0);
  if(errores.length){
    errores.forEach(e => console.log('     ' + e.split('\n').slice(0, 5).join('\n     ')));
    return;
  }

  const est = () => win.__est();
  const potreros = Object.keys(est().potreros);

  if(!potreros.length){
    console.log('  · sin potreros cargados (p.ej. Pone Chico antes de "Importar KML/KMZ") — este banco');
    console.log('    de pruebas asume potreros reales; usar un test dedicado (ver probar_pone_chico.js).');
    return;
  }
  chequear('hay potreros cargados', potreros.length > 0, potreros.length + '');
  chequear('la lista del costado se dibuja',
    doc.getElementById('lista-potreros').innerHTML.length > 50);
  // 10/9/2026: el panel superior separa "Animales" en vacunos/ovinos/equinos
  // (Pedro) en vez de un solo total.
  const vacunos = parseFloat(doc.getElementById('res-vacunos').textContent);
  const ovinos = parseFloat(doc.getElementById('res-ovinos').textContent);
  const equinos = parseFloat(doc.getElementById('res-equinos').textContent);
  chequear('el resumen muestra numeros (vacunos/ovinos/equinos)',
    !isNaN(vacunos) && !isNaN(ovinos) && !isNaN(equinos));
  const totalAnimalesReal = potreros.reduce((s,p)=> s + win.totalPotrero(p), 0);
  chequear('vacunos+ovinos+equinos suma el total real de animales',
    (vacunos+ovinos+equinos) === totalAnimalesReal,
    `${vacunos}+${ovinos}+${equinos} != ${totalAnimalesReal}`);

  const tiene = id => !!doc.getElementById(id);
  const variante = tiene('btn-gps') ? 'movil' : 'PC';
  console.log('  · variante detectada: ' + variante);
  if(variante === 'PC'){
    chequear('PC: sin GPS, con PDF/Excel/coeficientes',
      !tiene('btn-gps') && tiene('btn-exportar-pdf') && tiene('btn-exportar-excel') && tiene('btn-coeficientes'));
    chequear('PC: sin funciones de GPS huerfanas', typeof win.iniciarGPS === 'undefined');
  } else {
    chequear('movil: con GPS, sin PDF/Excel/coeficientes',
      tiene('btn-gps') && !tiene('btn-exportar-pdf') && !tiene('btn-exportar-excel') && !tiene('btn-coeficientes'));
    chequear('movil: sin modal de coeficientes', !tiene('modal-coef'));
    chequear('movil: sin funciones de reporte huerfanas',
      typeof win.reunirDatosReporte === 'undefined' && typeof win.renderCoefLista === 'undefined');
    chequear('movil: los coeficientes UG siguen aplicandose como dato',
      est().ugCoef && Object.keys(est().ugCoef).length > 0);
  }

  ['btn-exportar-json','btn-importar-json',
   'btn-puntos','btn-alertas','btn-restablecer','btn-sincronizar','btn-satelital']
    .forEach(id => chequear('boton ' + id + ' presente', tiene(id)));
  // Desde v2.19 "Exportar KMZ/MD" solo existe en PC — en movil el mismo botón
  // se reemplazó por "Importar KML/KMZ" (ver memoria importar-kml-limites-potreros).
  // Desde v2.21 "Importar KML/KMZ" tambien existe en PC, al lado de las
  // exportaciones existentes (no las reemplaza ahi).
  if(variante === 'PC'){
    ['btn-exportar-kmz','btn-exportar-md'].forEach(id => chequear('boton ' + id + ' presente', tiene(id)));
  }
  chequear('boton btn-importar-kml presente', tiene('btn-importar-kml'));

  // --- alta de hacienda ---
  const p1 = potreros[0], p2 = potreros[1] || potreros[0];
  // "Agregar animales" (5/9/2026) ahora es solo carga inicial: se bloquea si
  // el potrero ya tiene stock. Para poder probarlo hay que vaciarlo primero.
  win.__vaciar(p1);
  win.seleccionarPotrero(p1);
  // 10/9/2026: el boton "+ Agregar animales" se saco de la version movil
  // (Pedro: la carga inicial de un potrero se hace desde la PC; en el
  // celular solo quedan los movimientos del dia a dia) -- el mecanismo de
  // abajo (mostrarFormulario(p,'agregar')) sigue andando en los dos, para
  // no romper "editar" sobre una carga inicial ya hecha.
  chequear('boton "+ Agregar animales" ' + (variante==='PC' ? 'presente en PC' : 'ausente en movil'),
    !!doc.querySelector('[data-accion="agregar"]') === (variante === 'PC'));
  const antes = win.totalPotrero(p1);
  win.mostrarFormulario(p1, 'agregar');
  const cat = doc.getElementById('f-cat');
  const due = doc.getElementById('f-dueno');
  const cnt = doc.getElementById('f-cant');
  chequear('el formulario de agregar se arma', !!cat && !!cnt);
  let catUsada = null, dueUsado = null;
  if(cat && cnt){
    catUsada = cat.options[0].value;
    cat.value = catUsada;
    if(due){ dueUsado = due.options[0].value; due.value = dueUsado; }
    cnt.value = '7';
    doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('agregar suma 7 animales', win.totalPotrero(p1) === antes + 7,
      'quedo ' + win.totalPotrero(p1));
  }

  // --- movimiento entre potreros ---
  // "Mover" (desde el refactor a multi-categoria) usa checkboxes .mov-check +
  // inputs .mov-cant, no un simple #f-cat/#f-cant: cada fila trae data-cat
  // (la_vuelta) o data-key/data-cat/data-dueno (maria_laura/pone_chico).
  if(p2 !== p1 && catUsada){
    const oAntes = win.totalPotrero(p1), dAntes = win.totalPotrero(p2);
    win.seleccionarPotrero(p1);
    win.mostrarFormulario(p1, 'mover');
    const movCheck = doc.querySelector('.mov-check');
    const mDest = doc.getElementById('f-destino');
    chequear('el formulario de mover se arma', !!movCheck && !!mDest);
    if(movCheck && mDest){
      movCheck.checked = true;
      const sel = movCheck.dataset.key ? `[data-key="${movCheck.dataset.key}"]` : `[data-cat="${movCheck.dataset.cat}"]`;
      const movCant = doc.querySelector('.mov-cant' + sel);
      movCant.value = '3';
      mDest.value = p2;
      doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
      chequear('el movimiento resta en el origen', win.totalPotrero(p1) === oAntes - 3);
      chequear('el movimiento suma en el destino', win.totalPotrero(p2) === dAntes + 3);
      if(movCheck.dataset.dueno){
        const clave = win.claveAnimal(movCheck.dataset.cat, movCheck.dataset.dueno);
        chequear('el dueno viaja con los animales',
          (est().potreros[p2].animales[clave] || 0) >= 3);
      }
    }
  }

  // --- los eventos salieron para Supabase ---
  await new Promise(r => setTimeout(r, 60));
  chequear('los movimientos se mandaron como eventos', servidor.filas.length >= 2,
    servidor.filas.length + ' filas');
  chequear('cada evento lleva su establecimiento',
    servidor.filas.length > 0 && servidor.filas.every(f => f.establecimiento));

  // --- evento que llega de otro dispositivo ---
  const detalleRemoto = { categoria: catUsada, cantidad: 5 };
  if(dueUsado) detalleRemoto.dueno = dueUsado;
  const tAntes = win.totalPotrero(p1);
  win.aplicarEventoRemoto({ tipo: 'nacimiento', potrero: p1, dispositivo: 'otro',
    fecha_cliente: '01/01/2026', detalle: detalleRemoto });
  chequear('se aplica un nacimiento sincronizado', win.totalPotrero(p1) === tAntes + 5);

  if(p2 !== p1){
    const oAntes = win.totalPotrero(p1), dAntes = win.totalPotrero(p2);
    win.aplicarEventoRemoto({ tipo: 'movimiento', potrero: p1, dispositivo: 'otro',
      fecha_cliente: '01/01/2026',
      detalle: Object.assign({}, detalleRemoto, { cantidad: 4, destino: p2 }) });
    chequear('se aplica un movimiento sincronizado',
      win.totalPotrero(p1) === oAntes - 4 && win.totalPotrero(p2) === dAntes + 4);
  }

  // --- sincronizar() contra el servidor, dos veces ---
  const detalleAjeno = { categoria: catUsada, cantidad: 2 };
  if(dueUsado) detalleAjeno.dueno = dueUsado;
  servidor.filas.push({ id: 'ajeno1',
    establecimiento: servidor.filas.length ? servidor.filas[0].establecimiento : '',
    dispositivo: 'celular-de-otro', tipo: 'compra', potrero: p1, detalle: detalleAjeno,
    fecha_cliente: '01/01/2026', creado_en: new Date(Date.UTC(2026, 0, 1, 13, 0, 0)).toISOString() });
  const previo = win.totalPotrero(p1);
  await win.sincronizar(false);
  chequear('sincronizar() aplica el evento del otro dispositivo',
    win.totalPotrero(p1) === previo + 2, 'quedo ' + win.totalPotrero(p1));
  const post = win.totalPotrero(p1);
  await win.sincronizar(false);
  chequear('sincronizar() de nuevo no reaplica nada (ni los eventos propios)',
    win.totalPotrero(p1) === post);

  // --- sin senal ---
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  const colaAntes = (est().colaSync || []).length;
  win.enviarEvento('muerte', p1, Object.assign({}, detalleRemoto, { cantidad: 1 }));
  await new Promise(r => setTimeout(r, 40));
  chequear('sin senal el evento queda en cola', (est().colaSync || []).length === colaAntes + 1);
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  await win.vaciarColaSync();
  chequear('al volver la senal la cola se vacia', (est().colaSync || []).length === 0);

  // --- exportaciones ---
  // construirKML/construirMD solo existen en PC desde v2.19 (movil los
  // reemplazó por el importador). "Importar KML/KMZ" existe en las dos
  // variantes desde v2.21 (en PC convive con las exportaciones).
  if(variante === 'PC'){
    try { win.construirKML(); win.construirMD(); chequear('KML y MD se generan', true); }
    catch(e){ chequear('KML y MD se generan', false, e.message); }
  }
  chequear('existe la función de importar límites KML',
    typeof win.importarLimitesKML === 'function' && typeof win.parsearPlacemarksPotrero === 'function');
  if(variante === 'PC'){
    try {
      const d = win.reunirDatosReporte();
      chequear('los datos del reporte PDF/Excel se arman',
        !!d && Array.isArray(d.potrerosRows) && d.potrerosRows.length === potreros.length);
    } catch(e){ chequear('los datos del reporte PDF/Excel se arman', false, e.message); }
    try {
      win.renderCoefLista(est().ugCoef);
      chequear('el editor de coeficientes dibuja',
        doc.getElementById('coef-lista').innerHTML.length > 50);
    } catch(e){ chequear('el editor de coeficientes dibuja', false, e.message); }
  }

  chequear('el estado se guarda en el navegador', win.localStorage.length > 0);
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){
    console.error('Uso: node probar_app.js archivo.html [otro.html ...]');
    process.exit(2);
  }
  for(const a of archivos) await probar(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
