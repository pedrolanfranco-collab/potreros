/*
 * Fase 3 de la auditoría, paso 4 (11/10/2026), parte A: una corrección se ubica por el `event_id` del
 * evento que corrige (`eventIdOriginal`), no por parecido (hallazgo 7). Cubre:
 *   (a) dos ventas idénticas (misma categoría/cantidad/dueño/fecha, distinto precio) llegadas de otro
 *       equipo: la corrección de la MÁS VIEJA tacha esa, la otra sigue vigente, y de estado.transacciones
 *       sale la del precio correcto;
 *   (b) un movimiento entre dos potreros: la corrección por id tacha las dos puntas (y no las de un
 *       movimiento idéntico posterior);
 *   (c) una corrección sin `eventIdOriginal` (evento viejo) o sobre un renglón sin `eventId` sigue
 *       funcionando por parecido;
 *   (d) un `eventIdOriginal` que apunta a un renglón ya eliminado no tacha otro renglón igual;
 *   (e) local: lo que se carga en este equipo deja `eventId` en el renglón (las dos puntas de un movimiento
 *       con el mismo), el mismo id viaja en el insert, y borrarlo manda `eventIdOriginal`;
 *   (f) agregar_guia / agregar_caravana por id.
 *
 * Uso: node probar_correccion_por_id.js la-vuelta-pc/index.html la-vuelta-movil/index.html maria-laura-pc/index.html ...
 *      (cada archivo se prueba solo, contra un servidor falso propio; Pone Chico no tiene potreros: se saltea)
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
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}


/* Un "otro dispositivo" que ya subió un evento: se agrega directo a la tabla con el event_id que se le dé. */
const crypto = require('crypto');
async function inyectar(servidor, estab, tipo, potrero, detalle, fecha, eventId){
  await dormir(6);
  servidor.filas.eventos_sync.push({
    event_id: eventId || crypto.randomUUID(), establecimiento: estab, dispositivo: 'celular-de-prueba', tipo, potrero, detalle,
    fecha_cliente: fecha, creado_en: new Date().toISOString()
  });
}
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stock = (win, p, key) => (win.__est().potreros[p].animales[key] || 0);
const historial = (win, p) => win.__est().potreros[p].historial;
const porEvento = (win, p, id) => historial(win, p).filter(h => h.eventId === id);
const vigentes = (win, p, tipo, fn) => historial(win, p).filter(h => h.tipo === tipo && !h.eliminado && (!fn || fn(h.origDatos || h.extra || {})));
const nuevoId = () => crypto.randomUUID();

function correccion(extra){
  return Object.assign({ historialId: 'h_otro_equipo' }, extra);
}

async function probarRecibidas(D, servidor){
  console.log('  -- correcciones que llegan de otro equipo');
  const estab = D.win.__establecimiento();
  const geo = D.win.__potrerosGeo();
  let p = null, key = null;
  for(const g of geo){
    const animales = D.win.__est().potreros[g.nombre].animales;
    const k = Object.keys(animales).find(x => animales[x] >= 12);
    if(k){ p = g.nombre; key = k; break; }
  }
  if(!p){ console.log('  (ningún potrero con stock suficiente -- se saltea)'); return null; }
  const q = geo.map(g => g.nombre).find(n => n !== p);
  const { cat, dueno: du } = D.win.partesClave(key);
  const hoy = D.win.fechaHoy();
  const sync = () => D.win.sincronizar(false);
  const trans = (cant) => D.win.__est().transacciones.filter(t => t.potrero === p && t.tipo === 'Venta' && t.cantidad === cant);

  // (a) dos ventas idénticas (distinto precio); se corrige la MÁS VIEJA
  const e1 = nuevoId(), e2 = nuevoId();
  await inyectar(servidor, estab, 'venta', p, { categoria: cat, dueno: du, cantidad: 2, precio: 800, contraparte: 'Uno', obs: null, guia: null }, hoy, e1);
  await inyectar(servidor, estab, 'venta', p, { categoria: cat, dueno: du, cantidad: 2, precio: 900, contraparte: 'Dos', obs: null, guia: null }, hoy, e2);
  await sync();
  chequear('(a) los renglones recibidos guardan el event_id de su evento', porEvento(D.win, p, e1).length === 1 && porEvento(D.win, p, e2).length === 1,
    JSON.stringify(historial(D.win, p).slice(0, 2).map(h => h.eventId)));
  chequear('(a) y las transacciones también', trans(2).filter(t => t.eventId === e1).length === 1 && trans(2).filter(t => t.eventId === e2).length === 1);
  const s0 = stock(D.win, p, key);
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'venta', accion: 'eliminar', fechaOriginal: hoy, eventIdOriginal: e1,
    reversar: { tipo: 'sumar', potrero: p, categoria: cat, dueno: du, cantidad: 2 } }), hoy);
  await sync();
  chequear('(a) la corrección por id tacha la venta MÁS VIEJA', porEvento(D.win, p, e1).length === 1 && porEvento(D.win, p, e1).every(h => h.eliminado));
  chequear('(a) la otra venta idéntica sigue vigente', porEvento(D.win, p, e2).length === 1 && porEvento(D.win, p, e2).every(h => !h.eliminado));
  chequear('(a) de las transacciones sale la del precio correcto (queda la de 900)', trans(2).length === 1 && trans(2)[0].precioUnitario === 900,
    JSON.stringify(trans(2).map(t => t.precioUnitario)));
  chequear('(a) el stock devuelve las 2 cabezas', stock(D.win, p, key) === s0 + 2, stock(D.win, p, key) + ' vs ' + (s0 + 2));

  // (d) un eventIdOriginal que apunta a un renglón YA eliminado no tacha otro igual
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'venta', accion: 'eliminar', fechaOriginal: hoy, eventIdOriginal: e1,
    reversar: { tipo: 'sumar', potrero: p, categoria: cat, dueno: du, cantidad: 2 } }), hoy);
  await sync();
  chequear('(d) una segunda corrección sobre el mismo id no tacha la otra venta idéntica', porEvento(D.win, p, e2).length === 1 && porEvento(D.win, p, e2).every(h => !h.eliminado));
  chequear('(d) ni le saca su transacción', trans(2).length === 1 && trans(2)[0].precioUnitario === 900);

  // (b) movimiento entre dos potreros: la corrección por id tacha las dos puntas, no las de uno idéntico
  const m1 = nuevoId(), m2 = nuevoId();
  const itemsMov = [{ categoria: cat, categoriaDestino: cat, dueno: du, cantidad: 3 }];
  await inyectar(servidor, estab, 'movimiento_multi', p, { destino: q, items: itemsMov, obs: 'primero' }, hoy, m1);
  await inyectar(servidor, estab, 'movimiento_multi', p, { destino: q, items: itemsMov, obs: 'segundo' }, hoy, m2);
  await sync();
  chequear('(b) las dos puntas del movimiento guardan el mismo eventId', porEvento(D.win, p, m1).length === 1 && porEvento(D.win, q, m1).length === 1
    && porEvento(D.win, p, m2).length === 1 && porEvento(D.win, q, m2).length === 1);
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'movimiento_multi', accion: 'eliminar', fechaOriginal: hoy, eventIdOriginal: m1,
    reversar: { tipo: 'mover_multi', origen: q, destino: p, items: itemsMov } }), hoy);
  await sync();
  chequear('(b) la corrección por id tacha las dos puntas del movimiento corregido',
    porEvento(D.win, p, m1).length === 1 && porEvento(D.win, p, m1).every(h => h.eliminado) && porEvento(D.win, q, m1).length === 1 && porEvento(D.win, q, m1).every(h => h.eliminado));
  chequear('(b) y deja vigentes las dos puntas del movimiento idéntico',
    porEvento(D.win, p, m2).length === 1 && porEvento(D.win, p, m2).every(h => !h.eliminado) && porEvento(D.win, q, m2).length === 1 && porEvento(D.win, q, m2).every(h => !h.eliminado));

  // (c) sin eventIdOriginal (evento viejo): por parecido, como siempre
  const c1 = nuevoId();
  await inyectar(servidor, estab, 'compra', p, { categoria: cat, dueno: du, cantidad: 7, precio: 500, contraparte: 'X', obs: null, guia: null }, hoy, c1);
  await sync();
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'compra', accion: 'eliminar', fechaOriginal: hoy,
    reversar: { tipo: 'restar', potrero: p, categoria: cat, dueno: du, cantidad: 7 } }), hoy);
  await sync();
  chequear('(c) una corrección sin eventIdOriginal sigue ubicando el renglón por parecido', vigentes(D.win, p, 'compra', od => od.cantidad === 7).length === 0
    && historial(D.win, p).some(h => h.tipo === 'compra' && h.eliminado && h.origDatos && h.origDatos.cantidad === 7));
  chequear('(c) y saca su transacción por parecido', D.win.__est().transacciones.filter(t => t.potrero === p && t.tipo === 'Compra' && t.cantidad === 7).length === 0);

  // (c') renglón guardado por una versión anterior (sin eventId) + corrección con eventIdOriginal: respaldo por parecido
  const c2 = nuevoId();
  await inyectar(servidor, estab, 'compra', p, { categoria: cat, dueno: du, cantidad: 8, precio: 500, contraparte: 'X', obs: null, guia: null }, hoy, c2);
  await sync();
  historial(D.win, p).filter(h => h.eventId === c2).forEach(h => { delete h.eventId; });
  D.win.__est().transacciones.forEach(t => { if(t.eventId === c2) delete t.eventId; });
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'compra', accion: 'eliminar', fechaOriginal: hoy, eventIdOriginal: c2,
    reversar: { tipo: 'restar', potrero: p, categoria: cat, dueno: du, cantidad: 8 } }), hoy);
  await sync();
  chequear('(c) un renglón sin eventId se tacha por parecido aunque la corrección traiga el id',
    vigentes(D.win, p, 'compra', od => od.cantidad === 8).length === 0
    && D.win.__est().transacciones.filter(t => t.potrero === p && t.tipo === 'Compra' && t.cantidad === 8).length === 0);

  // (f) agregar_guia y agregar_caravana por id
  const g1 = nuevoId(), g2 = nuevoId();
  await inyectar(servidor, estab, 'compra', p, { categoria: cat, dueno: du, cantidad: 4, precio: 500, contraparte: 'X', obs: null, guia: null }, hoy, g1);
  await inyectar(servidor, estab, 'compra', p, { categoria: cat, dueno: du, cantidad: 4, precio: 600, contraparte: 'Y', obs: null, guia: null }, hoy, g2);
  await sync();
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'compra', accion: 'agregar_guia', fechaOriginal: hoy, eventIdOriginal: g1,
    categoria: cat, cantidad: 4, dueno: du, guia: 'A123456' }), hoy);
  await sync();
  const datosDe = id => (porEvento(D.win, p, id)[0] || {}).origDatos || {};
  chequear('(f) agregar_guia por id le pone la guía a la compra corregida y no a la idéntica',
    datosDe(g1).guia === 'A123456' && !datosDe(g2).guia, datosDe(g1).guia + ' / ' + datosDe(g2).guia);
  const k1 = nuevoId(), k2 = nuevoId();
  await inyectar(servidor, estab, 'muerte', p, { categoria: cat, dueno: du, cantidad: 1, obs: null, caravana: null }, hoy, k1);
  await inyectar(servidor, estab, 'muerte', p, { categoria: cat, dueno: du, cantidad: 1, obs: null, caravana: null }, hoy, k2);
  await sync();
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'muerte', accion: 'agregar_caravana', fechaOriginal: hoy, eventIdOriginal: k1,
    categoria: cat, cantidad: 1, dueno: du, caravana: '12345678' }), hoy);
  await sync();
  chequear('(f) agregar_caravana por id va a la muerte corregida y no a la idéntica',
    datosDe(k1).caravana === '12345678' && !datosDe(k2).caravana, datosDe(k1).caravana + ' / ' + datosDe(k2).caravana);

  // (g) completar_datos por id: el detalle financiero va al renglón y a la transacción del evento corregido
  const f1 = nuevoId(), f2 = nuevoId();
  await inyectar(servidor, estab, 'venta', p, { categoria: cat, dueno: du, cantidad: 5, precio: 700, contraparte: 'Uno', obs: null, guia: null }, hoy, f1);
  await inyectar(servidor, estab, 'venta', p, { categoria: cat, dueno: du, cantidad: 5, precio: 700, contraparte: 'Dos', obs: null, guia: null }, hoy, f2);
  await sync();
  await inyectar(servidor, estab, 'correccion', p, correccion({ tipoOriginal: 'venta', accion: 'completar_datos', fechaOriginal: hoy, eventIdOriginal: f1,
    categoria: cat, cantidad: 5, dueno: du, fin: { importe: 3500, kilosBrutos: 2000 }, precio: 700, contraparte: 'Uno' }), hoy);
  await sync();
  const transDe = id => D.win.__est().transacciones.find(t => t.eventId === id);
  chequear('(g) completar_datos por id completa el renglón corregido y no el idéntico', !!datosDe(f1).fin && !datosDe(f2).fin);
  if(typeof D.win.parchearTransaccionCompraVenta === 'function') chequear('(g) y su transacción', !!transDe(f1) && !!transDe(f1).fin && !!transDe(f2) && !transDe(f2).fin);
  return { p, q, key, cat, du, hoy };
}

async function probarLocal(D, servidor, ctx){
  console.log('  -- lo que se carga en este equipo');
  const { p, q, key, cat, du } = ctx;
  const win = D.win;
  win.confirm = () => true; win.prompt = () => null;
  const ISOhoy = win.fechaISOHoy();
  const hayCV = typeof win.registrarCompraVenta === 'function';
  const eventos = () => servidor.filas.eventos_sync;
  if(hayCV){
    const ok = win.registrarCompraVenta({ potrero: p, tipoOp: 'Venta', cat, dueno: du, cant: 6, fechaISO: ISOhoy, contraparte: 'Local', obs: '', precio: 750 });
    await dormir(40);
    const h = historial(win, p).find(x => x.tipo === 'venta' && x.extra && x.extra.cantidad === 6);
    chequear('(e) la venta cargada acá deja un eventId (UUID) en el renglón', ok && !!h && REGEX_UUID.test(h.eventId || ''), h && h.eventId);
    const t = win.__est().transacciones.find(x => x.potrero === p && x.tipo === 'Venta' && x.cantidad === 6);
    chequear('(e) y en la transacción', !!t && !!h && REGEX_UUID.test(h.eventId || '') && t.eventId === h.eventId);
    const ev = eventos().find(f => f.tipo === 'venta' && f.detalle.cantidad === 6 && f.detalle.contraparte === 'Local');
    chequear('(e) el insert viaja con ese mismo event_id', !!ev && !!h && ev.event_id === h.eventId, ev && ev.event_id);
    if(typeof win.agregarGuiaCompraventa === 'function' && h){
      win.prompt = () => 'B654321';
      win.agregarGuiaCompraventa(h.id);
      win.prompt = () => null;
      await dormir(40);
      const g = eventos().find(f => f.tipo === 'correccion' && f.detalle.accion === 'agregar_guia' && f.detalle.guia === 'B654321');
      chequear('(e) agregar guía manda eventIdOriginal', !!g && !!h.eventId && g.detalle.eventIdOriginal === h.eventId, g && JSON.stringify(g.detalle));
    }
    win.borrarHistorial(h.id);
    await dormir(40);
    const corr = eventos().find(f => f.tipo === 'correccion' && f.detalle.accion === 'eliminar' && f.detalle.tipoOriginal === 'venta' && f.detalle.eventIdOriginal && f.detalle.eventIdOriginal === h.eventId);
    chequear('(e) borrarla manda eventIdOriginal = el event_id de la venta', !!corr, JSON.stringify(eventos().filter(f => f.tipo === 'correccion').map(f => f.detalle.eventIdOriginal)));
    chequear('(e) y le saca la transacción', !win.__est().transacciones.some(x => x.potrero === p && x.tipo === 'Venta' && x.cantidad === 6));
  }

  // movimiento por el formulario: las dos puntas con el mismo eventId
  win.seleccionarPotrero(p);
  win.mostrarFormulario(p, 'mover');
  const d = win.document;
  d.getElementById('f-destino').value = q;
  const chk = Array.from(d.querySelectorAll('.mov-check')).find(c => c.dataset.key === key);
  chk.checked = true;
  d.querySelector(`.mov-cant[data-key="${key}"]`).value = '2';
  d.getElementById('f-confirmar').click();
  await dormir(40);
  const evMov = eventos().filter(f => f.tipo === 'movimiento_multi' && f.potrero === p && f.detalle.destino === q).pop();
  const hp = historial(win, p).find(h => h.tipo === 'movimiento_multi' && h.extra && h.extra.destino === q);
  const hq = historial(win, q).find(h => h.tipo === 'movimiento_multi' && h.extra && h.extra.potrero === p);
  chequear('(e) las dos puntas de un movimiento local llevan el mismo eventId', !!hp && !!hq && REGEX_UUID.test(hp.eventId || '') && hp.eventId === hq.eventId);
  chequear('(e) y es el event_id del insert', !!evMov && !!hp && evMov.event_id === hp.eventId);
  win.borrarHistorial(hp.id);
  await dormir(40);
  const corrMov = eventos().find(f => f.tipo === 'correccion' && f.detalle.tipoOriginal === 'movimiento_multi' && !!hp.eventId && f.detalle.eventIdOriginal === hp.eventId);
  chequear('(e) borrar el movimiento manda eventIdOriginal', !!corrMov);
  chequear('(e) y tacha las dos puntas', hp.eliminado && hq.eliminado);
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const D = await levantar(archivo, servidor);
  chequear('la app carga sin errores', D.errores.length === 0, D.errores.join(' | '));
  if(D.errores.length) return;
  if(!D.win.__potrerosGeo().length){ console.log('  (sin potreros seedeados -- se saltea)'); return; }
  const ctx = await probarRecibidas(D, servidor);
  if(ctx) await probarLocal(D, servidor, ctx);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
