/*
 * Prueba ad-hoc (3/11/2026): hacienda ajena visible por potrero + consumo (faena) completo.
 *   - un dueño fuera de CONFIG.duenos es "ajeno": cuenta en UG/ha y se muestra aparte en el detalle y en el reporte por dueño;
 *   - Consumo existe en el panel del potrero (PC y Campo);
 *   - consumir más de lo que la app tiene pide confirmación, resta solo lo que había (nunca negativo) y el evento
 *     lleva `faltante` y `sin_stock`; otro dispositivo llega al mismo stock; deshacer devuelve solo lo restado.
 *
 * Uso: node probar_hacienda_ajena.js la-vuelta-pc/index.html maria-laura-pc/index.html [...]
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
const ponerSel = (win, id, v) => { const e = win.document.getElementById(id); e.value = v; e.dispatchEvent(new win.Event('change', { bubbles: true })); };

/* Carga un consumo desde el panel del potrero (acción 🥩 Consumo), igual que en Campo. */
async function consumirDesdePotrero(win, p, cat, dueno, cant){
  win.seleccionarPotrero(p);
  const btn = win.document.querySelector('[data-accion="consumo"]');
  if(!btn) return false;
  click(win, btn);
  ponerSel(win, 'f-cat', cat);
  const sel = win.document.getElementById('f-dueno');
  if(Array.from(sel.options).some(o => o.value === dueno)) ponerSel(win, 'f-dueno', dueno);
  else { ponerSel(win, 'f-dueno', '__otro__'); win.document.getElementById('f-dueno-otro').value = dueno; }
  win.document.getElementById('f-cant').value = String(cant);
  click(win, win.document.getElementById('f-confirmar'));
  await dormir(80);
  return true;
}

async function probar(archivoPc){
  console.log('\n=== ' + archivoPc + ' ===');
  const base = archivoPc.replace(/-pc[\\/]index\.html$/, '');
  const servidor = crearServidor();
  const A = await levantar(archivoPc, servidor);
  const F = await levantar(base + '-movil/index.html', servidor);
  const C = await levantar(base + '-movil-campo/index.html', servidor);
  const errores = [...A.errores, ...F.errores, ...C.errores];
  chequear('las 3 apps cargan sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
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

  // ---- hacienda ajena ----
  const AJENO = 'Vecino de Prueba';
  chequear('un dueño de la lista no es ajeno', !A.win.esDuenoAjeno(du) && !A.win.esDuenoAjeno(''));
  chequear('uno fuera de la lista sí', A.win.esDuenoAjeno(AJENO));
  const cargaAntes = A.win.cargaPotrero(p);
  await inyectar(servidor, estab, 'ingreso', p, { categoria: 'Ovejas', dueno: AJENO, cantidad: 4 }, hoy);
  await A.win.sincronizar(false);
  await C.win.sincronizar(false);
  chequear('la hacienda ajena cuenta en la carga UG/ha', A.win.cargaPotrero(p) > cargaAntes, A.win.cargaPotrero(p) + ' vs ' + cargaAntes);
  chequear('se detecta en el potrero', A.win.duenosAjenosEnPotrero(p).includes(AJENO) && A.win.ugAjenasEnPotrero(p) > 0);
  for(const [nombre, d] of [['PC', A], ['Campo', C]]){
    d.win.seleccionarPotrero(p);
    const html = d.win.document.getElementById('detalle').innerHTML;
    chequear(nombre + ': el detalle muestra el bloque "Hacienda ajena" con el dueño', /Hacienda ajena/.test(html) && html.includes(AJENO) && /UG ajenas/.test(html));
    d.win.cerrarDetalle();
  }
  if(typeof A.win.resumenPorDueno === 'function'){
    const g = A.win.resumenPorDueno().find(x => x.ajeno && x.dueno.indexOf(AJENO) === 0);
    chequear('el reporte por dueño incluye al ajeno rotulado', !!g && g.total === 4 && /ajeno/.test(g.dueno), JSON.stringify(g));
  }

  // ---- consumo sin stock (PC y Campo) ----
  for(const [nombre, d] of [['PC', A], ['Campo', C]]){
    const ajeno = 'Tercero ' + nombre;
    const ev0 = servidor.filas.eventos_sync.length;
    d.win.confirm = () => false;
    const hay = await consumirDesdePotrero(d.win, p, 'Ovejas', ajeno, 6);
    chequear(nombre + ': tiene la acción 🥩 Consumo en el potrero', hay);
    chequear(nombre + ': sin confirmar no registra nada', servidor.filas.eventos_sync.length === ev0);
    d.win.confirm = () => true;
    await inyectar(servidor, estab, 'ingreso', p, { categoria: 'Ovejas', dueno: ajeno, cantidad: 2 }, hoy);
    await d.win.sincronizar(false);
    const key = d.win.claveAnimal('Ovejas', ajeno);
    chequear(nombre + ': hay 2 del ajeno', stock(d.win, p, key) === 2, String(stock(d.win, p, key)));
    await consumirDesdePotrero(d.win, p, 'Ovejas', ajeno, 5);
    const ev = servidor.filas.eventos_sync.filter(f => f.tipo === 'consumo' && f.detalle.dueno === ajeno);
    chequear(nombre + ': el evento lleva cantidad 5, faltante 3 y sin_stock', ev.length === 1 && ev[0].detalle.cantidad === 5 && ev[0].detalle.faltante === 3 && ev[0].detalle.sin_stock === true, JSON.stringify(ev[0]));
    chequear(nombre + ': el stock queda en 0, nunca negativo', stock(d.win, p, key) === 0, String(stock(d.win, p, key)));
    chequear(nombre + ': el historial lo marca', entradas(d.win, p).some(h => h.tipo === 'consumo' && /3 no estaban en la app/.test(h.detalle)));
    if(nombre === 'PC'){
      const r = await resumen(A.win);
      chequear('el resumen cuenta 5 y avisa 3 sin stock', r.sinStock >= 3, JSON.stringify([r.total, r.sinStock]));
    }
    // otro dispositivo (móvil completa) llega al mismo stock
    await F.win.sincronizar(false);
    chequear(nombre + ': otro dispositivo queda con 0', stock(F.win, p, key) === 0, String(stock(F.win, p, key)));
    // deshacer devuelve solo lo que se había restado (5 - 3 = 2)
    const h = entradas(d.win, p).find(x => x.tipo === 'consumo' && x.extra && x.extra.dueno === ajeno && !x.eliminado);
    d.win.borrarHistorial(h.id);
    await dormir(60);
    chequear(nombre + ': borrar devuelve 2, no 5', stock(d.win, p, key) === 2, String(stock(d.win, p, key)));
  }
}

(async () => {
  for(const a of process.argv.slice(2)) await probar(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
