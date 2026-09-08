/*
 * Prueba ad-hoc para el resto de los fixes de la auditoria del 8/9/2026:
 * - vaciarColaSync no debe perder los eventos que quedaban despues de uno
 *   que falla (antes hacia "break" y los descartaba para siempre).
 * - una carga por voz debe poder borrarse despues (antes quedaba sin
 *   "extra" y el boton de borrar no hacia nada).
 * - "Restablecer datos de fabrica" debe avisar si hay cosas sin sincronizar.
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

async function levantar(archivo, fallarPrimeraVez){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  let intento = 0;
  const inserted = [];
  win.supabase = { createClient(){ return { from(tabla){ const q = {
    insert(row){
      intento++;
      if(tabla==='eventos_sync' && fallarPrimeraVez && intento===1) return Promise.resolve({error:{message:'corte de red simulado'}});
      inserted.push(row);
      return Promise.resolve({error:null});
    },
    select(){return q;}, eq(){return q;}, order(){return q;}, then(res){ return Promise.resolve(res({data:[],error:null})); }
  }; return q; } }; } };
  win.__inserted = inserted;
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = (msg) => { win.__ultimoConfirm = msg; return true; };
  win.prompt = () => null;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  win.eval(codigo + `
    ;if(!POTREROS_GEO.length){
      // Pone Chico arranca sin potreros -- se agrega uno a mano (en
      // POTREROS_GEO, de donde sale el <select> del formulario de voz, y
      // en estado.potreros) para poder probar sobre un potrero real. Se le
      // agrega tambien una entrada en "poligonos" con un layer de mentira
      // (refrescarColoresMapa la necesita, y solo se arma en el dibujado
      // inicial del mapa, que ya paso antes de este push).
      POTREROS_GEO.push({nombre:'TEST', area:'10', coords:[[0,0],[0,1],[1,1]]});
      estado.potreros['TEST'] = { animales:{}, historial:[], fechaIngreso:null, fechaSalida:null };
      if(typeof poligonos !== 'undefined'){
        const capaFalsa = new Proxy({}, { get(t,p){ if(p==='getBounds') return ()=>({getCenter:()=>({lat:0,lng:0}), isValid:()=>true, pad:()=>capaFalsa}); return ()=>capaFalsa; } });
        poligonos['TEST'] = { layer: capaFalsa };
      }
    }
    window.__est = function(){ return estado; };
    window.__vaciarColaSync = vaciarColaSync;
    window.__borrarHistorial = borrarHistorial;
    window.__parseVoz = parseComandoVoz;
    window.__confirmarVoz = confirmarAccionVoz;
    window.__construirMD = typeof construirMD==='function' ? construirMD : null;
    window.__construirKML = typeof construirKML==='function' ? construirKML : null;
  `);
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarColaReencola(archivo){
  console.log('\n=== ' + archivo + ' (cola no pierde eventos tras un fallo) ===');
  const { win, errores } = await levantar(archivo, true);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const est = win.__est();
  est.colaSync = [
    {tipo:'ingreso', potrero:'x', detalle:{categoria:'Vacas', cantidad:1}, fecha_cliente:'01/01/2026'},
    {tipo:'ingreso', potrero:'y', detalle:{categoria:'Vacas', cantidad:2}, fecha_cliente:'01/01/2026'},
    {tipo:'ingreso', potrero:'z', detalle:{categoria:'Vacas', cantidad:3}, fecha_cliente:'01/01/2026'}
  ];
  await win.__vaciarColaSync();
  await new Promise(r=>setTimeout(r,30));
  chequear('el primero (que fallo) se reencola', est.colaSync.some(e=>e.potrero==='x'), JSON.stringify(est.colaSync));
  chequear('los que venian DESPUES del que fallo tambien se reencolan (no se pierden)',
    est.colaSync.some(e=>e.potrero==='y') && est.colaSync.some(e=>e.potrero==='z'),
    JSON.stringify(est.colaSync));
}

async function probarVozBorrable(archivo, tieneDueno){
  console.log('\n=== ' + archivo + ' (carga por voz se puede borrar) ===');
  const { win, errores } = await levantar(archivo, false);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const est = win.__est();
  const potreros = Object.keys(est.potreros);
  const p = potreros[0];
  Object.keys(est.potreros[p].animales).forEach(k=> est.potreros[p].animales[k]=0);
  const claveVacas = tieneDueno ? 'Vacas||Pedro' : 'Vacas';

  win.renderInterpretacionVoz(win.__parseVoz(`agregar 8 vacas en el ${p}`));
  doc.getElementById('vz-accion').value = 'nacimiento';
  doc.getElementById('vz-cat').value = 'Vacas';
  if(tieneDueno) doc.getElementById('vz-dueno').value = 'Pedro';
  doc.getElementById('vz-cant').value = '8';
  doc.getElementById('vz-origen').value = p;
  win.__confirmarVoz();

  chequear('la carga por voz sumo el stock', est.potreros[p].animales[claveVacas]===8, JSON.stringify(est.potreros[p].animales));
  const entrada = est.potreros[p].historial.find(h=>h.tipo==='nacimiento' && !h.eliminado);
  chequear('la entrada de historial quedo con "extra"', !!(entrada && entrada.extra), JSON.stringify(entrada));

  win.__borrarHistorial(entrada.id);
  chequear('borrarHistorial() SI revierte una carga por voz (antes no hacia nada)',
    (est.potreros[p].animales[claveVacas]||0)===0, JSON.stringify(est.potreros[p].animales));
}

async function probarExportaNegativos(archivo){
  console.log('\n=== ' + archivo + ' (exportadores muestran categorias en negativo) ===');
  const { win, errores } = await levantar(archivo, false);
  if(errores.length || !win.__construirMD){ console.log('  (no aplica: sin construirMD en este archivo)'); return; }
  const est = win.__est();
  const p = Object.keys(est.potreros)[0];
  Object.keys(est.potreros[p].animales).forEach(k=> est.potreros[p].animales[k]=0);
  est.potreros[p].animales['Toros'] = -2;
  est.potreros[p].animales['Vacas'] = 10;
  const md = win.__construirMD();
  const lineaMD = (md.split('\n').find(l=>l.startsWith(`**${p}**`)) || '');
  chequear('construirMD incluye la categoria en negativo en la linea de ESE potrero', lineaMD.includes('Toros'), 'linea: ' + lineaMD);
  const kml = win.__construirKML();
  const idxPlacemark = kml.indexOf(`<name>${p}</name>`);
  const bloqueKML = kml.slice(idxPlacemark, idxPlacemark+700);
  chequear('construirKML incluye la categoria en negativo en el placemark de ESE potrero', bloqueKML.includes('Toros'), 'bloque: ' + bloqueKML.slice(0,300));
}

async function probarAvisoRestablecer(archivo){
  console.log('\n=== ' + archivo + ' (Restablecer avisa de colas pendientes) ===');
  const { win, errores } = await levantar(archivo, false);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const est = win.__est();
  est.colaSync = [{tipo:'ingreso'}];
  win.document.getElementById('btn-restablecer').dispatchEvent(new win.Event('click', {bubbles:true}));
  chequear('el confirm menciona el movimiento pendiente', /1 movimiento/.test(win.__ultimoConfirm||''), win.__ultimoConfirm);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos){
    const tieneDueno = /maria[_-]laura|pone[_-]chico/.test(a);
    await probarColaReencola(a);
    await probarVozBorrable(a, tieneDueno);
    await probarExportaNegativos(a);
    await probarAvisoRestablecer(a);
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
