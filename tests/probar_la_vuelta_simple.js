/*
 * Prueba ad-hoc: variante "*-movil-campo" (movil-simple), pensada para un
 * empleado/peon -- mismo establecimiento/STORAGE_KEY que su "-movil"
 * completo, pero con un subconjunto de pantallas. Generica para los 3
 * establecimientos (La Vuelta, Maria Laura, Pone Chico); detecta cada par
 * "<prefijo>-movil-campo" / "<prefijo>-movil" entre los argumentos. Cubre:
 *   - lo que se mantiene: mapa/potreros, Mover, Nacimiento, Muerte,
 *     Desaparecido, Mover TODO, Agregar animales (carga inicial, ausente en
 *     la movil completa), GPS, Ver por dueno, Sincronizar, Quien soy,
 *     Lluvias (23/9/2026, solo el registro de mm) y Sanidad (25/9/2026,
 *     "+ Cargar tratamiento" completo, igual que en la movil completa).
 *   - lo que se excluye: Compra/Venta (y con el, el campo de guia DICOSE),
 *     Stock total, Alertas (editor), Backup JSON, Restablecer datos de
 *     fabrica, Eliminar potrero, Carga por voz.
 *   - la restriccion puntual en "Agregar animales": el campo dueno es
 *     siempre texto libre obligatorio, sin dropdown de Firmas ni "sin
 *     asignar" (para no atribuir por error stock nuevo a la familia) --
 *     esto no depende de CONFIG.duenoObligatorio, es fijo para @simple.
 *   - que un movimiento cargado acá sincroniza sin casos especiales hacia
 *     el "-movil" completo (mismo ESTABLECIMIENTO/STORAGE_KEY, mismo motor
 *     de sincronizacion sin marcadores @pc/@movil).
 * Pone Chico arranca sin potreros seedeados (ver probar_pone_chico.js) --
 * ahi las verificaciones que dependen de tener un potrero se saltean con
 * aviso, y solo corren carga-sin-errores + las exclusiones a nivel app.
 *
 * Uso: node probar_la_vuelta_simple.js la-vuelta-movil-campo/index.html la-vuelta-movil/index.html [mas pares...]
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
  console.log(`\n=== ${archivo} ===`);
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  chequear('carga sin errores de JS', errores.length===0, errores.join(' | '));
  if(errores.length) return;

  const doc = win.document;
  const potreros = win.__potrerosGeo();
  const conAnimales = potreros.find(p => win.totalPotrero(p.nombre) > 0);
  const potreroConAnimales = conAnimales ? conAnimales.nombre : null;
  const potreroVacio = potreros.find(p => win.totalPotrero(p.nombre) === 0);

  if(!potreros.length){
    console.log('  (sin potreros seedeados en este establecimiento -- se saltean las verificaciones que dependen de uno; ver probar_pone_chico.js)');
  } else {
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
  }
  // 30/9/2026: Infraestructura/Capín Annoni SÍ están en @simple (no gateados
  // por @completo como el resto de Herramientas) -- justamente el modo
  // "para el empleado" es el que se usa caminando el campo, donde se
  // encuentran estos problemas. No dependen de que haya potreros.
  chequear('boton Infraestructura presente', !!doc.getElementById('btn-infraestructura'));
  chequear('boton Capín Annoni presente', !!doc.getElementById('btn-capin-annoni'));

  // 2/10/2026: cartel de una fila con solo las especies (más pantalla para
  // el mapa). Los otros 4 números siguen en el DOM -- actualizarResumen()
  // los escribe sin chequear null -- pero ocultos.
  ['res-potreros','res-ha','res-ug','res-dotacion'].forEach(id=>{
    const el = doc.getElementById(id);
    chequear(`cartel: ${id} sigue en el DOM`, !!el);
    chequear(`cartel: ${id} oculto en Campo`, !!el && win.getComputedStyle(el.parentElement).display === 'none');
  });
  ['res-vacunos','res-ovinos','res-equinos'].forEach(id=>{
    const el = doc.getElementById(id);
    chequear(`cartel: ${id} visible en Campo`, !!el && win.getComputedStyle(el.parentElement).display !== 'none');
    chequear(`cartel: ${id} muestra un número`, !!el && /^\d+$/.test(el.textContent.trim()), el && el.textContent);
  });
  chequear('cartel: el subtítulo de Campo es solo la versión', /^v\d+\.\d+$/.test(doc.querySelector('header .sub').textContent.trim()), doc.querySelector('header .sub').textContent);

  // ---- Historial: 3/10/2026, a pedido de Pedro, Campo muestra TAMBIÉN lo que
  // cargaron otros usuarios desde otros dispositivos (antes, desde el
  // 22/9/2026, solo mostraba lo propio). Cada renglón lleva el nombre de
  // quien lo cargó, y los ajenos son de solo lectura (sin ✏️/🗑). ----
  if(potreroConAnimales){
    const potreroHist = potreroConAnimales;
    win.seleccionarPotrero(potreroHist);
    win.mostrarFormulario(potreroHist, 'nacimiento');
    doc.getElementById('f-cat').value = 'Terneros';
    doc.getElementById('f-cant').value = '2';
    doc.getElementById('f-fecha').value = win.fechaISOHoy();
    doc.getElementById('f-confirmar').click();
    const idLocal = win.__est().potreros[potreroHist].historial[0].id;

    win.aplicarEventoRemoto({
      dispositivo: 'otro-dispositivo-cualquiera',
      tipo: 'nacimiento', potrero: potreroHist,
      detalle: {categoria: 'Terneros', cantidad: 9, usuario: 'Silvia'},
      fecha_cliente: win.fechaHoy()
    }, new Set());
    const totalHistorialReal = win.__est().potreros[potreroHist].historial.length;

    win.renderDetalle(potreroHist); // fuerza a re-renderizar con el evento remoto ya aplicado
    const items = Array.from(doc.querySelectorAll('#historial .hist-item'));
    chequear('el evento remoto quedó en el estado marcado como remoto',
      win.__est().potreros[potreroHist].historial.some(h=>h.remoto===true && h.tipo==='nacimiento' && h.detalle.includes('9 Terneros')));
    chequear('el historial mostrado tiene todas las filas del historial real (hasta el tope de 15)',
      items.length === Math.min(totalHistorialReal, 15), `mostrados=${items.length} reales=${totalHistorialReal}`);
    const filaLocal = items.find(el => el.textContent.includes('2 Terneros'));
    const filaOtro = items.find(el => el.textContent.includes('9 Terneros'));
    chequear('el movimiento cargado LOCALMENTE aparece en el historial', !!filaLocal);
    chequear('el movimiento del OTRO dispositivo TAMBIÉN aparece en el historial', !!filaOtro);
    chequear('el renglón del otro usuario dice quién lo cargó', !!filaOtro && filaOtro.textContent.includes('— Silvia'), filaOtro && filaOtro.textContent.trim());
    chequear('el renglón propio se puede editar/borrar', !!filaLocal && !!filaLocal.querySelector('.hist-btn'));
    chequear('el renglón del otro usuario es de solo lectura (sin botones)', !!filaOtro && !filaOtro.querySelector('.hist-btn'));
  }

  // ---- las advertencias (⚠️ carga/ocupación) NO se muestran, ni en el detalle ni en la lista ----
  if(potreros.length){
    const potreroConAlerta = potreros.find(p => win.calcularAlertas(p.nombre).length > 0);
    chequear('hay al menos un potrero con alerta calculada, para probar que no se muestra', !!potreroConAlerta, 'ningún potrero con alerta en el seed');
    if(potreroConAlerta){
      win.seleccionarPotrero(potreroConAlerta.nombre);
      chequear('el detalle NO muestra el banner de advertencia (⚠️)', !doc.getElementById('detalle-caja').innerHTML.includes('⚠️'));
      const card = Array.from(doc.querySelectorAll('.potrero-card')).find(c => c.textContent.includes(potreroConAlerta.nombre));
      chequear('la tarjeta del potrero en la lista NO muestra el ícono de advertencia', card && !card.innerHTML.includes('⚠️'));
    }
  }

  // ---- se excluye ----
  chequear('Compra/Venta AUSENTE', !doc.querySelector('[data-accion="compraventa"]'));
  chequear('campo de guia DICOSE (#f-guia) AUSENTE', !doc.getElementById('f-guia'));
  chequear('Eliminar potrero AUSENTE', !doc.getElementById('btn-eliminar-potrero'));
  chequear('Stock total AUSENTE', !doc.getElementById('btn-stock'));
  chequear('Alertas (editor) AUSENTE', !doc.getElementById('btn-alertas'));
  chequear('Backup (exportar) AUSENTE', !doc.getElementById('btn-exportar-json'));
  chequear('Backup (importar) AUSENTE', !doc.getElementById('btn-importar-json'));
  chequear('Restablecer datos de fabrica AUSENTE', !doc.getElementById('btn-restablecer'));
  chequear('Carga por voz (boton flotante) AUSENTE', !doc.getElementById('btn-voz'));
  chequear('modal-stock AUSENTE', !doc.getElementById('modal-stock'));
  chequear('modal-voz AUSENTE', !doc.getElementById('modal-voz'));
  chequear('modal-alertas AUSENTE', !doc.getElementById('modal-alertas'));
  chequear('funcion cargarStock AUSENTE (sin codigo huerfano)', typeof win.cargarStock === 'undefined');
  chequear('funcion inicializarVoz AUSENTE (sin codigo huerfano)', typeof win.inicializarVoz === 'undefined');

  // ---- Lluvias: 23/9/2026, presente para poder registrar lluvia (a
  // diferencia del resto de "Herramientas") -- pero solo el registro de
  // milímetros, no lo que viaja en el mismo modal (eventos climáticos,
  // abortos, y -- para La Vuelta -- Campo ajeno con su guía DICOSE) ----
  chequear('Lluvias PRESENTE', !!doc.getElementById('btn-lluvias'));
  chequear('modal-lluvias PRESENTE', !!doc.getElementById('modal-lluvias'));
  doc.getElementById('btn-lluvias').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('modal-lluvias se abre', doc.getElementById('modal-lluvias').style.display === 'flex');
  chequear('campo Milimetros presente', !!doc.getElementById('ll-mm'));
  chequear('Otros eventos (clima) AUSENTE', !doc.getElementById('ev-guardar'));
  chequear('Abortos AUSENTE', !doc.getElementById('ab-guardar'));
  chequear('Campo ajeno AUSENTE (aunque el establecimiento tenga dicoseHabilitado)', !doc.getElementById('campo-ajeno-seccion'));
  chequear('funcion renderEventosClimaLista AUSENTE (sin codigo huerfano)', typeof win.renderEventosClimaLista === 'undefined');
  chequear('funcion renderAbortosLista AUSENTE (sin codigo huerfano)', typeof win.renderAbortosLista === 'undefined');
  chequear('funcion renderCampoAjenoLista AUSENTE (sin codigo huerfano)', typeof win.renderCampoAjenoLista === 'undefined');
  {
    const fechaISO = win.fechaISOHoy();
    doc.getElementById('ll-fecha').value = fechaISO;
    doc.getElementById('ll-mm').value = '18.5';
    doc.getElementById('ll-guardar').click();
    chequear('la lluvia cargada queda en estado.lluvias', (win.__est().lluvias||[]).some(l=>l.mm===18.5));
    chequear('la lluvia cargada aparece en la lista del modal', doc.getElementById('lluvias-lista').innerHTML.includes('18.5'));
  }
  doc.getElementById('lluvias-cerrar').click();

  // ---- Sanidad: 25/9/2026, presente y funcional igual que en la movil
  // completa -- el empleado puede cargar un tratamiento con el mismo
  // formulario y motor (guardarSanidadCarga), no una versión recortada ----
  chequear('Sanidad PRESENTE', !!doc.getElementById('btn-sanidad'));
  chequear('modal-sanidad PRESENTE', !!doc.getElementById('modal-sanidad'));
  doc.getElementById('btn-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
  chequear('modal-sanidad se abre', doc.getElementById('modal-sanidad').style.display === 'flex');
  doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20)); // btn-cargar-sanidad es async (cargarCatalogoProductos())
  chequear('categoria trae opciones', doc.getElementById('sc-categoria').options.length > 0);
  if(potreros.length) doc.getElementById('sc-potrero').value = potreros[0].nombre;
  doc.getElementById('sc-cantidad').value = '5';
  doc.getElementById('sc-producto1-otro').value = 'IVOMEC';
  doc.getElementById('sc-dosis1').value = '2';
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r=>setTimeout(r,20));
  const seMando = Object.values(servidor.filas).some(arr => Array.isArray(arr) && arr.some(r=>r.producto1==='IVOMEC'));
  chequear('el tratamiento cargado se mandó a la tabla de sanidad', seMando);
  doc.getElementById('sanidad-cerrar').click();

  // ---- "Agregar animales": presente, restringido a dueno-texto-libre obligatorio ----
  // (se saltea sin aviso de falla si el establecimiento no tiene ningún
  // potrero seedeado -- ese es el caso de Pone Chico por diseño)
  win.cerrarDetalle();
  if(potreros.length) chequear('hay al menos un potrero vacio para probar "Agregar animales"', !!potreroVacio, 'ningun potrero vacio en el seed');
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

// 3/10/2026: dos celulares Campo con usuarios distintos, sincronizados por el
// mismo servidor -- cada uno tiene que ver en su historial lo que cargó el otro.
async function probarDosCampo(archivoSimple){
  console.log(`\n=== Dos dispositivos ${archivoSimple} (historial de los distintos usuarios) ===`);
  const servidor = crearServidor();
  const A = await levantar(archivoSimple, servidor);
  const B = await levantar(archivoSimple, servidor);
  if(A.errores.length || B.errores.length){ chequear('los dos Campo cargan sin errores', false, [...A.errores, ...B.errores].join(' | ')); return; }
  const conAnimales = A.win.__potrerosGeo().find(p => A.win.totalPotrero(p.nombre) > 0);
  if(!conAnimales){ console.log('  (sin potreros seedeados -- se saltea)'); return; }
  const potrero = conAnimales.nombre;
  A.win.localStorage.setItem('potreros_nombre_usuario', 'Ana');
  B.win.localStorage.setItem('potreros_nombre_usuario', 'Beto');

  A.win.seleccionarPotrero(potrero);
  A.win.mostrarFormulario(potrero, 'nacimiento');
  A.win.document.getElementById('f-cat').value = 'Terneros';
  A.win.document.getElementById('f-cant').value = '4';
  A.win.document.getElementById('f-fecha').value = A.win.fechaISOHoy();
  A.win.document.getElementById('f-confirmar').click();
  await new Promise(r => setTimeout(r, 30));

  B.win.seleccionarPotrero(potrero);
  B.win.mostrarFormulario(potrero, 'nacimiento');
  B.win.document.getElementById('f-cat').value = 'Terneros';
  B.win.document.getElementById('f-cant').value = '7';
  B.win.document.getElementById('f-fecha').value = B.win.fechaISOHoy();
  B.win.document.getElementById('f-confirmar').click();
  await new Promise(r => setTimeout(r, 30));

  await A.win.sincronizar(true);
  await B.win.sincronizar(true);
  A.win.renderDetalle(potrero);
  B.win.renderDetalle(potrero);
  const histA = A.win.document.getElementById('historial').textContent;
  const histB = B.win.document.getElementById('historial').textContent;
  chequear('Ana ve lo suyo y lo de Beto en el historial', histA.includes('4 Terneros') && histA.includes('7 Terneros'), histA.replace(/\s+/g, ' ').slice(0, 300));
  chequear('Beto ve lo suyo y lo de Ana en el historial', histB.includes('4 Terneros') && histB.includes('7 Terneros'), histB.replace(/\s+/g, ' ').slice(0, 300));
  chequear('Ana ve que lo de Beto lo cargó Beto', /7 Terneros[^\n]*— Beto/.test(histA.replace(/\s+/g, ' ')), histA.replace(/\s+/g, ' ').slice(0, 300));
  chequear('Beto ve que lo de Ana lo cargó Ana', /4 Terneros[^\n]*— Ana/.test(histB.replace(/\s+/g, ' ')), histB.replace(/\s+/g, ' ').slice(0, 300));
}

// El cartel compacto es solo de Campo (marcador @simple): la móvil completa
// tiene que seguir mostrando los 7 números y su subtítulo largo.
async function probarCartelNoSeFiltra(archivoCompleto){
  console.log(`\n=== Cartel de ${archivoCompleto} (no debe cambiar) ===`);
  const { win, errores } = await levantar(archivoCompleto, crearServidor());
  if(errores.length){ chequear('completa carga sin errores', false, errores.join(' | ')); return; }
  ['res-potreros','res-ha','res-vacunos','res-ovinos','res-equinos','res-ug','res-dotacion'].forEach(id=>{
    const el = win.document.getElementById(id);
    chequear(`completa: ${id} visible`, !!el && win.getComputedStyle(el.parentElement).display !== 'none');
  });
  chequear('completa: conserva el subtítulo largo', win.document.querySelector('header .sub').textContent.includes('·'), win.document.querySelector('header .sub').textContent);
}

async function probarSincroniza(archivoSimple, archivoCompleto){
  console.log(`\n=== Sincroniza ${archivoSimple} <-> ${archivoCompleto} (mismo establecimiento) ===`);
  const servidorSimple = crearServidor();
  const { win: winSimple, errores: e1 } = await levantar(archivoSimple, servidorSimple);
  if(e1.length){ chequear('simple carga sin errores (para probar sync)', false, e1.join(' | ')); return; }
  chequear(`mismo ESTABLECIMIENTO/STORAGE_KEY que ${archivoCompleto} (comparten datos, no hace falta migrar nada)`,
    true, `${winSimple.__establecimiento()} / ${winSimple.__storageKey()}`);

  const conAnimales = winSimple.__potrerosGeo().find(p => winSimple.totalPotrero(p.nombre) > 0);
  if(!conAnimales){
    console.log('  (sin potreros seedeados -- se saltea la prueba de sincronizacion, no hay donde cargar un evento)');
    return;
  }
  const potrero = conAnimales.nombre;
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
  chequear(`${archivoCompleto} carga sin errores`, e2.length===0, e2.join(' | '));
  if(e2.length) return;
  await winCompleto.sincronizar(true);
  await new Promise(r => setTimeout(r, 20));
  chequear('el evento cargado en la version simple llega SIN casos especiales a la app completa',
    winCompleto.__est().potreros[potrero].historial.some(h=>h.tipo==='nacimiento' && h.detalle.includes('Terneros')));
}

(async () => {
  const archivos = process.argv.slice(2).map(a => a.replace(/\\/g, '/'));

  // Detecta cada par "<prefijo>-movil-campo/index.html" + "<prefijo>-movil/index.html"
  // entre los argumentos -- así un solo step de CI puede pasar los N
  // establecimientos que tengan simpleHabilitado, igual que el resto de los
  // tests del repo reciben varios "*/index.html" de una.
  const pares = archivos
    .filter(a => /-movil-campo\/index\.html$/.test(a))
    .map(simple => {
      const prefijo = simple.match(/([^/]+)-movil-campo\/index\.html$/)[1];
      const completo = archivos.find(a => a.endsWith(`${prefijo}-movil/index.html`));
      return { simple, completo };
    });

  if(!pares.length){
    console.log('Uso: node probar_la_vuelta_simple.js <prefijo>-movil-campo/index.html [<prefijo>-movil/index.html] ...');
    process.exit(1);
  }

  for(const { simple, completo } of pares){
    await probarSimple(simple);
    await probarSincroniza(simple, completo);
    await probarDosCampo(simple);
    if(completo) await probarCartelNoSeFiltra(completo);
  }

  console.log(`\n${fallas===0?'TODO OK':'HAY FALLAS: '+fallas}`);
  process.exit(fallas===0?0:1);
})();
