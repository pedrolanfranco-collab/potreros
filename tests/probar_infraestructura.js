/*
 * Prueba ad-hoc: "reportes de campo" -- 🔧 Infraestructura (caño/bebedero/
 * alambrado roto) y 🌾 Capín Annoni (30/9/2026, a pedido). Mismo criterio
 * que "puntos" (Aguadas/instalaciones, ver probar_importar_puntos.js): sin
 * potrero real, aplicado en aplicarEventoRemoto ANTES del guard de potrero,
 * idempotente por id. A diferencia de "puntos", cada entrada tiene un
 * tercer estado ("resuelto", no solo crear/eliminar) y se puede ubicar por
 * GPS de un solo toque (capturarUbicacionActual, primer getCurrentPosition
 * del archivo) además de tocar el mapa.
 *
 * IMPORTANTE (a diferencia de btn-puntos, oculto con display:none y nunca
 * desocultado en móvil -- bug preexistente, no tocado en este cambio):
 * btn-infraestructura/btn-capin-annoni tienen que estar VISIBLES en ambas
 * variantes. Ver la verificación explícita más abajo.
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
    latLngBounds(){ return limites(); }, DomEvent: { stopPropagation(){} } };
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
  // Stub de GPS (jsdom no implementa Geolocation) -- ubicación fija, lista
  // de coordenadas para poder pisarla por llamada si hace falta.
  win.__gpsCoords = { lat: -31.40, lon: -55.43, acc: 12 };
  Object.defineProperty(win.navigator, 'geolocation', {
    value: {
      getCurrentPosition(ok){ ok({ coords: { latitude: win.__gpsCoords.lat, longitude: win.__gpsCoords.lon, accuracy: win.__gpsCoords.acc } }); }
    },
    configurable: true
  });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__reportes = function(){ return estado.reportes||[]; };' +
      '\n;window.__reportesLayers = function(){ return reportesLayers; };');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const tieneGPS = !!doc.getElementById('rp-gps'); // solo variante móvil

  chequear('estado.reportes arranca vacío', Array.isArray(win.__reportes()) && win.__reportes().length===0);
  chequear('botón Infraestructura presente y VISIBLE (no display:none)',
    !!doc.getElementById('btn-infraestructura') && doc.getElementById('btn-infraestructura').style.display !== 'none');
  chequear('botón Capín Annoni presente y VISIBLE (no display:none)',
    !!doc.getElementById('btn-capin-annoni') && doc.getElementById('btn-capin-annoni').style.display !== 'none');

  // --- abrir Infraestructura: 4 subtipos, select visible ---
  doc.getElementById('btn-infraestructura').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('modal-reporte se abre', doc.getElementById('modal-reporte').style.display === 'flex');
  chequear('título "🔧 Infraestructura"', doc.getElementById('reporte-titulo').textContent.includes('Infraestructura'));
  chequear('fila de subtipo visible (4 opciones)', doc.getElementById('reporte-fila-subtipo').style.display !== 'none');
  chequear('el select trae los 4 subtipos', doc.getElementById('rp-subtipo').options.length === 4);
  chequear('fecha precargada con hoy', doc.getElementById('rp-fecha').value === win.fechaISOHoy());

  // --- A: crear un reporte de Infraestructura tocando el mapa ---
  doc.getElementById('rp-subtipo').value = 'Caño roto';
  doc.getElementById('rp-obs').value = 'Cerca de la tranquera norte';
  doc.getElementById('rp-mapa').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('el modal se cierra al pasar a modo "tocar el mapa"', doc.getElementById('modal-reporte').style.display === 'none');
  win.colocarReporteEn({ lat: -31.40, lng: -55.43 });
  let reportes = win.__reportes();
  chequear('el reporte queda en estado.reportes con categoria/subtipo/obs correctos',
    reportes.length === 1 && reportes[0].categoria==='infraestructura' && reportes[0].subtipo==='Caño roto' && reportes[0].obs==='Cerca de la tranquera norte' && reportes[0].resuelto===false,
    JSON.stringify(reportes));
  await new Promise(r=>setTimeout(r,30));
  chequear('se mandó reporte_creado a Supabase', servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.subtipo==='Caño roto'));

  // --- B: Capín Annoni -- un solo subtipo, select oculto ---
  doc.getElementById('btn-capin-annoni').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('título "🌾 Capín Annoni"', doc.getElementById('reporte-titulo').textContent.includes('Capín Annoni'));
  chequear('fila de subtipo OCULTA (un solo subtipo posible)', doc.getElementById('reporte-fila-subtipo').style.display === 'none');

  if(tieneGPS){
    // --- C: crear un reporte de Capín Annoni por GPS (un solo toque) ---
    doc.getElementById('rp-obs').value = 'Foco cerca del arroyo';
    win.__gpsCoords = { lat: -31.41, lon: -55.44, acc: 8 };
    doc.getElementById('rp-gps').dispatchEvent(new win.Event('click', { bubbles: true }));
    reportes = win.__reportes();
    const capinGps = reportes.find(r=>r.categoria==='capin_annoni');
    chequear('el reporte por GPS queda con las coordenadas capturadas',
      !!capinGps && capinGps.subtipo==='Foco de capín annoni' && capinGps.lat===-31.41 && capinGps.lon===-55.44 && capinGps.obs==='Foco cerca del arroyo',
      JSON.stringify(capinGps));
    chequear('el modal NO se cierra tras guardar por GPS (se puede seguir cargando)', doc.getElementById('modal-reporte').style.display === 'flex');
    await new Promise(r=>setTimeout(r,30));
    chequear('se mandó reporte_creado (GPS) a Supabase',
      servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.categoria==='capin_annoni' && f.detalle.lat===-31.41));
  } else {
    chequear('botón GPS ausente en esta variante (esperado, no es móvil)', !tieneGPS);
    // en PC, cargar el Capín Annoni por el flujo de "tocar el mapa" para poder seguir probando resolver/eliminar
    doc.getElementById('rp-obs').value = 'Foco cerca del arroyo';
    doc.getElementById('rp-mapa').dispatchEvent(new win.Event('click', { bubbles: true }));
    win.colocarReporteEn({ lat: -31.41, lng: -55.44 });
  }
  doc.getElementById('reporte-cerrar').dispatchEvent(new win.Event('click', { bubbles: true }));

  // --- D: marcar como Resuelto (con confirmación) ---
  doc.getElementById('btn-infraestructura').dispatchEvent(new win.Event('click', { bubbles: true }));
  const idInfra = win.__reportes().find(r=>r.categoria==='infraestructura').id;
  chequear('fila activa tiene botón "✓ Resuelto"', !!doc.querySelector(`[data-resolver="${idInfra}"]`));
  doc.querySelector(`[data-resolver="${idInfra}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
  let infra = win.__reportes().find(r=>r.id===idInfra);
  chequear('resolverReporte marca resuelto:true y guarda fechaResuelto',
    infra.resuelto===true && !!infra.fechaResuelto, JSON.stringify(infra));
  chequear('el marker se saca del mapa al resolver (reportesLayers ya no lo tiene)', !win.__reportesLayers()[idInfra]);
  await new Promise(r=>setTimeout(r,30));
  chequear('se mandó reporte_resuelto a Supabase', servidor.filas.some(f=>f.tipo==='reporte_resuelto' && f.detalle.id===idInfra));

  // --- E: cancelar el confirm no hace nada ---
  win.confirm = () => false;
  doc.getElementById('btn-capin-annoni').dispatchEvent(new win.Event('click', { bubbles: true }));
  const idCapin = win.__reportes().find(r=>r.categoria==='capin_annoni').id;
  const antesResolver = JSON.stringify(win.__reportes().find(r=>r.id===idCapin));
  doc.querySelector(`[data-resolver="${idCapin}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('cancelar el confirm de "Resuelto" no cambia nada', JSON.stringify(win.__reportes().find(r=>r.id===idCapin)) === antesResolver);
  doc.querySelector(`[data-del="${idCapin}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('cancelar el confirm de "Eliminar" no borra nada', win.__reportes().some(r=>r.id===idCapin));
  win.confirm = () => true;

  // --- F: eliminar (con confirmación) ---
  doc.querySelector(`[data-del="${idCapin}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('eliminarReporte lo saca de estado.reportes', !win.__reportes().some(r=>r.id===idCapin));
  await new Promise(r=>setTimeout(r,30));
  chequear('se mandó reporte_eliminado a Supabase', servidor.filas.some(f=>f.tipo==='reporte_eliminado' && f.detalle.id===idCapin));

  // --- G: "Resueltos" queda en una sección colapsable, no desaparece de la lista ---
  win.renderListaReportes('infraestructura');
  chequear('el resuelto sigue en la lista, dentro de "Resueltos (N)"', /Resueltos \(1\)/.test(doc.getElementById('reporte-lista').innerHTML));

  // --- H: evento remoto sin potrero real, idempotente ---
  const totalPotrerosAntes = Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p));
  win.aplicarEventoRemoto({ tipo:'reporte_creado', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente:'02/09/2026', detalle:{ id:'remrep1', categoria:'infraestructura', subtipo:'Alambrado roto', obs:null, fecha:'2026-09-02', lat:-31.42, lon:-55.45 } });
  chequear('un reporte_creado remoto se aplica sin requerir un potrero válido',
    win.__reportes().some(r=>r.id==='remrep1' && r.subtipo==='Alambrado roto' && r.resuelto===false));
  const totalPotrerosDespues = Object.keys(win.__est().potreros).map(p=>win.totalPotrero(p));
  chequear('no tocó el stock de ningún potrero', JSON.stringify(totalPotrerosAntes)===JSON.stringify(totalPotrerosDespues));

  const cantesDeRepetir = win.__reportes().length;
  win.aplicarEventoRemoto({ tipo:'reporte_creado', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente:'02/09/2026', detalle:{ id:'remrep1', categoria:'infraestructura', subtipo:'Otro', obs:'cambiado', fecha:'2026-09-03', lat:0, lon:0 } });
  chequear('reporte_creado remoto con id repetido no duplica', win.__reportes().length === cantesDeRepetir);

  win.aplicarEventoRemoto({ tipo:'reporte_resuelto', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente:'03/09/2026', detalle:{ id:'remrep1', fecha:'2026-09-03' } });
  chequear('un reporte_resuelto remoto marca resuelto sin requerir potrero',
    win.__reportes().find(r=>r.id==='remrep1').resuelto===true);
  const fechaResueltaAntes = win.__reportes().find(r=>r.id==='remrep1').fechaResuelto;
  win.aplicarEventoRemoto({ tipo:'reporte_resuelto', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente:'04/09/2026', detalle:{ id:'remrep1', fecha:'2026-09-04' } });
  chequear('reporte_resuelto remoto repetido es idempotente (no pisa la fecha ya resuelta)',
    win.__reportes().find(r=>r.id==='remrep1').fechaResuelto === fechaResueltaAntes);

  win.aplicarEventoRemoto({ tipo:'reporte_eliminado', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    detalle:{ id:'remrep1' } });
  chequear('un reporte_eliminado remoto saca el registro', !win.__reportes().some(r=>r.id==='remrep1'));

  // --- I: sin señal se encola, y se vacía al reconectar ---
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  const colaAntes = (win.__est().colaSync||[]).length;
  doc.getElementById('btn-infraestructura').dispatchEvent(new win.Event('click', { bubbles: true }));
  doc.getElementById('rp-subtipo').value = 'Bebedero roto';
  doc.getElementById('rp-mapa').dispatchEvent(new win.Event('click', { bubbles: true }));
  win.colocarReporteEn({ lat: -31.43, lng: -55.46 });
  chequear('sin señal el reporte queda en cola', (win.__est().colaSync||[]).length === colaAntes+1);
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  await win.vaciarColaSync();
  chequear('al volver la señal la cola se vacía', (win.__est().colaSync||[]).length === 0);
  chequear('ese evento en cola también llegó al servidor', servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.subtipo==='Bebedero roto'));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
