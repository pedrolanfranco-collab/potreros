/*
 * Pasto de iPasto en la PC de La Vuelta (23/11/2026): cartelito del potrero
 * ("Pasto de <mes>...") y "Pintar por: Pasto (iPasto)" en el mapa.
 * Sincronizacion con un cliente Supabase falso (crecimiento_pasto).
 * Uso: node tests/probar_pasto_ipasto.js
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
function tooltipTexto(layer){
  const contenido = layer && layer.tooltip;
  return typeof contenido === 'function' ? contenido.call(layer) : contenido;
}
function textoPlano(html){ return String(html||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function datosPasto(anio, mes, filas, leidoEn){
  return JSON.stringify({anio, mes, filas, leidoEn: leidoEn === undefined ? Date.now() : leidoEn});
}
// Cliente Supabase falso, encadenable. Guarda lo que se le pidio.
function clienteFalso(filas, error){
  const pedido = {tabla:null, select:null, eq:[], order:[], limit:null};
  const constructor = {
    select(c){ pedido.select = c; return constructor; },
    eq(c,v){ pedido.eq.push([c,v]); return constructor; },
    order(c,o){ pedido.order.push([c,o]); return constructor; },
    range(){ return constructor; },
    limit(n){ pedido.limit = n; return Promise.resolve(error ? {data:null, error} : {data:filas, error:null}); }
  };
  return {client:{from(t){ pedido.tabla = t; return constructor; }}, pedido};
}

async function probarLaVuelta(){
  console.log('\n=== La Vuelta PC: pasto de iPasto ===');
  const datos = datosPasto(MES_PREVIO.anio, MES_PREVIO.mes, {"LV 11":{tc_actual:16.25,tc_promedio:24.27},"LV 9":{tc_actual:14.32,tc_promedio:17.47}});
  const {win,errores,cerrar} = await levantar('la-vuelta-pc/index.html', {la_vuelta_pasto_ipasto: datos});
  chequear('carga sin errores',errores.length===0,errores.join(' | '));
  if(errores.length){ cerrar(); return; }
  const p = win.__prueba;
  const nombreMes = MESES[MES_PREVIO.mes-1];

  // 1. Potrero 18 (cruce LV 11) con animales: cartelito y cubre
  const dueno = (p.config.duenos||[])[0] || '';
  p.estado.potreros['18'].animales = {['Vacas||'+dueno]: 50};
  p.refrescarColoresMapa();
  const layer18 = p.poligonos['18'].layer;
  const txt18 = textoPlano(tooltipTexto(layer18));
  chequear('tooltip 18: dice "Pasto de <mes>" del ultimo mes medido', txt18.includes('Pasto de '+nombreMes), txt18);
  chequear('tooltip 18: crecía 16,3 (tc_actual de LV 11)', /crecía 16,3 kg\/ha\/día/.test(txt18), txt18);
  chequear('tooltip 18: normal 24,3 (tc_promedio de LV 11)', /normal 24,3\)/.test(txt18), txt18);
  const ha = p.areaHa('18');
  const ug = win.eval("totalUG('18')");
  const cubreEsperado = Math.round(16.25 * ha / (ug * 10) * 100);
  const cubreMostrado = Number((txt18.match(/cubre (\d+) %/)||[])[1]);
  chequear('tooltip 18: "cubre N %" da la formula con areaHa y totalUG reales ('+cubreEsperado+' %)', cubreMostrado === cubreEsperado, 'mostrado '+cubreMostrado+' esperado '+cubreEsperado+' (ha '+ha+', ug '+ug+')');
  chequear('tooltip 18: sin "dato viejo" con dato del mes pasado', !/dato viejo/.test(txt18));
  chequear('tooltip 18: sin "(promedio del campo)" (tiene cruce)', !/promedio del campo/.test(txt18));
  const colorEsperado = cubreMostrado < 60 ? '#c2452d' : cubreMostrado < 100 ? '#e0a62a' : cubreMostrado < 150 ? '#cfe3a8' : '#7fb04f';
  chequear('colorPastoMapa 18 da el color segun cubre ('+colorEsperado+')', win.eval("colorPastoMapa('18')") === colorEsperado, win.eval("colorPastoMapa('18')"));
  p.estado.potreros['18'].animales = {['Vacas||'+dueno]: 100};
  const cubre25 = Math.round(16.25 * ha / (win.eval("totalUG('18')") * 10) * 100);
  chequear('con 100 vacas el cubre es menor a 60 y colorPastoMapa da rojo', cubre25 < 60 && win.eval("colorPastoMapa('18')") === '#c2452d', cubre25+' '+win.eval("colorPastoMapa('18')"));
  p.estado.potreros['18'].animales = {['Vacas||'+dueno]: 50};

  // 2. Potrero 5 (sin cruce): promedio del campo, tc = promedio de 16,25 y 14,32 = 15,3
  const txt5 = textoPlano(tooltipTexto(p.poligonos['5'].layer));
  chequear('potrero 5 (sin cruce) dice "(promedio del campo)"', /Pasto de [a-záéíóúñ]+ \(promedio del campo\)/.test(txt5), txt5);
  chequear('potrero 5 usa promedio simple de tc_actual: 15,3', /crecía 15,3 kg/.test(txt5), txt5);

  // 4-5. colorPastoMapa: sin animales => gris; cubre < 60 => rojo
  p.estado.potreros['5'].animales = {};
  p.refrescarColoresMapa();
  chequear('potrero sin animales se pinta gris', win.eval("colorPastoMapa('5')") === '#9a9a8c', win.eval("colorPastoMapa('5')"));
  chequear('colorPastoMapa 18 da el mismo color que el mapa', win.eval("colorPastoMapa('18')") === colorEsperado, win.eval("colorPastoMapa('18')"));

  // 3. Numeros fijos escritos a mano (no se usa la formula del codigo para el esperado):
  // 776 Ovejas x 0,15 UG = 116,4 UG (Ovejas no tiene regla de temporada, vale 0,15 todo el año).
  // cubre = 16,25 tc x 23 ha / (116,4 UG x 10) x 100 = 32,1 %  ->  "cubre 32 %".
  p.estado.potreros['18'].animales = {['Ovejas||'+dueno]: 776};
  p.refrescarColoresMapa();
  const txtFijo = textoPlano(tooltipTexto(p.poligonos['18'].layer));
  chequear('potrero 18 tiene 23 ha', p.areaHa('18') === 23, p.areaHa('18'));
  chequear('potrero 18 tiene 116,4 UG con 776 ovejas', Math.abs(win.eval("totalUG('18')") - 116.4) < 1e-9, win.eval("totalUG('18')"));
  chequear('tooltip 18 dice "UG: 116,40"', /UG: 116,40/.test(txtFijo), txtFijo);
  chequear('tooltip 18 dice "cubre 32 %" (16,25 x 23 / (116,4 x 10))', /cubre 32 %/.test(txtFijo), txtFijo);

  // 2. Color real de la capa en modo Pasto (cambio por el selector, disparando 'change')
  const sel1 = win.document.getElementById('mapa-pintar-por');
  sel1.value = 'pasto';
  sel1.dispatchEvent(new win.Event('change', {bubbles:true}));
  chequear('el selector pasa a pasto y se guarda', win.localStorage.getItem('la_vuelta_pintar_por') === 'pasto', win.localStorage.getItem('la_vuelta_pintar_por'));
  chequear('potrero 18 (cubre 32 %) se pinta #c2452d en modo Pasto', p.poligonos['18'].layer.estilo.fillColor === '#c2452d', p.poligonos['18'].layer.estilo.fillColor);
  p.estado.potreros['5'].animales = {};
  p.refrescarColoresMapa();
  chequear('potrero 5 sin animales se pinta gris en modo Pasto', p.poligonos['5'].layer.estilo.fillColor === '#9a9a8c', p.poligonos['5'].layer.estilo.fillColor);

  // Modo pasto guardado: el selector y la leyenda lo muestran
  cerrar();
  const conModo = await levantar('la-vuelta-pc/index.html', {la_vuelta_pasto_ipasto: datos, la_vuelta_pintar_por: 'pasto'});
  const doc = conModo.win.document;
  const sel = doc.getElementById('mapa-pintar-por');
  chequear('con el modo guardado en pasto, el selector queda en pasto', !!sel && sel.value === 'pasto', sel && sel.value);
  const leyenda = doc.getElementById('mapa-leyenda') ? doc.getElementById('mapa-leyenda').textContent : '';
  chequear('leyenda de pasto dice el mes y los cortes', leyenda.includes('Pasto de '+nombreMes) && /menos de 60 %/.test(leyenda) && /150 % o más/.test(leyenda), leyenda);
  conModo.cerrar();

  // 6. El selector tiene la opcion Pasto (iPasto)
  const selSin = await levantar('la-vuelta-pc/index.html');
  const opt = selSin.win.document.querySelector('#mapa-pintar-por option[value="pasto"]');
  chequear('el selector de La Vuelta PC tiene la opcion pasto', !!opt && !opt.disabled);
  selSin.cerrar();

  // 4. Cruce con tc_promedio 0 (lo que deja la sincronizacion con Number(null)): el tooltip NO dice "normal"
  const promCero = await levantar('la-vuelta-pc/index.html', {la_vuelta_pasto_ipasto: datosPasto(MES_PREVIO.anio, MES_PREVIO.mes, {"LV 11":{tc_actual:16.25,tc_promedio:0}})});
  const pc = promCero.win.__prueba;
  pc.estado.potreros['18'].animales = {['Vacas||'+((pc.config.duenos||[])[0]||'')]: 50};
  pc.refrescarColoresMapa();
  const txtCero = textoPlano(tooltipTexto(pc.poligonos['18'].layer));
  chequear('tc_promedio 0: el tooltip dice "crecía 16,3" y NO dice "normal"', /crecía 16,3 kg\/ha\/día/.test(txtCero) && !/normal/.test(txtCero), txtCero);
  promCero.cerrar();
}

async function probarSinDatos(){
  console.log('\n=== La Vuelta PC: sin datos guardados ===');
  const {win,errores,cerrar} = await levantar('la-vuelta-pc/index.html');
  chequear('carga sin errores (sin datos)', errores.length===0, errores.join(' | '));
  if(errores.length){ cerrar(); return; }
  const txt = textoPlano(tooltipTexto(win.__prueba.poligonos['18'].layer));
  chequear('sin datos guardados: el tooltip NO tiene "Pasto"', !/Pasto/.test(txt), txt);
  chequear('sin datos guardados: pastoPotrero da null', win.eval("pastoPotrero('18')") === null);
  cerrar();
}

async function probarDatoViejo(){
  console.log('\n=== La Vuelta PC: dato de hace 3 meses ===');
  const datos = datosPasto(MES_VIEJO.anio, MES_VIEJO.mes, {"LV 11":{tc_actual:16.25,tc_promedio:24.27}});
  const {win,errores,cerrar} = await levantar('la-vuelta-pc/index.html', {la_vuelta_pasto_ipasto: datos});
  chequear('carga sin errores (dato viejo)', errores.length===0, errores.join(' | '));
  if(errores.length){ cerrar(); return; }
  const p = win.__prueba;
  const dueno = (p.config.duenos||[])[0] || '';
  p.estado.potreros['18'].animales = {['Vacas||'+dueno]: 50};
  p.refrescarColoresMapa();
  const txt = textoPlano(tooltipTexto(p.poligonos['18'].layer));
  chequear('dato de hace 3 meses: el tooltip dice "dato viejo"', /dato viejo/.test(txt), txt);
  chequear('dato de hace 3 meses: colorPastoMapa da gris', win.eval("colorPastoMapa('18')") === '#9a9a8c', win.eval("colorPastoMapa('18')"));
  cerrar();
}

async function probarMariaLaura(){
  console.log('\n=== María Laura PC: sin iPasto ===');
  const datos = datosPasto(MES_PREVIO.anio, MES_PREVIO.mes, {"LV 11":{tc_actual:16.25,tc_promedio:24.27}});
  const {win,errores,cerrar} = await levantar('maria-laura-pc/index.html', {maria_laura_pasto_ipasto: datos, maria_laura_pintar_por: 'pasto'});
  chequear('carga sin errores', errores.length===0, errores.join(' | '));
  if(errores.length){ cerrar(); return; }
  const sel = win.document.getElementById('mapa-pintar-por');
  chequear('el selector de María Laura NO tiene la opcion pasto (la saca el codigo)', !!sel && !sel.querySelector('option[value="pasto"]'));
  chequear('con pasto guardado en María Laura, el modo cae a Dotación', !!sel && sel.value === 'dotacion', sel && sel.value);
  cerrar();
}

async function probarSincronizacion(){
  console.log('\n=== pastoAlSincronizar con cliente falso ===');
  const {win,errores,cerrar} = await levantar('la-vuelta-pc/index.html');
  chequear('carga sin errores (sincronizacion)', errores.length===0, errores.join(' | '));
  if(errores.length){ cerrar(); return; }
  const sync = win.eval('pastoAlSincronizar');
  const SELECT = 'establecimiento,potrero_ipasto,anio,mes,tc_actual,tc_promedio';

  // Sin error: solo queda el ultimo mes
  const filas = [
    {establecimiento:'la_vuelta', potrero_ipasto:'LV 11', anio:2026, mes:10, tc_actual:16.25, tc_promedio:24.27},
    {establecimiento:'la_vuelta', potrero_ipasto:'LV 9', anio:2026, mes:10, tc_actual:14.32, tc_promedio:17.47},
    {establecimiento:'la_vuelta', potrero_ipasto:'LV 11', anio:2026, mes:9, tc_actual:20.1, tc_promedio:22.0},
    {establecimiento:'la_vuelta', potrero_ipasto:'LV 9', anio:2026, mes:9, tc_actual:0, tc_promedio:19.0}
  ];
  const ok = clienteFalso(filas);
  await sync(ok.client);
  const guardado = JSON.parse(win.localStorage.getItem('la_vuelta_pasto_ipasto') || 'null');
  chequear('pide la tabla crecimiento_pasto', ok.pedido.tabla === 'crecimiento_pasto', ok.pedido.tabla);
  chequear('el select pide exactamente las columnas acordadas', ok.pedido.select === SELECT, ok.pedido.select);
  chequear('filtra por establecimiento la_vuelta', ok.pedido.eq.some(([c,v]) => c==='establecimiento' && v==='la_vuelta'));
  chequear('guarda solo octubre de 2026', guardado && guardado.anio===2026 && guardado.mes===10, JSON.stringify(guardado));
  chequear('guarda LV 11 y LV 9 de octubre', guardado && guardado.filas && guardado.filas['LV 11'] && guardado.filas['LV 9'] && guardado.filas['LV 11'].tc_actual===16.25, JSON.stringify(guardado));
  chequear('no guarda filas de septiembre', guardado && !(guardado.filas['LV 11'] && guardado.filas['LV 11'].tc_actual===20.1), JSON.stringify(guardado));
  chequear('guarda leidoEn', guardado && typeof guardado.leidoEn === 'number');

  // Con error: queda lo guardado de antes, sin tirar error (dato de hace 7 horas, asi intenta leer)
  const anterior = datosPasto(2026, 10, {"LV 11":{tc_actual:99,tc_promedio:1}}, Date.now() - 7*60*60*1000);
  win.localStorage.setItem('la_vuelta_pasto_ipasto', anterior);
  let tiro = false;
  try { await sync(clienteFalso(null, {message:'x'}).client); } catch(e){ tiro = true; }
  chequear('con error de Supabase no tira error hacia afuera', !tiro);
  chequear('con error de Supabase queda lo guardado de antes', win.localStorage.getItem('la_vuelta_pasto_ipasto') === anterior);

  // Con leidoEn reciente (menos de 6 horas) no vuelve a pedir
  const reciente = clienteFalso(filas);
  win.localStorage.setItem('la_vuelta_pasto_ipasto', datosPasto(2026, 10, {"LV 11":{tc_actual:16.25,tc_promedio:24.27}}, Date.now()));
  await sync(reciente.client);
  chequear('con datos de hace menos de 6 horas no vuelve a pedir', reciente.pedido.tabla === null);

  cerrar();
}

(async()=>{
  await probarLaVuelta();
  await probarSinDatos();
  await probarDatoViejo();
  await probarMariaLaura();
  await probarSincronizacion();
  console.log('\n'+(fallas?fallas+' verificacion(es) fallaron':'Todo OK'));
  process.exit(fallas?1:0);
})();
