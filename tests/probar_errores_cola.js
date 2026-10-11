/*
 * Fase 3 de la auditoría (11/10/2026), paso 2: errores visibles (hallazgos 3 y 11). Con
 * CONFIG.colaOrdenada:
 * - un error que reintentar no arregla (22P02, 42501, cualquier 4xx) deja los movimientos
 *   "trabados": cartel rojo arriba de Herramientas con el código, "Reintentar" y "Descargar
 *   copia", y "⛔" en el indicador. Sin bucle: no se reintenta solo en cada instante;
 * - una falla pasajera (sin respuesta, 5xx) no saca cartel: "⚠ N sin sincronizar · falló el
 *   último intento hh:mm";
 * - Sanidad usa la misma cola (guarda primero, 23505 = ya estaba porque `id` es la clave
 *   primaria) y sus cargas trabadas entran en el mismo cartel;
 * - "✅ Sincronizado" solo sin nada pendiente (también Sanidad) y con la última lectura OK.
 * Sin el flag, todo sigue como antes (se verifica en los archivos sin flag).
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

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
    latLngBounds(){ return limites(); } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

/* Supabase falso con respuestas como las de supabase-js: {error, status}. `resp.eventos` y
   `resp.sanidad` deciden cada insert; `resp.lectura` el select de sincronizar(). Un id repetido
   da 23505, como el UNIQUE de event_id y la clave primaria `id` de Sanidad. */
function servidorFalso(){
  const s = { eventos: [], sanidad: [], intentosEventos: 0, intentosSanidad: 0,
    resp: { eventos: null, sanidad: null, lectura: null } };
  const ok = { error: null, status: 201 };
  s.insertar = (tabla, row) => {
    const esEv = tabla === 'eventos_sync';
    if(esEv) s.intentosEventos++; else s.intentosSanidad++;
    const decidir = esEv ? s.resp.eventos : s.resp.sanidad;
    const r = decidir ? decidir(row) : ok;
    return Promise.resolve(r).then(r => {
      if(r && r.error) return r;
      const lista = esEv ? s.eventos : s.sanidad;
      const clave = esEv ? 'event_id' : 'id';
      if(row[clave] && lista.some(f => f[clave] === row[clave]))
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint' }, status: 409 };
      lista.push(row);
      return ok;
    });
  };
  return s;
}

async function levantar(archivo, servidor){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient(){ return { from(tabla){
    const q = new Proxy({}, { get(t, prop){
      if(prop === 'insert') return (row) => (tabla === 'eventos_sync' || /^sanidad_carga/.test(tabla)) ? servidor.insertar(tabla, row) : Promise.resolve({ error: null, status: 201 });
      if(prop === 'then') return (res, rej) => {
        const r = (tabla === 'eventos_sync' && servidor.resp.lectura) ? servidor.resp.lectura() : { data: [], error: null, status: 200 };
        return Promise.resolve(r).then(res, rej);
      };
      return () => q;
    } });
    return q;
  } }; } };
  let enLinea = true;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const descargas = [];
  win.URL.createObjectURL = (blob) => { descargas.push(blob); return 'blob:x'; };
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  win.eval(codigo + `
    ;window.__est = function(){ return estado; };
    window.__colaOrdenada = !!CONFIG.colaOrdenada;
    window.__enviarEvento = enviarEvento;
    window.__vaciarColaSync = vaciarColaSync;
    window.__guardarSanidadCarga = guardarSanidadCarga;
    window.__sincronizar = sincronizar;
    window.__actualizarEstadoSync = actualizarEstadoSync;
    window.__STORAGE_KEY = STORAGE_KEY;
  `);
  await esperar(60);
  const doc = win.document;
  return {
    win, errores, descargas, setEnLinea(v){ enLinea = v; },
    indicador: () => (doc.getElementById('estado-sync') || {}).textContent || '',
    cartel: () => doc.getElementById('aviso-trabado'),
    guardado: () => { try{ return JSON.parse(win.localStorage.getItem(win.__STORAGE_KEY)) || {}; }catch(e){ return {}; } }
  };
}

const ev = (n) => ['ingreso', 'TEST', { categoria: 'Vacas', cantidad: n }, '01/10/2026'];
const reg = (n) => ({ id: 'sc_prueba_' + n, fecha: '2026-10-01', categoria: 'Vacas', potrero: 'TEST', cantidad: n, producto1: 'X', dosis1: 1 });
const e22P02 = () => ({ error: { code: '22P02', message: 'invalid input syntax for type uuid' }, status: 400 });

async function probarTrabado(archivo){
  console.log('\n--- 22P02: el movimiento queda trabado, se ve el cartel, no hay bucle y se destraba');
  const s = servidorFalso();
  s.resp.eventos = e22P02;
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  app.win.__est().ultimaSincronizacion = '2026-10-01T00:00:00Z';
  const okA = await app.win.__enviarEvento(...ev(1));
  chequear('enviarEvento devuelve false', okA === false);
  chequear('el evento sigue en la cola, guardado en el equipo', app.guardado().colaSync.length === 1);
  const c = app.cartel();
  chequear('aparece el cartel rojo', !!c, app.indicador());
  chequear('el cartel dice "1 movimiento trabado" y el código 22P02',
    !!c && /1 movimiento trabado/.test(c.textContent) && /22P02/.test(c.textContent), c && c.textContent);
  chequear('el cartel tiene "Reintentar" y "Descargar copia"',
    !!c && !!c.querySelector('[data-accion="reintentar"]') && !!c.querySelector('[data-accion="descargar"]'));
  chequear('el cartel va justo antes de Herramientas', !!c && c.nextElementSibling && c.nextElementSibling.id === 'footer-tools');
  chequear('el indicador dice "⛔ 1 movimiento trabado"', app.indicador() === '⛔ 1 movimiento trabado', app.indicador());
  chequear('la falla queda guardada como permanente con el código', (() => {
    const f = (app.guardado().fallos || {}).sync; return f && f.permanente === true && f.codigo === '22P02' && f.intentos === 1; })(),
    JSON.stringify(app.guardado().fallos));
  const intentos = s.intentosEventos;
  await esperar(150);
  chequear('no hay bucle: sin acciones nuevas no se reintenta solo', s.intentosEventos === intentos, 'intentos: ' + s.intentosEventos);

  const okB = await app.win.__enviarEvento(...ev(2));
  chequear('un movimiento nuevo reintenta el trabado una vez y no se le adelanta', okB === false && s.eventos.length === 0 && s.intentosEventos === intentos + 1,
    'intentos: ' + s.intentosEventos + ', guardados: ' + s.eventos.length);
  chequear('el cartel ahora dice "2 movimientos trabados"', /2 movimientos trabados/.test(app.cartel().textContent), app.cartel().textContent);

  // se arregla del lado de Supabase y se aprieta Reintentar
  s.resp.eventos = null;
  app.cartel().querySelector('[data-accion="reintentar"]').click();
  await esperar(60);
  chequear('al reintentar llegan los dos, en orden', JSON.stringify(s.eventos.map(f => f.detalle.cantidad)) === '[1,2]', JSON.stringify(s.eventos.map(f => f.detalle.cantidad)));
  chequear('el cartel desaparece', !app.cartel());
  chequear('la falla se borra', !(app.guardado().fallos || {}).sync, JSON.stringify(app.guardado().fallos));
  chequear('el indicador vuelve a "✅ Sincronizado"', app.indicador() === '✅ Sincronizado', app.indicador());
}

async function probarPasajero(archivo){
  console.log('\n--- falla pasajera (sin respuesta / 503): sin cartel, "⚠ … falló el último intento hh:mm"');
  const s = servidorFalso();
  s.resp.eventos = () => ({ error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  app.win.__est().ultimaSincronizacion = '2026-10-01T00:00:00Z';
  await app.win.__enviarEvento(...ev(1));
  chequear('no hay cartel', !app.cartel());
  chequear('el indicador dice "⚠ 1 sin sincronizar · falló el último intento hh:mm"',
    /^⚠ 1 sin sincronizar · falló el último intento \d\d:\d\d$/.test(app.indicador()), app.indicador());
  chequear('la falla queda como pasajera', (app.guardado().fallos || {}).sync && app.guardado().fallos.sync.permanente === false);
  s.resp.eventos = () => ({ error: { code: '', message: 'Service Unavailable' }, status: 503 });
  await app.win.__vaciarColaSync();
  chequear('un 503 también es pasajero (sin cartel)', !app.cartel() && /^⚠ /.test(app.indicador()), app.indicador());
  chequear('cuenta los intentos', app.guardado().fallos.sync.intentos === 2, JSON.stringify(app.guardado().fallos));
  s.resp.eventos = null;
  await app.win.__vaciarColaSync();
  chequear('cuando entra, "✅ Sincronizado" y sin falla', app.indicador() === '✅ Sincronizado' && !(app.guardado().fallos || {}).sync, app.indicador());

  console.log('\n--- sin señal: "⏳", no "⚠" (es lo normal en el campo)');
  app.setEnLinea(false);
  await app.win.__enviarEvento(...ev(2));
  chequear('el indicador dice "⏳ 1 movimiento sin sincronizar"', app.indicador() === '⏳ 1 movimiento sin sincronizar', app.indicador());
}

async function probarSanidad(archivo){
  console.log('\n--- Sanidad: guarda primero, 23505 = ya estaba, y sus trabadas entran en el mismo cartel');
  const s = servidorFalso();
  let soltar = null;
  s.resp.sanidad = () => new Promise(r => { soltar = () => r({ error: null, status: 201 }); });
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  app.win.__est().ultimaSincronizacion = '2026-10-01T00:00:00Z';
  const prom = app.win.__guardarSanidadCarga(reg(1));
  await esperar(20);
  chequear('con el envío colgado, la carga ya está en la cola guardada', (app.guardado().colaSanidad || []).length === 1, JSON.stringify(app.guardado().colaSanidad));
  soltar();
  chequear('cuando Supabase confirma devuelve true y sale de la cola', (await prom) === true && app.guardado().colaSanidad.length === 0);

  // 23505: el registro ya había llegado (corte justo después del insert)
  s.resp.sanidad = null;
  app.setEnLinea(false);
  await app.win.__guardarSanidadCarga(reg(1));
  chequear('sin señal: "⏳ 1 carga de Sanidad sin sincronizar"', app.indicador() === '⏳ 1 carga de Sanidad sin sincronizar', app.indicador());
  app.setEnLinea(true);
  await app.win.__sincronizar(false);
  chequear('23505 en Sanidad cuenta como enviado (antes trababa la cola para siempre)',
    app.guardado().colaSanidad.length === 0 && s.sanidad.length === 1, JSON.stringify(app.guardado().colaSanidad));

  // permiso denegado en Sanidad + un movimiento trabado
  s.resp.sanidad = () => ({ error: { code: '42501', message: 'new row violates row-level security policy' }, status: 401 });
  s.resp.eventos = e22P02;
  await app.win.__guardarSanidadCarga(reg(2));
  await app.win.__enviarEvento(...ev(1));
  const c = app.cartel();
  chequear('el cartel junta los dos: "1 movimiento y 1 carga de Sanidad trabados"',
    !!c && /1 movimiento y 1 carga de Sanidad trabados/.test(c.textContent), c && c.textContent);
  chequear('y muestra los dos códigos', !!c && /22P02/.test(c.textContent) && /42501/.test(c.textContent), c && c.textContent);

  // descargar copia
  c.querySelector('[data-accion="descargar"]').click();
  await esperar(20);
  let copia = null;
  try{ copia = JSON.parse(await app.descargas[app.descargas.length - 1].text()); }catch(e){}
  chequear('"Descargar copia" baja la cola y las fallas en JSON',
    !!copia && copia.colaSync.length === 1 && copia.colaSanidad.length === 1 && copia.fallos.sync.codigo === '22P02' && copia.fallos.sanidad.codigo === '42501',
    JSON.stringify(copia && copia.fallos));
}

async function probarLectura(archivo){
  console.log('\n--- la lectura que falla también se ve (antes quedaba "✅")');
  const s = servidorFalso();
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  app.win.__est().ultimaSincronizacion = '2026-10-01T00:00:00Z';
  s.resp.lectura = () => ({ data: null, error: { code: '', message: 'Service Unavailable' }, status: 503 });
  await app.win.__sincronizar(false);
  chequear('"⚠ Falló el último intento hh:mm"', /^⚠ Falló el último intento \d\d:\d\d$/.test(app.indicador()), app.indicador());
  s.resp.lectura = null;
  await app.win.__sincronizar(false);
  chequear('cuando la lectura anda, "✅ Sincronizado"', app.indicador() === '✅ Sincronizado', app.indicador());
}

async function probarEscapado(archivo){
  console.log('\n--- un código raro del servidor no inyecta HTML en el cartel');
  const s = servidorFalso();
  s.resp.eventos = () => ({ error: { code: '<img src=x onerror=alert(1)>', message: 'x' }, status: 400 });
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  await app.win.__enviarEvento(...ev(1));
  const c = app.cartel();
  chequear('el cartel aparece sin ninguna imagen adentro', !!c && !c.querySelector('img'), c && c.innerHTML);
}

async function probarSinFlag(archivo){
  console.log('\n--- sin el flag: todo como antes (sin cartel, mismo indicador)');
  const s = servidorFalso();
  s.resp.eventos = e22P02;
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  await app.win.__enviarEvento(...ev(1));
  chequear('no hay cartel', !app.cartel());
  chequear('el indicador dice "⏳ 1 movimiento sin sincronizar"', app.indicador() === '⏳ 1 movimiento sin sincronizar', app.indicador());
  chequear('no se guardan fallas', !app.guardado().fallos);
}

(async () => {
  const archivos = process.argv.slice(2);
  let probados = 0;
  for(const a of archivos){
    console.log('\n=== ' + a + ' ===');
    const { win, errores } = await levantar(a, servidorFalso());
    if(errores.length){ chequear('carga sin errores', false, errores[0]); continue; }
    if(!win.__colaOrdenada && !process.env.FORZAR){ await probarSinFlag(a); continue; }
    probados++;
    await probarTrabado(a);
    await probarPasajero(a);
    await probarSanidad(a);
    await probarLectura(a);
    await probarEscapado(a);
  }
  if(!probados){ console.log('\nNingún archivo tiene CONFIG.colaOrdenada'); fallas++; }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
