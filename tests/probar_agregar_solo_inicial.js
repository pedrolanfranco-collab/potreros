/*
 * Prueba ad-hoc: "Agregar animales" pasa a servir solo como carga inicial.
 * Verifica, por archivo:
 *  A) potrero con stock -> el boton/form de "agregar" se bloquea con mensaje,
 *     no cambia nada.
 *  B) potrero vacio -> "agregar" sigue funcionando igual que antes.
 *  C) corregir un historial (prefill) sigue funcionando aunque haya stock.
 *  D) "nacimiento" nunca se bloquea, tenga o no stock el potrero.
 *  E) comando de voz: "agregar" se bloquea con stock (toast), "nacimiento" no.
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

async function levantar(archivo, opts){
  opts = opts || {};
  const html = fs.readFileSync(archivo, 'utf-8')
    .replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const toasts = [];
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
  win.alert = () => {}; win.confirm = opts.confirmFn || (() => true); win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script'))
    .map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + '\n;window.__est = function(){ return estado; };' +
      '\n;window.__vaciar = function(n){ estado.potreros[n].animales = {}; guardarEstado(); };');
    win.toast = (msg) => { toasts.push(msg); };
  }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores, toasts };
}

function llenarFormAgregar(doc, cat, cant, dueno){
  doc.getElementById('f-cat').value = cat;
  const due = doc.getElementById('f-dueno');
  if(due) due.value = dueno || due.options[0].value;
  doc.getElementById('f-cant').value = String(cant);
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win: winBase, errores: erroresBase } = await levantar(archivo);
  if(erroresBase.length){ chequear('carga sin errores', false, erroresBase[0]); return; }
  const potreros = Object.keys(winBase.__est().potreros);
  const conStock = potreros.find(p => winBase.totalPotrero(p) > 0);
  if(!conStock){ chequear('hay al menos un potrero con stock para probar el bloqueo', false, 'ningun potrero tiene animales'); return; }
  const cat = Object.keys(winBase.__est().potreros[conStock].animales)[0];

  // A) potrero con stock -> "agregar" se bloquea
  {
    const { win, errores } = await levantar(archivo);
    if(errores.length){ chequear('A: carga sin errores', false, errores[0]); return; }
    const doc = win.document;
    const totalAntes = win.totalPotrero(conStock);
    win.seleccionarPotrero(conStock);
    win.mostrarFormulario(conStock, 'agregar');
    chequear('A: no se muestra el formulario en un potrero con stock', !doc.getElementById('f-confirmar'));
    chequear('A: el mensaje de bloqueo menciona "stock inicial"', /stock inicial/.test(doc.getElementById('form-zona').innerHTML));
    chequear('A: el stock no cambio', win.totalPotrero(conStock) === totalAntes);
  }

  // B) potrero vacio -> "agregar" sigue funcionando
  let idNuevoIngreso = null;
  {
    const { win, errores } = await levantar(archivo);
    if(errores.length){ chequear('B: carga sin errores', false, errores[0]); return; }
    const doc = win.document;
    win.__vaciar(conStock);
    chequear('B: el potrero quedo vacio', win.totalPotrero(conStock) === 0);
    win.seleccionarPotrero(conStock);
    win.mostrarFormulario(conStock, 'agregar');
    chequear('B: se muestra el formulario en un potrero vacio', !!doc.getElementById('f-confirmar'));
    if(doc.getElementById('f-confirmar')){
      llenarFormAgregar(doc, cat, 5);
      doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
      chequear('B: la carga inicial se aplico', win.totalPotrero(conStock) === 5, 'quedo ' + win.totalPotrero(conStock));
      const hist = win.__est().potreros[conStock].historial;
      const entradaIngreso = hist.find(h => h.tipo === 'ingreso' && h.extra);
      chequear('B: quedo un historial de ingreso con datos para poder corregirlo despues', !!entradaIngreso);
      idNuevoIngreso = entradaIngreso ? entradaIngreso.id : null;
    }
  }

  // C) corregir (prefill) funciona aunque el potrero ya tenga stock
  {
    const { win, errores } = await levantar(archivo);
    if(errores.length){ chequear('C: carga sin errores', false, errores[0]); return; }
    const doc = win.document;
    const totalAntes = win.totalPotrero(conStock);
    const prefill = { categoria: cat, cantidad: 3, _fechaISO: '2026-01-15' };
    win.seleccionarPotrero(conStock);
    win.mostrarFormulario(conStock, 'agregar', prefill);
    chequear('C: se muestra el formulario de correccion aunque el potrero tenga stock', !!doc.getElementById('f-confirmar'));
    chequear('C: el boton dice "Guardar correccion"', /Guardar corrección/.test(doc.getElementById('form-zona').innerHTML));
    chequear('C: todavia no cambio nada (no se confirmo)', win.totalPotrero(conStock) === totalAntes);
  }

  // D) "nacimiento" nunca se bloquea
  {
    const { win, errores } = await levantar(archivo);
    if(errores.length){ chequear('D: carga sin errores', false, errores[0]); return; }
    const doc = win.document;
    win.seleccionarPotrero(conStock);
    win.mostrarFormulario(conStock, 'nacimiento');
    chequear('D: "nacimiento" se muestra igual con stock en el potrero', !!doc.getElementById('f-confirmar'));
    const opcionesCria = Array.from(doc.getElementById('f-cat').options).map(o=>o.value);
    chequear('D: la categoria de "nacimiento" solo ofrece crias (Terneros/Terneras/Corderos-as/Potros-as)',
      opcionesCria.length === 4 && ['Terneros','Terneras','Corderos/as','Potros/as'].every(c=>opcionesCria.includes(c)),
      JSON.stringify(opcionesCria));
    chequear('D: la categoria de "nacimiento" NO ofrece categorias de adultos (ej. Vacas)',
      !opcionesCria.includes('Vacas'));
  }

  // E) comando de voz: "agregar" bloqueado con stock, "nacimiento" libre
  if(typeof winBase.confirmarAccionVoz === 'function'){
    const { win, errores, toasts } = await levantar(archivo);
    if(errores.length){ chequear('E: carga sin errores', false, errores[0]); return; }
    const doc = win.document;
    const crearCampoVoz = (id, valores) => {
      valores = Array.isArray(valores) ? valores : [valores];
      const el = doc.createElement(/precio|cant/.test(id) ? 'input' : 'select');
      el.id = id;
      if(el.tagName === 'SELECT'){
        valores.forEach(v => { const op = doc.createElement('option'); op.value = v; el.appendChild(op); });
      }
      el.value = valores[0];
      doc.body.appendChild(el);
      return el;
    };
    const dueno = (typeof win.DUENOS !== 'undefined' && win.DUENOS.length) ? win.DUENOS[0] : 'Pedro';
    crearCampoVoz('vz-accion', ['agregar', 'nacimiento']);
    crearCampoVoz('vz-cat', cat);
    crearCampoVoz('vz-dueno', dueno);
    crearCampoVoz('vz-cant', '4');
    crearCampoVoz('vz-origen', conStock);
    crearCampoVoz('vz-destino', '');
    crearCampoVoz('vz-precio', '');
    const totalAntes = win.totalPotrero(conStock);
    win.confirmarAccionVoz();
    chequear('E: "agregar" por voz no cambia el stock de un potrero con animales', win.totalPotrero(conStock) === totalAntes, 'quedo ' + win.totalPotrero(conStock));
    chequear('E: se avisa por toast que "agregar" por voz es solo carga inicial', toasts.some(t => /carga inicial/.test(t)), JSON.stringify(toasts));

    doc.getElementById('vz-accion').value = 'nacimiento';
    win.confirmarAccionVoz();
    chequear('E: "nacimiento" por voz SI aplica aunque el potrero tenga stock', win.totalPotrero(conStock) === totalAntes + 4, 'quedo ' + win.totalPotrero(conStock) + ' (antes ' + totalAntes + ')');
  } else {
    console.log('  (sin confirmarAccionVoz en este archivo, se omite el caso E)');
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
