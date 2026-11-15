/*
 * 15/11/2026, a pedido de Pedro: al registrar un nacimiento de Terneros, si el potrero queda con más
 * terneros que madres (Vacas + Vaquillonas 2-3 años), la app pregunta antes de guardar. Pasó el 12/11 en
 * el potrero 7 de La Vuelta: se cargó el conteo total de terneros (17) como si fueran partos nuevos y el
 * potrero quedó con 45 terneros y 23 vacas.
 *
 * Uso: node probar_aviso_crias_madres.js la-vuelta-pc/index.html la-vuelta-movil-campo/index.html ...
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



/* ---------------- lo propio de esta prueba ---------------- */

async function cargar(D, p, cat, cant, respuesta){
  const win = D.win;
  const preguntas = [];
  win.confirm = (msg) => { preguntas.push(String(msg)); return respuesta; };
  win.seleccionarPotrero(p);
  win.mostrarFormulario(p, 'nacimiento');
  win.document.getElementById('f-cat').value = cat;
  win.document.getElementById('f-cant').value = String(cant);
  win.document.getElementById('f-confirmar').click();
  await dormir(30);
  return preguntas;
}
function dejar(win, p, animales){
  const a = win.__est().potreros[p].animales;
  Object.keys(a).forEach(k => delete a[k]);
  Object.entries(animales).forEach(([cat, n]) => { a[win.claveAnimal(cat, '')] = n; });
}
const nacimientos = (win, p) => win.__est().potreros[p].historial.filter(h => h.tipo === 'nacimiento' && !h.eliminado).length;

async function probarArchivo(archivo){
  console.log('\n== ' + archivo);
  const servidor = crearServidor();
  const D = await levantar(archivo, servidor);
  if(D.errores.length){ chequear('carga sin errores', false, D.errores.slice(0, 2).join(' | ')); return; }
  const geo = D.win.__potrerosGeo();
  if(!geo.length){ console.log('  (sin potreros -- se saltea)'); return; }
  const win = D.win, p = geo[0].nombre;
  // suma todos los dueños (en María Laura el formulario trae un dueño elegido)
  const ter = () => Object.entries(win.__est().potreros[p].animales).filter(([k]) => win.partesClave(k).cat === 'Terneros').reduce((s, [, n]) => s + (n || 0), 0);

  // 2 Vacas + 1 Vaquillona 2-3 años = 3 madres; cargar 4 terneros pregunta
  dejar(win, p, { 'Vacas': 2, 'Vaquillonas 2-3 años': 1 });
  let n0 = nacimientos(win, p);
  let q = await cargar(D, p, 'Terneros', 4, false);
  chequear('más terneros que vacas: pregunta antes de guardar', q.length === 1, JSON.stringify(q));
  chequear('la pregunta dice cuántos terneros y cuántas madres quedan', q.length === 1 && /\b4\b/.test(q[0]) && /\b3\b/.test(q[0]) && /total/i.test(q[0]), q[0]);
  chequear('si dice que no, no se guarda nada', ter() === 0 && nacimientos(win, p) === n0, 'terneros=' + ter());

  q = await cargar(D, p, 'Terneros', 4, true);
  chequear('si dice que sí, se guarda igual', q.length === 1 && ter() === 4 && nacimientos(win, p) === n0 + 1, 'terneros=' + ter());

  // igual a la cantidad de madres: no pregunta
  dejar(win, p, { 'Vacas': 2, 'Vaquillonas 2-3 años': 1 });
  n0 = nacimientos(win, p);
  q = await cargar(D, p, 'Terneros', 3, false);
  chequear('terneros = madres: no pregunta y guarda', q.length === 0 && ter() === 3 && nacimientos(win, p) === n0 + 1, JSON.stringify(q) + ' terneros=' + ter());

  // los que ya estaban también cuentan: 2 + 2 = 4 > 3
  dejar(win, p, { 'Vacas': 3, 'Terneros': 2 });
  q = await cargar(D, p, 'Terneros', 2, false);
  chequear('suma los terneros que ya había en el potrero', q.length === 1 && ter() === 2, JSON.stringify(q) + ' terneros=' + ter());

  // corderos: no se mira (el aviso es solo para terneros)
  dejar(win, p, {});
  q = await cargar(D, p, 'Corderos/as', 5, false);
  chequear('corderos: no pregunta', q.length === 0, JSON.stringify(q));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.log('Uso: node probar_aviso_crias_madres.js <index.html> ...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(path.resolve(a));
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTODO OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
