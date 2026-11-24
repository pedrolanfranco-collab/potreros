/*
 * Ranking de pasto (iPasto) en la PC de La Vuelta (24/11/2026): ventana con dos vistas,
 * ordenada por crecimiento del pasto, con copia guardada para usar sin señal.
 * Cliente Supabase falso (crecimiento_pasto); numeros escritos a mano.
 * Uso: node tests/probar_ranking_pasto.js
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, ok, detalle){
  console.log((ok ? '  OK  ' : '  MAL ') + nombre + (ok ? '' : ' — ' + (detalle || '')));
  if(!ok) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Mes/anio relativos a hoy (para que la prueba no se vuelva "dato viejo" con el tiempo).
function mesRelativo(meses){
  const h = new Date();
  const total = h.getFullYear()*12 + h.getMonth() - meses; // getMonth es 0-11
  return {anio: Math.floor(total/12), mes: (total % 12) + 1};
}
const MES_PREVIO = mesRelativo(1);   // el mes pasado: dato del ultimo mes medido
const MES_VIEJO = mesRelativo(3);    // 3 meses atras: dato viejo

function stubLeaflet(win){
  const capas = [];
  function capa(tipo){
    const c = { tipo, estilo:{}, tooltip:null, handlers:{},
      addTo(){ return c; }, on(ev,fn){ c.handlers[ev]=fn; return c; },
      bindTooltip(contenido, opciones){ c.tooltip=contenido; c.tooltipOpciones=opciones; return c; },
      setStyle(estilo){ c.estilo={...c.estilo,...estilo}; return c; },
      bindPopup(){ return c; }, setPopupContent(){ return c; }, openPopup(){ return c; },
      getBounds(){ return b; }, getLatLng(){ return {lat:-31.98,lng:-56.34}; },
      getElement(){ return win.document.createElement('div'); }, getTooltip(){ return {setContent(){},getElement(){return win.document.createElement('div');}}; },
      getPopup(){ return {setContent(){},isOpen(){return false;}}; }, isPopupOpen(){ return false; }, clearLayers(){ return c; }, addLayer(){ return c; }
    };
    capas.push(c);
    return new Proxy(c,{get(t,p){ if(p in t) return t[p]; return (...args)=>c; }});
  }
  const b = { getCenter(){ return {lat:-31.98,lng:-56.34}; }, extend(){ return b; }, isValid(){ return true; },
    pad(){ return b; }, getNorth(){ return -31.9; }, getSouth(){ return -32; }, getEast(){ return -56.3; }, getWest(){ return -56.4; }, contains(){ return true; } };
  const mapa = { setView(){return mapa;}, fitBounds(){return mapa;}, on(){return mapa;}, addLayer(){return mapa;}, removeLayer(){return mapa;},
    hasLayer(){return true;}, getZoom(){return 14;}, invalidateSize(){return mapa;}, setMaxBounds(){return mapa;}, doubleClickZoom:{disable(){},enable(){}} };
  win.__capas = capas;
  win.L = { map(){return mapa;}, tileLayer(){return capa('tile');}, layerGroup(){return capa('group');}, polygon(){return capa('polygon');}, marker(){return capa('marker');},
    circleMarker(){return capa('circleMarker');}, circle(){return capa('circle');}, divIcon(){return {};}, latLng(a,b){return {lat:a,lng:b};}, latLngBounds(){return b;}, DomEvent:{stopPropagation(){}} };
  win.JSZip = function(){return {file(){},generateAsync(){return Promise.resolve(new win.Blob([]));}};};
}

async function levantar(archivo, almacenamientoInicial={}){
  const html = fs.readFileSync(archivo,'utf8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g,'');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError',e=>errores.push(String(e.stack||e.message)));
  vc.on('error',(...a)=>errores.push(a.map(String).join(' ')));
  const dom = new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://local.test/',virtualConsole:vc});
  const win = dom.window;
  for(const [clave,valor] of Object.entries(almacenamientoInicial)) win.localStorage.setItem(clave,valor);
  stubLeaflet(win);
  win.supabase = {createClient(){return null;}};
  Object.defineProperty(win.navigator,'onLine',{value:false,configurable:true});
  win.alert=()=>{}; win.confirm=()=>true; win.prompt=()=>null;
  win.URL.createObjectURL=()=> 'blob:x'; win.URL.revokeObjectURL=()=>{};
  win.HTMLElement.prototype.scrollIntoView=function(){};
  win.HTMLAnchorElement.prototype.click=function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s=>s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo+';window.__prueba={estado,poligonos,geo:POTREROS_GEO,dobles:POTREROS_DOBLES,config:CONFIG,areaHa,totalPotrero,refrescarColoresMapa};'); }
  catch(e){ errores.push('ERROR AL CARGAR: '+e.stack); }
  await esperar(60);
  return {win,errores,cerrar(){win.close();}};
}
function textoPlano(html){ return String(html||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }

// Cliente Supabase falso, encadenable. Guarda lo que se le pidio (tabla, select, eq, order, range).
function clienteFalso(filas, error){
  const pedido = {tabla:null, select:null, eq:[], order:[], range:[]};
  const c = {
    select(x){ pedido.select = x; return c; },
    eq(a,b){ pedido.eq.push([a,b]); return c; },
    order(a,o){ pedido.order.push([a,o]); return c; },
    range(a,b){ pedido.range.push([a,b]); return Promise.resolve(error ? {data:null,error} : {data:filas.slice(a, b+1), error:null}); }
  };
  return {client:{from(t){ pedido.tabla = t; return c; }}, pedido};
}

const SELECT = 'establecimiento,potrero_ipasto,anio,mes,tc_actual,tc_promedio';
const CLAVE_HISTORIA = 'la_vuelta_pasto_ipasto_historia';
// Filas de crecimiento_pasto (numeros escritos a mano).
const FILAS = [
  {establecimiento:'la_vuelta', potrero_ipasto:'LV 11', anio:2025, mes:10, tc_actual:10, tc_promedio:20},
  {establecimiento:'la_vuelta', potrero_ipasto:'LV 11', anio:2026, mes:9, tc_actual:20, tc_promedio:22},
  {establecimiento:'la_vuelta', potrero_ipasto:'LV 11', anio:2026, mes:10, tc_actual:16.25, tc_promedio:24.27},
  {establecimiento:'la_vuelta', potrero_ipasto:'LV 9', anio:2026, mes:10, tc_actual:14.32, tc_promedio:17.47},
  {establecimiento:'la_vuelta', potrero_ipasto:'Calle', anio:2026, mes:10, tc_actual:20.01, tc_promedio:19.79},
  {establecimiento:'la_vuelta', potrero_ipasto:'LV 8', anio:2026, mes:9, tc_actual:0, tc_promedio:18}
];

// Inyecta el cliente falso y abre la ventana de ranking.
async function abrirConCliente(win, filas, error){
  const c = clienteFalso(filas, error);
  // supabaseClient es un let del script: desde afuera no se puede reasignar, asi que el cliente entra por createClient.
  win.supabase.createClient = () => c.client;
  await win.eval('abrirRankingPasto')();
  return c;
}
function filasRanking(win){ return Array.from(win.document.querySelectorAll('#rp-lista .rp-fila')); }
function nombresRanking(win){ return filasRanking(win).map(f => f.querySelector('b').textContent).join('|'); }
function filaDe(win, nombre){ return filasRanking(win).find(f => f.querySelector('b').textContent === nombre); }

async function probarRanking(){
  console.log('\n=== Ranking de pasto: La Vuelta PC ===');
  const {win,errores,cerrar} = await levantar('la-vuelta-pc/index.html');
  chequear('1. La Vuelta PC carga sin errores', errores.length===0, errores.join(' | '));
  if(errores.length){ cerrar(); return; }
  const boton = win.document.getElementById('btn-ranking-pasto');
  chequear('1. #btn-ranking-pasto visible en La Vuelta', !!boton && boton.style.display !== 'none', boton && boton.style.display);

  // 2. Vista de ultimo mes
  const c = await abrirConCliente(win, FILAS);
  chequear('2. pide la tabla crecimiento_pasto', c.pedido.tabla === 'crecimiento_pasto', c.pedido.tabla);
  chequear('2. select exacto', c.pedido.select === SELECT, c.pedido.select);
  chequear('2. filtra por establecimiento la_vuelta', c.pedido.eq.length===1 && c.pedido.eq[0][0]==='establecimiento' && c.pedido.eq[0][1]==='la_vuelta', JSON.stringify(c.pedido.eq));
  chequear('2. pagina con range [[0,999]]', JSON.stringify(c.pedido.range) === '[[0,999]]', JSON.stringify(c.pedido.range));
  const modal = win.document.getElementById('modal-ranking-pasto');
  chequear('2. el modal queda en display flex', modal.style.display === 'flex', modal.style.display);
  chequear('2. 3 filas en orden Calle, LV 11, LV 9', filasRanking(win).length===3 && nombresRanking(win)==='Calle|LV 11|LV 9', nombresRanking(win));
  const valor = n => filaDe(win,n)?.querySelector('.rp-valor')?.textContent;
  const pct = n => filaDe(win,n)?.querySelector('.rp-pct');
  chequear('2. LV 11 muestra 16,3', valor('LV 11')==='16,3', valor('LV 11'));
  chequear('2. LV 11 dice 67 % de lo normal en rojo', !!pct('LV 11') && pct('LV 11').textContent==='67 % de lo normal' && pct('LV 11').classList.contains('rp-bajo'), pct('LV 11') && pct('LV 11').textContent);
  chequear('2. LV 9 dice 82 % de lo normal sin rojo', !!pct('LV 9') && pct('LV 9').textContent==='82 % de lo normal' && !pct('LV 9').classList.contains('rp-bajo'), pct('LV 9') && pct('LV 9').textContent);
  chequear('2. Calle dice 101 % de lo normal', !!pct('Calle') && pct('Calle').textContent==='101 % de lo normal', pct('Calle') && pct('Calle').textContent);
  chequear('2. LV 11 lista los potreros 11, 18', filaDe(win,'LV 11')?.querySelector('small')?.textContent==='11, 18', filaDe(win,'LV 11')?.querySelector('small')?.textContent);
  chequear('2. boton de mes dice Octubre 2026', win.document.querySelector('#rp-vistas [data-rp-vista="mes"]').textContent==='Octubre 2026', win.document.querySelector('#rp-vistas [data-rp-vista="mes"]').textContent);
  const sinTxt = win.document.getElementById('rp-sin-dato').textContent;
  const sinLista = sinTxt.replace('Sin dato de iPasto: ','').replace(/\.$/,'').split(', ');
  chequear('2. sin dato incluye 5 y OMBU', sinLista.includes('5') && sinLista.includes('OMBU'), sinTxt);
  chequear('2. sin dato no incluye 18 ni 11', !sinLista.includes('18') && !sinLista.includes('11'), sinTxt);
  const guardado = JSON.parse(win.localStorage.getItem(CLAVE_HISTORIA) || 'null');
  chequear('2. guarda 5 filas (la de tc 0 no)', !!guardado && guardado.filas.length===5, guardado && guardado.filas.length);

  // 3. Vista de 12 meses
  win.document.querySelector('#rp-vistas [data-rp-vista="anio"]').dispatchEvent(new win.MouseEvent('click', {bubbles:true}));
  chequear('3. orden LV 11, Calle, LV 9', nombresRanking(win)==='LV 11|Calle|LV 9', nombresRanking(win));
  chequear('3. LV 11 muestra 1.104', valor('LV 11')==='1.104', valor('LV 11'));
  chequear('3. LV 11 dice solo 2 meses con dato', !!pct('LV 11') && pct('LV 11').textContent==='solo 2 meses con dato', pct('LV 11') && pct('LV 11').textContent);
  chequear('3. Calle muestra 620', valor('Calle')==='620', valor('Calle'));
  chequear('3. LV 9 muestra 444', valor('LV 9')==='444', valor('LV 9'));
  cerrar();

  // 4. Error sin historia guardada
  const e4 = await levantar('la-vuelta-pc/index.html');
  await abrirConCliente(e4.win, [], {message:'boom'});
  const msg4 = e4.win.document.getElementById('rp-mensaje').textContent;
  chequear('4. con error y sin historia dice "No se pudo leer" y el motivo', msg4.includes('No se pudo leer') && msg4.includes('boom'), msg4);
  chequear('4. con error y sin historia no hay filas', filasRanking(e4.win).length===0, filasRanking(e4.win).length);
  e4.cerrar();

  // 5. Error pero con historia guardada: se ve lo guardado
  const e5 = await levantar('la-vuelta-pc/index.html', {la_vuelta_pasto_ipasto_historia: JSON.stringify({filas:[{p:'LV 9',anio:2026,mes:10,tc:14.32,prom:17.47}], leidoEn:1})});
  await abrirConCliente(e5.win, [], {message:'boom'});
  const msg5 = e5.win.document.getElementById('rp-mensaje').textContent;
  chequear('5. con error y con historia muestra 1 fila LV 9', filasRanking(e5.win).length===1 && nombresRanking(e5.win)==='LV 9', nombresRanking(e5.win));
  chequear('5. con historia guardada no dice "No se pudo leer"', !msg5.includes('No se pudo leer'), msg5);
  e5.cerrar();
}

async function probarMariaLauraSinRanking(){
  console.log('\n=== Ranking de pasto: María Laura PC (sin iPasto) ===');
  const {win,errores,cerrar} = await levantar('maria-laura-pc/index.html');
  chequear('6. María Laura PC carga sin errores', errores.length===0, errores.join(' | '));
  const boton = win.document.getElementById('btn-ranking-pasto');
  chequear('6. #btn-ranking-pasto queda oculto en María Laura', !!boton && boton.style.display === 'none', boton && boton.style.display);
  cerrar();
}

async function probarSeccionPotreros(){
  console.log('\n=== Ranking de pasto: menu Potreros de La Vuelta PC ===');
  const {win,errores,cerrar} = await levantar('la-vuelta-pc/index.html');
  chequear('7. carga sin errores (seccion Potreros)', errores.length===0, errores.join(' | '));
  if(errores.length){ cerrar(); return; }
  win.eval("abrirSeccionPC('potreros')");
  const lista = win.document.getElementById('pc-seccion-lista').textContent;
  chequear('7. la seccion Potreros de La Vuelta incluye Ranking de pasto', lista.includes('Ranking de pasto'), lista.replace(/\s+/g,' ').slice(0,200));
  cerrar();
}

(async()=>{
  await probarRanking();
  await probarMariaLauraSinRanking();
  await probarSeccionPotreros();
  console.log('\n'+(fallas?fallas+' verificacion(es) fallaron':'Todo OK'));
  process.exit(fallas?1:0);
})();
