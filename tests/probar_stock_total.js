/*
 * Prueba ad-hoc: "📊 Stock total" (categorías / potreros / temporada con
 * nacimientos y muertes) — cubre tanto PC (nuevo, esta sesión) como móvil
 * (ya existía, sin test dedicado hasta ahora).
 * Verifica: el resumen general, la tabla de categorías, la lista de
 * potreros (con saldo negativo en rojo si lo hay), y que nacimientos/
 * muertes de temporada sumen bien contra eventos_sync mockeado.
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

function crearServidor(eventosSemilla){
  const filas = { eventos_sync: eventosSemilla.slice() };
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          select(){ return q; }, eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          then(res){ const data = (filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r))); return Promise.resolve(res({data, error:null})); }
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
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + '\n;window.__est = function(){ return estado; };window.__establecimiento = function(){ return ESTABLECIMIENTO; };'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

// mes actual real (la app calcula la temporada contra "hoy") -- para que el
// mock siempre caiga dentro de la temporada actual sin importar cuándo se
// corra esta prueba.
function fechaEnTemporada(diaOffset){
  const hoy = new Date();
  let mes = hoy.getMonth() + 1, anio = hoy.getFullYear();
  if(mes < 8){ mes = 9; } // fuera de temporada (ene-jul): usamos setiembre del año pasado
  if(hoy.getMonth()+1 < 8) anio -= 1;
  const dia = String(Math.min(28, 1 + diaOffset)).padStart(2,'0');
  return `${dia}/${String(mes).padStart(2,'0')}/${anio}`;
}

async function probarArchivo(archivo, tieneDueno){
  console.log('\n=== ' + archivo + ' ===');
  const eventos = [
    { establecimiento: 'la_vuelta', tipo: 'nacimiento', fecha_cliente: fechaEnTemporada(1), detalle: { cantidad: 3 } },
    { establecimiento: 'la_vuelta', tipo: 'nacimiento', fecha_cliente: fechaEnTemporada(2), detalle: { cantidad: 2 } },
    { establecimiento: 'la_vuelta', tipo: 'muerte', fecha_cliente: fechaEnTemporada(3), detalle: { cantidad: 1 } },
    { establecimiento: 'maria_laura', tipo: 'nacimiento', fecha_cliente: fechaEnTemporada(1), detalle: { cantidad: 4 } },
    { establecimiento: 'pone_chico', tipo: 'nacimiento', fecha_cliente: fechaEnTemporada(1), detalle: { cantidad: 9 } },
  ];
  const servidor = crearServidor(eventos);
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  chequear('boton btn-stock presente', !!doc.getElementById('btn-stock'));
  chequear('modal-stock presente', !!doc.getElementById('modal-stock'));

  const est = win.__est();
  const nombresPotreros = Object.keys(est.potreros);
  if(!nombresPotreros.length){
    // Pone Chico recién creado: sin potreros todavía, alcanza con que no rompa.
    doc.getElementById('btn-stock').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r=>setTimeout(r,30));
    chequear('sin potreros, categorías no rompe (sin animales registrados)',
      doc.getElementById('stock-panel-0').innerHTML.includes('Sin animales registrados'));
    return;
  }

  // poner todo el stock a cero (los archivos ya traen animales de fábrica)
  // antes de sembrar valores conocidos -- si no, el total esperado no da.
  nombresPotreros.forEach(n=>{ Object.keys(est.potreros[n].animales).forEach(k=> est.potreros[n].animales[k]=0); });
  const p1 = nombresPotreros[0], p2 = nombresPotreros[1];
  const claveVacas1 = tieneDueno ? 'Vacas||Pedro' : 'Vacas';
  const claveTerneros2 = tieneDueno ? 'Terneros||Pedro' : 'Terneros';
  est.potreros[p1].animales[claveVacas1] = 10;
  est.potreros[p2].animales[claveTerneros2] = 4;

  doc.getElementById('btn-stock').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,30));

  chequear('resumen general muestra el total de animales', doc.getElementById('stock-resumen').textContent.includes('14 animales'));
  const panelCat = doc.getElementById('stock-panel-0').innerHTML;
  chequear('categorías: Vacas figura con 10', /Vacas[\s\S]{0,40}>10</.test(panelCat), panelCat);
  chequear('categorías: total general es 14', /Total[\s\S]{0,40}>14</.test(panelCat), panelCat);

  // pestaña Potreros
  doc.getElementById('stock-tabs').querySelector('[data-tab="1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const panelPot = doc.getElementById('stock-panel-1').innerHTML;
  chequear('potreros: aparece el potrero con stock', panelPot.includes(p1) && panelPot.includes('10 animales'));
  chequear('pestaña Potreros pasa a ser la visible', doc.getElementById('stock-panel-1').style.display !== 'none');
  chequear('pestaña Categorías se oculta', doc.getElementById('stock-panel-0').style.display === 'none');

  // pestaña Temporada — nacimientos y muertes correctos, sin mezclar establecimientos
  doc.getElementById('stock-tabs').querySelector('[data-tab="2"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,30));
  const panelTemp = doc.getElementById('stock-panel-2').innerHTML;
  const esperado = { la_vuelta: {nac:5, mue:1}, maria_laura: {nac:4, mue:0}, pone_chico: {nac:9, mue:0} }[win.__establecimiento()];
  chequear(`temporada: ${esperado.nac} nacimientos (solo de este establecimiento)`, panelTemp.includes(`<strong>${esperado.nac}</strong> nacimientos`), panelTemp);
  if(esperado.mue>0){
    chequear(`temporada: ${esperado.mue} muertes`, panelTemp.includes(`<strong>${esperado.mue}</strong> muertes`), panelTemp);
  } else {
    chequear('temporada: 0 muertes', panelTemp.includes('<strong>0</strong> muertes'), panelTemp);
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos){
    const tieneDueno = /maria_laura|pone_chico/.test(a);
    await probarArchivo(a, tieneDueno);
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
