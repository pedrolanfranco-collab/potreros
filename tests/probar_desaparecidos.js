/*
 * Prueba del estado nuevo "❓ Desaparecido": un animal que sale del potrero
 * sin que se sepa dónde está (cruzó a campo de un vecino, etc.) resta del
 * stock al toque, queda como un caso abierto (sin ningún array de estado
 * nuevo -- se calcula leyendo el historial, listarCasosDesaparecidos), y se
 * resuelve total o parcialmente con "✅ Encontrado" (vuelve como stock al
 * potrero que el usuario elija, no necesariamente el de origen) o
 * "❌ Dar por perdido" (cierra el caso sin sumar nada de vuelta, como
 * "Pérdida", una baja separada de "Muerte").
 *
 * El punto más delicado es que "Encontrado"/"Pérdida" tienen que poder
 * referenciar el caso original desde CUALQUIER dispositivo, incluido uno
 * que reconstruye todo desde cero replicando los eventos de Supabase --
 * por eso "desaparecido" manda un casoId explícito (el id local de su
 * propia entrada de historial) que aplicarEventoRemoto usa como id fijo en
 * vez de dejar que se autogenere (mismo problema, y misma solución, que la
 * lección de historialId no determinista documentada en la memoria del
 * proyecto para la corrección del 9/9/2026).
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
  try{
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__mostrarFormulario = function(n,a,p){ seleccionarPotrero(n); return mostrarFormulario(n,a,p); };' +
      '\n;window.__seleccionar = function(n){ return seleccionarPotrero(n); };' +
      '\n;window.__listarCasos = function(){ return listarCasosDesaparecidos(); };' +
      '\n;window.__aplicarRemoto = function(row){ return aplicarEventoRemoto(row); };' +
      '\n;window.__borrarHistorial = function(id){ return borrarHistorial(id); };' +
      '\n;window.__renderDesaparecidos = function(){ return renderDesaparecidosLista(); };' +
      '\n;window.__abrirEncontrado = function(caso){ return abrirFormularioEncontrado(caso); };' +
      '\n;window.__potrerosGeo = POTREROS_GEO;' +
      '\n;window.__dibujarPotrero = function(p){ return dibujarPotrero(p); };');
  }catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo, tieneDueno){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  // Pone Chico arranca sin potreros -- sembrar dos sintéticos, mismo patrón
  // ya usado en probar_sanidad_carga.js.
  if(Object.keys(win.__est().potreros).length < 2){
    const geoA = {nombre:'TEST_A', area:null, coords:[[-31.98,-56.34],[-31.981,-56.34],[-31.981,-56.341]]};
    const geoB = {nombre:'TEST_B', area:null, coords:[[-31.97,-56.34],[-31.971,-56.34],[-31.971,-56.341]]};
    win.__potrerosGeo.push(geoA, geoB);
    win.__est().potreros['TEST_A'] = {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null};
    win.__est().potreros['TEST_B'] = {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null};
    win.__dibujarPotrero(geoA);
    win.__dibujarPotrero(geoB);
  }

  const est = win.__est();
  const nombres = Object.keys(est.potreros);
  const origen = nombres[0], destino = nombres[1];
  const categoria = 'Vaquillonas 1-2 años';
  const key = tieneDueno ? categoria + '||Pedro' : categoria;

  // Estado conocido: 3 Vaquillonas en el origen, nada en el destino.
  [origen, destino].forEach(n => Object.keys(est.potreros[n].animales).forEach(k => est.potreros[n].animales[k]=0));
  est.potreros[origen].animales[key] = 3;

  // 1) Registrar la desaparición de las 3.
  win.__mostrarFormulario(origen, 'desaparecido');
  doc.getElementById('f-cat').value = categoria;
  if(tieneDueno) doc.getElementById('f-dueno').value = 'Pedro';
  doc.getElementById('f-cant').value = '3';
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));

  chequear('desaparecido: resta del potrero de origen', (est.potreros[origen].animales[key]||0)===0,
    JSON.stringify(est.potreros[origen].animales));
  const entradaDesap = est.potreros[origen].historial.find(h=>h.tipo==='desaparecido' && !h.eliminado);
  chequear('desaparecido: queda una entrada de historial con los datos completos', !!entradaDesap && !!entradaDesap.extra);

  let casos = win.__listarCasos();
  chequear('el caso aparece en listarCasosDesaparecidos()', casos.length===1 && casos[0].pendiente===3,
    JSON.stringify(casos));

  // 2) Resolver 1 de las 3, devuelto a un potrero DISTINTO del de origen
  //    (Pedro pidió poder elegir, no que vuelva siempre al mismo).
  win.__renderDesaparecidos();
  win.__abrirEncontrado(casos[0]);
  doc.getElementById('fe-cant').value = '1';
  doc.getElementById('fe-potrero').value = destino;
  doc.getElementById('fe-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));

  chequear('encontrado: suma 1 al potrero elegido (no al de origen)', (est.potreros[destino].animales[key]||0)===1,
    JSON.stringify(est.potreros[destino].animales));
  chequear('encontrado: el potrero de origen sigue sin esa categoría', (est.potreros[origen].animales[key]||0)===0);

  casos = win.__listarCasos();
  chequear('el caso sigue abierto con 2 pendientes', casos.length===1 && casos[0].pendiente===2,
    JSON.stringify(casos));

  // 3) Dar por perdido lo que queda pendiente (2).
  win.__renderDesaparecidos();
  const btnPerdido = doc.querySelector('[data-perdido]');
  chequear('el botón "Dar por perdido" está presente', !!btnPerdido);
  btnPerdido.dispatchEvent(new win.Event('click', { bubbles: true }));

  casos = win.__listarCasos();
  chequear('el caso se cierra del todo (0 pendientes, no aparece más)', casos.length===0, JSON.stringify(casos));
  const entradaPerdida = est.potreros[origen].historial.find(h=>h.tipo==='perdida' && !h.eliminado);
  chequear('queda una entrada de historial "perdida" por las 2 restantes',
    !!entradaPerdida && /2/.test(entradaPerdida.detalle), entradaPerdida && entradaPerdida.detalle);
  chequear('"perdida" no volvió a tocar el stock de ningún potrero',
    (est.potreros[origen].animales[key]||0)===0 && (est.potreros[destino].animales[key]||0)===1);

  // 4) Un dispositivo que reconstruye todo desde cero, recibiendo los 3
  //    eventos en el mismo orden, tiene que llegar exactamente al mismo
  //    resultado -- confirma que el casoId explícito viaja bien y el caso
  //    no depende de ids autogenerados en cada reconstrucción.
  [origen, destino].forEach(n => { est.potreros[n].animales = {}; est.potreros[n].historial = []; });
  const dueno = tieneDueno ? 'Pedro' : null;
  win.__aplicarRemoto({ tipo:'desaparecido', potrero: origen, fecha_cliente:'01/09/2026',
    detalle:{ categoria, dueno, cantidad:3, casoId:'caso_test_1' } });
  win.__aplicarRemoto({ tipo:'encontrado', potrero: destino, fecha_cliente:'02/09/2026',
    detalle:{ categoria, dueno, cantidad:1, casoId:'caso_test_1' } });
  win.__aplicarRemoto({ tipo:'perdida', potrero: origen, fecha_cliente:'03/09/2026',
    detalle:{ categoria, dueno, cantidad:2, casoId:'caso_test_1' } });

  chequear('sincronizado: el origen quedó en 0 (se restaron las 3 al desaparecer)', (est.potreros[origen].animales[key]||0)===0);
  chequear('sincronizado: el destino recibió la 1 encontrada', (est.potreros[destino].animales[key]||0)===1);
  chequear('sincronizado: el caso quedó resuelto igual que en el dispositivo de origen', win.__listarCasos().length===0,
    JSON.stringify(win.__listarCasos()));

  // 5) Borrar una desaparición SIN resoluciones previas devuelve el stock
  //    (mecanismo genérico de construirAjusteInverso, ya extendido).
  [origen, destino].forEach(n => { est.potreros[n].animales = {}; est.potreros[n].historial = []; });
  est.potreros[origen].animales[key] = 5;
  win.__mostrarFormulario(origen, 'desaparecido');
  doc.getElementById('f-cat').value = categoria;
  if(tieneDueno) doc.getElementById('f-dueno').value = 'Pedro';
  doc.getElementById('f-cant').value = '5';
  doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('setup: quedaron 0 antes de borrar', (est.potreros[origen].animales[key]||0)===0);
  const entradaABorrar = est.potreros[origen].historial.find(h=>h.tipo==='desaparecido' && !h.eliminado);
  win.__borrarHistorial(entradaABorrar.id);
  chequear('borrar una desaparición sin resolver devuelve el stock completo', (est.potreros[origen].animales[key]||0)===5,
    JSON.stringify(est.potreros[origen].animales));
  chequear('el caso ya no figura como pendiente tras borrarlo', win.__listarCasos().length===0);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a, /maria[_-]laura|pone[_-]chico/.test(a));
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
