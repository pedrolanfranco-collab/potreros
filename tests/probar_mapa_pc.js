/*
 * Etapa 1: mapa PC con tooltip de carga y colores por UG/ha.
 * También verifica selector/leyenda en las tres PC y que móvil no cambie.
 * Uso: node tests/probar_mapa_pc.js
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
  ['La Vuelta', 'la-vuelta-pc/index.html', 'la-vuelta-movil/index.html'],
  ['María Laura', 'maria-laura-pc/index.html', 'maria-laura-movil/index.html'],
  ['Pone Chico', 'pone-chico-pc/index.html', 'pone-chico-movil/index.html']
];

function limites(){
  const b = { getCenter(){ return {lat:-31.98,lng:-56.34}; }, extend(){ return b; }, isValid(){ return true; },
    pad(){ return b; }, getNorth(){ return -31.9; }, getSouth(){ return -32; }, getEast(){ return -56.3; }, getWest(){ return -56.4; }, contains(){ return true; } };
  return b;
}
function stubLeaflet(win){
  const capas = [];
  function capa(tipo){
    const c = { tipo, estilo:{}, tooltip:null, handlers:{},
      addTo(){ return c; }, on(ev,fn){ c.handlers[ev]=fn; return c; },
      bindTooltip(contenido, opciones){ c.tooltip=contenido; c.tooltipOpciones=opciones; return c; },
      setStyle(estilo){ c.estilo={...c.estilo,...estilo}; return c; },
      bindPopup(){ return c; }, setPopupContent(){ return c; }, openPopup(){ return c; },
      getBounds(){ return limites(); }, getLatLng(){ return {lat:-31.98,lng:-56.34}; },
      getElement(){ return win.document.createElement('div'); }, getTooltip(){ return {setContent(){},getElement(){return win.document.createElement('div');}}; },
      getPopup(){ return {setContent(){},isOpen(){return false;}}; }, isPopupOpen(){ return false; }, clearLayers(){ return c; }, addLayer(){ return c; }
    };
    capas.push(c);
    return new Proxy(c,{get(t,p){ if(p in t) return t[p]; return (...args)=>c; }});
  }
  const mapa = { setView(){return mapa;}, fitBounds(){return mapa;}, on(){return mapa;}, addLayer(){return mapa;}, removeLayer(){return mapa;},
    hasLayer(){return true;}, getZoom(){return 14;}, invalidateSize(){return mapa;}, setMaxBounds(){return mapa;}, doubleClickZoom:{disable(){},enable(){}} };
  win.__capas = capas;
  win.L = { map(){return mapa;}, tileLayer(){return capa('tile');}, layerGroup(){return capa('group');}, polygon(){return capa('polygon');}, marker(){return capa('marker');},
    circleMarker(){return capa('circleMarker');}, circle(){return capa('circle');}, divIcon(){return {};}, latLng(a,b){return {lat:a,lng:b};}, latLngBounds(){return limites();}, DomEvent:{stopPropagation(){}} };
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
  try { win.eval(codigo+';window.__prueba={estado,poligonos,geo:POTREROS_GEO,dobles:POTREROS_DOBLES,config:CONFIG,areaCalc:AREA_CALCULADA,areaHa,totalPotrero,color:typeof colorDotacionMapa===\'function\'?colorDotacionMapa:null,refrescarColoresMapa,seleccionarPotrero};'); }
  catch(e){ errores.push('ERROR AL CARGAR: '+e.stack); }
  await esperar(60);
  return {win,errores,cerrar(){win.close();}};
}
function tooltipTexto(layer){
  const contenido = layer && layer.tooltip;
  return typeof contenido === 'function' ? contenido.call(layer) : contenido;
}
function textoPlano(html){ return String(html||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function colorPara(win,nombre,ratio){
  const p = win.__prueba;
  const ha = p.areaHa(nombre);
  const dueño = (p.config.duenos||[])[0] || '';
  p.estado.potreros[nombre].animales = {['Vacas||'+dueño]: ha*ratio};
  p.refrescarColoresMapa();
  return p.poligonos[nombre].layer.estilo.fillColor;
}

async function probarPC(nombre,archivo){
  console.log('\n=== '+nombre+' PC ===');
  const {win,errores,cerrar}=await levantar(archivo);
  chequear('carga sin errores',errores.length===0,errores.join(' | '));
  if(errores.length){cerrar();return;}
  const doc=win.document, p=win.__prueba;
  const selector=doc.getElementById('mapa-pintar-por');
  chequear('tiene selector de modo de pintado',!!selector);
  chequear('el modo inicial es Dotación',!!selector&&selector.value==='dotacion',selector&&selector.value);
  chequear('Eventos todavía no está habilitado en Etapa 1',!selector||!selector.querySelector('option[value="eventos"]')||selector.querySelector('option[value="eventos"]').disabled);
  chequear('tiene leyenda con rangos escritos',!!doc.getElementById('mapa-leyenda')&&/0,5/.test(doc.getElementById('mapa-leyenda').textContent)&&/1,2/.test(doc.getElementById('mapa-leyenda').textContent));
  if(p.geo.length){
    const nombrePot=p.geo.find(x=>!Object.prototype.hasOwnProperty.call(p.dobles,x.nombre)&&p.areaHa(x.nombre)>0)?.nombre;
    if(nombrePot){
      const layer=p.poligonos[nombrePot].layer;
      const html=tooltipTexto(layer), txt=textoPlano(html);
      chequear('el tooltip es dinámico (función de Leaflet)',typeof layer.tooltip==='function');
      chequear('muestra nombre, animales, UG, hectáreas y UG/ha',/Animales/i.test(txt)&&/UG/i.test(txt)&&/ha/i.test(txt)&&txt.includes(nombrePot),txt);
      const colores=[
        [.49,'#cfe3a8'],[.5,'#7fb04f'],[.8,'#e0a62a'],[1.2,'#c2452d']
      ];
      colores.forEach(([carga,color])=>chequear('color de carga '+carga+' UG/ha',colorPara(win,nombrePot,carga)===color,p.poligonos[nombrePot].layer.estilo.fillColor));
      const sinArea=p.geo.find(x=>x.nombre!==nombrePot&&!Object.prototype.hasOwnProperty.call(p.dobles,x.nombre));
      if(sinArea){
        const areaOriginal=sinArea.area, calculadaOriginal=p.areaCalc[sinArea.nombre];
        sinArea.area=''; p.areaCalc[sinArea.nombre]=0;
        p.estado.potreros[sinArea.nombre].animales={['Vacas||'+((p.config.duenos||[])[0]||'')]:1};
        p.refrescarColoresMapa();
        chequear('un potrero con animales pero sin área se pinta gris',p.poligonos[sinArea.nombre].layer.estilo.fillColor==='#9a9a8c');
        const tooltipSinArea=textoPlano(tooltipTexto(p.poligonos[sinArea.nombre].layer));
        chequear('el tooltip sin área usa textos claros',/Área: sin dato/.test(tooltipSinArea)&&/Carga: —/.test(tooltipSinArea),tooltipSinArea);
        sinArea.area=areaOriginal; p.areaCalc[sinArea.nombre]=calculadaOriginal;
      } else chequear('hay otro potrero para probar el caso sin área',false);
      p.estado.potreros[nombrePot].animales={['Vacas||'+((p.config.duenos||[])[0]||'')]:2};
      const despues=textoPlano(tooltipTexto(layer));
      chequear('el tooltip refleja cambios de stock sin redibujar el polígono',despues!==txt&&/2/.test(despues),despues);
      p.seleccionarPotrero(nombrePot);
      chequear('el potrero elegido conserva el borde naranja',p.poligonos[nombrePot].layer.estilo.color==='#c68a3b');
      if(selector){
        selector.value='ocupado'; selector.dispatchEvent(new win.Event('change',{bubbles:true}));
        chequear('el modo queda guardado por establecimiento',win.localStorage.getItem(p.config.establecimiento+'_pintar_por')==='ocupado');
        chequear('la leyenda de ocupado explica sus colores',/Con animales/i.test(doc.getElementById('mapa-leyenda').textContent)&&/Sin animales/i.test(doc.getElementById('mapa-leyenda').textContent));
      } else {
        chequear('el modo queda guardado por establecimiento',false,'falta selector');
        chequear('la leyenda de ocupado explica sus colores',false,'falta selector');
      }
    } else chequear('encuentra un potrero con área para probar la carga',false);
  } else {
    chequear('Pone Chico muestra controles aunque todavía no tenga potreros',!!selector&&!!doc.getElementById('mapa-leyenda'));
  }
  if(nombre==='La Vuelta'&&p.dobles['1+2']&&p.poligonos['1+2']){
    const doble='1+2', parte=p.dobles[doble][0];
    p.estado.potreros[doble].animales={'Vacas||Pedro Lanfranco':3};
    p.estado.potreros[parte].animales={};
    const t=textoPlano(tooltipTexto(p.poligonos[parte].layer));
    chequear('una parte tapada muestra los datos del doble en uso',t.includes(doble)&&t.includes('Animales: 3'),t);
  }
  const claveModo=p.config.establecimiento+'_pintar_por';
  cerrar();
  for(const [valorGuardado,modoEsperado,leyendaEsperada,nombreCaso] of [
    ['ocupado','ocupado',/Con animales/i,'restaura modo Ocupado guardado al recargar'],
    ['modo-invalido','dotacion',/UG\/ha/i,'usa Dotación ante una preferencia inválida']
  ]){
    const inicio=await levantar(archivo,{[claveModo]:valorGuardado});
    const selectorInicio=inicio.win.document.getElementById('mapa-pintar-por');
    const leyendaInicio=inicio.win.document.getElementById('mapa-leyenda');
    chequear(nombreCaso,!!selectorInicio&&selectorInicio.value===modoEsperado&&!!leyendaInicio&&leyendaEsperada.test(leyendaInicio.textContent),selectorInicio&&leyendaInicio?selectorInicio.value+' | '+leyendaInicio.textContent:'faltan controles');
    inicio.cerrar();
  }
}
async function probarMovil(nombre,archivo){
  console.log('\n=== '+nombre+' móvil ===');
  const {win,errores,cerrar}=await levantar(archivo);
  chequear('carga sin errores',errores.length===0,errores.join(' | '));
  if(!errores.length){
    chequear('no tiene selector ni leyenda PC',!win.document.getElementById('mapa-pintar-por')&&!win.document.getElementById('mapa-leyenda'));
    const geo=win.__prueba.geo;
    if(geo.length){
      const layer=win.__prueba.poligonos[geo[0].nombre].layer;
      chequear('conserva el tooltip móvil de solo nombre',typeof layer.tooltip==='string'&&layer.tooltip===win.__prueba.geo[0].nombre,layer.tooltip);
    }
  }
  cerrar();
}
(async()=>{
  for(const [nombre,pc,movil] of RUTAS){ await probarPC(nombre,pc); await probarMovil(nombre,movil); }
  console.log('\n'+(fallas?fallas+' verificacion(es) fallaron':'Todo OK'));
  process.exit(fallas?1:0);
})();
