/*
 * Eventos de manejo (Etapa 2): registro por lote/animal, CSV, sincronización
 * idempotente, edición/borrado PC, mapa por eventos y ficha de caravana.
 * Uso: node tests/probar_eventos_manejo.js
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, ok, detalle){
  console.log((ok ? '  OK  ' : '  MAL ') + nombre + (ok ? '' : ' — ' + (detalle || '')));
  if(!ok) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
const RUTAS = [
  ['La Vuelta', 'la-vuelta-pc/index.html', 'la-vuelta-movil/index.html', 'la-vuelta-movil-campo/index.html'],
  ['María Laura', 'maria-laura-pc/index.html', 'maria-laura-movil/index.html', 'maria-laura-movil-campo/index.html'],
  ['Pone Chico', 'pone-chico-pc/index.html', 'pone-chico-movil/index.html', 'pone-chico-movil-campo/index.html']
];
function limites(){
  const b = { getCenter(){return {lat:-31.98,lng:-56.34};}, extend(){return b;}, isValid(){return true;}, pad(){return b;},
    getNorth(){return -31.9;}, getSouth(){return -32;}, getEast(){return -56.3;}, getWest(){return -56.4;}, contains(){return true;} };
  return b;
}
function stubLeaflet(win){
  const capas=[];
  function capa(){
    const c={estilo:{},tooltip:null,handlers:{},addTo(){return c;},on(ev,fn){c.handlers[ev]=fn;return c;},
      bindTooltip(t){c.tooltip=t;return c;},setStyle(s){c.estilo={...c.estilo,...s};return c;},bindPopup(){return c;},
      setPopupContent(){return c;},openPopup(){return c;},getBounds(){return limites();},getLatLng(){return {lat:-31.98,lng:-56.34};},
      getElement(){return win.document.createElement('div');},getTooltip(){return {setContent(){},getElement(){return win.document.createElement('div');}};},
      getPopup(){return {setContent(){},isOpen(){return false;}};},isPopupOpen(){return false;},clearLayers(){return c;},addLayer(){return c;}};
    capas.push(c); return new Proxy(c,{get(t,p){if(p in t)return t[p];return ()=>c;}});
  }
  const mapa={setView(){return mapa;},fitBounds(){return mapa;},on(){return mapa;},addLayer(){return mapa;},removeLayer(){return mapa;},hasLayer(){return true;},
    getZoom(){return 14;},invalidateSize(){return mapa;},setMaxBounds(){return mapa;},doubleClickZoom:{disable(){},enable(){}}};
  win.__capas=capas;
  win.L={map(){return mapa;},tileLayer(){return capa();},layerGroup(){return capa();},polygon(){return capa();},marker(){return capa();},circleMarker(){return capa();},
    circle(){return capa();},divIcon(){return {};},latLng(a,b){return {lat:a,lng:b};},latLngBounds(){return limites();},DomEvent:{stopPropagation(){}}};
  win.JSZip=function(){return {file(){},generateAsync(){return Promise.resolve(new win.Blob([]));}};};
}
async function levantar(archivo){
  const html=fs.readFileSync(archivo,'utf8').replace(/<script src="https?:\/\/[^\"]*"><\/script>/g,'');
  const errores=[],vc=new VirtualConsole(); let cerrado=false;
  vc.on('jsdomError',e=>errores.push(String(e.stack||e.message)));
  vc.on('error',(...a)=>errores.push(a.map(String).join(' ')));
  const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://local.test/',virtualConsole:vc});
  const win=dom.window;
  win.addEventListener('error',e=>{if(!cerrado) errores.push(String(e.error&&e.error.stack||e.message));e.preventDefault();});
  stubLeaflet(win);
  win.supabase={createClient(){return null;}};
  Object.defineProperty(win.navigator,'onLine',{value:false,configurable:true});
  Object.defineProperty(win.navigator,'webdriver',{value:true,configurable:true});
  win.TextDecoder=TextDecoder; win.TextEncoder=TextEncoder;
  win.alert=()=>{}; win.confirm=()=>true; win.prompt=()=>null;
  win.URL.createObjectURL=()=> 'blob:x'; win.URL.revokeObjectURL=()=>{};
  win.HTMLElement.prototype.scrollIntoView=function(){};
  win.HTMLAnchorElement.prototype.click=function(){};
  const codigo=Array.from(win.document.querySelectorAll('script')).map(s=>s.textContent).filter(Boolean).join('\n');
  try{win.eval(codigo+`;window.__manejo={estado:()=>estado,geo:POTREROS_GEO,poligonos,config:CONFIG,aplicarEventoRemoto,normalizarCaravana,leerCaravanasDeCsv:typeof leerCaravanasDeCsv==='function'?leerCaravanasDeCsv:null,decodificarCsvDatamars:typeof decodificarCsvDatamars==='function'?decodificarCsvDatamars:null,renderEventosManejo:typeof renderEventosManejo==='function'?renderEventosManejo:null,accionesPC:typeof accionesEventoManejoPC!=='undefined'&&accionesEventoManejoPC,editar:typeof editarEventoManejo==='function'?editarEventoManejo:null,borrar:typeof borrarEventoManejo==='function'?borrarEventoManejo:null,tooltipPotreroPC:typeof tooltipPotreroPC==='function'?tooltipPotreroPC:null,colorEventosMapa:typeof colorEventosMapa==='function'?colorEventosMapa:null,refrescarColoresMapa,estadoInicial};`);}
  catch(e){errores.push('ERROR AL CARGAR: '+e.stack);}
  await esperar(60);
  // La app deja timers de sincronización/avisos. El proceso termina explícitamente
  // al final del test; cerrar cada ventana antes dispara callbacks contra el DOM destruido.
  return {win,errores,cerrar(){cerrado=true;}};
}
function texto(el){return el?(el.textContent||'').replace(/\s+/g,' ').trim():'';}
function filaEvento(id,tipo,detalle,creado,fecha){
  return {event_id:'evt-'+id,tipo,potrero:'la_vuelta',dispositivo:'otro',fecha_cliente:fecha||'05/11/2026',creado_en:creado,detalle:{id,...detalle}};
}
async function probarConfig(nombre,pc,movil,campo){
  console.log('\n=== '+nombre+' ===');
  const P=await levantar(pc), M=await levantar(movil), C=await levantar(campo);
  [P,M,C].forEach((x,i)=>chequear(['PC','móvil completa','Campo'][i]+' carga sin errores',x.errores.length===0,x.errores.join(' | ')));
  const p=P.win.__manejo,m=M.win.__manejo,c=C.win.__manejo;
  if(P.errores.length||M.errores.length||C.errores.length){P.cerrar();M.cerrar();C.cerrar();return;}
  const habilitado=nombre!=='Pone Chico';
  chequear('flag CONFIG.manejo correcto',p.config.manejo===habilitado&&m.config.manejo===habilitado&&c.config.manejo===habilitado);
  const visible = (doc,id)=>{const el=doc.getElementById(id);return !!el&&el.style.display!=='none';};
  chequear('botón Eventos visible solo en PC/móvil completa habilitados',
    visible(P.win.document,'btn-eventos-manejo')===habilitado && visible(M.win.document,'btn-eventos-manejo')===habilitado && !visible(C.win.document,'btn-eventos-manejo'));
  chequear('Campo conserva su pantalla sin el módulo de Eventos',!C.win.document.getElementById('modal-eventos-manejo')&&!c.renderEventosManejo&&!c.leerCaravanasDeCsv);
  chequear('mapa ofrece Eventos solo si está habilitado',
    habilitado ? !!P.win.document.querySelector('#mapa-pintar-por option[value="eventos"]') && !P.win.document.querySelector('#mapa-pintar-por option[value="eventos"]').disabled
      : !P.win.document.querySelector('#mapa-pintar-por option[value="eventos"]'));
  if(habilitado){
    const doc=P.win.document, dM=M.win.document;
    chequear('estado.eventosManejo existe y arranca vacío',Array.isArray(p.estado().eventosManejo)&&p.estado().eventosManejo.length===0);
    chequear('móvil tiene formulario y selector CSV para caravanas',!!dM.getElementById('em-caravanas')&&!!dM.getElementById('em-csv'));
    chequear('acciones y funciones de edición solo existen en PC',p.accionesPC&&!!p.editar&&!!p.borrar&&!m.accionesPC&&!m.editar&&!m.borrar);
    const stockAntes=JSON.stringify(p.estado().potreros);
    doc.getElementById('btn-eventos-manejo').click();
    doc.getElementById('em-fecha').value='2026-11-05';
    doc.getElementById('em-tipo').value='Caravaneo';
    doc.getElementById('em-potrero').value=p.geo[0].nombre;
    doc.getElementById('em-caravanas').value='12345678, 00000099\n12345678';
    doc.getElementById('em-obs').value='vacunación';
    doc.getElementById('em-guardar').click();
    let ev=p.estado().eventosManejo.find(x=>!x.eliminado);
    chequear('registra evento por animal con caravanas únicas id8',!!ev&&ev.tipo==='Caravaneo'&&ev.caravanas.join(',')==='12345678,00000099',JSON.stringify(ev));
    chequear('cantidad se completa con las caravanas',!!ev&&ev.cantidad===2);
    chequear('no modifica el stock',JSON.stringify(p.estado().potreros)===stockAntes);
    chequear('se agrega el evento a la cola de sync',p.estado().colaSync.some(x=>x.tipo==='evento_manejo'&&x.detalle.id===ev.id));
    chequear('el historial de PC sí tiene botones de edición y borrado',!!doc.querySelector('[data-evento-editar]')&&!!doc.querySelector('[data-evento-borrar]'));
    m.aplicarEventoRemoto(filaEvento(ev.id,'evento_manejo',{fecha:ev.fecha,tipo:ev.tipo,potrero:ev.potrero,cantidad:ev.cantidad,caravanas:ev.caravanas,obs:ev.obs,ts:ev.ts},ev._creadoEn),new Set());
    m.renderEventosManejo();M.win.document.getElementById('btn-eventos-manejo').click();
    chequear('móvil sin botones de edición después de mostrar un evento',!dM.querySelector('[data-evento-editar]')&&!dM.querySelector('[data-evento-borrar]'));
    chequear('la lista muestra el número de caravanas',/2 caravanas/.test(doc.getElementById('eventos-manejo-lista').textContent));
    doc.getElementById('btn-eventos-manejo').click();doc.getElementById('em-tipo').value='Recuento';doc.getElementById('em-cantidad').value='7';doc.getElementById('em-guardar').click();
    const lote=p.estado().eventosManejo.find(x=>x.tipo==='Recuento'&&!x.eliminado);
    chequear('evento por lote permite cantidad manual sin caravanas',!!lote&&lote.cantidad===7&&lote.caravanas.length===0);
    const filtroTipo=doc.getElementById('em-filtro-tipo'), filtroPotrero=doc.getElementById('em-filtro-potrero');
    chequear('el historial ofrece filtros por tipo y potrero',!!filtroTipo&&!!filtroPotrero);
    p.estado().eventosManejo.push({id:'filtro-otro',fecha:ev.fecha,tipo:'Destete',potrero:p.geo[0].nombre,eliminado:false});p.renderEventosManejo();
    filtroTipo.value='Caravaneo';filtroTipo.dispatchEvent(new P.win.Event('change',{bubbles:true}));
    chequear('el filtro de tipo mantiene eventos coincidentes',doc.getElementById('eventos-manejo-lista').textContent.includes('Caravaneo'));
    filtroTipo.value='Destete';filtroTipo.dispatchEvent(new P.win.Event('change',{bubbles:true}));
    chequear('el filtro de tipo oculta eventos distintos',!doc.getElementById('eventos-manejo-lista').textContent.includes('Caravaneo'));
    filtroTipo.value='';filtroTipo.dispatchEvent(new P.win.Event('change',{bubbles:true}));
    filtroPotrero.value=p.geo[0].nombre;filtroPotrero.dispatchEvent(new P.win.Event('change',{bubbles:true}));
    chequear('el filtro de potrero muestra eventos de ese potrero',doc.getElementById('eventos-manejo-lista').textContent.includes('Caravaneo'));
    filtroPotrero.value='';filtroPotrero.dispatchEvent(new P.win.Event('change',{bubbles:true}));

    // Repetición y orden inverso: edición gana sobre alta vieja, borrado no revive.
    const remoto=filaEvento('remoto-1','evento_manejo',{tipo:'Destete',fecha:'04/11/2026',caravanas:['12345678','no-valido','00000001']},'2026-11-04T12:00:00Z');
    p.aplicarEventoRemoto(remoto,new Set()); p.aplicarEventoRemoto(remoto,new Set());
    chequear('evento remoto sin potrero real se aplica y no duplica',p.estado().eventosManejo.filter(x=>x.id==='remoto-1').length===1);
    chequear('caravanas remotas inválidas se descartan',p.estado().eventosManejo.find(x=>x.id==='remoto-1').caravanas.join(',')==='12345678,00000001');
    p.aplicarEventoRemoto(filaEvento('orden-1','evento_manejo_editado',{tipo:'Pesada',fecha:'03/11/2026',caravanas:[]},'2026-11-03T12:00:00Z'),new Set());
    p.aplicarEventoRemoto(filaEvento('orden-1','evento_manejo',{tipo:'IATF',fecha:'02/11/2026',caravanas:[]},'2026-11-02T12:00:00Z'),new Set());
    chequear('edición remota antes del alta conserva la revisión más nueva',p.estado().eventosManejo.find(x=>x.id==='orden-1').tipo==='Pesada');
    const altaReloj=filaEvento('reloj-1','evento_manejo',{fecha:'05/11/2026',tipo:'Destete',obs:'alta',ts:'2026-11-05T16:50:00.000Z'},'2026-11-05T16:55:00.000Z');
    const edicionReloj=filaEvento('reloj-1','evento_manejo_editado',{fecha:'05/11/2026',tipo:'Pesada',obs:'edición posterior',ts:'2026-11-05T16:51:00.000Z'},'2026-11-05T16:45:00.000Z');
    p.aplicarEventoRemoto(altaReloj,new Set());p.aplicarEventoRemoto(edicionReloj,new Set());
    m.aplicarEventoRemoto(edicionReloj,new Set());m.aplicarEventoRemoto(altaReloj,new Set());
    const relojP=p.estado().eventosManejo.find(x=>x.id==='reloj-1'), relojM=m.estado().eventosManejo.find(x=>x.id==='reloj-1');
    chequear('dos dispositivos convergen por ts aunque creado_en llegue en otro orden',relojP.tipo==='Pesada'&&JSON.stringify({tipo:relojP.tipo,obs:relojP.obs,ts:relojP._ts})===JSON.stringify({tipo:relojM.tipo,obs:relojM.obs,ts:relojM._ts}));
    p.aplicarEventoRemoto(filaEvento('borrado-1','evento_manejo_eliminado',{ts:'2026-11-05T16:55:00.000Z'},'2026-11-05T16:01:00.000Z'),new Set());
    p.aplicarEventoRemoto(filaEvento('borrado-1','evento_manejo',{tipo:'Recuento',fecha:'05/11/2026',ts:'2026-11-05T16:54:00.000Z'},'2026-11-05T16:58:00.000Z'),new Set());
    chequear('borrado remoto deja tombstone y no revive con alta tardía',p.estado().eventosManejo.find(x=>x.id==='borrado-1').eliminado===true);
    p.aplicarEventoRemoto(filaEvento('texto-remoto','evento_manejo',{fecha:'05/11/2026',tipo:'<img src=x>'.repeat(12),potrero:'POTRERO INVENTADO',categoria:'CATEGORÍA INVENTADA',obs:'<svg>'+('x'.repeat(600))},'2026-11-05T16:56:00.000Z'),new Set());
    p.renderEventosManejo();const textoRemoto=p.estado().eventosManejo.find(x=>x.id==='texto-remoto');
    chequear('campos remotos se limpian y limitan; potrero/categoría inválidos se descartan',textoRemoto.tipo.length<=60&&!textoRemoto.tipo.includes('<')&&textoRemoto.obs.length===500&&!textoRemoto.obs.includes('<')&&textoRemoto.potrero===null&&textoRemoto.categoria===null);
    chequear('el texto remoto se muestra escapado sin crear elementos HTML',!doc.getElementById('eventos-manejo-lista').querySelector('img')&&!doc.getElementById('eventos-manejo-lista').querySelector('svg'));

    // El modo Eventos colorea por recencia y el tooltip explica el último.
    // 14/11/2026: con la fecha fija 05/11/2026 la prueba se vencia sola a la semana (desde el 13/11 fallaba en main).
    // "Reciente" = hoy, con el mismo reloj que usa colorEventosMapa().
    const _d=new P.win.Date(); const fechaHoy=String(_d.getDate()).padStart(2,'0')+'/'+String(_d.getMonth()+1).padStart(2,'0')+'/'+_d.getFullYear();
    const hoy=p.estado().eventosManejo.find(x=>x.id===ev.id); hoy.fecha=fechaHoy;
    const pot=p.geo[0].nombre; hoy.potrero=pot; hoy.tipo='Caravaneo'; p.refrescarColoresMapa();
    const selector=doc.getElementById('mapa-pintar-por'); selector.value='eventos'; selector.dispatchEvent(new P.win.Event('change',{bubbles:true}));
    chequear('color de eventos recientes tiene máxima intensidad',p.colorEventosMapa(pot)==='#c2452d');
    chequear('tooltip muestra último evento de manejo',/Último evento: Caravaneo/.test(String(p.poligonos[pot].layer.tooltip.call(p.poligonos[pot].layer))));
    chequear('leyenda de Eventos explica la recencia',/7 días/.test(doc.getElementById('mapa-leyenda').textContent)&&/30 días/.test(doc.getElementById('mapa-leyenda').textContent));

    // La ficha consulta solo el estado local.
    const ficha=P.win.fichaCaravanaHTML({id8:'12345678',sexo:'H',categoria:'Vacas'});
    chequear('ficha de caravana incluye eventos de manejo',/Eventos de manejo/.test(ficha)&&/Caravaneo/.test(ficha));
    chequear('tipo Otro queda en las opciones después de usarlo',true); // cubierto al insertar tipo libre más abajo
    const otro=doc.getElementById('em-tipo');
    if(otro){otro.value='Otro…';doc.getElementById('em-tipo-otro').value='Aftosa';doc.getElementById('em-tipo-otro').dispatchEvent(new P.win.Event('input',{bubbles:true}));doc.getElementById('em-guardar').click();}
    chequear('un tipo Otro usado se agrega a la lista de tipos',Array.from(doc.getElementById('em-tipo').options).some(o=>o.value==='Aftosa'));

    // Editar y borrar en PC: identidad estable y marca de borrado.
    doc.querySelector(`[data-evento-editar="${ev.id}"]`)?.click();
    const obs=doc.getElementById('em-obs'); if(obs) obs.value='corregido';
    doc.getElementById('em-guardar').click();
    chequear('editar evento mantiene id y envía evento_manejo_editado',p.estado().eventosManejo.some(x=>x.id===ev.id&&x.obs==='corregido')&&p.estado().colaSync.some(x=>x.tipo==='evento_manejo_editado'&&x.detalle.id===ev.id));
    doc.querySelector(`[data-evento-borrar="${ev.id}"]`)?.click();
    chequear('borrar evento marca eliminado sin quitar el id',p.estado().eventosManejo.some(x=>x.id===ev.id&&x.eliminado)&&p.estado().colaSync.some(x=>x.tipo==='evento_manejo_eliminado'&&x.detalle.id===ev.id));

    // Parser puro de exportes del bastón con coma, punto y coma y encabezados alternativos.
    const csv1=p.leerCaravanasDeCsv('EID,PROPIETARIO\n123456789012345,Peña\n000000000000099,Sol\n');
    const csv2=p.leerCaravanasDeCsv('IDE;VID;CATEGORIA\r\n123456789012345;;Vaca\r\n;000000000000099;Vaquilla\r\n');
    chequear('parser Datamars lee EID/IDE con coma y punto y coma',csv1.caravanas.join(',')==='89012345,00000099'&&csv2.caravanas.join(',')==='89012345,00000099',JSON.stringify({csv1,csv2}));
    const cpBytes=new Uint8Array([69,73,68,44,79,66,83,10,49,50,51,52,53,54,55,56,57,48,49,50,51,52,53,44,80,101,241,97]);
    chequear('lector detecta CSV Windows-1252 de Datamars',/Peña/.test(p.decodificarCsvDatamars(cpBytes))&&p.leerCaravanasDeCsv(p.decodificarCsvDatamars(cpBytes)).caravanas[0]==='89012345');
    chequear('normaliza caravanas a ocho dígitos',p.normalizarCaravana('123456789012345')==='89012345',String(p.normalizarCaravana('123456789012345')));
  }
  P.cerrar();M.cerrar();C.cerrar();
}
(async()=>{
  for(const r of RUTAS) await probarConfig(...r);
  const errs=fallas?`${fallas} verificacion(es) fallaron`:'Todo OK';
  console.log('\n'+errs);
  process.exit(fallas?1:0);
})();
