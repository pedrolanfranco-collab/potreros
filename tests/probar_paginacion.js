/*
 * Fase 3 de la auditoría (11/10/2026), paso 3: paginación (hallazgo 4). PostgREST corta cada
 * respuesta en 1000 filas SIN avisar (200 con las primeras 1000). Con CONFIG.colaOrdenada,
 * traerTodo() pide de a 1000 con .range(), en orden creado_en + id, hasta un lote incompleto.
 * Se prueba con un servidor falso que corta como el real:
 * - un equipo nuevo sincroniza 2.500 eventos: los aplica todos, el cursor queda en el último
 *   y la primera sincronización muestra "Poniéndose al día…";
 * - dos eventos con el MISMO creado_en justo en el borde de una página (pasa en producción:
 *   2 eventos de La Vuelta del 8/10 comparten el microsegundo) no se pierden ni se repiten;
 * - las estadísticas de muertes y el registro de muertes cuentan más de 1000 eventos;
 * - una página que falla a mitad de camino no aplica nada ni mueve el cursor.
 * Sin el flag se verifica que se sigue haciendo una sola consulta (camino viejo).
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

/* PostgREST falso: filtros eq/in/gt/gte, orden por VARIAS columnas, .range(), y tope de 1000
   filas por respuesta aunque se pidan más (como db-max-rows). Cuenta las consultas por tabla. */
function servidorFalso(filas){
  const s = { filas, consultas: [], fallarEnPagina: null };
  s.createClient = () => ({ from(tabla){
    const q = { _f: [], _orden: [], _rango: null, _tabla: tabla,
      select(){ return q; },
      eq(c, v){ q._f.push(r => r[c] === v); return q; },
      in(c, vs){ q._f.push(r => vs.includes(r[c])); return q; },
      gt(c, v){ q._f.push(r => String(r[c]) > String(v)); return q; },
      gte(c, v){ q._f.push(r => String(r[c]) >= String(v)); return q; },
      order(c, o){ q._orden.push({ c, asc: !o || o.ascending !== false }); return q; },
      range(d, h){ q._rango = [d, h]; return q; },
      limit(){ return q; }, not(){ return q; }, is(){ return q; },
      insert(){ return Promise.resolve({ error: null, status: 201 }); },
      upsert(){ return Promise.resolve({ error: null, status: 201 }); },
      delete(){ return q; },
      then(res, rej){
        s.consultas.push({ tabla, rango: q._rango });
        const n = s.consultas.filter(x => x.tabla === tabla && x.rango).length;
        if(tabla === 'eventos_sync' && s.fallarEnPagina && n === s.fallarEnPagina)
          return Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' }, status: 0 }).then(res, rej);
        let datos = tabla === 'eventos_sync' ? s.filas.filter(r => q._f.every(f => f(r))) : [];
        datos = datos.slice().sort((a, b) => {
          for(const o of q._orden){
            const x = a[o.c], y = b[o.c];
            if(x === y) continue;
            return (String(x) < String(y) ? -1 : 1) * (o.asc ? 1 : -1);
          }
          return 0;
        });
        const desde = q._rango ? q._rango[0] : 0;
        const hasta = q._rango ? Math.min(q._rango[1], desde + 999) : 999;
        return Promise.resolve({ data: datos.slice(desde, hasta + 1), error: null, status: 200 }).then(res, rej);
      }
    };
    return q;
  } });
  return s;
}

const p2 = n => String(n).padStart(2, '0');
// fechas de creado_en crecientes, con microsegundos como las reales
function creadoEn(i){ const d = new Date(Date.UTC(2026, 7, 1) + i * 60000); return d.toISOString().replace('Z', '000+00:00'); }
function evento(i, est, extra){
  return Object.assign({ id: 'id-' + String(i).padStart(6, '0'), event_id: null, establecimiento: est, dispositivo: 'otro-equipo',
    tipo: 'lluvia', potrero: est, detalle: { id: 'll_' + i, mm: 1, fecha: '2026-08-01' }, fecha_cliente: '01/08/2026', creado_en: creadoEn(i) }, extra || {});
}

async function levantar(archivo, servidor){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  // sin señal al arrancar: la sincronización la dispara la prueba
  let enLinea = false;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  win.eval(codigo + `
    ;window.__est = function(){ return estado; };
    window.__colaOrdenada = !!CONFIG.colaOrdenada;
    window.__EST = ESTABLECIMIENTO;
    window.__sincronizar = sincronizar;
    window.__statsMuertes = typeof calcularEstadisticasMuertes === 'function' ? calcularEstadisticasMuertes : null;
    window.__actualizarEstadoSync = actualizarEstadoSync;
  `);
  await esperar(60);
  return { win, errores, setEnLinea(v){ enLinea = v; } };
}

async function probarEquipoNuevo(archivo){
  console.log('\n--- equipo nuevo: 2.500 eventos, con un empate de creado_en en el borde de la página 1');
  const est = JSON.parse(fs.readFileSync(archivo, 'utf-8').match(/const CONFIG = (\{.*?\});\n/)[1]).establecimiento;
  const filas = [];
  for(let i = 0; i < 2500; i++) filas.push(evento(i, est));
  // filas 999 y 1000 (en orden creado_en+id) comparten el microsegundo: una queda en cada página
  filas[1000].creado_en = filas[999].creado_en;
  // ruido de otro establecimiento: no tiene que entrar
  for(let i = 0; i < 300; i++) filas.push(evento(5000 + i, 'otro_campo'));
  const s = servidorFalso(filas);
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  const textos = [];
  const el = app.win.document.getElementById('estado-sync');
  new app.win.MutationObserver(() => textos.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  app.setEnLinea(true);
  await app.win.__sincronizar(false);
  const lluvias = app.win.__est().lluvias || [];
  const ids = new Set(lluvias.map(l => l.id));
  chequear('aplica los 2.500 eventos (antes: 1000)', lluvias.length === 2500 && ids.size === 2500, 'lluvias: ' + lluvias.length + ', distintas: ' + ids.size);
  chequear('los dos eventos empatados en el borde entran, una vez cada uno', ids.has('ll_999') && ids.has('ll_1000'));
  chequear('nada del otro establecimiento', !lluvias.some(l => /^ll_5/.test(l.id) && Number(l.id.slice(3)) >= 5000));
  chequear('el cursor queda en el último evento', app.win.__est().ultimaSincronizacion === filas[2499].creado_en, app.win.__est().ultimaSincronizacion);
  const paginas = s.consultas.filter(c => c.tabla === 'eventos_sync' && c.rango).length;
  chequear('pidió 3 páginas de 1000', paginas === 3, 'páginas: ' + paginas);
  chequear('mientras bajaba mostró "Poniéndose al día…"', textos.some(t => /Poniéndose al día/.test(t)), JSON.stringify(textos.slice(0, 5)));

  console.log('\n--- la sincronización siguiente trae solo lo nuevo');
  for(let i = 2500; i < 2510; i++) s.filas.push(evento(i, est));
  const antes = s.consultas.length;
  await app.win.__sincronizar(false);
  chequear('entran los 10 nuevos', (app.win.__est().lluvias || []).length === 2510);
  chequear('con una sola página', s.consultas.slice(antes).filter(c => c.tabla === 'eventos_sync' && c.rango).length === 1);
}

async function probarPaginaQueFalla(archivo){
  console.log('\n--- si la página 2 falla, no se aplica nada ni se mueve el cursor (se reintenta entera)');
  const est = JSON.parse(fs.readFileSync(archivo, 'utf-8').match(/const CONFIG = (\{.*?\});\n/)[1]).establecimiento;
  const filas = [];
  for(let i = 0; i < 1500; i++) filas.push(evento(i, est));
  const s = servidorFalso(filas);
  s.fallarEnPagina = 2;
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  app.setEnLinea(true);
  await app.win.__sincronizar(false);
  chequear('no aplicó la mitad', (app.win.__est().lluvias || []).length === 0, 'lluvias: ' + (app.win.__est().lluvias || []).length);
  chequear('el cursor no se movió', !app.win.__est().ultimaSincronizacion, app.win.__est().ultimaSincronizacion);
  s.fallarEnPagina = null;
  await app.win.__sincronizar(false);
  chequear('al reintentar entran los 1.500', (app.win.__est().lluvias || []).length === 1500);
}

async function probarMuertes(archivo){
  if(!archivo.includes('-pc')) return;
  console.log('\n--- estadísticas de muertes con 1.200 muertes en la temporada');
  const est = JSON.parse(fs.readFileSync(archivo, 'utf-8').match(/const CONFIG = (\{.*?\});\n/)[1]).establecimiento;
  const filas = [];
  for(let i = 0; i < 1200; i++){
    filas.push(evento(i, est, { tipo: 'muerte', potrero: 'X', detalle: { categoria: 'Vacas', dueno: '', cantidad: 1 }, fecha_cliente: '15/08/2026' }));
  }
  const s = servidorFalso(filas);
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  if(!app.win.__statsMuertes){ chequear('existe calcularEstadisticasMuertes', false); return; }
  app.setEnLinea(true);
  const r = await app.win.__statsMuertes();
  const txt = JSON.stringify(r);
  chequear('cuenta las 1.200 muertes (antes: 1000)', /1200/.test(txt) && !/\b1000\b/.test(txt), txt.slice(0, 300));
}

async function probarSinFlag(archivo){
  console.log('\n--- sin el flag: una sola consulta, como antes');
  const est = JSON.parse(fs.readFileSync(archivo, 'utf-8').match(/const CONFIG = (\{.*?\});\n/)[1]).establecimiento;
  const filas = [];
  for(let i = 0; i < 20; i++) filas.push(evento(i, est));
  const s = servidorFalso(filas);
  const app = await levantar(archivo, s);
  if(app.errores.length){ chequear('carga sin errores', false, app.errores[0]); return; }
  app.setEnLinea(true);
  await app.win.__sincronizar(false);
  const ev = s.consultas.filter(c => c.tabla === 'eventos_sync');
  chequear('una consulta sin .range()', ev.length === 1 && !ev[0].rango, JSON.stringify(ev));
  chequear('y aplica los eventos', (app.win.__est().lluvias || []).length === 20);
}

(async () => {
  const archivos = process.argv.slice(2);
  let probados = 0;
  for(const a of archivos){
    console.log('\n=== ' + a + ' ===');
    const { win, errores } = await levantar(a, servidorFalso([]));
    if(errores.length){ chequear('carga sin errores', false, errores[0]); continue; }
    if(!win.__colaOrdenada && !process.env.FORZAR){ await probarSinFlag(a); continue; }
    probados++;
    await probarEquipoNuevo(a);
    await probarPaginaQueFalla(a);
    await probarMuertes(a);
  }
  if(!probados){ console.log('\nNingún archivo tiene CONFIG.colaOrdenada'); fallas++; }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
