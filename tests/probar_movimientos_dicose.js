/*
 * Prueba ad-hoc: "📑 Movimientos DICOSE" (8/10/2026) -- lista de todo lo que tiene guía +
 * venta entre dueños del mismo campo que solo lleva guía (evento `movimiento_guia`).
 *
 * Cubre: el botón solo existe con CONFIG.guiasHabilitado (Release 1 lo publica apagado, el
 * test lo prende en runtime); el formulario (guía obligatoria y bien formada, dueños
 * distintos, saldo que bloquea); que el stock pase de un dueño a otro SIN cambiar el total
 * del potrero; que escriba UNA fila en el stream del propio campo con event_id UUID válido;
 * que no genere transacciones; que otro dispositivo lo aplique igual (y no dos veces);
 * la lista (compra/venta/campo ajeno/traslado/solo-guía, "sin guía", filtros); anular con 🗑
 * desde la lista (revierte acá y en el otro dispositivo, por movId); que no se pueda editar;
 * la cola offline; y que un receptor con menos stock del esperado conserve el total.
 *
 * Uso: node tests/probar_movimientos_dicose.js <index.html> [...]
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

// Servidor simulado compartido (filtra por columna como Supabase, 23505 por event_id repetido)
function crearServidor(){
  const filas = { eventos_sync: [], stock_potreros: [] };
  let reloj = Date.parse('2026-10-08T12:00:00Z');
  return {
    filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _orden: null, _modo: 'select',
          select(){ q._modo='select'; return q; },
          insert(rows){ q._modo='insert'; q._filas = Array.isArray(rows)?rows:[rows]; return q; },
          delete(){ q._modo='delete'; return q; },
          eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
          not(){ return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          order(col,opts){ q._orden = {col, asc: !opts || opts.ascending!==false}; return q; },
          then(res){
            filas[tabla] = filas[tabla] || [];
            if(q._modo==='insert'){
              let error = null;
              q._filas.forEach(f=>{
                if(f.event_id && filas[tabla].some(r=>r.event_id===f.event_id)){ error = {code:'23505', message:'duplicate key'}; return; }
                reloj += 10;
                filas[tabla].push(Object.assign({creado_en: new Date(reloj).toISOString()}, f));
              });
              return Promise.resolve(res({data:q._filas, error}));
            }
            if(q._modo==='delete'){
              const antes = filas[tabla].length;
              filas[tabla] = filas[tabla].filter(r=>!q._filtros.every(f=>f(r)));
              return Promise.resolve(res({data:null, error:null, count: antes-filas[tabla].length}));
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

// prender=true: el HTML se publica con guiasHabilitado:false (Release 1); el test lo prende para probar la UI
async function levantar(archivo, servidor, prender){
  let html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  // prender: true/false fuerza el flag en runtime; undefined lo deja como se publicó
  if(prender === true) html = html.replace('"guiasHabilitado":false', '"guiasHabilitado":true');
  if(prender === false) html = html.replace('"guiasHabilitado":true', '"guiasHabilitado":false');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true, writable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
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
  win.__toasts = [];
  const toastOriginal = win.toast;
  win.toast = function(m){ win.__toasts.push(m); return toastOriginal(m); };
  return { win, errores };
}

function ultimoToast(win){ return win.__toasts[win.__toasts.length-1] || ''; }

/* Llena "Venta entre dueños" y aprieta Registrar. filas = [{cat, cant}] */
function cargarVenta(win, o){
  win.document.getElementById('btn-guias').click();
  const sm = win.document.getElementById('mg-modo');
  sm.value = 'venta'; sm.dispatchEvent(new win.Event('change', { bubbles: true }));
  win.document.getElementById('mg-potrero').value = o.potrero;
  win.document.getElementById('mg-guia').value = o.guia;
  win.document.getElementById('mg-desde').value = o.desde;
  win.document.getElementById('mg-hacia').value = o.hacia;
  win.document.getElementById('mg-fecha').value = win.fechaISOHoy();
  win.document.getElementById('mg-obs').value = o.obs || '';
  o.filas.forEach((f, i) => {
    if(i > 0) win.document.getElementById('mg-agregar-fila').click();
    const fila = win.document.querySelectorAll('#mg-filas .mg-fila')[i];
    fila.querySelector('.mg-cat').value = f.cat;
    fila.querySelector('.mg-cant').value = String(f.cant);
  });
  win.document.getElementById('mg-guardar').click();
}

// dueños de cada campo (los de la config), para no atar el test a nombres fijos
function duenosDe(win){ return win.__config().duenos.slice(); }

async function probarApp(archivo){
  const etiqueta = archivo.replace('/index.html','');
  console.log(`\n=== Movimientos DICOSE (${archivo}) ===`);
  const servidor = crearServidor();

  // ---- 0) el flag viene PRENDIDO en el HTML publicado (Release 2) y es lo único que gobierna el botón ----
  const publicada = await levantar(archivo, servidor);
  chequear(`${etiqueta}: carga sin errores (como se publica)`, publicada.errores.length===0, publicada.errores.join(' | '));
  chequear(`${etiqueta}: CONFIG.guiasHabilitado viene prendido (Release 2)`, publicada.win.__config().guiasHabilitado === true, String(publicada.win.__config().guiasHabilitado));
  const bPub = publicada.win.document.getElementById('btn-guias');
  chequear(`${etiqueta}: tal como se publica el botón se ve`, !!bPub && bPub.style.display !== 'none');
  const apagada = await levantar(archivo, servidor, false);
  chequear(`${etiqueta}: carga sin errores (flag apagado)`, apagada.errores.length===0, apagada.errores.join(' | '));
  const bApagado = apagada.win.document.getElementById('btn-guias');
  chequear(`${etiqueta}: con el flag apagado el botón existe pero oculto`, !!bApagado && bApagado.style.display === 'none');

  const a = await levantar(archivo, servidor, true);
  const a2 = await levantar(archivo, servidor, true);   // 2º dispositivo del mismo campo, abierto ANTES de cargar
  chequear(`${etiqueta}: carga sin errores (flag prendido)`, a.errores.length===0 && a2.errores.length===0, a.errores.concat(a2.errores).join(' | '));
  if(a.errores.length || a2.errores.length) return;
  const W = a.win, W2 = a2.win;
  const btn = W.document.getElementById('btn-guias');
  chequear(`${etiqueta}: con el flag prendido el botón se ve`, btn.style.display !== 'none');
  W.document.getElementById('btn-guias').click();
  chequear(`${etiqueta}: el botón abre el modal`, W.document.getElementById('modal-guias').style.display === 'flex');
  W.document.getElementById('guias-cerrar').click();
  chequear(`${etiqueta}: Cerrar lo cierra`, W.document.getElementById('modal-guias').style.display === 'none');

  const duenos = duenosDe(W).filter(d=>d);
  const dVende = duenos[0], dCompra = duenos[1];
  const potrero = W.__potrerosGeo()[0].nombre;
  const otroPotrero = W.__potrerosGeo()[1].nombre;
  const kV = c => W.claveAnimal(c, dVende), kC = c => W.claveAnimal(c, dCompra);
  const aW = W.__est().potreros[potrero].animales;
  aW[kV('Vacas')] = 20; aW[kV('Terneros')] = 5;
  W2.__est().potreros[potrero].animales[kV('Vacas')] = 20; W2.__est().potreros[potrero].animales[kV('Terneros')] = 5;
  const totalAntes = W.totalPotrero(potrero);
  const trans0 = (W.__est().transacciones || []).length;
  const filaVende = (cant, cat) => ({cat: cat || 'Vacas', cant});

  // ---- 1) validaciones: nada se registra ----
  cargarVenta(W, {potrero, guia: '', desde: dVende, hacia: dCompra, filas: [filaVende(3)]});
  chequear(`${etiqueta}: sin guía NO se registra`, aW[kV('Vacas')]===20 && servidor.filas.eventos_sync.length===0, ultimoToast(W));
  cargarVenta(W, {potrero, guia: 'mal', desde: dVende, hacia: dCompra, filas: [filaVende(3)]});
  chequear(`${etiqueta}: guía mal formada NO se registra`, aW[kV('Vacas')]===20 && servidor.filas.eventos_sync.length===0, ultimoToast(W));
  cargarVenta(W, {potrero, guia: 'A123456', desde: dVende, hacia: dVende, filas: [filaVende(3)]});
  chequear(`${etiqueta}: vendedor = comprador NO se registra`, servidor.filas.eventos_sync.length===0 && /distintos/.test(ultimoToast(W)), ultimoToast(W));
  cargarVenta(W, {potrero, guia: 'A123456', desde: dVende, hacia: dCompra, filas: [filaVende(25)]});
  chequear(`${etiqueta}: saldo insuficiente BLOQUEA`, aW[kV('Vacas')]===20 && servidor.filas.eventos_sync.length===0 && /tiene 20/.test(ultimoToast(W)), ultimoToast(W));
  cargarVenta(W, {potrero: '', guia: 'A123456', desde: dVende, hacia: dCompra, filas: [filaVende(1)]});
  chequear(`${etiqueta}: sin potrero NO se registra`, servidor.filas.eventos_sync.length===0, ultimoToast(W));

  // ---- 2) venta válida, 2 categorías ----
  cargarVenta(W, {potrero, guia: 'a123456', desde: dVende, hacia: dCompra, obs: 'prueba', filas: [filaVende(8), filaVende(3, 'Terneros')]});
  await dormir(80);
  chequear(`${etiqueta}: el vendedor pierde 8 Vacas y 3 Terneros`, aW[kV('Vacas')]===12 && aW[kV('Terneros')]===2, `${aW[kV('Vacas')]}/${aW[kV('Terneros')]}`);
  chequear(`${etiqueta}: el comprador gana 8 Vacas y 3 Terneros`, aW[kC('Vacas')]===8 && aW[kC('Terneros')]===3, `${aW[kC('Vacas')]}/${aW[kC('Terneros')]}`);
  chequear(`${etiqueta}: el TOTAL del potrero no cambia`, W.totalPotrero(potrero)===totalAntes, `${W.totalPotrero(potrero)} vs ${totalAntes}`);
  const h = W.__est().potreros[potrero].historial[0];
  chequear(`${etiqueta}: renglón 'movimiento_guia' con guía en MAYÚSCULA y movId`, h.tipo==='movimiento_guia' && h.extra.guia==='A123456' && !!h.extra.movId, JSON.stringify(h.extra));
  chequear(`${etiqueta}: el texto dice quién a quién y la guía`, h.detalle.includes('→') && h.detalle.includes('A123456'), h.detalle);
  const filas = servidor.filas.eventos_sync;
  chequear(`${etiqueta}: se escribió UNA fila, en el stream del propio campo`, filas.length===1 && filas[0].tipo==='movimiento_guia' && filas[0].establecimiento===W.__establecimiento() && filas[0].potrero===potrero, JSON.stringify(filas.map(f=>f.tipo)));
  chequear(`${etiqueta}: event_id es UUID válido`, REGEX_UUID.test(filas[0].event_id), filas[0].event_id);
  chequear(`${etiqueta}: el detalle trae items, desde, hacia, guía y movId`, filas[0].detalle.items.length===2 && filas[0].detalle.desde===dVende && filas[0].detalle.hacia===dCompra && filas[0].detalle.guia==='A123456' && filas[0].detalle.movId===h.extra.movId, JSON.stringify(filas[0].detalle));
  chequear(`${etiqueta}: no se generó ninguna transacción (no es compra/venta externa)`, (W.__est().transacciones||[]).length === trans0);

  // ---- 3) otro dispositivo lo aplica una sola vez ----
  await W2.sincronizar();
  const a2m = W2.__est().potreros[potrero].animales;
  chequear(`${etiqueta}: otro dispositivo pasa los animales de dueño`, a2m[kV('Vacas')]===12 && a2m[kC('Vacas')]===8 && a2m[kC('Terneros')]===3, `${a2m[kV('Vacas')]}/${a2m[kC('Vacas')]}/${a2m[kC('Terneros')]}`);
  const h2 = W2.__est().potreros[potrero].historial[0];
  chequear(`${etiqueta}: …y deja el renglón con su movId (sin transacción)`, h2.tipo==='movimiento_guia' && h2.origDatos.movId===h.extra.movId && (W2.__est().transacciones||[]).length===0, JSON.stringify(h2.origDatos));
  await W2.sincronizar();
  chequear(`${etiqueta}: sincronizar de nuevo no lo reaplica`, W2.__est().potreros[potrero].animales[kC('Vacas')]===8);

  // ---- 4) la lista: junta todo lo que tiene guía ----
  const hist = W.__est().potreros[otroPotrero].historial;
  hist.unshift({fecha: W.fechaHoy(), tipo: 'compra', detalle: '5 Vacas de X — guía B654321', id: 'h_t1', extra: {potrero: otroPotrero, categoria:'Vacas', cantidad:5, dueno:dVende, guia:'B654321'}});
  hist.unshift({fecha: W.fechaHoy(), tipo: 'venta', detalle: '2 Novillos sin guia', id: 'h_t2', extra: {potrero: otroPotrero, categoria:'Novillos +3 años', cantidad:2, dueno:dVende, guia:null}});
  hist.unshift({fecha: W.fechaHoy(), tipo: 'traslado_salida', detalle: 'Traslado a otro campo: 4 Vacas — guía C111111', id: 'h_t3', extra: {potrero: otroPotrero, items:[{categoria:'Vacas', dueno:dVende, cantidad:4}], guia:'C111111', trasladoId:'t-1'}});
  hist.unshift({fecha: W.fechaHoy(), tipo: 'envio_campo_ajeno', detalle: 'Envío a campo ajeno: 6 Vacas — guía D222222', id: 'h_t4', extra: {potrero: otroPotrero, items:[{categoria:'Vacas', dueno:dVende, cantidad:6}], guia:'D222222'}});
  hist.unshift({fecha: W.fechaHoy(), tipo: 'muerte', detalle: '1 Vaca (no tiene guía ni la necesita)', id: 'h_t5', extra: {potrero: otroPotrero, categoria:'Vacas', cantidad:1, dueno:dVende}});
  W.document.getElementById('btn-guias').click();
  const tarjetas = () => Array.from(W.document.querySelectorAll('#mg-lista [data-mg-id]'));
  chequear(`${etiqueta}: la lista trae los 5 movimientos con guía (no la muerte)`, tarjetas().length===5, String(tarjetas().length));
  const textoLista = W.document.getElementById('mg-lista').textContent;
  chequear(`${etiqueta}: muestra la guía de cada uno`, ['A123456','B654321','C111111','D222222'].every(g=>textoLista.includes(g)));
  chequear(`${etiqueta}: la venta sin guía sale marcada "sin guía"`, textoLista.includes('sin guía'));
  chequear(`${etiqueta}: el resumen cuenta cabezas y sin guía`, /5 movimientos/.test(W.document.getElementById('mg-resumen').textContent) && /1 sin guía/.test(W.document.getElementById('mg-resumen').textContent), W.document.getElementById('mg-resumen').textContent);
  const filtrar = (tipo, texto, sin) => {
    W.document.getElementById('mg-filtro-tipo').value = tipo || '';
    W.document.getElementById('mg-filtro-texto').value = texto || '';
    W.document.getElementById('mg-filtro-sin').checked = !!sin;
    W.document.getElementById('mg-filtro-tipo').dispatchEvent(new W.Event('change', {bubbles:true}));
    return tarjetas().length;
  };
  chequear(`${etiqueta}: filtro "ventas entre dueños" deja 1`, filtrar('entre_duenos')===1);
  chequear(`${etiqueta}: filtro "traslados" deja 1`, filtrar('traslado')===1);
  chequear(`${etiqueta}: filtro "campo ajeno" deja 1`, filtrar('campo_ajeno')===1);
  chequear(`${etiqueta}: filtro "compras" deja 1 y "ventas" deja 1`, filtrar('compra')===1 && filtrar('venta')===1);
  chequear(`${etiqueta}: "solo sin guía" deja la venta sin guía`, filtrar('', '', true)===1);
  chequear(`${etiqueta}: la búsqueda por guía encuentra la compra`, filtrar('', 'b654321')===1);
  chequear(`${etiqueta}: la búsqueda por potrero encuentra los de ese potrero`, filtrar('', otroPotrero.toLowerCase())===4, String(filtrar('', otroPotrero.toLowerCase())));
  filtrar('', '', false);
  chequear(`${etiqueta}: sin filtros vuelven los 5`, tarjetas().length===5);

  // 📄 desde la lista agrega la guía a la venta sin guía (reutiliza agregar_guia)
  W.prompt = () => 'e333333';
  const btnGuia = W.document.querySelector('#mg-lista [data-mg-id="h_t2"] [data-mg-guia]');
  chequear(`${etiqueta}: la venta sin guía tiene botón 📄`, !!btnGuia);
  if(btnGuia){
    btnGuia.click();
    await dormir(40);
    chequear(`${etiqueta}: 📄 guarda la guía y la lista se refresca (ya no está "sin guía")`, W.document.querySelector('#mg-lista [data-mg-id="h_t2"]').textContent.includes('E333333') && !/sin guía/.test(W.document.getElementById('mg-resumen').textContent), W.document.getElementById('mg-resumen').textContent);
    chequear(`${etiqueta}: …sin abrir el panel de detalle del potrero`, W.document.getElementById('detalle').style.display !== 'flex');
  }

  // ---- 5) editar está bloqueado ----
  if(typeof W.editarHistorial === 'function'){
    W.editarHistorial(h.id);
    chequear(`${etiqueta}: una venta entre dueños no se edita`, !W.__est().potreros[potrero].historial.find(x=>x.id===h.id).eliminado && /no se edita/.test(ultimoToast(W)), ultimoToast(W));
  }

  // ---- 6) anular con 🗑 desde la lista ----
  const evAntes = servidor.filas.eventos_sync.length;
  W.document.getElementById('mg-filtro-tipo').value = 'entre_duenos';
  W.document.getElementById('mg-filtro-tipo').dispatchEvent(new W.Event('change', {bubbles:true}));
  const bBorrar = W.document.querySelector('#mg-lista [data-mg-borrar]');
  chequear(`${etiqueta}: la venta entre dueños tiene 🗑 en la lista`, !!bBorrar);
  bBorrar.click();
  await dormir(80);
  chequear(`${etiqueta}: anular devuelve los animales al vendedor`, aW[kV('Vacas')]===20 && aW[kV('Terneros')]===5 && !aW[kC('Vacas')] && !aW[kC('Terneros')], `${aW[kV('Vacas')]}/${aW[kV('Terneros')]}/${aW[kC('Vacas')]}/${aW[kC('Terneros')]}`);
  chequear(`${etiqueta}: el total del potrero sigue igual`, W.totalPotrero(potrero)===totalAntes);
  chequear(`${etiqueta}: el renglón queda ELIMINADO y sale de la lista`, W.__est().potreros[potrero].historial.find(x=>x.id===h.id).eliminado===true && tarjetas().length===0);
  chequear(`${etiqueta}: borrar desde la lista no abre el detalle del potrero`, W.document.getElementById('detalle').style.display !== 'flex');
  const corr = servidor.filas.eventos_sync.slice(evAntes).find(r=>r.tipo==='correccion');
  chequear(`${etiqueta}: se escribe una corrección con reversar movimiento_guia_ajuste y el movId`, !!corr && corr.detalle.accion==='eliminar' && corr.detalle.tipoOriginal==='movimiento_guia' && corr.detalle.reversar.tipo==='movimiento_guia_ajuste' && corr.detalle.reversar.movId===h.extra.movId, JSON.stringify(corr && corr.detalle));
  chequear(`${etiqueta}: la corrección va al stream del propio campo`, !!corr && corr.establecimiento===W.__establecimiento());
  await W2.sincronizar();
  const a2n = W2.__est().potreros[potrero].animales;
  chequear(`${etiqueta}: el otro dispositivo también revierte`, a2n[kV('Vacas')]===20 && !a2n[kC('Vacas')], `${a2n[kV('Vacas')]}/${a2n[kC('Vacas')]}`);
  chequear(`${etiqueta}: …y tacha su renglón (por movId)`, W2.__est().potreros[potrero].historial.find(x=>x.tipo==='movimiento_guia').eliminado===true);

  // ---- 7) receptor con menos stock que el pedido: conserva el total ----
  const kRaro = W.claveAnimal('Toros', dVende), kRaroC = W.claveAnimal('Toros', dCompra);
  const antes = W.totalPotrero(otroPotrero);
  W.__est().potreros[otroPotrero].animales[kRaro] = 2;
  const antes2 = W.totalPotrero(otroPotrero);
  W.aplicarEventoRemoto({event_id:'e-x', creado_en:'2026-10-09T00:00:00Z', tipo:'movimiento_guia', potrero: otroPotrero,
    detalle:{items:[{categoria:'Toros', cantidad:5}], desde:dVende, hacia:dCompra, guia:'F444444', movId:'m-x'}, dispositivo:'otro'}, new Set());
  const aOtro = W.__est().potreros[otroPotrero].animales;
  chequear(`${etiqueta}: con 2 disponibles de 5 pedidos mueve solo 2 (el total no cambia)`, aOtro[kRaro]===0 && aOtro[kRaroC]===2 && W.totalPotrero(otroPotrero)===antes2, `${aOtro[kRaro]}/${aOtro[kRaroC]}`);
  // una cantidad que no es número se descarta entera (detalleNumericoValido)
  W.aplicarEventoRemoto({event_id:'e-y', creado_en:'2026-10-09T00:00:00Z', tipo:'movimiento_guia', potrero: otroPotrero,
    detalle:{items:[{categoria:'Toros', cantidad:'mucho'}], desde:dVende, hacia:dCompra, guia:'F444444', movId:'m-y'}, dispositivo:'otro'}, new Set());
  chequear(`${etiqueta}: un evento con cantidad no numérica se descarta`, W.totalPotrero(otroPotrero)===antes2 && !W.__est().potreros[otroPotrero].historial.some(x=>x.origDatos && x.origDatos.movId==='m-y'));

  // ---- 8) potrero desconocido: se estaciona ----
  W.aplicarEventoRemoto({event_id:'e-z', creado_en:'2026-10-09T00:00:00Z', tipo:'movimiento_guia', potrero:'Potrero Que No Existe',
    detalle:{items:[{categoria:'Vacas', cantidad:2}], desde:dVende, hacia:dCompra, guia:'G555555', movId:'m-z'}, dispositivo:'otro'}, new Set());
  chequear(`${etiqueta}: un evento a un potrero desconocido se estaciona`, ((W.__est().pendientesPotrero||{})['Potrero Que No Existe']||[]).length===1);

  // ---- 8b) Campo ajeno y Traslado viven en este modal (ya NO en Lluvias), elegibles con el selector ----
  const cfg = W.__config();
  const tieneCA = !!cfg.dicoseHabilitado, tieneTR = !!(cfg.trasladoHabilitado && cfg.traslado);
  const lluv = W.document.getElementById('modal-lluvias');
  chequear(`${etiqueta}: Campo ajeno y Traslado ya NO están dentro del modal de Lluvias`, !lluv.querySelector('#campo-ajeno-seccion') && !lluv.querySelector('#traslado-seccion'));
  W.document.getElementById('btn-guias').click();
  const modos = Array.from(W.document.getElementById('mg-modo').options).map(o=>o.value);
  const esperados = ['compraventa', 'venta'].concat(tieneCA ? ['campo_ajeno'] : [], tieneTR ? ['traslado'] : []);
  chequear(`${etiqueta}: el selector ofrece ${esperados.join(' + ')}`, JSON.stringify(modos)===JSON.stringify(esperados), modos.join(','));
  chequear(`${etiqueta}: el selector solo se ve si hay más de una opción`, (W.document.getElementById('mg-modo-fila').style.display !== 'none') === (esperados.length>1));
  const vis = id => W.document.getElementById(id).style.display === 'block';
  chequear(`${etiqueta}: al abrir se ve solo Compra / venta (la opción por defecto)`, vis('compraventa-seccion') && !vis('mg-venta-seccion') && !vis('campo-ajeno-seccion') && !vis('traslado-seccion'));
  const abrirModo = m => { W.document.getElementById('btn-guias').click(); const s = W.document.getElementById('mg-modo'); s.value = m; s.dispatchEvent(new W.Event('change', {bubbles:true})); };
  if(tieneCA){
    abrirModo('campo_ajeno');
    chequear(`${etiqueta}: elegir "campo ajeno" muestra ese formulario y oculta los demás`, vis('campo-ajeno-seccion') && !vis('mg-venta-seccion') && !vis('traslado-seccion'));
    const cargarCA = (cat, cant, guia) => {
      W.document.getElementById('ca-tipo').value = 'envio'; W.document.getElementById('ca-potrero').value = potrero;
      W.document.getElementById('ca-guia').value = guia; W.document.getElementById('ca-fecha').value = W.fechaISOHoy();
      const f = W.document.querySelector('#ca-filas .ca-fila');
      f.querySelector('.ca-cat').value = cat; f.querySelector('.ca-dueno').value = dVende; f.querySelector('.ca-cant').value = String(cant);
      W.document.getElementById('ca-guardar').click();
    };
    const evCA = servidor.filas.eventos_sync.length, stockCA = aW[kV('Vacas')];
    cargarCA('Vacas', 9999, 'J111111');
    chequear(`${etiqueta}: un envío a campo ajeno sin stock BLOQUEA (no pregunta ni deja negativo)`, aW[kV('Vacas')]===stockCA && servidor.filas.eventos_sync.length===evCA && /hay/.test(ultimoToast(W)), ultimoToast(W));
    abrirModo('campo_ajeno');
    cargarCA('Vacas', 3, 'J111111');
    await dormir(40);
    chequear(`${etiqueta}: un envío válido descuenta del potrero y sube un evento`, aW[kV('Vacas')]===stockCA-3 && servidor.filas.eventos_sync.length===evCA+1);
    chequear(`${etiqueta}: la lista de Movimientos DICOSE se refresca con el envío`, W.document.getElementById('mg-lista').textContent.includes('J111111'));
  }
  if(tieneTR){
    abrirModo('traslado');
    chequear(`${etiqueta}: elegir "traslado" muestra ese formulario y oculta los demás`, vis('traslado-seccion') && !vis('mg-venta-seccion') && !vis('campo-ajeno-seccion'));
    W.document.getElementById('tr-origen').value = potrero; W.document.getElementById('tr-destino').value = 'Casco';
    W.document.getElementById('tr-guia').value = 'K222222'; W.document.getElementById('tr-fecha').value = W.fechaISOHoy();
    const ft = W.document.querySelector('#tr-filas .tr-fila');
    ft.querySelector('.tr-cat').value = 'Vacas'; ft.querySelector('.tr-dueno').value = dVende;
    ft.querySelector('.tr-dueno-dest').value = 'Pedro'; ft.querySelector('.tr-cant').value = '2';
    const evTR = servidor.filas.eventos_sync.length;
    W.document.getElementById('tr-guardar').click();
    await dormir(60);
    chequear(`${etiqueta}: un traslado desde acá sube sus dos eventos`, servidor.filas.eventos_sync.length===evTR+2, String(servidor.filas.eventos_sync.length-evTR));
    chequear(`${etiqueta}: la lista de Movimientos DICOSE se refresca con el traslado`, W.document.getElementById('mg-lista').textContent.includes('K222222'));
  }
  if(!tieneCA && !tieneTR){
    chequear(`${etiqueta}: sin campo ajeno ni traslado esas secciones no se ven nunca`, !vis('campo-ajeno-seccion') && !vis('traslado-seccion'));
  }

  // ---- 8c) Compra / venta vive en Movimientos DICOSE (el botón del panel del potrero se sacó en La Vuelta y María Laura) ----
  W.seleccionarPotrero(potrero);
  chequear(`${etiqueta}: el panel del potrero YA NO tiene el botón Compra / Venta`, !W.document.querySelector('[data-accion="compraventa"]'));
  const cvEl = id => W.document.getElementById(id);
  const abrirCV = () => { W.document.getElementById('btn-guias').click(); const s = cvEl('mg-modo'); s.value = 'compraventa'; s.dispatchEvent(new W.Event('change', {bubbles:true})); };
  abrirCV();
  chequear(`${etiqueta}: Compra / venta tiene campo de guía (también en María Laura)`, !!cvEl('cv-guia'));
  cvEl('cv-tipo').value = 'Venta'; cvEl('cv-tipo').dispatchEvent(new W.Event('change', {bubbles:true}));
  const rotVenta = cvEl('cv-label-potrero').textContent;
  cvEl('cv-tipo').value = 'Compra'; cvEl('cv-tipo').dispatchEvent(new W.Event('change', {bubbles:true}));
  chequear(`${etiqueta}: el rótulo del potrero cambia entre salida y entrada`, /salen/.test(rotVenta) && /entran/.test(cvEl('cv-label-potrero').textContent), rotVenta + ' / ' + cvEl('cv-label-potrero').textContent);
  const llenarCV = o => {
    cvEl('cv-tipo').value = o.tipo; cvEl('cv-potrero').value = o.potrero === undefined ? potrero : o.potrero;
    cvEl('cv-cat').value = 'Vacas'; cvEl('cv-dueno').value = dVende; cvEl('cv-cant').value = String(o.cant);
    cvEl('cv-fecha').value = W.fechaISOHoy(); cvEl('cv-precio').value = o.precio || ''; cvEl('cv-contraparte').value = o.contra || '';
    cvEl('cv-guia').value = o.guia || ''; cvEl('cv-obs').value = '';
    cvEl('cv-guardar').click();
  };
  const totCV0 = W.totalPotrero(potrero), trCV0 = (W.__est().transacciones || []).length, evCV0 = servidor.filas.eventos_sync.length, stCV0 = aW[kV('Vacas')];
  llenarCV({tipo: 'Compra', cant: 4, precio: 100, contra: 'T-cv', guia: 'mal'});
  chequear(`${etiqueta}: guía mal formada NO registra la compra`, aW[kV('Vacas')]===stCV0 && servidor.filas.eventos_sync.length===evCV0, ultimoToast(W));
  llenarCV({tipo: 'Compra', cant: 4, potrero: ''});
  chequear(`${etiqueta}: sin potrero NO registra`, aW[kV('Vacas')]===stCV0 && servidor.filas.eventos_sync.length===evCV0, ultimoToast(W));
  llenarCV({tipo: 'Compra', cant: 4, precio: 100, contra: 'T-cv', guia: 'l333333'});
  await dormir(40);
  chequear(`${etiqueta}: la compra suma al potrero elegido`, aW[kV('Vacas')]===stCV0+4, String(aW[kV('Vacas')]));
  chequear(`${etiqueta}: …genera su transacción (reporte económico) con la guía`, (W.__est().transacciones||[]).length===trCV0+1 && W.__est().transacciones[0].guia==='L333333' && W.__est().transacciones[0].contraparte==='T-cv');
  const evCompra = servidor.filas.eventos_sync.slice(evCV0).find(r=>r.tipo==='compra');
  chequear(`${etiqueta}: …y sube UN evento 'compra' con la guía, en el stream del propio campo`, !!evCompra && evCompra.detalle.guia==='L333333' && evCompra.establecimiento===W.__establecimiento() && evCompra.potrero===potrero && REGEX_UUID.test(evCompra.event_id), JSON.stringify(evCompra));
  chequear(`${etiqueta}: la lista de Movimientos DICOSE se refresca con la compra`, cvEl('mg-lista').textContent.includes('L333333'));
  chequear(`${etiqueta}: el formulario se limpia para la próxima (cantidad 1, guía vacía)`, cvEl('cv-cant').value==='1' && cvEl('cv-guia').value==='');
  llenarCV({tipo: 'Venta', cant: 99999});
  chequear(`${etiqueta}: una venta sin stock BLOQUEA`, aW[kV('Vacas')]===stCV0+4 && /Solo hay/.test(ultimoToast(W)), ultimoToast(W));
  llenarCV({tipo: 'Venta', cant: 2, guia: 'M444444'});
  await dormir(40);
  chequear(`${etiqueta}: la venta resta del potrero elegido`, aW[kV('Vacas')]===stCV0+2, String(aW[kV('Vacas')]));
  chequear(`${etiqueta}: el total del potrero cambió solo por lo comprado y vendido (+4 −2)`, W.totalPotrero(potrero)===totCV0+2, `${W.totalPotrero(potrero)} vs ${totCV0}`);
  // otro dispositivo aplica compra y venta
  await W2.sincronizar();
  chequear(`${etiqueta}: otro dispositivo recibe la compra y la venta`, W2.__est().potreros[potrero].animales[kV('Vacas')] !== undefined && (W2.__est().transacciones||[]).some(x=>x.guia==='L333333') && (W2.__est().transacciones||[]).some(x=>x.guia==='M444444'));
  chequear(`${etiqueta}: la lista de Movimientos DICOSE tiene ✏️ en las compras/ventas (editar desde ahí)`, !!cvEl('mg-lista').querySelector('[data-mg-editar]'));
  // editar la compra desde el historial abre Movimientos DICOSE precargado
  if(typeof W.editarHistorial === 'function'){
    const hCompra = W.__est().potreros[potrero].historial.find(x=>x.tipo==='compra' && !x.eliminado && x.extra && x.extra.guia==='L333333');
    W.confirm = () => true;
    const stAntesEd = aW[kV('Vacas')];
    W.editarHistorial(hCompra.id);
    chequear(`${etiqueta}: editar la compra la deshace (-4)`, aW[kV('Vacas')]===stAntesEd-4, String(aW[kV('Vacas')]));
    chequear(`${etiqueta}: …y abre Movimientos DICOSE en Compra / venta, precargado`,
      cvEl('modal-guias').style.display==='flex' && vis('compraventa-seccion') && cvEl('cv-tipo').value==='Compra' && cvEl('cv-cant').value==='4'
        && cvEl('cv-contraparte').value==='T-cv' && cvEl('cv-guia').value==='L333333' && cvEl('cv-potrero').value===potrero,
      [cvEl('modal-guias').style.display, cvEl('cv-tipo').value, cvEl('cv-cant').value, cvEl('cv-contraparte').value, cvEl('cv-guia').value, cvEl('cv-potrero').value].join('|'));
    cvEl('cv-guardar').click();
    await dormir(40);
    chequear(`${etiqueta}: guardar la corrección deja el stock como estaba`, aW[kV('Vacas')]===stAntesEd, String(aW[kV('Vacas')]));
  }

  // ---- 9) cola offline ----
  W.navigator.onLine = false;
  const evCola = servidor.filas.eventos_sync.length;
  cargarVenta(W, {potrero, guia: 'H666666', desde: dVende, hacia: dCompra, filas: [filaVende(1)]});
  await dormir(60);
  const cola = W.__est().colaSync || [];
  chequear(`${etiqueta}: sin señal queda 1 evento en la cola, sin establecimiento ajeno`, cola.length===1 && cola[0].tipo==='movimiento_guia' && !cola[0].establecimiento && servidor.filas.eventos_sync.length===evCola, String(cola.length));
  W.navigator.onLine = true;
  await W.vaciarColaSync();
  await dormir(60);
  chequear(`${etiqueta}: al volver la señal se sube y la cola queda vacía`, servidor.filas.eventos_sync.length===evCola+1 && (W.__est().colaSync||[]).length===0);
}

async function probarSinUI(archivo){
  console.log(`\n=== Sin Movimientos DICOSE (${archivo}) ===`);
  const servidor = crearServidor();
  // Campo de La Vuelta lleva el flag en su CONFIG (misma config del establecimiento) pero NO tiene la pantalla;
  // Pone Chico no lo tiene: se levantan tal como se publican.
  const { win, errores } = await levantar(archivo, servidor);
  chequear(`${archivo}: carga sin errores`, errores.length===0, errores.join(' | '));
  if(errores.length) return;
  const b = win.document.getElementById('btn-guias');
  chequear(`${archivo}: el botón no existe o está oculto`, !b || b.style.display === 'none');
  chequear(`${archivo}: el modal no existe o está cerrado`, !win.document.getElementById('modal-guias') || win.document.getElementById('modal-guias').style.display !== 'flex');
  // el receptor sí tiene que estar en TODAS las variantes (también Campo): aplica el evento igual
  if(!win.__potrerosGeo().length) return;   // Pone Chico no trae potreros: sin stock que mover
  const potrero = win.__potrerosGeo()[0].nombre;
  const dueno = win.__config().duenos[0], hacia = win.__config().duenos[1];
  win.__est().potreros[potrero].animales[win.claveAnimal('Vacas', dueno)] = 10;
  win.aplicarEventoRemoto({event_id:'e-r', creado_en:'2026-10-09T00:00:00Z', tipo:'movimiento_guia', potrero,
    detalle:{items:[{categoria:'Vacas', cantidad:4}], desde:dueno, hacia, guia:'A123456', movId:'m-r'}, dispositivo:'otro'}, new Set());
  const an = win.__est().potreros[potrero].animales;
  chequear(`${archivo}: aunque no tenga la pantalla, aplica el evento recibido`, an[win.claveAnimal('Vacas', dueno)]===6 && an[win.claveAnimal('Vacas', hacia)]===4);
}

(async () => {
  const archivos = process.argv.slice(2);
  // solo las apps COMPLETAS (PC y móvil) tienen la pantalla; "Campo" (movil-campo) no
  for(const a of archivos.filter(a => !a.includes('campo') && !a.includes('pone-chico'))) await probarApp(a);
  for(const a of archivos.filter(a => a.includes('campo') || a.includes('pone-chico'))) await probarSinUI(a);
  console.log(`\n${fallas===0?'TODO OK':'HAY FALLAS: '+fallas}`);
  process.exit(fallas===0?0:1);
})();
