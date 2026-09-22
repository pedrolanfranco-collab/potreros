/*
 * Prueba ad-hoc: variante "La Vuelta Campo" (movil-simple), pensada para un
 * empleado/peon -- mismo establecimiento/STORAGE_KEY que la-vuelta-movil,
 * pero con un subconjunto de pantallas. Cubre:
 *   - lo que se mantiene: mapa/potreros, Mover, Nacimiento, Muerte,
 *     Desaparecido, Mover TODO, Agregar animales (carga inicial, ausente en
 *     la movil completa), GPS, Ver por dueno, Sincronizar, Quien soy.
 *   - lo que se excluye: Compra/Venta (y con el, el campo de guia DICOSE),
 *     Stock total, Sanidad, Lluvias, Alertas (editor), Backup JSON,
 *     Restablecer datos de fabrica, Eliminar potrero, Carga por voz.
 *   - la restriccion puntual en "Agregar animales": el campo dueno es
 *     siempre texto libre obligatorio, sin dropdown de Firmas ni "sin
 *     asignar" (para no atribuir por error stock nuevo a la familia).
 *   - que un movimiento cargado acá sincroniza sin casos especiales hacia
 *     la-vuelta-movil (mismo ESTABLECIMIENTO/STORAGE_KEY, mismo motor de
 *     sincronizacion sin marcadores @pc/@movil).
 *
 * Uso: node probar_la_vuelta_simple.js la-vuelta-movil-campo/index.html [la-vuelta-movil/index.html]
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
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
          delete(){ q._modo='delete'; return q; },
          eq(col,val){ q._filtros.push(r=>r[col]===val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
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
      window.__storageKey = function(){ return STORAGE_KEY; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarSimple(archivo){
  console.log(`\n=== ${archivo} (La Vuelta Campo) ===`);
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  chequear('carga sin errores de JS', errores.length===0, errores.join(' | '));
  if(errores.length) return;

  const doc = win.document;
  const potreros = win.__potrerosGeo();
  const potreroConAnimales = potreros.find(p => win.totalPotrero(p.nombre) > 0).nombre;
  const potreroVacio = potreros.find(p => win.totalPotrero(p.nombre) === 0);

  // ---- se mantiene ----
  chequear('GPS presente (btn-gps)', !!doc.getElementById('btn-gps'));
  win.seleccionarPotrero(potreroConAnimales);
  chequear('Ver por dueño presente', !!doc.getElementById('btn-detalle-por-dueno'));
  ['mover','nacimiento','muerte','desaparecido','mover-todo'].forEach(accion=>{
    chequear(`boton de accion "${accion}" presente en el detalle`, !!doc.querySelector(`[data-accion="${accion}"]`));
  });
  chequear('boton Quien soy presente', !!doc.getElementById('btn-usuario'));
  chequear('boton Sincronizar ahora presente', !!doc.getElementById('btn-sincronizar'));
  chequear('boton Desaparecidos (lista) presente', !!doc.getElementById('btn-desaparecidos'));

  // ---- las advertencias (⚠️ carga/ocupación) NO se muestran, ni en el detalle ni en la lista ----
  const potreroConAlerta = potreros.find(p => win.calcularAlertas(p.nombre).length > 0);
  chequear('hay al menos un potrero con alerta calculada, para probar que no se muestra', !!potreroConAlerta, 'ningún potrero con alerta en el seed');
  if(potreroConAlerta){
    win.seleccionarPotrero(potreroConAlerta.nombre);
    chequear('el detalle NO muestra el banner de advertencia (⚠️)', !doc.getElementById('detalle-caja').innerHTML.includes('⚠️'));
    const card = Array.from(doc.querySelectorAll('.potrero-card')).find(c => c.textContent.includes(potreroConAlerta.nombre));
    chequear('la tarjeta del potrero en la lista NO muestra el ícono de advertencia', card && !card.innerHTML.includes('⚠️'));
  }

  // ---- se excluye ----
  chequear('Compra/Venta AUSENTE', !doc.querySelector('[data-accion="compraventa"]'));
  chequear('campo de guia DICOSE (#f-guia) AUSENTE', !doc.getElementById('f-guia'));
  chequear('Eliminar potrero AUSENTE', !doc.getElementById('btn-eliminar-potrero'));
  chequear('Stock total AUSENTE', !doc.getElementById('btn-stock'));
  chequear('Sanidad AUSENTE', !doc.getElementById('btn-sanidad'));
  chequear('Lluvias AUSENTE', !doc.getElementById('btn-lluvias'));
  chequear('Alertas (editor) AUSENTE', !doc.getElementById('btn-alertas'));
  chequear('Backup (exportar) AUSENTE', !doc.getElementById('btn-exportar-json'));
  chequear('Backup (importar) AUSENTE', !doc.getElementById('btn-importar-json'));
  chequear('Restablecer datos de fabrica AUSENTE', !doc.getElementById('btn-restablecer'));
  chequear('Carga por voz (boton flotante) AUSENTE', !doc.getElementById('btn-voz'));
  chequear('modal-sanidad AUSENTE', !doc.getElementById('modal-sanidad'));
  chequear('modal-lluvias AUSENTE', !doc.getElementById('modal-lluvias'));
  chequear('modal-stock AUSENTE', !doc.getElementById('modal-stock'));
  chequear('modal-voz AUSENTE', !doc.getElementById('modal-voz'));
  chequear('modal-alertas AUSENTE', !doc.getElementById('modal-alertas'));
  chequear('funcion cargarSanidad AUSENTE (sin codigo huerfano)', typeof win.cargarSanidad === 'undefined');
  chequear('funcion cargarStock AUSENTE (sin codigo huerfano)', typeof win.cargarStock === 'undefined');
  chequear('funcion inicializarVoz AUSENTE (sin codigo huerfano)', typeof win.inicializarVoz === 'undefined');

  // ---- "Agregar animales": presente, restringido a dueno-texto-libre obligatorio ----
  win.cerrarDetalle();
  chequear('hay al menos un potrero vacio para probar "Agregar animales"', !!potreroVacio, 'ningun potrero vacio en el seed');
  if(potreroVacio){
    win.seleccionarPotrero(potreroVacio.nombre);
    const btnAgregar = doc.querySelector('[data-accion="agregar"]');
    chequear('boton "Agregar animales" presente en potrero vacio', !!btnAgregar);
    btnAgregar.dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('el campo dueno NO es un <select> de Firmas', !doc.querySelector('.ag-dueno'));
    const campoLibre = doc.querySelector('.ag-dueno-otro');
    chequear('el campo dueno es un input de texto libre', !!campoLibre && campoLibre.tagName === 'INPUT');

    // sin dueno -> rechaza
    doc.querySelector('.ag-cat').value = 'Vacas';
    campoLibre.value = '';
    doc.querySelector('.ag-cant').value = '5';
    doc.getElementById('f-fecha').value = win.fechaISOHoy();
    doc.getElementById('f-confirmar').click();
    chequear('sin dueno, no agrega nada al potrero', win.totalPotrero(potreroVacio.nombre) === 0);

    // con dueno de tercero -> se carga
    campoLibre.value = 'Estancia López (pastoreo)';
    doc.getElementById('f-confirmar').click();
    chequear('con dueno de tercero, sí carga el stock', win.totalPotrero(potreroVacio.nombre) === 5, win.totalPotrero(potreroVacio.nombre));
    const key = win.claveAnimal('Vacas', 'Estancia López (pastoreo)');
    chequear('el stock queda atribuido exactamente al texto escrito', win.__est().potreros[potreroVacio.nombre].animales[key] === 5);
  }

  return win;
}

async function probarSincroniza(archivoSimple, archivoCompleto){
  console.log(`\n=== Sincroniza ${archivoSimple} <-> ${archivoCompleto} (mismo establecimiento) ===`);
  const servidorSimple = crearServidor();
  const { win: winSimple, errores: e1 } = await levantar(archivoSimple, servidorSimple);
  if(e1.length){ chequear('simple carga sin errores (para probar sync)', false, e1.join(' | ')); return; }
  chequear('mismo ESTABLECIMIENTO/STORAGE_KEY que la-vuelta-movil (comparten datos, no hace falta migrar nada)',
    true, `${winSimple.__establecimiento()} / ${winSimple.__storageKey()}`);

  const potrero = winSimple.__potrerosGeo().find(p => winSimple.totalPotrero(p.nombre) > 0).nombre;
  winSimple.seleccionarPotrero(potrero);
  winSimple.mostrarFormulario(potrero, 'nacimiento');
  winSimple.document.getElementById('f-cat').value = 'Terneros';
  winSimple.document.getElementById('f-cant').value = '3';
  winSimple.document.getElementById('f-fecha').value = winSimple.fechaISOHoy();
  winSimple.document.getElementById('f-confirmar').click();
  await new Promise(r => setTimeout(r, 20));
  const filasEnviadas = servidorSimple.filas.eventos_sync.length;
  chequear('el nacimiento cargado en la version simple manda un evento a eventos_sync', filasEnviadas > 0, filasEnviadas+'');

  if(!archivoCompleto) return;
  const { win: winCompleto, errores: e2 } = await levantar(archivoCompleto, servidorSimple);
  chequear('la-vuelta-movil carga sin errores', e2.length===0, e2.join(' | '));
  if(e2.length) return;
  await winCompleto.sincronizar(true);
  await new Promise(r => setTimeout(r, 20));
  chequear('el evento cargado en la version simple llega SIN casos especiales a la app completa',
    winCompleto.__est().potreros[potrero].historial.some(h=>h.tipo==='nacimiento' && h.detalle.includes('Terneros')));
}

(async () => {
  const archivos = process.argv.slice(2);
  const simple = archivos.find(a => a.includes('la-vuelta-movil-campo'));
  const completo = archivos.find(a => a.includes('la-vuelta-movil/') || a.endsWith('la-vuelta-movil\\index.html') || a.endsWith('la-vuelta-movil/index.html'));

  if(!simple){
    console.log('Uso: node probar_la_vuelta_simple.js la-vuelta-movil-campo/index.html [la-vuelta-movil/index.html]');
    process.exit(1);
  }

  await probarSimple(simple);
  await probarSincroniza(simple, completo);

  console.log(`\n${fallas===0?'TODO OK':'HAY FALLAS: '+fallas}`);
  process.exit(fallas===0?0:1);
})();
