/*
 * Prueba: capas de Aguadas e Instalaciones (31/10/2026, a pedido de Pedro). Los puntos (aguadas, mangas, corrales...) se
 * prenden y apagan con dos botones a la izquierda del mapa (#btn-capa-agua y #btn-capa-instalacion). Verifica:
 *  1. los dos botones existen, están visibles, dentro del mapa, y dicen ON por defecto;
 *  2. con un punto de cada tipo en el mapa, apagar Aguadas saca SOLO los de agua (el botón dice OFF y queda gris),
 *     y volver a prenderla los pone otra vez;
 *  3. la elección queda en localStorage['<est>_capas_puntos'] y al reabrir la app los de agua se crean pero no se
 *     agregan al mapa, y el botón dice OFF;
 *  4. un punto_creado de otro equipo de un tipo apagado crea el marcador fuera del mapa y NO prende la capa;
 *  5. cargar un punto propio de un tipo apagado prende esa capa (y los de ese tipo vuelven al mapa), con aviso;
 *  6. "🗺 Ver en el mapa" de un punto con su capa apagada: centra con zoom 17, abre el popup en un marcador temporal
 *     (no el suyo) y la capa sigue OFF;
 *  7. eliminar un punto con su capa apagada no rompe nada y lo saca de puntosLayers;
 *  8. la preferencia es por campo: la clave de otro establecimiento no se toca y no cambia el arranque;
 *  9. (solo PC) Verificar stock con puntos en el registro no cambia estado, preferencia ni llama a Leaflet;
 * 10. sin errores de consola.
 * Corre sobre las 9 variantes. Las mutaciones se hacen sobre una COPIA del index.html (nunca sobre el generado).
 * El arnés (stubLeaflet, servidorFalso, levantar) es el de probar_fotos_puntos_muertes.js.
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
      '\n;window.__mapa = function(){ return map; };' +
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


const BTN = { agua: 'btn-capa-agua', instalacion: 'btn-capa-instalacion' };
const ROTULO = { agua: '💧 Aguadas', instalacion: '🚧 Instalaciones' };

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = servidorFalso();
  const uno = await levantar(archivo, servidor);
  if(uno.errores.length){ chequear('carga sin errores', false, uno.errores[0]); return; }
  const est = uno.win.__EST;
  const otroEst = est === 'maria_laura' ? 'la_vuelta' : 'maria_laura';
  const clave = est + '_capas_puntos';

  // helpers: cada uno recibe la ventana (`w`) porque se reabre la app varias veces
  const boton = (w, t) => w.document.getElementById(BTN[t]);
  // El botón muestra un texto corto fijo ("💧 Aguadas" / "🚧 Instal.") y el estado va en el color (capa-off), en
  // aria-pressed y en el title. `texto` arma "<rótulo>: ON/OFF" desde ahí y solo si el texto visible es el corto.
  const CORTO = { agua: '💧 Aguadas', instalacion: '🚧 Instal.' };
  const texto = (w, t) => {
    const b = boton(w, t);
    const on = b.getAttribute('aria-pressed') === 'true' && !b.classList.contains('capa-off');
    const off = b.getAttribute('aria-pressed') === 'false' && b.classList.contains('capa-off');
    const nombre = ROTULO[t].replace(/^\S+ /, '');
    if(b.textContent !== CORTO[t] || b.title !== nombre + (on ? ': ON' : ': OFF') || on === off) return 'inconsistente: ' + b.textContent + ' / ' + b.title;
    return ROTULO[t] + (on ? ': ON' : ': OFF');
  };
  const apagada = (w, t) => boton(w, t).classList.contains('capa-off');
  const enMapa = (w, p) => { const m = w.__puntosLayers()[p.id]; return !!m && w.__mapa().hasLayer(m); };
  const lsCapas = w => { try { return JSON.parse(w.localStorage.getItem(clave)); } catch(e){ return null; } };
  const toastDe = w => w.document.getElementById('toast').textContent;
  const tomarAlmacen = w => {
    const a = {};
    for(let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); a[k] = w.localStorage.getItem(k); }
    return a;
  };
  // Crea un punto desde el formulario de Aguadas / instalaciones (el mismo camino que usa Pedro)
  async function crearPunto(w, tipo, subtipo, nombre, lat, lng){
    click(w, w.document.getElementById('btn-puntos'));
    w.document.getElementById('np-tipo').value = tipo;
    w.document.getElementById('np-tipo').dispatchEvent(new w.Event('change', { bubbles: true }));
    w.document.getElementById('np-subtipo').value = subtipo;
    w.document.getElementById('np-nombre').value = nombre;
    click(w, w.document.getElementById('np-colocar'));
    w.colocarPuntoEn({ lat, lng });
    await esperar(20);
    return w.__puntos().find(p => p.nombre === nombre);
  }

  // ---------- 1. Los botones existen, se ven, están sobre el mapa y dicen ON ----------
  const btnAgua = boton(uno.win, 'agua'), btnInst = boton(uno.win, 'instalacion');
  chequear('#btn-capa-agua y #btn-capa-instalacion existen y no están ocultos',
    !!btnAgua && !!btnInst && btnAgua.style.display !== 'none' && btnInst.style.display !== 'none');
  chequear('los dos están dentro del mapa (#map), en la fila del borde de arriba (.capas-puntos)',
    !!btnAgua && uno.win.document.getElementById('map').contains(btnAgua) && uno.win.document.getElementById('map').contains(btnInst) &&
    !!btnAgua.closest('.capas-puntos') && btnAgua.parentNode === btnInst.parentNode);
  chequear('por defecto dicen ON ("💧 Aguadas: ON" y "🚧 Instalaciones: ON") y ninguno está gris',
    texto(uno.win, 'agua') === '💧 Aguadas: ON' && texto(uno.win, 'instalacion') === '🚧 Instalaciones: ON' && !apagada(uno.win, 'agua') && !apagada(uno.win, 'instalacion'),
    texto(uno.win, 'agua') + ' / ' + texto(uno.win, 'instalacion'));

  {
    // un doble toque sobre el botón no llega al mapa (si no, Leaflet hace zoom)
    let llegaron = 0;
    const div = uno.win.document.getElementById('map');
    const contar = () => { llegaron++; };
    div.addEventListener('dblclick', contar);
    btnAgua.dispatchEvent(new uno.win.MouseEvent('dblclick', { bubbles: true }));
    btnInst.dispatchEvent(new uno.win.MouseEvent('dblclick', { bubbles: true }));
    div.removeEventListener('dblclick', contar);
    chequear('un doble toque sobre los botones no llega al mapa (no hace zoom)', llegaron === 0, String(llegaron));
  }

  // ---------- 2. Un punto de cada tipo; apagar Aguadas saca SOLO los de agua ----------
  const pA = await crearPunto(uno.win, 'agua', 'Bebedero', 'Bebedero prueba', -31.40, -55.43);
  const pI = await crearPunto(uno.win, 'instalacion', 'Manga', 'Manga prueba', -31.41, -55.44);
  chequear('se crean un punto de agua y uno de instalación', !!pA && !!pI);
  chequear('con las capas ON, los dos marcadores están en el mapa', enMapa(uno.win, pA) && enMapa(uno.win, pI));
  click(uno.win, btnAgua);
  chequear('apagar Aguadas saca del mapa su marcador de agua', !enMapa(uno.win, pA));
  chequear('y deja en el mapa el marcador de la instalación', enMapa(uno.win, pI));
  chequear('el botón de Aguadas dice OFF y queda gris', texto(uno.win, 'agua') === '💧 Aguadas: OFF' && apagada(uno.win, 'agua'), texto(uno.win, 'agua'));
  chequear('el botón de Instalaciones sigue ON', texto(uno.win, 'instalacion') === '🚧 Instalaciones: ON' && !apagada(uno.win, 'instalacion'));
  chequear('el marcador apagado sigue guardado en puntosLayers (no se recrea al prender)', !!uno.win.__puntosLayers()[pA.id]);
  click(uno.win, btnAgua);
  chequear('volver a prender Aguadas pone el marcador otra vez en el mapa', enMapa(uno.win, pA) && texto(uno.win, 'agua') === '💧 Aguadas: ON' && !apagada(uno.win, 'agua'));

  // ---------- 3. La elección queda guardada y se acuerda al reabrir la app ----------
  click(uno.win, btnAgua); // OFF, para guardar la elección
  chequear('la elección queda en localStorage[<est>_capas_puntos] = {"agua":false,"instalacion":true}',
    !!lsCapas(uno.win) && lsCapas(uno.win).agua === false && lsCapas(uno.win).instalacion === true, JSON.stringify(lsCapas(uno.win)));
  const dos = await levantar(archivo, servidor, tomarAlmacen(uno.win));
  chequear('al reabrir la app no hay errores', dos.errores.length === 0, dos.errores[0] || '');
  chequear('al reabrir, el marcador de agua se crea pero NO se agrega al mapa', !!dos.win.__puntosLayers()[pA.id] && !enMapa(dos.win, pA));
  chequear('al reabrir, el marcador de la instalación sí está en el mapa', enMapa(dos.win, pI));
  chequear('al reabrir, el botón de Aguadas dice OFF', texto(dos.win, 'agua') === '💧 Aguadas: OFF' && apagada(dos.win, 'agua'), texto(dos.win, 'agua'));

  // ---------- 4. Un punto que llega de otro equipo no prende la capa ----------
  const idRemoto = 'pt_remoto_' + uuid();
  await dos.win.aplicarEventoRemoto({ tipo: 'punto_creado', potrero: est, dispositivo: 'otro-equipo', fecha_cliente: '31/10/2026',
    detalle: { id: idRemoto, tipo: 'agua', subtipo: 'Represa', nombre: 'Represa de otro equipo', lat: -31.42, lon: -55.45 } });
  const pRemoto = { id: idRemoto };
  chequear('un punto_creado de otro equipo (de agua, con la capa apagada) crea el marcador...', !!dos.win.__puntosLayers()[idRemoto]);
  chequear('...fuera del mapa', !!dos.win.__puntosLayers()[idRemoto] && !enMapa(dos.win, pRemoto));
  chequear('y no prende la capa: sigue OFF', texto(dos.win, 'agua') === '💧 Aguadas: OFF' && lsCapas(dos.win).agua === false);

  // ---------- 5. Un punto propio de un tipo apagado prende su capa ----------
  const pNuevo = await crearPunto(dos.win, 'agua', 'Bebedero', 'Bebedero nuevo', -31.43, -55.46);
  chequear('cargar un punto de agua con la capa apagada la prende', texto(dos.win, 'agua') === '💧 Aguadas: ON' && lsCapas(dos.win).agua === true, texto(dos.win, 'agua'));
  chequear('y vuelven al mapa todos los de agua (el de antes, el de otro equipo y el nuevo)',
    enMapa(dos.win, pA) && enMapa(dos.win, pRemoto) && enMapa(dos.win, pNuevo));
  chequear('el aviso dice qué capa se prendió', /se prendió la capa 💧 Aguadas/.test(toastDe(dos.win)), toastDe(dos.win));
  chequear('la capa de instalaciones no se tocó (sigue ON)', texto(dos.win, 'instalacion') === '🚧 Instalaciones: ON');
  click(dos.win, boton(dos.win, 'instalacion')); // OFF, y después un punto de instalación lo prende
  const pCorral = await crearPunto(dos.win, 'instalacion', 'Corral', 'Corral nuevo', -31.44, -55.47);
  chequear('cargar una instalación con su capa apagada la prende', texto(dos.win, 'instalacion') === '🚧 Instalaciones: ON' && enMapa(dos.win, pCorral) && enMapa(dos.win, pI));

  // ---------- 6. "Ver en el mapa" de un punto con su capa apagada ----------
  click(dos.win, boton(dos.win, 'agua')); // OFF
  const antesVer = dos.log.length;
  click(dos.win, dos.win.document.getElementById('btn-puntos'));
  click(dos.win, dos.win.document.querySelector(`#lista-puntos [data-ver-punto="${pA.id}"]`));
  const sv = dos.log.slice(antesVer).filter(e => e[0] === 'setView').pop();
  chequear('"Ver en el mapa" centra en el punto con zoom 17', !!sv && Math.abs(sv[1][0] - pA.lat) < 1e-9 && Math.abs(sv[1][1] - pA.lon) < 1e-9 && sv[2] === 17, JSON.stringify(sv));
  const aperturas = dos.log.slice(antesVer).filter(e => e[0] === 'openPopup');
  chequear('abre el popup en un marcador temporal, no en el del punto apagado',
    aperturas.length === 1 && aperturas[0][1] !== dos.win.__puntosLayers()[pA.id], aperturas.length + ' popups');
  chequear('la capa sigue OFF y el marcador del punto sigue fuera del mapa',
    texto(dos.win, 'agua') === '💧 Aguadas: OFF' && lsCapas(dos.win).agua === false && !enMapa(dos.win, pA));
  chequear('avisa que la capa está apagada y que se muestra solo ese punto',
    /está apagada: se muestra solo este punto/.test(toastDe(dos.win)), toastDe(dos.win));

  // ---------- 7. Eliminar un punto con su capa apagada ----------
  click(dos.win, dos.win.document.getElementById('btn-puntos'));
  click(dos.win, dos.win.document.querySelector(`#lista-puntos [data-del="${pA.id}"]`));
  chequear('eliminar el punto con su capa apagada lo saca de puntosLayers', !dos.win.__puntosLayers()[pA.id]);
  chequear('y de la lista de puntos', !dos.win.__puntos().some(p => p.id === pA.id));
  chequear('la capa de Aguadas sigue OFF tras eliminar', texto(dos.win, 'agua') === '💧 Aguadas: OFF');

  // ---------- 8. La preferencia es por campo ----------
  const otraClave = otroEst + '_capas_puntos';
  const otroValor = '{"agua":false,"instalacion":false}';
  const tres = await levantar(archivo, servidor, { [otraClave]: otroValor });
  chequear('con la clave de OTRO campo guardada, este arranca con todo ON', texto(tres.win, 'agua') === '💧 Aguadas: ON' && texto(tres.win, 'instalacion') === '🚧 Instalaciones: ON');
  click(tres.win, boton(tres.win, 'agua'));
  chequear('apagar acá no toca la clave del otro campo', tres.win.localStorage.getItem(otraClave) === otroValor, tres.win.localStorage.getItem(otraClave));
  chequear('y guarda la elección en la clave de este campo', tres.win.localStorage.getItem(clave) === '{"agua":false,"instalacion":true}', tres.win.localStorage.getItem(clave));

  // ---------- 9. Verificar stock (solo PC): no cambia nada, ni la preferencia ni el mapa ----------
  if(typeof dos.win.reconstruirStockDesdeRegistro === 'function'){
    const estadoAntes = JSON.stringify(dos.win.__est());
    const lsAntes = dos.win.localStorage.getItem(clave);
    const llamadasAntes = dos.log.length;
    dos.win.reconstruirStockDesdeRegistro(servidor.filas.slice());
    chequear('Verificar stock con puntos en el registro no cambia el estado', JSON.stringify(dos.win.__est()) === estadoAntes);
    chequear('Verificar stock no llama al mapa', dos.log.length === llamadasAntes);
    chequear('Verificar stock no cambia la preferencia de capas ni los botones',
      dos.win.localStorage.getItem(clave) === lsAntes && texto(dos.win, 'agua') === '💧 Aguadas: OFF');
  } else {
    console.log('  (Verificar stock: solo PC, esta variante no lo tiene)');
  }

  // ---------- 10. Sin errores de consola ----------
  chequear('sin errores de consola durante la prueba', [uno.errores, dos.errores, tres.errores].every(e => e.length === 0),
    (uno.errores[0] || dos.errores[0] || tres.errores[0] || ''));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
