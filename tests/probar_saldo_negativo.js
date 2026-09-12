/*
 * Prueba ad-hoc: mover mas animales de los que hay en el potrero de origen.
 * Verifica: 1) sin confirmar no cambia nada, 2) confirmando queda saldo
 * negativo y ese saldo se pinta de rojo en la lista y en el detalle.
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

async function levantar(archivo, confirmFn){
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
  win.alert = () => {}; win.confirm = confirmFn; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script'))
    .map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; };' +
    '\n;window.__vaciar = function(n){ estado.potreros[n].animales = {}; guardarEstado(); };'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');

  // Caso 1: se sobrepasa el disponible y NO se confirma -> no cambia nada
  {
    const { win, errores } = await levantar(archivo, () => false);
    const doc = win.document;
    if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
    const est = () => win.__est();
    const potreros = Object.keys(est().potreros);
    const p1 = potreros[0], p2 = potreros[1];
    win.seleccionarPotrero(p1);
    win.__vaciar(p1);
    win.mostrarFormulario(p1, 'agregar');
    const fila = doc.querySelector('.agregar-fila');
    const cat = fila.querySelector('.ag-cat').options[0].value;
    fila.querySelector('.ag-cat').value = cat;
    const due = fila.querySelector('.ag-dueno');
    if(due) due.value = due.options[0].value;
    fila.querySelector('.ag-cant').value = '5';
    doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
    const disponibles = win.totalPotrero(p1);

    win.mostrarFormulario(p1, 'mover');
    const movCheck = doc.querySelector('.mov-check');
    movCheck.checked = true;
    const sel = movCheck.dataset.key ? `[data-key="${movCheck.dataset.key}"]` : `[data-cat="${movCheck.dataset.cat}"]`;
    doc.querySelector('.mov-cant' + sel).value = String(disponibles + 20);
    doc.getElementById('f-destino').value = p2;
    doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('cancelando el aviso no cambia el saldo del origen',
      win.totalPotrero(p1) === disponibles, 'quedo ' + win.totalPotrero(p1));
  }

  // Caso 2: se sobrepasa el disponible y SI se confirma -> queda negativo y en rojo
  {
    const { win, errores } = await levantar(archivo, () => true);
    const doc = win.document;
    if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
    const est = () => win.__est();
    const potreros = Object.keys(est().potreros);
    const p1 = potreros[0], p2 = potreros[1];
    win.seleccionarPotrero(p1);
    win.__vaciar(p1);
    win.mostrarFormulario(p1, 'agregar');
    const fila = doc.querySelector('.agregar-fila');
    const cat = fila.querySelector('.ag-cat').options[0].value;
    fila.querySelector('.ag-cat').value = cat;
    const due = fila.querySelector('.ag-dueno');
    if(due) due.value = due.options[0].value;
    fila.querySelector('.ag-cant').value = '5';
    doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));
    const disponibles = win.totalPotrero(p1);
    const exceso = disponibles + 20;

    win.mostrarFormulario(p1, 'mover');
    const movCheck = doc.querySelector('.mov-check');
    movCheck.checked = true;
    const sel = movCheck.dataset.key ? `[data-key="${movCheck.dataset.key}"]` : `[data-cat="${movCheck.dataset.cat}"]`;
    doc.querySelector('.mov-cant' + sel).value = String(exceso);
    doc.getElementById('f-destino').value = p2;
    doc.getElementById('f-confirmar').dispatchEvent(new win.Event('click', { bubbles: true }));

    const saldoEsperado = disponibles - exceso;
    chequear('confirmando el aviso deja el saldo en negativo',
      win.totalPotrero(p1) === saldoEsperado, 'quedo ' + win.totalPotrero(p1));

    win.seleccionarPotrero(p1);
    const htmlLista = doc.getElementById('lista-potreros').innerHTML;
    const htmlDetalle = (doc.getElementById('detalle-caja') || doc.getElementById('detalle')).innerHTML;
    chequear('el saldo negativo aparece pintado de rojo en algun lado',
      /#d32f2f/.test(htmlLista) || /#d32f2f/.test(htmlDetalle));
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
