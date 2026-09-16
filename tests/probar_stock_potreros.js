/*
 * Prueba: publicar el stock de cada potrero en la tabla `stock_potreros` de
 * Supabase (16/9/2026, a pedido de Pedro: "que el numero de animales en cada
 * potrero quede cargado en Supabase para hacer consultas").
 *
 * Es una FOTO del estado actual (a diferencia de Sanidad, que acumula filas
 * para siempre): publicarStockPotrero() hace upsert de las categorias con
 * stock + delete de las que llegaron a 0, para no dejar filas viejas.
 * Rollout gradual por CONFIG.stockSupabase -- hoy solo La Vuelta lo tiene en
 * true; en Maria Laura/Pone Chico el codigo esta pero es un no-op (se prueba
 * tambien acá, para confirmar que el gate funciona de verdad).
 *
 * Se prueban las funciones directamente (publicarStockPotrero/Potreros,
 * vaciarColaStock) y la integracion con sincronizar()/aplicarEventoRemoto --
 * no hace falta manejar cada formulario de la UI, el comportamiento nuevo
 * vive en esas funciones, no en los formularios que las llaman.
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

/* Mock de Supabase, extendido respecto al de probar_sanidad_carga.js /
   probar_sync_concurrente.js con upsert/delete/.not() -- necesarios porque
   stock_potreros se REEMPLAZA, no se acumula como eventos_sync/sanidad_carga. */
function crearServidor(){
  const filas = { eventos_sync: [], stock_potreros: [] };
  const contadores = { upsert: 0, delete: 0 };
  return {
    filas, contadores,
    createClient(){
      return { from(tabla){
        const q = { _filtros: [], _delete: false };
        q.insert = (obj)=>{ (filas[tabla]=filas[tabla]||[]).push(Object.assign({}, obj)); return Promise.resolve({ error: null }); };
        q.upsert = (objs, opts)=>{
          contadores.upsert++;
          const claves = ((opts && opts.onConflict) || '').split(',');
          const arr = filas[tabla] = filas[tabla] || [];
          (Array.isArray(objs) ? objs : [objs]).forEach(obj=>{
            const idx = arr.findIndex(r=> claves.every(c=>r[c]===obj[c]));
            if(idx>=0) arr[idx] = Object.assign({}, arr[idx], obj); else arr.push(Object.assign({}, obj));
          });
          return Promise.resolve({ error: null });
        };
        q.select = ()=>q;
        q.eq = (col,val)=>{ q._filtros.push(r=>r[col]===val); return q; };
        q.gt = (col,val)=>{ q._filtros.push(r=>r[col]>val); return q; };
        q.order = ()=>q; q.limit = ()=>q;
        q.in = (col,vals)=>{ q._filtros.push(r=>vals.includes(r[col])); return q; };
        q.not = (col, op, val)=>{
          const lista = String(val).replace(/^\(|\)$/g,'').split(',').filter(Boolean).map(s=>s.replace(/^"|"$/g,''));
          q._filtros.push(r=> !lista.includes(r[col]));
          return q;
        };
        q.delete = ()=>{ q._delete = true; return q; };
        q.then = (res)=>{
          if(q._delete){
            contadores.delete++;
            filas[tabla] = (filas[tabla]||[]).filter(r=>!q._filtros.every(f=>f(r)));
            return Promise.resolve(res({ error: null }));
          }
          const data = (filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r)));
          return Promise.resolve(res({ data, error: null }));
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
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__CONFIG = CONFIG;' +
      '\n;window.__potrerosGeo = POTREROS_GEO;' +
      '\n;window.__idDispositivo = idDispositivo;');
  }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const est = win.__est();
  const habilitado = !!win.__CONFIG.stockSupabase;
  console.log('    (CONFIG.stockSupabase = ' + habilitado + ')');

  // Dos potreros sintéticos y SIEMPRE vacíos -- Pone Chico arranca sin
  // potreros, pero La Vuelta/María Laura ya traen carga inicial real en sus
  // primeros potreros (ej. "2" ya tiene 56 Vaquillonas), así que no alcanza
  // con tomar los dos primeros de POTREROS_GEO: haría que el conteo de
  // "1 fila nueva" fallara por stock que ya estaba ahí de antes, no por un
  // bug del código bajo prueba.
  const geoA = {nombre:'STOCK-A', area:null, coords:[[-31.98,-56.34],[-31.981,-56.34],[-31.981,-56.341]]};
  const geoB = {nombre:'STOCK-B', area:null, coords:[[-31.98,-56.35],[-31.981,-56.35],[-31.981,-56.351]]};
  win.__potrerosGeo.push(geoA, geoB);
  est.potreros['STOCK-A'] = {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null};
  est.potreros['STOCK-B'] = {animales:{}, historial:[], fechaIngreso:null, fechaSalida:null};
  // dibujarPotrero() -- igual que hace la rama 'potrero_creado' de
  // aplicarEventoRemoto() -- para que actualizarTodo()/refrescarColoresMapa()
  // (que sincronizar() dispara si cambios>0) encuentren un polígono real para
  // estos dos potreros sintéticos, no undefined.
  win.dibujarPotrero(geoA);
  win.dibujarPotrero(geoB);
  const potreroA = 'STOCK-A';
  const potreroB = 'STOCK-B';

  // --- A: publicar un potrero con stock nuevo ---
  est.potreros[potreroA].animales['Vacas||'] = 5;
  await win.publicarStockPotrero(potreroA);
  let filasA = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroA);
  if(!habilitado){
    chequear('con stockSupabase=false no escribe nada a stock_potreros', filasA.length === 0, JSON.stringify(filasA));
  } else {
    chequear('aparece 1 fila con la cantidad correcta', filasA.length === 1 && filasA[0].cantidad === 5, JSON.stringify(filasA));
    chequear('la fila lleva establecimiento/potrero/clave/categoria', filasA[0] && filasA[0].establecimiento === win.__CONFIG.establecimiento && filasA[0].categoria === 'Vacas');
  }

  if(habilitado){
    // --- B: una categoría que baja a 0 desaparece, otra que sigue queda ---
    est.potreros[potreroA].animales['Terneros||'] = 3;
    await win.publicarStockPotrero(potreroA);
    filasA = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroA);
    chequear('agregar otra categoría suma una fila más (2 en total)', filasA.length === 2, JSON.stringify(filasA));

    est.potreros[potreroA].animales['Vacas||'] = 0;
    await win.publicarStockPotrero(potreroA);
    filasA = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroA);
    chequear('la categoría que llegó a 0 desaparece, no queda "en 0"', filasA.length === 1 && filasA[0].categoria === 'Terneros', JSON.stringify(filasA));

    // --- C: offline encola por nombre, y recalcula el estado más reciente al vaciar ---
    Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
    est.potreros[potreroA].animales['Terneros||'] = 1; // cambia mientras está offline
    const okOffline = await win.publicarStockPotrero(potreroA);
    chequear('offline devuelve false y no llama al servidor', okOffline === false);
    chequear('el nombre queda en estado.colaStock (una sola vez)', (est.colaStock||[]).filter(n=>n===potreroA).length === 1, JSON.stringify(est.colaStock));
    est.potreros[potreroA].animales['Terneros||'] = 9; // sigue cambiando antes de reconectar
    await win.publicarStockPotrero(potreroA); // se vuelve a marcar, sin duplicar la cola
    chequear('marcar sucio dos veces offline no duplica la cola', (est.colaStock||[]).filter(n=>n===potreroA).length === 1, JSON.stringify(est.colaStock));

    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
    await win.vaciarColaStock();
    filasA = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroA);
    chequear('vaciarColaStock deja la cola vacía', (est.colaStock||[]).length === 0);
    chequear('publica el estado MÁS RECIENTE (9), no el de cuando se encoló', filasA.length === 1 && filasA[0].cantidad === 9, JSON.stringify(filasA));

    // --- D: sincronizar() publica los potreros que tocó el batch de eventos remotos, uno cada uno ---
    est.ultimaSincronizacion = '2026-01-01T00:00:00.000Z'; // no es la primera sync
    const otroDispositivo = 'disp_otro_test';
    servidor.filas.eventos_sync.push(
      { event_id: 'evt-1', establecimiento: win.__CONFIG.establecimiento, dispositivo: otroDispositivo,
        tipo: 'ingreso', potrero: potreroB, detalle: {categoria:'Vacas', dueno:'', cantidad: 4}, fecha_cliente: '16/09/2026', creado_en: '2026-09-16T10:00:00.000Z' }
    );
    const upsertsAntes = servidor.contadores.upsert;
    await win.sincronizar(false);
    filasA = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroA);
    const filasB = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroB);
    chequear('el potrero B (tocado por el evento remoto) queda publicado', filasB.length === 1 && filasB[0].cantidad === 4, JSON.stringify(filasB));
    chequear('el potrero A (no tocado por este batch) no se volvió a publicar', servidor.contadores.upsert === upsertsAntes + 1, 'upserts: ' + (servidor.contadores.upsert - upsertsAntes));

    // --- reset completo: ultimaSincronizacion null -> se publican TODOS los potreros ---
    est.ultimaSincronizacion = null;
    // "borra" A de la tabla para simular que viene de otro dispositivo recién restablecido
    servidor.filas.stock_potreros = servidor.filas.stock_potreros.filter(r=>r.potrero!==potreroA);
    await win.sincronizar(false);
    filasA = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroA);
    chequear('reset completo (ultimaSincronizacion null) republica TODOS los potreros, incluido uno sin eventos en este batch',
      filasA.length === 1 && filasA[0].cantidad === 9, JSON.stringify(filasA));

    // --- E: un potrero eliminado limpia sus filas de stock_potreros ---
    delete est.potreros[potreroB];
    await win.publicarStockPotrero(potreroB);
    const filasBTrasBorrar = (servidor.filas.stock_potreros||[]).filter(r=>r.potrero===potreroB);
    chequear('un potrero que ya no existe en estado.potreros queda sin filas en stock_potreros', filasBTrasBorrar.length === 0, JSON.stringify(filasBTrasBorrar));
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
