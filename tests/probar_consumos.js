/*
 * Prueba ad-hoc: "Consumos" en "Lluvias y otros eventos" (11/10/2026, a pedido de Pedro):
 * ovinos (y eventualmente un vacuno) que se faenan para el consumo del establecimiento.
 * Resta del stock del potrero como una muerte, pero es otro evento ('consumo') con su
 * propio resumen por ejercicio (1/jul a 30/jun). Cubre:
 *   - el formulario resta del stock y manda el evento con potrero/categoría/dueño/cantidad;
 *   - no deja consumir más de lo que hay;
 *   - otro dispositivo recibe el mismo stock;
 *   - el resumen suma por categoría/especie/mes y solo cuenta el ejercicio actual;
 *   - borrar y editar (PC) devuelven el stock y descuentan del resumen sin duplicar;
 *   - una muerte NO suma a consumos y un consumo NO suma a muertes;
 *   - Campo no tiene la sección.
 *
 * Uso: node probar_consumos.js la-vuelta-pc/index.html maria-laura-pc/index.html [...]
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



async function resumen(win){
  const { filas } = await win.leerConsumos();
  return win.resumirConsumos(filas, new Date());
}

async function probarConsumos(archivoPc){
  console.log('\n=== ' + archivoPc + ' ===');
  const base = archivoPc.replace(/-pc[\\/]index\.html$/, '');
  const archivoMovil = base + '-movil/index.html';
  const archivoCampo = base + '-movil-campo/index.html';
  const servidor = crearServidor();
  const A = await levantar(archivoPc, servidor);
  const B = await levantar(archivoPc, servidor);
  const F = await levantar(archivoMovil, servidor);
  const errores = [...A.errores, ...B.errores, ...F.errores];
  chequear('las 3 apps cargan sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  for(const w of [A.win, F.win]){
    chequear('tiene la sección Consumos', !!w.document.getElementById('co-guardar') && !!w.document.getElementById('consumos-resumen'));
  }
  const C = await levantar(archivoCampo, servidor);
  chequear('Campo no tiene la sección Consumos', C.errores.length === 0 && !C.win.document.getElementById('co-guardar'));

  const geo = A.win.__potrerosGeo();
  if(!geo.length){ console.log('  (sin potreros seedeados -- se saltea)'); return; }
  const estab = A.win.__establecimiento();
  let p = null, du = '';
  for(const g of geo){
    const animales = A.win.__est().potreros[g.nombre].animales;
    const k = Object.keys(animales).find(x => animales[x] > 0);
    if(k){ p = g.nombre; du = A.win.partesClave(k).dueno; break; }
  }
  const hoy = A.win.fechaHoy();
  // stock para consumir: ovejas y vacas, inyectados como si los hubiera cargado otro dispositivo
  await inyectar(servidor, estab, 'ingreso', p, { categoria: 'Ovejas', dueno: du, cantidad: 10 }, hoy);
  await inyectar(servidor, estab, 'ingreso', p, { categoria: 'Vacas', dueno: du, cantidad: 3 }, hoy);
  await inyectar(servidor, estab, 'ingreso', p, { categoria: 'Capones', dueno: du, cantidad: 5 }, hoy);
  await A.win.sincronizar(false);
  const keyO = A.win.claveAnimal('Ovejas', du), keyV = A.win.claveAnimal('Vacas', du);
  const o0 = stock(A.win, p, keyO), v0 = stock(A.win, p, keyV);
  chequear('hay ovejas y vacas para probar', o0 >= 10 && v0 >= 3, o0 + '/' + v0);

  const doc = A.win.document;
  const abrir = () => { doc.getElementById('btn-lluvias').click(); };
  const poner = (id, v) => { const e = doc.getElementById(id); e.value = v; e.dispatchEvent(new A.win.Event('change', { bubbles: true })); };
  const cargar = async (cat, cant, obs) => {
    abrir();
    poner('co-potrero', p); poner('co-cat', cat); poner('co-dueno', du);
    doc.getElementById('co-cant').value = String(cant);
    doc.getElementById('co-obs').value = obs || '';
    click(A.win, doc.getElementById('co-guardar'));
    await dormir(60);
  };

  const r0 = await resumen(A.win);
  // 1. un consumo de ovinos
  await cargar('Ovejas', 3, 'PRUEBA consumo');
  chequear('resta del stock del potrero', stock(A.win, p, keyO) === o0 - 3, stock(A.win, p, keyO) + ' vs ' + (o0 - 3));
  const ev = servidor.filas.eventos_sync.filter(f => f.tipo === 'consumo');
  chequear('manda el evento consumo con potrero/categoría/dueño/cantidad',
    ev.length === 1 && ev[0].potrero === p && ev[0].detalle.categoria === 'Ovejas' && ev[0].detalle.cantidad === 3 && (ev[0].detalle.dueno || '') === du, JSON.stringify(ev[0]));
  chequear('queda en el historial del potrero', entradas(A.win, p).some(h => h.tipo === 'consumo' && /Consumo: -3 Ovejas/.test(h.detalle)));
  chequear('NO se registra como muerte', !servidor.filas.eventos_sync.some(f => f.tipo === 'muerte'));
  const m = await A.win.calcularEstadisticasMuertes();
  chequear('y no suma a las muertes', m.bovino === 0 && m.ovino === 0, JSON.stringify([m.bovino, m.ovino]));

  // 2. no deja consumir más de lo que hay
  const antes = servidor.filas.eventos_sync.length;
  await cargar('Ovejas', o0 + 50, '');
  chequear('no deja consumir más de lo que hay', servidor.filas.eventos_sync.length === antes && stock(A.win, p, keyO) === o0 - 3);

  // 3. un vacuno, eventualmente
  await cargar('Vacas', 1, 'PRUEBA vacuno');
  chequear('también se puede faenar un vacuno', stock(A.win, p, keyV) === v0 - 1);

  // 4. el resumen
  const r1 = await resumen(A.win);
  chequear('el resumen suma 4 animales (3 ovinos + 1 vacuno)', r1.total === r0.total + 4, r1.total + ' vs ' + r0.total);
  chequear('y los separa por especie', r1.porEspecie.ovino === r0.porEspecie.ovino + 3 && r1.porEspecie.bovino === r0.porEspecie.bovino + 1);
  chequear('y por categoría', (r1.porCategoria.Ovejas || 0) === (r0.porCategoria.Ovejas || 0) + 3 && (r1.porCategoria.Vacas || 0) === (r0.porCategoria.Vacas || 0) + 1);
  const mes = (parseInt(hoy.split('/')[1], 10) + 5) % 12;
  chequear('y por mes del ejercicio', r1.porMes[mes] === r0.porMes[mes] + 4);

  // 5. el ejercicio es 1/jul a 30/jun
  const anio = r1.anio;
  await inyectar(servidor, estab, 'consumo', p, { categoria: 'Ovejas', dueno: du, cantidad: 2, obs: 'ejercicio anterior' }, '15/03/' + anio);
  const r2 = await resumen(A.win);
  chequear('un consumo de marzo (ejercicio anterior) no cuenta', r2.total === r1.total, r2.total + ' vs ' + r1.total);
  await inyectar(servidor, estab, 'consumo', p, { categoria: 'Capones', dueno: du, cantidad: 2, obs: 'enero' }, '15/01/' + (anio + 1));
  const r3 = await resumen(A.win);
  chequear('uno de enero (mismo ejercicio) sí cuenta', r3.total === r1.total + 2, r3.total + ' vs ' + r1.total);

  // 6. otro dispositivo
  await A.win.sincronizar(false);
  await B.win.sincronizar(false);
  chequear('otro dispositivo llega al mismo stock', stock(B.win, p, keyO) === stock(A.win, p, keyO) && stock(B.win, p, keyV) === stock(A.win, p, keyV),
    stock(B.win, p, keyO) + '/' + stock(A.win, p, keyO));
  const hB = entradas(B.win, p).find(h => h.tipo === 'consumo' && h.origDatos && h.origDatos.cantidad === 3);
  chequear('y lo ve en su historial', !!hB);

  // 7. borrar (PC): devuelve el stock y sale del resumen
  const hA = entradas(A.win, p).find(h => h.tipo === 'consumo' && h.extra && h.extra.cantidad === 1 && h.extra.categoria === 'Vacas');
  A.win.borrarHistorial(hA.id);
  await dormir(60);
  chequear('borrar devuelve el stock', stock(A.win, p, keyV) === v0);
  const r4 = await resumen(A.win);
  chequear('y lo saca del resumen', r4.total === r3.total - 1 && (r4.porCategoria.Vacas || 0) === (r0.porCategoria.Vacas || 0), r4.total + ' vs ' + r3.total);

  // 8. editar (PC): 3 ovejas pasan a 2, sin duplicar
  const hE = entradas(A.win, p).find(h => h.tipo === 'consumo' && h.extra && h.extra.cantidad === 3 && !h.eliminado);
  A.win.editarHistorial(hE.id);
  await dormir(60);
  chequear('editar abre el formulario con los datos', doc.getElementById('co-cant').value === '3' && doc.getElementById('co-cat').value === 'Ovejas');
  doc.getElementById('co-cant').value = '2';
  click(A.win, doc.getElementById('co-guardar'));
  await dormir(80);
  const r5 = await resumen(A.win);
  chequear('editar cambia 3 por 2 sin duplicar', r5.total === r4.total - 1, r5.total + ' vs ' + r4.total);
  // 2 ovejas editadas + 2 del consumo inyectado de marzo (otro dispositivo)
  chequear('y el stock queda con 2 consumidas (más las 2 inyectadas)', stock(A.win, p, keyO) === o0 - 4, stock(A.win, p, keyO) + ' vs ' + (o0 - 4));
  // 9. sin señal: queda en la cola, y el resumen lo cuenta igual
  Object.defineProperty(A.win.navigator, 'onLine', { value: false, configurable: true });
  const cola0 = A.win.__est().colaSync.length;
  await cargar('Capones', 1, 'PRUEBA sin senal');
  chequear('sin señal el consumo queda en la cola', A.win.__est().colaSync.length === cola0 + 1);
  const r6 = await resumen(A.win);
  chequear('y el resumen lo cuenta igual', r6.total === r5.total + 1, r6.total + ' vs ' + r5.total);
  Object.defineProperty(A.win.navigator, 'onLine', { value: true, configurable: true });
  const txt = doc.getElementById('consumos-resumen').textContent;
  chequear('el resumen muestra el ejercicio y los totales', /ejercicio/.test(txt) && /ovinos/.test(txt));
}

(async () => {
  for(const a of process.argv.slice(2)) await probarConsumos(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
