/*
 * Prueba ad-hoc: "+ Cargar tratamiento" dentro del modal Sanidad.
 * Verifica: el formulario arma el insert correcto a la tabla de Sanidad con
 * los 10 campos (+ dueno si la variante lo tiene); validaciones minimas; sin
 * conexion encola en estado.colaSanidad y se vacia con sincronizar().
 *
 * 10/9/2026: La Vuelta sigue con la tabla compartida "sanidad_carga" (con
 * columna establecimiento) y el puente hacia el Excel ("Mis cargas
 * recientes" con el tri-estado segun importado_en). Maria Laura y Pone
 * Chico pasaron a tener su propia tabla ("sanidad_carga_<establecimiento>",
 * sin columna establecimiento ni importado_en) y a leer su historial
 * directo de ahi (div "sanidad-lista" unico, sin "sanidad-mis-cargas") --
 * el test detecta cual disenio tiene cada archivo por la presencia de
 * "sanidad-mis-cargas" y bifurca las verificaciones que correspondan.
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

function crearServidor(){
  const filas = { sanidad_carga: [], eventos_sync: [], productos_catalogo: [] };
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          insert(obj){
            (filas[tabla] = filas[tabla] || []).push(Object.assign({}, obj));
            return Promise.resolve({ error: null });
          },
          select(){ return q; }, eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; }, order(){ return q; }, limit(){ return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          then(res){ const data = (filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r))); return Promise.resolve(res({data, error:null})); }
        };
        return q;
      } };
    }
  };
}

async function levantar(archivo, servidor){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
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
  try {
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__tablaSanidad = (typeof TABLA_SANIDAD!=="undefined") ? TABLA_SANIDAD : "sanidad_carga";' +
      '\n;window.__cargarSanidad = (typeof cargarSanidad!=="undefined") ? cargarSanidad : undefined;' +
      '\n;window.__potrerosGeo = POTREROS_GEO;');
  }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  // Pone Chico arranca sin potreros (POTREROS_GEO=[]) -- se sintetiza uno
  // minimo, ya que este test no pasa por seleccionarPotrero/renderDetalle
  // (que si necesitarian info geografica de verdad).
  if(Object.keys(win.__est().potreros).length === 0){
    win.__potrerosGeo.push({nombre:'TEST', area:null, coords:[[-31.98,-56.34],[-31.981,-56.34],[-31.981,-56.341]]});
    win.__est().potreros['TEST'] = {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null};
  }

  chequear('boton btn-cargar-sanidad presente', !!doc.getElementById('btn-cargar-sanidad'));

  doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20)); // btn-cargar-sanidad es async (cargarCatalogoProductos())
  chequear('el formulario se muestra', doc.getElementById('form-sanidad').style.display === 'block');
  chequear('categoria trae opciones', doc.getElementById('sc-categoria').options.length > 0);
  chequear('potrero trae opciones', doc.getElementById('sc-potrero').options.length > 0);
  chequear('sin catálogo, producto1 queda como texto libre', doc.getElementById('sc-producto1').style.display === 'none' && doc.getElementById('sc-producto1-otro').style.display !== 'none');

  const tieneDueno = !!doc.getElementById('sc-dueno');
  const tablaSanidad = win.__tablaSanidad;
  const esBaseCompartida = tablaSanidad === 'sanidad_carga'; // solo La Vuelta

  // --- validaciones: sin producto1 no guarda ---
  doc.getElementById('sc-cantidad').value = '70';
  doc.getElementById('sc-dosis1').value = '9';
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  chequear('sin producto 1 no manda nada', (servidor.filas[tablaSanidad]||[]).length === 0);

  // --- carga completa (sin catálogo: texto libre) ---
  doc.getElementById('sc-producto1-otro').value = 'MEXIVER';
  doc.getElementById('sc-producto2-otro').value = '';
  doc.getElementById('sc-obs').value = 'prueba';
  if(tieneDueno) doc.getElementById('sc-dueno').value = doc.getElementById('sc-dueno').options[0].value;
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  const filas = servidor.filas[tablaSanidad] || [];
  chequear('se mandó el tratamiento a ' + tablaSanidad, filas.length === 1, JSON.stringify(filas));
  if(filas.length){
    const f = filas[0];
    if(esBaseCompartida) chequear('lleva establecimiento (tabla compartida)', !!f.establecimiento);
    else chequear('NO lleva establecimiento (tabla propia, no hace falta)', f.establecimiento === undefined, JSON.stringify(f));
    chequear('lleva categoria/potrero/cantidad/producto1/dosis1', !!f.categoria && !!f.potrero && f.cantidad===70 && f.producto1==='MEXIVER' && f.dosis1===9);
    chequear('lleva un id unico', !!f.id);
    if(tieneDueno) chequear('lleva dueno (variante con dueño)', !!f.dueno);
  }
  chequear('el formulario se cierra tras guardar', doc.getElementById('form-sanidad').style.display === 'none');
  chequear('no tocó eventos_sync (no es un movimiento de potrero)', (servidor.filas.eventos_sync||[]).length === 0);

  // --- sin señal: encola, y sincronizar() la vacía ---
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  doc.getElementById('sc-cantidad').value = '5';
  doc.getElementById('sc-producto1-otro').value = 'IVOMEC';
  doc.getElementById('sc-dosis1').value = '2';
  if(tieneDueno) doc.getElementById('sc-dueno').value = doc.getElementById('sc-dueno').options[0].value;
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  chequear('sin señal queda en estado.colaSanidad', (win.__est().colaSanidad||[]).length === 1, JSON.stringify(win.__est().colaSanidad));
  chequear('sin señal todavía no llegó al servidor', (servidor.filas[tablaSanidad]||[]).length === 1);

  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  await win.sincronizar(false);
  chequear('sincronizar() vacía también la cola de sanidad', (win.__est().colaSanidad||[]).length === 0);
  chequear('y ese tratamiento llega al servidor', (servidor.filas[tablaSanidad]||[]).length === 2);

  // --- con catálogo cargado: producto1/2 se muestran como <select>, y
  // "Otro (escribir)…" vuelve a texto libre para algo que no está en el catálogo ---
  servidor.filas.productos_catalogo = [{producto:'Aftosa'},{producto:'EON', dias_retiro:122, valor_dosis_ml:0.074},{producto:'MEXIVER'}];
  doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  const selProd1 = doc.getElementById('sc-producto1');
  chequear('con catálogo, producto1 se muestra como <select>', selProd1.style.display !== 'none' && doc.getElementById('sc-producto1-otro').style.display === 'none');
  chequear('el <select> trae las opciones del catálogo + "Otro"', selProd1.options.length === 5, selProd1.innerHTML); // Elegir… + 3 productos + Otro

  selProd1.value = 'EON';
  doc.getElementById('sc-cantidad').value = '12';
  doc.getElementById('sc-dosis1').value = '3';
  if(tieneDueno) doc.getElementById('sc-dueno').value = doc.getElementById('sc-dueno').options[0].value;
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  let ultimaFila = (servidor.filas[tablaSanidad]||[]).slice(-1)[0];
  chequear('elegir un producto del catálogo manda ese valor tal cual', !!ultimaFila && ultimaFila.producto1 === 'EON', JSON.stringify(ultimaFila));

  doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  selProd1.value = '__otro__';
  selProd1.dispatchEvent(new win.Event('change', { bubbles: true }));
  chequear('elegir "Otro" muestra el texto libre', doc.getElementById('sc-producto1-otro').style.display !== 'none');
  doc.getElementById('sc-producto1-otro').value = 'Producto nuevo sin catalogar';
  doc.getElementById('sc-cantidad').value = '8';
  doc.getElementById('sc-dosis1').value = '1';
  if(tieneDueno) doc.getElementById('sc-dueno').value = doc.getElementById('sc-dueno').options[0].value;
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  ultimaFila = (servidor.filas[tablaSanidad]||[]).slice(-1)[0];
  chequear('"Otro" manda el texto libre escrito', !!ultimaFila && ultimaFila.producto1 === 'Producto nuevo sin catalogar', JSON.stringify(ultimaFila));

  if(esBaseCompartida){
    // --- "Mis cargas recientes" (P1.2, solo La Vuelta): historial local +
    // estado real segun importado_en, que llena bajar_sanidad_de_potreros.py
    // en Supabase ---
    const misCargasCont = doc.getElementById('sanidad-mis-cargas');
    chequear('div sanidad-mis-cargas presente', !!misCargasCont);
    chequear('recien cargado (sin importado_en) figura "esperando el puente"', misCargasCont.innerHTML.includes('esperando el puente'), misCargasCont.innerHTML);

    // el puente ya lo proceso: marcamos importado_en directo en el servidor
    // simulado y volvemos a abrir el modal (btn-sanidad dispara el refresco)
    ultimaFila.importado_en = new Date().toISOString();
    doc.getElementById('btn-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r=>setTimeout(r,20));
    chequear('una vez procesado por el puente figura "en la planilla"', doc.getElementById('sanidad-mis-cargas').innerHTML.includes('en la planilla'), doc.getElementById('sanidad-mis-cargas').innerHTML);

    // 12/9/2026: el EON cargado antes (cantidad 12 x dosis 3 x 0.074 = USD 2.66)
    // muestra el cálculo rotulado "Estimado" -- en La Vuelta el dato oficial
    // sigue viniendo de sanidad_ultimos vía el puente, esto es solo una previa
    // local para no esperar a que el puente corra.
    const misCargasHtml = doc.getElementById('sanidad-mis-cargas').innerHTML;
    chequear('EON en "Mis cargas" muestra el cálculo rotulado "Estimado"',
      misCargasHtml.includes('Estimado') && misCargasHtml.includes('Apto desde') && misCargasHtml.includes('Costo USD 2.66'),
      misCargasHtml);

    // sin señal: la carga nueva queda en colaSanidad y "Mis cargas" lo marca
    Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
    doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r=>setTimeout(r,20));
    // el catalogo ya quedo cacheado en localStorage por una carga anterior con
    // señal, asi que aunque ahora estemos offline el campo sigue siendo un
    // <select> -- hay que elegir "Otro" antes de escribir texto libre.
    selProd1.value = '__otro__';
    selProd1.dispatchEvent(new win.Event('change', { bubbles: true }));
    doc.getElementById('sc-cantidad').value = '3';
    doc.getElementById('sc-producto1-otro').value = 'BAYTRIL';
    doc.getElementById('sc-dosis1').value = '1';
    if(tieneDueno) doc.getElementById('sc-dueno').value = doc.getElementById('sc-dueno').options[0].value;
    doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r=>setTimeout(r,20));
    chequear('sin señal, "Mis cargas" la marca como sin señal en el dispositivo', doc.getElementById('sanidad-mis-cargas').innerHTML.includes('sin señal'), doc.getElementById('sanidad-mis-cargas').innerHTML);
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  } else {
    // --- Sin Excel (Maria Laura / Pone Chico, 10/9/2026): no hay
    // "sanidad-mis-cargas" ni tri-estado -- "sanidad-lista" lee directo de
    // la tabla propia del establecimiento, para todos los dispositivos. ---
    chequear('NO existe "sanidad-mis-cargas" (esta app no tiene puente a Excel)', !doc.getElementById('sanidad-mis-cargas'));
    await win.__cargarSanidad();
    const listaHtml = doc.getElementById('sanidad-lista').innerHTML;
    chequear('"sanidad-lista" muestra lo ya cargado, leido de ' + tablaSanidad,
      listaHtml.includes('MEXIVER') && listaHtml.includes('EON') && listaHtml.includes('Producto nuevo sin catalogar'),
      listaHtml);
    chequear('"sanidad-lista" NO usa el lenguaje de puente/planilla (no aplica sin Excel)',
      !listaHtml.includes('esperando el puente') && !listaHtml.includes('en la planilla'));

    // 12/9/2026: con dias_retiro/valor_dosis_ml en el catálogo, la tarjeta del
    // producto conocido (EON, cantidad 12 x dosis 3 x 0.074 = USD 2.66) calcula
    // "Apto desde"/costo; la del producto en texto libre (sin catálogo) no
    // muestra nada calculado -- no es un error, es degradar con gracia.
    chequear('producto del catálogo (EON) calcula "Apto desde" y costo',
      listaHtml.includes('Apto desde') && listaHtml.includes('Costo USD 2.66'), listaHtml);
    const filaLibre = listaHtml.split('Producto nuevo sin catalogar')[1] || '';
    const filaLibreCorte = filaLibre.split('potrero-card')[0];
    chequear('producto en texto libre (sin catálogo) NO calcula nada',
      !filaLibreCorte.includes('Apto desde'), filaLibreCorte);

    // sin señal: la carga nueva queda en colaSanidad y aparece en la misma
    // lista, marcada aparte, sin esperar a ningun puente.
    Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
    doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r=>setTimeout(r,20));
    selProd1.value = '__otro__';
    selProd1.dispatchEvent(new win.Event('change', { bubbles: true }));
    doc.getElementById('sc-cantidad').value = '3';
    doc.getElementById('sc-producto1-otro').value = 'BAYTRIL';
    doc.getElementById('sc-dosis1').value = '1';
    if(tieneDueno) doc.getElementById('sc-dueno').value = doc.getElementById('sc-dueno').options[0].value;
    doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r=>setTimeout(r,20));
    chequear('sin señal, "sanidad-lista" la marca como sin señal en el dispositivo',
      doc.getElementById('sanidad-lista').innerHTML.includes('sin señal'), doc.getElementById('sanidad-lista').innerHTML);
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
