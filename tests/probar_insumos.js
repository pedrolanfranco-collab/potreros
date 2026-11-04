/*
 * Pantalla "🧴 Insumos" (3/11/2026): stock de productos veterinarios de La Vuelta y María Laura (CONFIG.insumos).
 * Con un Supabase simulado (RPC stock_insumos_app, tabla insumos_ajustes con uid único, productos_catalogo):
 *  - abre desde Herramientas y muestra el stock de SU campo con los colores correctos (verde / amarillo / rojo "revisar");
 *  - sin señal muestra la copia guardada con el aviso "Sin señal — datos del dd/mm hh:mm" y no consulta nada;
 *  - un conteo cargado sin señal queda "en cola" y, al volver la señal (por la sincronización existente), se manda UNA vez con uid;
 *  - un reintento después de una respuesta perdida no duplica (23505 cuenta como enviado);
 *  - el pasaje manda el destino correcto (el otro campo) y nunca inserta pasaje_entrada;
 *  - las validaciones (producto, cantidad > 0, ajuste distinto de 0);
 *  - Pone Chico no muestra Insumos ni consulta nada de Insumos.
 * Uso: node tests/probar_insumos.js <index.html> [<index.html> ...]
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function esperarHasta(fn, ms){
  const fin = Date.now() + (ms || 1500);
  while(Date.now() < fin){ if(fn()) return true; await esperar(15); }
  return !!fn();
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hoyISO = () => { const d = new Date(); const dos = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); };

/* Supabase falso: RPC stock_insumos_app, insumos_ajustes (uid único, como el UNIQUE real), productos_catalogo. */
function servidorFalso(){
  const s = {
    stock: [], catalogo: [
      { producto: 'Ivermectina 1%', tipo: 'Antiparasitario', categoria: 'Vacuno', valor_dosis_ml: 0.5, dias_retiro: 35 },
      { producto: 'Aftosa Bivalente', tipo: 'Vacuna', categoria: 'Vacuno', valor_dosis_ml: 2, dias_retiro: 0 },
      { producto: 'Oxitetraciclina LA', tipo: 'Antibiótico', categoria: 'Vacuno', valor_dosis_ml: 1, dias_retiro: 28 }
    ],
    filas: [], intentos: [], rpcLlamadas: 0, rpcNombres: [], tablasInsumos: 0,
    rpcError: null, modo: 'ok'   // modo: 'ok' | 'caido' (sin respuesta) | 'respuesta_perdida' (llega al servidor pero la respuesta se pierde)
  };
  s.insertar = (row) => {
    s.intentos.push(JSON.parse(JSON.stringify(row)));
    if(s.modo === 'caido') return Promise.resolve({ error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
    const ya = s.filas.some(f => f.uid === row.uid);
    if(s.modo === 'respuesta_perdida'){
      if(!ya) s.filas.push(JSON.parse(JSON.stringify(row)));
      return Promise.resolve({ error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
    }
    if(ya) return Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint "insumos_ajustes_uid_key"' }, status: 409 });
    s.filas.push(JSON.parse(JSON.stringify(row)));
    return Promise.resolve({ error: null, status: 201 });
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
  const cliente = {
    rpc(nombre){
      servidor.rpcNombres.push(nombre);
      if(nombre === 'verificar_clave') return Promise.resolve({ data: true, error: null });
      if(nombre === 'stock_insumos_app'){
        servidor.rpcLlamadas++;
        if(servidor.rpcError) return Promise.resolve({ data: null, error: { message: servidor.rpcError, code: 'PGRST301' } });
        return Promise.resolve({ data: JSON.parse(JSON.stringify(servidor.stock)), error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'rpc desconocida' } });
    },
    from(tabla){
      if(tabla === 'insumos_ajustes'){
        servidor.tablasInsumos++;
        return { insert: (row) => servidor.insertar(row) };
      }
      const datos = tabla === 'productos_catalogo' ? JSON.parse(JSON.stringify(servidor.catalogo)) : [];
      const q = new Proxy({}, { get(t, prop){
        if(prop === 'insert') return () => Promise.resolve({ error: null });
        if(prop === 'then') return (res, rej) => Promise.resolve({ data: datos, error: null }).then(res, rej);
        return () => q;
      } });
      return q;
    }
  };
  win.supabase = { createClient(){ return cliente; } };
  let enLinea = true;
  Object.defineProperty(win.navigator, 'onLine', { get(){ return enLinea; }, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  // sin esto la app abre sola "Clave del campo" y "¿Quién sos?"
  const est = (/"establecimiento":"([a-z_]+)"/.exec(html) || [])[1];
  win.localStorage.setItem('clave_campo_' + est, 'clavedeprueba1');
  win.localStorage.setItem('potreros_nombre_usuario', 'Tester');
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  win.eval(codigo + '\n;window.__cfg = { insumos: !!CONFIG.insumos, est: ESTABLECIMIENTO };');
  await esperar(80);
  const $ = id => win.document.getElementById(id);
  const cfg = win.__cfg;
  const guardado = () => { try{ return JSON.parse(win.localStorage.getItem(cfg.est + '_insumos_v1')) || null; }catch(e){ return null; } };
  const setEnLinea = (v) => { enLinea = v; win.dispatchEvent(new win.Event(v ? 'online' : 'offline')); };
  const click = id => $(id).click();
  const item = prod => Array.from(win.document.querySelectorAll('#ins-lista .ins-item')).find(e => e.getAttribute('data-producto') === prod);
  const abrir = async () => { click('btn-insumos'); await esperar(20); };
  const llenar = (id, v) => { $(id).value = v; $(id).dispatchEvent(new win.Event('input', { bubbles: true })); $(id).dispatchEvent(new win.Event('change', { bubbles: true })); };
  // cerrarTodo: sin señal para siempre, así los temporizadores de esta página (sincronización cada 3 min, etc.) ya no hacen nada.
  // No se usa win.close(): deja `document` en undefined y una continuación asíncrona pendiente tiraría una excepción que mata el proceso.
  return { win, errores, cfg, $, guardado, setEnLinea, click, item, abrir, llenar, cerrarTodo(){ enLinea = false; } };
}

const STOCK_LV = (est) => [
  { establecimiento: est, producto: 'Ivermectina 1%', fecha_conteo: '2026-09-15', inicial_ml: 2000, entradas_ml: 0, salidas_ml: 500, stock_ml: 1500, estado: 'ok' },
  { establecimiento: est, producto: 'Aftosa Bivalente', fecha_conteo: '2026-09-15', inicial_ml: 2000, entradas_ml: 0, salidas_ml: 1850, stock_ml: 150, estado: 'ok' },
  { establecimiento: est, producto: 'Producto Chico', fecha_conteo: '2026-10-01', inicial_ml: 60, entradas_ml: 0, salidas_ml: 10, stock_ml: 50, estado: 'ok' },
  { establecimiento: est, producto: 'Oxitetraciclina LA', fecha_conteo: '2026-08-20', inicial_ml: 1000, entradas_ml: 0, salidas_ml: 1000, stock_ml: 0, estado: 'sin stock' },
  { establecimiento: est, producto: 'Producto Negativo', fecha_conteo: '2026-08-20', inicial_ml: 100, entradas_ml: 0, salidas_ml: 130, stock_ml: -30, estado: 'NEGATIVO - revisar' },
  { establecimiento: est === 'la_vuelta' ? 'maria_laura' : 'la_vuelta', producto: 'Solo Del Otro Campo', fecha_conteo: '2026-09-01', inicial_ml: 1000, entradas_ml: 0, salidas_ml: 0, stock_ml: 1000, estado: 'ok' }
];

async function probarSoloPoneChico(archivo){
  console.log('\n--- Pone Chico: no muestra Insumos ni consulta nada');
  const s = servidorFalso();
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  chequear('CONFIG.insumos es false', t.cfg.insumos === false);
  const b = t.$('btn-insumos');
  chequear('el botón Insumos queda oculto', !b || b.style.display === 'none', b && b.style.display);
  t.setEnLinea(false); t.setEnLinea(true);
  await esperar(300);
  chequear('no se llamó a stock_insumos_app', s.rpcLlamadas === 0, String(s.rpcLlamadas));
  chequear('no se tocó insumos_ajustes', s.tablasInsumos === 0 && s.intentos.length === 0);
  chequear('no quedó nada de Insumos guardado en el equipo', t.win.localStorage.getItem('pone_chico_insumos_v1') === null);
  const hay = t.win.document.getElementById('modal-insumos');
  chequear('la ventana de Insumos no está abierta', !hay || hay.style.display === 'none');
  t.cerrarTodo();
}

async function probarStockYColores(archivo, est){
  console.log('\n--- abre desde Herramientas y muestra el stock de su campo con los colores correctos');
  const s = servidorFalso(); s.stock = STOCK_LV(est);
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  const b = t.$('btn-insumos');
  chequear('el botón Insumos se ve en Herramientas', !!b && b.style.display !== 'none', b && b.style.display);
  const antes = s.rpcLlamadas;
  await t.abrir();
  chequear('se abre la ventana', t.$('modal-insumos').style.display === 'flex');
  const ok = await esperarHasta(() => t.item('Ivermectina 1%'), 1500);
  chequear('se consultó el stock al abrir', s.rpcLlamadas > antes, String(s.rpcLlamadas - antes));
  chequear('aparecen los productos', ok && !!t.item('Aftosa Bivalente'));
  const cls = p => { const e = t.item(p); return e && e.getAttribute('data-clase'); };
  const txt = p => { const e = t.item(p); return e ? e.textContent : ''; };
  chequear('stock normal: verde', cls('Ivermectina 1%') === 'verde', cls('Ivermectina 1%'));
  chequear('menos del 20 % de lo inicial: amarillo', cls('Aftosa Bivalente') === 'amarillo', cls('Aftosa Bivalente'));
  chequear('menos de 100 ml: amarillo', cls('Producto Chico') === 'amarillo', cls('Producto Chico'));
  chequear('"sin stock": rojo', cls('Oxitetraciclina LA') === 'rojo' && /sin stock/i.test(txt('Oxitetraciclina LA')), cls('Oxitetraciclina LA') + ' / ' + txt('Oxitetraciclina LA'));
  chequear('negativo: rojo con el texto "revisar"', cls('Producto Negativo') === 'rojo' && /revisar/i.test(txt('Producto Negativo')), cls('Producto Negativo') + ' / ' + txt('Producto Negativo'));
  chequear('no aparece el producto del otro campo', !t.item('Solo Del Otro Campo'));
  chequear('muestra el stock en ml', /1\.500 ml/.test(txt('Ivermectina 1%')), txt('Ivermectina 1%'));
  chequear('muestra la fecha del último conteo', /15\/09\/2026/.test(txt('Ivermectina 1%')), txt('Ivermectina 1%'));
  chequear('sin envase conocido, solo ml (sin frascos)', !/frasco/i.test(txt('Ivermectina 1%')), txt('Ivermectina 1%'));
  const orden = Array.from(t.win.document.querySelectorAll('#ins-lista .ins-item')).map(e => e.getAttribute('data-clase'));
  chequear('los rojos van primero, después amarillos y verdes', JSON.stringify(orden) === JSON.stringify(orden.slice().sort((a, b) => ({rojo:0,amarillo:1,verde:2})[a] - ({rojo:0,amarillo:1,verde:2})[b])), orden.join(','));
  chequear('aviso "Actualizado" con la hora', /Actualizado \d\d\/\d\d \d\d:\d\d/.test(t.$('ins-aviso').textContent), t.$('ins-aviso').textContent);
  const g = t.guardado();
  chequear('el resultado quedó guardado en el equipo con su hora y solo de este campo', !!g && !!g.stock && !!g.stock.hora && g.stock.filas.length === 5 && g.stock.filas.every(f => f.establecimiento === est), JSON.stringify(g && g.stock && g.stock.filas.length));
  t.click('insumos-cerrar-x');
  chequear('la X cierra la ventana', t.$('modal-insumos').style.display === 'none');
  t.cerrarTodo();
}

async function probarSinSenalMuestraCache(archivo, est){
  console.log('\n--- sin señal muestra la copia guardada (y no consulta)');
  const s = servidorFalso(); s.stock = STOCK_LV(est);
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.item('Ivermectina 1%'), 1500);
  t.click('insumos-cerrar');
  t.setEnLinea(false);
  await esperar(30);
  const antes = s.rpcLlamadas;
  s.stock = [];   // si consultara, vería la lista vacía
  await t.abrir();
  await esperar(60);
  chequear('no consultó sin señal', s.rpcLlamadas === antes, String(s.rpcLlamadas - antes));
  chequear('sigue mostrando los productos guardados', !!t.item('Ivermectina 1%') && !!t.item('Producto Negativo'));
  const av = t.$('ins-aviso').textContent;
  chequear('aviso "Sin señal — datos del dd/mm hh:mm"', /^Sin señal — datos del \d\d\/\d\d \d\d:\d\d$/.test(av), av);
  chequear('el aviso queda en tono de advertencia', t.$('ins-aviso').className.indexOf('ins-offline') >= 0);
  t.click('insumos-cerrar');
  // con señal pero el servidor da error: copia + aviso de error con la hora
  s.stock = STOCK_LV(est);
  s.rpcError = 'JWT expired';   // antes de volver la señal: la sincronización que dispara no puede pisar la copia
  t.setEnLinea(true);
  await esperar(120);
  await t.abrir();
  await esperarHasta(() => /No se pudo actualizar/.test(t.$('ins-aviso').textContent), 1500);
  chequear('con señal y error del servidor: copia + aviso con la hora', /No se pudo actualizar \(JWT expired\) — datos del \d\d\/\d\d \d\d:\d\d/.test(t.$('ins-aviso').textContent) && !!t.item('Ivermectina 1%'), t.$('ins-aviso').textContent);
  t.cerrarTodo();
}

async function probarSincronizacionRefresca(archivo, est){
  console.log('\n--- la sincronización periódica refresca el stock guardado');
  const s = servidorFalso(); s.stock = [];
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await esperar(80);
  s.stock = STOCK_LV(est);
  const antes = s.rpcLlamadas;
  t.setEnLinea(false); t.setEnLinea(true);   // dispara sincronizar() como cuando vuelve la señal
  await esperarHasta(() => (t.guardado() && t.guardado().stock && t.guardado().stock.filas.length === 5), 2000);
  chequear('sincronizar() consultó el stock', s.rpcLlamadas > antes, String(s.rpcLlamadas - antes));
  chequear('y lo dejó guardado con la ventana cerrada', !!t.guardado() && t.guardado().stock.filas.length === 5);
  t.cerrarTodo();
}

async function probarConteoOfflineYCola(archivo, est){
  console.log('\n--- un conteo cargado sin señal queda en cola y se manda UNA vez, con uid, al volver la señal');
  const s = servidorFalso(); s.stock = STOCK_LV(est);
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.item('Ivermectina 1%'), 1500);   // así queda guardado el catálogo para usarlo sin señal
  t.click('insumos-cerrar');
  t.setEnLinea(false);
  await esperar(30);
  await t.abrir();
  t.click('ins-nuevo');
  await esperar(20);
  chequear('se abre el formulario', t.$('modal-insumos-form').style.display === 'flex');
  chequear('la fecha viene con hoy', t.$('ins-fecha').value === hoyISO(), t.$('ins-fecha').value);
  chequear('el destino está oculto si no es un pasaje', t.$('ins-fila-destino').style.display === 'none');
  const opciones = Array.from(t.win.document.querySelectorAll('#ins-productos-lista option')).map(o => o.value);
  chequear('el selector trae los productos del catálogo (guardado, sin señal)', opciones.includes('Ivermectina 1%') && opciones.includes('Aftosa Bivalente') && opciones.includes('Oxitetraciclina LA'), opciones.join('|'));
  t.llenar('ins-tipo', 'inicial');
  t.llenar('ins-producto', 'ivermectina 1%');          // minúsculas: se toma el nombre exacto del catálogo
  t.llenar('ins-frascos', '3');
  t.llenar('ins-ml-frasco', '500');
  chequear('la ayuda frascos × ml completa la cantidad', t.$('ins-cantidad').value === '1500', t.$('ins-cantidad').value);
  t.llenar('ins-nota', 'conteo del galpón');
  const intentosAntes = s.intentos.length;
  t.click('ins-guardar');
  await esperar(60);
  chequear('sin señal no se intentó mandar nada', s.intentos.length === intentosAntes && s.filas.length === 0, String(s.intentos.length));
  const g = t.guardado();
  chequear('quedó una carga en la cola guardada, con uid', !!g && g.cola.length === 1 && UUID.test(g.cola[0].uid), JSON.stringify(g && g.cola));
  chequear('la ventana de stock la muestra "en cola"', /en cola/i.test(t.$('ins-cola').textContent) && /Ivermectina 1%/.test(t.$('ins-cola').textContent), t.$('ins-cola').textContent);
  chequear('el formulario se cerró', t.$('modal-insumos-form').style.display === 'none');
  const uid = g && g.cola[0] && g.cola[0].uid;
  // vuelve la señal: la sincronización existente vacía la cola
  t.setEnLinea(true);
  await esperarHasta(() => s.filas.length === 1, 2500);
  await esperarHasta(() => t.guardado().cola.length === 0, 1500);
  chequear('al volver la señal se mandó una sola vez', s.filas.length === 1 && s.intentos.length === intentosAntes + 1, s.filas.length + ' filas, ' + (s.intentos.length - intentosAntes) + ' intentos');
  const f = s.filas[0] || {};
  chequear('la fila lleva el uid de la cola', f.uid === uid && UUID.test(f.uid || ''), f.uid);
  chequear('tipo inicial, cantidad 1500 ml, producto exacto del catálogo', f.tipo === 'inicial' && f.cantidad_ml === 1500 && f.producto === 'Ivermectina 1%', JSON.stringify(f));
  chequear('con establecimiento, fecha de hoy, nota, dispositivo y autor', f.establecimiento === est && f.fecha === hoyISO() && f.nota === 'conteo del galpón' && !!f.dispositivo && f.autor === 'Tester', JSON.stringify(f));
  chequear('un conteo no lleva destino', !('destino' in f));
  chequear('la cola quedó vacía', t.guardado().cola.length === 0);
  await esperar(100);
  chequear('ya no figura "en cola"', !/en cola/i.test(t.$('ins-cola').textContent), t.$('ins-cola').textContent);
  // otra sincronización no vuelve a mandarla
  t.setEnLinea(false); t.setEnLinea(true);
  await esperar(250);
  chequear('otra sincronización no la repite', s.filas.length === 1 && s.intentos.length === intentosAntes + 1, String(s.intentos.length - intentosAntes));
  const ivm = t.item('Ivermectina 1%');
  chequear('con el tamaño de frasco recordado (500 ml) muestra también los frascos', !!ivm && /≈ 3 frascos de 500 ml/.test(ivm.textContent), ivm && ivm.textContent);
  t.cerrarTodo();
}

async function probarReintentoNoDuplica(archivo, est){
  console.log('\n--- si la respuesta se pierde, el reintento no duplica (23505 = ya llegó)');
  const s = servidorFalso(); s.stock = STOCK_LV(est);
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.item('Ivermectina 1%'), 1500);
  s.modo = 'respuesta_perdida';
  t.click('ins-nuevo'); await esperar(20);
  t.llenar('ins-tipo', 'ajuste');
  t.llenar('ins-producto', 'Aftosa Bivalente');
  t.llenar('ins-cantidad', '-50');
  t.click('ins-guardar');
  await esperarHasta(() => s.intentos.length >= 1, 1500);
  await esperar(80);
  chequear('el servidor recibió la fila pero la respuesta se perdió', s.filas.length === 1 && s.intentos.length === 1);
  chequear('la carga sigue en la cola (no se sabe si llegó)', t.guardado().cola.length === 1 && /en cola/i.test(t.$('ins-cola').textContent), JSON.stringify(t.guardado().cola));
  const uid = t.guardado().cola[0].uid;
  s.modo = 'ok';
  t.click('ins-actualizar');
  await esperarHasta(() => t.guardado().cola.length === 0, 2000);
  chequear('el reintento mandó el MISMO uid', s.intentos.length === 2 && s.intentos[1].uid === uid && s.intentos[0].uid === uid, s.intentos.map(i => i.uid).join(' '));
  chequear('el servidor sigue con UNA sola fila (no se duplicó)', s.filas.length === 1, String(s.filas.length));
  chequear('el 23505 cuenta como enviado: la cola queda vacía', t.guardado().cola.length === 0);
  chequear('un ajuste negativo se manda con signo', s.filas[0].tipo === 'ajuste' && s.filas[0].cantidad_ml === -50, JSON.stringify(s.filas[0]));
  // con el servidor caído la carga se conserva y se reintenta sola en la próxima sincronización
  s.modo = 'caido';
  t.click('ins-nuevo'); await esperar(20);
  t.llenar('ins-producto', 'Oxitetraciclina LA'); t.llenar('ins-tipo', 'inicial'); t.llenar('ins-cantidad', '250');
  t.click('ins-guardar');
  await esperarHasta(() => s.intentos.length >= 3, 1500);
  await esperar(80);
  chequear('con el servidor caído la carga se conserva en la cola', t.guardado().cola.length === 1 && s.filas.length === 1, JSON.stringify(t.guardado().cola.length));
  s.modo = 'ok';
  t.setEnLinea(false); t.setEnLinea(true);
  await esperarHasta(() => s.filas.length === 2, 2500);
  chequear('y sale cuando el servidor vuelve (una vez)', s.filas.length === 2 && s.filas.filter(f => f.producto === 'Oxitetraciclina LA').length === 1, String(s.filas.length));
  t.cerrarTodo();
}

async function probarPasaje(archivo, est){
  console.log('\n--- pasaje a otro campo: destino correcto, solo salida, validaciones');
  const otro = est === 'la_vuelta' ? 'maria_laura' : 'la_vuelta';
  const nombreOtro = est === 'la_vuelta' ? 'María Laura' : 'La Vuelta';
  const s = servidorFalso(); s.stock = STOCK_LV(est);
  const t = await levantar(archivo, s);
  if(t.errores.length){ chequear('carga sin errores', false, t.errores[0]); return; }
  await t.abrir();
  await esperarHasta(() => t.item('Ivermectina 1%'), 1500);
  t.click('ins-nuevo'); await esperar(20);
  t.llenar('ins-tipo', 'pasaje_salida');
  chequear('el destino se ve y es el otro campo (fijo)', t.$('ins-fila-destino').style.display !== 'none' && t.$('ins-destino').value === nombreOtro && t.$('ins-destino').readOnly, t.$('ins-destino').value);
  // validaciones: nada se manda ni se encola
  const intentos0 = s.intentos.length;
  const rechaza = (nombre, texto) => {
    t.click('ins-guardar');
    chequear(nombre, t.$('ins-form-error').textContent.length > 0 && t.guardado().cola.length === 0 && t.$('modal-insumos-form').style.display === 'flex', t.$('ins-form-error').textContent);
  };
  t.llenar('ins-producto', ''); t.llenar('ins-cantidad', '100');
  rechaza('sin producto: no deja guardar');
  t.llenar('ins-producto', 'Producto Inventado'); rechaza('un producto que no está en la lista: no deja guardar');
  t.llenar('ins-producto', 'Aftosa Bivalente'); t.llenar('ins-cantidad', '');
  rechaza('sin cantidad: no deja guardar');
  t.llenar('ins-cantidad', '0'); rechaza('cantidad 0 en un pasaje: no deja guardar');
  t.llenar('ins-cantidad', '-20'); rechaza('cantidad negativa en un pasaje: no deja guardar');
  t.llenar('ins-cantidad', 'abc'); rechaza('texto en la cantidad: no deja guardar');
  t.llenar('ins-tipo', 'inicial'); t.llenar('ins-cantidad', '-5'); rechaza('un conteo negativo: no deja guardar');
  t.llenar('ins-tipo', 'ajuste'); t.llenar('ins-cantidad', '0'); rechaza('un ajuste de 0: no deja guardar');
  chequear('nada se mandó mientras tanto', s.intentos.length === intentos0);
  // ahora sí el pasaje
  t.llenar('ins-tipo', 'pasaje_salida'); t.llenar('ins-producto', 'aftosa bivalente'); t.llenar('ins-cantidad', '250,5'); t.llenar('ins-nota', 'va para el otro campo');
  t.click('ins-guardar');
  await esperarHasta(() => s.filas.length === 1, 2000);
  const f = s.filas[0] || {};
  chequear('se mandó una fila de tipo pasaje_salida', f.tipo === 'pasaje_salida', JSON.stringify(f));
  chequear('con el destino del otro campo', f.destino === otro, f.destino);
  chequear('cantidad positiva (coma decimal bien leída)', f.cantidad_ml === 250.5, String(f.cantidad_ml));
  chequear('con uid y del campo de origen', UUID.test(f.uid || '') && f.establecimiento === est, JSON.stringify(f));
  chequear('NUNCA se inserta pasaje_entrada (la base la genera)', s.intentos.every(i => i.tipo !== 'pasaje_entrada'));
  t.cerrarTodo();
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.log('Uso: node tests/probar_insumos.js <index.html> ...'); process.exit(1); }
  for(const a of archivos){
    console.log('\n=== ' + a + ' ===');
    const sonda = await levantar(a, servidorFalso());
    if(sonda.errores.length){ chequear('carga sin errores', false, sonda.errores[0]); continue; }
    const { insumos, est } = sonda.cfg;
    sonda.cerrarTodo();
    if(!insumos){ await probarSoloPoneChico(a); continue; }
    await probarStockYColores(a, est);
    await probarSinSenalMuestraCache(a, est);
    await probarSincronizacionRefresca(a, est);
    await probarConteoOfflineYCola(a, est);
    await probarReintentoNoDuplica(a, est);
    await probarPasaje(a, est);
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
