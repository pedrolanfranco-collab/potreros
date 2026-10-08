/*
 * Prueba ad-hoc: traslado de hacienda entre establecimientos (La Vuelta -> María
 * Laura, 7/10/2026). Es el primer test que levanta DOS establecimientos distintos
 * contra el MISMO servidor simulado: la salida se carga una sola vez en La Vuelta,
 * y la entrada tiene que aparecer sola en María Laura.
 *
 * Cubre: id derivado (UUID válido y determinístico), formulario (guía obligatoria,
 * dueño de allá obligatorio, saldo que bloquea, sugerencia de dueño por el mapa),
 * que la salida escriba DOS filas (una por stream), que María Laura aplique la
 * entrada con el dueño ya convertido, destino inexistente (se estaciona), la cola
 * offline (el establecimiento destino viaja con el evento), anular (borrar la
 * salida) en los dos campos, que la entrada no se pueda borrar desde María Laura,
 * y que sin el flag / en otras apps no haya UI ni consultas cruzadas.
 *
 * Uso: node tests/probar_traslado.js <la-vuelta-X/index.html> <maria-laura-X/index.html> [...pares]
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

// Servidor simulado COMPARTIDO por todas las apps del test. Filtra por columna igual que
// Supabase (.eq('establecimiento', ...)) y rechaza un event_id repetido con 23505 (UNIQUE global).
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
                reloj += 10; // creado_en estrictamente creciente (el cursor usa .gt)
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
  // un toast capturado nos dice POR QUÉ se rechazó un formulario
  win.__toasts = [];
  const toastOriginal = win.toast;
  win.toast = function(m){ win.__toasts.push(m); return toastOriginal(m); };
  return { win, errores };
}

function setValor(win, el, val){
  el.value = val;
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function ultimoToast(win){ return win.__toasts[win.__toasts.length-1] || ''; }

/* Llena el formulario "🚚 Traslado a otro campo" y aprieta Registrar. filas = [{cat, dueno, duenoDestino?, cant}] */
function cargarTraslado(win, o){
  win.document.getElementById('btn-lluvias').click();
  win.document.getElementById('tr-origen').value = o.origen;
  win.document.getElementById('tr-destino').value = o.destino;
  win.document.getElementById('tr-guia').value = o.guia;
  win.document.getElementById('tr-fecha').value = win.fechaISOHoy();
  win.document.getElementById('tr-obs').value = o.obs || '';
  o.filas.forEach((f, i) => {
    if(i > 0) win.document.getElementById('tr-agregar-fila').click();
    const fila = win.document.querySelectorAll('#tr-filas .tr-fila')[i];
    fila.querySelector('.tr-cat').value = f.cat;
    setValor(win, fila.querySelector('.tr-dueno'), f.dueno);          // dispara la sugerencia del mapa
    if(f.duenoDestino !== undefined) fila.querySelector('.tr-dueno-dest').value = f.duenoDestino;
    fila.querySelector('.tr-cant').value = String(f.cant);
  });
  win.document.getElementById('tr-guardar').click();
}

async function probarPar(archivoLV, archivoML){
  const etiqueta = archivoLV.includes('movil') ? 'móvil' : 'PC';
  console.log(`\n=== Traslado La Vuelta → María Laura (${etiqueta}): ${archivoLV} + ${archivoML} ===`);
  const servidor = crearServidor();
  const lv = await levantar(archivoLV, servidor);
  const ml = await levantar(archivoML, servidor);
  // segundo dispositivo de La Vuelta: se abre ANTES del traslado (si se abriera después, su sincronización
  // de arranque ya aplicaría la salida y el stock de partida que le pongamos pisaría ese resultado)
  const lv2 = await levantar(archivoLV, servidor);
  chequear(`${etiqueta}: La Vuelta carga sin errores`, lv.errores.length===0, lv.errores.join(' | '));
  chequear(`${etiqueta}: María Laura carga sin errores`, ml.errores.length===0, ml.errores.join(' | '));
  if(lv.errores.length || ml.errores.length) return;
  const LV = lv.win, ML = ml.win;

  chequear(`${etiqueta}: las dos apps son de establecimientos distintos`, LV.__establecimiento()==='la_vuelta' && ML.__establecimiento()==='maria_laura', `${LV.__establecimiento()} / ${ML.__establecimiento()}`);

  // ---- 0) El flag viene APAGADO en el HTML publicado (Release 1): sin UI ----
  chequear(`${etiqueta}: CONFIG.trasladoHabilitado viene apagado (Release 1)`, LV.__config().trasladoHabilitado === false, String(LV.__config().trasladoHabilitado));
  LV.document.getElementById('btn-lluvias').click();
  chequear(`${etiqueta}: con el flag apagado la sección de traslado queda oculta`, LV.document.getElementById('traslado-seccion').style.display !== 'block');
  LV.__config().trasladoHabilitado = true; // lo que hará el Release 2
  LV.document.getElementById('btn-lluvias').click();
  const seccion = LV.document.getElementById('traslado-seccion');
  chequear(`${etiqueta}: con el flag prendido la sección aparece`, seccion.style.display === 'block');
  const destinos = Array.from(LV.document.getElementById('tr-destino').options).map(o=>o.value);
  chequear(`${etiqueta}: la lista de destino son los potreros de María Laura`, JSON.stringify(destinos) === JSON.stringify(['Tajamar','Casco','Uno','Rincon','Manantial']), destinos.join(','));
  chequear(`${etiqueta}: el texto nombra a María Laura`, LV.document.getElementById('tr-info').textContent.includes('María Laura'));
  // los potreros de destino realmente existen en María Laura
  const potrerosML = ML.__potrerosGeo().map(p=>p.nombre);
  chequear(`${etiqueta}: los destinos de la config existen en la app de María Laura`, destinos.every(d=>potrerosML.includes(d)), potrerosML.join(','));

  // stock de partida en el potrero de origen
  const origen = LV.__potrerosGeo()[0].nombre;
  const kVacasSilvia = LV.claveAnimal('Vacas', 'Silvia Dutra');
  const kTernSilvia = LV.claveAnimal('Terneros', 'Silvia Dutra');
  const aLV = LV.__est().potreros[origen].animales;
  aLV[kVacasSilvia] = 20; aLV[kTernSilvia] = 5;
  lv2.win.__est().potreros[origen].animales[kVacasSilvia] = 20; lv2.win.__est().potreros[origen].animales[kTernSilvia] = 5;
  const trans0 = (LV.__est().transacciones || []).length;
  const kMLVacas = ML.claveAnimal('Vacas', 'Silvia');
  const kMLTern = ML.claveAnimal('Terneros', 'Silvia');

  // ---- 1) validaciones del formulario ----
  const filaSilvia = (cant, cat) => ({cat: cat||'Vacas', dueno: 'Silvia Dutra', cant});
  cargarTraslado(LV, {origen, destino: 'Casco', guia: '', filas: [filaSilvia(3)]});
  chequear(`${etiqueta}: sin guía NO se registra`, aLV[kVacasSilvia]===20 && servidor.filas.eventos_sync.length===0, ultimoToast(LV));
  cargarTraslado(LV, {origen, destino: 'Casco', guia: 'mal', filas: [filaSilvia(3)]});
  chequear(`${etiqueta}: guía mal formada NO se registra`, aLV[kVacasSilvia]===20 && servidor.filas.eventos_sync.length===0, ultimoToast(LV));
  cargarTraslado(LV, {origen, destino: 'Casco', guia: 'A123456', filas: [{cat:'Vacas', dueno:'Pedro Lanfranco', duenoDestino:'', cant:1}]});
  chequear(`${etiqueta}: sin dueño de allá NO se registra`, servidor.filas.eventos_sync.length===0 && /dueño/i.test(ultimoToast(LV)), ultimoToast(LV));
  cargarTraslado(LV, {origen, destino: 'Casco', guia: 'A123456', filas: [filaSilvia(25)]});
  chequear(`${etiqueta}: saldo insuficiente BLOQUEA (no deja negativo)`, aLV[kVacasSilvia]===20 && servidor.filas.eventos_sync.length===0 && /hay 20/.test(ultimoToast(LV)), ultimoToast(LV));

  // ---- 2) sugerencia del dueño de allá por el mapa ----
  LV.document.getElementById('btn-lluvias').click();
  const fila0 = LV.document.querySelector('#tr-filas .tr-fila');
  setValor(LV, fila0.querySelector('.tr-dueno'), 'Silvia Dutra');
  chequear(`${etiqueta}: al elegir Silvia Dutra se sugiere "Silvia" allá`, fila0.querySelector('.tr-dueno-dest').value === 'Silvia', fila0.querySelector('.tr-dueno-dest').value);

  // ---- 3) traslado válido de 2 categorías ----
  const ev0 = servidor.filas.eventos_sync.length;
  cargarTraslado(LV, {origen, destino: 'Casco', guia: 'a123456', obs: 'camión de prueba', filas: [filaSilvia(8), filaSilvia(3, 'Terneros')]});
  await dormir(80);
  chequear(`${etiqueta}: la salida resta Vacas del origen`, aLV[kVacasSilvia]===12, aLV[kVacasSilvia]);
  chequear(`${etiqueta}: la salida resta Terneros del origen`, aLV[kTernSilvia]===2, aLV[kTernSilvia]);
  const h = LV.__est().potreros[origen].historial[0];
  chequear(`${etiqueta}: renglón de historial 'traslado_salida' con guía en MAYÚSCULA y trasladoId`, h.tipo==='traslado_salida' && h.extra.guia==='A123456' && !!h.extra.trasladoId, JSON.stringify(h.extra));
  chequear(`${etiqueta}: el texto dice a dónde fue`, h.detalle.includes('María Laura') && h.detalle.includes('Casco') && h.detalle.includes('A123456'), h.detalle);
  const nuevos = servidor.filas.eventos_sync.slice(ev0);
  chequear(`${etiqueta}: se escribieron DOS filas`, nuevos.length===2, String(nuevos.length));
  const fSalida = nuevos.find(r=>r.tipo==='traslado_salida');
  const fEntrada = nuevos.find(r=>r.tipo==='traslado_entrada');
  chequear(`${etiqueta}: la salida va al stream de La Vuelta`, fSalida && fSalida.establecimiento==='la_vuelta' && fSalida.potrero===origen);
  chequear(`${etiqueta}: la entrada va al stream de María Laura, potrero Casco`, fEntrada && fEntrada.establecimiento==='maria_laura' && fEntrada.potrero==='Casco');
  chequear(`${etiqueta}: los dos event_id son UUID válidos y distintos`, fSalida && fEntrada && REGEX_UUID.test(fSalida.event_id) && REGEX_UUID.test(fEntrada.event_id) && fSalida.event_id!==fEntrada.event_id);
  chequear(`${etiqueta}: el event_id de la entrada es el derivado del de la salida (determinístico)`, fEntrada.event_id === LV.uuidDerivado(fSalida.event_id, 'entrada'));
  chequear(`${etiqueta}: la entrada lleva el dueño YA convertido (Silvia) y la salida el original`,
    fEntrada.detalle.items.every(i=>i.dueno==='Silvia') && fSalida.detalle.items.every(i=>i.dueno==='Silvia Dutra'));
  chequear(`${etiqueta}: salida y entrada comparten trasladoId y guía`, fSalida.detalle.trasladoId===fEntrada.detalle.trasladoId && fEntrada.detalle.guia==='A123456' && fSalida.detalle.guia==='A123456');
  chequear(`${etiqueta}: no se generó ninguna transacción (no es compra/venta)`, (LV.__est().transacciones||[]).length === trans0);

  // ---- 4) María Laura lo recibe sola, sin que nadie cargue nada allá ----
  const stockMLAntes = ML.__est().potreros['Casco'].animales[kMLVacas] || 0;
  await ML.sincronizar();
  const aML = ML.__est().potreros['Casco'].animales;
  chequear(`${etiqueta}: María Laura suma las Vacas en Casco (dueño Silvia)`, (aML[kMLVacas]||0) === stockMLAntes + 8, aML[kMLVacas]);
  chequear(`${etiqueta}: María Laura suma los Terneros en Casco`, aML[kMLTern] === 3, aML[kMLTern]);
  const hML = ML.__est().potreros['Casco'].historial[0];
  chequear(`${etiqueta}: el historial de María Laura dice "Traslado desde La Vuelta" con guía`, hML.tipo==='traslado_entrada' && hML.detalle.includes('desde La Vuelta') && hML.detalle.includes('A123456'), hML.detalle);
  chequear(`${etiqueta}: el renglón recibido guarda el trasladoId`, hML.origDatos && hML.origDatos.trasladoId === fSalida.detalle.trasladoId);
  chequear(`${etiqueta}: la entrada tampoco genera transacción en María Laura`, (ML.__est().transacciones||[]).length === 0);
  await ML.sincronizar();
  chequear(`${etiqueta}: sincronizar de nuevo no la reaplica`, ML.__est().potreros['Casco'].animales[kMLVacas] === stockMLAntes + 8);

  // La Vuelta NO se baja la entrada de María Laura (cada app lee solo su stream)
  const stockLVAntes = aLV[kVacasSilvia];
  await LV.sincronizar();
  chequear(`${etiqueta}: La Vuelta no se aplica la entrada del otro stream`, aLV[kVacasSilvia]===stockLVAntes && !LV.__est().potreros[origen].historial.some(x=>x.tipo==='traslado_entrada'));

  // ---- 5) la entrada NO se borra desde María Laura (se anula desde el origen) ----
  const idEntradaML = hML.id;
  ML.borrarHistorial(idEntradaML);
  chequear(`${etiqueta}: borrar la entrada desde María Laura está bloqueado`, !ML.__est().potreros['Casco'].historial[0].eliminado && ML.__est().potreros['Casco'].animales[kMLVacas]===stockMLAntes+8 && /origen/.test(ultimoToast(ML)), ultimoToast(ML));
  ML.editarHistorial(idEntradaML);
  chequear(`${etiqueta}: editar un traslado está bloqueado`, !ML.__est().potreros['Casco'].historial[0].eliminado);

  // ---- 6) otro dispositivo de La Vuelta aplica la salida ----
  await lv2.win.sincronizar();
  const a2 = lv2.win.__est().potreros[origen].animales;
  chequear(`${etiqueta}: otro dispositivo de La Vuelta resta la salida`, a2[kVacasSilvia]===12 && a2[kTernSilvia]===2, `${a2[kVacasSilvia]}/${a2[kTernSilvia]}`);
  const h2 = lv2.win.__est().potreros[origen].historial[0];
  chequear(`${etiqueta}: …y deja el renglón con su trasladoId`, h2.tipo==='traslado_salida' && h2.origDatos.trasladoId===fSalida.detalle.trasladoId);

  // ---- 7) ANULAR: borrar la salida revierte los DOS campos ----
  const evAntesAnular = servidor.filas.eventos_sync.length;
  LV.borrarHistorial(h.id);
  await dormir(80);
  chequear(`${etiqueta}: anular devuelve las Vacas al origen`, aLV[kVacasSilvia]===20 && aLV[kTernSilvia]===5, `${aLV[kVacasSilvia]}/${aLV[kTernSilvia]}`);
  chequear(`${etiqueta}: el renglón de la salida queda ELIMINADO`, LV.__est().potreros[origen].historial[0].eliminado===true);
  const evAnular = servidor.filas.eventos_sync.slice(evAntesAnular);
  const corrLV = evAnular.find(r=>r.establecimiento==='la_vuelta' && r.tipo==='correccion');
  const corrML = evAnular.find(r=>r.establecimiento==='maria_laura' && r.tipo==='correccion');
  chequear(`${etiqueta}: la corrección propia va al stream de La Vuelta`, !!corrLV && corrLV.detalle.accion==='eliminar' && corrLV.detalle.reversar.tipo==='traslado_salida_ajuste');
  chequear(`${etiqueta}: y se escribe una "anular_traslado" en el stream de María Laura, potrero Casco`, !!corrML && corrML.detalle.accion==='anular_traslado' && corrML.potrero==='Casco' && corrML.detalle.trasladoId===fSalida.detalle.trasladoId);
  chequear(`${etiqueta}: el id de la anulación es derivado del de la corrección propia`, !!corrLV && !!corrML && corrML.event_id===LV.uuidDerivado(corrLV.event_id, 'anular') && REGEX_UUID.test(corrML.event_id));
  await ML.sincronizar();
  const aML2 = ML.__est().potreros['Casco'].animales;
  chequear(`${etiqueta}: María Laura saca lo que había entrado`, (aML2[kMLVacas]||0)===stockMLAntes && (aML2[kMLTern]||0)===0, `${aML2[kMLVacas]}/${aML2[kMLTern]}`);
  const hML2 = ML.__est().potreros['Casco'].historial.find(x=>x.tipo==='traslado_entrada');
  chequear(`${etiqueta}: su renglón queda ANULADO`, hML2.eliminado===true && hML2.detalle.includes('ANULADO'), hML2.detalle);
  await lv2.win.sincronizar();
  chequear(`${etiqueta}: el otro dispositivo de La Vuelta también recupera el stock y tacha el renglón`,
    lv2.win.__est().potreros[origen].animales[kVacasSilvia]===20 && lv2.win.__est().potreros[origen].historial.find(x=>x.tipo==='traslado_salida').eliminado===true,
    String(lv2.win.__est().potreros[origen].animales[kVacasSilvia]));

  // ---- 8) anular cuando María Laura ya movió parte de esos animales: trunca y avisa ----
  cargarTraslado(LV, {origen, destino: 'Uno', guia: 'B654321', filas: [filaSilvia(6)]});
  await dormir(80);
  await ML.sincronizar();
  const kUno = ML.__est().potreros['Uno'].animales;
  chequear(`${etiqueta}: segundo traslado llega a Uno`, (kUno[kMLVacas]||0) >= 6, String(kUno[kMLVacas]));
  kUno[kMLVacas] = (kUno[kMLVacas]||0) - 4; // María Laura ya movió 4 a otro potrero
  const hSegundo = LV.__est().potreros[origen].historial.find(x=>x.tipo==='traslado_salida' && !x.eliminado);
  LV.borrarHistorial(hSegundo.id);
  await dormir(80);
  await ML.sincronizar();
  const hUno = ML.__est().potreros['Uno'].historial.find(x=>x.tipo==='traslado_entrada');
  chequear(`${etiqueta}: la resta se trunca en 0 (no queda negativo) y el renglón avisa "revisar"`, kUno[kMLVacas] >= 0 && hUno.eliminado && /revisar/.test(hUno.detalle), `${kUno[kMLVacas]} | ${hUno.detalle}`);

  // ---- 9) destino inexistente: se estaciona en vez de perderse ----
  ML.aplicarEventoRemoto({event_id:'e-fantasma', creado_en:'2026-10-09T00:00:00Z', tipo:'traslado_entrada', potrero:'Potrero Que No Existe',
    detalle:{items:[{categoria:'Vacas', dueno:'Silvia', cantidad:2}], guia:'C111111', trasladoId:'t-x'}, dispositivo:'otro'}, new Set());
  chequear(`${etiqueta}: una entrada a un potrero desconocido se estaciona`, ((ML.__est().pendientesPotrero||{})['Potrero Que No Existe']||[]).length===1);

  // ---- 10) cola offline: el establecimiento destino viaja con el evento ----
  LV.navigator.onLine = false;
  const evAntesCola = servidor.filas.eventos_sync.length;
  cargarTraslado(LV, {origen, destino: 'Rincon', guia: 'D222222', filas: [filaSilvia(2)]});
  await dormir(60);
  const cola = LV.__est().colaSync || [];
  chequear(`${etiqueta}: sin señal quedan 2 eventos en la cola`, cola.length===2 && servidor.filas.eventos_sync.length===evAntesCola, String(cola.length));
  chequear(`${etiqueta}: la cola recuerda a qué establecimiento va cada uno`, cola.find(e=>e.tipo==='traslado_entrada').establecimiento==='maria_laura' && !cola.find(e=>e.tipo==='traslado_salida').establecimiento);
  LV.navigator.onLine = true;
  await LV.vaciarColaSync();
  await dormir(60);
  const subidos = servidor.filas.eventos_sync.slice(evAntesCola);
  chequear(`${etiqueta}: al volver la señal se suben cada uno a su stream`, subidos.length===2 && subidos.some(r=>r.tipo==='traslado_salida'&&r.establecimiento==='la_vuelta') && subidos.some(r=>r.tipo==='traslado_entrada'&&r.establecimiento==='maria_laura'));
  chequear(`${etiqueta}: la cola queda vacía`, (LV.__est().colaSync||[]).length===0);
  // un reintento con el mismo event_id no duplica (UNIQUE -> 23505 cuenta como éxito)
  const repetido = subidos.find(r=>r.tipo==='traslado_entrada');
  const okRep = await LV.pushEventoRemoto({event_id: repetido.event_id, tipo: repetido.tipo, potrero: repetido.potrero, detalle: repetido.detalle, fecha_cliente: repetido.fecha_cliente, establecimiento: 'maria_laura'});
  chequear(`${etiqueta}: reintentar el mismo evento no duplica y cuenta como éxito`, okRep===true && servidor.filas.eventos_sync.filter(r=>r.event_id===repetido.event_id).length===1);

  // ---- 11) uuidDerivado ----
  const bases = Array.from({length:40}, (_,i)=> LV.crypto.randomUUID ? LV.crypto.randomUUID() : 'b'+i);
  chequear(`${etiqueta}: uuidDerivado siempre da un UUID válido`, bases.every(b=>REGEX_UUID.test(LV.uuidDerivado(b,'entrada'))));
  chequear(`${etiqueta}: uuidDerivado es determinístico y cambia con el sufijo`, LV.uuidDerivado(bases[0],'x')===LV.uuidDerivado(bases[0],'x') && LV.uuidDerivado(bases[0],'x')!==LV.uuidDerivado(bases[0],'y') && LV.uuidDerivado(bases[0],'x')!==LV.uuidDerivado(bases[1],'x'));
}

async function probarSinUI(archivo){
  console.log(`\n=== Sin traslado (${archivo}) ===`);
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  chequear(`${archivo}: carga sin errores`, errores.length===0, errores.join(' | '));
  if(errores.length) return;
  chequear(`${archivo}: CONFIG.trasladoHabilitado no está activo`, !win.__config().trasladoHabilitado);
  const btn = win.document.getElementById('btn-lluvias');
  if(btn) btn.click();
  const seccion = win.document.getElementById('traslado-seccion');
  chequear(`${archivo}: la sección de traslado queda oculta o no existe`, !seccion || seccion.style.display !== 'block');
}

(async () => {
  const archivos = process.argv.slice(2);
  // la variante "Campo" (movil-simple, empleado) NO lleva traslado a propósito: va al chequeo "sin UI"
  const lvs = archivos.filter(a => a.includes('la-vuelta') && !a.includes('campo'));
  const mls = archivos.filter(a => a.includes('maria-laura'));
  for(const lvArchivo of lvs){
    const par = mls.find(m => m.includes('movil') === lvArchivo.includes('movil'));
    if(par) await probarPar(lvArchivo, par);
  }
  for(const a of archivos.filter(a => !a.includes('la-vuelta') || a.includes('campo'))) await probarSinUI(a);
  console.log(`\n${fallas===0?'TODO OK':'HAY FALLAS: '+fallas}`);
  process.exit(fallas===0?0:1);
})();
