/*
 * Prueba: al mover animales se pregunta primero la ESPECIE (11/11/2026).
 *  - "Mover una categoria" (accion 'mover'): f-especie (Bovino por defecto, solo las especies que hay en el potrero),
 *    filas y f-cat-destino filtrados, cambiar de especie no pierde los demas campos, solo se mueve lo que se ve.
 *  - "Mover TODO" (accion 'mover-todo'): f-especie + "Todas las especies". Una especie manda movimiento_multi
 *    (el mismo evento de "Mover una categoria"); "Todas" sigue mandando movimiento_todo. Un dispositivo remoto que
 *    aplica el evento enviado termina con el mismo stock.
 * Uso: node tests/probar_mover_especie.js archivo1.html [archivo2.html ...]
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
  win.supabase = { createClient(){ return { from(){ const q = { insert(){ return Promise.resolve({error:null}); },
    select(){ return q; }, eq(){ return q; }, gt(){ return q; }, order(){ return q; },
    then(res){ return Promise.resolve(res({data:[], error:null})); } }; return q; } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + `
    ;window.__est = function(){ return estado; };
    window.__duenos = function(){ return CONFIG.duenos; };
    window.__duenoObligatorio = CONFIG.duenoObligatorio;
    window.CATEGORIA_ESPECIE = CATEGORIA_ESPECIE;
    window.__crearPotreros = function(){
      POTREROS_GEO.push({nombre:'PX1', area:'10', coords:[[0,0],[0,1],[1,1]]});
      POTREROS_GEO.push({nombre:'PX2', area:'10', coords:[[2,2],[2,3],[3,3]]});
      estado.potreros['PX1'] = { animales:{}, historial:[], fechaIngreso:null, fechaSalida:null };
      estado.potreros['PX2'] = { animales:{}, historial:[], fechaIngreso:null, fechaSalida:null };
    };
    window.__enviados = [];
    // Pone Chico arranca sin potreros: los de prueba no tienen capa en el mapa, y seleccionarPotrero() falla al centrar el mapa
    // (despues de haber abierto el detalle); aca solo importa que el detalle quede abierto.
    const _seleccionarPotrero = seleccionarPotrero;
    seleccionarPotrero = function(n){ try{ return _seleccionarPotrero(n); }catch(e){ if(!/layer/.test(String(e && e.message))) throw e; } };
    enviarEvento = function(tipo, potrero, detalle, fecha, opciones){
      window.__enviados.push({ tipo, potrero, detalle: JSON.parse(JSON.stringify(detalle)), fecha, eventId: opciones && opciones.eventId });
      return Promise.resolve(true);
    };
  `); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const cambiar = (win, el, valor) => { el.value = valor; el.dispatchEvent(new win.Event('change', { bubbles: true })); };
const valores = sel => Array.from(sel.options).map(o => o.value);
const catsDeFilas = doc => Array.from(doc.querySelectorAll('.mov-check')).map(c => c.dataset.cat).sort();
const stock = (win, p, key) => (win.__est().potreros[p].animales[key] || 0);
function foto(win, ps){
  const o = {};
  ps.forEach(p => { o[p] = Object.entries(win.__est().potreros[p].animales).filter(([, c]) => c !== 0).sort((a, b) => a[0].localeCompare(b[0])); });
  return JSON.stringify(o);
}

/* Dos potreros del establecimiento (si no hay, los crea: Pone Chico arranca sin potreros) con un stock conocido. */
function prepararPotreros(win){
  const est = win.__est();
  let nombres = Object.keys(est.potreros);
  if(nombres.length < 2){
    win.__crearPotreros();
    nombres = ['PX1', 'PX2'];
  }
  return { p1: nombres[0], p2: nombres[1] };
}
function cargar(win, p, lista){
  win.__est().potreros[p].animales = {};
  lista.forEach(([cat, dueno, cant]) => { win.__est().potreros[p].animales[win.claveAnimal(cat, dueno)] = cant; });
}
function filaRemota(e){
  return { tipo: e.tipo, potrero: e.potrero, dispositivo: 'otro', event_id: e.eventId, fecha_cliente: e.fecha, detalle: Object.assign({ v: 'prueba' }, e.detalle) };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const A = await levantar(archivo);
  const B = await levantar(archivo);
  if(A.errores.length || B.errores.length){ chequear('carga sin errores', false, (A.errores.concat(B.errores))[0]); return; }
  const wA = A.win, wB = B.win, doc = wA.document;
  const { p1, p2 } = prepararPotreros(wA);
  prepararPotreros(wB);
  const duenos = wA.__duenos();
  const du1 = duenos[0] === undefined ? '' : duenos[0];
  const du2 = duenos.length > 1 ? duenos[1] : du1;
  const mixto = [['Vacas', du1, 10], ['Novillos 2-3 años', du2, 4], ['Ovejas', du1, 7], ['Corderos/as', du2, 3]];
  const preparar = () => { [wA, wB].forEach(w => { cargar(w, p1, mixto); cargar(w, p2, []); w.__enviados.length = 0; }); };
  const claveVacas = wA.claveAnimal('Vacas', du1), claveNov = wA.claveAnimal('Novillos 2-3 años', du2);
  const claveOvejas = wA.claveAnimal('Ovejas', du1), claveCord = wA.claveAnimal('Corderos/as', du2);
  const aplicarEnB = () => { wA.__enviados.forEach(e => wB.aplicarEventoRemoto(filaRemota(e))); };

  // ---- Mover una categoria ----
  preparar();
  wA.seleccionarPotrero(p1);
  wA.mostrarFormulario(p1, 'mover');
  const esp = doc.getElementById('f-especie');
  chequear('Mover: existe el desplegable f-especie', !!esp);
  if(!esp) return;
  chequear('Mover: solo las especies que hay en el potrero (bovino, ovino)', valores(esp).join() === 'bovino,ovino', valores(esp).join());
  chequear('Mover: por defecto Bovino', esp.value === 'bovino', esp.value);
  chequear('Mover: solo filas de bovinos', catsDeFilas(doc).join() === ['Novillos 2-3 años', 'Vacas'].join(), catsDeFilas(doc).join());
  const catsDestino = valores(doc.getElementById('f-cat-destino')).filter(v => v);
  chequear('Mover: f-cat-destino solo con categorias bovinas',
    catsDestino.includes('Vacas') && !catsDestino.includes('Ovejas') && catsDestino.every(c => wA.CATEGORIA_ESPECIE[c] === 'bovino'), catsDestino.join());
  chequear('Mover: f-cat-destino conserva la opcion de mantener la categoria', valores(doc.getElementById('f-cat-destino'))[0] === '');

  doc.getElementById('f-destino').value = p2;
  doc.getElementById('f-fecha').value = wA.fechaISOHoy();
  doc.getElementById('f-obs').value = 'nota de prueba';
  const sd = doc.getElementById('f-dueno-destino');
  const duenoElegido = valores(sd).find(v => v !== '__mantener__');
  if(duenoElegido !== undefined) sd.value = duenoElegido;
  cambiar(wA, doc.getElementById('f-especie'), 'ovino');
  chequear('Mover: cambiar a Ovino vuelve a pintar solo ovinos', catsDeFilas(doc).join() === ['Corderos/as', 'Ovejas'].join(), catsDeFilas(doc).join());
  const catsOv = valores(doc.getElementById('f-cat-destino')).filter(v => v);
  chequear('Mover: f-cat-destino pasa a categorias ovinas', catsOv.includes('Ovejas') && catsOv.every(c => wA.CATEGORIA_ESPECIE[c] === 'ovino'), catsOv.join());
  chequear('Mover: cambiar de especie no pierde destino, fecha, notas ni dueno destino',
    doc.getElementById('f-destino').value === p2 && doc.getElementById('f-fecha').value === wA.fechaISOHoy()
      && doc.getElementById('f-obs').value === 'nota de prueba' && (duenoElegido === undefined || sd.value === duenoElegido),
    doc.getElementById('f-destino').value + '/' + doc.getElementById('f-obs').value);

  // confirmar con Bovino mientras los ovinos siguen en el potrero: solo se mueve lo que se ve
  cambiar(wA, doc.getElementById('f-especie'), 'bovino');
  // confirmar como lo hace el usuario: formulario nuevo y SIN tocar "Dueno destino" (tiene que quedar en "mantener")
  wA.mostrarFormulario(p1, 'mover');
  chequear('Mover: "Dueno destino" abre en "mantener el dueno de cada una"', doc.getElementById('f-dueno-destino').value === '__mantener__', doc.getElementById('f-dueno-destino').value);
  doc.getElementById('f-destino').value = p2;
  doc.getElementById('f-fecha').value = wA.fechaISOHoy();
  cambiar(wA, doc.getElementById('f-especie'), 'bovino');
  click(wA, doc.getElementById('f-confirmar'));
  chequear('Mover: sale UN movimiento_multi', wA.__enviados.length === 1 && wA.__enviados[0].tipo === 'movimiento_multi', JSON.stringify(wA.__enviados.map(e => e.tipo)));
  const ev = wA.__enviados[0] || { detalle: { items: [] } };
  chequear('Mover: el evento lleva solo bovinos, con su dueno',
    ev.detalle.items.length === 2 && ev.detalle.items.every(i => wA.CATEGORIA_ESPECIE[i.categoria] === 'bovino')
      && ev.detalle.items.some(i => i.categoria === 'Vacas' && i.dueno === du1 && i.cantidad === 10)
      && ev.detalle.items.some(i => i.categoria === 'Novillos 2-3 años' && i.dueno === du2 && i.cantidad === 4), JSON.stringify(ev.detalle));
  chequear('Mover: los ovinos siguen en el origen', stock(wA, p1, claveOvejas) === 7 && stock(wA, p1, claveCord) === 3 && stock(wA, p2, claveOvejas) === 0);
  chequear('Mover: los bovinos llegaron al destino con su dueno',
    stock(wA, p2, claveVacas) === 10 && stock(wA, p2, claveNov) === 4 && stock(wA, p1, claveVacas) === 0 && stock(wA, p1, claveNov) === 0);
  aplicarEnB();
  chequear('Mover: un dispositivo remoto queda con el mismo stock', foto(wA, [p1, p2]) === foto(wB, [p1, p2]), foto(wA, [p1, p2]) + ' vs ' + foto(wB, [p1, p2]));

  // "Dueno destino": sin tocarlo se conserva la firma de cada animal (en La Vuelta, con "sin asignar" marcado de mas, se vaciaba)
  {
    preparar();
    wA.seleccionarPotrero(p1);
    wA.mostrarFormulario(p1, 'mover');
    doc.getElementById('f-destino').value = p2;
    chequear('Dueno destino: abre en "mantener el dueno de cada una"', doc.getElementById('f-dueno-destino').value === '__mantener__', doc.getElementById('f-dueno-destino').value);
    click(wA, doc.getElementById('f-confirmar'));
    const evD = wA.__enviados[0] || { detalle: { items: [] } };
    chequear('Dueno destino: sin tocarlo, el evento no lleva duenoDestino y la firma se conserva',
      evD.detalle.items.length === 2 && evD.detalle.items.every(i => i.duenoDestino === undefined) && stock(wA, p2, claveVacas) === 10 && stock(wA, p2, claveNov) === 4, JSON.stringify(evD.detalle) + ' | ' + foto(wA, [p1, p2]));
    // "sin asignar" elegido a proposito (solo existe donde el dueno no es obligatorio) si vacia la firma
    preparar();
    wA.seleccionarPotrero(p1);
    wA.mostrarFormulario(p1, 'mover');
    const sdd = doc.getElementById('f-dueno-destino');
    if(wA.__duenoObligatorio){
      chequear('Dueno destino: con dueno obligatorio no existe "sin asignar"', !valores(sdd).includes(''), valores(sdd).join());
    } else {
      chequear('Dueno destino: donde el dueno es opcional existe "sin asignar"', valores(sdd).includes(''), valores(sdd).join());
      sdd.value = '';
      doc.getElementById('f-destino').value = p2;
      click(wA, doc.getElementById('f-confirmar'));
      const evS = wA.__enviados[0] || { detalle: { items: [] } };
      chequear('Dueno destino: elegir "sin asignar" a proposito si vacia la firma',
        evS.detalle.items.length === 2 && evS.detalle.items.every(i => i.duenoDestino === '') && stock(wA, p2, wA.claveAnimal('Vacas', '')) === 10 && stock(wA, p2, claveVacas) === (du1 === '' ? 10 : 0), JSON.stringify(evS.detalle));
    }
  }

  // editar el movimiento en la PC (solo existe ahi): abre el formulario en la especie del movimiento
  if(typeof wA.editarHistorial === 'function'){
    preparar();
    wA.seleccionarPotrero(p1);
    wA.mostrarFormulario(p1, 'mover');
    cambiar(wA, doc.getElementById('f-especie'), 'ovino');
    doc.getElementById('f-destino').value = p2;
    click(wA, doc.getElementById('f-confirmar'));
    const h = wA.__est().potreros[p1].historial.find(x => x.tipo === 'movimiento_multi' && !x.eliminado);
    chequear('Editar: el movimiento de ovinos quedo en el historial', !!h);
    if(h){
      wA.editarHistorial(h.id);
      const e2 = doc.getElementById('f-especie');
      chequear('Editar: el formulario abre en la especie del movimiento (Ovino), no en Bovino', !!e2 && e2.value === 'ovino', e2 && e2.value);
      chequear('Editar: las filas son las ovinas', catsDeFilas(doc).join() === ['Corderos/as', 'Ovejas'].join(), catsDeFilas(doc).join());
    }
  }

  // editar en la PC un movimiento que mezcla especies (Vacas + Ovejas): confirmar sin tocar nada deja todo igual y no pierde ninguna
  if(/-pc[\\/]/.test(archivo) && typeof wA.editarHistorial === 'function'){
    const filasMixtas = [{key: claveVacas, cat: 'Vacas', dueno: du1, cant: 10}, {key: claveOvejas, cat: 'Ovejas', dueno: du1, cant: 7}];
    const optsMov = {catDestinoCompartida: '', huboEleccionDueno: false, duenoDestinoSel: '__mantener__', fechaISO: wA.fechaISOHoy(), obs: ''};
    const editarMixto = (w, etiqueta) => {
      const d = w.document;
      const antes = foto(w, [p1, p2]);
      const h = w.__est().potreros[p1].historial.filter(x => x.tipo === 'movimiento_multi' && !x.eliminado && (x.extra || x.origDatos) && ((x.extra || x.origDatos).items || []).some(i => i.categoria === 'Ovejas') && ((x.extra || x.origDatos).items || []).some(i => i.categoria === 'Vacas'))[0];
      chequear(etiqueta + ': el movimiento mixto esta en el historial', !!h);
      if(!h) return;
      w.__enviados.length = 0;
      w.editarHistorial(h.id);
      const e2 = d.getElementById('f-especie');
      chequear(etiqueta + ': abre en "Varias especies", lista todo el potrero y deja tildadas solo Vacas y Ovejas', !!e2 && e2.value === '' && catsDeFilas(d).length === 4 && Array.from(d.querySelectorAll('.mov-check')).filter(c => c.checked).map(c => c.dataset.cat).sort().join() === ['Ovejas', 'Vacas'].join(), (e2 && e2.value) + ' | ' + catsDeFilas(d).join());
      chequear(etiqueta + ': "Varias especies" ofrece todas las categorias destino', valores(d.getElementById('f-cat-destino')).includes('Vacas') && valores(d.getElementById('f-cat-destino')).includes('Ovejas'), valores(d.getElementById('f-cat-destino')).join());
      click(w, d.getElementById('f-confirmar'));
      chequear(etiqueta + ': confirmar sin tocar nada deja el mismo stock (no se pierde ninguna especie)', foto(w, [p1, p2]) === antes, antes + ' vs ' + foto(w, [p1, p2]));
      const mm = w.__enviados.filter(e => e.tipo === 'movimiento_multi');
      chequear(etiqueta + ': se vuelve a mandar un movimiento con Vacas y Ovejas, sin dueno destino', mm.length === 1 && mm[0].detalle.items.length === 2
        && mm[0].detalle.items.some(i => i.categoria === 'Vacas' && i.cantidad === 10) && mm[0].detalle.items.some(i => i.categoria === 'Ovejas' && i.cantidad === 7)
        && mm[0].detalle.items.every(i => i.duenoDestino === undefined), JSON.stringify(mm.map(e => e.detalle)));
    };
    // movimiento cargado en este equipo
    preparar();
    wA.aplicarMovimientoMulti(p1, p2, filasMixtas, optsMov);
    editarMixto(wA, 'Editar mixto (local)');
    // movimiento que llego sincronizado de otro equipo
    preparar();
    wA.aplicarMovimientoMulti(p1, p2, filasMixtas, optsMov);
    aplicarEnB();
    wB.__enviados.length = 0;
    editarMixto(wB, 'Editar mixto (remoto)');
  }

  // potrero con solo ovinos: abre en Ovino
  [wA, wB].forEach(w => { cargar(w, p1, [['Ovejas', du1, 5]]); w.__enviados.length = 0; });
  wA.seleccionarPotrero(p1);
  wA.mostrarFormulario(p1, 'mover');
  chequear('Mover: un potrero con solo ovinos abre en Ovino', doc.getElementById('f-especie').value === 'ovino' && valores(doc.getElementById('f-especie')).join() === 'ovino',
    doc.getElementById('f-especie').value);

  // categoria desconocida: no queda sin poder moverse
  [wA, wB].forEach(w => { cargar(w, p1, [['Raro', du1, 3], ['Vacas', du1, 2]]); cargar(w, p2, []); w.__enviados.length = 0; });
  wA.seleccionarPotrero(p1);
  wA.mostrarFormulario(p1, 'mover');
  chequear('Mover: una categoria desconocida aparece como "otras"', valores(doc.getElementById('f-especie')).join() === 'bovino,otras', valores(doc.getElementById('f-especie')).join());
  cambiar(wA, doc.getElementById('f-especie'), 'otras');
  chequear('Mover: "otras" ofrece todas las categorias como destino (para recategorizar una desconocida)', valores(doc.getElementById('f-cat-destino')).includes('Vacas') && valores(doc.getElementById('f-cat-destino')).includes('Ovejas'), valores(doc.getElementById('f-cat-destino')).join());
  chequear('Mover: "otras" lista la categoria desconocida', catsDeFilas(doc).join() === 'Raro', catsDeFilas(doc).join());
  doc.getElementById('f-destino').value = p2;
  click(wA, doc.getElementById('f-confirmar'));
  chequear('Mover: la categoria desconocida se pudo mover', stock(wA, p2, wA.claveAnimal('Raro', du1)) === 3 && stock(wA, p1, wA.claveAnimal('Vacas', du1)) === 2);
  // recategorizar una categoria desconocida en una real (se podia antes de elegir especie)
  [wA, wB].forEach(w => { cargar(w, p1, [['Raro', du1, 3], ['Vacas', du1, 2]]); cargar(w, p2, []); w.__enviados.length = 0; });
  wA.seleccionarPotrero(p1);
  wA.mostrarFormulario(p1, 'mover');
  cambiar(wA, doc.getElementById('f-especie'), 'otras');
  cambiar(wA, doc.getElementById('f-cat-destino'), 'Vacas');
  doc.getElementById('f-destino').value = p2;
  click(wA, doc.getElementById('f-confirmar'));
  chequear('Mover: una categoria desconocida se recategoriza en una real', stock(wA, p2, wA.claveAnimal('Vacas', du1)) === 3 && stock(wA, p2, wA.claveAnimal('Raro', du1)) === 0 && stock(wA, p1, wA.claveAnimal('Vacas', du1)) === 2, foto(wA, [p1, p2]));

  // ---- Mover TODO ----
  preparar();
  wA.seleccionarPotrero(p1);
  wA.mostrarFormulario(p1, 'mover-todo');
  const e3 = doc.getElementById('f-especie');
  chequear('Todo: existe f-especie con las especies presentes y "Todas las especies"', !!e3 && valores(e3).join() === 'bovino,ovino,todas', e3 && valores(e3).join());
  if(!e3) return;
  chequear('Todo: por defecto Bovino', e3.value === 'bovino', e3.value);
  chequear('Todo: el boton y el resumen dicen que se mueven los bovinos',
    /bovinos/i.test(doc.getElementById('f-confirmar').textContent) && /bovinos/i.test(doc.getElementById('f-todo-resumen').textContent),
    doc.getElementById('f-confirmar').textContent + ' | ' + (doc.getElementById('f-todo-resumen') || {}).textContent);
  cambiar(wA, e3, 'todas');
  chequear('Todo: "Todas las especies" dice "Mover todo (24)"', doc.getElementById('f-confirmar').textContent.trim() === 'Mover todo (24)', doc.getElementById('f-confirmar').textContent);
  cambiar(wA, e3, 'bovino');
  doc.getElementById('f-destino').value = p2;
  click(wA, doc.getElementById('f-confirmar'));
  chequear('Todo (bovinos): manda movimiento_multi y no movimiento_todo', wA.__enviados.length === 1 && wA.__enviados[0].tipo === 'movimiento_multi', JSON.stringify(wA.__enviados.map(e => e.tipo)));
  const ev3 = wA.__enviados[0] || { detalle: { items: [] } };
  chequear('Todo (bovinos): items con categoria, dueno y cantidad, sin otra especie',
    ev3.detalle.items.length === 2 && ev3.detalle.items.every(i => i.categoria === i.categoriaDestino && wA.CATEGORIA_ESPECIE[i.categoria] === 'bovino'), JSON.stringify(ev3.detalle));
  chequear('Todo (bovinos): los ovinos quedan en el origen', stock(wA, p1, claveOvejas) === 7 && stock(wA, p1, claveCord) === 3 && stock(wA, p2, claveOvejas) === 0);
  chequear('Todo (bovinos): los bovinos pasan con su dueno',
    stock(wA, p2, claveVacas) === 10 && stock(wA, p2, claveNov) === 4 && stock(wA, p1, claveVacas) === 0 && stock(wA, p1, claveNov) === 0);
  chequear('Todo (bovinos): deja renglones de historial en origen y destino con el mismo eventId',
    wA.__est().potreros[p1].historial.some(h => h.tipo === 'movimiento_multi' && h.eventId === ev3.eventId)
      && wA.__est().potreros[p2].historial.some(h => h.tipo === 'movimiento_multi' && h.eventId === ev3.eventId));
  aplicarEnB();
  chequear('Todo (bovinos): un dispositivo remoto queda con el mismo stock', foto(wA, [p1, p2]) === foto(wB, [p1, p2]), foto(wA, [p1, p2]) + ' vs ' + foto(wB, [p1, p2]));

  preparar();
  wA.seleccionarPotrero(p1);
  wA.mostrarFormulario(p1, 'mover-todo');
  cambiar(wA, doc.getElementById('f-especie'), 'todas');
  doc.getElementById('f-destino').value = p2;
  click(wA, doc.getElementById('f-confirmar'));
  chequear('Todo (todas): sigue mandando movimiento_todo', wA.__enviados.length === 1 && wA.__enviados[0].tipo === 'movimiento_todo', JSON.stringify(wA.__enviados.map(e => e.tipo)));
  chequear('Todo (todas): vacia el potrero y lo pasa entero', wA.totalPotrero(p1) === 0 && wA.totalPotrero(p2) === 24);
  aplicarEnB();
  chequear('Todo (todas): un dispositivo remoto queda con el mismo stock', foto(wA, [p1, p2]) === foto(wB, [p1, p2]));

  // una sola especie presente: el comportamiento de siempre (movimiento_todo)
  [wA, wB].forEach(w => { cargar(w, p1, [['Vacas', du1, 6], ['Novillos 2-3 años', du2, 2]]); cargar(w, p2, []); w.__enviados.length = 0; });
  wA.seleccionarPotrero(p1);
  wA.mostrarFormulario(p1, 'mover-todo');
  chequear('Todo: con una sola especie presente el valor inicial es "Todas" (como siempre)', doc.getElementById('f-especie').value === 'todas', doc.getElementById('f-especie').value);
  chequear('Todo: con una sola especie el boton dice "Mover todo (8)"', doc.getElementById('f-confirmar').textContent.trim() === 'Mover todo (8)', doc.getElementById('f-confirmar').textContent);
  doc.getElementById('f-destino').value = p2;
  click(wA, doc.getElementById('f-confirmar'));
  chequear('Todo: con una sola especie manda movimiento_todo', wA.__enviados.length === 1 && wA.__enviados[0].tipo === 'movimiento_todo', JSON.stringify(wA.__enviados.map(e => e.tipo)));
  aplicarEnB();
  chequear('Todo: con una sola especie el remoto queda igual', foto(wA, [p1, p2]) === foto(wB, [p1, p2]));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
