/*
 * Prueba ad-hoc: Fase A de la integración DICOSE/SNIG (solo La Vuelta).
 * Cubre: el campo Nº de guía en Compra/Venta (auto-mayúscula, formato
 * 1 letra + 6 dígitos, viaja en el detalle/historial/evento sincronizado),
 * el botón "agregar guía después" (📄, con su corrección/sincronización), y
 * el registro de "campo ajeno" (envío/retorno) sin tocar el mapa ni la
 * dotación por hectárea de ningún potrero real -- el Excel de Ganadería
 * sigue siendo quien calcula/declara, esto es solo documental.
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
                if(f.event_id && filas[tabla].some(r=>r.event_id===f.event_id)) return; // unico por event_id
                filas[tabla].push(Object.assign({creado_en: new Date().toISOString()}, f));
              });
              return Promise.resolve(res({data:q._filas, error:null}));
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
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + `
      ;window.__est = function(){ return estado; };
      window.__establecimiento = function(){ return ESTABLECIMIENTO; };
      window.__potrerosGeo = function(){ return POTREROS_GEO; };
      window.__config = function(){ return CONFIG; };
    `);
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

function setValor(win, id, val){
  const el = win.document.getElementById(id);
  el.value = val;
  el.dispatchEvent(new win.Event('change'));
}

async function probarLaVuelta(archivoPc, archivoMovil){
  console.log(`\n=== La Vuelta -- Fase A DICOSE (${archivoPc.includes('movil')?'móvil':'PC'} y su par) ===`);
  for(const archivo of [archivoPc, archivoMovil]){
    const servidor = crearServidor();
    const { win, errores } = await levantar(archivo, servidor);
    chequear(`${archivo}: carga sin errores`, errores.length===0, errores.join(' | '));
    if(errores.length){ continue; }

    const config = win.__config();
    chequear(`${archivo}: CONFIG.dicoseHabilitado = true`, config.dicoseHabilitado === true);

    const potreros = win.__potrerosGeo();
    const potrero = potreros[0].nombre;

    // ---- 1) Campo de guía visible, con auto-mayúscula y formato ----
    win.seleccionarPotrero(potrero);
    win.mostrarFormulario(potrero, 'compraventa');
    chequear(`${archivo}: #f-guia existe en el formulario de compraventa`, !!win.document.getElementById('f-guia'));

    win.document.getElementById('f-tipo-op').value = 'Compra';
    win.document.getElementById('f-cat').value = 'Vacas';
    win.document.getElementById('f-dueno').value = win.__config().duenos ? win.__config().duenos[0] : '';
    win.document.getElementById('f-cant').value = '10';
    win.document.getElementById('f-fecha').value = win.fechaISOHoy();
    win.document.getElementById('f-guia').value = 'malformato';
    win.document.getElementById('f-confirmar').click();
    const antesDeGuiaInvalida = (win.__est().potreros[potrero].historial||[]).length;
    chequear(`${archivo}: guía con formato inválido rechaza (no agrega historial)`, antesDeGuiaInvalida === 0, `historial=${antesDeGuiaInvalida}`);

    win.document.getElementById('f-guia').value = 'a123456'; // minúscula a propósito
    win.document.getElementById('f-confirmar').click();
    const hist1 = win.__est().potreros[potrero].historial;
    chequear(`${archivo}: guía en minúscula se guarda en MAYÚSCULA`, hist1.length===1 && hist1[0].extra && hist1[0].extra.guia === 'A123456', JSON.stringify(hist1[0]&&hist1[0].extra));
    chequear(`${archivo}: el texto del historial incluye la guía`, hist1[0].detalle.includes('guía A123456'), hist1[0].detalle);
    const keyVacasDueno0 = win.claveAnimal('Vacas', win.__config().duenos ? win.__config().duenos[0] : '');
    chequear(`${archivo}: la compra sí sumó stock (10 Vacas)`, win.__est().potreros[potrero].animales[keyVacasDueno0] === 10);

    // ---- 2) Agregar/editar/borrar guía después (📄) ----
    const idCompra = hist1[0].id;
    win.prompt = () => 'B654321';
    win.agregarGuiaCompraventa(idCompra);
    chequear(`${archivo}: agregarGuiaCompraventa reemplaza la guía`, win.__est().potreros[potrero].historial[0].extra.guia === 'B654321');
    chequear(`${archivo}: agregarGuiaCompraventa no tocó el stock`, win.__est().potreros[potrero].animales[keyVacasDueno0] === 10);

    win.prompt = () => 'formatoMal';
    win.agregarGuiaCompraventa(idCompra);
    chequear(`${archivo}: agregarGuiaCompraventa rechaza formato inválido (queda la anterior)`, win.__est().potreros[potrero].historial[0].extra.guia === 'B654321');

    win.prompt = () => '';
    win.agregarGuiaCompraventa(idCompra);
    chequear(`${archivo}: agregarGuiaCompraventa con vacío borra la guía`, win.__est().potreros[potrero].historial[0].extra.guia === null);

    // ---- 3) Sincronización de 'agregar_guia' a otro dispositivo ----
    const servidor2 = crearServidor();
    const otro = await levantar(archivo, servidor2);
    otro.win.seleccionarPotrero(potrero);
    otro.win.mostrarFormulario(potrero, 'compraventa');
    otro.win.document.getElementById('f-tipo-op').value = 'Compra';
    otro.win.document.getElementById('f-cat').value = 'Vacas';
    otro.win.document.getElementById('f-dueno').value = win.__config().duenos ? win.__config().duenos[0] : '';
    otro.win.document.getElementById('f-cant').value = '10';
    otro.win.document.getElementById('f-fecha').value = otro.win.fechaISOHoy();
    otro.win.document.getElementById('f-confirmar').click();
    const idOtro = otro.win.__est().potreros[potrero].historial[0].id;
    otro.win.aplicarEventoRemoto({
      tipo: 'correccion', potrero,
      detalle: {tipoOriginal:'compra', accion:'agregar_guia', categoria:'Vacas', cantidad:10, dueno: win.__config().duenos ? win.__config().duenos[0] : null, guia:'C999999', fechaOriginal: otro.win.__est().potreros[potrero].historial[0].fecha}
    }, new Set());
    chequear(`${archivo}: 'agregar_guia' sincronizado desde otro dispositivo aplica bien`, otro.win.__est().potreros[potrero].historial[0].extra.guia === 'C999999', JSON.stringify(otro.win.__est().potreros[potrero].historial[0].extra));

    // ---- 4) Campo ajeno: guía + varias categorías en un mismo movimiento ----
    const nombreDueno0 = win.__config().duenos ? win.__config().duenos[0] : '';
    const keyTernerosDueno0 = win.claveAnimal('Terneros', nombreDueno0);
    // arranca de 0 Terneros -- agregamos 8 vía Compra para poder enviarlas a campo ajeno también
    win.seleccionarPotrero(potrero);
    win.mostrarFormulario(potrero, 'compraventa');
    win.document.getElementById('f-tipo-op').value = 'Compra';
    win.document.getElementById('f-cat').value = 'Terneros';
    win.document.getElementById('f-dueno').value = nombreDueno0;
    win.document.getElementById('f-cant').value = '8';
    win.document.getElementById('f-fecha').value = win.fechaISOHoy();
    win.document.getElementById('f-confirmar').click();

    win.document.getElementById('btn-lluvias').click();
    chequear(`${archivo}: sección de campo ajeno visible (dicoseHabilitado)`, win.document.getElementById('campo-ajeno-seccion').style.display === 'block');
    chequear(`${archivo}: campo ajeno arranca con 1 fila de categoría`, win.document.querySelectorAll('#ca-filas .ca-fila').length === 1);
    win.document.getElementById('ca-agregar-fila').click();
    chequear(`${archivo}: "+ Agregar otra categoría" agrega una segunda fila`, win.document.querySelectorAll('#ca-filas .ca-fila').length === 2);

    setValor(win, 'ca-tipo', 'envio');
    win.document.getElementById('ca-potrero').value = potrero;
    win.document.getElementById('ca-guia').value = 'a111111'; // minúscula a propósito
    let filas = win.document.querySelectorAll('#ca-filas .ca-fila');
    filas[0].querySelector('.ca-cat').value = 'Vacas';
    filas[0].querySelector('.ca-dueno').value = nombreDueno0;
    filas[0].querySelector('.ca-cant').value = '4';
    filas[1].querySelector('.ca-cat').value = 'Terneros';
    filas[1].querySelector('.ca-dueno').value = nombreDueno0;
    filas[1].querySelector('.ca-cant').value = '3';
    win.document.getElementById('ca-fecha').value = win.fechaISOHoy();
    win.document.getElementById('ca-guardar').click();
    chequear(`${archivo}: envío resta Vacas del potrero`, win.__est().potreros[potrero].animales[keyVacasDueno0] === 6, win.__est().potreros[potrero].animales[keyVacasDueno0]);
    chequear(`${archivo}: envío resta Terneros del potrero`, win.__est().potreros[potrero].animales[keyTernerosDueno0] === 5, win.__est().potreros[potrero].animales[keyTernerosDueno0]);
    chequear(`${archivo}: envío suma Vacas al balde estado.campoAjeno`, win.__est().campoAjeno.animales[keyVacasDueno0] === 4);
    chequear(`${archivo}: envío suma Terneros al balde estado.campoAjeno`, win.__est().campoAjeno.animales[keyTernerosDueno0] === 3);
    chequear(`${archivo}: campo ajeno NO es un potrero real`, !win.__potrerosGeo().some(p=>p.nombre==='campoAjeno') && !win.__est().potreros.hasOwnProperty('campoAjeno'));
    const histEnvioMulti = win.__est().potreros[potrero].historial[0];
    chequear(`${archivo}: la guía en minúscula se guardó en MAYÚSCULA en campo ajeno`, histEnvioMulti.extra.guia === 'A111111', JSON.stringify(histEnvioMulti.extra));
    chequear(`${archivo}: el historial de campo ajeno lleva las 2 categorías`, histEnvioMulti.extra.items.length === 2);
    chequear(`${archivo}: el texto del historial menciona la guía`, histEnvioMulti.detalle.includes('guía A111111'), histEnvioMulti.detalle);

    // ---- 5) Retorno de las mismas 2 categorías ----
    win.document.getElementById('btn-lluvias').click(); // reabre y resetea a 1 fila
    win.document.getElementById('ca-agregar-fila').click();
    setValor(win, 'ca-tipo', 'retorno');
    win.document.getElementById('ca-potrero').value = potrero;
    filas = win.document.querySelectorAll('#ca-filas .ca-fila');
    filas[0].querySelector('.ca-cat').value = 'Vacas';
    filas[0].querySelector('.ca-dueno').value = nombreDueno0;
    filas[0].querySelector('.ca-cant').value = '4';
    filas[1].querySelector('.ca-cat').value = 'Terneros';
    filas[1].querySelector('.ca-dueno').value = nombreDueno0;
    filas[1].querySelector('.ca-cant').value = '3';
    win.document.getElementById('ca-guardar').click();
    chequear(`${archivo}: retorno devuelve Vacas al potrero`, win.__est().potreros[potrero].animales[keyVacasDueno0] === 10);
    chequear(`${archivo}: retorno devuelve Terneros al potrero`, win.__est().potreros[potrero].animales[keyTernerosDueno0] === 8);
    chequear(`${archivo}: retorno vacía el balde de Vacas`, win.__est().campoAjeno.animales[keyVacasDueno0] === 0);
    chequear(`${archivo}: retorno vacía el balde de Terneros`, win.__est().campoAjeno.animales[keyTernerosDueno0] === 0);

    // ---- 6) Borrar un envío (multi-categoría) revierte bien ----
    win.document.getElementById('btn-lluvias').click();
    win.document.getElementById('ca-agregar-fila').click();
    setValor(win, 'ca-tipo', 'envio');
    win.document.getElementById('ca-potrero').value = potrero;
    filas = win.document.querySelectorAll('#ca-filas .ca-fila');
    filas[0].querySelector('.ca-cat').value = 'Vacas';
    filas[0].querySelector('.ca-dueno').value = nombreDueno0;
    filas[0].querySelector('.ca-cant').value = '2';
    filas[1].querySelector('.ca-cat').value = 'Terneros';
    filas[1].querySelector('.ca-dueno').value = nombreDueno0;
    filas[1].querySelector('.ca-cant').value = '1';
    win.document.getElementById('ca-guardar').click();
    const histEnvio = win.__est().potreros[potrero].historial[0];
    chequear(`${archivo}: el envío quedó en el historial del potrero`, histEnvio.tipo === 'envio_campo_ajeno');
    win.borrarHistorial(histEnvio.id);
    chequear(`${archivo}: borrar el envío devuelve Vacas al potrero`, win.__est().potreros[potrero].animales[keyVacasDueno0] === 10);
    chequear(`${archivo}: borrar el envío devuelve Terneros al potrero`, win.__est().potreros[potrero].animales[keyTernerosDueno0] === 8);
    chequear(`${archivo}: borrar el envío vacía el balde de campo ajeno`, win.__est().campoAjeno.animales[keyVacasDueno0] === 0 && win.__est().campoAjeno.animales[keyTernerosDueno0] === 0);
    chequear(`${archivo}: el envío queda marcado ELIMINADO`, win.__est().potreros[potrero].historial[0].eliminado === true);

    // ---- 7) Sincronización de un envío multi-categoría a otro dispositivo ----
    const servidor3 = crearServidor();
    const otro2 = await levantar(archivo, servidor3);
    const totalAntesOtro2 = otro2.win.__est().potreros[potrero].animales[keyVacasDueno0] || 0;
    otro2.win.aplicarEventoRemoto({
      tipo: 'envio_campo_ajeno', potrero,
      detalle: {items: [{categoria:'Vacas', dueno: nombreDueno0||null, cantidad: 5}], guia: 'B222222'}
    }, new Set());
    chequear(`${archivo}: envío sincronizado desde otro dispositivo resta del potrero`, otro2.win.__est().potreros[potrero].animales[keyVacasDueno0] === Math.max(0, totalAntesOtro2 - 5));
    chequear(`${archivo}: envío sincronizado suma al balde de campo ajeno`, otro2.win.__est().campoAjeno.animales[keyVacasDueno0] === 5);
    chequear(`${archivo}: la guía viaja en el historial sincronizado`, otro2.win.__est().potreros[potrero].historial[0].origDatos.guia === 'B222222');
  }
}

async function probarSinDicose(archivoPc){
  console.log(`\n=== Otro establecimiento sin dicoseHabilitado (${archivoPc}) ===`);
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivoPc, servidor);
  chequear(`${archivoPc}: carga sin errores`, errores.length===0, errores.join(' | '));
  if(errores.length) return;
  chequear(`${archivoPc}: CONFIG.dicoseHabilitado no está activo`, !win.__config().dicoseHabilitado);
  const potrero = win.__potrerosGeo()[0] && win.__potrerosGeo()[0].nombre;
  if(potrero){
    win.seleccionarPotrero(potrero);
    win.mostrarFormulario(potrero, 'compraventa');
    chequear(`${archivoPc}: #f-guia NO existe (dicoseHabilitado desactivado)`, !win.document.getElementById('f-guia'));
  }
  win.document.getElementById('btn-lluvias').click();
  const seccion = win.document.getElementById('campo-ajeno-seccion');
  chequear(`${archivoPc}: sección de campo ajeno queda oculta`, !seccion || seccion.style.display !== 'block');
}

(async () => {
  const archivos = process.argv.slice(2);
  const laVueltaPc = archivos.find(a => a.includes('la-vuelta-pc'));
  const laVueltaMovil = archivos.find(a => a.includes('la-vuelta-movil'));
  const otros = archivos.filter(a => !a.includes('la-vuelta'));

  if(laVueltaPc && laVueltaMovil) await probarLaVuelta(laVueltaPc, laVueltaMovil);
  for(const a of otros) await probarSinDicose(a);

  console.log(`\n${fallas===0?'TODO OK':'HAY FALLAS: '+fallas}`);
  process.exit(fallas===0?0:1);
})();
