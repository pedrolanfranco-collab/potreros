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
      '\n;window.__reportesLayers = function(){ return reportesLayers; };' +
      '\n;window.__modoColocar = function(){ return modoColocarReporte; };');
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
  chequear('fila de subtipo visible (6 opciones)', doc.getElementById('reporte-fila-subtipo').style.display !== 'none');
  chequear('el select trae los 6 subtipos (con Problema con boya y Portera rota, y Otro al final)',
    doc.getElementById('rp-subtipo').options.length === 6 &&
    Array.from(doc.getElementById('rp-subtipo').options).map(o => o.value).join('|') === 'Caño roto|Bebedero roto|Problema con boya|Alambrado roto|Portera rota|Otro');
  chequear('hay un select de nivel (rp-nivel) sin valor por defecto: Elegí… / rojo / naranja / amarillo',
    !!doc.getElementById('rp-nivel') && doc.getElementById('rp-nivel').value === '' &&
    Array.from(doc.getElementById('rp-nivel').options).map(o => o.value).join('|') === '|rojo|naranja|amarillo');
  win.L.divIcon = o => o; // para poder leer el color del ícono (el stub de arriba devuelve {})
  chequear('fecha precargada con hoy', doc.getElementById('rp-fecha').value === win.fechaISOHoy());

  // --- A: crear un reporte de Infraestructura tocando el mapa ---
  doc.getElementById('rp-subtipo').value = 'Caño roto';
  doc.getElementById('rp-obs').value = 'Cerca de la tranquera norte';
  // --- A0: el nivel es obligatorio ---
  doc.getElementById('rp-nivel').value = '';
  doc.getElementById('rp-mapa').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('sin nivel, "Marcar en el mapa" no avanza (el modal sigue abierto)', doc.getElementById('modal-reporte').style.display === 'flex');
  chequear('sin nivel avisa con un toast que habla del nivel', /nivel/i.test(doc.getElementById('toast').textContent), doc.getElementById('toast').textContent);
  chequear('sin nivel no queda armado el modo "tocar el mapa"', win.__modoColocar() === null);
  if(tieneGPS){
    doc.getElementById('rp-gps').dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('sin nivel el botón GPS no guarda ningún reporte', win.__reportes().length === 0);
  }
  doc.getElementById('rp-nivel').value = 'rojo';
  doc.getElementById('rp-mapa').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('el modal se cierra al pasar a modo "tocar el mapa"', doc.getElementById('modal-reporte').style.display === 'none');
  win.colocarReporteEn({ lat: -31.40, lng: -55.43 });
  let reportes = win.__reportes();
  chequear('el reporte queda en estado.reportes con categoria/subtipo/obs correctos',
    reportes.length === 1 && reportes[0].categoria==='infraestructura' && reportes[0].subtipo==='Caño roto' && reportes[0].obs==='Cerca de la tranquera norte' && reportes[0].resuelto===false,
    JSON.stringify(reportes));
  await new Promise(r=>setTimeout(r,30));
  chequear('se mandó reporte_creado a Supabase', servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.subtipo==='Caño roto'));
  chequear('el reporte guarda nivel rojo y reporte_creado lo lleva en el detalle',
    reportes[0].nivel === 'rojo' && servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.subtipo==='Caño roto' && f.detalle.nivel==='rojo'));
  chequear('un reporte rojo tiene ícono rojo (#dc2626)', win.iconoReporte(reportes[0], false).html.includes('#dc2626'));

  // --- B: Capín Annoni -- un solo subtipo, select oculto ---
  doc.getElementById('btn-capin-annoni').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('título "🌾 Capín Annoni"', doc.getElementById('reporte-titulo').textContent.includes('Capín Annoni'));
  chequear('fila de subtipo OCULTA (un solo subtipo posible)', doc.getElementById('reporte-fila-subtipo').style.display === 'none');

  if(tieneGPS){
    // --- C: crear un reporte de Capín Annoni por GPS (un solo toque) ---
    doc.getElementById('rp-obs').value = 'Foco cerca del arroyo';
    doc.getElementById('rp-nivel').value = 'naranja';
    win.__gpsCoords = { lat: -31.41, lon: -55.44, acc: 8 };
    doc.getElementById('rp-gps').dispatchEvent(new win.Event('click', { bubbles: true }));
    reportes = win.__reportes();
    const capinGps = reportes.find(r=>r.categoria==='capin_annoni');
    chequear('el reporte por GPS queda con las coordenadas capturadas',
      !!capinGps && capinGps.subtipo==='Foco de capín annoni' && capinGps.lat===-31.41 && capinGps.lon===-55.44 && capinGps.obs==='Foco cerca del arroyo',
      JSON.stringify(capinGps));
    chequear('el modal NO se cierra tras guardar por GPS (se puede seguir cargando)', doc.getElementById('modal-reporte').style.display === 'flex');
    chequear('el reporte de Capín Annoni también lleva el nivel (comparte el modal)', capinGps.nivel === 'naranja');
    chequear('tras guardar por GPS el nivel vuelve a quedar sin elegir', doc.getElementById('rp-nivel').value === '');
    await new Promise(r=>setTimeout(r,30));
    chequear('se mandó reporte_creado (GPS) a Supabase',
      servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.categoria==='capin_annoni' && f.detalle.lat===-31.41));
  } else {
    chequear('botón GPS ausente en esta variante (esperado, no es móvil)', !tieneGPS);
    // en PC, cargar el Capín Annoni por el flujo de "tocar el mapa" para poder seguir probando resolver/eliminar
    doc.getElementById('rp-obs').value = 'Foco cerca del arroyo';
    doc.getElementById('rp-nivel').value = 'naranja';
    doc.getElementById('rp-mapa').dispatchEvent(new win.Event('click', { bubbles: true }));
    win.colocarReporteEn({ lat: -31.41, lng: -55.44 });
  }
  doc.getElementById('reporte-cerrar').dispatchEvent(new win.Event('click', { bubbles: true }));

  // --- D: marcar como Resuelto (con confirmación) ---
  doc.getElementById('btn-infraestructura').dispatchEvent(new win.Event('click', { bubbles: true }));
  const idInfra = win.__reportes().find(r=>r.categoria==='infraestructura').id;
  chequear('fila activa tiene botón "✓ Resuelto"', !!doc.querySelector(`[data-resolver="${idInfra}"]`));
  // 24/10/2026: "✓ Resuelto" abre el mini formulario (foto opcional + "Confirmar resuelto"); recién ahí se resuelve
  doc.querySelector(`[data-resolver="${idInfra}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('"✓ Resuelto" abre el mini formulario con "Confirmar resuelto"', !!doc.querySelector(`[data-confirmar-resuelto="${idInfra}"]`));
  chequear('todavía no está resuelto con solo abrir el formulario', win.__reportes().find(r=>r.id===idInfra).resuelto===false);
  doc.querySelector(`[data-confirmar-resuelto="${idInfra}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
  let infra = win.__reportes().find(r=>r.id===idInfra);
  chequear('resolverReporte marca resuelto:true y guarda fechaResuelto',
    infra.resuelto===true && !!infra.fechaResuelto, JSON.stringify(infra));
  chequear('el marker se saca del mapa al resolver (reportesLayers ya no lo tiene)', !win.__reportesLayers()[idInfra]);
  chequear('un reporte resuelto cuenta como verde (nivelDeReporte)', win.nivelDeReporte(infra) === 'verde');
  chequear('el ícono de un resuelto es verde (#16a34a) y ya no gris (#8c8c8c)',
    win.iconoReporte(infra, true).html.includes('#16a34a') && !win.iconoReporte(infra, true).html.includes('#8c8c8c'));
  await new Promise(r=>setTimeout(r,30));
  chequear('se mandó reporte_resuelto a Supabase', servidor.filas.some(f=>f.tipo==='reporte_resuelto' && f.detalle.id===idInfra));

  // --- E: cancelar el confirm no hace nada ---
  win.confirm = () => false;
  doc.getElementById('btn-capin-annoni').dispatchEvent(new win.Event('click', { bubbles: true }));
  const idCapin = win.__reportes().find(r=>r.categoria==='capin_annoni').id;
  const antesResolver = JSON.stringify(win.__reportes().find(r=>r.id===idCapin));
  doc.querySelector(`[data-resolver="${idCapin}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
  doc.querySelector(`[data-confirmar-resuelto="${idCapin}"]`).dispatchEvent(new win.Event('click', { bubbles: true }));
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
  chequear('un reporte remoto sin nivel se muestra amarillo (nivel undefined)',
    win.nivelDeReporte(win.__reportes().find(r=>r.id==='remrep1')) === 'amarillo' && win.__reportes().find(r=>r.id==='remrep1').nivel === undefined);
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
  doc.getElementById('rp-nivel').value = 'naranja';
  doc.getElementById('rp-mapa').dispatchEvent(new win.Event('click', { bubbles: true }));
  win.colocarReporteEn({ lat: -31.43, lng: -55.46 });
  chequear('sin señal el reporte queda en cola', (win.__est().colaSync||[]).length === colaAntes+1);
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  await win.vaciarColaSync();
  chequear('al volver la señal la cola se vacía', (win.__est().colaSync||[]).length === 0);
  chequear('ese evento en cola también llegó al servidor', servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.subtipo==='Bebedero roto'));

  // --- J: nivel (rojo / naranja / amarillo / verde): remoto, resumen, orden, cambio de nivel ---
  const evCrear = (id, subtipo, extra) => win.aplicarEventoRemoto({ tipo:'reporte_creado', potrero:'esto-no-es-un-potrero', dispositivo:'otro',
    fecha_cliente:'05/09/2026', detalle:Object.assign({ id, categoria:'infraestructura', subtipo, obs:null, fecha:'2026-09-05', lat:-31.5, lon:-55.5 }, extra || {}) });
  win.guardarReporte({ categoria:'infraestructura', subtipo:'Portera rota', nivel:'rojo', lat:-31.5, lon:-55.5 });
  win.guardarReporte({ categoria:'infraestructura', subtipo:'Problema con boya', nivel:'amarillo', lat:-31.51, lon:-55.51 });
  evCrear('remsin', 'Otro');
  evCrear('remraro', 'Otro', { nivel:'violeta' });
  evCrear('remrojo', 'Alambrado roto', { nivel:'rojo' });
  const rep = id => win.__reportes().find(r => r.id === id);
  const idDe = sub => win.__reportes().find(r => r.subtipo === sub && r.categoria === 'infraestructura' && !r.resuelto).id;
  await new Promise(r=>setTimeout(r,30));
  chequear('reporte_creado local de Portera rota lleva nivel rojo al servidor',
    servidor.filas.some(f=>f.tipo==='reporte_creado' && f.detalle.subtipo==='Portera rota' && f.detalle.nivel==='rojo'));
  chequear('remoto sin nivel: se ve amarillo y no inventa un nivel', win.nivelDeReporte(rep('remsin')) === 'amarillo' && rep('remsin').nivel === undefined);
  chequear('remoto con nivel desconocido (violeta): se descarta y se ve amarillo', win.nivelDeReporte(rep('remraro')) === 'amarillo' && rep('remraro').nivel === undefined);
  chequear('remoto con nivel rojo se respeta', rep('remrojo').nivel === 'rojo' && win.nivelDeReporte(rep('remrojo')) === 'rojo');

  // resumen sobre el total de esa lista: Caño (resuelto), Bebedero (naranja), Portera (rojo), boya (amarillo), remsin, remraro (amarillo), remrojo (rojo) = 7
  doc.getElementById('btn-infraestructura').dispatchEvent(new win.Event('click', { bubbles: true }));
  const cuenta = n => { const e = doc.querySelector('[data-nivel-cuenta="' + n + '"]'); return e ? e.textContent : ''; };
  chequear('resumen: rojo 2 (29%)', /2 \(29%\)/.test(cuenta('rojo')), cuenta('rojo'));
  chequear('resumen: naranja 1 (14%)', /1 \(14%\)/.test(cuenta('naranja')), cuenta('naranja'));
  chequear('resumen: amarillo 3 (43%)', /3 \(43%\)/.test(cuenta('amarillo')), cuenta('amarillo'));
  chequear('resumen: verde (concluidos) 1 (14%)', /1 \(14%\)/.test(cuenta('verde')), cuenta('verde'));
  const orden = Array.from(doc.querySelectorAll('#reporte-lista > .rp-item')).map(e => e.dataset.nivel).join(',');
  chequear('los activos salen rojo, naranja, amarillo', orden === 'rojo,rojo,naranja,amarillo,amarillo,amarillo', orden);
  chequear('cada fila trae su punto de color', doc.querySelectorAll('#reporte-lista .rp-nivel-punto').length === 7);
  chequear('el resuelto no tiene selector de nivel y los activos sí',
    !doc.querySelector('[data-nivel-cambiar="' + idInfra + '"]') && doc.querySelectorAll('[data-nivel-cambiar]').length === 6);

  // cambio de nivel local: amarillo -> naranja
  const idBoya = idDe('Problema con boya');
  let iconoNuevo = null;
  win.__reportesLayers()[idBoya] = { setIcon(i){ iconoNuevo = i; }, setPopupContent(){}, isPopupOpen(){ return false; } };
  const sel = doc.querySelector('[data-nivel-cambiar="' + idBoya + '"]');
  chequear('el selector de la fila muestra el nivel actual', !!sel && sel.value === 'amarillo');
  sel.value = 'naranja';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  chequear('cambiar el nivel actualiza el reporte', rep(idBoya).nivel === 'naranja');
  chequear('cambiar el nivel redibuja el marcador con el color nuevo (#ea580c)', !!iconoNuevo && iconoNuevo.html.includes('#ea580c'));
  await new Promise(r=>setTimeout(r,30));
  chequear('cambiar el nivel manda reporte_nivel {id, nivel}',
    servidor.filas.some(f=>f.tipo==='reporte_nivel' && f.detalle.id===idBoya && f.detalle.nivel==='naranja'));
  chequear('el resumen se recalcula (naranja 2 (29%), amarillo 2 (29%))', /2 \(29%\)/.test(cuenta('naranja')) && /2 \(29%\)/.test(cuenta('amarillo')), cuenta('naranja') + ' / ' + cuenta('amarillo'));
  const filasAntes = servidor.filas.length;
  win.cambiarNivelReporte(idBoya, 'naranja', 'infraestructura');
  win.cambiarNivelReporte(idBoya, 'azul', 'infraestructura');
  await new Promise(r=>setTimeout(r,30));
  chequear('repetir el mismo nivel o mandar uno inválido no manda nada', servidor.filas.length === filasAntes && rep(idBoya).nivel === 'naranja');

  // cambio de nivel remoto
  let iconoRemoto = null;
  win.__reportesLayers()['remsin'] = { setIcon(i){ iconoRemoto = i; }, setPopupContent(){}, isPopupOpen(){ return false; } };
  win.aplicarEventoRemoto({ tipo:'reporte_nivel', potrero:'esto-no-es-un-potrero', dispositivo:'otro', detalle:{ id:'remsin', nivel:'rojo' } });
  chequear('un reporte_nivel remoto cambia el nivel sin requerir potrero', rep('remsin').nivel === 'rojo' && win.nivelDeReporte(rep('remsin')) === 'rojo');
  chequear('un reporte_nivel remoto redibuja el marcador (#dc2626)', !!iconoRemoto && iconoRemoto.html.includes('#dc2626'));
  win.aplicarEventoRemoto({ tipo:'reporte_nivel', potrero:'esto-no-es-un-potrero', dispositivo:'otro', detalle:{ id:'remsin', nivel:'azul' } });
  win.aplicarEventoRemoto({ tipo:'reporte_nivel', potrero:'esto-no-es-un-potrero', dispositivo:'otro', detalle:{ id:'no-existe', nivel:'rojo' } });
  chequear('reporte_nivel con nivel inválido o id desconocido se ignora', rep('remsin').nivel === 'rojo' && !rep('no-existe'));
  doc.getElementById('btn-infraestructura').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('tras el cambio remoto el resumen cuenta 3 rojos (43%)', /3 \(43%\)/.test(cuenta('rojo')), cuenta('rojo'));

  // capa del mapa a la que pertenece cada subtipo (se usa en la etapa siguiente)
  const capa = (categoria, subtipo) => win.capaDeReporte({ categoria, subtipo });
  chequear('capaDeReporte: caño, bebedero y boya van a "agua"',
    ['Caño roto', 'Bebedero roto', 'Problema con boya'].every(s => capa('infraestructura', s) === 'agua'));
  chequear('capaDeReporte: alambrado, portera, Otro y lo desconocido van a "instalacion"',
    ['Alambrado roto', 'Portera rota', 'Otro', 'cosa rara'].every(s => capa('infraestructura', s) === 'instalacion'));

  // lista sin reportes: no hay resumen (total 0)
  doc.getElementById('btn-capin-annoni').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('lista vacía (Capín Annoni sin reportes): no se muestra el resumen', !doc.querySelector('#reporte-lista .rp-resumen'));
  doc.getElementById('btn-infraestructura').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('lista con reportes: sí hay resumen', !!doc.querySelector('#reporte-lista .rp-resumen'));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
