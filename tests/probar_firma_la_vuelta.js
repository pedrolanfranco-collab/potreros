/*
 * probar_firma_la_vuelta.js — la "Firma" (dueño opcional) agregada a La
 * Vuelta el 11/9/2026, para separar el ganado por firma (DICOSE): Pedro
 * Lanfranco, Silvia Dutra, Fideicomiso, y los animales ajenos de Walter
 * Lanfranco. A diferencia de María Laura/Pone Chico, acá el dato NO es
 * obligatorio.
 *
 * La parte delicada no es la UI, es la migración: antes de esto, La Vuelta
 * guardaba "animales" con clave de categoría pelada ("Vacas"). Con la
 * clave compuesta "categoria||firma" unificada, una clave vieja sin "||"
 * tiene que migrar a "clave||" (equivalente a "sin firma asignada") SIN
 * cambiar ningún total — si no, el stock quedaría partido en dos.
 *
 * Uso: node probar_firma_la_vuelta.js potreros_la_vuelta_pc.html potreros_la_vuelta_movil.html [maria_laura_pc.html ...]
 * Los archivos de La Vuelta corren la batería completa; cualquier otro
 * archivo pasado (María Laura / Pone Chico) solo se chequea que la Firma
 * siga siendo obligatoria ahí (no se volvió opcional por accidente).
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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

function crearServidor(){
  const filas = [];
  return { filas, createClient(){ return { from(){
    const q = { _filtros: [],
      insert(obj){ filas.push(Object.assign({}, obj, {creado_en: new Date().toISOString()})); return Promise.resolve({ error: null }); },
      select(){ return q; }, eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
      gt(col, val){ q._filtros.push(r => r[col] > val); return q; }, order(){ return q; },
      then(res){ const data = filas.filter(r => q._filtros.every(f => f(r))); return Promise.resolve(res({ data, error: null })); }
    };
    return q;
  } }; } };
}

async function levantar(archivo, seedLocalStorage){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const servidor = crearServidor();
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  if(seedLocalStorage) win.localStorage.setItem('la_vuelta_potreros_v1', JSON.stringify(seedLocalStorage));
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + `
    ;window.__est = function(){ return estado; };
    window.__mostrarFormulario = function(n,a){ seleccionarPotrero(n); return mostrarFormulario(n,a); };
    window.__aplicarRemoto = function(row){ return aplicarEventoRemoto(row); };
    window.__opcionesDuenos = function(){ return typeof opcionesDuenos==='function' ? opcionesDuenos() : null; };
  `); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores, servidor };
}

/* ---------- La Vuelta: migración + Firma opcional ---------- */
async function probarLaVuelta(archivo){
  console.log('\n=== ' + archivo + ' ===');

  // 1) Arranque en frío (CARGA_INICIAL_SEED, que todavía usa claves peladas
  //    en el propio archivo fuente) migra sin cambiar ningún total.
  const { win, errores } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores de JS', false, errores[0]); return; }
  chequear('carga sin errores de JS', true);
  const est = win.__est();
  const nombres = Object.keys(est.potreros);
  const totalGeneral = nombres.reduce((s,n)=> s + Object.values(est.potreros[n].animales).reduce((a,b)=>a+Number(b||0),0), 0);
  chequear('arranque en frío: hay animales cargados (seed no se perdió)', totalGeneral > 0, totalGeneral);
  const todasConFirma = nombres.every(n => Object.keys(est.potreros[n].animales).every(k => k.includes('||')));
  chequear('arranque en frío: todas las claves quedaron migradas a "categoria||firma"', todasConFirma);

  // 2) Simular un dispositivo real con datos VIEJOS guardados en
  //    localStorage (antes de la Firma) — confirma que la migración
  //    también corre sobre estado ya persistido, no solo sobre el seed.
  const potreroTest = nombres[0];
  const estadoViejo = JSON.parse(JSON.stringify(est));
  Object.keys(estadoViejo.potreros).forEach(n => { estadoViejo.potreros[n].animales = {}; estadoViejo.potreros[n].historial = []; });
  estadoViejo.potreros[potreroTest].animales = { 'Vacas': 12, 'Terneros': 3 };
  const { win: win2, errores: err2 } = await levantar(archivo, estadoViejo);
  if(err2.length){ chequear('dispositivo con datos viejos: carga sin errores', false, err2[0]); return; }
  const est2 = win2.__est();
  chequear('dispositivo con datos viejos: "Vacas" migró a "Vacas||" sin perder cantidad',
    est2.potreros[potreroTest].animales['Vacas||']===12 && est2.potreros[potreroTest].animales['Vacas']===undefined,
    JSON.stringify(est2.potreros[potreroTest].animales));
  chequear('dispositivo con datos viejos: total del potrero no cambió (12+3=15)',
    Object.values(est2.potreros[potreroTest].animales).reduce((a,b)=>a+b,0)===15);

  // 3) El formulario de "＋ Agregar" (potrero vacío, sirve de carga
  //    inicial) muestra el selector de Firma, con opción en blanco por
  //    default, y el envío NO se bloquea si se deja así.
  const potreroVacio = nombres.find(n => Object.values(est2.potreros[n].animales).every(v=>!v)) || nombres[1];
  const doc2 = win2.document;
  win2.__mostrarFormulario(potreroVacio, 'agregar');
  const filaFirma = doc2.querySelector('.agregar-fila');
  const selFirma = filaFirma && filaFirma.querySelector('.ag-dueno');
  chequear('el formulario de Agregar tiene un selector de Firma', !!selFirma);
  chequear('el label dice "Firma" (no "Dueño")', doc2.getElementById('form-zona').innerHTML.includes('Firma'));
  chequear('la opción en blanco ("sin asignar") es la seleccionada por default', selFirma && selFirma.value==='');
  filaFirma.querySelector('.ag-cat').value = 'Vacas';
  filaFirma.querySelector('.ag-cant').value = '5';
  doc2.getElementById('f-confirmar').dispatchEvent(new win2.Event('click', { bubbles: true }));
  const claveSinFirma = 'Vacas||';
  chequear('cargar sin elegir Firma no bloquea el formulario, cae en "sin firma"',
    (est2.potreros[potreroVacio].animales[claveSinFirma]||0)===5,
    JSON.stringify(est2.potreros[potreroVacio].animales));

  // 4) Elegir una Firma real deja una clave DISTINTA de la de "sin firma"
  //    (no se mezclan). El potrero ya no está vacío, así que "agregar" de
  //    nuevo mostraría el aviso de "solo carga inicial" -- se usa
  //    "compraventa" (Compra), que sí admite sumar con stock existente.
  win2.__mostrarFormulario(potreroVacio, 'compraventa');
  doc2.getElementById('f-cat').value = 'Vacas';
  doc2.getElementById('f-dueno').value = 'Silvia Dutra';
  doc2.getElementById('f-cant').value = '2';
  doc2.getElementById('f-confirmar').dispatchEvent(new win2.Event('click', { bubbles: true }));
  chequear('cargar con una Firma elegida abre una clave separada de "sin firma"',
    (est2.potreros[potreroVacio].animales['Vacas||Silvia Dutra']||0)===2 && (est2.potreros[potreroVacio].animales[claveSinFirma]||0)===5,
    JSON.stringify(est2.potreros[potreroVacio].animales));

  // 5) Un evento remoto VIEJO (de antes de la Firma, sin campo "dueno")
  //    tiene que caer en la misma clave "sin firma" que usa el dispositivo
  //    migrado -- si no, un dispositivo nuevo que reconstruye desde cero
  //    terminaría con el stock partido en dos claves distintas.
  const potreroRemoto = nombres[nombres.length-1];
  est2.potreros[potreroRemoto].animales = {};
  win2.__aplicarRemoto({ tipo:'ingreso', potrero: potreroRemoto, fecha_cliente:'01/01/2026',
    detalle:{ categoria:'Novillos', cantidad:8 } }); // sin "dueno": evento pre-Firma
  chequear('evento remoto viejo (sin "dueno") cae en la clave "sin firma", no en una pelada',
    est2.potreros[potreroRemoto].animales['Novillos||']===8 && est2.potreros[potreroRemoto].animales['Novillos']===undefined,
    JSON.stringify(est2.potreros[potreroRemoto].animales));
}

/* ---------- María Laura / Pone Chico: la Firma sigue obligatoria ---------- */
async function probarSigueObligatorio(archivo){
  console.log('\n=== ' + archivo + ' (Dueño debe seguir siendo obligatorio) ===');
  const { win, errores } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores de JS', false, errores[0]); return; }
  const opciones = win.__opcionesDuenos();
  chequear('el selector de Dueño NO tiene una opción en blanco (sigue obligatorio)',
    typeof opciones === 'string' && !opciones.includes('value=""'), opciones);
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){
    console.log('Uso: node probar_firma_la_vuelta.js <la_vuelta_pc.html> [la_vuelta_movil.html] [otros_establecimientos.html ...]');
    process.exit(1);
  }
  for(const a of archivos){
    if(/la[_-]vuelta/.test(a)) await probarLaVuelta(a);
    else await probarSigueObligatorio(a);
  }
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
