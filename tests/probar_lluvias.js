/*
 * Prueba ad-hoc: registro de lluvias y otros eventos climáticos.
 * Verifica: cargar una lluvia local queda en estado.lluvias y se manda como
 * evento a Supabase; un evento 'lluvia' de otro dispositivo se aplica sin
 * requerir un potrero real; sin señal se encola y se vacía al reconectar;
 * un evento con id repetido no duplica (aplicarEventoRemoto);
 * agruparLluviasPorMesYAnio() suma bien por mes y separa por año (14/9/2026);
 * "otros eventos" (helada, granizo, etc., 14/9/2026) sigue el mismo patrón
 * que lluvia pero con su propio tipo de evento ('evento_clima'), sin mm.
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

  chequear('estado.lluvias arranca vacío', Array.isArray(win.__est().lluvias) && win.__est().lluvias.length===0);
  chequear('boton btn-lluvias presente', !!doc.getElementById('btn-lluvias'));

  // --- cargar una lluvia local ---
  doc.getElementById('btn-lluvias').dispatchEvent(new win.Event('click', { bubbles: true }));
  doc.getElementById('ll-mm').value = '23.5';
  doc.getElementById('ll-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  const lluvias = win.__est().lluvias;
  chequear('la lluvia queda en estado.lluvias', lluvias.length === 1 && lluvias[0].mm === 23.5, JSON.stringify(lluvias));
  chequear('la lista se re-renderiza con la carga', /23\.5 mm/.test(doc.getElementById('lluvias-lista').innerHTML));
  chequear('el resumen mensual/anual se renderiza con la carga', /23\.5/.test(doc.getElementById('lluvias-resumen').innerHTML));

  // --- acumulado por mes y año: 3-4 lluvias en meses/años distintos ---
  const hoyISO = win.fechaISOHoy();
  const anioActual = parseInt(hoyISO.split('-')[0], 10);
  win.__est().lluvias.length = 0;
  win.__est().lluvias.push(
    { id:'r1', fecha:`05/01/${anioActual}`, mm:10, dispositivo:'x', usuario:null },
    { id:'r2', fecha:`20/01/${anioActual}`, mm:5, dispositivo:'x', usuario:null },
    { id:'r3', fecha:`10/06/${anioActual}`, mm:30, dispositivo:'x', usuario:null },
    { id:'r4', fecha:`15/01/${anioActual-1}`, mm:100, dispositivo:'x', usuario:null }
  );
  const agrupado = win.agruparLluviasPorMesYAnio();
  const filaActual = agrupado.find(f=>f.anio===anioActual);
  const filaAnterior = agrupado.find(f=>f.anio===anioActual-1);
  chequear('agrupa enero del año actual sumando las dos cargas (15mm)',
    !!filaActual && filaActual.meses[0]===15, JSON.stringify(filaActual));
  chequear('agrupa junio del año actual por separado (30mm)',
    !!filaActual && filaActual.meses[5]===30, JSON.stringify(filaActual));
  chequear('el total del año actual es 45 (15+30)',
    !!filaActual && filaActual.total===45, JSON.stringify(filaActual));
  chequear('el año anterior queda en una fila aparte (100mm en enero)',
    !!filaAnterior && filaAnterior.meses[0]===100 && filaAnterior.total===100, JSON.stringify(filaAnterior));
  chequear('el año más reciente aparece primero', agrupado[0].anio === anioActual);

  await new Promise(r=>setTimeout(r, 30));
  chequear('se mandó como evento a Supabase', servidor.filas.some(f=>f.tipo==='lluvia' && f.detalle && f.detalle.mm===23.5));
  chequear('el evento lleva establecimiento', servidor.filas.every(f=>!!f.establecimiento));

  // --- validaciones ---
  const antes = win.__est().lluvias.length;
  doc.getElementById('ll-mm').value = '';
  doc.getElementById('ll-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('sin mm no carga nada', win.__est().lluvias.length === antes);

  // --- evento remoto sin potrero real ---
  const totalPotrerosAntes = win.totalPotrero ? Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p)) : null;
  win.aplicarEventoRemoto({ tipo:'lluvia', potrero: 'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente: '02/01/2026', detalle: { id:'remoto1', mm: 40, usuario:'Otro' } });
  const lluviasTrasRemoto = win.__est().lluvias;
  chequear('un evento de lluvia remoto se aplica sin requerir un potrero válido',
    lluviasTrasRemoto.some(l=>l.id==='remoto1' && l.mm===40));
  if(totalPotrerosAntes){
    const totalPotrerosDespues = Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p));
    chequear('no tocó el stock de ningún potrero', JSON.stringify(totalPotrerosAntes)===JSON.stringify(totalPotrerosDespues));
  }

  // --- no duplica si llega el mismo id de nuevo ---
  const cantesDeRepetir = win.__est().lluvias.length;
  win.aplicarEventoRemoto({ tipo:'lluvia', potrero: 'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente: '02/01/2026', detalle: { id:'remoto1', mm: 999, usuario:'Otro' } });
  chequear('no duplica un evento de lluvia con el mismo id', win.__est().lluvias.length === cantesDeRepetir);

  // --- sin señal se encola, y se vacía al reconectar ---
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  const colaAntes = (win.__est().colaSync||[]).length;
  doc.getElementById('ll-mm').value = '5';
  doc.getElementById('ll-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r, 30));
  chequear('sin señal el evento de lluvia queda en cola', (win.__est().colaSync||[]).length === colaAntes+1);
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  await win.vaciarColaSync();
  chequear('al volver la señal la cola se vacía', (win.__est().colaSync||[]).length === 0);
  chequear('ese evento en cola también llegó al servidor', servidor.filas.some(f=>f.tipo==='lluvia' && f.detalle && f.detalle.mm===5));

  // --- otros eventos climáticos (helada, granizo, etc.) ---
  chequear('estado.eventosClima arranca vacío', Array.isArray(win.__est().eventosClima) && win.__est().eventosClima.length===0);
  chequear('boton ev-guardar presente', !!doc.getElementById('ev-guardar'));

  doc.getElementById('ev-tipo').value = 'Granizo';
  doc.getElementById('ev-obs').value = 'Piedra grande, dañó pasturas del 8';
  doc.getElementById('ev-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  const eventosClima = win.__est().eventosClima;
  chequear('el evento climático queda en estado.eventosClima',
    eventosClima.length === 1 && eventosClima[0].tipo === 'Granizo' && eventosClima[0].obs === 'Piedra grande, dañó pasturas del 8',
    JSON.stringify(eventosClima));
  chequear('la lista de otros eventos se re-renderiza con la carga',
    /Granizo/.test(doc.getElementById('eventos-clima-lista').innerHTML));

  await new Promise(r=>setTimeout(r, 30));
  chequear('el evento climático se mandó a Supabase con su propio tipo',
    servidor.filas.some(f=>f.tipo==='evento_clima' && f.detalle && f.detalle.tipo==='Granizo'));

  const totalPotrerosAntesClima = Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p));
  win.aplicarEventoRemoto({ tipo:'evento_clima', potrero: 'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente: '03/01/2026', detalle: { id:'clima-remoto1', tipo:'Helada', obs:'heló fuerte', usuario:'Otro' } });
  chequear('un evento climático remoto se aplica sin requerir un potrero válido',
    win.__est().eventosClima.some(ev=>ev.id==='clima-remoto1' && ev.tipo==='Helada'));
  const totalPotrerosDespuesClima = Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p));
  chequear('un evento climático no toca el stock de ningún potrero',
    JSON.stringify(totalPotrerosAntesClima)===JSON.stringify(totalPotrerosDespuesClima));

  const cantesDeRepetirClima = win.__est().eventosClima.length;
  win.aplicarEventoRemoto({ tipo:'evento_clima', potrero: 'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente: '03/01/2026', detalle: { id:'clima-remoto1', tipo:'Sequía', obs:'otra cosa', usuario:'Otro' } });
  chequear('no duplica un evento climático con el mismo id', win.__est().eventosClima.length === cantesDeRepetirClima);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
