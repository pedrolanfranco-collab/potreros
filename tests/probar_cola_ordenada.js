/*
 * Fase 3 de la auditoría (11/10/2026), paso 1: cola única que guarda primero
 * (hallazgos 1 y 2). Con CONFIG.colaOrdenada:
 * - enviarEvento() pone el evento en estado.colaSync y lo guarda en el
 *   equipo ANTES de intentar mandarlo (si Android cierra la app durante el
 *   envío, el evento no se pierde);
 * - vaciarColaSync() manda de a uno, siempre el primero de la cola, y lo saca
 *   recién cuando Supabase confirma (OK o 23505), así un borrado nunca llega
 *   antes que el movimiento que borra;
 * - nunca vacía la cola por adelantado (antes, un guardado de otra acción o
 *   de la otra pestaña durante el envío grababa la cola vacía).
 * Los archivos sin el flag (rollout gradual) se saltean con un aviso.
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

/* Supabase falso. `servidor.responder(row)` decide qué pasa con cada insert a
   eventos_sync: devuelve una promesa de {error}. Una fila queda "guardada en
   el servidor" (servidor.filas) recién cuando su respuesta es OK, en el orden
   en que el servidor la recibe; un event_id repetido da 23505 como el UNIQUE real. */
function servidorFalso(){
  const s = { filas: [], intentos: [], responder: null, enVuelo: 0, maxEnVuelo: 0 };
  s.insertar = (row) => {
    s.intentos.push(row);
    s.enVuelo++; s.maxEnVuelo = Math.max(s.maxEnVuelo, s.enVuelo);
    const decidir = s.responder ? s.responder(row, s.intentos.length - 1) : Promise.resolve({ error: null });
    return Promise.resolve(decidir).then(r => {
      s.enVuelo--;
      if(r && r.error) return r;
      if(row.event_id && s.filas.some(f => f.event_id === row.event_id))
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint "eventos_sync_event_id_key"' } };
      s.filas.push(row);
      return { error: null };
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
      if(prop === 'insert') return (row) => tabla === 'eventos_sync' ? servidor.insertar(row) : Promise.resolve({ error: null });
      if(prop === 'then') return (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
      return () => q;
    } });
    return q;
  } }; } };
  let enLinea = true;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  // los eventos van al potrero 'TEST', que no hace falta que exista: enviarEvento no lo mira
  win.eval(codigo + `
    ;window.__est = function(){ return estado; };
    window.__colaOrdenada = !!CONFIG.colaOrdenada;
    window.__enviarEvento = enviarEvento;
    window.__vaciarColaSync = vaciarColaSync;
    window.__refrescar = refrescarSiOtraPaginaGuardo;
    window.__STORAGE_KEY = STORAGE_KEY;
  `);
  await esperar(60);
  const colaGuardada = () => {
    try{ return (JSON.parse(win.localStorage.getItem(win.__STORAGE_KEY)) || {}).colaSync || []; }catch(e){ return null; }
  };
  return { win, errores, colaGuardada, setEnLinea(v){ enLinea = v; } };
}

const ev = (n) => ['ingreso', 'TEST', { categoria: 'Vacas', cantidad: n }, '01/10/2026'];

async function probarGuardaAntesDeMandar(archivo){
  console.log('\n--- el evento queda guardado en el equipo mientras el envío está colgado (hallazgo 2)');
  const s = servidorFalso();
  let soltar; s.responder = () => new Promise(r => { soltar = () => r({ error: null }); });
  const { win, errores, colaGuardada } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const prom = win.__enviarEvento(...ev(1));
  await esperar(20);
  chequear('se intentó mandar enseguida', s.intentos.length === 1, 'intentos: ' + s.intentos.length);
  const guardada = colaGuardada();
  chequear('con el envío colgado, el evento YA está en la cola guardada (si la app se cierra ahora, no se pierde)',
    guardada.length === 1 && guardada[0].event_id === s.intentos[0].event_id, JSON.stringify(guardada));
  soltar();
  const ok = await prom;
  chequear('enviarEvento devuelve true cuando Supabase confirma', ok === true, String(ok));
  chequear('confirmado: sale de la cola en memoria y en la guardada',
    win.__est().colaSync.length === 0 && colaGuardada().length === 0, JSON.stringify(colaGuardada()));
}

async function probarOrdenSinSenalYDespues(archivo){
  console.log('\n--- sin señal se carga A; con señal se carga B: llegan A y después B (hallazgo 1)');
  const s = servidorFalso();
  const { win, errores, setEnLinea } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  setEnLinea(false);
  const okA = await win.__enviarEvento(...ev(1));
  chequear('sin señal: enviarEvento devuelve false y el evento queda en la cola', okA === false && win.__est().colaSync.length === 1);
  setEnLinea(true);
  const okB = await win.__enviarEvento(...ev(2));
  const cantidades = s.filas.map(f => f.detalle.cantidad);
  chequear('el servidor recibe A antes que B', JSON.stringify(cantidades) === '[1,2]', JSON.stringify(cantidades));
  chequear('B devuelve true y la cola queda vacía', okB === true && win.__est().colaSync.length === 0, JSON.stringify(win.__est().colaSync));
}

async function probarVueltaRecienTerminada(archivo){
  console.log('\n--- sin señal se carga A; vuelve la señal en el mismo instante y se pide vaciar: A se manda');
  const s = servidorFalso();
  const { win, errores, setEnLinea } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  setEnLinea(false);
  win.__enviarEvento(...ev(1));   // su vuelta termina sin señal, sin esperar nada
  setEnLinea(true);
  await win.__vaciarColaSync();   // llega antes de que se suelte el candado de esa vuelta
  chequear('A llegó al servidor (no se quedó con la vuelta ya terminada)', s.filas.length === 1, JSON.stringify(s.filas.map(f => f.detalle.cantidad)));
  chequear('la cola queda vacía', win.__est().colaSync.length === 0);
}

async function probarFallaFrenaLaCola(archivo){
  console.log('\n--- si A falla, B no se adelanta: espera detrás de A');
  const s = servidorFalso();
  s.responder = (row, i) => Promise.resolve(i === 0 ? { error: { code: '500', message: 'falla de red' } } : { error: null });
  const { win, errores } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const okA = await win.__enviarEvento(...ev(1));
  chequear('A falla: devuelve false y queda en la cola', okA === false && win.__est().colaSync.length === 1);
  const okB = await win.__enviarEvento(...ev(2));
  const cantidades = s.filas.map(f => f.detalle.cantidad);
  chequear('al cargar B se reintenta A primero: el servidor guarda A y después B', JSON.stringify(cantidades) === '[1,2]', JSON.stringify(cantidades));
  chequear('B devuelve true y la cola queda vacía', okB === true && win.__est().colaSync.length === 0);
}

async function probarRafaga(archivo){
  console.log('\n--- ráfaga de 5 eventos con latencias distintas: llegan en el orden en que se cargaron');
  const s = servidorFalso();
  const demoras = [50, 40, 30, 20, 10];
  s.responder = (row) => new Promise(r => setTimeout(() => r({ error: null }), demoras[row.detalle.cantidad - 1]));
  const { win, errores } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const proms = [1, 2, 3, 4, 5].map(n => win.__enviarEvento(...ev(n)));
  const res = await Promise.all(proms);
  const cantidades = s.filas.map(f => f.detalle.cantidad);
  chequear('el servidor guarda 1,2,3,4,5 en ese orden', JSON.stringify(cantidades) === '[1,2,3,4,5]', JSON.stringify(cantidades));
  chequear('nunca hay dos envíos a la vez (uno por vez), y uno solo por evento', s.maxEnVuelo === 1 && s.intentos.length === 5,
    'simultáneos: ' + s.maxEnVuelo + ', intentos: ' + s.intentos.length);
  chequear('los 5 devuelven true y la cola queda vacía', res.every(x => x === true) && win.__est().colaSync.length === 0, JSON.stringify(res));
}

async function probarDuplicado23505(archivo){
  console.log('\n--- 23505 (el evento ya había llegado): se saca de la cola y sigue el próximo');
  const s = servidorFalso();
  const { win, errores, setEnLinea } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  setEnLinea(false);
  await win.__enviarEvento(...ev(1));
  await win.__enviarEvento(...ev(2));
  // el primero ya había llegado (corte de red justo después del insert)
  s.filas.push(Object.assign({}, win.__est().colaSync[0]));
  setEnLinea(true);
  await win.__vaciarColaSync();
  const cantidades = s.filas.map(f => f.detalle.cantidad);
  chequear('el servidor no duplica el primero y recibe el segundo', JSON.stringify(cantidades) === '[1,2]', JSON.stringify(cantidades));
  chequear('la cola queda vacía (23505 cuenta como enviado)', win.__est().colaSync.length === 0, JSON.stringify(win.__est().colaSync));
}

async function probarOtraPestanaRecarga(archivo){
  console.log('\n--- la otra pestaña (Campo) guarda durante un envío: no se pierde ni se duplica nada');
  const s = servidorFalso();
  let soltar = null;
  s.responder = (row, i) => i === 0 ? new Promise(r => { soltar = () => r({ error: null }); }) : Promise.resolve({ error: null });
  const { win, errores, colaGuardada } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const promA = win.__enviarEvento(...ev(1));
  await esperar(20);
  // la otra página carga C sin señal y guarda: su cola tiene A (todavía sin confirmar) y C
  const guardado = JSON.parse(win.localStorage.getItem(win.__STORAGE_KEY));
  const eventoC = { event_id: '11111111-2222-4333-8444-555555555555', tipo: 'ingreso', potrero: 'TEST', detalle: { categoria: 'Vacas', cantidad: 3 }, fecha_cliente: '01/10/2026' };
  guardado.colaSync.push(eventoC);
  win.localStorage.setItem(win.__STORAGE_KEY, JSON.stringify(guardado));
  win.__refrescar();
  chequear('esta página tomó el estado de la otra (A y C en la cola)', win.__est().colaSync.length === 2, JSON.stringify(win.__est().colaSync.map(e => e.detalle.cantidad)));
  soltar();
  await promA;
  await win.__vaciarColaSync();
  const cantidades = s.filas.map(f => f.detalle.cantidad);
  chequear('el servidor recibe A y C, una vez cada uno', JSON.stringify(cantidades) === '[1,3]', JSON.stringify(cantidades));
  chequear('la cola queda vacía en memoria y guardada', win.__est().colaSync.length === 0 && colaGuardada().length === 0, JSON.stringify(colaGuardada()));
}

async function probarSinEventId(archivo){
  console.log('\n--- un evento viejo en la cola sin event_id (versión anterior al 12/9) recibe uno y no se lleva puestos a otros');
  const s = servidorFalso();
  const { win, errores, setEnLinea } = await levantar(archivo, s);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  setEnLinea(false);
  win.__est().colaSync.push({ tipo: 'ingreso', potrero: 'TEST', detalle: { categoria: 'Vacas', cantidad: 7 }, fecha_cliente: '01/09/2026' });
  win.__est().colaSync.push({ tipo: 'ingreso', potrero: 'TEST', detalle: { categoria: 'Vacas', cantidad: 8 }, fecha_cliente: '01/09/2026' });
  setEnLinea(true);
  await win.__vaciarColaSync();
  const cantidades = s.filas.map(f => f.detalle.cantidad);
  const esUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  chequear('llegan los dos, en orden', JSON.stringify(cantidades) === '[7,8]', JSON.stringify(cantidades));
  chequear('cada uno con un event_id UUID propio', s.filas.every(f => esUUID.test(f.event_id || '')) && s.filas[0].event_id !== s.filas[1].event_id);
  chequear('la cola queda vacía', win.__est().colaSync.length === 0);
}

(async () => {
  const archivos = process.argv.slice(2);
  let probados = 0;
  for(const a of archivos){
    console.log('\n=== ' + a + ' ===');
    const { win, errores } = await levantar(a, servidorFalso());
    if(errores.length){ chequear('carga sin errores', false, errores[0]); continue; }
    // FORZAR=1 corre las pruebas igual (para verlas en rojo contra el camino viejo)
    if(!win.__colaOrdenada && !process.env.FORZAR){ console.log('  (sin CONFIG.colaOrdenada todavía: camino viejo, se saltea)'); continue; }
    probados++;
    await probarGuardaAntesDeMandar(a);
    await probarOrdenSinSenalYDespues(a);
    await probarVueltaRecienTerminada(a);
    await probarFallaFrenaLaCola(a);
    await probarRafaga(a);
    await probarDuplicado23505(a);
    await probarOtraPestanaRecarga(a);
    await probarSinEventId(a);
  }
  if(!probados){ console.log('\nNingún archivo tiene CONFIG.colaOrdenada'); fallas++; }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
