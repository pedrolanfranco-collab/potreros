/*
 * Esquila y limpieza (15/11/2026): registro de esquila o limpieza de majada en la PC y la
 * móvil completa de los campos. Solo ovinos; cada ovino es una lata y cada carnero dos.
 * No toca el stock. Se sincroniza como esquila / esquila_editada / esquila_eliminada.
 *
 * Uso (desde la raíz del repo):
 *   node tests/probar_esquila.js <apps PC y móvil completa...> [--campo <apps de Campo...>]
 *
 * Convención: lo que va antes de --campo son PC o móvil completa (tienen el botón
 * ✂️ Esquila y limpieza y el modal). Lo que va después de --campo son las apps Campo
 * ("*-movil-campo"): no tienen el botón ni el modal, así que solo se verifica que carguen
 * sin errores y que un evento esquila remoto no las rompa.
 *
 * Imprime "Todo OK" y sale con código 1 si alguna verificación falla.
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
            filas.push(Object.assign({}, obj, { id: 'row'+n, creado_en: new Date(Date.UTC(2026,0,1,12,0,n)).toISOString() }));
            return Promise.resolve({ error: null });
          },
          select(){ return q; }, eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; }, order(){ return q; },
          then(res){ const data = filas.filter(r=>q._filtros.every(f=>f(r))); return Promise.resolve(res({data, error:null})); }
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
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; }; window.__especies = function(){ return ESPECIES; };'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

const click = (win, id) => win.document.getElementById(id).dispatchEvent(new win.Event('click', {bubbles:true}));
const setv = (win, id, v, ev='input') => { const e = win.document.getElementById(id); e.value = v; e.dispatchEvent(new win.Event(ev, {bubbles:true})); };
const pausa = ms => new Promise(r=>setTimeout(r, ms));

async function probarPcMovil(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const srv = crearServidor();
  const { win, errores } = await levantar(archivo, srv);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const est = () => win.__est();
  chequear('estado.esquilas existe', Array.isArray(est().esquilas));
  const stock0 = JSON.stringify(est().potreros);

  // --- abrir el modal: solo categorías ovinas ---
  click(win, 'btn-esquila');
  chequear('modal abierto', doc.getElementById('modal-esquila').style.display === 'flex');
  const opciones = Array.from(doc.querySelector('#eq-items .eq-cat').options).map(o=>o.value);
  const ovinas = Object.keys(win.__especies().ovino);
  chequear('categorías: solo las ovinas', JSON.stringify(opciones) === JSON.stringify(ovinas), opciones.join(', '));
  chequear('primer uso: campo texto de comparsa visible', doc.getElementById('eq-maquina-otra').style.display !== 'none' && doc.getElementById('eq-maquina').value === '__otra__');

  // --- guardar una esquila: 10 ovejas + 3 carneros, vellón 12 bultos, precio 50 ---
  const fila = doc.querySelector('#eq-items .eq-item');
  fila.querySelector('.eq-cat').value = 'Ovejas'; fila.querySelector('.eq-cant').value = '10';
  fila.querySelector('.eq-cant').dispatchEvent(new win.Event('input',{bubbles:true}));
  click(win, 'eq-agregar-item');
  const f2 = doc.querySelectorAll('#eq-items .eq-item')[1];
  f2.querySelector('.eq-cat').value = 'Carneros'; f2.querySelector('.eq-cant').value = '3';
  f2.querySelector('.eq-cant').dispatchEvent(new win.Event('input',{bubbles:true}));
  doc.querySelector('#eq-lana tr[data-lana="vellon"] .eq-bultos').value = '12';
  setv(win, 'eq-precio', '50');
  chequear('resumen en vivo: 16 latas y 800', /16<\/strong> latas/.test(doc.getElementById('eq-resumen').innerHTML) && /800/.test(doc.getElementById('eq-resumen').innerHTML), doc.getElementById('eq-resumen').innerHTML);
  setv(win, 'eq-maquina-otra', '  Juan   Pérez ');
  click(win, 'eq-guardar');
  await pausa(50);
  const e0 = est().esquilas[0];
  chequear('guardada: latas 16, total 800, comparsa normalizada, UYU', !!e0 && e0.latas === 16 && e0.total === 800 && e0.maquina === 'Juan Pérez' && e0.moneda === 'UYU', JSON.stringify(e0));
  chequear('lana vellón: 12 bultos, kg null', !!e0 && e0.lana.length === 1 && e0.lana[0].tipo === 'vellon' && e0.lana[0].bultos === 12 && e0.lana[0].kg === null, JSON.stringify(e0 && e0.lana));
  const row = srv.filas.find(f=>f.tipo==='esquila');
  chequear('evento esquila con el detalle', !!row && row.detalle.latas === 16 && row.detalle.total === 800 && row.detalle.id === e0.id && row.detalle.items.length === 2, JSON.stringify(row));
  chequear('stock sin cambios', JSON.stringify(est().potreros) === stock0);
  chequear('la lista muestra el registro', /Juan Pérez/.test(doc.getElementById('esquilas-lista').innerHTML));

  // --- reabrir: comparsa preseleccionada, formulario limpio ---
  doc.getElementById('modal-esquila').style.display = 'none';
  click(win, 'btn-esquila');
  const sel = doc.getElementById('eq-maquina');
  chequear('reabrir: preselecciona Juan Pérez', sel.value === 'Juan Pérez' && doc.getElementById('eq-maquina-otra').style.display === 'none', sel.value);
  chequear('reabrir: formulario limpio', doc.getElementById('eq-precio').value === '' && doc.querySelectorAll('#eq-items .eq-item').length === 1);

  // --- validaciones: no guarda sin cantidad, ni con números que los demás equipos descartan ---
  click(win, 'eq-guardar');
  chequear('sin cantidad no guarda', est().esquilas.length === 1);
  doc.querySelector('#eq-items .eq-cant').value = '100001';
  click(win, 'eq-guardar');
  chequear('cantidad 100001 no guarda (demasiado grande)', est().esquilas.length === 1);
  doc.querySelector('#eq-items .eq-cant').value = '10';
  setv(win, 'eq-precio', '2000000000');
  click(win, 'eq-guardar');
  chequear('precio por lata 2.000.000.000 no guarda (demasiado grande)', est().esquilas.length === 1);

  // --- editar: prellena, pasa a US$ y conserva el id ---
  const idEd = e0.id;
  doc.querySelector('[data-esquila-editar="'+idEd+'"]').dispatchEvent(new win.Event('click',{bubbles:true}));
  chequear('editar: prellenado', doc.querySelectorAll('#eq-items .eq-item').length === 2 && doc.getElementById('eq-precio').value === '50' && doc.querySelector('#eq-lana tr[data-lana="vellon"] .eq-bultos').value === '12' && doc.getElementById('eq-maquina').value === 'Juan Pérez' && doc.getElementById('eq-guardar').textContent === 'Guardar corrección');
  setv(win, 'eq-moneda', 'USD', 'change'); setv(win, 'eq-precio', '3.5');
  click(win, 'eq-guardar'); await pausa(50);
  const e1 = est().esquilas.find(x=> x.id === idEd);
  chequear('editada a US$: mismo id, un solo registro, total 56', est().esquilas.length === 1 && !!e1 && e1.moneda === 'USD' && e1.precioLata === 3.5 && e1.total === 56, JSON.stringify(e1));
  const rowE = srv.filas.find(f=>f.tipo==='esquila_editada');
  chequear('evento esquila_editada con id y moneda', !!rowE && rowE.detalle.id === idEd && rowE.detalle.moneda === 'USD' && rowE.detalle.fecha === e1.fecha, JSON.stringify(rowE));
  chequear('después de editar: formulario en Registrar', doc.getElementById('eq-guardar').textContent === 'Registrar');

  // --- borrar: sale de la lista y se avisa ---
  doc.querySelector('[data-esquila-editar="'+idEd+'"]').dispatchEvent(new win.Event('click',{bubbles:true}));
  doc.querySelector('[data-esquila-borrar="'+idEd+'"]').dispatchEvent(new win.Event('click',{bubbles:true}));
  await pausa(50);
  chequear('borrar: registro fuera', est().esquilas.length === 0);
  chequear('evento esquila_eliminada', srv.filas.some(f=>f.tipo==='esquila_eliminada' && f.detalle.id === idEd));
  chequear('borrar mientras se edita: formulario en Registrar', doc.getElementById('eq-guardar').textContent === 'Registrar');

  // --- limpieza de majada ---
  click(win, 'btn-esquila');
  doc.getElementById('eq-trabajo').value = 'limpieza';
  doc.querySelector('#eq-items .eq-cat').value = 'Ovejas';
  doc.querySelector('#eq-items .eq-cant').value = '4';
  click(win, 'eq-guardar'); await pausa(50);
  chequear('limpieza guardada con trabajo limpieza', est().esquilas.length === 1 && est().esquilas[0].trabajo === 'limpieza' && est().esquilas[0].latas === 4, JSON.stringify(est().esquilas));
  chequear('evento esquila de la limpieza con trabajo limpieza', srv.filas.some(f=>f.tipo==='esquila' && f.detalle.trabajo === 'limpieza'));
  doc.getElementById('modal-esquila').style.display = 'none';

  // --- evento remoto: alta, edición, eliminación; números que no son números se descartan ---
  const remoto = (tipo, detalle, extra) => win.aplicarEventoRemoto(Object.assign({
    event_id: win.crypto.randomUUID(), tipo, potrero: 'E', fecha_cliente: '05/09/2026', dispositivo: 'otro', detalle
  }, extra || {}), {});
  remoto('esquila', {id:'rem1', trabajo:'limpieza', items:[{categoria:'Ovejas', cantidad:5}], lana:[], maquina:'Pepe "X" <b>', precioLata:null, total:null});
  const r = est().esquilas.find(x=>x.id==='rem1');
  chequear('remoto aplicado y saneado (latas 5, limpieza, sin < > ni comillas)', !!r && r.latas === 5 && r.trabajo === 'limpieza' && !/[<>"]/.test(r.maquina), JSON.stringify(r));
  remoto('esquila_editada', {id:'rem1', fecha:'06/09/2026', trabajo:'esquila', items:[{categoria:'Ovejas', cantidad:7}], lana:[], maquina:r && r.maquina, modalidad:null, precioLata:2, moneda:'USD', latas:7, total:14, obs:null});
  const r2 = est().esquilas.find(x=>x.id==='rem1');
  chequear('remoto editada: fecha, trabajo, 7 latas y US$', !!r2 && r2.fecha === '06/09/2026' && r2.trabajo === 'esquila' && r2.latas === 7 && r2.moneda === 'USD', JSON.stringify(r2));
  remoto('esquila', {id:'rem2', items:[{categoria:'Ovejas', cantidad:'abc'}]});
  chequear('remoto con cantidad NaN descartado', !est().esquilas.some(x=>x.id==='rem2'));
  remoto('esquila', {id:'rem3', items:[{categoria:'Ovejas', cantidad:500000}]});
  chequear('remoto con cantidad demasiado grande descartado', !est().esquilas.some(x=>x.id==='rem3'));
  click(win, 'btn-esquila');
  doc.querySelector('[data-esquila-editar="rem1"]').dispatchEvent(new win.Event('click',{bubbles:true}));
  chequear('editar un remoto: comparsa preseleccionada', doc.getElementById('eq-maquina').value === r2.maquina, doc.getElementById('eq-maquina').value + ' vs ' + r2.maquina);
  remoto('esquila_eliminada', {id:'rem1'});
  chequear('remoto eliminado mientras se edita', !est().esquilas.some(x=>x.id==='rem1'));
  doc.getElementById('modal-esquila').style.display = 'none';
  chequear('stock sin cambios al final', JSON.stringify(est().potreros) === stock0);
}

async function probarCampo(archivo){
  console.log('\n=== ' + archivo + ' (Campo) ===');
  const { win, errores } = await levantar(archivo, crearServidor());
  chequear('carga sin errores', errores.length === 0, errores[0]);
  chequear('sin btn-esquila ni modal', !win.document.getElementById('btn-esquila') && !win.document.getElementById('modal-esquila'));
  let error = null;
  try {
    win.aplicarEventoRemoto({event_id: win.crypto.randomUUID(), tipo:'esquila', potrero:'E', fecha_cliente:'05/09/2026', dispositivo:'o', detalle:{id:'c1', items:[{categoria:'Ovejas', cantidad:5}]}}, {});
  } catch(e){ error = e; }
  chequear('un evento esquila remoto no rompe Campo', error === null, error && error.message);
  chequear('el evento remoto queda en estado.esquilas', Array.isArray(win.__est().esquilas) && win.__est().esquilas.some(x=>x.id==='c1'));
}

(async () => {
  const argv = process.argv.slice(2);
  if(!argv.length){ console.log('Uso: node tests/probar_esquila.js <PC y móvil completa...> [--campo <apps Campo...>]'); process.exit(2); }
  const i = argv.indexOf('--campo');
  const completas = i < 0 ? argv : argv.slice(0, i);
  const campos = i < 0 ? [] : argv.slice(i + 1);
  for(const a of completas) await probarPcMovil(a);
  for(const a of campos) await probarCampo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
