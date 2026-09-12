/*
 * Prueba ad-hoc para los fixes P0 de la auditoría de 3 IAs del 12/9/2026
 * (verificados contra el código real antes de tocar nada):
 * - eventos_sync ahora lleva un event_id generado en el cliente; un
 *   reintento que pisa una violación de UNIQUE (23505) se trata como
 *   éxito y NO vuelve a encolarse (antes se reencolaba y duplicaba la
 *   fila si el insert había llegado a Supabase pero el cliente no se
 *   enteró por un corte de red).
 * - "Restablecer datos de fábrica" ahora también borra el ID de
 *   dispositivo, para que sincronizar() reconstruya TODA la historia
 *   propia como si fuera un dispositivo nuevo (antes esa historia quedaba
 *   descartada para siempre, por venir de "mi" dispositivo).
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
    latLngBounds(){ return limites(); } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

// respuestasEventosSync: cola de respuestas para sucesivos insert() sobre
// 'eventos_sync' nada más -- un insert a cualquier otra tabla (ej. Sanidad)
// no consume la cola, para no desalinear los índices con llamadas ajenas.
async function levantar(archivo, respuestasEventosSync){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  const inserted = [];
  let intentoEventosSync = 0;
  win.supabase = { createClient(){ return { from(tabla){ const q = {
    insert(row){
      if(tabla === 'eventos_sync'){
        inserted.push(row);
        const idx = intentoEventosSync++;
        const resp = (respuestasEventosSync && respuestasEventosSync[idx]) || {error:null};
        return Promise.resolve(resp);
      }
      return Promise.resolve({error:null});
    },
    select(){return q;}, eq(){return q;}, order(){return q;}, then(res){ return Promise.resolve(res({data:[],error:null})); }
  }; return q; } }; } };
  win.__inserted = inserted;
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  win.eval(codigo + `
    ;if(!POTREROS_GEO.length){
      POTREROS_GEO.push({nombre:'TEST', area:'10', coords:[[0,0],[0,1],[1,1]]});
      estado.potreros['TEST'] = { animales:{}, historial:[], fechaIngreso:null, fechaSalida:null };
    }
    window.__est = function(){ return estado; };
    window.__enviarEvento = enviarEvento;
    window.__pushEventoRemoto = pushEventoRemoto;
    window.__DISPOSITIVO_KEY = DISPOSITIVO_KEY;
    window.__idDispositivo = idDispositivo;
  `);
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarEventoIdYReintentoNoDuplica(archivo){
  console.log('\n=== ' + archivo + ' (event_id propio + reintento no duplica) ===');
  // 1er insert (desde enviarEvento): éxito. 2do insert (el reintento manual
  // de abajo, mismo event_id): Supabase respondería con violación de UNIQUE.
  const { win, errores } = await levantar(archivo, [
    {error:null},
    {error:{code:'23505', message:'duplicate key value violates unique constraint "eventos_sync_event_id_key"'}}
  ]);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const p = Object.keys(win.__est().potreros)[0];

  win.__enviarEvento('ingreso', p, { categoria: 'Vacas', cantidad: 5 }, '01/01/2026');
  await new Promise(r=>setTimeout(r,20));
  const primerEnvio = win.__inserted[0];
  // 12/9/2026: event_id es columna `uuid` en Supabase -- un string cualquiera
  // (ej. el formato de generarIdHistorial(), "h_<timestamp>_<random>") pasa
  // este chequeo si solo se mira "no vacío", pero Postgres lo rechaza con
  // 22P02 al insertar. Este bug real rompió TODOS los inserts un día entero
  // sin que ningún test lo detectara -- por eso se valida el formato UUID
  // real, no solo la presencia del campo.
  const esUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  chequear('el insert incluye un event_id con formato UUID válido (columna `uuid` en Supabase)',
    !!primerEnvio && typeof primerEnvio.event_id === 'string' && esUUID.test(primerEnvio.event_id),
    JSON.stringify(primerEnvio));

  // Reintento manual del MISMO evento (mismo event_id): simula que el
  // insert anterior sí había llegado a Supabase pero el cliente no se
  // enteró (corte de red justo después). El mock consume ahora la 2da
  // respuesta de la cola -- la violación de UNIQUE simulada arriba.
  const est = win.__est();
  const antesCola = (est.colaSync||[]).length;
  const mismoEvento = { event_id: primerEnvio.event_id, tipo:'ingreso', potrero:p, detalle:{categoria:'Vacas', cantidad:5}, fecha_cliente:'01/01/2026' };
  const ok = await win.__pushEventoRemoto(mismoEvento);
  chequear('el reintento con el mismo event_id (23505) se trata como éxito', ok === true);
  chequear('el reintento NO se reencola en colaSync (23505 no es una falla real)',
    (est.colaSync||[]).length === antesCola, JSON.stringify(est.colaSync));
}

async function probarErrorRealSiSeReencola(archivo){
  console.log('\n=== ' + archivo + ' (un error real SI se reencola, no se traga silenciosamente) ===');
  const { win, errores } = await levantar(archivo, [
    {error:{code:'500', message:'network error'}}
  ]);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const est = win.__est();
  const evento = { event_id: 'ev_test_1', tipo:'ingreso', potrero:Object.keys(est.potreros)[0], detalle:{categoria:'Vacas', cantidad:1}, fecha_cliente:'01/01/2026' };
  const ok = await win.__pushEventoRemoto(evento);
  chequear('un error que no es 23505 sigue devolviendo false', ok === false);
  chequear('un error que no es 23505 sigue reencolando el evento',
    (est.colaSync||[]).some(e=>e.event_id==='ev_test_1'), JSON.stringify(est.colaSync));
}

async function probarResetBorraDispositivo(archivo){
  console.log('\n=== ' + archivo + ' (Restablecer borra también el ID de dispositivo) ===');
  const { win, errores } = await levantar(archivo, []);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const idAntes = win.__idDispositivo();
  chequear('hay un ID de dispositivo guardado antes del reset',
    win.localStorage.getItem(win.__DISPOSITIVO_KEY) === idAntes);
  win.document.getElementById('btn-restablecer').dispatchEvent(new win.Event('click', {bubbles:true}));
  chequear('el reset borra el ID de dispositivo del localStorage (antes solo borraba el estado, y la propia historia nunca volvía)',
    win.localStorage.getItem(win.__DISPOSITIVO_KEY) === null,
    'quedó: ' + win.localStorage.getItem(win.__DISPOSITIVO_KEY));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos){
    await probarEventoIdYReintentoNoDuplica(a);
    await probarErrorRealSiSeReencola(a);
    await probarResetBorraDispositivo(a);
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
