/*
 * Fase 3 de la auditoría, paso 4 (11/10/2026), parte B: versión en cada evento y tipos desconocidos
 * (hallazgo 8). Una versión vieja de la app descartaba en silencio los tipos que no conocía y el cursor
 * avanzaba igual: un tipo nuevo no se reaplicaba nunca en esos equipos. Ahora:
 *   - un tipo (o una acción de corrección) que esta versión no conoce se guarda en
 *     estado.eventosDesconocidos (tope 500, sin duplicar por event_id), sin estacionarlo ni descartarlo;
 *   - al sincronizar, los que la versión actual ya conoce se aplican en orden de creado_en y salen de la lista;
 *   - todo evento enviado lleva detalle.v = "<variante>-<versión>" (pc-2.07, movil-2.06, campo-1.49), solo diagnóstico;
 *   - TIPOS_EVENTO_CONOCIDOS coincide con los tipos documentados en docs/eventos.md.
 *
 * Uso: node probar_eventos_desconocidos.js la-vuelta-pc/index.html la-vuelta-movil/index.html la-vuelta-movil-campo/index.html ...
 */
const fs = require('fs');
const path = require('path');
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
          order(col,opts){ if(!q._orden) q._orden = {col, asc: !opts || opts.ascending!==false}; return q; }, range(){ return q; }, /* Fase 3: el primer orden manda (el desempate por id se ignora) y .range() devuelve todo */
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
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__establecimiento = function(){ return ESTABLECIMIENTO; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
      window.__config = function(){ return CONFIG; };
      window.__tiposConocidos = function(){ return TIPOS_EVENTO_CONOCIDOS; };
      window.__accionesConocidas = function(){ return ACCIONES_CORRECCION_CONOCIDAS; };
      window.__versionApp = function(){ return VERSION_APP; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}


const crypto = require('crypto');
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RAIZ = path.join(__dirname, '..');
let reloj = Date.now();
function inyectar(servidor, estab, tipo, potrero, detalle, fecha, extra){
  reloj += 1000;
  const fila = Object.assign({
    event_id: crypto.randomUUID(), establecimiento: estab, dispositivo: 'celular-de-prueba', tipo, potrero, detalle,
    fecha_cliente: fecha, creado_en: new Date(reloj).toISOString()
  }, extra || {});
  servidor.filas.eventos_sync.push(fila);
  return fila;
}

function tiposDocumentados(){
  const d = fs.readFileSync(path.join(RAIZ, 'docs', 'eventos.md'), 'utf-8');
  const bloque = /<!-- tipos:start -->([\s\S]*?)<!-- tipos:end -->/.exec(d);
  const tipos = new Set();
  const re = /^\|\s*`([a-z_]+)`\s*\|/gm;
  let m;
  while((m = re.exec(bloque[1]))) if(m[1] !== 'tipo') tipos.add(m[1]);
  return tipos;
}

/* variante de un archivo: pc / movil / campo, y la versión que dice su sw.js */
function variante(archivo){
  const carpeta = path.basename(path.dirname(archivo));
  const v = /-movil-campo$/.test(carpeta) ? 'campo' : /-movil$/.test(carpeta) ? 'movil' : 'pc';
  const sw = fs.readFileSync(path.join(path.dirname(archivo), 'sw.js'), 'utf-8');
  const m = /const CACHE = '([^']+)-v([0-9.]+)'/.exec(sw);
  return { v, version: m && m[2], cache: m && m[1] + '-v' + m[2] };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const info = variante(archivo);
  const servidor = crearServidor();
  const D = await levantar(archivo, servidor);
  chequear('la app carga sin errores', D.errores.length === 0, D.errores.join(' | '));
  if(D.errores.length) return;
  const win = D.win;
  win.confirm = () => true;
  const estab = win.__establecimiento();
  const hoy = win.fechaHoy();
  const sync = () => win.sincronizar(false);

  // --- tipos conocidos: lo que documenta docs/eventos.md es exactamente lo que el receptor conoce
  let conocidos = null, acciones = null;
  try { conocidos = win.__tiposConocidos(); acciones = win.__accionesConocidas(); } catch(e){}
  chequear('existe TIPOS_EVENTO_CONOCIDOS y ACCIONES_CORRECCION_CONOCIDAS', !!conocidos && !!acciones && conocidos.size > 30);
  if(conocidos){
    const doc = tiposDocumentados();
    const faltan = [...doc].filter(t => !conocidos.has(t));
    const sobran = [...conocidos].filter(t => !doc.has(t));
    chequear('todo tipo documentado en docs/eventos.md está en TIPOS_EVENTO_CONOCIDOS', faltan.length === 0, 'faltan: ' + faltan.join(', '));
    chequear('y no hay tipos de más (los dos se mantienen juntos)', sobran.length === 0, 'sobran: ' + sobran.join(', '));
    const acc = ['eliminar', 'editar', 'anular_traslado', 'reclasificar', 'agregar_caravana', 'completar_datos', 'agregar_guia', 'vecino_eliminar'];
    chequear('ACCIONES_CORRECCION_CONOCIDAS tiene las 8 acciones', acc.every(a => acciones.has(a)) && acciones.size === acc.length, [...acciones].join(','));
  }

  // --- un tipo futuro (con el establecimiento como "potrero", como lluvia) se guarda aparte
  const futuro = inyectar(servidor, estab, 'tipo_futuro', estab, { algo: 1 }, hoy);
  const futuroSinPotrero = inyectar(servidor, estab, 'otro_tipo_futuro', 'PotreroQueNoExiste', { algo: 2 }, hoy);
  const accionFutura = inyectar(servidor, estab, 'correccion', Object.keys(win.__est().potreros)[0] || estab,
    { tipoOriginal: 'venta', accion: 'accion_futura', fechaOriginal: hoy, reversar: { tipo: 'sumar', potrero: 'x', categoria: 'Vacas', cantidad: 1 } }, hoy);
  const stockAntes = JSON.stringify(Object.keys(win.__est().potreros).map(p => win.__est().potreros[p].animales));
  await sync();
  const lista = () => win.__est().eventosDesconocidos || [];
  chequear('el tipo futuro queda en estado.eventosDesconocidos', lista().some(r => r.event_id === futuro.event_id), JSON.stringify(lista().map(r => r.tipo)));
  chequear('también el que apunta a un potrero que no existe (no se estaciona)', lista().some(r => r.event_id === futuroSinPotrero.event_id)
    && !((win.__est().pendientesPotrero || {})['PotreroQueNoExiste']));
  chequear('y una corrección con una acción que esta versión no conoce', lista().some(r => r.event_id === accionFutura.event_id));
  chequear('el cursor avanzó igual hasta el último evento', win.__est().ultimaSincronizacion === accionFutura.creado_en, win.__est().ultimaSincronizacion);
  chequear('no se tocó el stock ni se agregó nada a pendientesPotrero',
    stockAntes === JSON.stringify(Object.keys(win.__est().potreros).map(p => win.__est().potreros[p].animales))
    && Object.keys(win.__est().pendientesPotrero || {}).length === 0);
  // mismo evento dos veces: no se duplica
  win.aplicarEventoRemoto(JSON.parse(JSON.stringify(futuro)));
  chequear('aplicar el mismo evento desconocido otra vez no lo duplica', lista().filter(r => r.event_id === futuro.event_id).length === 1);
  // tope de 500
  for(let i = 0; i < 520; i++) win.aplicarEventoRemoto({ event_id: crypto.randomUUID(), tipo: 'masivo_' + i, potrero: estab, dispositivo: 'x', detalle: {}, creado_en: new Date(reloj).toISOString(), fecha_cliente: hoy });
  chequear('la lista tiene un tope de 500', lista().length <= 500 && lista().length >= 400, String(lista().length));
  win.__est().eventosDesconocidos = lista().filter(r => r.event_id === futuro.event_id || r.event_id === futuroSinPotrero.event_id || r.event_id === accionFutura.event_id);

  // --- un evento de tipo conocido guardado como desconocido por una versión vieja se aplica en la sincronización siguiente
  const geo = win.__potrerosGeo();
  const antes = lista().length;
  const llu = { event_id: crypto.randomUUID(), establecimiento: estab, dispositivo: 'celular-de-prueba', tipo: 'lluvia', potrero: estab,
    detalle: { id: 'lluvia-guardada', mm: 12 }, fecha_cliente: hoy, creado_en: new Date(reloj - 5000).toISOString() };
  const guardadas = [llu];
  let nac = null, p = null, key = null;
  if(geo.length){
    p = geo[0].nombre;
    key = win.claveAnimal('Terneros', '');
    nac = { event_id: crypto.randomUUID(), establecimiento: estab, dispositivo: 'celular-de-prueba', tipo: 'nacimiento', potrero: p,
      detalle: { categoria: 'Terneros', dueno: '', cantidad: 3 }, fecha_cliente: hoy, creado_en: new Date(reloj - 4000).toISOString() };
    guardadas.push(nac);
  }
  win.__est().eventosDesconocidos = lista().concat(guardadas);
  const t0 = nac ? (win.__est().potreros[p].animales[key] || 0) : 0;
  await sync();
  chequear('el evento de tipo conocido se aplica en la sincronización siguiente', (win.__est().lluvias || []).some(l => l.id === 'lluvia-guardada'));
  if(nac) chequear('y toca el stock como cualquier evento recibido', (win.__est().potreros[p].animales[key] || 0) === t0 + 3, String(win.__est().potreros[p].animales[key]) + ' vs ' + (t0 + 3));
  chequear('sale de la lista de desconocidos', !lista().some(r => r.event_id === llu.event_id || (nac && r.event_id === nac.event_id)));
  chequear('los que siguen siendo desconocidos se quedan', lista().length === antes, lista().length + ' vs ' + antes);

  // --- una corrección con una acción conocida pero guardada antes también se aplica
  // --- todo evento enviado lleva detalle.v = variante-versión
  const detalle = { id: 'prueba-v', mm: 3 };
  await win.enviarEvento('lluvia', estab, detalle, hoy);
  await dormir(30);
  const enviado = servidor.filas.eventos_sync.find(f => f.tipo === 'lluvia' && f.detalle.id === 'prueba-v');
  chequear('el evento enviado existe', !!enviado);
  const esperado = info.v + '-' + info.version;
  chequear(`detalle.v = "${esperado}" (variante y versión de esta app)`, !!enviado && enviado.detalle.v === esperado, enviado && enviado.detalle.v);
  chequear('el detalle del que llama no se modifica', detalle.v === undefined);
  if(info.v !== 'pc') chequear('en las móviles conserva además el usuario', !!enviado && 'usuario' in enviado.detalle);
  let versionApp = null;
  try { versionApp = win.__versionApp(); } catch(e){}
  chequear('VERSION_APP coincide', versionApp === esperado, String(versionApp));

  // todos los tipos de evento llevan v (un movimiento y una corrección también)
  if(geo.length && info.v === 'pc'){
    const q = geo.length > 1 ? geo[1].nombre : p;
    win.enviarEvento('nacimiento', p, { categoria: 'Terneros', dueno: '', cantidad: 1 }, hoy);
    win.enviarEvento('correccion', p, { tipoOriginal: 'nacimiento', accion: 'reclasificar', fechaOriginal: hoy, obs: 'x' }, hoy);
    await dormir(30);
    const todos = servidor.filas.eventos_sync.filter(f => f.dispositivo !== 'celular-de-prueba');
    chequear('todos los eventos enviados por la app llevan v', todos.length >= 3 && todos.every(f => f.detalle.v === esperado), todos.map(f => f.tipo + ':' + f.detalle.v).join(' '));
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
