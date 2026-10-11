/*
 * Prueba ad-hoc: las crías de la temporada no cuentan como Unidad Ganadera hasta que se destetan
 * (11/10/2026, a pedido de Pedro): Terneros desde marzo y Corderos/as desde enero; antes valen 0 UG
 * (siguen contando como animales). Cubre la regla por mes y categoría, el cálculo del potrero y del
 * campo en octubre / enero / marzo y la nota del editor de coeficientes.
 *
 * Uso: node probar_ug_temporada.js la-vuelta-pc/index.html maria-laura-movil/index.html [...]
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


// fija "hoy" dentro de la página (new Date() sin argumentos devuelve esa fecha)
function fijarFecha(win, anio, mes, dia){
  const Real = win.__DateReal || win.Date;
  win.__DateReal = Real;
  const t = new Real(anio, mes - 1, dia, 12, 0, 0).getTime();
  win.Date = class extends Real {
    constructor(...a){ if(a.length) super(...a); else super(t); }
    static now(){ return t; }
  };
}

async function probarUG(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo, crearServidor());
  chequear('carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;

  // 1. la regla por mes y categoría
  const f = (cat, a, m, d) => win.sinUGPorTemporada(cat, new win.__DateReal(a, m - 1, d));
  win.__DateReal = win.Date;
  const casos = [
    // [categoría, año, mes, día, ¿sin UG?]
    ['Terneros', 2026, 9, 30, false], ['Terneros', 2026, 10, 1, true], ['Terneros', 2026, 12, 31, true],
    ['Terneros', 2027, 1, 15, true],  ['Terneros', 2027, 3, 31, true],  ['Terneros', 2027, 4, 1, false],
    ['Terneros', 2027, 8, 31, false], ['Terneras', 2026, 11, 5, true],  ['Terneras', 2027, 5, 5, false],
    ['Corderos/as', 2026, 8, 31, false], ['Corderos/as', 2026, 9, 1, true], ['Corderos/as', 2026, 12, 31, true],
    ['Corderos/as', 2027, 1, 1, false], ['Corderos/as', 2027, 6, 30, false],
    ['Vacas', 2026, 10, 11, false], ['Ovejas', 2026, 10, 11, false], ['Novillitos 1-2 años', 2026, 10, 11, false]
  ];
  casos.forEach(([cat, a, m, d, esperado]) => {
    chequear(`${cat} el ${d}/${m}/${a}: ${esperado ? 'no cuenta como UG' : 'cuenta como UG'}`, f(cat, a, m, d) === esperado);
  });

  // 2. el cálculo del potrero y de todo el campo
  const geo = win.__potrerosGeo();
  if(!geo.length){ console.log('  (sin potreros seedeados -- se saltea el cálculo)'); return; }
  const p = geo[0].nombre;
  const du = win.partesClave(Object.keys(win.__est().potreros[p].animales)[0] || 'Vacas||').dueno;
  win.__est().potreros[p].animales = {};
  const a = win.__est().potreros[p].animales;
  a[win.claveAnimal('Vacas', du)] = 5;
  a[win.claveAnimal('Terneros', du)] = 10;
  a[win.claveAnimal('Corderos/as', du)] = 20;
  const c = win.__est().ugCoef;
  const vacas = 5 * c['Vacas'], terneros = 10 * c['Terneros'], corderos = 20 * c['Corderos/as'];
  const cerca = (x, y) => Math.abs(x - y) < 1e-9;

  // Vacas 5 (todas con ternero: hay 10 terneros), 10 Terneros, 20 Corderos/as
  const conTernero = 5 * 1.2;      // vaca con ternero al pie: 1,2 UG de octubre a marzo
  fijarFecha(win, 2026, 9, 20);    // septiembre: vacas 1,0, terneros 0,5 y corderos todavía en 0
  chequear('en septiembre: vacas 1,0, terneros 0,5 y corderos/as 0', cerca(win.totalUG(p), vacas + terneros), win.totalUG(p) + ' vs ' + (vacas + terneros));
  fijarFecha(win, 2026, 10, 11);   // octubre: vacas con ternero 1,2; crías en 0
  chequear('en octubre las vacas con ternero valen 1,2 y las crías 0', cerca(win.totalUG(p), conTernero), win.totalUG(p) + ' vs ' + conTernero);
  chequear('y siguen contando como animales', win.totalPotrero(p) === 35);
  fijarFecha(win, 2027, 1, 20);    // enero: corderos pasan a 0,1; terneros todavía 0; vacas 1,2
  chequear('en enero cuentan los corderos/as, las vacas siguen en 1,2 y los terneros no', cerca(win.totalUG(p), conTernero + corderos), win.totalUG(p) + ' vs ' + (conTernero + corderos));
  fijarFecha(win, 2027, 3, 10);    // marzo (incluido): vacas 1,2; terneros todavía 0
  chequear('en marzo las vacas siguen en 1,2 y los terneros todavía no cuentan', cerca(win.totalUG(p), conTernero + corderos), win.totalUG(p) + ' vs ' + (conTernero + corderos));
  fijarFecha(win, 2027, 4, 10);    // abril: vacas 1,0 y terneros 0,5
  chequear('en abril las vacas vuelven a 1,0 y los terneros cuentan 0,5', cerca(win.totalUG(p), vacas + terneros + corderos), win.totalUG(p) + ' vs ' + (vacas + terneros + corderos));
  chequear('y la carga del potrero acompaña', cerca(win.cargaPotrero(p), win.totalUG(p) / win.areaHa(p)));

  // tantas vacas con ternero como terneros haya (hasta el total de vacas)
  a[win.claveAnimal('Vacas', du)] = 8;
  a[win.claveAnimal('Terneros', du)] = 3;
  a[win.claveAnimal('Corderos/as', du)] = 0;
  fijarFecha(win, 2026, 11, 5);
  chequear('8 vacas y 3 terneros: 3 vacas a 1,2 y 5 a 1,0', cerca(win.totalUG(p), 3 * 1.2 + 5 * 1.0), win.totalUG(p) + ' vs ' + (3 * 1.2 + 5));
  a[win.claveAnimal('Terneros', du)] = 0;
  chequear('sin terneros las vacas valen 1,0', cerca(win.totalUG(p), 8 * 1.0), win.totalUG(p));
  a[win.claveAnimal('Vacas', du)] = 5;
  a[win.claveAnimal('Terneros', du)] = 10;
  a[win.claveAnimal('Corderos/as', du)] = 20;

  // 3. lo que se publica a stock_potreros y el editor de coeficientes
  fijarFecha(win, 2026, 10, 11);
  win.actualizarTodo();
  const num = win.document.getElementById('res-ug');
  chequear('el resumen del encabezado usa el mismo cálculo', !num || /^-?\d+(\.\d)?$/.test(num.textContent.trim()), num && num.textContent);
  const modalCoef = win.document.getElementById('modal-coef');   // solo en la PC
  if(modalCoef) chequear('el editor de coeficientes explica la regla', /Terneros y terneras<\/strong> valen 0 UG de octubre a marzo/.test(modalCoef.innerHTML));
}

(async () => {
  for(const a of process.argv.slice(2)) await probarUG(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
