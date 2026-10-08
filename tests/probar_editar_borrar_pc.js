/*
 * Prueba ad-hoc: en la PC se puede editar y borrar (con confirmación) CUALQUIER
 * evento registrado (3/10/2026, a pedido de Pedro). Cubre:
 *   - historial de un potrero: las entradas que cargó OTRO dispositivo (solo
 *     tienen `origDatos`, no `extra`) ahora tienen ✏️ y 🗑 en la PC -- y siguen
 *     SIN tenerlos en la móvil completa y en Campo;
 *   - borrar revierte el stock exacto, `confirm` en falso no hace nada, y los
 *     demás dispositivos (otra PC, móvil, Campo) convergen al mismo stock;
 *   - un movimiento sincronizado (dos entradas, origen y destino, sin grupoId)
 *     se tacha en las dos puntas;
 *   - editar abre el formulario correspondiente precargado: nacimiento,
 *     compra/venta (precio/contraparte, también si el dato falta en origDatos
 *     y hay que sacarlo de la transacción), movimiento, mover TODO,
 *     desaparecido, encontrado (reabre Desaparecidos) y campo ajeno;
 *   - 🏷️ caravana sobre una muerte sincronizada no le fabrica un `extra`;
 *   - abortos y eventos climáticos: editar/borrar en la PC, sincronizado a las
 *     demás variantes, y el % de abortos de Stock total se recalcula.
 * Pone Chico arranca sin potreros: ahí solo corre la parte de abortos/clima.
 *
 * Uso: node probar_editar_borrar_pc.js la-vuelta-pc/index.html maria-laura-pc/index.html [...]
 *      (por cada "<prefijo>-pc" levanta también "<prefijo>-movil" y "<prefijo>-movil-campo")
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

/* Un "otro dispositivo" (un celular) que ya subió un evento: se agrega directo a
   la tabla, con la misma forma que deja enviarEvento()/pushEventoRemoto(). */
let seqInyeccion = 0;
async function inyectar(servidor, estab, tipo, potrero, detalle, fecha){
  await dormir(6);
  servidor.filas.eventos_sync.push({
    event_id: 'inj-' + (++seqInyeccion) + '-' + Math.random().toString(36).slice(2, 8),
    establecimiento: estab, dispositivo: 'celular-de-prueba', tipo, potrero, detalle,
    fecha_cliente: fecha, creado_en: new Date().toISOString()
  });
}
const stock = (win, p, key) => (win.__est().potreros[p].animales[key] || 0);
const entradas = (win, p) => win.__est().potreros[p].historial;
const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
// 8/10/2026: en La Vuelta y María Laura la compra/venta se carga desde "📑 Movimientos DICOSE" (ids cv-*); en Pone Chico sigue en el panel del potrero (ids f-*)
const idsCV = (win) => win.__config().guiasHabilitado
  ? { tipo: 'cv-tipo', cat: 'cv-cat', dueno: 'cv-dueno', cant: 'cv-cant', fecha: 'cv-fecha', precio: 'cv-precio', contra: 'cv-contraparte', ok: 'cv-guardar', modal: true }
  : { tipo: 'f-tipo-op', cat: 'f-cat', dueno: 'f-dueno', cant: 'f-cant', fecha: 'f-fecha', precio: 'f-precio', contra: 'f-contraparte', ok: 'f-confirmar', modal: false };
const abrirCompraVenta = (win, p) => {
  if(win.__config().guiasHabilitado){
    win.document.getElementById('btn-guias').click();
    const s = win.document.getElementById('mg-modo'); s.value = 'compraventa'; s.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.getElementById('cv-potrero').value = p;
  } else { win.seleccionarPotrero(p); win.mostrarFormulario(p, 'compraventa'); }
};

function foto(win){
  const o = {};
  Object.keys(win.__est().potreros).sort().forEach(p=>{
    o[p] = Object.entries(win.__est().potreros[p].animales).filter(([,c])=>c!==0).sort((a,b)=>a[0].localeCompare(b[0]));
  });
  return JSON.stringify(o);
}
async function sincronizarTodos(...dispositivos){ for(const d of dispositivos){ await d.win.sincronizar(false); } }

async function probarHistorial(A, B, F, C, servidor){
  console.log('  -- historial de un potrero (entradas cargadas por otro dispositivo)');
  const estab = A.win.__establecimiento();
  const geo = A.win.__potrerosGeo();
  // un potrero con una categoría con stock de sobra, y otro cualquiera como destino
  let p = null, key = null;
  for(const g of geo){
    const animales = A.win.__est().potreros[g.nombre].animales;
    const k = Object.keys(animales).find(x => animales[x] >= 12);
    if(k){ p = g.nombre; key = k; break; }
  }
  if(!p){ console.log('  (ningún potrero con stock suficiente -- se saltea el historial)'); return; }
  const q = geo.map(g=>g.nombre).find(n => n !== p);
  const { cat, dueno: du } = A.win.partesClave(key);
  const keyTerneros = A.win.claveAnimal('Terneros', du);
  const hoy = A.win.fechaHoy();
  const ISOhoy = A.win.fechaISOHoy();
  const dicose = !!A.win.__config().dicoseHabilitado;

  const p0 = stock(A.win, p, key), q0 = stock(A.win, q, key), t0 = stock(A.win, p, keyTerneros);
  await inyectar(servidor, estab, 'nacimiento', p, { categoria: 'Terneros', dueno: du, cantidad: 3, obs: 'parto OK' }, hoy);
  await inyectar(servidor, estab, 'muerte', p, { categoria: cat, dueno: du, cantidad: 2, obs: 'empantanado', caravana: '12345678' }, hoy);
  await inyectar(servidor, estab, 'movimiento_multi', p, { destino: q, items: [{ categoria: cat, categoriaDestino: cat, dueno: du, cantidad: 4 }], obs: 'arreo' }, hoy);
  await inyectar(servidor, estab, 'movimiento_multi', p, { destino: q, items: [{ categoria: cat, categoriaDestino: cat, dueno: du, cantidad: 1 }], obs: 'edit-me' }, hoy);
  await inyectar(servidor, estab, 'compra', p, { categoria: cat, dueno: du, cantidad: 5, precio: 800, contraparte: 'Fulano', obs: null, guia: null }, hoy);
  await inyectar(servidor, estab, 'venta', p, { categoria: cat, dueno: du, cantidad: 1, precio: 900, contraparte: 'Mengano', obs: null, guia: null }, hoy);
  await inyectar(servidor, estab, 'desaparecido', p, { categoria: cat, dueno: du, cantidad: 2, obs: 'cruzó', casoId: 'caso-prueba-1' }, hoy);
  await inyectar(servidor, estab, 'encontrado', q, { categoria: cat, dueno: du, cantidad: 1, casoId: 'caso-prueba-1' }, hoy);
  await sincronizarTodos(A, B, F, C);
  // p: -2 muerte -4 mov -1 mov +5 compra -1 venta -2 desaparecido ; q: +4 +1 +1 encontrado
  chequear('los eventos del otro dispositivo se aplicaron en la PC',
    stock(A.win, p, key) === p0 - 2 - 4 - 1 + 5 - 1 - 2 && stock(A.win, q, key) === q0 + 4 + 1 + 1 && stock(A.win, p, keyTerneros) === t0 + 3,
    `p=${stock(A.win, p, key)} (esperaba ${p0 - 5}) q=${stock(A.win, q, key)} (esperaba ${q0 + 6})`);

  const buscar = (win, potrero, tipo, fn) => entradas(win, potrero).find(h => h.tipo === tipo && !h.eliminado && (!fn || fn(h.origDatos || {})));
  const eNac = buscar(A.win, p, 'nacimiento');
  const eMuerte = buscar(A.win, p, 'muerte');
  A.win.renderDetalle(p);
  const botones = id => ({
    ed: !!A.win.document.querySelector(`[data-hist-editar="${id}"]`),
    bo: !!A.win.document.querySelector(`[data-hist-borrar="${id}"]`)
  });
  chequear('la PC muestra ✏️ y 🗑 en un nacimiento que cargó otro dispositivo', !!eNac && botones(eNac.id).ed && botones(eNac.id).bo);
  chequear('la PC muestra ✏️ y 🗑 en una muerte que cargó otro dispositivo', !!eMuerte && botones(eMuerte.id).ed && botones(eMuerte.id).bo);
  chequear('la entrada sincronizada NO trae `extra` (solo origDatos)', !eMuerte.extra && !!eMuerte.origDatos);

  // móvil completa y Campo: sin botones sobre lo que cargó otro dispositivo
  F.win.renderDetalle(p); C.win.renderDetalle(p);
  const eMuerteF = buscar(F.win, p, 'muerte'), eMuerteC = buscar(C.win, p, 'muerte');
  chequear('la móvil completa NO ganó botones en lo sincronizado',
    !!eMuerteF && !F.win.document.querySelector(`[data-hist-borrar="${eMuerteF.id}"]`) && !F.win.document.querySelector(`[data-hist-editar="${eMuerteF.id}"]`));
  chequear('Campo NO ganó botones en lo sincronizado',
    !!eMuerteC && !C.win.document.querySelector(`[data-hist-borrar="${eMuerteC.id}"]`) && !C.win.document.querySelector(`[data-hist-editar="${eMuerteC.id}"]`));

  // una línea de solo texto (sin extra ni origDatos) sigue sin botones
  const suelto = A.win.registrarHistorial(p, 'ingreso', 'Carga inicial desde planilla: 1 algo', undefined, undefined, hoy);
  A.win.renderDetalle(p);
  chequear('una línea de solo texto no tiene botones', !botones(suelto.id).ed && !botones(suelto.id).bo);
  estado_quitar(A, p, suelto);

  // --- 🏷️ caravana sobre una muerte sincronizada: no se le fabrica un `extra`
  A.win.prompt = () => '87654321';
  A.win.agregarCaravanaMuerte(eMuerte.id);
  chequear('agregar caravana edita origDatos y NO crea un `extra` incompleto',
    !eMuerte.extra && eMuerte.origDatos.caravana === '87654321' && /caravana 87654321/.test(eMuerte.detalle), JSON.stringify(eMuerte));
  A.win.prompt = () => null;
  await dormir(30); // el evento de la caravana se sube un instante después

  // --- borrar la muerte: confirm en falso no hace nada
  const antesMuerte = stock(A.win, p, key);
  const eventosAntes = servidor.filas.eventos_sync.length;
  A.win.confirm = () => false;
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-borrar="${eMuerte.id}"]`));
  await dormir(20);
  chequear('borrar con confirm en falso no cambia nada', stock(A.win, p, key) === antesMuerte && !eMuerte.eliminado && servidor.filas.eventos_sync.length === eventosAntes);
  // --- y con confirm en true revierte el stock exacto
  A.win.confirm = () => true;
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-borrar="${eMuerte.id}"]`));
  await dormir(30);
  chequear('borrar la muerte devuelve las 2 cabezas al potrero', stock(A.win, p, key) === antesMuerte + 2, `${stock(A.win, p, key)} vs ${antesMuerte + 2}`);
  chequear('la entrada queda tachada (ELIMINADO)', eMuerte.eliminado === true && /ELIMINADO/.test(eMuerte.detalle));
  const corr = servidor.filas.eventos_sync.find(f => f.tipo === 'correccion' && f.detalle.tipoOriginal === 'muerte' && f.detalle.accion === 'eliminar');
  chequear('se mandó la corrección con el ajuste inverso',
    !!corr && corr.detalle.reversar && corr.detalle.reversar.tipo === 'sumar' && corr.detalle.reversar.potrero === p
      && corr.detalle.reversar.categoria === cat && corr.detalle.reversar.cantidad === 2, JSON.stringify(corr && corr.detalle));
  await sincronizarTodos(B, F, C);
  chequear('la otra PC converge al mismo stock', stock(B.win, p, key) === stock(A.win, p, key), `${stock(B.win, p, key)} vs ${stock(A.win, p, key)}`);
  chequear('y tacha la muerte en su historial', !!entradas(B.win, p).find(h => h.tipo === 'muerte' && h.eliminado));
  chequear('la móvil y Campo también convergen',
    stock(F.win, p, key) === stock(A.win, p, key) && stock(C.win, p, key) === stock(A.win, p, key));

  // --- borrar un movimiento sincronizado desde el potrero de DESTINO: se tachan las dos puntas
  const pAntes = stock(A.win, p, key), qAntes = stock(A.win, q, key);
  const eMov4q = buscar(A.win, q, 'movimiento_multi', od => od.items && od.items[0].cantidad === 4);
  A.win.renderDetalle(q);
  click(A.win, A.win.document.querySelector(`[data-hist-borrar="${eMov4q.id}"]`));
  await dormir(30);
  chequear('borrar el movimiento devuelve los 4 al origen y los saca del destino',
    stock(A.win, p, key) === pAntes + 4 && stock(A.win, q, key) === qAntes - 4, `p ${stock(A.win, p, key)} (${pAntes + 4}) q ${stock(A.win, q, key)} (${qAntes - 4})`);
  const punta = (win, potrero) => entradas(win, potrero).find(h => h.tipo === 'movimiento_multi' && h.origDatos && h.origDatos.items[0].cantidad === 4);
  chequear('se tachan las DOS puntas del movimiento en la PC', !!punta(A.win, p) && punta(A.win, p).eliminado && punta(A.win, q).eliminado);
  await sincronizarTodos(B, F, C);
  chequear('en la otra PC también quedan tachadas las dos puntas', punta(B.win, p).eliminado && punta(B.win, q).eliminado);
  chequear('y el stock converge', stock(B.win, p, key) === stock(A.win, p, key) && stock(B.win, q, key) === stock(A.win, q, key));

  // --- editar el nacimiento: abre el formulario precargado
  const tAntes = stock(A.win, p, keyTerneros);
  A.win.renderDetalle(p);
  A.win.confirm = () => false;
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eNac.id}"]`));
  chequear('editar con confirm en falso no deshace nada', !eNac.eliminado && stock(A.win, p, keyTerneros) === tAntes);
  A.win.confirm = () => true;
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eNac.id}"]`));
  const d = A.win.document;
  chequear('editar el nacimiento lo deshace (-3 Terneros)', eNac.eliminado && /EDITADO/.test(eNac.detalle) && stock(A.win, p, keyTerneros) === tAntes - 3);
  chequear('y abre el formulario de nacimiento precargado',
    !!d.getElementById('f-cat') && d.getElementById('f-cat').value === 'Terneros' && d.getElementById('f-cant').value === '3'
      && d.getElementById('f-obs').value === 'parto OK' && d.getElementById('f-fecha').value === ISOhoy,
    d.getElementById('form-zona').textContent.replace(/\s+/g, ' ').slice(0, 200));
  d.getElementById('f-cant').value = '5';
  d.getElementById('f-confirmar').click();
  await dormir(30);
  chequear('guardar la corrección deja el stock con la cantidad nueva', stock(A.win, p, keyTerneros) === tAntes - 3 + 5);
  await sincronizarTodos(B, F, C);
  chequear('la otra PC ve el nacimiento corregido', stock(B.win, p, keyTerneros) === stock(A.win, p, keyTerneros), `${stock(B.win, p, keyTerneros)} vs ${stock(A.win, p, keyTerneros)}`);

  // --- editar la compra: precio y contraparte precargados (vienen en origDatos)
  const eCompra = buscar(A.win, p, 'compra');
  const pc0 = stock(A.win, p, key);
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eCompra.id}"]`));
  chequear('editar la compra la deshace (-5)', stock(A.win, p, key) === pc0 - 5);
  const cv = idsCV(A.win);
  chequear('el formulario de compra viene precargado con precio y contraparte',
    d.getElementById(cv.tipo).value === 'Compra' && d.getElementById(cv.cant).value === '5'
      && d.getElementById(cv.precio).value === '800' && d.getElementById(cv.contra).value === 'Fulano',
    d.getElementById('form-zona').innerHTML.slice(0, 300));
  d.getElementById(cv.ok).click();
  await dormir(30);
  chequear('guardar sin cambios deja el stock como estaba', stock(A.win, p, key) === pc0);

  // --- editar la venta cuando origDatos no trae precio (lo guardado antes de este cambio): sale de la transacción
  const eVenta = buscar(A.win, p, 'venta');
  eVenta.origDatos.precio = null; eVenta.origDatos.contraparte = null; delete eVenta.origDatos.obs;
  const pv0 = stock(A.win, p, key);
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eVenta.id}"]`));
  chequear('el formulario de venta recupera precio y contraparte de la transacción',
    d.getElementById(cv.tipo).value === 'Venta' && d.getElementById(cv.precio).value === '900' && d.getElementById(cv.contra).value === 'Mengano',
    d.getElementById('form-zona').innerHTML.slice(0, 300));
  chequear('editar la venta la deshace (+1)', stock(A.win, p, key) === pv0 + 1);
  if(!cv.modal) d.getElementById('f-cancelar').click(); else d.getElementById('guias-cerrar').click();
  chequear('cancelar el formulario deja la venta deshecha (comportamiento de siempre del editar)', stock(A.win, p, key) === pv0 + 1);

  // --- editar un movimiento desde el potrero de DESTINO: se vuelve a cargar desde el ORIGEN
  const eMov1q = buscar(A.win, q, 'movimiento_multi', od => od.items && od.items[0].cantidad === 1);
  const pm0 = stock(A.win, p, key), qm0 = stock(A.win, q, key);
  A.win.renderDetalle(q);
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eMov1q.id}"]`));
  chequear('editar el movimiento lo deshace', stock(A.win, p, key) === pm0 + 1 && stock(A.win, q, key) === qm0 - 1);
  chequear('y tacha las dos puntas', eMov1q.eliminado && punta1(A.win, p).eliminado, '');
  chequear('abre "Mover" en el potrero de ORIGEN con todo precargado',
    /Mover animales desde/.test(d.getElementById('form-zona').textContent) && d.getElementById('form-zona').textContent.includes(p)
      && d.getElementById('f-destino').value === q && d.getElementById('f-obs').value === 'edit-me' && d.getElementById('f-fecha').value === ISOhoy,
    d.getElementById('form-zona').textContent.replace(/\s+/g, ' ').slice(0, 200));
  const marcadas = Array.from(d.querySelectorAll('.mov-check')).filter(c => c.checked);
  chequear('solo la categoría movida está tildada, con su cantidad',
    marcadas.length === 1 && marcadas[0].dataset.key === key && d.querySelector(`.mov-cant[data-key="${key}"]`).value === '1',
    marcadas.map(c => c.dataset.key).join(','));
  d.querySelector(`.mov-cant[data-key="${key}"]`).value = '2';
  d.getElementById('f-confirmar').click();
  await dormir(30);
  chequear('guardar mueve la cantidad corregida', stock(A.win, p, key) === pm0 + 1 - 2 && stock(A.win, q, key) === qm0 - 1 + 2,
    `p ${stock(A.win, p, key)} (${pm0 - 1}) q ${stock(A.win, q, key)} (${qm0 + 1})`);
  function punta1(win, potrero){ return entradas(win, potrero).find(h => h.tipo === 'movimiento_multi' && h.origDatos && h.origDatos.items[0].cantidad === 1); }

  // --- editar el "encontrado": deshace y reabre Desaparecidos (el caso vuelve a quedar pendiente)
  const eEnc = buscar(A.win, q, 'encontrado');
  const qe0 = stock(A.win, q, key);
  A.win.renderDetalle(q);
  chequear('el encontrado sincronizado tiene ✏️ y 🗑', botones(eEnc.id).ed && botones(eEnc.id).bo);
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eEnc.id}"]`));
  chequear('editar el encontrado saca esa cabeza del potrero donde apareció', stock(A.win, q, key) === qe0 - 1);
  chequear('y abre la ventana de Desaparecidos', d.getElementById('modal-desaparecidos').style.display === 'flex');
  const caso = A.win.listarCasosDesaparecidos().find(c => c.casoId === 'caso-prueba-1');
  chequear('el caso vuelve a estar pendiente por las 2', !!caso && caso.pendiente === 2, JSON.stringify(caso));
  d.getElementById('modal-desaparecidos').style.display = 'none';

  // --- editar el desaparecido: formulario precargado
  const eDes = buscar(A.win, p, 'desaparecido');
  const pd0 = stock(A.win, p, key);
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eDes.id}"]`));
  chequear('editar el desaparecido devuelve las 2 cabezas', stock(A.win, p, key) === pd0 + 2);
  chequear('y abre el formulario precargado',
    d.getElementById('f-cant').value === '2' && d.getElementById('f-obs').value === 'cruzó' && d.getElementById('f-cat').value === cat,
    d.getElementById('form-zona').textContent.replace(/\s+/g, ' ').slice(0, 200));
  d.getElementById('f-confirmar').click();
  await dormir(30);
  chequear('guardar vuelve a restarlas', stock(A.win, p, key) === pd0);

  // --- mover TODO: se borra/edita igual
  await inyectar(servidor, estab, 'movimiento_todo', p, { destino: q, items: [{ categoria: cat, dueno: du, cantidad: 3 }] }, hoy);
  await sincronizarTodos(A);
  const eTodo = buscar(A.win, p, 'movimiento_todo');
  const pt0 = stock(A.win, p, key), qt0 = stock(A.win, q, key);
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-editar="${eTodo.id}"]`));
  chequear('editar "Mover TODO" lo deshace', stock(A.win, p, key) === pt0 + 3 && stock(A.win, q, key) === qt0 - 3);
  chequear('y abre "Mover TODO" con destino y fecha precargados',
    /Mover TODO el potrero/.test(d.getElementById('form-zona').textContent) && d.getElementById('f-destino').value === q && d.getElementById('f-fecha').value === ISOhoy,
    d.getElementById('form-zona').textContent.replace(/\s+/g, ' ').slice(0, 200));
  d.getElementById('f-cancelar').click();

  // --- campo ajeno (solo La Vuelta)
  if(dicose){
    await inyectar(servidor, estab, 'envio_campo_ajeno', p, { items: [{ categoria: cat, dueno: du, cantidad: 2 }], guia: 'A123456', obs: 'pastoreo' }, hoy);
    await sincronizarTodos(A);
    const eCA = buscar(A.win, p, 'envio_campo_ajeno');
    const pca0 = stock(A.win, p, key);
    const ajeno0 = (A.win.__est().campoAjeno.animales[key] || 0);
    A.win.renderDetalle(p);
    click(A.win, A.win.document.querySelector(`[data-hist-editar="${eCA.id}"]`));
    chequear('editar un envío a campo ajeno devuelve los animales al potrero y los saca de campo ajeno',
      stock(A.win, p, key) === pca0 + 2 && (A.win.__est().campoAjeno.animales[key] || 0) === ajeno0 - 2);
    chequear('y abre Campo ajeno con tipo, potrero, guía, cantidad y notas precargados',
      d.getElementById('modal-guias').style.display === 'flex' && d.getElementById('campo-ajeno-seccion').style.display === 'block'
        && d.getElementById('mg-modo').value === 'campo_ajeno' && d.getElementById('ca-tipo').value === 'envio'
        && d.getElementById('ca-potrero').value === p && d.getElementById('ca-guia').value === 'A123456'
        && d.getElementById('ca-obs').value === 'pastoreo' && d.querySelectorAll('#ca-filas .ca-fila').length === 1
        && d.querySelector('#ca-filas .ca-cant').value === '2' && d.getElementById('ca-fecha').value === ISOhoy,
      d.getElementById('ca-filas').innerHTML.slice(0, 200));
    d.getElementById('modal-lluvias').style.display = 'none';
  } else {
    console.log('  (campo ajeno: solo La Vuelta -- se saltea)');
  }

  // --- convergencia final de TODO el estado de stock
  await sincronizarTodos(B, F, C, A);
  await sincronizarTodos(B, F, C);
  chequear('al final la otra PC tiene el mismo stock en todos los potreros', foto(B.win) === foto(A.win));
  chequear('la móvil completa también', foto(F.win) === foto(A.win));
  chequear('y Campo también', foto(C.win) === foto(A.win));
}
function estado_quitar(dev, p, entry){
  const h = dev.win.__est().potreros[p].historial;
  const i = h.indexOf(entry);
  if(i >= 0) h.splice(i, 1);
}

/* 6/10/2026: el dispositivo que CARGÓ el evento tiene `extra` (no `origDatos`);
   cuando otro dispositivo lo corrige (acá, la PC) también tiene que tachar su
   propio renglón, no solo corregir el stock. Antes quedaba como vigente. */
async function probarOrigenPropio(A, B, F, C, servidor){
  console.log('  -- el celular que cargó el evento tacha su propio renglón cuando otro lo corrige');
  const geo = F.win.__potrerosGeo();
  let p = null, claves = [];
  for(const g of geo){
    const animales = F.win.__est().potreros[g.nombre].animales;
    const ks = Object.keys(animales).filter(x => animales[x] >= 5);
    if(ks.length && (!p || ks.length > claves.length)){ p = g.nombre; claves = ks; if(ks.length >= 2) break; }
  }
  if(!p){ console.log('  (sin stock suficiente -- se saltea)'); return; }
  const q = geo.map(g => g.nombre).find(n => n !== p);
  const key = claves[0];
  const { cat, dueno: du } = F.win.partesClave(key);
  const ISOhoy = F.win.fechaISOHoy();

  // el celular (móvil completa) carga una muerte y un movimiento (con 1 o 2 categorías) por sus formularios
  F.win.seleccionarPotrero(p);
  F.win.mostrarFormulario(p, 'muerte');
  const f = F.win.document;
  f.getElementById('f-cat').value = cat; f.getElementById('f-dueno').value = du;
  f.getElementById('f-cant').value = '1'; f.getElementById('f-fecha').value = ISOhoy; f.getElementById('f-obs').value = 'propio-1';
  f.getElementById('f-confirmar').click();
  await dormir(30);
  F.win.seleccionarPotrero(p);
  F.win.mostrarFormulario(p, 'mover');
  f.getElementById('f-destino').value = q;
  const aMover = claves.slice(0, 2);
  f.querySelectorAll('.mov-check').forEach(c => { c.checked = aMover.includes(c.dataset.key); });
  f.querySelectorAll('.mov-cant').forEach(i => { if(aMover.includes(i.dataset.key)) i.value = '1'; });
  f.getElementById('f-fecha').value = ISOhoy; f.getElementById('f-obs').value = 'propio-mov';
  f.getElementById('f-confirmar').click();
  await dormir(30);
  const miMuerte = entradas(F.win, p).find(h => h.tipo === 'muerte' && h.extra && h.extra.obs === 'propio-1');
  const miMov = entradas(F.win, q).find(h => h.tipo === 'movimiento_multi' && h.extra && h.extra.obs === 'propio-mov');
  chequear('el celular cargó la muerte y el movimiento por sus formularios', !!miMuerte && !!miMov && miMov.extra.items.length === aMover.length);

  // la PC los sincroniza y los borra
  await sincronizarTodos(A);
  A.win.confirm = () => true;
  const suMuerte = entradas(A.win, p).find(h => h.tipo === 'muerte' && h.origDatos && h.origDatos.obs === 'propio-1');
  const suMov = entradas(A.win, q).find(h => h.tipo === 'movimiento_multi' && h.origDatos && h.origDatos.obs === 'propio-mov');
  A.win.renderDetalle(p);
  click(A.win, A.win.document.querySelector(`[data-hist-borrar="${suMuerte.id}"]`));
  A.win.renderDetalle(q);
  click(A.win, A.win.document.querySelector(`[data-hist-borrar="${suMov.id}"]`));
  await dormir(40);
  // Postgres (jsonb) reordena las claves de lo que viaja por eventos_sync: se imita acá
  servidor.filas.eventos_sync.filter(r => r.tipo === 'correccion' && r.detalle.reversar && r.detalle.reversar.items).forEach(r => {
    r.detalle.reversar.items = r.detalle.reversar.items.map(it => {
      const o = {}; Object.keys(it).reverse().forEach(k => { o[k] = it[k]; }); return o;
    });
  });

  await sincronizarTodos(F);
  chequear('la muerte propia queda tachada en el celular que la cargó', miMuerte.eliminado === true && /ELIMINADO/.test(miMuerte.detalle), miMuerte.detalle);
  chequear('el movimiento propio queda tachado en sus dos puntas', miMov.eliminado === true &&
    entradas(F.win, p).filter(h => h.tipo === 'movimiento_multi' && h.extra && h.extra.obs === 'propio-mov').every(h => h.eliminado), JSON.stringify(entradas(F.win, p).slice(0, 2)));
  chequear('y no se agrega la línea suelta "Corrección (sincronizada)"', !entradas(F.win, p).some(h => h.tipo === 'correccion') && !entradas(F.win, q).some(h => h.tipo === 'correccion'));
  chequear('el stock del celular coincide con el de la PC', foto(F.win) === foto(A.win));
}

/* 6/10/2026: borrar/editar una compra o venta también saca el registro de
   estado.transacciones (lo que cuenta el reporte económico de la PC), en el
   dispositivo que lo hace y en los demás al sincronizar. Antes la venta borrada
   seguía contando y al editar quedaba duplicada. */
async function probarTransacciones(A, B, F, C, servidor){
  console.log('  -- compra/venta: el registro de transacciones se corrige al borrar y al editar');
  const estab = A.win.__establecimiento();
  const geo = A.win.__potrerosGeo();
  let p = null, key = null;
  for(const g of geo){
    const animales = A.win.__est().potreros[g.nombre].animales;
    const k = Object.keys(animales).find(x => animales[x] >= 10);
    if(k){ p = g.nombre; key = k; break; }
  }
  if(!p){ console.log('  (sin stock suficiente -- se saltea)'); return; }
  const { cat, dueno: du } = A.win.partesClave(key);
  const hoy = A.win.fechaHoy(), ISOhoy = A.win.fechaISOHoy();
  const cuantas = (win, marca) => (win.__est().transacciones || []).filter(t => t.contraparte === marca).length;
  const d = A.win.document;
  const botonDe = (win, potrero, id, cual) => { win.renderDetalle(potrero); return win.document.querySelector(`[data-hist-${cual}="${id}"]`); };
  A.win.confirm = () => true;

  // 1) una compra cargada en la propia PC, y se borra
  const cvl = idsCV(A.win);
  abrirCompraVenta(A.win, p);
  d.getElementById(cvl.tipo).value = 'Compra'; d.getElementById(cvl.cat).value = cat; d.getElementById(cvl.dueno).value = du;
  d.getElementById(cvl.cant).value = '3'; d.getElementById(cvl.fecha).value = ISOhoy;
  d.getElementById(cvl.precio).value = '700'; d.getElementById(cvl.contra).value = 'T-local';
  d.getElementById(cvl.ok).click();
  await dormir(30);
  chequear('la compra cargada en la PC genera su transacción', cuantas(A.win, 'T-local') === 1);
  const eLocal = entradas(A.win, p).find(h => h.tipo === 'compra' && h.extra && h.extra.contraparte === 'T-local');
  click(A.win, botonDe(A.win, p, eLocal.id, 'borrar'));
  await dormir(30);
  chequear('borrarla saca también su transacción', cuantas(A.win, 'T-local') === 0);

  // 2) una venta que cargó otro dispositivo: se borra desde la PC y las demás apps la sacan al sincronizar
  await inyectar(servidor, estab, 'venta', p, { categoria: cat, dueno: du, cantidad: 2, precio: 950, contraparte: 'T-remota', obs: null, guia: null }, hoy);
  await sincronizarTodos(A, B, F, C);
  chequear('la venta de otro dispositivo está en las transacciones de las 4 apps',
    [A, B, F, C].every(dev => cuantas(dev.win, 'T-remota') === 1), [A, B, F, C].map(dev => cuantas(dev.win, 'T-remota')).join(','));
  const eRemota = entradas(A.win, p).find(h => h.tipo === 'venta' && h.origDatos && h.origDatos.contraparte === 'T-remota');
  click(A.win, botonDe(A.win, p, eRemota.id, 'borrar'));
  await dormir(40);
  chequear('borrar la venta saca su transacción de la PC', cuantas(A.win, 'T-remota') === 0);
  await sincronizarTodos(B, F, C);
  chequear('y de la otra PC, la móvil y Campo cuando sincronizan', [B, F, C].every(dev => cuantas(dev.win, 'T-remota') === 0),
    [B, F, C].map(dev => cuantas(dev.win, 'T-remota')).join(','));

  // 3) editar una compra: no queda duplicada
  await inyectar(servidor, estab, 'compra', p, { categoria: cat, dueno: du, cantidad: 4, precio: 600, contraparte: 'T-editar', obs: null, guia: null }, hoy);
  await sincronizarTodos(A, B);
  chequear('la compra de otro dispositivo tiene su transacción', cuantas(A.win, 'T-editar') === 1);
  const eEd = entradas(A.win, p).find(h => h.tipo === 'compra' && h.origDatos && h.origDatos.contraparte === 'T-editar');
  click(A.win, botonDe(A.win, p, eEd.id, 'editar'));
  chequear('al editar, la transacción vieja se saca', cuantas(A.win, 'T-editar') === 0);
  const cve = idsCV(A.win);
  chequear('y el formulario viene con precio y contraparte', d.getElementById(cve.precio).value === '600' && d.getElementById(cve.contra).value === 'T-editar');
  d.getElementById(cve.ok).click();
  await dormir(30);
  chequear('al guardar la corrección queda UNA transacción, no dos', cuantas(A.win, 'T-editar') === 1, String(cuantas(A.win, 'T-editar')));
  await sincronizarTodos(B, F, C);
  chequear('las demás apps también quedan con una sola', [B, F, C].every(dev => cuantas(dev.win, 'T-editar') === 1),
    [B, F, C].map(dev => cuantas(dev.win, 'T-editar')).join(','));
}

/* 6/10/2026 (solo La Vuelta, DICOSE): borrar/editar un envío o retorno a campo
   ajeno también saca su renglón de la lista "🌾 Campo ajeno"
   (estado.campoAjeno.historial), en el dispositivo que lo hace y en los demás. */
async function probarCampoAjenoLista(A, B, F, C, servidor){
  if(!A.win.__config().dicoseHabilitado){ console.log('  (campo ajeno: solo La Vuelta -- se saltea)'); return; }
  console.log('  -- campo ajeno: la lista se corrige al borrar y al editar');
  const estab = A.win.__establecimiento();
  let p = null, key = null;
  for(const g of A.win.__potrerosGeo()){
    const animales = A.win.__est().potreros[g.nombre].animales;
    const k = Object.keys(animales).find(x => animales[x] >= 10);
    if(k){ p = g.nombre; key = k; break; }
  }
  if(!p){ console.log('  (sin stock suficiente -- se saltea)'); return; }
  const { cat, dueno: du } = A.win.partesClave(key);
  const hoy = A.win.fechaHoy(), ISOhoy = A.win.fechaISOHoy();
  const d = A.win.document;
  const cuantos = (win, marca) => ((win.__est().campoAjeno || {}).historial || []).filter(m => m.obs === marca).length;
  const boton = (potrero, id, cual) => { A.win.renderDetalle(potrero); return A.win.document.querySelector(`[data-hist-${cual}="${id}"]`); };
  A.win.confirm = () => true;

  // 1) un envío cargado en la propia PC, y se borra
  click(A.win, d.getElementById('btn-guias'));
  d.getElementById('mg-modo').value = 'campo_ajeno'; d.getElementById('mg-modo').dispatchEvent(new A.win.Event('change', { bubbles: true }));
  d.getElementById('ca-tipo').value = 'envio'; d.getElementById('ca-potrero').value = p;
  d.querySelector('#ca-filas .ca-cat').value = cat; d.querySelector('#ca-filas .ca-dueno').value = du; d.querySelector('#ca-filas .ca-cant').value = '2';
  d.getElementById('ca-fecha').value = ISOhoy; d.getElementById('ca-obs').value = 'CA-local';
  d.getElementById('ca-guardar').click();
  await dormir(30);
  chequear('el envío cargado en la PC aparece en la lista', cuantos(A.win, 'CA-local') === 1);
  const eLocal = entradas(A.win, p).find(h => h.tipo === 'envio_campo_ajeno' && h.extra && h.extra.obs === 'CA-local');
  click(A.win, boton(p, eLocal.id, 'borrar'));
  await dormir(30);
  chequear('borrarlo desde el historial lo saca también de la lista "Campo ajeno"', cuantos(A.win, 'CA-local') === 0);

  // 2) un retorno que cargó otro dispositivo: se borra desde la PC y las demás apps lo sacan al sincronizar
  await inyectar(servidor, estab, 'retorno_campo_ajeno', p, { items: [{ categoria: cat, dueno: du, cantidad: 1 }], guia: null, obs: 'CA-remoto' }, hoy);
  await sincronizarTodos(A, B, F, C);
  chequear('el retorno de otro dispositivo está en la lista de las 4 apps', [A, B, F, C].every(dev => cuantos(dev.win, 'CA-remoto') === 1),
    [A, B, F, C].map(dev => cuantos(dev.win, 'CA-remoto')).join(','));
  const eRem = entradas(A.win, p).find(h => h.tipo === 'retorno_campo_ajeno' && h.origDatos && h.origDatos.obs === 'CA-remoto');
  click(A.win, boton(p, eRem.id, 'borrar'));
  await dormir(40);
  chequear('borrarlo lo saca de la lista de la PC', cuantos(A.win, 'CA-remoto') === 0);
  // Postgres (jsonb) reordena las claves de los items que viajan por eventos_sync: se imita acá
  servidor.filas.eventos_sync.filter(r => r.tipo === 'correccion' && r.detalle.reversar && r.detalle.reversar.items).forEach(r => {
    r.detalle.reversar.items = r.detalle.reversar.items.map(it => { const o = {}; Object.keys(it).reverse().forEach(k => { o[k] = it[k]; }); return o; });
  });
  await sincronizarTodos(B, F, C);
  chequear('y de la otra PC, la móvil y Campo cuando sincronizan', [B, F, C].every(dev => cuantos(dev.win, 'CA-remoto') === 0),
    [B, F, C].map(dev => cuantos(dev.win, 'CA-remoto')).join(','));

  // 3) editar un envío: no queda duplicado en la lista
  await inyectar(servidor, estab, 'envio_campo_ajeno', p, { items: [{ categoria: cat, dueno: du, cantidad: 2 }], guia: 'A654321', obs: 'CA-editar' }, hoy);
  await sincronizarTodos(A, B);
  chequear('el envío de otro dispositivo está en la lista', cuantos(A.win, 'CA-editar') === 1);
  const eEd = entradas(A.win, p).find(h => h.tipo === 'envio_campo_ajeno' && h.origDatos && h.origDatos.obs === 'CA-editar');
  click(A.win, boton(p, eEd.id, 'editar'));
  chequear('al editar, el renglón viejo sale de la lista', cuantos(A.win, 'CA-editar') === 0);
  chequear('y el formulario viene precargado', d.getElementById('ca-obs').value === 'CA-editar' && d.getElementById('ca-guia').value === 'A654321');
  d.getElementById('ca-guardar').click();
  await dormir(30);
  chequear('al guardar la corrección queda UN renglón, no dos', cuantos(A.win, 'CA-editar') === 1, String(cuantos(A.win, 'CA-editar')));
  await sincronizarTodos(B, F, C);
  chequear('las demás apps también quedan con uno solo', [B, F, C].every(dev => cuantos(dev.win, 'CA-editar') === 1),
    [B, F, C].map(dev => cuantos(dev.win, 'CA-editar')).join(','));
}

/* 6/10/2026: borrar una "pérdida" o una "muerte de desaparecido" no toca stock
   (ya se había restado al desaparecer), así que su corrección no llevaba
   `reversar` y los demás dispositivos no sabían qué renglón tachar: el caso
   seguía resuelto en un lado y pendiente en otro. Ahora la corrección lleva
   casoId y cantidad. */
async function probarResolucionesDesaparecidos(A, B, F, C, servidor){
  console.log('  -- desaparecidos: borrar una pérdida o una muerte se refleja en los otros dispositivos');
  const estab = A.win.__establecimiento();
  let p = null, key = null;
  for(const g of A.win.__potrerosGeo()){
    const animales = A.win.__est().potreros[g.nombre].animales;
    const k = Object.keys(animales).find(x => animales[x] >= 10);
    if(k){ p = g.nombre; key = k; break; }
  }
  if(!p){ console.log('  (sin stock suficiente -- se saltea)'); return; }
  const { cat, dueno: du } = A.win.partesClave(key);
  const hoy = A.win.fechaHoy(), ISOhoy = A.win.fechaISOHoy();
  const pendiente = (win, casoId) => { const c = win.listarCasosDesaparecidos().find(x => x.casoId === casoId); return c ? c.pendiente : 0; };
  const boton = (id) => { A.win.renderDetalle(p); return A.win.document.querySelector(`[data-hist-borrar="${id}"]`); };
  A.win.confirm = () => true;

  // 1) el celular (móvil completa) declara un desaparecido y lo da por perdido desde Desaparecidos
  F.win.seleccionarPotrero(p);
  F.win.mostrarFormulario(p, 'desaparecido');
  const f = F.win.document;
  f.getElementById('f-cat').value = cat; f.getElementById('f-dueno').value = du;
  f.getElementById('f-cant').value = '2'; f.getElementById('f-fecha').value = ISOhoy; f.getElementById('f-obs').value = 'DES-propio';
  f.getElementById('f-confirmar').click();
  await dormir(30);
  const desF = entradas(F.win, p).find(h => h.tipo === 'desaparecido' && h.extra && h.extra.obs === 'DES-propio');
  F.win.renderDesaparecidosLista();
  click(F.win, f.querySelector(`[data-perdido="${desF.id}"]`));
  await dormir(30);
  const perdidaF = entradas(F.win, p).find(h => h.tipo === 'perdida' && h.casoId === desF.id);
  chequear('el celular declaró el desaparecido y lo cerró como pérdida', !!perdidaF && pendiente(F.win, desF.id) === 0);
  await sincronizarTodos(A, B, C);
  const perdidaA = entradas(A.win, p).find(h => h.tipo === 'perdida' && h.casoId === desF.id);
  chequear('la PC ve la pérdida con ✏️ y 🗑', !!perdidaA && !!boton(perdidaA.id) );
  click(A.win, boton(perdidaA.id));
  await dormir(40);
  chequear('la PC la borra y el caso vuelve a quedar pendiente por las 2', perdidaA.eliminado === true && pendiente(A.win, desF.id) === 2, String(pendiente(A.win, desF.id)));
  await sincronizarTodos(F, B, C);
  chequear('el celular que la cargó también tacha su pérdida', perdidaF.eliminado === true && /ELIMINADO/.test(perdidaF.detalle), perdidaF.detalle);
  chequear('y en el celular el caso vuelve a figurar pendiente', pendiente(F.win, desF.id) === 2, String(pendiente(F.win, desF.id)));
  chequear('la otra PC y Campo también lo ven pendiente', pendiente(B.win, desF.id) === 2 && pendiente(C.win, desF.id) === 2,
    pendiente(B.win, desF.id) + ',' + pendiente(C.win, desF.id));
  chequear('y no queda la línea suelta "Corrección (sincronizada)" en el celular', !entradas(F.win, p).some(h => h.tipo === 'correccion'));

  // 2) un caso resuelto en partes: se borra solo la muerte (1), la pérdida (2) sigue
  await inyectar(servidor, estab, 'desaparecido', p, { categoria: cat, dueno: du, cantidad: 3, obs: 'DES-partes', casoId: 'caso-prueba-partes' }, hoy);
  await inyectar(servidor, estab, 'muerte_desaparecido', p, { categoria: cat, dueno: du, cantidad: 1, caravana: null, casoId: 'caso-prueba-partes' }, hoy);
  await inyectar(servidor, estab, 'perdida', p, { categoria: cat, dueno: du, cantidad: 2, casoId: 'caso-prueba-partes' }, hoy);
  await sincronizarTodos(A, B, F, C);
  chequear('el caso en partes está resuelto en las 4 apps', [A, B, F, C].every(dev => pendiente(dev.win, 'caso-prueba-partes') === 0));
  const muerteA = entradas(A.win, p).find(h => h.tipo === 'muerte_desaparecido' && h.casoId === 'caso-prueba-partes');
  click(A.win, boton(muerteA.id));
  await dormir(40);
  await sincronizarTodos(B, F, C);
  chequear('borrar solo la muerte deja pendiente 1 en las 4 apps (se tachó la correcta)',
    [A, B, F, C].every(dev => pendiente(dev.win, 'caso-prueba-partes') === 1), [A, B, F, C].map(dev => pendiente(dev.win, 'caso-prueba-partes')).join(','));
  chequear('la pérdida de 2 sigue vigente en la otra PC', !!entradas(B.win, p).find(h => h.tipo === 'perdida' && h.casoId === 'caso-prueba-partes' && !h.eliminado));
  // 3) borrar/editar el DESAPARECIDO con resoluciones vivas se bloquea (dejaría las resoluciones huérfanas y duplicaría stock)
  const desA = entradas(A.win, p).find(h => h.tipo === 'desaparecido' && h.id === 'caso-prueba-partes');
  const stockAntes = stock(A.win, p, key), eventosAntes = servidor.filas.eventos_sync.length;
  A.win.borrarHistorial(desA.id); // (el historial solo dibuja las 15 más recientes: se llama a la misma función que el botón 🗑)
  chequear('borrar el desaparecido con una pérdida cargada se bloquea y avisa',
    !desA.eliminado && stock(A.win, p, key) === stockAntes && /resolución/.test(A.win.document.getElementById('toast').textContent),
    A.win.document.getElementById('toast').textContent);
  A.win.editarHistorial(desA.id);
  chequear('editarlo también se bloquea, sin deshacer nada', !desA.eliminado && stock(A.win, p, key) === stockAntes && servidor.filas.eventos_sync.length === eventosAntes);
  // se deshace la resolución que quedaba (la pérdida de 2) y recién ahí se puede borrar
  const perdidaViva = entradas(A.win, p).find(h => h.tipo === 'perdida' && h.casoId === 'caso-prueba-partes' && !h.eliminado);
  A.win.borrarHistorial(perdidaViva.id);
  await dormir(40);
  A.win.borrarHistorial(desA.id);
  await dormir(40);
  chequear('sin resoluciones vivas, borrar el desaparecido devuelve las 3 cabezas', desA.eliminado === true && stock(A.win, p, key) === stockAntes + 3,
    `${stock(A.win, p, key)} vs ${stockAntes + 3}`);
  await sincronizarTodos(B, F, C);
  chequear('y las otras apps quedan con el mismo stock', [B, F, C].every(dev => stock(dev.win, p, key) === stock(A.win, p, key)),
    [B, F, C].map(dev => stock(dev.win, p, key)).join(',') + ' vs ' + stock(A.win, p, key));
}

async function probarAbortosYClima(A, B, F, C, servidor){
  console.log('  -- abortos y otros eventos (helada, granizo...)');
  const d = A.win.document;
  const hoy = new Date();
  const anioT = (hoy.getMonth() + 1) >= 8 ? hoy.getFullYear() : hoy.getFullYear() - 1;
  const fechaTemporada = `${anioT}-09-15`;
  const abrir = () => click(A.win, d.getElementById('btn-lluvias'));
  abrir();
  chequear('los botones "Cancelar edición" de aborto y evento existen en la PC', !!d.getElementById('ab-cancelar-edicion') && !!d.getElementById('ev-cancelar-edicion'));

  const cargarAborto = (cant, obs) => {
    d.getElementById('ab-motivo').value = 'feto_visto';
    d.getElementById('ab-cantidad').value = String(cant);
    d.getElementById('ab-fecha').value = fechaTemporada;
    d.getElementById('ab-obs').value = obs;
    d.getElementById('ab-guardar').click();
  };
  cargarAborto(2, 'potrero 9'); await dormir(8);
  cargarAborto(1, 'otro'); await dormir(30);
  const abortos = A.win.__est().abortos;
  chequear('hay 2 abortos cargados', abortos.length === 2);
  const ab2 = abortos.find(a => a.cantidad === 2), ab1 = abortos.find(a => a.cantidad === 1);
  chequear('cada renglón tiene ✏️ y 🗑', !!d.querySelector(`[data-aborto-editar="${ab2.id}"]`) && !!d.querySelector(`[data-aborto-borrar="${ab2.id}"]`));
  let nac = await A.win.calcularEstadisticasNacimientos();
  chequear('Stock total cuenta 3 abortos', nac.bovino.abortos === 3, String(nac.bovino.abortos));

  // editar
  click(A.win, d.querySelector(`[data-aborto-editar="${ab2.id}"]`));
  chequear('editar precarga cantidad, motivo, fecha y notas',
    d.getElementById('ab-cantidad').value === '2' && d.getElementById('ab-motivo').value === 'feto_visto'
      && d.getElementById('ab-fecha').value === fechaTemporada && d.getElementById('ab-obs').value === 'potrero 9');
  chequear('el botón pasa a "Guardar corrección" y aparece "Cancelar edición"',
    d.getElementById('ab-guardar').textContent === 'Guardar corrección' && d.getElementById('ab-cancelar-edicion').style.display !== 'none');
  d.getElementById('ab-cantidad').value = '5';
  d.getElementById('ab-motivo').value = 'no_prenada';
  d.getElementById('ab-guardar').click();
  await dormir(30);
  const abEd = A.win.__est().abortos.find(a => a.id === ab2.id);
  chequear('editar corrige cantidad y motivo en el mismo registro', A.win.__est().abortos.length === 2 && abEd.cantidad === 5 && abEd.motivo === 'no_prenada', JSON.stringify(abEd));
  chequear('se mandó aborto_editado',
    servidor.filas.eventos_sync.some(f => f.tipo === 'aborto_editado' && f.detalle.id === ab2.id && f.detalle.cantidad === 5 && f.detalle.motivo === 'no_prenada'));
  chequear('el botón vuelve a "Registrar aborto"', d.getElementById('ab-guardar').textContent === 'Registrar aborto' && d.getElementById('ab-cancelar-edicion').style.display === 'none');
  nac = await A.win.calcularEstadisticasNacimientos();
  chequear('el % de abortos se recalcula con lo editado (5+1)', nac.bovino.abortos === 6, String(nac.bovino.abortos));

  // "Cancelar edición"
  click(A.win, d.querySelector(`[data-aborto-editar="${ab2.id}"]`));
  click(A.win, d.getElementById('ab-cancelar-edicion'));
  chequear('"Cancelar edición" sale del modo edición sin tocar nada', d.getElementById('ab-guardar').textContent === 'Registrar aborto' && A.win.__est().abortos.find(a => a.id === ab2.id).cantidad === 5);

  // borrar: confirm en falso y en true
  const nEventos = servidor.filas.eventos_sync.length;
  A.win.confirm = () => false;
  click(A.win, d.querySelector(`[data-aborto-borrar="${ab1.id}"]`));
  chequear('borrar con confirm en falso no cambia nada', A.win.__est().abortos.length === 2 && servidor.filas.eventos_sync.length === nEventos);
  A.win.confirm = () => true;
  click(A.win, d.querySelector(`[data-aborto-borrar="${ab1.id}"]`));
  await dormir(30);
  chequear('borrar saca el aborto', A.win.__est().abortos.length === 1 && !A.win.__est().abortos.some(a => a.id === ab1.id));
  chequear('se mandó aborto_eliminado', servidor.filas.eventos_sync.some(f => f.tipo === 'aborto_eliminado' && f.detalle.id === ab1.id));
  nac = await A.win.calcularEstadisticasNacimientos();
  chequear('el % de abortos baja a 5', nac.bovino.abortos === 5, String(nac.bovino.abortos));

  // eventos climáticos
  const cargarClima = (tipo, obs) => {
    d.getElementById('ev-tipo').value = tipo; d.getElementById('ev-obs').value = obs;
    d.getElementById('ev-fecha').value = A.win.fechaISOHoy(); d.getElementById('ev-guardar').click();
  };
  cargarClima('Helada', 'fuerte'); await dormir(8);
  cargarClima('Granizo', 'chico'); await dormir(30);
  const climas = A.win.__est().eventosClima;
  const helada = climas.find(e => e.tipo === 'Helada'), granizo = climas.find(e => e.tipo === 'Granizo');
  chequear('cada evento climático tiene ✏️ y 🗑', !!d.querySelector(`[data-clima-editar="${helada.id}"]`) && !!d.querySelector(`[data-clima-borrar="${helada.id}"]`));
  click(A.win, d.querySelector(`[data-clima-editar="${helada.id}"]`));
  chequear('editar el evento precarga tipo y notas', d.getElementById('ev-tipo').value === 'Helada' && d.getElementById('ev-obs').value === 'fuerte' && d.getElementById('ev-guardar').textContent === 'Guardar corrección');
  d.getElementById('ev-tipo').value = 'Sequía'; d.getElementById('ev-obs').value = 'larga';
  d.getElementById('ev-guardar').click();
  await dormir(30);
  const climaEd = A.win.__est().eventosClima.find(e => e.id === helada.id);
  chequear('editar corrige tipo y notas en el mismo registro', A.win.__est().eventosClima.length === 2 && climaEd.tipo === 'Sequía' && climaEd.obs === 'larga', JSON.stringify(climaEd));
  chequear('se mandó evento_clima_editado', servidor.filas.eventos_sync.some(f => f.tipo === 'evento_clima_editado' && f.detalle.id === helada.id && f.detalle.tipo === 'Sequía'));
  A.win.confirm = () => false;
  click(A.win, d.querySelector(`[data-clima-borrar="${granizo.id}"]`));
  chequear('borrar el evento con confirm en falso no cambia nada', A.win.__est().eventosClima.length === 2);
  A.win.confirm = () => true;
  click(A.win, d.querySelector(`[data-clima-borrar="${granizo.id}"]`));
  await dormir(30);
  chequear('borrar saca el evento y manda evento_clima_eliminado',
    A.win.__est().eventosClima.length === 1 && servidor.filas.eventos_sync.some(f => f.tipo === 'evento_clima_eliminado' && f.detalle.id === granizo.id));

  // todos los demás dispositivos aplican lo editado/borrado
  await sincronizarTodos(B, F, C);
  for(const [nombre, dev] of [['la otra PC', B], ['la móvil completa', F], ['Campo', C]]){
    const e = dev.win.__est();
    chequear(`${nombre}: queda 1 aborto, con la cantidad editada`, e.abortos.length === 1 && e.abortos[0].cantidad === 5 && e.abortos[0].motivo === 'no_prenada', JSON.stringify(e.abortos));
    chequear(`${nombre}: queda 1 evento climático, editado`, e.eventosClima.length === 1 && e.eventosClima[0].tipo === 'Sequía' && e.eventosClima[0].obs === 'larga', JSON.stringify(e.eventosClima));
  }
  const nacB = await B.win.calcularEstadisticasNacimientos();
  const nacF = await F.win.calcularEstadisticasNacimientos();
  chequear('el % de abortos de la otra PC coincide (5)', nacB.bovino.abortos === 5, String(nacB.bovino.abortos));
  chequear('el % de abortos de la móvil completa coincide (5)', nacF.bovino.abortos === 5, String(nacF.bovino.abortos));

  // la móvil completa NO gana botones de editar/borrar en esas listas
  click(F.win, F.win.document.getElementById('btn-lluvias'));
  chequear('la móvil completa no tiene ✏️/🗑 en abortos ni en eventos climáticos',
    !F.win.document.querySelector('[data-aborto-editar],[data-aborto-borrar],[data-clima-editar],[data-clima-borrar]') && !F.win.document.getElementById('ab-cancelar-edicion'));

  // un evento de edición sobre algo que este dispositivo no conoce no rompe nada
  C.win.aplicarEventoRemoto({ tipo: 'aborto_editado', potrero: 'x', dispositivo: 'otro', detalle: { id: 'no-existe', fecha: '01/09/2026', motivo: 'feto_visto', cantidad: 1 } });
  C.win.aplicarEventoRemoto({ tipo: 'evento_clima_eliminado', potrero: 'x', dispositivo: 'otro', detalle: { id: 'no-existe' } });
  chequear('editar/borrar un id desconocido se ignora', C.win.__est().abortos.length === 1 && C.win.__est().eventosClima.length === 1);
}

async function probarEstablecimiento(archivoPc){
  console.log('\n=== ' + archivoPc + ' ===');
  const base = archivoPc.replace(/-pc[\\/]index\.html$/, '');
  const archivoMovil = base + '-movil/index.html';
  const archivoCampo = base + '-movil-campo/index.html';
  for(const f of [archivoMovil, archivoCampo]){
    if(!fs.existsSync(f)){ chequear('existe ' + f, false, 'no se encontró'); return; }
  }
  const servidor = crearServidor();
  const A = await levantar(archivoPc, servidor);
  const B = await levantar(archivoPc, servidor);
  const F = await levantar(archivoMovil, servidor);
  const C = await levantar(archivoCampo, servidor);
  const errores = [...A.errores, ...B.errores, ...F.errores, ...C.errores];
  chequear('las 4 apps (2 PC, móvil completa, Campo) cargan sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  if(A.win.__potrerosGeo().length){
    await probarHistorial(A, B, F, C, servidor);
    await probarOrigenPropio(A, B, F, C, servidor);
    await probarTransacciones(A, B, F, C, servidor);
    await probarCampoAjenoLista(A, B, F, C, servidor);
    await probarResolucionesDesaparecidos(A, B, F, C, servidor);
  }
  else console.log('  (sin potreros seedeados -- se saltea la parte de historial)');
  await probarAbortosYClima(A, B, F, C, servidor);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarEstablecimiento(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
