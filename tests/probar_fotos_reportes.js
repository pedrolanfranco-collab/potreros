/*
 * Prueba ad-hoc: fotos de los reportes de campo (24/10/2026, a pedido de Pedro). Sobre
 * probar_infraestructura.js (los reportes en sí) agrega:
 * - subida al bucket `fotos-reportes` (Supabase Storage, con un servidor falso que contesta como el real: 409 si la
 *   ruta ya existe) y el evento `reporte_foto` SOLO después de que la subida confirma: ningún equipo recibe una foto
 *   que no existe (el test verifica eso en cada evento);
 * - cola de fotos sin señal (la copia en memoria de IndexedDB, porque jsdom no la tiene): el indicador de
 *   sincronización dice "N fotos sin subir", y al volver la señal sincronizar() las manda;
 * - reintento con 409 no duplica el evento; un error de red deja la foto en la cola y registra la falla;
 * - receptor: idempotente por fotoId, acepta solo la ruta exacta del establecimiento, rechaza "../", otro
 *   establecimiento, momentos y ids raros;
 * - tope de 3 fotos al crear y de 10 por reporte; foto del arreglo al resolver (momento "resuelto");
 * - "🗺 Ver en el mapa" (setView a 17, openPopup; resuelto: marcador gris temporal que se quita al cerrar el popup
 *   o al ver otro); visor de fotos; eliminar un reporte saca sus fotos pendientes;
 * - Verificar stock (solo PC) no cambia estado ni llama a Leaflet con un reporte_foto en el registro.
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
    fitBounds(){ return mapa; }, on(){ return mapa; },
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
      if(obj.tipo === 'reporte_foto' && !srv.storage.has(obj.detalle.path)) srv.eventosSinFoto.push(obj.detalle.path);
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

async function levantar(archivo, servidor){
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
  const { win, errores, log, setEnLinea, scrollsMapa } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const est = win.__EST;
  const otroEst = est === 'la_vuelta' ? 'maria_laura' : 'la_vuelta';
  const tieneGPS = !!doc.getElementById('rp-gps');
  const reportes = () => win.__reportes();
  const filasDe = tipo => servidor.filas.filter(f => f.tipo === tipo);

  chequear('ESTABLECIMIENTO es uno de los 3 de la app', ['la_vuelta', 'maria_laura', 'pone_chico'].includes(est), est);

  // ---------- 1. Crear con 2 fotos: el reporte sale primero, las fotos se suben y después sale reporte_foto ----------
  click(win, doc.getElementById('btn-infraestructura'));
  await elegirFotos(win, doc.getElementById('rp-fotos'), [foto(win, 'a.jpg'), foto(win, 'b.jpg')]);
  chequear('el modal muestra las 2 fotos elegidas', doc.querySelectorAll('#rp-fotos-lista .rp-foto-elegida').length === 2);
  doc.getElementById('rp-subtipo').value = 'Caño roto';
  doc.getElementById('rp-obs').value = 'Caño con pérdida';
  click(win, doc.getElementById('rp-mapa'));
  chequear('al marcar en el mapa, el formulario suelta sus fotos (van con el reporte)', doc.querySelectorAll('#rp-fotos-lista .rp-foto-elegida').length === 0);
  win.colocarReporteEn({ lat: -31.40, lng: -55.43 });
  const rep1 = reportes().find(r => r.obs === 'Caño con pérdida');
  chequear('el reporte se crea con su lista de fotos vacía, que se llena al subir', !!rep1 && Array.isArray(rep1.fotos));
  await esperar(80);
  const idxCreado = servidor.filas.findIndex(f => f.tipo === 'reporte_creado' && f.detalle.id === rep1.id);
  chequear('reporte_creado sale enseguida', idxCreado >= 0);
  chequear('las 2 fotos se subieron al bucket fotos-reportes',
    servidor.subidas.filter(p => p.startsWith(`${est}/${rep1.id}/`)).length === 2, JSON.stringify(servidor.subidas));
  const evs1 = filasDe('reporte_foto').filter(f => f.detalle.id === rep1.id);
  chequear('salen 2 reporte_foto, después de reporte_creado', evs1.length === 2 && evs1.every(f => servidor.filas.indexOf(f) > idxCreado));
  chequear('cada reporte_foto lleva la ruta exacta <est>/<id>/<fotoId>.jpg y momento "reporte"',
    evs1.every(f => f.detalle.path === `${est}/${rep1.id}/${f.detalle.fotoId}.jpg` && f.detalle.momento === 'reporte' && esUuid(f.detalle.fotoId)));
  chequear('ningún reporte_foto salió antes de que su foto estuviera en el bucket', servidor.eventosSinFoto.length === 0, JSON.stringify(servidor.eventosSinFoto));
  chequear('la subida va con upsert:false y image/jpeg', servidor.intentos.length >= 2 && servidor.intentos.every(i => i.opts.upsert === false && i.opts.contentType === 'image/jpeg' && i.bucket === BUCKET));
  chequear('en el reporte local quedan las 2 fotos subidas', reportes().find(r => r.id === rep1.id).fotos.length === 2);
  chequear('la cola de fotos queda vacía', win.__fotosN() === 0 && (await win.__fotosTest.listar()).length === 0);
  chequear('el formulario quedó sin fotos después de guardar', doc.querySelectorAll('#rp-fotos-lista .rp-foto-elegida').length === 0);

  if(tieneGPS){
    // ---------- 1b. (móvil) por GPS, con una foto ----------
    await elegirFotos(win, doc.getElementById('rp-fotos'), [foto(win, 'gps.jpg')]);
    doc.getElementById('rp-obs').value = 'Foco por GPS';
    win.__gpsCoords = { lat: -31.41, lon: -55.44, acc: 8 };
    click(win, doc.getElementById('rp-gps'));
    await esperar(60);
    const gps = reportes().find(r => r.obs === 'Foco por GPS');
    chequear('el reporte por GPS lleva su foto (una, subida)', !!gps && gps.fotos.length === 1 && filasDe('reporte_foto').some(f => f.detalle.id === gps.id));
    chequear('el formulario se vació tras guardar por GPS', doc.querySelectorAll('#rp-fotos-lista .rp-foto-elegida').length === 0);
  }

  // ---------- 2. Sin señal: quedan en la cola, el indicador lo dice; al volver, se mandan ----------
  setEnLinea(false);
  const subidasAntes = servidor.subidas.length;
  await elegirFotos(win, doc.getElementById('rp-fotos'), [foto(win, 'c.jpg'), foto(win, 'd.jpg')]);
  doc.getElementById('rp-obs').value = 'Sin señal';
  click(win, doc.getElementById('rp-mapa'));
  win.colocarReporteEn({ lat: -31.43, lng: -55.46 });
  const rep2 = reportes().find(r => r.obs === 'Sin señal');
  await esperar(60);
  chequear('sin señal no sale ningún reporte_creado ni se sube nada', !servidor.filas.some(f => f.tipo === 'reporte_creado' && f.detalle.id === rep2.id) && servidor.subidas.length === subidasAntes);
  chequear('las 2 fotos quedan en la cola', win.__fotosN() === 2 && (await win.__fotosTest.listar()).filter(x => x.reporteId === rep2.id).length === 2);
  chequear('el indicador de sincronización dice "fotos sin subir"', /2 fotos sin subir/.test(win.textoEstadoSyncOrdenada().texto), win.textoEstadoSyncOrdenada().texto);
  chequear('el pie de la página lo muestra', /fotos sin subir/.test(doc.getElementById('estado-sync').textContent), doc.getElementById('estado-sync').textContent);
  setEnLinea(true);
  await win.__sincronizar();
  await esperar(60);
  chequear('al volver la señal, sincronizar() sube las 2 fotos', filasDe('reporte_foto').filter(f => f.detalle.id === rep2.id).length === 2);
  chequear('y el indicador ya no dice nada de fotos', !/fotos sin subir/.test(doc.getElementById('estado-sync').textContent), doc.getElementById('estado-sync').textContent);
  const idxCreado2 = servidor.filas.findIndex(f => f.tipo === 'reporte_creado' && f.detalle.id === rep2.id);
  chequear('reporte_creado (sin señal) va antes que sus fotos', idxCreado2 >= 0 && filasDe('reporte_foto').filter(f => f.detalle.id === rep2.id).every(f => servidor.filas.indexOf(f) > idxCreado2));

  // ---------- 3. 409: la foto ya estaba en el bucket; no se duplica el evento ----------
  const fRep1 = reportes().find(r => r.id === rep1.id).fotos[0];
  await win.__fotosTest.poner({ fotoId: fRep1.fotoId, reporteId: rep1.id, momento: 'reporte', fecha: '2026-10-24', establecimiento: est, creado: Date.now(), blob: new win.Blob(['x'], { type: 'image/jpeg' }) });
  await win.__vaciarFotos();
  chequear('si la foto ya estaba (409) no se manda un segundo reporte_foto', filasDe('reporte_foto').filter(f => f.detalle.fotoId === fRep1.fotoId).length === 1);
  chequear('y la copia de la cola se saca igual', win.__fotosN() === 0);
  // caso inverso: subió, pero el equipo no guardó el registro (se corta antes). Llega el 409 y el evento sale UNA vez.
  const idNuevo = uuid();
  servidor.storage.set(`${est}/${rep1.id}/${idNuevo}.jpg`, { bucket: BUCKET, blob: null });
  await win.__fotosTest.poner({ fotoId: idNuevo, reporteId: rep1.id, momento: 'reporte', fecha: '2026-10-24', establecimiento: est, creado: Date.now(), blob: new win.Blob(['x'], { type: 'image/jpeg' }) });
  await win.__vaciarFotos();
  chequear('409 de una subida anterior: cuenta como subida y manda el evento una sola vez',
    filasDe('reporte_foto').filter(f => f.detalle.fotoId === idNuevo).length === 1 && reportes().find(r => r.id === rep1.id).fotos.some(f => f.fotoId === idNuevo));

  // ---------- 4. Error de red: queda en la cola y registrado; al volver, sale ----------
  servidor.fallarSubida = () => ({ message: 'fetch failed' });
  const rep4 = (() => { click(win, doc.getElementById('rp-fotos-boton')); return null; })();
  await elegirFotos(win, doc.getElementById('rp-fotos'), [foto(win, 'e.jpg')]);
  doc.getElementById('rp-obs').value = 'Con error de red';
  click(win, doc.getElementById('rp-mapa'));
  win.colocarReporteEn({ lat: -31.44, lng: -55.47 });
  const rep4b = reportes().find(r => r.obs === 'Con error de red');
  await esperar(60);
  chequear('un error de red deja la foto en la cola y registra la falla (pasajera)',
    win.__fotosN() === 1 && !!win.__est().fallos && !!win.__est().fallos.fotos && win.__est().fallos.fotos.permanente === false, JSON.stringify(win.__est().fallos));
  chequear('el indicador muestra la falla', /falló el último intento/.test(win.textoEstadoSyncOrdenada().texto), win.textoEstadoSyncOrdenada().texto);
  servidor.fallarSubida = (p) => p.indexOf(rep4b.id) >= 0 ? { statusCode: '400', message: 'Bucket not found' } : null;
  await win.__vaciarFotos();
  chequear('un 400 es permanente', win.__est().fallos.fotos.permanente === true);
  servidor.fallarSubida = null;
  await win.__vaciarFotos();
  chequear('cuando vuelve Storage, la foto sale y se borra la falla', win.__fotosN() === 0 && !win.__est().fallos.fotos && filasDe('reporte_foto').some(f => f.detalle.id === rep4b.id));
  void rep4;

  // ---------- 5. Receptor: otro equipo ----------
  win.aplicarEventoRemoto({ tipo: 'reporte_creado', potrero: est, dispositivo: 'otro', fecha_cliente: '24/10/2026',
    detalle: { id: 'rp_remoto_1', categoria: 'infraestructura', subtipo: 'Bebedero roto', obs: null, fecha: '2026-10-24', lat: -31.5, lon: -55.5 } });
  const buena = { id: 'rp_remoto_1', fotoId: uuid(), momento: 'reporte', fecha: '2026-10-24' };
  buena.path = `${est}/${buena.id}/${buena.fotoId}.jpg`;
  win.aplicarEventoRemoto({ tipo: 'reporte_foto', potrero: est, dispositivo: 'otro', fecha_cliente: '24/10/2026', detalle: buena });
  const remoto = () => reportes().find(r => r.id === 'rp_remoto_1');
  chequear('reporte_foto remoto válido se agrega al reporte', remoto().fotos.length === 1 && remoto().fotos[0].fotoId === buena.fotoId);
  win.aplicarEventoRemoto({ tipo: 'reporte_foto', potrero: est, dispositivo: 'otro', fecha_cliente: '24/10/2026', detalle: buena });
  chequear('el mismo reporte_foto dos veces no duplica (idempotente por fotoId)', remoto().fotos.length === 1);
  // cada caso con su propio fotoId: si no, la idempotencia (mismo fotoId) taparía lo que se quiere probar
  const [f1, f2, f3, f4, f5] = [uuid(), uuid(), uuid(), uuid(), uuid()];
  const malas = [
    ['otro establecimiento', { id: buena.id, fotoId: f1, momento: 'reporte', fecha: buena.fecha, path: `${otroEst}/${buena.id}/${f1}.jpg` }],
    ['con ../ en la ruta', { id: buena.id, fotoId: f2, momento: 'reporte', fecha: buena.fecha, path: `${est}/${buena.id}/../../${f2}.jpg` }],
    ['ruta sin la carpeta del reporte', { id: buena.id, fotoId: f3, momento: 'reporte', fecha: buena.fecha, path: `${est}/${f3}.jpg` }],
    ['momento inventado', { id: buena.id, fotoId: f4, momento: 'otro', fecha: buena.fecha, path: `${est}/${buena.id}/${f4}.jpg` }],
    ['fotoId que no es UUID', { id: buena.id, fotoId: 'hola', momento: 'reporte', fecha: buena.fecha, path: `${est}/${buena.id}/hola.jpg` }],
    ['id de reporte raro', { id: 'x y', fotoId: f5, momento: 'reporte', fecha: buena.fecha, path: `${est}/x y/${f5}.jpg` }]
  ];
  for(const [nombre, d] of malas){
    win.aplicarEventoRemoto({ tipo: 'reporte_foto', potrero: est, dispositivo: 'otro', fecha_cliente: '24/10/2026', detalle: d });
    chequear('rechaza: ' + nombre, remoto().fotos.length === 1);
  }
  win.aplicarEventoRemoto({ tipo: 'reporte_foto', potrero: est, dispositivo: 'otro', fecha_cliente: '24/10/2026',
    detalle: { id: 'rp_no_existe', fotoId: uuid(), momento: 'reporte', path: `${est}/rp_no_existe/x.jpg` } });
  chequear('un reporte_foto de un reporte que no está en este equipo se ignora', !reportes().some(r => r.id === 'rp_no_existe'));
  chequear('un reporte_foto remoto no pasa por la cola local', win.__fotosN() === 0);

  // ---------- 5b. Sincronizar trae la foto de otro equipo (camino real de pull) ----------
  const rowsRemotos = [
    { tipo: 'reporte_creado', establecimiento: est, potrero: est, dispositivo: 'otro', detalle: { id: 'rp_remoto_2', categoria: 'capin_annoni', subtipo: 'Foco de capín annoni', obs: null, fecha: '2026-10-24', lat: -31.6, lon: -55.6 } },
    { tipo: 'reporte_foto', establecimiento: est, potrero: est, dispositivo: 'otro', detalle: Object.assign({}, buena, { id: 'rp_remoto_2', fotoId: uuid(), path: null }) }
  ];
  rowsRemotos[1].detalle.path = `${est}/rp_remoto_2/${rowsRemotos[1].detalle.fotoId}.jpg`;
  rowsRemotos.forEach(row => { servidor.insertar('eventos_sync', Object.assign({ event_id: uuid() }, row)); });
  // el servidor sí tiene la foto: el equipo de origen la subió antes que el evento
  servidor.storage.set(rowsRemotos[1].detalle.path, { bucket: BUCKET, blob: null });
  await win.__sincronizar();
  await esperar(40);
  chequear('sincronizar aplica el reporte y la foto de otro equipo', (reportes().find(r => r.id === 'rp_remoto_2') || { fotos: [] }).fotos.length === 1);

  // ---------- 6. Resolver con foto del arreglo (momento "resuelto") ----------
  click(win, doc.getElementById('btn-infraestructura'));
  const rep6 = reportes().find(r => r.obs === 'Sin señal');
  click(win, doc.querySelector(`[data-resolver="${rep6.id}"]`));
  chequear('"✓ Resuelto" abre el mini formulario con botón de foto del arreglo', !!doc.querySelector(`[data-foto-resolver="${rep6.id}"]`));
  await elegirFotos(win, doc.getElementById('rp-foto-resolver'), [foto(win, 'arreglo.jpg')]);
  chequear('el formulario muestra la foto del arreglo elegida', !!doc.querySelector('.rp-form-resolver .rp-foto-elegida img'));
  click(win, doc.querySelector(`[data-confirmar-resuelto="${rep6.id}"]`));
  await esperar(60);
  chequear('el reporte queda resuelto', reportes().find(r => r.id === rep6.id).resuelto === true);
  const idxRes = servidor.filas.findIndex(f => f.tipo === 'reporte_resuelto' && f.detalle.id === rep6.id);
  const fRes = filasDe('reporte_foto').filter(f => f.detalle.id === rep6.id && f.detalle.momento === 'resuelto');
  chequear('la foto del arreglo sale como reporte_foto momento "resuelto", después de reporte_resuelto',
    idxRes >= 0 && fRes.length === 1 && servidor.filas.indexOf(fRes[0]) > idxRes);
  chequear('el formulario se cierra al confirmar', !doc.querySelector('.rp-form-resolver'));

  // ---------- 7. Agregar foto después (tope 10 por reporte) y tope 3 al crear ----------
  click(win, doc.getElementById('btn-infraestructura'));
  click(win, doc.getElementById('reporte-cerrar'));
  click(win, doc.getElementById('btn-infraestructura'));
  doc.getElementById('rp-subtipo').value = 'Caño roto';
  doc.getElementById('rp-obs').value = 'Para agregar fotos';
  click(win, doc.getElementById('rp-mapa'));
  win.colocarReporteEn({ lat: -31.46, lng: -55.49 });
  const rep7 = reportes().find(r => r.obs === 'Para agregar fotos');
  click(win, doc.getElementById('btn-infraestructura'));
  click(win, doc.querySelector(`[data-foto-agregar="${rep7.id}"]`));
  await elegirFotos(win, doc.getElementById('rp-fotos-extra'), [foto(win, 'despues.jpg')]);
  await esperar(60);
  chequear('"📷 Agregar foto" sube una foto (momento "reporte") al reporte ya creado',
    reportes().find(r => r.id === rep7.id).fotos.length === 1 && filasDe('reporte_foto').some(f => f.detalle.id === rep7.id && f.detalle.momento === 'reporte'));
  for(let i = 0; i < 9; i++){
    win.aplicarEventoRemoto({ tipo: 'reporte_foto', potrero: est, dispositivo: 'otro', fecha_cliente: '24/10/2026',
      detalle: { id: rep7.id, fotoId: uuid(), momento: 'reporte', fecha: '2026-10-24', path: `${est}/${rep7.id}/${'x'}.jpg` } });
  }
  // (las 9 anteriores tienen ruta inválida a propósito: no cuentan. Se agregan 9 válidas:)
  for(let i = 0; i < 9; i++){
    const fid = uuid();
    win.aplicarEventoRemoto({ tipo: 'reporte_foto', potrero: est, dispositivo: 'otro', fecha_cliente: '24/10/2026',
      detalle: { id: rep7.id, fotoId: fid, momento: 'reporte', fecha: '2026-10-24', path: `${est}/${rep7.id}/${fid}.jpg` } });
  }
  chequear('con 10 fotos el reporte no admite más (el botón queda deshabilitado)',
    win.__fotosDeReporte(reportes().find(r => r.id === rep7.id)).length === 10 && doc.querySelector(`[data-foto-agregar="${rep7.id}"]`).disabled === true);
  click(win, doc.getElementById('reporte-cerrar'));
  click(win, doc.getElementById('btn-infraestructura'));
  await elegirFotos(win, doc.getElementById('rp-fotos'), [foto(win, '1.jpg'), foto(win, '2.jpg'), foto(win, '3.jpg'), foto(win, '4.jpg')]);
  chequear('al crear, se toman como máximo 3 fotos', doc.querySelectorAll('#rp-fotos-lista .rp-foto-elegida').length === 3, String(doc.querySelectorAll('#rp-fotos-lista .rp-foto-elegida').length));
  chequear('con 3 fotos, el botón "Agregar foto" queda deshabilitado', doc.getElementById('rp-fotos-boton').disabled === true);
  // sacar una con su ✕
  click(win, doc.querySelector('[data-quitar-foto="0"]'));
  chequear('el ✕ saca una foto del formulario', doc.querySelectorAll('#rp-fotos-lista .rp-foto-elegida').length === 2);
  click(win, doc.getElementById('reporte-cerrar'));

  // ---------- 8. "🗺 Ver en el mapa" ----------
  click(win, doc.getElementById('btn-infraestructura'));
  const rep8 = reportes().find(r => r.obs === 'Para agregar fotos');
  log.length = 0;
  click(win, doc.querySelector(`[data-ver="${rep8.id}"]`));
  chequear('"Ver en el mapa" cierra la ventana', doc.getElementById('modal-reporte').style.display === 'none');
  const vista = log.find(e => e[0] === 'setView');
  chequear('centra el mapa en las coordenadas del reporte, zoom 17',
    !!vista && vista[1][0] === rep8.lat && vista[1][1] === rep8.lon && vista[2] === 17, JSON.stringify(vista));
  chequear('abre el popup del marcador del reporte activo', win.__reportesLayers()[rep8.id]._abierto === true);
  chequear('en el popup están las miniaturas (con la foto)', (win.__reportesLayers()[rep8.id]._html || '').indexOf('data-foto-thumb') >= 0);
  chequear('no crea marcador temporal para un reporte activo', !log.some(e => e[0] === 'addTo'));
  if(win.__esCampo) chequear('en Campo además lleva el mapa a la vista', scrollsMapa() > 0);
  else chequear('fuera de Campo no hace scroll al mapa', scrollsMapa() === 0);

  // popup abierto: sus miniaturas se pintan con la URL firmada (cuando hay señal)
  // (el popup de verdad está en el documento: las miniaturas de un elemento suelto no se pintan)
  const divPopup = doc.createElement('div');
  divPopup.innerHTML = win.__reportesLayers()[rep8.id]._html;
  doc.body.appendChild(divPopup);
  win.__reportesLayers()[rep8.id].emit('popupopen', { popup: { getElement: () => divPopup } });
  await esperar(40);
  chequear('el popup pinta la foto subida con su URL firmada', !!divPopup.querySelector('img') && /firmada\.test/.test(divPopup.querySelector('img').src));
  divPopup.remove();

  // ---------- 9. Miniaturas y visor ----------
  click(win, doc.getElementById('btn-infraestructura'));
  await esperar(40);
  const filaRep1 = doc.querySelector(`#reporte-lista [data-foto-thumb][data-reporte="${rep1.id}"]`);
  chequear('la lista muestra la miniatura de una foto subida, con imagen firmada', !!filaRep1 && !!filaRep1.querySelector('img') && /firmada\.test/.test(filaRep1.querySelector('img').src));
  click(win, doc.querySelector(`#reporte-lista [data-foto-thumb][data-reporte="${rep1.id}"]`));
  chequear('tocar una miniatura abre el visor', doc.getElementById('visor-fotos').style.display === 'flex');
  const nFotosRep1 = win.__fotosDeReporte(reportes().find(r => r.id === rep1.id)).length;
  chequear('el visor dice "Al reportar" y "1 de N" (N = fotos del reporte)', /Al reportar/.test(doc.getElementById('visor-pie').textContent) && doc.getElementById('visor-pie').textContent.indexOf('1 de ' + nFotosRep1) >= 0, doc.getElementById('visor-pie').textContent);
  await esperar(30);
  click(win, doc.getElementById('visor-next'));
  await esperar(30);
  chequear('› pasa a la segunda foto', doc.getElementById('visor-pie').textContent.indexOf('2 de ' + nFotosRep1) >= 0, doc.getElementById('visor-pie').textContent);
  chequear('el visor muestra la imagen firmada', /firmada\.test/.test((doc.querySelector('#visor-imagen img') || { src: '' }).src));
  click(win, doc.getElementById('visor-cerrar'));
  chequear('✕ cierra el visor', doc.getElementById('visor-fotos').style.display === 'none');
  click(win, doc.getElementById('reporte-cerrar'));

  // sin señal: las fotos ya subidas (no firmadas todavía) dicen que se ven con señal
  setEnLinea(false);
  const idRemoto2 = 'rp_remoto_2';
  const ultimaRemota = servidor.filas.find(f => f.tipo === 'reporte_foto' && f.detalle.id === idRemoto2);
  win.aplicarEventoRemoto({ tipo: 'reporte_creado', potrero: est, dispositivo: 'otro', detalle: { id: 'rp_offline_1', categoria: 'infraestructura', subtipo: 'Alambrado roto', obs: null, fecha: '2026-10-24', lat: -31.7, lon: -55.7 } });
  const fOff = uuid();
  win.aplicarEventoRemoto({ tipo: 'reporte_foto', potrero: est, dispositivo: 'otro', detalle: { id: 'rp_offline_1', fotoId: fOff, momento: 'reporte', fecha: '2026-10-24', path: `${est}/rp_offline_1/${fOff}.jpg` } });
  void ultimaRemota;
  click(win, doc.getElementById('btn-infraestructura'));
  await esperar(40);
  const offFila = doc.querySelector('#reporte-lista [data-foto-thumb][data-reporte="rp_offline_1"]');
  chequear('sin señal, una foto no firmada se muestra con 📷 y "(se ven con señal)"',
    !!offFila && offFila.textContent.indexOf('📷') >= 0 && !!doc.querySelector('#reporte-lista .rp-nota'));
  click(win, doc.getElementById('reporte-cerrar'));
  setEnLinea(true);

  // ---------- 10. Eliminar un reporte saca sus fotos pendientes de la cola ----------
  setEnLinea(false);
  click(win, doc.getElementById('btn-infraestructura'));
  doc.getElementById('rp-subtipo').value = 'Otro';
  doc.getElementById('rp-obs').value = 'Para borrar';
  await elegirFotos(win, doc.getElementById('rp-fotos'), [foto(win, 'borrar.jpg')]);
  click(win, doc.getElementById('rp-mapa'));
  win.colocarReporteEn({ lat: -31.48, lng: -55.51 });
  const rep10 = reportes().find(r => r.obs === 'Para borrar');
  await esperar(30);
  chequear('sin señal, la foto del reporte que se va a borrar queda en cola', (await win.__fotosTest.listar()).some(x => x.reporteId === rep10.id));
  click(win, doc.getElementById('btn-infraestructura'));
  click(win, doc.querySelector(`[data-del="${rep10.id}"]`));
  await esperar(30);
  chequear('eliminar el reporte saca sus fotos pendientes', !(await win.__fotosTest.listar()).some(x => x.reporteId === rep10.id) && !reportes().some(r => r.id === rep10.id));
  click(win, doc.getElementById('reporte-cerrar'));
  setEnLinea(true);

  // ---------- 11. Ver en el mapa de un resuelto: marcador gris temporal ----------
  click(win, doc.getElementById('btn-infraestructura'));
  const resuelto1 = reportes().find(r => r.obs === 'Sin señal');
  const resuelto2 = reportes().find(r => r.id === 'rp_remoto_1') || reportes().find(r => r.id === rep6.id);
  log.length = 0;
  click(win, doc.querySelector(`#reporte-lista [data-ver="${resuelto1.id}"]`));
  const temp1 = log.filter(e => e[0] === 'addTo').map(e => e[1]).pop();
  chequear('un resuelto (sin pin) crea un marcador temporal en su lugar', !!temp1 && temp1._lat === resuelto1.lat && temp1._lon === resuelto1.lon);
  chequear('el marcador temporal abre su popup', temp1 && temp1._abierto === true);
  chequear('el mapa va a su ubicación', log.some(e => e[0] === 'setView' && e[1][0] === resuelto1.lat));
  temp1.emit('popupclose', {});
  chequear('al cerrar su popup, el marcador temporal se quita del mapa', log.some(e => e[0] === 'removeLayer' && e[1] === temp1));
  log.length = 0;
  click(win, doc.querySelector(`#reporte-lista [data-ver="${resuelto1.id}"]`));
  const temp2 = log.filter(e => e[0] === 'addTo').map(e => e[1]).pop();
  click(win, doc.querySelector(`#reporte-lista [data-ver="${resuelto2.id}"]`));
  chequear('ver otro resuelto quita el temporal anterior', log.some(e => e[0] === 'removeLayer' && e[1] === temp2) || !temp2);
  click(win, doc.getElementById('reporte-cerrar'));

  // ---------- 12. Verificar stock (solo PC): un reporte_foto en el registro no cambia nada ----------
  if(typeof win.reconstruirStockDesdeRegistro === 'function'){
    const antes = JSON.stringify(win.__est());
    const llamadasAntes = log.length;
    const nRep = reportes().length;
    const filas = servidor.filas.slice();
    win.reconstruirStockDesdeRegistro(filas);
    chequear('Verificar stock no cambia el estado con reportes y fotos en el registro', JSON.stringify(win.__est()) === antes);
    chequear('Verificar stock no llama al mapa', log.length === llamadasAntes);
    chequear('Verificar stock deja los reportes como estaban', reportes().length === nRep);
  } else {
    console.log('  (Verificar stock: solo PC, esta variante no lo tiene)');
  }

  // ---------- 13. Sin errores de carga ----------
  chequear('sin errores de consola durante la prueba', errores.length === 0, errores[0] || '');
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
