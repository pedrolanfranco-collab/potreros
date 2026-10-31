/*
 * Prueba ad-hoc: fotos en Aguadas / instalaciones (puntos: manga, corral, embarcadero…) y en las muertes del historial, y
 * "🗺 Ver en el mapa" (29/10/2026, a pedido de Pedro). Sobre probar_fotos_reportes.js (reportes) verifica que lo mismo
 * funciona con el resto de lo que puede tener fotos:
 * - PUNTOS: hasta 3 fotos al crearlos (el evento punto_creado sale primero y cada punto_foto SOLO después de que la foto
 *   está en el bucket), "📷 Agregar foto" después (tope 10), miniaturas en la lista y en el popup, "🗺 Ver en el mapa"
 *   (setView a 17 + popup), sin señal quedan en la cola, eliminar el punto saca sus fotos pendientes;
 * - MUERTES: fotos y lugar opcional (GPS en el celular o tocando el mapa) en el formulario; la muerte sale con lat/lon y
 *   cada muerte_foto detrás, miniaturas y 📷 / 🗺 en el historial del potrero (sin lugar marcado, 🗺 centra el potrero);
 *   una muerte de otro equipo trae su lugar y su foto;
 * - RECEPTOR: acepta solo la ruta exacta del establecimiento y el id que corresponde al tipo (rp_ / pt_ / event_id), momentos
 *   válidos por tipo, idempotente por fotoId; una foto en cola de antes (sin `tipoFoto`) se sigue leyendo como de un reporte;
 * - Verificar stock (solo PC) no cambia estado ni llama a Leaflet con estos eventos en el registro.
 * Corre sobre las 9 variantes (PC, móvil completa y Campo; los 3 establecimientos).
 */
const fs = require('fs');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
const BUCKET = 'fotos-reportes';
const uuid = () => crypto.randomUUID();

function limites(){
  const b = { getCenter(){ return { lat: -31.98, lng: -56.34 }; }, extend(){ return b; },
    isValid(){ return true; }, pad(){ return b; }, getNorth(){ return -31.9; },
    getSouth(){ return -32.0; }, getEast(){ return -56.3; }, getWest(){ return -56.4; },
    contains(){ return true; } };
  return b;
}

/* Marcador que anota lo que le hacen (addTo, openPopup, popupclose...). Las posiciones quedan en _lat/_lon. */
function marcador(log, ll){
  const t = { _lat: Array.isArray(ll) ? ll[0] : (ll && ll.lat), _lon: Array.isArray(ll) ? ll[1] : (ll && ll.lng),
    _abierto: false, _listeners: {}, _html: null };
  const p = new Proxy(t, {
    get(obj, prop){
      if(prop in obj) return obj[prop];
      if(typeof prop !== 'string') return undefined;
      switch(prop){
        case 'addTo': return (mapa) => { mapa.addLayer(p); log.push(['addTo', p]); return p; };
        case 'bindPopup': return (h) => { obj._html = h; return p; };
        case 'setPopupContent': return (h) => { obj._html = h; log.push(['setPopupContent', p]); return p; };
        case 'openPopup': return () => { obj._abierto = true; log.push(['openPopup', p]); return p; };
        case 'closePopup': return () => { obj._abierto = false; return p; };
        case 'isPopupOpen': return () => obj._abierto;
        case 'getPopup': return () => ({ getElement(){ return null; } });
        case 'on': return (ev, fn) => { (obj._listeners[ev] = obj._listeners[ev] || []).push(fn); return p; };
        case 'emit': return (ev, arg) => { (obj._listeners[ev] || []).forEach(f => f(arg || {})); return p; };
        default: return () => p;
      }
    }
  });
  return p;
}

function stubLeaflet(win, log){
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
  const mapa = { _capas: new Set(),
    setView(ll, z){ log.push(['setView', ll, z]); return mapa; },
    fitBounds(){ log.push(['fitBounds']); return mapa; }, on(){ return mapa; },
    addLayer(l){ mapa._capas.add(l); return mapa; },
    removeLayer(l){ log.push(['removeLayer', l]); mapa._capas.delete(l); return mapa; },
    hasLayer(l){ return mapa._capas.has(l); },
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(ll){ return marcador(log, ll); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); }, DomEvent: { stopPropagation(){} } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

/* Servidor falso: eventos_sync (con los filtros de PostgREST que usa la app), el bucket de Storage y la firma de URLs. */
function servidorFalso(){
  const srv = {
    filas: [], storage: new Map(), intentos: [], subidas: [], eventosSinFoto: [], ids: new Set(),
    fallarSubida: null, // función(path) -> error o null
    ultimoCreado: Date.now(),
    insertar(tabla, obj){
      if(tabla !== 'eventos_sync') return Promise.resolve({ error: null, status: 201 });
      if(obj.event_id && srv.ids.has(obj.event_id)) return Promise.resolve({ error: { code: '23505', message: 'duplicate' }, status: 409 });
      if(obj.event_id) srv.ids.add(obj.event_id);
      if(/_foto$/.test(obj.tipo) && !srv.storage.has(obj.detalle.path)) srv.eventosSinFoto.push(obj.detalle.path);
      srv.ultimoCreado += 1;
      srv.filas.push(Object.assign({}, obj, { id: 'row' + srv.filas.length, creado_en: new Date(srv.ultimoCreado).toISOString() }));
      return Promise.resolve({ error: null, status: 201 });
    },
    createClient(){
      return {
        from(tabla){
          const q = { _f: [], _orden: [], _rango: null,
            select(){ return q; },
            eq(c, v){ q._f.push(r => r[c] === v); return q; },
            in(c, vs){ q._f.push(r => vs.includes(r[c])); return q; },
            gt(c, v){ q._f.push(r => String(r[c]) > String(v)); return q; },
            gte(c, v){ q._f.push(r => String(r[c]) >= String(v)); return q; },
            order(c){ q._orden.push(c); return q; },
            range(d, h){ q._rango = [d, h]; return q; },
            limit(){ return q; }, not(){ return q; }, is(){ return q; },
            insert(obj){ return srv.insertar(tabla, obj); },
            upsert(){ return Promise.resolve({ error: null, status: 201 }); },
            update(){ return q; }, delete(){ return q; },
            then(res, rej){
              let datos = tabla === 'eventos_sync' ? srv.filas.filter(r => q._f.every(f => f(r))) : [];
              datos = datos.slice().sort((a, b) => {
                for(const c of q._orden){ const x = String(a[c]), y = String(b[c]); if(x !== y) return x < y ? -1 : 1; }
                return 0;
              });
              const desde = q._rango ? q._rango[0] : 0;
              const hasta = q._rango ? Math.min(q._rango[1], desde + 999) : 999;
              return Promise.resolve({ data: datos.slice(desde, hasta + 1), error: null, status: 200 }).then(res, rej);
            }
          };
          return q;
        },
        rpc(){ return Promise.resolve({ data: true, error: null }); },
        storage: {
          from(bucket){
            return {
              upload(path, blob, opts){
                srv.intentos.push({ bucket, path, opts });
                const err = srv.fallarSubida && srv.fallarSubida(path);
                if(err) return Promise.resolve({ data: null, error: err });
                if(srv.storage.has(path)) return Promise.resolve({ data: null, error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } });
                srv.storage.set(path, { bucket, blob, contentType: opts && opts.contentType });
                srv.subidas.push(path);
                return Promise.resolve({ data: { path }, error: null });
              },
              createSignedUrls(paths){
                const data = paths.map(p => srv.storage.has(p)
                  ? { path: p, signedUrl: 'https://firmada.test/' + p + '?t=1', error: null }
                  : { path: p, signedUrl: null, error: 'Not found' });
                return Promise.resolve({ data, error: null });
              }
            };
          }
        }
      };
    }
  };
  return srv;
}

async function levantar(archivo, servidor, almacen){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const log = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win, log);
  win.supabase = { createClient: () => servidor.createClient() };
  let enLinea = true;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable: true });
  win.__gpsCoords = { lat: -31.40, lon: -55.43, acc: 12 };
  Object.defineProperty(win.navigator, 'geolocation', {
    value: { getCurrentPosition(ok){ ok({ coords: { latitude: win.__gpsCoords.lat, longitude: win.__gpsCoords.lon, accuracy: win.__gpsCoords.acc } }); } },
    configurable: true
  });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  let scrollsMapa = 0;
  win.HTMLElement.prototype.scrollIntoView = function(){ if(this.id === 'map') scrollsMapa++; };
  win.HTMLAnchorElement.prototype.click = function(){};
  // `almacen`: lo que había guardado en el localStorage (para probar "cerrar y volver a abrir la app")
  Object.keys(almacen || {}).forEach(k => win.localStorage.setItem(k, almacen[k]));
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__reportes = function(){ return estado.reportes||[]; };' +
      '\n;window.__reportesLayers = function(){ return reportesLayers; };' +
      '\n;window.__fotosTest = fotosPendientes;' +
      '\n;window.__vaciarFotos = vaciarColaFotos;' +
      '\n;window.__fotosDeReporte = fotosDeReporte;' +
      '\n;window.__fotosN = function(){ return _fotosPendientesN; };' +
      '\n;window.__sincronizar = sincronizar;' +
      '\n;window.__ver = verReporteEnMapa;' +
      '\n;window.__puntosLayers = function(){ return puntosLayers; };' +
      '\n;window.__puntos = function(){ return estado.puntos||[]; };' +
      '\n;window.__fotosDe = fotosDe;' +
      '\n;window.__textoSync = textoEstadoSyncOrdenada;' +
      '\n;window.__crearPotrero = function(n){ if(!POTREROS_GEO.some(p => p.nombre === n)){ const p = {nombre: n, coords: [[-31.4,-55.4],[-31.4,-55.39],[-31.39,-55.39]], area: null}; POTREROS_GEO.push(p); AREA_CALCULADA[n] = calcAreaHa(p.coords); estado.potreros[n] = estado.potreros[n] || {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null}; dibujarPotrero(p); } return n; };' +
      '\n;window.__esCampo = VERSION_APP.indexOf("campo-") === 0;' +
      '\n;window.__EST = ESTABLECIMIENTO;');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await esperar(60);
  return { win, errores, log, setEnLinea(v){ enLinea = v; }, scrollsMapa: () => scrollsMapa };
}

const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const foto = (win, nombre) => new win.File(['x'.repeat(1200)], nombre, { type: 'image/jpeg' });
// Simula elegir archivos en un <input type=file>: los pone en `files` y dispara el change.
async function elegirFotos(win, input, archivos){
  Object.defineProperty(input, 'files', { value: archivos, configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await esperar(30);
}
const esUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);


async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = servidorFalso();
  const { win, errores, log, setEnLinea } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const est = win.__EST;
  const otroEst = est === 'la_vuelta' ? 'maria_laura' : 'la_vuelta';
  const tieneGPS = !!doc.getElementById('f-ubic-gps') || typeof win.capturarUbicacionActual === 'function';
  const puntos = () => win.__puntos();
  const filasDe = tipo => servidor.filas.filter(f => f.tipo === tipo);
  const remoto = (tipo, detalle, extra) => win.aplicarEventoRemoto(Object.assign({ tipo, potrero: est, dispositivo: 'otro', fecha_cliente: '29/10/2026', detalle }, extra || {}));

  // Arma un detalle de foto válido; `over` pisa campos. Si no trae `path`, lo arma bien (así cada caso inválido falla por UN solo motivo).
  const armar = (id, over) => {
    const d = Object.assign({ id, fotoId: uuid(), momento: 'registro', fecha: '2026-10-29' }, over || {});
    if(!over || !('path' in over)) d.path = `${est}/${d.id}/${d.fotoId}.jpg`;
    return d;
  };

  chequear('el botón "📍 Aguadas / instalaciones" no está oculto (la PC lo tiene en su sub-menú; la móvil y Campo, en Herramientas)',
    !!doc.getElementById('btn-puntos') && doc.getElementById('btn-puntos').style.display !== 'none');

  // =========================== PUNTOS (aguadas / instalaciones) ===========================
  // ---------- 1. Crear una manga con 2 fotos: punto_creado primero, las fotos se suben, después punto_foto ----------
  click(win, doc.getElementById('btn-puntos'));
  await elegirFotos(win, doc.querySelector('#np-fotos [data-sf-input]'), [foto(win, 'a.jpg'), foto(win, 'b.jpg')]);
  chequear('el formulario de puntos muestra las 2 fotos elegidas', doc.querySelectorAll('#np-fotos .rp-foto-elegida').length === 2);
  doc.getElementById('np-tipo').value = 'instalacion';
  doc.getElementById('np-tipo').dispatchEvent(new win.Event('change', { bubbles: true }));
  chequear('"Manga", "Corral" y "Embarcadero" son subtipos de Instalación (no son potreros)',
    ['Manga', 'Corral', 'Embarcadero'].every(x => Array.from(doc.getElementById('np-subtipo').options).some(o => o.value === x)));
  doc.getElementById('np-subtipo').value = 'Manga';
  doc.getElementById('np-nombre').value = 'Manga vieja';
  click(win, doc.getElementById('np-colocar'));
  chequear('al elegir la ubicación, el formulario suelta sus fotos (van con el punto)', doc.querySelectorAll('#np-fotos .rp-foto-elegida').length === 0);
  win.colocarPuntoEn({ lat: -31.40, lng: -55.43 });
  const p1 = puntos().find(p => p.nombre === 'Manga vieja');
  chequear('el punto se crea con su lista de fotos vacía, que se llena al subir', !!p1 && Array.isArray(p1.fotos));
  await esperar(80);
  const idxPunto = servidor.filas.findIndex(f => f.tipo === 'punto_creado' && f.detalle.id === p1.id);
  chequear('punto_creado sale primero', idxPunto >= 0);
  const evs1 = filasDe('punto_foto').filter(f => f.detalle.id === p1.id);
  chequear('salen 2 punto_foto, después de punto_creado', evs1.length === 2 && evs1.every(f => servidor.filas.indexOf(f) > idxPunto));
  chequear('cada punto_foto lleva la ruta exacta <est>/<id>/<fotoId>.jpg y momento "registro"',
    evs1.every(f => f.detalle.path === `${est}/${p1.id}/${f.detalle.fotoId}.jpg` && f.detalle.momento === 'registro' && esUuid(f.detalle.fotoId)));
  chequear('las 2 fotos están en el bucket fotos-reportes y ningún evento salió antes que su foto',
    servidor.subidas.filter(x => x.startsWith(`${est}/${p1.id}/`)).length === 2 && servidor.eventosSinFoto.length === 0, JSON.stringify(servidor.eventosSinFoto));
  chequear('la subida va con upsert:false, image/jpeg y al bucket fotos-reportes',
    servidor.intentos.length >= 2 && servidor.intentos.every(i => i.opts.upsert === false && i.opts.contentType === 'image/jpeg' && i.bucket === BUCKET));
  chequear('en el punto local quedan las 2 fotos y la cola queda vacía', puntos().find(p => p.id === p1.id).fotos.length === 2 && win.__fotosN() === 0);

  // ---------- 2. Lista: miniaturas, "Ver en el mapa" y popup ----------
  click(win, doc.getElementById('puntos-cerrar'));
  click(win, doc.getElementById('btn-puntos'));
  const filaP = doc.querySelector(`#lista-puntos [data-ver-punto="${p1.id}"]`);
  chequear('la lista tiene "🗺 Ver en el mapa" y "📷 Agregar foto" en cada punto', !!filaP && !!doc.querySelector(`#lista-puntos [data-foto-punto="${p1.id}"]`));
  chequear('la lista muestra las 2 miniaturas del punto', doc.querySelectorAll(`#lista-puntos [data-foto-thumb][data-foto-tipo="punto"][data-dueno="${p1.id}"]`).length === 2);
  chequear('el botón "Eliminar" sigue estando', !!doc.querySelector(`#lista-puntos [data-del="${p1.id}"]`));
  chequear('el popup del marcador trae las miniaturas', (win.__puntosLayers()[p1.id]._html || '').indexOf('data-foto-thumb') >= 0);
  log.length = 0;
  click(win, filaP);
  chequear('"Ver en el mapa" cierra la ventana', doc.getElementById('modal-puntos').style.display === 'none');
  const sv = log.find(e => e[0] === 'setView');
  chequear('centra el mapa en el punto con zoom 17', !!sv && Math.abs(sv[1][0] - p1.lat) < 1e-9 && Math.abs(sv[1][1] - p1.lon) < 1e-9 && sv[2] === 17, JSON.stringify(sv));
  chequear('y abre su popup', log.some(e => e[0] === 'openPopup' && e[1] === win.__puntosLayers()[p1.id]));

  // ---------- 3. Agregar fotos después (tope 10) ----------
  click(win, doc.getElementById('btn-puntos'));
  click(win, doc.querySelector(`#lista-puntos [data-foto-punto="${p1.id}"]`));
  await elegirFotos(win, doc.getElementById('rp-fotos-extra'), [foto(win, 'c.jpg')]);
  await esperar(80);
  chequear('"📷 Agregar foto" sube una foto más al punto ya creado', puntos().find(p => p.id === p1.id).fotos.length === 3 && filasDe('punto_foto').filter(f => f.detalle.id === p1.id).length === 3);
  click(win, doc.querySelector(`#lista-puntos [data-foto-punto="${p1.id}"]`));
  await elegirFotos(win, doc.getElementById('rp-fotos-extra'), Array.from({ length: 12 }, (_, i) => foto(win, 'm' + i + '.jpg')));
  await esperar(150);
  chequear('el punto no pasa de 10 fotos', win.__fotosDe(puntos().find(p => p.id === p1.id), 'punto').length === 10, String(win.__fotosDe(puntos().find(p => p.id === p1.id), 'punto').length));
  chequear('con 10 fotos el botón queda deshabilitado', doc.querySelector(`#lista-puntos [data-foto-punto="${p1.id}"]`).disabled === true);
  click(win, doc.getElementById('puntos-cerrar'));

  // ---------- 4. Sin señal: quedan en la cola y se mandan al volver; eliminar el punto saca las pendientes ----------
  setEnLinea(false);
  click(win, doc.getElementById('btn-puntos'));
  await elegirFotos(win, doc.querySelector('#np-fotos [data-sf-input]'), [foto(win, 'o.jpg')]);
  doc.getElementById('np-nombre').value = 'Corral sin señal';
  click(win, doc.getElementById('np-colocar'));
  win.colocarPuntoEn({ lat: -31.41, lng: -55.44 });
  const p2 = puntos().find(p => p.nombre === 'Corral sin señal');
  await esperar(60);
  chequear('sin señal la foto queda en la cola y el indicador lo dice',
    win.__fotosN() === 1 && /1 foto sin subir/.test(win.__textoSync().texto), win.__textoSync().texto);
  setEnLinea(true);
  await win.__sincronizar();
  await esperar(80);
  chequear('al volver la señal sale punto_creado y después punto_foto',
    filasDe('punto_foto').some(f => f.detalle.id === p2.id) &&
    servidor.filas.findIndex(f => f.tipo === 'punto_creado' && f.detalle.id === p2.id) < servidor.filas.findIndex(f => f.tipo === 'punto_foto' && f.detalle.id === p2.id));
  setEnLinea(false);
  click(win, doc.getElementById('puntos-cerrar'));
  click(win, doc.getElementById('btn-puntos'));
  click(win, doc.querySelector(`#lista-puntos [data-foto-punto="${p2.id}"]`));
  await elegirFotos(win, doc.getElementById('rp-fotos-extra'), [foto(win, 'p.jpg')]);
  chequear('(sin señal) una foto nueva queda en la cola', win.__fotosN() === 1);
  win.eliminarPunto(p2.id);
  await esperar(60);
  chequear('eliminar el punto saca sus fotos pendientes de la cola', win.__fotosN() === 0 && (await win.__fotosTest.listar()).length === 0);
  setEnLinea(true);
  click(win, doc.getElementById('puntos-cerrar'));

  // ---------- 5. Receptor de punto_foto ----------
  const fidOk = uuid();
  const bueno = armar(p1.id, { fotoId: fidOk });
  const antesN = win.__fotosDe(puntos().find(p => p.id === p1.id), 'punto').length;
  remoto('punto_foto', bueno);
  chequear('punto_foto remoto válido se agrega al punto (o el punto ya está en el tope)', win.__fotosDe(puntos().find(p => p.id === p1.id), 'punto').length === antesN + 1 || antesN >= 10);
  const pTope = win.aplicarEventoRemoto && puntos().find(p => p.id === p1.id);
  chequear('el punto_foto válido quedó registrado en el punto', pTope.fotos.some(f => f.fotoId === fidOk));
  remoto('punto_foto', bueno);
  chequear('el mismo punto_foto dos veces no duplica (idempotente por fotoId)', puntos().find(p => p.id === p1.id).fotos.filter(f => f.fotoId === fidOk).length === 1);
  const antesTodo = JSON.stringify(puntos());
  [
    ['ruta de otro establecimiento', armar(p1.id, { path: `${otroEst}/${p1.id}/${uuid()}.jpg` })],
    ['ruta con ../', armar(p1.id, { path: `${est}/../${otroEst}/${p1.id}/${uuid()}.jpg` })],
    ['ruta de otro punto', armar(p1.id, { path: `${est}/pt_otro/${uuid()}.jpg` })],
    ['id de reporte (rp_) en un punto_foto', armar('rp_123')],
    ['momento "resuelto" (solo los reportes se resuelven)', armar(p1.id, { momento: 'resuelto' })],
    ['momento inventado', armar(p1.id, { momento: 'otro' })],
    ['fotoId que no es uuid', armar(p1.id, { fotoId: 'no-es-uuid' })],
    ['punto que no está en este equipo', armar('pt_no_existe')]
  ].forEach(([nombre, d]) => {
    remoto('punto_foto', d);
    chequear('punto_foto rechazado: ' + nombre, JSON.stringify(puntos()) === antesTodo);
  });

  // ---------- 6. Foto en cola de antes (sin tipoFoto) se lee como de un reporte ----------
  win.guardarReporte({ categoria: 'infraestructura', subtipo: 'Caño roto', obs: 'viejo', lat: -31.4, lon: -55.4 });
  const repV = win.__reportes().find(r => r.obs === 'viejo');
  const fidV = uuid();
  await win.__fotosTest.poner({ fotoId: fidV, reporteId: repV.id, momento: 'reporte', fecha: '2026-10-24', establecimiento: est, creado: Date.now(), blob: new win.Blob(['x']) });
  await win.__vaciarFotos();
  await esperar(80);
  chequear('una foto en cola sin tipoFoto (de la versión anterior) sale como reporte_foto',
    filasDe('reporte_foto').some(f => f.detalle.id === repV.id && f.detalle.fotoId === fidV), JSON.stringify(filasDe('reporte_foto').map(f => f.detalle)));

  // =========================== MUERTES ===========================
  const pot = win.__crearPotrero('T_FOTO');
  win.seleccionarPotrero(pot);
  win.mostrarFormulario(pot, 'muerte');
  chequear('el formulario de muerte tiene fotos y "dónde se encontró"', !!doc.getElementById('f-fotos-muerte') && !!doc.getElementById('f-ubic-mapa') && !!doc.querySelector('#f-fotos-muerte [data-sf-input]'));
  chequear('el botón de GPS solo está en el celular', tieneGPS === !!doc.getElementById('f-ubic-gps'));
  const dueno = doc.getElementById('f-dueno').value;
  win.__est().potreros[pot].animales[win.claveAnimal('Vacas', dueno)] = 9;
  doc.getElementById('f-cat').value = 'Vacas';
  doc.getElementById('f-cant').value = '1';
  doc.getElementById('f-obs').value = 'Con foto y lugar';
  await elegirFotos(win, doc.querySelector('#f-fotos-muerte [data-sf-input]'), [foto(win, 'm1.jpg'), foto(win, 'm2.jpg')]);
  chequear('el formulario de muerte muestra las 2 fotos elegidas', doc.querySelectorAll('#f-fotos-muerte .rp-foto-elegida').length === 2);
  if(doc.getElementById('f-ubic-gps')){
    win.__gpsCoords = { lat: -31.45, lon: -55.45, acc: 10 };
    click(win, doc.getElementById('f-ubic-gps'));
    chequear('el GPS marca el lugar y lo muestra', /Marcada: -31\.45000, -55\.45000/.test(doc.getElementById('f-ubic-txt').textContent), doc.getElementById('f-ubic-txt').textContent);
  }
  click(win, doc.getElementById('f-ubic-mapa'));
  chequear('"Marcar en el mapa" pide tocar el mapa', !!doc.querySelector('.modo-colocar-aviso'));
  chequear('y oculta el detalle del potrero, que en el celular tapa el mapa', doc.getElementById('detalle').style.display === 'none');
  chequear('el aviso trae un botón Cancelar', !!doc.querySelector('.modo-colocar-aviso button'));
  click(win, doc.querySelector('.modo-colocar-aviso button'));
  chequear('Cancelar devuelve el detalle con el formulario como estaba y quita el aviso',
    doc.getElementById('detalle').style.display !== 'none' && !doc.querySelector('.modo-colocar-aviso') && doc.querySelectorAll('#f-fotos-muerte .rp-foto-elegida').length === 2);
  click(win, doc.getElementById('f-ubic-mapa'));
  win.colocarUbicMuerteEn({ lat: -31.401234567, lng: -55.431234567 });
  chequear('tocar el mapa devuelve el detalle del potrero', doc.getElementById('detalle').style.display !== 'none');
  chequear('tocar el mapa marca el lugar y quita el aviso', /Marcada: -31\.40123, -55\.43123/.test(doc.getElementById('f-ubic-txt').textContent) && !doc.querySelector('.modo-colocar-aviso'), doc.getElementById('f-ubic-txt').textContent);
  chequear('aparece "Quitar ubicación"', doc.getElementById('f-ubic-quitar').style.display !== 'none');
  click(win, doc.getElementById('f-confirmar'));
  await esperar(100);
  const evM = filasDe('muerte').find(f => f.detalle.obs === 'Con foto y lugar');
  chequear('el evento muerte sale con lat y lon (6 decimales)', !!evM && evM.detalle.lat === -31.401235 && evM.detalle.lon === -55.431235, JSON.stringify(evM && evM.detalle));
  const idM = evM && evM.event_id;
  const fotosM = filasDe('muerte_foto').filter(f => f.detalle.id === idM);
  chequear('salen 2 muerte_foto con id = event_id de la muerte, después de ella',
    fotosM.length === 2 && fotosM.every(f => servidor.filas.indexOf(f) > servidor.filas.indexOf(evM)));
  chequear('con ruta exacta, momento "registro", y la foto ya estaba en el bucket',
    fotosM.every(f => f.detalle.path === `${est}/${idM}/${f.detalle.fotoId}.jpg` && f.detalle.momento === 'registro') && servidor.eventosSinFoto.length === 0, JSON.stringify(servidor.eventosSinFoto));
  const hM = () => win.__est().potreros[pot].historial.find(h => h.eventId === idM);
  chequear('el renglón del historial guarda eventId, el lugar (ubic) y las 2 fotos',
    !!hM() && hM().ubic && hM().ubic.lat === -31.401235 && (hM().fotos || []).length === 2);
  chequear('el lugar no se mete en `extra` (lo comparan las correcciones)', hM().extra && !('lat' in hM().extra) && !('ubic' in hM().extra));
  chequear('la muerte descontó 1 animal del stock', win.__est().potreros[pot].animales[win.claveAnimal('Vacas', dueno)] === 8);

  // ---------- historial: miniaturas, 📷 y 🗺 ----------
  win.seleccionarPotrero(pot);
  const hid = hM().id;
  chequear('el historial muestra las 2 miniaturas de la muerte', doc.querySelectorAll(`[data-hist-fotos="${idM}"] [data-foto-thumb][data-foto-tipo="muerte"]`).length === 2);
  const btnMapa = () => doc.querySelector(`[data-hist-mapa="${hid}"]`);
  chequear('hay 📷 y 🗺 en la muerte' + ' (solo si el renglón es editable)', !!btnMapa() && !!doc.querySelector(`[data-hist-foto="${hid}"]`));
  log.length = 0;
  click(win, btnMapa());
  const svM = log.find(e => e[0] === 'setView');
  chequear('🗺 lleva al lugar marcado (zoom 17) y abre un popup con "Muerte"',
    !!svM && Math.abs(svM[1][0] + 31.401235) < 1e-9 && svM[2] === 17 && log.some(e => e[0] === 'openPopup'));
  chequear('🗺 oculta el detalle del potrero, que tapa el mapa', doc.getElementById('detalle').style.display === 'none');
  const tempM = log.filter(e => e[0] === 'addTo').map(e => e[1]).pop();
  chequear('el popup de la muerte tiene sus miniaturas', !!tempM && /Muerte/.test(tempM._html || '') && /data-foto-thumb/.test(tempM._html || ''), tempM && tempM._html);
  click(win, doc.querySelector(`[data-hist-foto="${hid}"]`));
  await elegirFotos(win, doc.getElementById('rp-fotos-extra'), [foto(win, 'm3.jpg')]);
  await esperar(100);
  chequear('📷 suma una foto a la muerte y la miniatura aparece sin rehacer el detalle',
    (hM().fotos || []).length === 3 && doc.querySelectorAll(`[data-hist-fotos="${idM}"] [data-foto-thumb]`).length === 3 && filasDe('muerte_foto').filter(f => f.detalle.id === idM).length === 3);

  // ---------- muerte sin lugar marcado: 🗺 centra el potrero ----------
  win.mostrarFormulario(pot, 'muerte');
  doc.getElementById('f-cat').value = 'Vacas';
  doc.getElementById('f-cant').value = '1';
  chequear('el formulario nuevo no hereda el lugar ni las fotos de la muerte anterior',
    /Sin ubicación marcada/.test(doc.getElementById('f-ubic-txt').textContent) && doc.querySelectorAll('#f-fotos-muerte .rp-foto-elegida').length === 0 && doc.getElementById('f-ubic-quitar').style.display === 'none');
  doc.getElementById('f-obs').value = 'Sin lugar';
  click(win, doc.getElementById('f-confirmar'));
  await esperar(60);
  const evS = filasDe('muerte').find(f => f.detalle.obs === 'Sin lugar');
  chequear('una muerte sin lugar ni fotos manda el evento de siempre (sin lat/lon)', !!evS && !('lat' in evS.detalle) && !('lon' in evS.detalle) && !filasDe('muerte_foto').some(f => f.detalle.id === evS.event_id));
  win.seleccionarPotrero(pot);
  const hS = win.__est().potreros[pot].historial.find(h => h.eventId === evS.event_id);
  log.length = 0;
  click(win, doc.querySelector(`[data-hist-mapa="${hS.id}"]`));
  chequear('🗺 sin lugar marcado centra el potrero (fitBounds) y no abre ningún popup', log.some(e => e[0] === 'fitBounds') && !log.some(e => e[0] === 'openPopup'));
  chequear('y también oculta el detalle', doc.getElementById('detalle').style.display === 'none');

  // ---------- muerte sin señal: la muerte y la foto esperan, y salen en orden ----------
  setEnLinea(false);
  win.mostrarFormulario(pot, 'muerte');
  doc.getElementById('f-cat').value = 'Vacas';
  doc.getElementById('f-cant').value = '1';
  doc.getElementById('f-obs').value = 'Muerte sin señal';
  await elegirFotos(win, doc.querySelector('#f-fotos-muerte [data-sf-input]'), [foto(win, 'o.jpg')]);
  click(win, doc.getElementById('f-confirmar'));
  await esperar(60);
  chequear('sin señal: la foto de la muerte queda en la cola y el indicador lo dice', win.__fotosN() === 1 && /foto sin subir/.test(win.__textoSync().texto), win.__textoSync().texto);
  setEnLinea(true);
  await win.__sincronizar();
  await esperar(100);
  const evO = filasDe('muerte').find(f => f.detalle.obs === 'Muerte sin señal');
  const fO = evO ? filasDe('muerte_foto').filter(f => f.detalle.id === evO.event_id) : [];
  chequear('al volver la señal sale la muerte y después su foto', !!evO && fO.length === 1 && servidor.filas.indexOf(fO[0]) > servidor.filas.indexOf(evO) && win.__fotosN() === 0);

  // ---------- "Dar muerte" desde Desaparecidos: fotos y lugar ----------
  win.mostrarFormulario(pot, 'desaparecido');
  doc.getElementById('f-cat').value = 'Vacas';
  doc.getElementById('f-cant').value = '3';
  doc.getElementById('f-obs').value = 'Se fueron';
  click(win, doc.getElementById('f-confirmar'));
  await esperar(60);
  const caso = win.listarCasosDesaparecidos().find(c => c.potreroOrigen === pot);
  chequear('hay un caso de desaparecidos abierto por 3', !!caso && caso.pendiente === 3);
  win.renderDesaparecidosLista();
  doc.getElementById('modal-desaparecidos').style.display = 'flex';
  win.abrirFormularioMuerteDesaparecido(caso);
  chequear('"Dar muerte" tiene fotos y "dónde se encontró"', !!doc.querySelector('#md-fotos [data-sf-input]') && !!doc.getElementById('md-ubic-mapa') && !!doc.getElementById('md-ubic-txt'));
  chequear('el botón de GPS solo está en el celular (también acá)', tieneGPS === !!doc.getElementById('md-ubic-gps'));
  await elegirFotos(win, doc.querySelector('#md-fotos [data-sf-input]'), [foto(win, 'd1.jpg'), foto(win, 'd2.jpg')]);
  chequear('muestra las 2 fotos elegidas', doc.querySelectorAll('#md-fotos .rp-foto-elegida').length === 2);
  click(win, doc.getElementById('md-ubic-mapa'));
  chequear('"Marcar en el mapa" oculta la ventana de Desaparecidos (tapa el mapa) y trae Cancelar',
    doc.getElementById('modal-desaparecidos').style.display === 'none' && !!doc.querySelector('.modo-colocar-aviso button'));
  click(win, doc.querySelector('.modo-colocar-aviso button'));
  chequear('Cancelar devuelve la ventana con el formulario como estaba',
    doc.getElementById('modal-desaparecidos').style.display === 'flex' && !doc.querySelector('.modo-colocar-aviso') && doc.querySelectorAll('#md-fotos .rp-foto-elegida').length === 2);
  click(win, doc.getElementById('md-ubic-mapa'));
  win.colocarUbicMuerteEn({ lat: -31.402, lng: -55.432 });
  chequear('tocar el mapa devuelve la ventana y marca el lugar',
    doc.getElementById('modal-desaparecidos').style.display === 'flex' && /Marcada: -31\.40200, -55\.43200/.test(doc.getElementById('md-ubic-txt').textContent), doc.getElementById('md-ubic-txt').textContent);
  doc.getElementById('md-cant').value = '2';
  click(win, doc.getElementById('md-confirmar'));
  await esperar(100);
  const evD = filasDe('muerte_desaparecido').find(f => f.detalle.casoId === caso.casoId);
  chequear('el evento muerte_desaparecido sale con lat y lon', !!evD && evD.detalle.lat === -31.402 && evD.detalle.lon === -55.432, JSON.stringify(evD && evD.detalle));
  const fotosD = evD ? filasDe('muerte_foto').filter(f => f.detalle.id === evD.event_id) : [];
  chequear('salen 2 muerte_foto con id = event_id de la muerte, después de ella, con ruta exacta',
    fotosD.length === 2 && fotosD.every(f => servidor.filas.indexOf(f) > servidor.filas.indexOf(evD) && f.detalle.path === `${est}/${evD.event_id}/${f.detalle.fotoId}.jpg`) && servidor.eventosSinFoto.length === 0, JSON.stringify(servidor.eventosSinFoto));
  const hD = () => win.__est().potreros[pot].historial.find(h => h.eventId === (evD && evD.event_id));
  chequear('el renglón guarda el lugar (ubic) y las 2 fotos', !!hD() && hD().tipo === 'muerte_desaparecido' && hD().ubic && hD().ubic.lat === -31.402 && (hD().fotos || []).length === 2);
  chequear('el lugar no se mete en `extra` ni en origDatos', !('lat' in (hD().extra || {})) && !('lat' in (hD().origDatos || {})));
  chequear('el formulario nuevo no hereda el lugar de la muerte anterior', (() => { win.mostrarFormulario(pot, 'muerte'); return /Sin ubicación marcada/.test(doc.getElementById('f-ubic-txt').textContent); })());
  win.cerrarDetalle();
  win.seleccionarPotrero(pot);
  const hidD = hD().id;
  chequear('el historial muestra sus 2 miniaturas y los botones 📷 y 🗺',
    doc.querySelectorAll(`[data-hist-fotos="${evD.event_id}"] [data-foto-thumb][data-foto-tipo="muerte"]`).length === 2 && !!doc.querySelector(`[data-hist-foto="${hidD}"]`) && !!doc.querySelector(`[data-hist-mapa="${hidD}"]`));
  log.length = 0;
  click(win, doc.querySelector(`[data-hist-mapa="${hidD}"]`));
  const svD = log.find(e => e[0] === 'setView');
  chequear('🗺 lleva al lugar marcado (zoom 17) y abre su popup', !!svD && Math.abs(svD[1][0] + 31.402) < 1e-9 && svD[2] === 17 && log.some(e => e[0] === 'openPopup'));
  click(win, doc.querySelector(`[data-hist-foto="${hidD}"]`));
  await elegirFotos(win, doc.getElementById('rp-fotos-extra'), [foto(win, 'd3.jpg')]);
  await esperar(100);
  chequear('📷 suma una foto a esa muerte', (hD().fotos || []).length === 3 && filasDe('muerte_foto').filter(f => f.detalle.id === evD.event_id).length === 3);
  // una muerte de desaparecido que viene de otro equipo trae su lugar y recibe fotos
  const idDR = uuid();
  remoto('muerte_desaparecido', { categoria: 'Vacas', dueno, cantidad: 1, caravana: null, casoId: 'caso_remoto', lat: -31.6, lon: -55.6 }, { potrero: pot, event_id: idDR });
  const hDR = () => win.__est().potreros[pot].historial.find(h => h.eventId === idDR);
  chequear('una muerte_desaparecido remota con lat/lon deja su lugar en el renglón', !!hDR() && hDR().ubic && hDR().ubic.lat === -31.6 && hDR().ubic.lon === -55.6);
  remoto('muerte_foto', armar(idDR));
  chequear('y recibe su muerte_foto', (hDR().fotos || []).length === 1);

  // ---------- receptor: una muerte de otro equipo con lugar, y su foto ----------
  const idR = uuid();
  remoto('muerte', { categoria: 'Vacas', dueno, cantidad: 1, obs: 'de otro equipo', lat: -31.5, lon: -55.5 }, { potrero: pot, event_id: idR });
  const hR = () => win.__est().potreros[pot].historial.find(h => h.eventId === idR);
  chequear('una muerte remota con lat/lon deja su lugar (ubic) en el renglón', !!hR() && hR().ubic && hR().ubic.lat === -31.5 && hR().ubic.lon === -55.5);
  chequear('y el lugar no se mezcla con origDatos', hR().origDatos && !('lat' in hR().origDatos));
  const fidR = uuid();
  const dR = armar(idR, { fotoId: fidR });
  remoto('muerte_foto', dR);
  chequear('muerte_foto remoto válido se agrega al renglón', (hR().fotos || []).length === 1 && hR().fotos[0].fotoId === fidR);
  remoto('muerte_foto', dR);
  chequear('el mismo muerte_foto dos veces no duplica', hR().fotos.length === 1);
  [
    ['id que no es un event_id', armar('rp_123')],
    ['ruta de otro establecimiento', armar(idR, { path: `${otroEst}/${idR}/${uuid()}.jpg` })],
    ['ruta de otra muerte', armar(idR, { path: `${est}/${uuid()}/${uuid()}.jpg` })],
    ['momento "reporte"', armar(idR, { momento: 'reporte' })],
    ['muerte que no está en este equipo', armar(uuid())]
  ].forEach(([nombre, d]) => {
    remoto('muerte_foto', d);
    chequear('muerte_foto rechazado: ' + nombre, hR().fotos.length === 1);
  });

  // ---------- Cerrar y volver a abrir la app con puntos, muertes y fotos ya guardados ----------
  // (así se encontró un error real: el mapa dibujaba los puntos guardados antes de que existiera TIPOS_FOTO y la app no cargaba)
  const almacen = {};
  for(let i = 0; i < win.localStorage.length; i++){ const k = win.localStorage.key(i); almacen[k] = win.localStorage.getItem(k); }
  const dos = await levantar(archivo, servidorFalso(), almacen);
  chequear('al reabrir la app con puntos y muertes con fotos guardados, carga sin errores', dos.errores.length === 0, dos.errores[0] || '');
  if(!dos.errores.length){
    const marcadores = dos.win.__puntosLayers();
    chequear('el punto guardado vuelve al mapa con las miniaturas de sus fotos en el popup',
      !!marcadores[p1.id] && /data-foto-thumb/.test(marcadores[p1.id]._html || ''), JSON.stringify(Object.keys(marcadores)));
    // una foto que quedó esperando en la cola al cerrar la app: el popup del punto la muestra cuando se lee la cola
    const antesThumbs = (marcadores[p1.id]._html.match(/data-foto-thumb/g) || []).length;
    await dos.win.__fotosTest.poner({ fotoId: uuid(), reporteId: p1.id, tipoFoto: 'punto', momento: 'registro', fecha: '2026-10-29', establecimiento: est, creado: Date.now(), blob: new dos.win.Blob(['x']) });
    await dos.win.refrescarFotosPendientes();
    chequear('al leer la cola, el popup de un punto suma la foto que estaba esperando',
      (dos.win.__puntosLayers()[p1.id]._html.match(/data-foto-thumb/g) || []).length === antesThumbs + 1, dos.win.__puntosLayers()[p1.id]._html);
    chequear('y el renglón de la muerte conserva su lugar y sus fotos',
      !!dos.win.__est().potreros[pot].historial.find(h => h.eventId === idM && h.ubic && (h.fotos || []).length === 3));
  }

  // ---------- Verificar stock (solo PC): estos eventos en el registro no cambian nada ----------
  if(typeof win.reconstruirStockDesdeRegistro === 'function'){
    const antes = JSON.stringify(win.__est());
    const llamadasAntes = log.length;
    win.reconstruirStockDesdeRegistro(servidor.filas.slice());
    chequear('Verificar stock no cambia el estado con puntos, muertes y fotos en el registro', JSON.stringify(win.__est()) === antes);
    chequear('Verificar stock no llama al mapa', log.length === llamadasAntes);
  } else {
    console.log('  (Verificar stock: solo PC, esta variante no lo tiene)');
  }

  chequear('sin errores de consola durante la prueba', errores.length === 0, errores[0] || '');
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
