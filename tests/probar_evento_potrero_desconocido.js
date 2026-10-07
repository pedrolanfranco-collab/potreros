/*
 * Prueba ad-hoc: un evento que menciona un potrero que ESTE dispositivo todavia no
 * conoce se ESTACIONA y se aplica cuando el potrero aparece (7/10/2026), en vez de
 * descartarse en silencio. Caso real: Piquete se importo en un dispositivo y se
 * cargo un movimiento hacia el antes de que los demas recibieran el
 * `potrero_creado`; un dispositivo lo aplico y otros no, y OMBU quedo con -2
 * caballos en una PC y 0 en las demas.
 *
 * Dos dispositivos con el mismo servidor falso: A ya conoce el potrero nuevo
 * (sembrado en su almacenamiento, como un potrero importado a mano) y B no. Los
 * eventos hacia el potrero nuevo estan ANTES (en el orden del servidor) que su
 * `potrero_creado`. Los dos tienen que terminar con el mismo stock.
 * Los eventos anteriores al corte (CORTE_PENDIENTES) siguen descartandose como
 * siempre, para no cambiar el calculo del pasado.
 *
 * Uso: node probar_evento_potrero_desconocido.js <index.html> [...]
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
          order(col,opts){ q._orden = {col, asc: !opts || opts.ascending!==false}; return q; },
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
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  if(antes) antes(win);
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__establecimiento = function(){ return ESTABLECIMIENTO; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
      window.__config = function(){ return CONFIG; };
      window.__storageKey = function(){ return STORAGE_KEY; };
      window.__nuevosKey = function(){ return POTREROS_NUEVOS_KEY; };
      window.__corte = function(){ return CORTE_PENDIENTES; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}


let seq = 0;
let relojMs = 0;
function inyectar(servidor, estab, tipo, potrero, detalle, fecha, creadoEnMs){
  servidor.filas.eventos_sync.push({
    event_id: 'ev-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8),
    establecimiento: estab, dispositivo: 'celular-de-prueba', tipo, potrero, detalle,
    fecha_cliente: fecha, creado_en: new Date(creadoEnMs).toISOString()
  });
}
const stock = (win, p, key) => (win.__est().potreros[p] ? (win.__est().potreros[p].animales[key] || 0) : null);
function foto(win, nombres){
  const o = {};
  nombres.forEach(p => {
    o[p] = win.__est().potreros[p]
      ? Object.entries(win.__est().potreros[p].animales).filter(([, c]) => c !== 0).sort((a, b) => a[0].localeCompare(b[0]))
      : null;
  });
  return JSON.stringify(o);
}
const pendientes = (win, n) => ((win.__est().pendientesPotrero || {})[n] || []).length;

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  // un dispositivo "sin potreros nuevos" para elegir origen y categorias
  const sonda = await levantar(archivo, servidor);
  if(sonda.errores.length){ chequear('carga sin errores', false, sonda.errores[0]); return; }
  const geo = sonda.win.__potrerosGeo();
  if(geo.length < 2){ console.log('  (menos de 2 potreros -- se saltea)'); return; }
  const estab = sonda.win.__establecimiento();
  const corteMs = Date.parse(sonda.win.__corte());
  let p = null, keys = [];
  for(const g of geo){
    const animales = sonda.win.__est().potreros[g.nombre].animales;
    const ks = Object.keys(animales).filter(k => animales[k] >= 6 && !/^Terneros/.test(k)); // Terneros se usa aparte, para el nacimiento
    if(ks.length >= 2){ p = g.nombre; keys = ks.slice(0, 2); break; }
    if(ks.length && !p){ p = g.nombre; keys = ks; }
  }
  if(!p){ console.log('  (sin stock suficiente -- se saltea)'); return; }
  const key = keys[0];
  const { cat, dueno: du } = sonda.win.partesClave(keys[0]);
  const key2 = keys[1] || keys[0];
  const { cat: cat2, dueno: du2 } = sonda.win.partesClave(key2);
  const hoy = sonda.win.fechaHoy();
  const keyTerneros = sonda.win.claveAnimal('Terneros', du);
  const NUEVO = 'PotreroNuevoPrueba';
  const coords = [[-31.30, -55.40], [-31.30, -55.39], [-31.31, -55.39], [-31.31, -55.40]];
  const t0 = corteMs + 3600 * 1000; // todo "después del corte"

  // A conoce el potrero nuevo desde antes (como uno importado a mano); B no
  const A = await levantar(archivo, servidor, win => {
    win.localStorage.setItem('potreros_nuevos_sembrado', '1');
    const clave = estab + '_potreros_nuevos';
    win.localStorage.setItem(clave, JSON.stringify([{ nombre: NUEVO, coords, area: null }]));
  });
  const B = await levantar(archivo, servidor);
  chequear('A y B cargan sin errores', A.errores.length === 0 && B.errores.length === 0, [...A.errores, ...B.errores].join(' | '));
  if(A.errores.length || B.errores.length) return;
  chequear('A conoce el potrero nuevo y B no', !!A.win.__est().potreros[NUEVO] && !B.win.__est().potreros[NUEVO]);

  const base = {
    p: stock(B.win, p, key), p2: stock(B.win, p, key2), terneros: stock(B.win, p, keyTerneros)
  };

  // eventos hacia/desde el potrero nuevo, ANTES de su potrero_creado en el orden del servidor
  let t = t0;
  inyectar(servidor, estab, 'movimiento_multi', p, { destino: NUEVO, items: [{ categoria: cat, categoriaDestino: cat, dueno: du, cantidad: 3 }], obs: null }, hoy, t += 1000);
  inyectar(servidor, estab, 'nacimiento', NUEVO, { categoria: 'Terneros', dueno: du, cantidad: 2, obs: null }, hoy, t += 1000);
  inyectar(servidor, estab, 'movimiento', p, { categoria: cat, dueno: du, cantidad: 1, destino: NUEVO }, hoy, t += 1000);
  inyectar(servidor, estab, 'correccion', p, { accion: 'eliminar', tipoOriginal: 'movimiento_multi', fechaOriginal: hoy,
    reversar: { tipo: 'mover_multi', origen: NUEVO, destino: p, items: [{ categoria: cat, categoriaDestino: cat, dueno: du, cantidad: 3 }] } }, hoy, t += 1000);
  inyectar(servidor, estab, 'movimiento_multi', NUEVO, { destino: p, items: [{ categoria: 'Terneros', categoriaDestino: 'Terneros', dueno: du, cantidad: 1 }], obs: null }, hoy, t += 1000);
  inyectar(servidor, estab, 'movimiento_todo', p, { destino: NUEVO, items: [{ categoria: cat2, dueno: du2, cantidad: 1 }] }, hoy, t += 1000);
  const TOTAL = 6;

  await B.win.sincronizar(false);
  chequear(`B estaciona los ${TOTAL} eventos en vez de descartarlos`, pendientes(B.win, NUEVO) === TOTAL, String(pendientes(B.win, NUEVO)));
  chequear('y mientras tanto no toca el stock del origen', stock(B.win, p, key) === base.p && stock(B.win, p, keyTerneros) === base.terneros);
  const guardado = JSON.parse(B.win.localStorage.getItem(B.win.__storageKey()));
  chequear('los pendientes quedan guardados (sobreviven a recargar)', guardado.pendientesPotrero && guardado.pendientesPotrero[NUEVO] && guardado.pendientesPotrero[NUEVO].length === TOTAL);

  // llega el potrero_creado (después en el orden del servidor)
  inyectar(servidor, estab, 'potrero_creado', NUEVO, { coords, area: null }, hoy, t += 1000);
  await A.win.sincronizar(false);
  await B.win.sincronizar(false);
  chequear('B conoce ahora el potrero nuevo', !!B.win.__est().potreros[NUEVO]);
  chequear('B aplicó y vació los pendientes', pendientes(B.win, NUEVO) === 0);
  const nombres = [p, NUEVO];
  chequear('A y B terminan con EL MISMO stock (origen y potrero nuevo)', foto(A.win, nombres) === foto(B.win, nombres),
    'A=' + foto(A.win, nombres) + ' B=' + foto(B.win, nombres));
  // lo esperado en cifras: p: -1 (mov simple) -1 (mover todo); la multi de 3 se revirtió; terneros +1 (volvieron de NUEVO)
  chequear('y coincide con lo esperado a mano',
    stock(B.win, p, key) === base.p - 1 - (key2 === key ? 1 : 0) && stock(B.win, NUEVO, key) === 1 + (key2 === key ? 1 : 0) && stock(B.win, NUEVO, keyTerneros) === 1 && stock(B.win, p, keyTerneros) === base.terneros + 1,
    `p=${stock(B.win, p, key)} NUEVO=${stock(B.win, NUEVO, key)} terneros NUEVO=${stock(B.win, NUEVO, keyTerneros)}`);
  chequear('B tiene las entradas de historial de lo estacionado', B.win.__est().potreros[NUEVO].historial.length >= 3);

  // sincronizar otra vez no vuelve a aplicar nada
  const fotoAntes = foto(B.win, nombres);
  await B.win.sincronizar(false);
  chequear('no se aplica dos veces', foto(B.win, nombres) === fotoAntes);

  // eventos anteriores al corte: se siguen descartando como siempre
  const C = await levantar(archivo, servidor);
  const antiguo = 'PotreroAntiguoPrueba';
  const tViejo = corteMs - 7200 * 1000;
  inyectar(servidor, estab, 'movimiento_multi', p, { destino: antiguo, items: [{ categoria: cat, categoriaDestino: cat, dueno: du, cantidad: 2 }], obs: null }, hoy, tViejo);
  inyectar(servidor, estab, 'potrero_creado', antiguo, { coords: coords.map(c => [c[0] - 0.1, c[1]]), area: null }, hoy, tViejo + 1000);
  // el sincronizar de C trae TODO; el viejo (antes del corte) no debe estacionarse
  await C.win.sincronizar(false);
  chequear('un evento anterior al corte hacia un potrero desconocido se descarta (no se estaciona)', pendientes(C.win, antiguo) === 0);
  chequear('y el origen no cambió por ese evento (mismo cálculo que antes)', foto(C.win, [p]) === foto(B.win, [p]), 'C=' + foto(C.win, [p]) + ' B=' + foto(B.win, [p]));

  // potrero_eliminado descarta los pendientes de ese nombre
  const D = await levantar(archivo, servidor);
  const efimero = 'PotreroEfimeroPrueba';
  D.win.__est().pendientesPotrero = {};
  const rowEvento = { event_id: 'x1', tipo: 'nacimiento', potrero: efimero, dispositivo: 'otro', creado_en: new Date(t0 + 99999).toISOString(), fecha_cliente: hoy, detalle: { categoria: 'Terneros', dueno: du, cantidad: 1 } };
  D.win.aplicarEventoRemoto(rowEvento, new Set());
  chequear('un evento a un potrero desconocido queda estacionado', pendientes(D.win, efimero) === 1);
  D.win.aplicarEventoRemoto(Object.assign({}, rowEvento), new Set());
  chequear('el mismo evento (mismo event_id) no se estaciona dos veces', pendientes(D.win, efimero) === 1);
  D.win.aplicarEventoRemoto({ event_id: 'x2', tipo: 'potrero_eliminado', potrero: efimero, dispositivo: 'otro', creado_en: new Date(t0 + 100000).toISOString(), fecha_cliente: hoy, detalle: {} }, new Set());
  chequear('potrero_eliminado descarta los pendientes de ese nombre', pendientes(D.win, efimero) === 0);

  // topes
  for(let i = 0; i < 105; i++){
    D.win.aplicarEventoRemoto({ event_id: 'tope' + i, tipo: 'nacimiento', potrero: 'Tope1', dispositivo: 'otro', creado_en: new Date(t0 + 200000 + i).toISOString(), fecha_cliente: hoy, detalle: { categoria: 'Terneros', dueno: du, cantidad: 1 } }, new Set());
  }
  chequear('tope de 100 eventos por potrero desconocido', pendientes(D.win, 'Tope1') === 100, String(pendientes(D.win, 'Tope1')));
  for(let i = 0; i < 60; i++){
    D.win.aplicarEventoRemoto({ event_id: 'n' + i, tipo: 'nacimiento', potrero: 'Nombre' + i, dispositivo: 'otro', creado_en: new Date(t0 + 300000 + i).toISOString(), fecha_cliente: hoy, detalle: { categoria: 'Terneros', dueno: du, cantidad: 1 } }, new Set());
  }
  chequear('tope de 50 nombres distintos', Object.keys(D.win.__est().pendientesPotrero).length === 50, String(Object.keys(D.win.__est().pendientesPotrero).length));

  // creación local: aplicarPendientesDePotreroLocal (lo usan dibujar y importar KML)
  const E = await levantar(archivo, servidor);
  const local = 'PotreroLocalPrueba';
  const antesE = stock(E.win, p, key);
  E.win.aplicarEventoRemoto({ event_id: 'l1', tipo: 'movimiento_multi', potrero: p, dispositivo: 'otro', creado_en: new Date(t0 + 500000).toISOString(), fecha_cliente: hoy,
    detalle: { destino: local, items: [{ categoria: cat, categoriaDestino: cat, dueno: du, cantidad: 1 }], obs: null } }, new Set());
  chequear('el movimiento hacia un potrero que todavía no existe queda estacionado', pendientesE(E, local) === 1 && stock(E.win, p, key) === antesE);
  E.win.__potrerosGeo().push({ nombre: local, coords, area: null });
  E.win.__est().potreros[local] = { animales: {}, historial: [], fechaIngreso: null, fechaSalida: null };
  E.win.aplicarPendientesDePotreroLocal(local);
  chequear('al crearse el potrero localmente se aplica lo estacionado', stock(E.win, p, key) === antesE - 1 && stock(E.win, local, key) === 1 && pendientesE(E, local) === 0);
}
function pendientesE(dev, n){ return ((dev.win.__est().pendientesPotrero || {})[n] || []).length; }

(async () => {
  for(const a of process.argv.slice(2)) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
