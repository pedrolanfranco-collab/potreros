/*
 * Prueba ad-hoc: "Restablecer datos de fábrica" también borra los potreros guardados en el navegador
 * (`<ESTABLECIMIENTO>_potreros_nuevos`, 25/10/2026).
 *
 * Caso real (La Vuelta, eventos_sync del 11/09 al 18/09/2026): un equipo reiniciado terminaba con el Piquete
 * en el doble (10 / 4 / 10 en vez de 5 / 2 / 5) y OMBU en -2 / -5. El reinicio borraba el estado y el ID de
 * dispositivo pero dejaba el Piquete guardado: al abrir, el potrero ya existía y la reconstrucción aplicaba
 * los eventos ANTERIORES a su `potrero_creado` (el ingreso del 11/09 y el primer movimiento OMBU→Piquete del
 * 13/09), que un equipo sin el potrero descarta (son anteriores al corte CORTE_PENDIENTES del 7/10).
 *
 * Con los eventos reales (La Vuelta) verifica que un equipo nuevo, uno reiniciado y uno que ya tenía el
 * potrero guardado y se reinicia terminen con el mismo stock; en las tres apps verifica que el reinicio
 * borre la clave. Solo las variantes completas tienen el botón (Campo no).
 *
 * Uso: node probar_reset_potreros_guardados.js <index.html> [...]
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; },
    doubleClickZoom: { disable(){}, enable(){} } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); }, DomEvent: { stopPropagation(){} } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

function crearServidor(){
  const filas = { eventos_sync: [], stock_potreros: [] };
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _orden: null, _modo: 'select',
          select(){ q._modo='select'; return q; },
          insert(rows){ q._modo='insert'; q._filas = Array.isArray(rows)?rows:[rows]; return q; },
          upsert(rows){ q._modo='upsert'; q._filas = Array.isArray(rows)?rows:[rows]; return q; },
          delete(){ q._modo='delete'; return q; },
          eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
          gte(col,val){ q._filtros.push(r=>r[col]>=val); return q; },
          not(){ return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          order(col,opts){ if(!q._orden) q._orden = {col, asc: !opts || opts.ascending!==false}; return q; }, range(){ return q; }, /* el primer orden manda (el desempate por id se ignora) y .range() devuelve todo */
          then(res){
            filas[tabla] = filas[tabla] || [];
            if(q._modo==='insert'){
              q._filas.forEach(f=>{
                if(f.event_id && filas[tabla].some(r=>r.event_id===f.event_id)) return;
                filas[tabla].push(Object.assign({creado_en: new Date().toISOString()}, f));
              });
              return Promise.resolve(res({data:q._filas, error:null}));
            }
            if(q._modo==='upsert') return Promise.resolve(res({data:q._filas, error:null}));
            if(q._modo==='delete'){
              filas[tabla] = filas[tabla].filter(r=>!q._filtros.every(f=>f(r)));
              return Promise.resolve(res({data:null, error:null}));
            }
            let data = filas[tabla].filter(r=>q._filtros.every(f=>f(r)));
            if(q._orden) data = data.slice().sort((a,b)=>{
              const av=a[q._orden.col], bv=b[q._orden.col];
              return (av<bv?-1:av>bv?1:0) * (q._orden.asc?1:-1);
            });
            return Promise.resolve(res({data, error:null}));
          }
        };
        return q;
      } };
    }
  };
}

async function levantar(archivo, servidor, antes){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  // location.reload() no está implementado en jsdom: el reinicio lo dispara y no es un error de la app
  vc.on('jsdomError', e => { if(!/Not implemented: navigation/.test(e.message || '')) errores.push('jsdomError: ' + (e.stack || e.message)); });
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  if(antes) antes(win);
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__establecimiento = function(){ return ESTABLECIMIENTO; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
      window.__storageKey = function(){ return STORAGE_KEY; };
      window.__nuevosKey = function(){ return POTREROS_NUEVOS_KEY; };
      window.__dispKey = function(){ return DISPOSITIVO_KEY; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(80);
  return { win, errores };
}

function volcarLocalStorage(win){
  const o = {};
  for(let i = 0; i < win.localStorage.length; i++){ const k = win.localStorage.key(i); o[k] = win.localStorage.getItem(k); }
  return o;
}
function restaurarLocalStorage(win, o){ Object.entries(o).forEach(([k, v]) => win.localStorage.setItem(k, v)); }
function reiniciar(win){
  win.document.getElementById('btn-restablecer').dispatchEvent(new win.Event('click', { bubbles: true }));
  return volcarLocalStorage(win);
}

// --- Eventos reales de eventos_sync (La Vuelta), tal cual están guardados (creado_en, fecha_cliente, detalle) ---
const PEDRO = 'Pedro Lanfranco';
const ITEMS = [
  { dueno: PEDRO, cantidad: 2, categoria: 'Caballos', categoriaDestino: 'Caballos' },
  { dueno: PEDRO, cantidad: 5, categoria: 'Yeguas', categoriaDestino: 'Yeguas' }
];
const COORDS = [[-31.39986455738195, -55.43343165478074], [-31.39962091778202, -55.43325233463788], [-31.39923939543007, -55.43394084798048],
  [-31.40118352980955, -55.43531463147703], [-31.40208974980968, -55.43362576570514], [-31.39986455738195, -55.43343165478074]];
function eventosReales(estab){
  const e = (creado_en, tipo, potrero, detalle, fecha, event_id, dispositivo) =>
    ({ event_id, establecimiento: estab, dispositivo: dispositivo || 'otro-equipo', tipo, potrero, detalle, fecha_cliente: fecha, creado_en });
  return [
    // 11/09: ingreso de 5 Caballos al Piquete, ANTES de que el Piquete exista como evento (event_id null: es de antes de la columna)
    e('2026-09-11T19:25:52.094796+00:00', 'ingreso', 'Piquete', { cantidad: 5, categoria: 'Caballos' }, '11/09/2026', null, 'disp_1788467546727_jpo2eh'),
    // 13/09: ingreso en OMBU
    e('2026-09-13T11:50:17.265269+00:00', 'ingreso', 'OMBU', { dueno: PEDRO, cantidad: 2, categoria: 'Caballos' }, '01/09/2026', 'a0be1cb5-b12d-4b6c-920f-1ec67b38a843', 'disp_1789251175610_q1qize'),
    e('2026-09-13T11:50:17.266891+00:00', 'ingreso', 'OMBU', { dueno: PEDRO, cantidad: 5, categoria: 'Yeguas' }, '01/09/2026', 'c8a112b0-b8a5-46f3-9204-36b42bbf5cb5', 'disp_1789251175610_q1qize'),
    // 13/09 12:09: 1er movimiento OMBU -> Piquete, también ANTES del potrero_creado
    e('2026-09-13T12:09:12.58882+00:00', 'movimiento_multi', 'OMBU', { obs: null, items: ITEMS, destino: 'Piquete', usuario: 'Pedro' }, '13/09/2026', '90057cad-ed04-4ef8-b27b-35d96da66b5c', 'disp_1789252005764_qlkq24'),
    // 14/09: se crea el Piquete
    e('2026-09-14T15:08:43.859051+00:00', 'potrero_creado', 'Piquete', { area: null, coords: COORDS, usuario: 'Pedro' }, '14/09/2026', '676639b8-c3dd-4318-aadf-e2a84fd576c8', 'disp_1789398274179_imtbt0'),
    // 14/09: 2do movimiento, su anulación y 3er movimiento (fecha 01/09)
    e('2026-09-14T15:09:29.173068+00:00', 'movimiento_multi', 'OMBU', { obs: null, items: ITEMS, destino: 'Piquete', usuario: 'Pedro' }, '14/09/2026', '8e3f1a12-cd33-44a6-86b6-cc21affeb949', 'disp_1789398274179_imtbt0'),
    e('2026-09-14T15:09:41.68984+00:00', 'correccion', 'OMBU', { accion: 'eliminar', usuario: 'Pedro', historialId: 'h_1789398568933_wvihks', tipoOriginal: 'movimiento_multi', fechaOriginal: '14/09/2026',
      reversar: { tipo: 'mover_multi', items: ITEMS, origen: 'Piquete', destino: 'OMBU' } }, '14/09/2026', '6df904e6-f183-4bf8-8a85-1a8c5ae1e0dd', 'disp_1789398274179_imtbt0'),
    e('2026-09-14T15:09:58.028747+00:00', 'movimiento_multi', 'OMBU', { obs: null, items: ITEMS, destino: 'Piquete', usuario: 'Pedro' }, '01/09/2026', 'f3787e2f-8c71-41da-8170-6b93a7a3e148', 'disp_1789398274179_imtbt0'),
    // 18/09: ingreso manual de los mismos 5 Caballos (parche para los equipos que descartaron el del 11/09)
    e('2026-09-18T23:03:58.590463+00:00', 'ingreso', 'Piquete', { dueno: '', cantidad: 5, categoria: 'Caballos' }, '2026-09-11', 'bebebcac-645b-4c35-bbc8-0a02ff4c6b0b', 'correccion-manual-18-9')
  ];
}

const CLAVES = { cab: 'Caballos||', cabP: 'Caballos||' + PEDRO, yeP: 'Yeguas||' + PEDRO };
const val = (win, p, k) => { const x = win.__est().potreros[p]; return x ? (x.animales[k] || 0) : null; };
function resumen(win){
  return { 'Piquete Caballos': val(win, 'Piquete', CLAVES.cab), 'Piquete Caballos Pedro': val(win, 'Piquete', CLAVES.cabP), 'Piquete Yeguas Pedro': val(win, 'Piquete', CLAVES.yeP),
    'OMBU Caballos Pedro': val(win, 'OMBU', CLAVES.cabP), 'OMBU Yeguas Pedro': val(win, 'OMBU', CLAVES.yeP) };
}
// lo que muestran los equipos que fueron sincronizando de a poco: el Piquete se cuenta desde su `potrero_creado`
const ESPERADO = { 'Piquete Caballos': 5, 'Piquete Caballos Pedro': 2, 'Piquete Yeguas Pedro': 5, 'OMBU Caballos Pedro': 0, 'OMBU Yeguas Pedro': 0 };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const sonda = await levantar(archivo, servidor);
  if(sonda.errores.length){ chequear('carga sin errores', false, sonda.errores[0]); return; }
  const estab = sonda.win.__establecimiento();
  if(!sonda.win.document.getElementById('btn-restablecer')){ console.log('  (sin botón "Restablecer datos de fábrica" -- variante Campo, se saltea)'); return; }

  // En cualquier establecimiento: el reinicio deja el navegador sin los potreros guardados
  const sembrado = JSON.stringify([{ nombre: 'PotreroGuardadoPrueba', coords: [[-31.30, -55.40], [-31.30, -55.39], [-31.31, -55.39]], area: null }]);
  const G = await levantar(archivo, servidor, win => win.localStorage.setItem(estab + '_potreros_nuevos', sembrado));
  chequear('cargan sin errores con un potrero guardado y lo conocen', G.errores.length === 0 && !!G.win.__est().potreros['PotreroGuardadoPrueba'], G.errores.join(' | '));
  const quedoG = reiniciar(G.win);
  chequear('el reinicio borra el estado y el ID de dispositivo', !(G.win.__storageKey() in quedoG) && !(G.win.__dispKey() in quedoG), Object.keys(quedoG).join(','));
  chequear('y borra también los potreros guardados (<est>_potreros_nuevos)', !(G.win.__nuevosKey() in quedoG), String(quedoG[G.win.__nuevosKey()]));

  if(estab !== 'la_vuelta'){ return; }

  // La Vuelta: con los eventos reales del Piquete y OMBU
  servidor.filas.eventos_sync.push(...eventosReales(estab));
  chequear('el Piquete NO está en el POTREROS_GEO de fábrica; OMBU sí',
    !sonda.win.__potrerosGeo().some(g => g.nombre === 'Piquete') && sonda.win.__potrerosGeo().some(g => g.nombre === 'OMBU'));

  // 1) equipo que se instala de cero y trae toda la historia
  const B = await levantar(archivo, servidor);
  await B.win.sincronizar(false);
  chequear('un equipo nuevo termina con 5 / 2 / 5 y OMBU en 0', igual(resumen(B.win), ESPERADO), JSON.stringify(resumen(B.win)));
  const nuevosLS = B.win.localStorage.getItem(B.win.__nuevosKey());
  chequear('al recibir el potrero_creado, la app guarda el Piquete en el navegador', !!nuevosLS && JSON.parse(nuevosLS).some(x => x.nombre === 'Piquete'), String(nuevosLS));

  // 2) "Restablecer datos de fábrica" en ese mismo equipo y volver a abrir la app con lo que quedó en el navegador
  const quedo = reiniciar(B.win);
  chequear('el reinicio no deja el Piquete guardado', !(B.win.__nuevosKey() in quedo), String(quedo[B.win.__nuevosKey()]));
  const R = await levantar(archivo, servidor, win => restaurarLocalStorage(win, quedo));
  await R.win.sincronizar(false);
  chequear('el equipo reiniciado termina con 5 / 2 / 5 y OMBU en 0 (antes: 10 / 4 / 10 y OMBU en -2 / -5)', igual(resumen(R.win), ESPERADO), JSON.stringify(resumen(R.win)));
  chequear('y vuelve a tener el Piquete, creado por su potrero_creado', !!R.win.__est().potreros['Piquete'] && R.win.__potrerosGeo().some(g => g.nombre === 'Piquete'));
  chequear('y igual que un equipo nuevo en todos los potreros del caso',
    JSON.stringify(Object.entries(R.win.__est().potreros.Piquete.animales).sort()) === JSON.stringify(Object.entries(B.win.__est().potreros.Piquete.animales).sort()));
}

(async () => {
  for(const a of process.argv.slice(2)) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
