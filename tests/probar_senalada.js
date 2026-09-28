/*
 * Prueba ad-hoc: registro de Señalada en Herramientas (28/9/2026).
 * Mismo patrón que "🌧 Lluvias"/"🐄 Abortos" (probar_abortos.js): evento del
 * establecimiento entero, sin potrero, aplicado en aplicarEventoRemoto ANTES
 * del guard que exige un potrero válido. No toca stock (los corderos ya se
 * contaron al nacer, si se cargó ese nacimiento) -- solo entra al % de
 * señalada sobre ovejas encarneradas (ver calcularEstadisticasNacimientos,
 * probado aparte en probar_stock_total.js).
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
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; };'); }
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

  chequear('estado.senaladas arranca vacío', Array.isArray(win.__est().senaladas) && win.__est().senaladas.length===0);
  chequear('boton btn-lluvias presente (Señalada vive en el mismo modal)', !!doc.getElementById('btn-lluvias'));
  chequear('campo sn-machos presente', !!doc.getElementById('sn-machos'));
  chequear('campo sn-hembras presente', !!doc.getElementById('sn-hembras'));
  chequear('boton sn-guardar presente', !!doc.getElementById('sn-guardar'));

  // --- cargar una señalada local, machos y hembras ---
  doc.getElementById('btn-lluvias').dispatchEvent(new win.Event('click', { bubbles: true }));
  doc.getElementById('sn-machos').value = '12';
  doc.getElementById('sn-hembras').value = '9';
  doc.getElementById('sn-obs').value = 'Potrero 5';
  doc.getElementById('sn-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  const senaladas = win.__est().senaladas;
  chequear('la señalada queda en estado.senaladas con machos y hembras',
    senaladas.length === 1 && senaladas[0].machos === 12 && senaladas[0].hembras === 9 && senaladas[0].obs === 'Potrero 5',
    JSON.stringify(senaladas));
  chequear('la lista se re-renderiza con la carga',
    /12 macho \/ 9 hembra/.test(doc.getElementById('senaladas-lista').innerHTML));

  await new Promise(r=>setTimeout(r, 30));
  chequear('se mandó como evento a Supabase con tipo senalada',
    servidor.filas.some(f=>f.tipo==='senalada' && f.detalle && f.detalle.machos===12 && f.detalle.hembras===9));

  // --- validación: sin fecha no carga nada ---
  const antes = win.__est().senaladas.length;
  doc.getElementById('sn-fecha').value = '';
  doc.getElementById('sn-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('sin fecha no carga nada', win.__est().senaladas.length === antes);

  // --- validación: machos=0 y hembras=0 no carga nada ---
  doc.getElementById('sn-fecha').value = win.fechaISOHoy();
  doc.getElementById('sn-machos').value = '0';
  doc.getElementById('sn-hembras').value = '0';
  doc.getElementById('sn-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('machos y hembras en 0 no carga nada', win.__est().senaladas.length === antes);

  // --- solo hembras (sin machos) sí es válido ---
  doc.getElementById('sn-machos').value = '0';
  doc.getElementById('sn-hembras').value = '5';
  doc.getElementById('sn-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('solo hembras (0 machos) carga igual', win.__est().senaladas.length === antes+1, win.__est().senaladas[0]);

  // --- evento remoto sin potrero real, no toca stock ---
  const totalPotrerosAntes = Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p));
  win.aplicarEventoRemoto({ tipo:'senalada', potrero: 'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente: '02/09/2026', detalle: { id:'remoto1', machos: 7, hembras: 6, obs: null, usuario: 'Otro' } });
  chequear('un evento de señalada remoto se aplica sin requerir un potrero válido',
    win.__est().senaladas.some(sn=>sn.id==='remoto1' && sn.machos===7 && sn.hembras===6));
  const totalPotrerosDespues = Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p));
  chequear('no tocó el stock de ningún potrero', JSON.stringify(totalPotrerosAntes)===JSON.stringify(totalPotrerosDespues));

  // --- no duplica si llega el mismo id de nuevo ---
  const cantesDeRepetir = win.__est().senaladas.length;
  win.aplicarEventoRemoto({ tipo:'senalada', potrero: 'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente: '02/09/2026', detalle: { id:'remoto1', machos: 99, hembras: 99, obs:'otra cosa', usuario:'Otro' } });
  chequear('no duplica un evento de señalada con el mismo id', win.__est().senaladas.length === cantesDeRepetir);

  // --- sin señal se encola, y se vacía al reconectar ---
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  const colaAntes = (win.__est().colaSync||[]).length;
  doc.getElementById('sn-machos').value = '3';
  doc.getElementById('sn-hembras').value = '2';
  doc.getElementById('sn-fecha').value = win.fechaISOHoy();
  doc.getElementById('sn-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r, 30));
  chequear('sin señal el evento de señalada queda en cola', (win.__est().colaSync||[]).length === colaAntes+1);
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  await win.vaciarColaSync();
  chequear('al volver la señal la cola se vacía', (win.__est().colaSync||[]).length === 0);
  chequear('ese evento en cola también llegó al servidor', servidor.filas.filter(f=>f.tipo==='senalada').length >= 2);

  // --- 29/9/2026: editar y borrar un registro ---
  win.__est().senaladas.length = 0;
  win.__est().senaladas.push({ id:'edsn1', fecha:'10/03/2026', machos:12, hembras:9, obs:'Potrero 5', dispositivo:'este', usuario:null });
  win.renderSenaladasLista();
  chequear('la fila tiene boton editar y borrar',
    !!doc.querySelector('[data-senalada-editar="edsn1"]') && !!doc.querySelector('[data-senalada-borrar="edsn1"]'));

  doc.querySelector('[data-senalada-editar="edsn1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('editar precarga la fecha', doc.getElementById('sn-fecha').value === '2026-03-10');
  chequear('editar precarga machos', doc.getElementById('sn-machos').value === '12');
  chequear('editar precarga hembras', doc.getElementById('sn-hembras').value === '9');
  chequear('editar precarga observaciones', doc.getElementById('sn-obs').value === 'Potrero 5');
  chequear('el boton pasa a "Guardar corrección"', doc.getElementById('sn-guardar').textContent === 'Guardar corrección');
  chequear('aparece "Cancelar edición"', doc.getElementById('sn-cancelar-edicion').style.display !== 'none');

  doc.getElementById('sn-fecha').value = '2026-03-11';
  doc.getElementById('sn-machos').value = '15';
  doc.getElementById('sn-hembras').value = '10';
  doc.getElementById('sn-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  const editada = win.__est().senaladas.find(sn=>sn.id==='edsn1');
  chequear('editar corrige fecha, machos y hembras en estado.senaladas',
    !!editada && editada.fecha==='11/03/2026' && editada.machos===15 && editada.hembras===10, JSON.stringify(editada));
  chequear('el boton vuelve a "Registrar señalada"', doc.getElementById('sn-guardar').textContent === 'Registrar señalada');
  await new Promise(r=>setTimeout(r, 30));
  chequear('se mandó senalada_editada a Supabase',
    servidor.filas.some(f=>f.tipo==='senalada_editada' && f.detalle && f.detalle.id==='edsn1' && f.detalle.machos===15 && f.detalle.hembras===10 && f.detalle.fecha==='11/03/2026'));

  doc.getElementById('sn-cancelar-edicion').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('"Cancelar edición" desactiva el modo edición', doc.getElementById('sn-guardar').textContent === 'Registrar señalada');

  win.renderSenaladasLista();
  doc.querySelector('[data-senalada-borrar="edsn1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('borrar saca el registro de estado.senaladas', !win.__est().senaladas.some(sn=>sn.id==='edsn1'));
  await new Promise(r=>setTimeout(r, 30));
  chequear('se mandó senalada_eliminada a Supabase',
    servidor.filas.some(f=>f.tipo==='senalada_eliminada' && f.detalle && f.detalle.id==='edsn1'));

  // --- editar/borrar remotos: cualquier dispositivo los tiene que aplicar ---
  win.__est().senaladas.length = 0;
  win.__est().senaladas.push({ id:'remedsn', fecha:'01/01/2026', machos:3, hembras:2, dispositivo:'otro', usuario:null });
  win.aplicarEventoRemoto({ tipo:'senalada_editada', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    detalle: { id:'remedsn', fecha:'02/01/2026', machos:8, hembras:6 } });
  const remotaEditada = win.__est().senaladas.find(sn=>sn.id==='remedsn');
  chequear('un senalada_editada remoto actualiza fecha, machos y hembras',
    !!remotaEditada && remotaEditada.fecha==='02/01/2026' && remotaEditada.machos===8 && remotaEditada.hembras===6, JSON.stringify(remotaEditada));
  win.aplicarEventoRemoto({ tipo:'senalada_eliminada', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    detalle: { id:'remedsn' } });
  chequear('un senalada_eliminada remoto saca el registro', !win.__est().senaladas.some(sn=>sn.id==='remedsn'));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
