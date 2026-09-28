/*
 * Prueba ad-hoc: registro de lluvias y otros eventos climáticos.
 * Verifica: cargar una lluvia local queda en estado.lluvias y se manda como
 * evento a Supabase; un evento 'lluvia' de otro dispositivo se aplica sin
 * requerir un potrero real; sin señal se encola y se vacía al reconectar;
 * un evento con id repetido no duplica (aplicarEventoRemoto);
 * agruparLluviasPorMesYAnio() suma bien por mes y separa por año (14/9/2026);
 * "otros eventos" (helada, granizo, etc., 14/9/2026) sigue el mismo patrón
 * que lluvia pero con su propio tipo de evento ('evento_clima'), sin mm.
 * 28/9/2026: el botón pasa a decir "Lluvias y otros eventos"; el historial
 * de registros individuales queda oculto por defecto detrás de "Ver
 * historial" (solo el resumen mensual se ve siempre); cada registro se
 * puede editar (fecha y mm) o borrar, con sus propios tipos de evento
 * ('lluvia_editada'/'lluvia_eliminada', no reusa 'correccion' porque ese
 * asume un potrero real del que reversar stock) que cualquier dispositivo
 * tiene que aplicar al sincronizar, no solo el que originó el cambio.
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

  // --- 28/9/2026: boton renombrado, historial oculto por defecto, editar/borrar ---
  chequear('el boton dice "Lluvias y otros eventos"', /otros eventos/.test(doc.getElementById('btn-lluvias').textContent));
  chequear('boton "Ver historial" presente', !!doc.getElementById('btn-lluvias-historial'));
  chequear('la lista de registros arranca oculta', doc.getElementById('lluvias-lista').style.display === 'none');
  doc.getElementById('btn-lluvias-historial').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('"Ver historial" la muestra', doc.getElementById('lluvias-lista').style.display !== 'none');
  doc.getElementById('btn-lluvias-historial').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('tocarlo de nuevo la vuelve a ocultar', doc.getElementById('lluvias-lista').style.display === 'none');
  doc.getElementById('btn-lluvias-historial').dispatchEvent(new win.Event('click', { bubbles: true }));

  win.__est().lluvias.length = 0;
  win.__est().lluvias.push({ id:'edl1', fecha:'10/03/2026', mm:12, dispositivo:'este', usuario:null });
  win.renderLluviasLista();
  chequear('la fila tiene boton editar y borrar',
    !!doc.querySelector('[data-lluvia-editar="edl1"]') && !!doc.querySelector('[data-lluvia-borrar="edl1"]'));

  doc.querySelector('[data-lluvia-editar="edl1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('editar precarga la fecha', doc.getElementById('ll-fecha').value === '2026-03-10');
  chequear('editar precarga los mm', doc.getElementById('ll-mm').value === '12');
  chequear('el boton pasa a "Guardar corrección"', doc.getElementById('ll-guardar').textContent === 'Guardar corrección');
  chequear('aparece "Cancelar edición"', doc.getElementById('ll-cancelar-edicion').style.display !== 'none');

  doc.getElementById('ll-fecha').value = '2026-03-11';
  doc.getElementById('ll-mm').value = '20';
  doc.getElementById('ll-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  const editada = win.__est().lluvias.find(l=>l.id==='edl1');
  chequear('editar corrige fecha y mm en estado.lluvias',
    !!editada && editada.fecha==='11/03/2026' && editada.mm===20, JSON.stringify(editada));
  chequear('el boton vuelve a "Cargar lluvia"', doc.getElementById('ll-guardar').textContent === 'Cargar lluvia');
  await new Promise(r=>setTimeout(r, 30));
  chequear('se mandó lluvia_editada a Supabase',
    servidor.filas.some(f=>f.tipo==='lluvia_editada' && f.detalle && f.detalle.id==='edl1' && f.detalle.mm===20 && f.detalle.fecha==='11/03/2026'));

  doc.getElementById('ll-cancelar-edicion').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('"Cancelar edición" desactiva el modo edición', doc.getElementById('ll-guardar').textContent === 'Cargar lluvia');

  win.renderLluviasLista();
  doc.querySelector('[data-lluvia-borrar="edl1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('borrar saca el registro de estado.lluvias', !win.__est().lluvias.some(l=>l.id==='edl1'));
  await new Promise(r=>setTimeout(r, 30));
  chequear('se mandó lluvia_eliminada a Supabase',
    servidor.filas.some(f=>f.tipo==='lluvia_eliminada' && f.detalle && f.detalle.id==='edl1'));

  // --- editar/borrar remotos: cualquier dispositivo los tiene que aplicar ---
  win.__est().lluvias.length = 0;
  win.__est().lluvias.push({ id:'remedl', fecha:'01/01/2026', mm:5, dispositivo:'otro', usuario:null });
  win.aplicarEventoRemoto({ tipo:'lluvia_editada', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    detalle: { id:'remedl', fecha:'02/01/2026', mm:9 } });
  const remotaEditada = win.__est().lluvias.find(l=>l.id==='remedl');
  chequear('un lluvia_editada remoto actualiza fecha y mm',
    !!remotaEditada && remotaEditada.fecha==='02/01/2026' && remotaEditada.mm===9, JSON.stringify(remotaEditada));
  win.aplicarEventoRemoto({ tipo:'lluvia_eliminada', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    detalle: { id:'remedl' } });
  chequear('un lluvia_eliminada remoto saca el registro', !win.__est().lluvias.some(l=>l.id==='remedl'));

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
