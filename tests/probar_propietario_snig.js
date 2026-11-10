/*
 * Prueba: el PROPIETARIO SEGÚN EL SNIG en la ficha de la caravana (9/11/2026, a pedido de Pedro; CONFIG.propietarioSnig).
 *
 * El Lector publica en animales_caravana: propietario_snig (nombre según el SNIG), en_snig (true / false / null: null
 * = no hay export de ese campo) y campo_snig (dónde ubica el SNIG al animal). La app SOLO LEE. Se verifica:
 *  - La Vuelta y María Laura: "Propietario (SNIG)" con el nombre traducido por mapaDuenos, justo antes de la fila del
 *    dueño del bastón; en_snig=false dice "Sin SNIG — firma: ..." (con textoFirma: sin dueño no sale "undefined");
 *    en_snig=true sin nombre dice "Propietario sin nombre en el SNIG"; en_snig=null no sale nada.
 *  - campo_snig de otro campo: la línea de alerta "⚠ Según el SNIG está en ..." debajo del cartel; nunca bloquea.
 *    Del mismo campo, no.
 *  - Un animal solo-SNIG (sin lectura del bastón, propietario vacío) no rompe la ficha.
 *  - Caravana ausente: el aviso "No figura en el padrón ni en el SNIG" solo con señal; desde la copia del celular
 *    (La Vuelta móvil, sin señal) no se agrega.
 *  - Pone Chico (CONFIG.propietarioSnig=false): no sale ninguna línea del SNIG, y propietarioSnigDe() es null.
 *
 * Uso (desde la raíz, como el CI):
 *   node tests/probar_propietario_snig.js la-vuelta-pc/index.html maria-laura-pc/index.html pone-chico-pc/index.html la-vuelta-movil/index.html
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
// 9/11/2026 (revisión): un error sin atrapar dentro de la app (p. ej. una función que no existe en la variante) es una
// falla de la prueba, no un cierre del proceso que oculte lo que sigue.
process.on('unhandledRejection', e => { chequear('la app no tiene errores sin atrapar', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); });

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

// Fila base: estado APTO fijo para que la ficha no dependa de la fecha de hoy.
const BASE = { estado_carencia: 'APTO', fecha_apto: null, producto_carencia: null,
  proximo_tratamiento: null, ultimo_peso: null, peso_fecha: null, ultima_lectura: '2026-10-13',
  sexo: 'HEMBRA', categoria: 'Vaca', gen: '7', propietario: 'FIDEICOMISO', potrero: '23', estado_vida: 'ACTIVO',
  rodeo: null, rodeo_fecha: null, nota: null, nota_fecha: null, en_snig: true, propietario_snig: null, campo_snig: null };

// Lo que cambia por campo: el nombre que manda el SNIG, cómo sale traducido y el campo "ajeno" para la alerta.
const CAMPOS = {
  la_vuelta: { snig: 'Silvia', esperado: 'Silvia Dutra', otro: 'maria_laura', otroLegible: 'María Laura' },
  maria_laura: { snig: 'Pedro Lanfranco', esperado: 'Pedro', otro: 'la_vuelta', otroLegible: 'La Vuelta' },
};

function filasDeCaja(caja){
  return Array.from(caja.querySelectorAll('table tr')).map(tr => {
    const td = tr.querySelectorAll('td');
    return [td[0] && td[0].textContent.trim(), td[1] && td[1].textContent.trim()];
  });
}

function padronDe(est, extras){
  return Object.entries(extras).map(([id8, extra]) =>
    Object.assign({}, BASE, { establecimiento: est, id8, ide: '858000' + id8 }, extra));
}

// RED.caida: el falso de Supabase devuelve error (sin señal). Se prende a mano en las pruebas que lo necesitan.
// RED.colgada (revisión): la consulta nunca vuelve (ni error ni datos): el reporte tiene que salir igual por el tope de 8 s.
const RED = { caida: false, colgada: false };
// Cada consulta paginada (.range) del falso queda anotada acá: la prueba de 1100 filas cuenta las páginas.
const LLAMADAS = [];
// Cada consulta a una tabla (con o sin .range) queda anotada: el Stock total no debe pedir el padrón con el flag apagado (3E-1).
const CONSULTAS = [];

// "Hoy" fijo para la ventana: el Date del navegador simulado devuelve el mediodía local de esa fecha.
// Así los días desde el ingreso al predio no dependen del reloj real.
function fijarHoy(win, iso){
  const [y, m, d] = iso.split('-').map(Number);
  const ms = new Date(y, m - 1, d, 12, 0, 0).getTime();
  win.eval('(function(){ const R = Date; const FIJO = ' + ms + '; '
    + 'function F(...a){ if(!new.target) return new R(FIJO).toString(); return a.length ? new R(...a) : new R(FIJO); } '
    + 'F.now = () => FIJO; F.UTC = R.UTC; F.parse = R.parse; F.prototype = R.prototype; window.Date = F; })();');
}
const HOY_TEST = '2026-11-09';
// Fecha ISO de hace n días respecto de HOY_TEST (calendario local, como la app).
function diasAtrasISO(n){
  const d = new Date(2026, 10, 9); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const ddmm = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
function crearServidor(filas){
  return {
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          insert(){ return Promise.resolve({ error: null }); },
          select(){ return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          gt(){ return q; }, gte(){ return q; }, order(){ return q; }, limit(){ return q; },
          range(d, h){ q._rango = [d, h]; return q; },
          is(col, val){ q._filtros.push(r => val === null ? (r[col] === null || r[col] === undefined) : r[col] === val); return q; },
          in(col, vals){ q._filtros.push(r => vals.indexOf(r[col]) >= 0); return q; },
          then(res){
            CONSULTAS.push(tabla);
            if(RED.colgada) return new Promise(() => {});
            if(RED.caida) return Promise.resolve(res({ data: null, error: { message: 'sin señal' } }));
            let data = (tabla === 'animales_caravana' ? filas : []).filter(r => q._filtros.every(f => f(r)));
            // Como PostgREST: con .range() devuelve solo esa franja (y la anota para contar las páginas pedidas).
            if(q._rango){ LLAMADAS.push({ tabla, rango: q._rango.slice() }); data = data.slice(q._rango[0], q._rango[1] + 1); }
            return Promise.resolve(res({ data, error: null }));
          }
        };
        return q;
      } };
    }
  };
}

async function levantar(archivo, filas, opciones){
  RED.caida = false;
  RED.colgada = false;
  let html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  // opciones.geo: un potrero de prueba en la config (Pone Chico no trae ninguno en su config)
  if(opciones && opciones.geo) html = html.replace('"potrerosGeo":[]', '"potrerosGeo":' + JSON.stringify(opciones.geo));
  // opciones.sinSnig (3E-1): apaga CONFIG.propietarioSnig para comparar el Stock total con y sin la pestaña nueva
  if(opciones && opciones.sinSnig) html = html.replace(/"propietarioSnig":\{"mapaDuenos":\{[^}]*\}\}/, '"propietarioSnig":false');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  if(opciones && opciones.hoy) fijarHoy(win, opciones.hoy);
  LLAMADAS.length = 0;
  CONSULTAS.length = 0;
  win.supabase ={ createClient: crearServidor(filas).createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent)
    .filter(Boolean).join('\n');
  try {
    win.eval(codigo + '\n;window.__cfg = CONFIG; window.__ficha = fichaCaravanaHTML; window.__snigDe = propietarioSnigDe;'
      + ' window.__snigAusente = propietarioSnigAusente; window.__padronLocal = padronLocal; window.__idDisp = idDispositivo;'
      + ' window.__est = function(){ return estado; }; window.__snigEstado = snigEstadoSinLectura; window.__geo = function(){ return POTREROS_GEO; };'
      + ' window.__familia = familiaCategoriaSnig; window.__resumenStock = resumenPorPropietarioSnig; window.__htmlStock = htmlPorPropietarioSnig;'
      + ' window.__resumenPot = resumenSnigPotrero; window.__especies = ESPECIES;');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function buscar(win, id8){
  const doc = win.document;
  doc.getElementById('cv-numero').value = id8;
  doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(60);
  return doc.getElementById('cv-resultado');
}

async function probarCampo(archivo, est){
  const C = CAMPOS[est];
  const filas = padronDe(est, {
    '20000001': { en_snig: true, propietario_snig: C.snig, propietario: 'FIDEICOMISO' },
    '20000002': { en_snig: false, propietario: 'FIDEICOMISO' },
    '20000003': { en_snig: false, propietario: '' },
    '20000004': { en_snig: true, propietario_snig: '' },
    '20000005': { en_snig: null, propietario_snig: C.snig },
    '20000006': { en_snig: true, propietario_snig: C.snig, campo_snig: C.otro },
    '20000007': { en_snig: true, propietario_snig: C.snig, campo_snig: est },
    // solo en el SNIG: el bastón nunca la leyó (sin propietario, sin lectura, sin datos de tratamiento)
    '20000009': { en_snig: true, propietario_snig: C.snig, propietario: '', ultima_lectura: null, estado_carencia: null,
      categoria: null, sexo: null, gen: null, potrero: null },
  });
  const { win, errores } = await levantar(archivo, filas);
  console.log('\n=== ' + archivo + ' (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const cfg = win.__cfg;
  chequear('CONFIG.propietarioSnig prendido', !!cfg.propietarioSnig);
  chequear('caravanasHabilitado prendido (busqueda por el boton)', !!cfg.caravanasHabilitado);
  const doc = win.document;
  doc.getElementById('btn-caravana').dispatchEvent(new win.Event('click', { bubbles: true }));

  let caja = await buscar(win, '20000001');
  let f = filasDeCaja(caja);
  const idxSnig = f.findIndex(x => x[0] === 'Propietario (SNIG)');
  const idxDueno = f.findIndex(x => x[0] === cfg.duenoLabel);
  chequear('en_snig=true: fila "Propietario (SNIG)" con el nombre traducido', idxSnig >= 0 && f[idxSnig][1] === C.esperado, JSON.stringify(f));
  chequear('la fila del SNIG va ANTES de la del dueño del bastón', idxSnig >= 0 && idxDueno > idxSnig, JSON.stringify(f));
  chequear('la del dueño del bastón sigue apareciendo aparte', idxDueno >= 0 && f[idxDueno][1] === 'FIDEICOMISO', JSON.stringify(f));

  caja = await buscar(win, '20000002');
  f = filasDeCaja(caja);
  let snig = f.find(x => x[0] === 'Propietario (SNIG)');
  chequear('en_snig=false: "Sin SNIG — firma: <dueño>"', !!snig && snig[1] === 'Sin SNIG — firma: FIDEICOMISO', JSON.stringify(f));

  caja = await buscar(win, '20000003');
  f = filasDeCaja(caja);
  snig = f.find(x => x[0] === 'Propietario (SNIG)');
  chequear('en_snig=false con dueño vacío: usa textoSinAsignar (no "undefined" ni vacío)',
    !!snig && snig[1] === 'Sin SNIG — firma: ' + cfg.textoSinAsignar, JSON.stringify(f));
  chequear('y en ningun lado de la ficha aparece "undefined"', !/undefined/.test(caja.textContent), caja.textContent);

  caja = await buscar(win, '20000004');
  f = filasDeCaja(caja);
  snig = f.find(x => x[0] === 'Propietario (SNIG)');
  chequear('en_snig=true sin nombre: "Propietario sin nombre en el SNIG"',
    !!snig && snig[1] === 'Propietario sin nombre en el SNIG', JSON.stringify(f));

  caja = await buscar(win, '20000005');
  f = filasDeCaja(caja);
  chequear('en_snig=null: ni fila ni alerta del SNIG',
    !f.some(x => x[0] === 'Propietario (SNIG)') && caja.textContent.indexOf('SNIG') < 0 && caja.textContent.indexOf('⚠') < 0,
    caja.textContent.slice(0, 300));

  caja = await buscar(win, '20000006');
  chequear('campo_snig de otro campo: alerta "⚠ Según el SNIG está en ' + C.otroLegible + '"',
    caja.textContent.indexOf('⚠ Según el SNIG está en ' + C.otroLegible) >= 0, caja.textContent.slice(0, 300));
  const alerta = Array.from(caja.querySelectorAll('div')).find(d => d.textContent.indexOf('⚠ Según el SNIG') === 0);
  chequear('la alerta va en color #b7791f', !!alerta && /#b7791f/i.test(alerta.getAttribute('style') || ''),
    alerta && alerta.getAttribute('style'));
  chequear('la alerta no es una fila de la tabla (y la ficha sigue con sus filas)',
    filasDeCaja(caja).every(x => !/⚠/.test(x[0] || '')) && filasDeCaja(caja).length > 0);

  caja = await buscar(win, '20000007');
  chequear('campo_snig del mismo campo: sin alerta', caja.textContent.indexOf('⚠') < 0, caja.textContent.slice(0, 200));

  caja = await buscar(win, '20000009');
  f = filasDeCaja(caja);
  snig = f.find(x => x[0] === 'Propietario (SNIG)');
  chequear('animal solo-SNIG: muestra el propietario del SNIG y no rompe',
    !!snig && snig[1] === C.esperado && !/undefined/.test(caja.textContent), JSON.stringify(f));

  caja = await buscar(win, '29999999');
  chequear('caravana ausente, con señal: aviso "No figura en el padrón ni en el SNIG de este campo"',
    caja.textContent.indexOf('No figura en el padrón ni en el SNIG de este campo') >= 0, caja.textContent.slice(0, 300));
  chequear('y el aviso habitual de "no está en el padrón" sigue',
    caja.textContent.indexOf('no está en el padrón') >= 0, caja.textContent.slice(0, 300));

  chequear('propietarioSnigDe(null) es null sin romper', win.__snigDe(null) === null);
}

async function probarCacheMovil(archivo){
  const filas = padronDe('la_vuelta', { '20000001': { en_snig: true, propietario_snig: 'Silvia' } });
  const { win, errores } = await levantar(archivo, filas);
  console.log('\n=== ' + archivo + ' (copia del celular, sin señal) ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const ahora = new Date().toISOString();
  await win.__padronLocal.guardar({ establecimiento: 'la_vuelta', dispositivo: win.__idDisp(),
    animales: { '20000001': filas[0] }, n: 1, maxLectura: '2026-10-13', completaEn: ahora, actualizadoEn: ahora });
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  win.document.getElementById('btn-caravana').dispatchEvent(new win.Event('click', { bubbles: true }));
  const caja = await buscar(win, '29999999');
  chequear('sin señal y caravana ausente de la copia: NO agrega el aviso del SNIG',
    caja.textContent.indexOf('No figura en el padrón ni en el SNIG') < 0, caja.textContent.slice(0, 300));
  chequear('...y dice que no está en la copia',
    caja.textContent.indexOf('no está en la copia') >= 0, caja.textContent.slice(0, 300));
  const hallada = await buscar(win, '20000001');
  chequear('sin señal, animal de la copia: la fila del SNIG sale desde la copia',
    filasDeCaja(hallada).some(x => x[0] === 'Propietario (SNIG)' && x[1] === 'Silvia Dutra'), hallada.textContent.slice(0, 300));
}

async function probarPoneChico(archivo){
  const { win, errores } = await levantar(archivo, []);
  console.log('\n=== ' + archivo + ' (flag apagado) ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  chequear('CONFIG.propietarioSnig apagado', win.__cfg.propietarioSnig === false);
  const a = Object.assign({}, BASE, { establecimiento: 'pone_chico', id8: '20000001',
    en_snig: true, propietario_snig: 'Silvia', campo_snig: 'la_vuelta' });
  chequear('propietarioSnigDe devuelve null', win.__snigDe(a) === null);
  chequear('propietarioSnigAusente vacio', win.__snigAusente() === '');
  const html = win.__ficha(a);
  chequear('la ficha no tiene ninguna linea del SNIG', html.indexOf('SNIG') < 0 && html.indexOf('⚠') < 0, html.slice(0, 200));
  const sinSnig = win.__ficha(Object.assign({}, a, { en_snig: null, propietario_snig: null, campo_snig: null }));
  chequear('igual que con en_snig=null (sin ninguna linea nueva)', html === sinSnig);
}

/* ---------- 9/11/2026 (paso 3B y C): líneas en los formularios, lote de Eventos de manejo, aviso al guardar ---------- */
const DEBOUNCE_ESPERA = 420; // el debounce son 350 ms
const linea = el => { const s = el && el.nextElementSibling; return s && s.classList.contains('snig-linea') ? s.textContent.replace(/\s+/g, ' ').trim() : null; };
async function escribir(win, el, valor){
  el.value = valor;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  await esperar(DEBOUNCE_ESPERA);
}

async function probarFichaYQuienEs(archivo, est){
  const C = CAMPOS[est];
  const filas = padronDe(est, {
    '20000001': { en_snig: true, propietario_snig: C.snig, propietario: 'FIDEICOMISO' },
    '20000009': { en_snig: true, propietario_snig: C.snig, propietario: '', ultima_lectura: null, estado_carencia: null,
      categoria: null, sexo: null, gen: null, potrero: null },
  });
  const { win, errores } = await levantar(archivo, filas);
  console.log('\n=== ficha y "quién es" (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  doc.getElementById('btn-caravana').dispatchEvent(new win.Event('click', { bubbles: true }));

  let caja = await buscar(win, '20000009');
  // 20000009 no tiene snig_ingreso: sin fecha = "vivo sin registro en el predio" (9/11/2026, paso 3D)
  chequear('ficha solo-SNIG sin fecha de ingreso: "❓ VIVO SIN REGISTRO EN EL PREDIO" y no "✅ APTO"',
    caja.textContent.indexOf('❓ VIVO SIN REGISTRO EN EL PREDIO') >= 0 && caja.textContent.indexOf('✅ APTO') < 0, caja.textContent.slice(0, 300));
  chequear('ficha solo-SNIG sin fecha: el detalle dice que hace más de 6 meses o sin fecha',
    caja.textContent.indexOf('hace más de 6 meses (o sin fecha de ingreso)') >= 0);
  caja = await buscar(win, '20000001');
  chequear('animal normal con carencia APTO sigue diciendo "✅ APTO"', caja.textContent.indexOf('✅ APTO') >= 0, caja.textContent.slice(0, 200));

  const scc = doc.getElementById('sc-caravana');
  const quien = doc.getElementById('sc-caravana-quien');
  scc.value = '20000009';
  scc.dispatchEvent(new win.Event('change', { bubbles: true }));
  await esperar(80);
  chequear('"quién es" solo-SNIG sin fecha: "❓ … vivo sin registro en el predio", sin ✓ verde',
    quien.textContent.indexOf('vivo sin registro en el predio, sin datos sanitarios.') >= 0 && quien.textContent.indexOf('✓') < 0, quien.textContent);
  scc.value = '20000001';
  scc.dispatchEvent(new win.Event('change', { bubbles: true }));
  await esperar(80);
  chequear('"quién es" normal: sigue ✓ y agrega la línea del propietario SNIG',
    quien.textContent.indexOf('✓') >= 0 && quien.textContent.indexOf('Propietario (SNIG): ' + C.esperado) >= 0, quien.textContent);
}

async function probarLineas(archivo, est){
  const C = CAMPOS[est];
  const filas = padronDe(est, {
    '20000001': { en_snig: true, propietario_snig: C.snig, propietario: 'FIDEICOMISO' },
    '20000002': { en_snig: false, propietario: 'FIDEICOMISO' },
    '20000005': { en_snig: null, propietario_snig: C.snig },
    '20000006': { en_snig: true, propietario_snig: C.snig, campo_snig: C.otro },
    '20000007': { en_snig: true, propietario_snig: C.snig, campo_snig: est },
    '20000009': { en_snig: true, propietario_snig: C.snig, propietario: '', ultima_lectura: null, estado_carencia: null,
      categoria: null, sexo: null, gen: null, potrero: null },
  });
  const { win, errores } = await levantar(archivo, filas);
  console.log('\n=== líneas bajo los casilleros (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const p = Object.keys(win.__est().potreros)[0];
  win.renderDetalle(p);
  win.mostrarFormulario(p, 'muerte');
  const fc = doc.getElementById('f-caravana');
  chequear('existe el casillero de caravana de la muerte', !!fc);

  await escribir(win, fc, '20000001');
  chequear('una caravana con SNIG: "Propietario (SNIG): ' + C.esperado + '" debajo del casillero',
    (linea(fc) || '').indexOf('Propietario (SNIG): ' + C.esperado) >= 0, linea(fc));
  await escribir(win, fc, '20000002');
  chequear('sin SNIG: "Sin SNIG — firma: FIDEICOMISO"', linea(fc) === 'Sin SNIG — firma: FIDEICOMISO', linea(fc));
  await escribir(win, fc, '20000006');
  chequear('otro campo: alerta "⚠ Según el SNIG está en ' + C.otroLegible + '"',
    (linea(fc) || '').indexOf('⚠ Según el SNIG está en ' + C.otroLegible) >= 0, linea(fc));
  await escribir(win, fc, '20000007');
  chequear('mismo campo: sin alerta', !!linea(fc) && linea(fc).indexOf('⚠') < 0, linea(fc));
  await escribir(win, fc, '20000005');
  chequear('en_snig null: la línea queda vacía', linea(fc) === '', linea(fc));
  await escribir(win, fc, '29999999');
  chequear('ausente con señal: aviso "No figura en el padrón ni en el SNIG de este campo"',
    (linea(fc) || '').indexOf('No figura en el padrón ni en el SNIG de este campo') >= 0, linea(fc));
  await escribir(win, fc, '2000');
  chequear('menos de 8 dígitos: la línea se vacía', linea(fc) === '', linea(fc));

  RED.caida = true;
  await escribir(win, fc, '20000001');
  chequear('sin señal: no muestra nada y no rompe', linea(fc) === '', linea(fc));
  RED.caida = false;

  // casillero de un vecino (data-vp="caravana"): se crea a mano, como las filas que arma el formulario de vecinos
  const vp = doc.createElement('input');
  vp.setAttribute('data-vp', 'caravana');
  doc.body.appendChild(vp);
  await escribir(win, vp, '20000001');
  chequear('[data-vp="caravana"]: la línea sale por delegación',
    (linea(vp) || '').indexOf('Propietario (SNIG): ' + C.esperado) >= 0, linea(vp));

  // "Eventos de manejo": lista de caravanas, mezcla de casos
  const em = doc.getElementById('em-caravanas');
  chequear('existe la lista de caravanas de Eventos de manejo', !!em);
  if(!em) return;
  await escribir(win, em, '20000001 20000002, 20000006\n20000007;20000009 29999999');
  const lote = linea(em) || '';
  chequear('lote: cuenta 6 caravanas', lote.indexOf('6 caravanas') >= 0, lote);
  chequear('lote: propietario SNIG cuenta 4 (1, 6, 7 y 9)', lote.indexOf('Propietario (SNIG): ' + C.esperado + ' 4') >= 0, lote);
  chequear('lote: Sin SNIG 1', lote.indexOf('Sin SNIG 1') >= 0, lote);
  chequear('lote: "⚠ 1 está en otro campo según el SNIG"', lote.indexOf('⚠ 1 está en otro campo según el SNIG') >= 0, lote);
  chequear('lote: "1 no figura en el padrón"', lote.indexOf('1 no figura en el padrón') >= 0, lote);
  chequear('lote: excepcionales con su motivo (sin SNIG y ausente)',
    lote.indexOf('20000002: Sin SNIG — firma: FIDEICOMISO') >= 0 && lote.indexOf('29999999: no figura en el padrón') >= 0, lote);
  RED.caida = true;
  await escribir(win, em, '20000001');
  chequear('lote sin señal: no muestra nada', linea(em) === '', linea(em));
  RED.caida = false;
}

async function probarPoneChicoSinLineas(archivo){
  // Pone Chico no trae potreros en la config de prueba (potrerosGeo vacío): se agrega uno para abrir el formulario
  const p = 'Potrero de prueba';
  const geo = [{ nombre: p, area: '10', coords: [[-31.98, -56.34], [-31.98, -56.33], [-31.99, -56.33]] }];
  const { win, errores } = await levantar(archivo, [], { geo });
  console.log('\n=== ' + archivo + ' (sin lineas nuevas) ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  win.renderDetalle(p);
  win.mostrarFormulario(p, 'muerte');
  const zona = doc.getElementById('form-zona');
  const antes = zona.innerHTML;
  const fc = doc.getElementById('f-caravana');
  await escribir(win, fc, '20000001');
  chequear('ningún .snig-linea en la página', doc.querySelectorAll('.snig-linea').length === 0);
  chequear('el formulario de muerte queda idéntico al escribir una caravana', zona.innerHTML === antes);
  const em = doc.getElementById('em-caravanas');
  if(em){
    await escribir(win, em, '20000001 20000002');
    chequear('la lista de Eventos de manejo tampoco suma línea', doc.querySelectorAll('.snig-linea').length === 0);
  }
}

const zonaTexto = doc => doc.getElementById('form-zona').textContent.replace(/\s+/g, ' ').slice(0, 160);

/* Guardar una muerte con caravana: el formulario guarda lo mismo con o sin la línea, y el toast del SNIG
   aparece después con agregarCaravanaMuerte (PC). */
async function probarGuardarMuerte(archivo, est){
  const C = CAMPOS[est];
  const filas = padronDe(est, { '20000001': { en_snig: true, propietario_snig: C.snig } });
  const { win, errores } = await levantar(archivo, filas);
  console.log('\n=== guardar muerte con caravana (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const p = Object.keys(win.__est().potreros)[0];
  win.renderDetalle(p);
  win.mostrarFormulario(p, 'muerte');
  // una categoría que no sea ternero (los terneros piden temporada o marcado)
  const selCat = doc.getElementById('f-cat');
  selCat.value = Array.from(selCat.options).find(o => !/ternero|ternera/i.test(o.value)).value;
  selCat.dispatchEvent(new win.Event('change', { bubbles: true }));
  // 9/11/2026 (3C): la caravana va ANTES de leer el dueño, porque el SNIG puede preseleccionarlo
  await escribir(win, doc.getElementById('f-caravana'), '20000001');
  const cat = selCat.value;
  const dueno = doc.getElementById('f-dueno').value;
  const clave = win.claveAnimal(cat, dueno);
  win.__est().potreros[p].animales[clave] = 5;
  doc.getElementById('f-cant').value = '2';
  doc.getElementById('f-confirmar').click();
  await esperar(80);
  const muertes = win.__est().potreros[p].historial.filter(h => h.tipo === 'muerte' && !h.eliminado);
  const h = muertes[muertes.length - 1];
  chequear('la muerte se guardó con la caravana escrita', !!h && h.extra && h.extra.caravana === '20000001',
    'toast: ' + doc.getElementById('toast').textContent + ' | form: ' + zonaTexto(doc) + ' | ' + JSON.stringify(h && h.extra));
  chequear('y el stock bajó en 2 (5 -> 3)', win.__est().potreros[p].animales[clave] === 3, String(win.__est().potreros[p].animales[clave]));

  win.prompt = () => '20000001';
  win.agregarCaravanaMuerte(h.id);
  await esperar(80);
  const t = doc.getElementById('toast').textContent;
  chequear('al guardar la caravana sale el segundo aviso del SNIG', t.indexOf('Caravana 20000001: ' + C.esperado) === 0, t);
}

/* ---------- 9/11/2026 (paso 3C): dueño sugerido por el SNIG en la muerte (#f-caravana) ---------- */
// Por campo: A = nombre del SNIG que es opción (con o sin traducción), B = otra opción, NO_OPCION = nombre que no
// es opción del select, SIN_SNIG = animal que el SNIG no tiene. Pone Chico (flag apagado) va aparte.
const SUGERIR = {
  la_vuelta: {
    A: { caravana: '20000001', snig: 'Silvia', esperado: 'Silvia Dutra' },
    B: { caravana: '20000011', snig: 'Fideicomiso', esperado: 'Fideicomiso' },
    NO_OPCION: { caravana: '20000010', snig: 'Perico', esperado: 'Perico' },
    SIN_SNIG: { caravana: '20000002' },
  },
  maria_laura: {
    A: { caravana: '20000001', snig: 'Pedro Lanfranco', esperado: 'Pedro' },
    B: { caravana: '20000011', snig: 'Silvia', esperado: 'Silvia' },
    NO_OPCION: { caravana: '20000010', snig: 'Walter Lanfranco', esperado: 'Walter Lanfranco' },
    SIN_SNIG: { caravana: '20000002' },
  },
};

function abrirMuerte(win){
  const p = Object.keys(win.__est().potreros)[0];
  win.renderDetalle(p);
  win.mostrarFormulario(p, 'muerte');
  return p;
}

async function probarDuenoSugerido(archivo, est){
  const S = SUGERIR[est];
  const filas = padronDe(est, {
    [S.A.caravana]: { en_snig: true, propietario_snig: S.A.snig, propietario: 'FIDEICOMISO' },
    [S.B.caravana]: { en_snig: true, propietario_snig: S.B.snig, propietario: 'FIDEICOMISO' },
    [S.NO_OPCION.caravana]: { en_snig: true, propietario_snig: S.NO_OPCION.snig, propietario: 'FIDEICOMISO' },
    [S.SIN_SNIG.caravana]: { en_snig: false, propietario: 'FIDEICOMISO' },
  });
  const { win, errores } = await levantar(archivo, filas);
  console.log('\n=== dueño sugerido por el SNIG en la muerte (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const opciones = () => Array.from(doc.getElementById('f-dueno').options).map(o => o.value);
  abrirMuerte(win);
  chequear('"' + S.A.esperado + '" es una opción del select de dueño', opciones().indexOf(S.A.esperado) >= 0, opciones().join('|'));
  chequear('"' + S.NO_OPCION.esperado + '" NO es una opción del select de dueño', opciones().indexOf(S.NO_OPCION.esperado) < 0, opciones().join('|'));

  // (a) el SNIG dice un dueño que es opción: se preselecciona y la línea lo dice
  abrirMuerte(win);
  let sel = doc.getElementById('f-dueno');
  let fc = doc.getElementById('f-caravana');
  await escribir(win, fc, S.A.caravana);
  chequear('(a) el select queda en "' + S.A.esperado + '"', sel.value === S.A.esperado, sel.value);
  chequear('(a) la línea dice "Dueño sugerido por el SNIG: ' + S.A.esperado + ' (podés cambiarlo)"',
    (linea(fc) || '').indexOf('Dueño sugerido por el SNIG: ' + S.A.esperado + ' (podés cambiarlo)') >= 0, linea(fc));

  // (b) la persona ya cambió el dueño a mano: no se pisa, y la línea no dice "sugerido"
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno');
  fc = doc.getElementById('f-caravana');
  const otro = opciones().find(v => v && v !== S.A.esperado);
  sel.value = otro;
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await escribir(win, fc, S.A.caravana);
  chequear('(b) la persona eligió "' + otro + '": el select no se pisa', sel.value === otro, sel.value);
  chequear('(b) y la línea no dice "sugerido"', (linea(fc) || '').indexOf('sugerido') < 0, linea(fc));

  // (c) animal Sin SNIG: el select queda como estaba y no hay "sugerido"
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno');
  fc = doc.getElementById('f-caravana');
  let antes = sel.value;
  await escribir(win, fc, S.SIN_SNIG.caravana);
  chequear('(c) Sin SNIG: el select queda como estaba', sel.value === antes, sel.value + ' vs ' + antes);
  chequear('(c) y sin "sugerido"', (linea(fc) || '').indexOf('sugerido') < 0, linea(fc));

  // (d) el nombre del SNIG no es opción del select: no cambia nada
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno');
  fc = doc.getElementById('f-caravana');
  antes = sel.value;
  await escribir(win, fc, S.NO_OPCION.caravana);
  chequear('(d) "' + S.NO_OPCION.esperado + '" no es opción: el select no cambia', sel.value === antes, sel.value + ' vs ' + antes);
  chequear('(d) y sin "sugerido"', (linea(fc) || '').indexOf('sugerido') < 0, linea(fc));

  // (f) la caravana pasa a una que no resuelve, o se borra: se quita el "sugerido" y el select VUELVE al original
  // (revisión 9/11/2026: antes quedaba en el sugerido y el aviso mentía)
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno');
  fc = doc.getElementById('f-caravana');
  const origF = sel.value;
  await escribir(win, fc, S.A.caravana);
  chequear('(f) previo: la sugerencia está', sel.value === S.A.esperado && (linea(fc) || '').indexOf('sugerido') >= 0, linea(fc));
  await escribir(win, fc, '29999999');
  chequear('(f) caravana ausente: se quita el "sugerido"', (linea(fc) || '').indexOf('sugerido') < 0, linea(fc));
  chequear('(f) y el select vuelve al original "' + origF + '"', sel.value === origF, sel.value);
  await escribir(win, fc, S.A.caravana);
  await escribir(win, fc, '');
  chequear('(f) caravana borrada: la línea queda vacía', linea(fc) === '', linea(fc));
  chequear('(f) y el select vuelve al original', sel.value === origF, sel.value);

  // (g) la sugerencia hecha por el código no cuenta como "tocado": otra caravana con otro dueño SNIG la reemplaza
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno');
  fc = doc.getElementById('f-caravana');
  await escribir(win, fc, S.A.caravana);
  await escribir(win, fc, S.B.caravana);
  chequear('(g) otra caravana con otro dueño (opción): el select pasa a "' + S.B.esperado + '"', sel.value === S.B.esperado, sel.value);
  chequear('(g) la línea dice el nuevo sugerido', (linea(fc) || '').indexOf('Dueño sugerido por el SNIG: ' + S.B.esperado) >= 0, linea(fc));

  // (e) al confirmar se guarda el dueño que quedó en el select, y el stock baja en esa clave
  const p = abrirMuerte(win);
  sel = doc.getElementById('f-dueno');
  fc = doc.getElementById('f-caravana');
  const selCat = doc.getElementById('f-cat');
  selCat.value = Array.from(selCat.options).find(o => !/ternero|ternera/i.test(o.value)).value;
  selCat.dispatchEvent(new win.Event('change', { bubbles: true }));
  await escribir(win, fc, S.A.caravana);
  const cat = selCat.value;
  const clave = win.claveAnimal(cat, sel.value);
  const otraClave = win.claveAnimal(cat, '');
  win.__est().potreros[p].animales[clave] = 5;
  win.__est().potreros[p].animales[otraClave] = 7;
  doc.getElementById('f-cant').value = '2';
  doc.getElementById('f-confirmar').click();
  await esperar(80);
  const hist = win.__est().potreros[p].historial.filter(h => h.tipo === 'muerte' && !h.eliminado);
  const h = hist[hist.length - 1];
  chequear('(e) la muerte guarda el dueño sugerido', !!h && h.extra && h.extra.dueno === S.A.esperado,
    'toast: ' + doc.getElementById('toast').textContent + ' | ' + JSON.stringify(h && h.extra));
  chequear('(e) el stock baja en la clave "' + clave + '" (5 -> 3)', win.__est().potreros[p].animales[clave] === 3,
    String(win.__est().potreros[p].animales[clave]));
  chequear('(e) la otra clave no se toca (sigue en 7)', win.__est().potreros[p].animales[otraClave] === 7,
    String(win.__est().potreros[p].animales[otraClave]));
}

/* ---------- 9/11/2026 (revisión, punto 2): el dueño del SNIG no pisa lo que la persona eligió ni lo que venía cargado ----------
   A) corrección (formulario con prefill): nunca se sugiere ni se cambia el dueño, ni al entrar a la caravana ni al corregirla.
   B) la sugerencia deja de valer (caravana sin SNIG, dueño que no es opción, caravana borrada): el select vuelve al
      original, y al confirmar se guarda ese original.
   C) "tocado": cualquier interacción de la persona con el select (pointerdown, keydown, foco) lo deja como está y no hay sugerencia. */
async function probarDuenoSugeridoRevision(archivo, est){
  const S = SUGERIR[est];
  const filas = padronDe(est, {
    [S.A.caravana]: { en_snig: true, propietario_snig: S.A.snig, propietario: 'FIDEICOMISO' },
    [S.B.caravana]: { en_snig: true, propietario_snig: S.B.snig, propietario: 'FIDEICOMISO' },
    [S.NO_OPCION.caravana]: { en_snig: true, propietario_snig: S.NO_OPCION.snig, propietario: 'FIDEICOMISO' },
    [S.SIN_SNIG.caravana]: { en_snig: false, propietario: 'FIDEICOMISO' },
  });
  const { win, errores } = await levantar(archivo, filas);
  console.log('\n=== dueño del SNIG: corrección, vuelta al original y "tocado" (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const sinSugerido = fc => (linea(fc) || '').indexOf('sugerido') < 0;

  // (A) corrección: el formulario viene con el dueño de la muerte (B) y la caravana de A (el SNIG diría A)
  let p = Object.keys(win.__est().potreros)[0];
  win.renderDetalle(p);
  win.mostrarFormulario(p, 'muerte', { categoria: 'Vacas', dueno: S.B.esperado, cantidad: 1, obs: null,
    caravana: S.A.caravana, _fechaISO: HOY_TEST });
  let sel = doc.getElementById('f-dueno'), fc = doc.getElementById('f-caravana');
  chequear('(A) la corrección trae el dueño cargado "' + S.B.esperado + '"', sel.value === S.B.esperado, sel.value);
  chequear('(A) el botón dice "Guardar corrección"', doc.getElementById('f-confirmar').textContent.indexOf('Guardar corrección') >= 0);
  fc.dispatchEvent(new win.Event('focusin', { bubbles: true }));
  await esperar(DEBOUNCE_ESPERA);
  chequear('(A) al entrar al casillero de caravana el dueño no cambia', sel.value === S.B.esperado, sel.value);
  await escribir(win, fc, S.A.caravana.slice(0, 7) + '9');
  await escribir(win, fc, S.A.caravana);
  chequear('(A) corregir un dígito de la caravana no cambia el dueño', sel.value === S.B.esperado, sel.value);
  chequear('(A) y no sale "sugerido"', sinSugerido(fc), linea(fc));

  // (B1) sugerido y después una caravana sin SNIG: vuelve al original, y al confirmar se guarda el original
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno'); fc = doc.getElementById('f-caravana');
  const orig = sel.value;
  await escribir(win, fc, S.A.caravana);
  chequear('(B1) previo: sugiere "' + S.A.esperado + '"', sel.value === S.A.esperado, sel.value);
  await escribir(win, fc, S.SIN_SNIG.caravana);
  chequear('(B1) caravana sin SNIG: el select vuelve al original "' + orig + '"', sel.value === orig, sel.value);
  chequear('(B1) y no sale "sugerido"', sinSugerido(fc), linea(fc));
  p = Object.keys(win.__est().potreros)[0];
  const selCat = doc.getElementById('f-cat');
  selCat.value = Array.from(selCat.options).find(o => !/ternero|ternera/i.test(o.value)).value;
  selCat.dispatchEvent(new win.Event('change', { bubbles: true }));
  const clave = win.claveAnimal(selCat.value, orig);
  win.__est().potreros[p].animales[clave] = 5;
  doc.getElementById('f-cant').value = '2';
  doc.getElementById('f-confirmar').click();
  await esperar(80);
  const hist = win.__est().potreros[p].historial.filter(h => h.tipo === 'muerte' && !h.eliminado);
  const hB = hist[hist.length - 1];
  chequear('(B1) al confirmar se guarda el dueño original "' + orig + '", no el sugerido',
    !!hB && hB.extra && hB.extra.dueno === orig, 'toast: ' + doc.getElementById('toast').textContent + ' | ' + JSON.stringify(hB && hB.extra));
  chequear('(B1) el stock baja en la clave de ese dueño (5 -> 3)', win.__est().potreros[p].animales[clave] === 3,
    String(win.__est().potreros[p].animales[clave]));

  // (B2) sugerido y después un dueño del SNIG que no es opción
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno'); fc = doc.getElementById('f-caravana');
  let o2 = sel.value;
  await escribir(win, fc, S.A.caravana);
  await escribir(win, fc, S.NO_OPCION.caravana);
  chequear('(B2) el SNIG dice un dueño que no es opción: el select vuelve al original', sel.value === o2, sel.value);
  chequear('(B2) y no sale "sugerido"', sinSugerido(fc), linea(fc));

  // (B3) sugerido y después la caravana se borra
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno'); fc = doc.getElementById('f-caravana');
  const o3 = sel.value;
  await escribir(win, fc, S.A.caravana);
  await escribir(win, fc, '');
  chequear('(B3) caravana borrada: el select vuelve al original', sel.value === o3, sel.value);

  // (C) tocado: pulsar el select sin cambiarlo (o elegir el mismo valor) impide la sugerencia
  for(const evento of ['pointerdown', 'keydown', 'focusin']){
    abrirMuerte(win);
    sel = doc.getElementById('f-dueno'); fc = doc.getElementById('f-caravana');
    const oc = sel.value;
    sel.dispatchEvent(new win.Event(evento, { bubbles: true }));
    await escribir(win, fc, S.A.caravana);
    chequear('(C ' + evento + ') tocado antes de caravana: no se sugiere, el select queda en "' + oc + '"', sel.value === oc, sel.value);
    chequear('(C ' + evento + ') y no sale "sugerido"', sinSugerido(fc), linea(fc));
  }

  // (C2) tocado DESPUÉS de la sugerencia: lo eligió la persona, así que al quedar sin SNIG no se deshace
  abrirMuerte(win);
  sel = doc.getElementById('f-dueno'); fc = doc.getElementById('f-caravana');
  await escribir(win, fc, S.A.caravana);
  sel.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  await escribir(win, fc, S.SIN_SNIG.caravana);
  chequear('(C2) tocado después de la sugerencia: al quedar sin SNIG el select no se deshace', sel.value === S.A.esperado, sel.value);
}

// (f) Pone Chico, flag apagado: ni línea ni cambio de select, aunque el nombre del SNIG sea una opción
async function probarPoneChicoDuenoIgual(archivo){
  const p = 'Potrero de prueba';
  const geo = [{ nombre: p, area: '10', coords: [[-31.98, -56.34], [-31.98, -56.33], [-31.99, -56.33]] }];
  const filas = padronDe('pone_chico', { '20000001': { en_snig: true, propietario_snig: 'Pablo', propietario: 'Chico' } });
  const { win, errores } = await levantar(archivo, filas, { geo });
  console.log('\n=== dueño sugerido apagado (' + archivo + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  win.renderDetalle(p);
  win.mostrarFormulario(p, 'muerte');
  const sel = doc.getElementById('f-dueno');
  const antes = sel.value;
  await escribir(win, doc.getElementById('f-caravana'), '20000001');
  chequear('Pone Chico: el select no cambia aunque "Pablo" sea opción', sel.value === antes, sel.value + ' vs ' + antes);
  chequear('Pone Chico: no hay "sugerido" ni línea del SNIG', doc.querySelectorAll('.snig-sugerido, .snig-linea').length === 0);
  chequear('Pone Chico: el select no tiene data-snig-tocado', !sel.hasAttribute('data-snig-tocado'));
}

/* ---------- 9/11/2026 (paso 3D): estado de los solo-SNIG y listado "🧾 SNIG sin lectura" (solo PC) ---------- */
// Solo-SNIG: el SNIG lo tiene en el predio y el bastón nunca lo leyó (sin carencia, sin última lectura).
const SOLO = { ultima_lectura: null, estado_carencia: null, categoria: null, gen: null, potrero: null,
  propietario: '', sexo: 'HEMBRA', en_snig: true };
// Normal: BASE (lectura del 13/10 y APTO), con el SNIG del campo.
const NORMAL = { en_snig: true, propietario: 'FIDEICOMISO' };
const diasDeHoy = iso => Math.round((new Date(2026, 10, 9) - new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))) / 86400000);
const filasTabla = doc => Array.from(doc.querySelectorAll('#sl-tabla tbody tr'))
  .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
function leerBlob(win, blob){
  return new Promise((ok, mal) => {
    const fr = new win.FileReader();
    fr.onload = () => ok(Buffer.from(fr.result));
    fr.onerror = () => mal(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}
// Hace clic en el botón de descarga y devuelve el contenido del CSV (bytes y texto).
async function capturarCsv(win, boton){
  let capturado = null;
  win.URL.createObjectURL = b => { capturado = b; return 'blob:x'; };
  boton.dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(60);
  if(!capturado) return null;
  const buf = await leerBlob(win, capturado);
  return { buf, txt: buf.toString('utf8').replace(/^﻿/, '') };
}

async function probarEstadosSinLectura(archivo, est){
  const C = CAMPOS[est];
  const sx = (ingreso, extra) => Object.assign({ propietario_snig: C.snig, snig_ingreso: ingreso }, SOLO, extra || {});
  const filas = padronDe(est, {
    '30000001': sx(diasAtrasISO(100)),
    '30000002': sx(diasAtrasISO(200)),
    '30000003': sx(diasAtrasISO(183)),
    '30000004': sx(diasAtrasISO(184)),
    '30000005': sx(null),
    '30000006': Object.assign({ propietario_snig: C.snig, snig_ingreso: diasAtrasISO(10) }, NORMAL),
  });
  const { win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST });
  console.log('\n=== estados solo-SNIG por días desde el ingreso (' + est + ', hoy fijado ' + HOY_TEST + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const E = id => win.__snigEstado(filas.find(r => r.id8 === id));
  chequear('100 días: pendiente, dias 100', E('30000001') && E('30000001').estado === 'pendiente' && E('30000001').dias === 100, JSON.stringify(E('30000001')));
  chequear('200 días: vivo sin registro, dias 200', E('30000002') && E('30000002').estado === 'vivo_sin_registro' && E('30000002').dias === 200, JSON.stringify(E('30000002')));
  chequear('183 días exactos: pendiente (el límite cuenta)', E('30000003') && E('30000003').estado === 'pendiente' && E('30000003').dias === 183, JSON.stringify(E('30000003')));
  chequear('184 días: vivo sin registro', E('30000004') && E('30000004').estado === 'vivo_sin_registro' && E('30000004').dias === 184, JSON.stringify(E('30000004')));
  chequear('sin snig_ingreso: vivo sin registro, dias null', E('30000005') && E('30000005').estado === 'vivo_sin_registro' && E('30000005').dias === null, JSON.stringify(E('30000005')));
  chequear('animal normal (con lectura y carencia): sin estado (null)', E('30000006') === null, JSON.stringify(E('30000006')));
  chequear('textos de los estados', E('30000001').texto === '🆕 PENDIENTE DE PRIMERA LECTURA' && E('30000002').texto === '❓ VIVO SIN REGISTRO EN EL PREDIO');

  const doc = win.document;
  doc.getElementById('btn-caravana').dispatchEvent(new win.Event('click', { bubbles: true }));
  let caja = await buscar(win, '30000001');
  chequear('ficha 100 días: "🆕 PENDIENTE DE PRIMERA LECTURA" con la fecha de ingreso en DD/MM/AAAA',
    caja.textContent.indexOf('🆕 PENDIENTE DE PRIMERA LECTURA') >= 0 && caja.textContent.indexOf('desde el ' + ddmm(diasAtrasISO(100))) >= 0, caja.textContent.slice(0, 300));
  caja = await buscar(win, '30000002');
  chequear('ficha 200 días: "❓ VIVO SIN REGISTRO EN EL PREDIO"',
    caja.textContent.indexOf('❓ VIVO SIN REGISTRO EN EL PREDIO') >= 0 && caja.textContent.indexOf('PENDIENTE') < 0, caja.textContent.slice(0, 300));
  caja = await buscar(win, '30000006');
  chequear('animal normal: sigue "✅ APTO" y sin los estados nuevos',
    caja.textContent.indexOf('✅ APTO') >= 0 && caja.textContent.indexOf('PENDIENTE DE PRIMERA') < 0 && caja.textContent.indexOf('VIVO SIN REGISTRO') < 0, caja.textContent.slice(0, 200));

  const scc = doc.getElementById('sc-caravana');
  const quien = doc.getElementById('sc-caravana-quien');
  scc.value = '30000001';
  scc.dispatchEvent(new win.Event('change', { bubbles: true }));
  await esperar(80);
  chequear('"quién es" pendiente: 🆕 y la fecha del ingreso',
    quien.textContent.indexOf('🆕') >= 0 && quien.textContent.indexOf('pendiente de primera lectura (SNIG desde ' + ddmm(diasAtrasISO(100)) + ')') >= 0, quien.textContent);
  scc.value = '30000002';
  scc.dispatchEvent(new win.Event('change', { bubbles: true }));
  await esperar(80);
  chequear('"quién es" vivo sin registro: ❓ y versión corta',
    quien.textContent.indexOf('❓') >= 0 && quien.textContent.indexOf('vivo sin registro en el predio, sin datos sanitarios.') >= 0, quien.textContent);
}

async function probarModalSnig(archivo, est){
  const C = CAMPOS[est];
  const sx = (ingreso, extra) => Object.assign({ propietario_snig: C.snig, snig_ingreso: ingreso }, SOLO, extra || {});
  const filas = padronDe(est, {
    '40000001': sx('2025-12-01'),                              // vivo sin registro (la más antigua)
    '40000002': sx('2026-01-10'),                              // vivo sin registro
    '40000003': sx('2026-07-01'),                              // pendiente (131 días)
    '40000004': Object.assign({ propietario_snig: C.snig, snig_ingreso: '2026-07-01' }, NORMAL), // normal: no aparece
    '40000005': { propietario_snig: C.snig, snig_ingreso: '2026-07-01', estado_carencia: 'NO APTO',
      fecha_apto: '2026-12-01', producto_carencia: 'Bovisan', ultima_lectura: '2026-10-13' },     // normal NO APTO: no aparece
    '40000006': { en_snig: null, propietario_snig: C.snig },   // sin export del SNIG: no aparece
  });
  const { win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST });
  console.log('\n=== "🧾 SNIG sin lectura" (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const btn = doc.getElementById('btn-snig-sin-lectura');
  chequear('botón "🧾 SNIG sin lectura" visible (CONFIG.propietarioSnig prendido)', !!btn && btn.style.display === '' && /SNIG sin lectura/.test(btn.textContent));
  LLAMADAS.length = 0;
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(150);
  chequear('el modal se abre', doc.getElementById('modal-snig-sin-lectura').style.display === 'flex');
  const resumen = doc.getElementById('sl-resumen').textContent;
  chequear('resumen: "3 animales: 2 vivos sin registro en el predio · 1 pendiente de primera lectura"',
    resumen === '3 animales: 2 vivos sin registro en el predio · 1 pendiente de primera lectura', resumen);
  let t = filasTabla(doc);
  chequear('3 filas: los normales, el NO APTO y el sin export no aparecen', t.length === 3, JSON.stringify(t));
  chequear('orden: vivos primero (la más antigua arriba), pendiente al final',
    t.map(r => r[0]).join(',') === '40000001,40000002,40000003', JSON.stringify(t.map(r => r[0])));
  chequear('propietario traducido con mapaDuenos (' + C.esperado + ')', t.every(r => r[1] === C.esperado), JSON.stringify(t.map(r => r[1])));
  chequear('sexo', t[0][2] === 'HEMBRA', JSON.stringify(t[0]));
  chequear('ingreso DD/MM/AAAA y días de la pendiente (01/07/2026, 131)', t[2][3] === '01/07/2026' && t[2][4] === '131', JSON.stringify(t[2]));
  chequear('días de las vivas (343 y ' + diasDeHoy('2026-01-10') + ')', t[0][4] === String(diasDeHoy('2025-12-01')) && t[1][4] === String(diasDeHoy('2026-01-10')), JSON.stringify([t[0], t[1]]));
  chequear('estado en texto', t[2][5] === '🆕 PENDIENTE DE PRIMERA LECTURA' && t[0][5] === '❓ VIVO SIN REGISTRO EN EL PREDIO', JSON.stringify(t));

  const sel = doc.getElementById('sl-filtro');
  sel.value = 'pendiente';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  t = filasTabla(doc);
  chequear('filtro "pendiente": una sola fila (40000003)', t.length === 1 && t[0][0] === '40000003', JSON.stringify(t));
  sel.value = 'vivo';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  t = filasTabla(doc);
  chequear('filtro "vivo": 2 filas', t.length === 2 && t[0][0] === '40000001' && t[1][0] === '40000002', JSON.stringify(t));

  const csv = await capturarCsv(win, doc.getElementById('sl-csv'));
  chequear('CSV: sale y empieza con BOM utf-8', !!csv && csv.buf[0] === 0xEF && csv.buf[1] === 0xBB && csv.buf[2] === 0xBF);
  const lineas = csv ? csv.txt.split('\r\n').filter(Boolean) : [];
  chequear('CSV: encabezado con ;', lineas[0] === 'caravana;propietario_snig;sexo;ingreso_predio;dias;estado', JSON.stringify(lineas[0]));
  chequear('CSV con filtro "vivo": 2 filas del listado visible',
    lineas.length === 3 && lineas[1] === '40000001;' + C.esperado + ';HEMBRA;01/12/2025;' + diasDeHoy('2025-12-01') + ';❓ VIVO SIN REGISTRO EN EL PREDIO'
      && lineas[2].indexOf('40000002;' + C.esperado + ';HEMBRA;10/01/2026;' + diasDeHoy('2026-01-10') + ';') === 0, JSON.stringify(lineas));

  sel.value = 'todos';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  const csvTodos = await capturarCsv(win, doc.getElementById('sl-csv'));
  chequear('CSV con "todos": encabezado + 3 filas', csvTodos && csvTodos.txt.split('\r\n').filter(Boolean).length === 4);

  // Sin señal: no rompe, dice qué pasa y no muestra la tabla vieja
  RED.caida = true;
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(120);
  RED.caida = false;
  chequear('sin señal: mensaje claro, sin tabla', doc.getElementById('sl-mensaje').textContent.indexOf('No se pudo consultar') === 0
    && doc.getElementById('sl-tabla-caja').style.display === 'none', doc.getElementById('sl-mensaje').textContent);
}

async function probarListaVaciaYPaginada(archivo, est){
  const C = CAMPOS[est];
  // 1) Sin datos: solo normales
  let filas = padronDe(est, { '50000001': Object.assign({ propietario_snig: C.snig }, NORMAL) });
  let { win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST });
  console.log('\n=== lista vacía y paginación (' + est + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  let doc = win.document;
  doc.getElementById('btn-snig-sin-lectura').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(120);
  chequear('sin animales: "No hay animales del SNIG sin lectura."',
    doc.getElementById('sl-mensaje').textContent === 'No hay animales del SNIG sin lectura.', doc.getElementById('sl-mensaje').textContent);

  // 2) Más de 1000: el falso corta por página (.range), así que hay que leer todas las páginas
  const extras = {};
  for(let i = 0; i < 1100; i++) extras['6' + String(i).padStart(7, '0')] = Object.assign({ propietario_snig: C.snig }, SOLO);
  filas = padronDe(est, extras);
  ({ win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST }));
  if(errores.length){ chequear('carga sin errores (1100)', false, errores[0]); return; }
  doc = win.document;
  LLAMADAS.length = 0;
  doc.getElementById('btn-snig-sin-lectura').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(400);
  const rangos = LLAMADAS.filter(l => l.tabla === 'animales_caravana').map(l => l.rango.join('-'));
  chequear('paginado: pide las páginas 0-999 y 1000-1999', rangos.join(' ') === '0-999 1000-1999', JSON.stringify(rangos));
  chequear('se cuentan las 1100 filas', doc.getElementById('sl-resumen').textContent
    === '1100 animales: 1100 vivos sin registro en el predio · 0 pendientes de primera lectura', doc.getElementById('sl-resumen').textContent);
  chequear('la tabla muestra las 1100', filasTabla(doc).length === 1100, String(filasTabla(doc).length));
  const csv = await capturarCsv(win, doc.getElementById('sl-csv'));
  chequear('el CSV tiene encabezado + 1100 filas', csv && csv.txt.split('\r\n').filter(Boolean).length === 1101);
}

async function probarPoneChicoSinListado(archivo){
  const filas = padronDe('pone_chico', { '40000001': Object.assign({ propietario_snig: 'Silvia', snig_ingreso: '2026-07-01' }, SOLO) });
  const { win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST });
  console.log('\n=== sin "🧾 SNIG sin lectura" (Pone Chico, flag apagado) ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const btn = doc.getElementById('btn-snig-sin-lectura');
  chequear('el botón está en el HTML pero oculto (como btn-faltantes)', !!btn && btn.style.display === 'none');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(60);
  chequear('clic en el botón oculto: el modal no se abre', doc.getElementById('modal-snig-sin-lectura').style.display === 'none');
  chequear('no hay lista de solo-SNIG', win.__snigEstado(filas[0]) === null);
  const html = win.__ficha(filas[0]);
  chequear('la ficha no muestra el estado nuevo ni líneas del SNIG (flag apagado)',
    html.indexOf('PENDIENTE DE PRIMERA') < 0 && html.indexOf('VIVO SIN REGISTRO') < 0 && html.indexOf('SNIG') < 0 && html.indexOf('⚠') < 0, html.slice(0, 200));
}

async function probarSinBotonMovil(archivo){
  const filas = padronDe('la_vuelta', { '40000001': Object.assign({ propietario_snig: 'Silvia', snig_ingreso: '2026-07-01' }, SOLO) });
  const { win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST });
  console.log('\n=== ' + archivo + ' (móvil: sin botón ni modal) ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  chequear('móvil: no existe #btn-snig-sin-lectura', !doc.getElementById('btn-snig-sin-lectura'));
  chequear('móvil: no existe #modal-snig-sin-lectura', !doc.getElementById('modal-snig-sin-lectura'));
  chequear('móvil: la ficha sí usa el estado nuevo (pendiente)', win.__ficha(filas[0]).indexOf('🆕 PENDIENTE DE PRIMERA LECTURA') >= 0);
}

/* ---------- 9/11/2026 (paso 3E-1): pestaña "Por propietario SNIG" del Stock total (solo con CONFIG.propietarioSnig) ---------- */
// Stock de la app: claves "categoría||dueño" del primer potrero; los demás quedan vacíos.
function ponerStock(win, animales){
  const est = win.__est();
  Object.keys(est.potreros).forEach(k => { est.potreros[k].animales = {}; });
  est.potreros[win.__geo()[0].nombre].animales = animales;
}
// Padrón del escenario (a): Vacas 6 Silvia + 4 Fideicomiso + 2 solo-SNIG + 1 de otro campo, Terneros 2 Silvia, una
// Vaquillonas sin stock, y dos bajas (VENDIDO leída, MUERTO solo-SNIG) que NO deben contar.
function padronSnig(est, C){
  return padronDe(est, {
    '70000001': { categoria: 'Vacas', propietario_snig: C.snig }, '70000002': { categoria: 'Vacas', propietario_snig: C.snig },
    '70000003': { categoria: 'Vacas', propietario_snig: C.snig }, '70000004': { categoria: 'Vacas', propietario_snig: C.snig },
    '70000005': { categoria: 'Vacas', propietario_snig: C.snig }, '70000006': { categoria: 'Vacas', propietario_snig: C.snig },
    '70000007': { categoria: 'Vacas', propietario_snig: 'Fideicomiso' }, '70000008': { categoria: 'Vacas', propietario_snig: 'Fideicomiso' },
    '70000009': { categoria: 'Vacas', propietario_snig: 'Fideicomiso' }, '70000010': { categoria: 'Vacas', propietario_snig: 'Fideicomiso' },
    '70000011': Object.assign({ propietario_snig: C.snig, snig_ingreso: '2026-07-01' }, SOLO),   // solo-SNIG
    '70000012': Object.assign({ propietario_snig: C.snig, snig_ingreso: '2026-07-01' }, SOLO),   // solo-SNIG
    '70000013': { categoria: 'Vacas', propietario_snig: C.snig, campo_snig: C.otro },            // leída, el SNIG la ubica en otro campo
    '70000014': { categoria: 'Vacas', propietario_snig: C.snig, estado_vida: 'VENDIDO' },        // baja: no cuenta
    '70000015': Object.assign({ propietario_snig: C.snig, snig_ingreso: '2026-07-01', estado_vida: 'MUERTO' }, SOLO), // baja solo-SNIG: no cuenta
    '70000016': { categoria: 'Terneros', propietario_snig: C.snig }, '70000017': { categoria: 'Terneros', propietario_snig: C.snig },
    '70000018': { categoria: 'Vaquillonas', propietario_snig: 'Fideicomiso' },                    // sin stock en la app
  });
}
const STOCK_A = { 'Vacas||Silvia Dutra': 10, 'Vacas||Pedro Lanfranco': 10, 'Terneros||Silvia Dutra': 3 };
// Abre Stock total y espera a que estén pintados los paneles (y el del SNIG, si existe).
async function abrirStock(win){
  const doc = win.document;
  doc.getElementById('btn-stock').dispatchEvent(new win.Event('click', { bubbles: true }));
  for(let i = 0; i < 80; i++){
    const p0 = doc.getElementById('stock-panel-0'), p4 = doc.getElementById('stock-panel-4');
    const listo = p0 && p0.textContent && p0.textContent.indexOf('Cargando') < 0
      && (!p4 || (p4.textContent && p4.textContent.indexOf('Cargando') < 0));
    if(listo) break;
    await esperar(25);
  }
  await esperar(100);
  return doc;
}
// Tabla del panel cuyo primer encabezado es `titulo`; filas como [texto, texto...].
function tablaCon(panel, titulo){
  return Array.from(panel.querySelectorAll('table')).find(t => {
    const th = t.querySelector('thead th');
    return th && th.textContent.trim() === titulo;
  });
}
function filasDeTabla(t){
  return t ? Array.from(t.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())) : null;
}
const JS = v => JSON.stringify(v);

async function probarStockSnig(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== Stock total > "Por propietario SNIG" (' + est + ') ===');
  const { win, errores } = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  ponerStock(win, STOCK_A);
  await abrirStock(win);
  const boton = doc.querySelector('#stock-tabs [data-tab="4"]');
  chequear('pestaña nueva "Por propietario SNIG" en Stock total', !!boton && boton.textContent.trim() === 'Por propietario SNIG');
  boton.dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(20);
  const p4 = doc.getElementById('stock-panel-4');
  chequear('el panel se muestra al elegir la pestaña', p4.style.display === 'block');
  const txt = p4.textContent;
  chequear('rótulo "por tipo de animal, según el SNIG y la última lectura del bastón"', txt.indexOf('Por tipo de animal, según el SNIG y la última lectura del bastón') >= 0);

  const vacas = filasDeTabla(tablaCon(p4, 'Vacas'));
  chequear('(a) Vacas: ' + C.esperado + ' 6, Fideicomiso 4, Sin SNIG 10, total 20 (las bajas no cuentan)',
    JS(vacas) === JS([[C.esperado, '6'], ['Fideicomiso', '4'], ['Sin SNIG', '10'], ['Total', '20']]), JS(vacas));
  chequear('(a) Vacas: "En la app" con los dueños del stock (empate de 10: orden alfabético)', txt.indexOf('En la app: Pedro Lanfranco 10 · Silvia Dutra 10') >= 0);
  // 11/2026: el stock "Terneros" y el padrón "Terneros" son la familia "Terneros/as"
  const terneros = filasDeTabla(tablaCon(p4, 'Terneros/as'));
  chequear('(a) Terneros/as: ' + C.esperado + ' 2, Sin SNIG 1, total 3', JS(terneros) === JS([[C.esperado, '2'], ['Sin SNIG', '1'], ['Total', '3']]), JS(terneros));
  // Vaquillonas: no hay stock, pero el SNIG tiene una: es una familia comparable (total 0, el SNIG supera al stock)
  chequear('(a) Vaquillonas sin stock: tabla propia con el SNIG y total 0',
    JS(filasDeTabla(tablaCon(p4, 'Vaquillonas'))) === JS([['Fideicomiso', '1'], ['Sin SNIG', '0'], ['Total', '0']]),
    JS(filasDeTabla(tablaCon(p4, 'Vaquillonas'))));
  chequear('(a) Vaquillonas: aviso "⚠ el SNIG tiene 1 más que el stock (revisar)"',
    txt.indexOf('⚠ el SNIG tiene 1 más que el stock (revisar)') >= 0, txt.slice(0, 400));
  chequear('(a) al pie: solo en el SNIG, sin lectura = 2 (no entran en las categorías)',
    txt.indexOf('Solo en el SNIG, sin lectura (ver 🧾 SNIG sin lectura): 2') >= 0, txt.slice(-160));
  chequear('(a) al pie: según el SNIG en otro campo = 1', txt.indexOf('Según el SNIG están en otro campo: 1') >= 0);
  chequear('(a) avisos de exceso: solo el de Vaquillonas', txt.split('⚠ el SNIG tiene').length === 2, txt.slice(0, 400));

  // (b) el SNIG tiene más que el stock de la app: Sin SNIG 0 y el aviso
  const r2 = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST });
  ponerStock(r2.win, { 'Vacas||Silvia Dutra': 5 });
  const d2 = await abrirStock(r2.win);
  r2.win.document.querySelector('#stock-tabs [data-tab="4"]').dispatchEvent(new r2.win.Event('click', { bubbles: true }));
  await esperar(20);
  const p4b = d2.getElementById('stock-panel-4');
  chequear('(b) SNIG > stock: Sin SNIG 0 y Total 5',
    JS(filasDeTabla(tablaCon(p4b, 'Vacas'))) === JS([[C.esperado, '6'], ['Fideicomiso', '4'], ['Sin SNIG', '0'], ['Total', '5']]), JS(filasDeTabla(tablaCon(p4b, 'Vacas'))));
  chequear('(b) nota "⚠ el SNIG tiene 5 más que el stock (revisar)"', p4b.textContent.indexOf('⚠ el SNIG tiene 5 más que el stock (revisar)') >= 0);
  chequear('(c) bajas fuera: el solo-SNIG sigue en 2 (la baja MUERTO no suma)', p4b.textContent.indexOf('sin lectura (ver 🧾 SNIG sin lectura): 2') >= 0);
}

// Stock total existente (números y textos) igual con la pestaña nueva y sin ella (CONFIG.propietarioSnig apagado).
async function fotoStock(win){
  const doc = await abrirStock(win);
  const ids = ['stock-resumen', 'stock-desaparecidos-aviso', 'stock-vecinos-aviso', 'stock-panel-0', 'stock-panel-1', 'stock-panel-2', 'stock-panel-3'];
  const foto = ids.map(id => { const el = doc.getElementById(id); return id + ':' + (el ? el.innerHTML : '-'); }).join('\n');
  doc.getElementById('stock-cerrar').dispatchEvent(new win.Event('click', { bubbles: true }));
  return foto;
}
async function probarStockIgual(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== Stock total existente igual con y sin la pestaña nueva (' + archivo + ') ===');
  const con = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST });
  if(con.errores.length){ chequear('carga sin errores', false, con.errores[0]); return; }
  ponerStock(con.win, STOCK_A);
  const sin = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST, sinSnig: true });
  if(sin.errores.length){ chequear('carga sin errores (sin SNIG)', false, sin.errores[0]); return; }
  ponerStock(sin.win, STOCK_A);
  chequear('con el flag apagado no hay pestaña nueva', !sin.win.document.querySelector('#stock-tabs [data-tab="4"]'));
  const fotoCon = await fotoStock(con.win);
  const fotoSin = await fotoStock(sin.win);
  chequear('Stock total idéntico (resumen, avisos y paneles 0 a 3)', fotoCon === fotoSin, fotoCon.length + ' vs ' + fotoSin.length);
  chequear('Stock total: total de Vacas 20 en Categorías', (fotoCon.match(/Vacas/g) || []).length > 0 && fotoCon.indexOf('>20<') >= 0);
}

async function probarStockSinSenal(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== Stock total sin señal (' + est + ') ===');
  const { win, errores } = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  ponerStock(win, STOCK_A);
  RED.caida = true;
  const doc = await abrirStock(win);
  doc.querySelector('#stock-tabs [data-tab="4"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(20);
  RED.caida = false;
  const p4 = doc.getElementById('stock-panel-4');
  chequear('sin señal: mensaje claro en la pestaña del SNIG', p4.textContent.indexOf('No se pudo consultar el SNIG') === 0
    && p4.textContent.indexOf('Necesitás señal') >= 0, p4.textContent.slice(0, 160));
  chequear('sin señal: el resto de Stock total sigue (resumen y tabla de Categorías)',
    doc.getElementById('stock-resumen').textContent.length > 0 && filasDeTabla(tablaCon(doc.getElementById('stock-panel-0'), 'Categoría')).slice(-1)[0][1] === '23');
}

async function probarStockPoneChico(archivo){
  console.log('\n=== Stock total sin "Por propietario SNIG" (Pone Chico, flag apagado) ===');
  const { win, errores } = await levantar(archivo, padronSnig('pone_chico', CAMPOS.la_vuelta), { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  // Sin potreros en la config de prueba (Pone Chico no trae ninguno): el stock no hace falta para este chequeo.
  const doc = await abrirStock(win);
  chequear('Pone Chico: no hay pestaña ni panel del SNIG', !doc.querySelector('#stock-tabs [data-tab="4"]') && !doc.getElementById('stock-panel-4'));
  chequear('Pone Chico: abrir Stock total no pide el padrón (animales_caravana)', CONSULTAS.indexOf('animales_caravana') < 0, JS(CONSULTAS));
}

async function probarCampoSinStock(archivo){
  console.log('\n=== Campo (móvil simple): sin Stock total ===');
  const { win, errores } = await levantar(archivo, padronSnig('la_vuelta', CAMPOS.la_vuelta), { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  chequear('Campo: no existe #modal-stock ni #btn-stock', !win.document.getElementById('modal-stock') && !win.document.getElementById('btn-stock'));
}

/* ---------- 9/11/2026 (paso 3F): "Ver por dueño" con "Según el SNIG (última lectura del bastón)" y la tabla nueva
   de los reportes PDF/Excel de Estado de potreros (solo PC, CONFIG.propietarioSnig) ---------- */
// La Vuelta tiene el potrero "13"; María Laura no (sus potreros son Casco, Uno, Rincon): ahí se usa Casco.
const POT_VP = { la_vuelta: '13', maria_laura: 'Casco' };
// Por campo: el dueño que dice el SNIG para las Vacas (se traduce con mapaDuenos) y el otro dueño de las Terneros.
const CAMPOS_VP = {
  la_vuelta: { otro: 'Pedro Lanfranco',
    filasVerDueno: [['Pedro Lanfranco', 'Terneros/as', '2'], ['Silvia Dutra', 'Vacas', '3']] },
  maria_laura: { otro: 'Fideicomiso',
    filasVerDueno: [['Fideicomiso', 'Terneros/as', '2'], ['Pedro', 'Vacas', '3']] },
};
function padronVerDueno(est){
  const C = CAMPOS[est], V = CAMPOS_VP[est], pot = POT_VP[est];
  return padronDe(est, {
    '80000001': { categoria: 'Vacas', potrero: pot, propietario_snig: C.snig },
    '80000002': { categoria: 'Vacas', potrero: pot, propietario_snig: C.snig },
    '80000003': { categoria: 'Vacas', potrero: pot, propietario_snig: C.snig },
    '80000004': { categoria: 'Terneros', potrero: pot, propietario_snig: V.otro },
    '80000005': { categoria: 'Terneros', potrero: pot, propietario_snig: V.otro },
    // solo-SNIG (el bastón nunca la leyó, sin potrero): no cuenta
    '80000006': { ultima_lectura: null, estado_carencia: null, categoria: null, potrero: null, propietario_snig: C.snig, snig_ingreso: '2026-07-01' },
    // de baja (VENDIDO) aunque la leyó en el potrero: no cuenta
    '80000007': { categoria: 'Vacas', potrero: pot, propietario_snig: C.snig, estado_vida: 'VENDIDO' },
  });
}
function ponerStockPotrero(win, nombre, animales){
  const est = win.__est();
  Object.keys(est.potreros).forEach(k => { est.potreros[k].animales = {}; });
  est.potreros[nombre].animales = animales;
}
// Abre "Ver por dueño" del potrero (como el botón de su detalle) y espera la sección del SNIG.
async function abrirVerPorDueno(win, nombre){
  const doc = win.document;
  win.renderDetalle(nombre);
  doc.getElementById('btn-detalle-por-dueno').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(120);
  return doc.getElementById('detalle-dueno-snig');
}
async function probarVerPorDueno(archivo, est){
  const pot = POT_VP[est], V = CAMPOS_VP[est];
  console.log('\n=== Ver por dueño con "Según el SNIG" (' + est + ', potrero ' + pot + ') ===');
  const { win, errores } = await levantar(archivo, padronVerDueno(est), { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  ponerStockPotrero(win, pot, { 'Vacas||': 10 });
  let sec = await abrirVerPorDueno(win, pot);
  chequear('sección "Por tipo de animal, según el SNIG y la última lectura del bastón" debajo del desglose',
    !!sec && sec.textContent.indexOf('Por tipo de animal, según el SNIG y la última lectura del bastón') === 0, sec && sec.textContent.slice(0, 200));
  chequear('rótulo "puede estar atrasado hasta la próxima pasada del bastón"',
    !!sec && sec.textContent.indexOf('Según la última lectura: puede estar atrasado hasta la próxima pasada del bastón') >= 0);
  chequear('propietario traducido por mapaDuenos y categoría; solo activos, leídos y en el SNIG',
    JS(filasDeTabla(sec && sec.querySelector('table'))) === JS(V.filasVerDueno), JS(filasDeTabla(sec && sec.querySelector('table'))));
  // Por familia: Vacas 10 de stock con 3 del SNIG = 7 sin SNIG. Los 2 Terneros/as del SNIG no tienen stock en el
  // potrero: no restan Vacas, y dan el aviso de exceso (antes restaban Vacas por el nombre de la categoría).
  chequear('Sin SNIG o sin lectura: 7 (Vacas: 10 de stock menos 3 del SNIG)', !!sec && sec.textContent.indexOf('Sin SNIG o sin lectura: 7') >= 0, sec && sec.textContent);
  chequear('aviso de exceso por los Terneros/as del SNIG sin stock: 2', !!sec && sec.textContent.indexOf('⚠ el SNIG tiene 2 más que el stock del potrero') >= 0, sec && sec.textContent);
  chequear('el desglose de arriba sigue', !!doc.querySelector('#detalle-dueno-tabla table'));

  ponerStockPotrero(win, pot, { 'Vacas||': 3 });
  sec = await abrirVerPorDueno(win, pot);
  chequear('stock menor que lo cubierto: Sin SNIG o sin lectura: 0', !!sec && sec.textContent.indexOf('Sin SNIG o sin lectura: 0') >= 0, sec && sec.textContent);
  chequear('y el ⚠ "el SNIG tiene 2 más que el stock del potrero"',
    !!sec && sec.textContent.indexOf('⚠ el SNIG tiene 2 más que el stock del potrero') >= 0, sec && sec.textContent);

  ponerStockPotrero(win, pot, { 'Vacas||': 10 });
  RED.caida = true;
  sec = await abrirVerPorDueno(win, pot);
  RED.caida = false;
  chequear('sin señal: un renglón de aviso y lo demás intacto',
    !!sec && sec.textContent.indexOf('No se pudo consultar el SNIG') === 0 && !sec.querySelector('table')
      && !!doc.querySelector('#detalle-dueno-tabla table'), sec && sec.textContent.slice(0, 200));
}
async function probarVerPorDuenoPoneChico(archivo){
  console.log('\n=== Ver por dueño sin sección del SNIG (Pone Chico, flag apagado) ===');
  const p = 'Potrero de prueba';
  const geo = [{ nombre: p, area: '10', coords: [[-31.98, -56.34], [-31.98, -56.33], [-31.99, -56.33]] }];
  const filas = padronDe('pone_chico', { '80000001': { categoria: 'Vacas', potrero: p, propietario_snig: 'Silvia', en_snig: true } });
  const { win, errores } = await levantar(archivo, filas, { geo, hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  ponerStockPotrero(win, p, { 'Vacas||': 10 });
  CONSULTAS.length = 0;
  const sec = await abrirVerPorDueno(win, p);
  chequear('Pone Chico: no hay sección del SNIG en Ver por dueño', !sec);
  chequear('Pone Chico: Ver por dueño no pide el padrón (animales_caravana)', CONSULTAS.indexOf('animales_caravana') < 0, JS(CONSULTAS));
  chequear('Pone Chico: el desglose de siempre sigue', !!win.document.querySelector('#detalle-dueno-tabla table'));
}

// Reportes "Estado de potreros": jsPDF y SheetJS falsos que anotan lo que se pide guardar.
// Ancho de la hoja simulada (mm) y de un carácter (mm, 9 pt): el partido del rótulo usa ancho / CAR_MM caracteres por línea.
const HOJA_MM = 210, CAR_MM = 1.8;
function stubReportes(win){
  const reg = { tablas: [], textos: [], guardados: [], hojas: [], ys: [], anchos: [], inicios: [] };
  win.jspdf = { jsPDF: function(){
    const doc = {
      setFontSize(){}, setTextColor(){}, setFont(){},
      text(t, x, y){ (Array.isArray(t) ? t : [t]).forEach(l => { reg.textos.push(String(l)); reg.ys.push(y); }); },
      // como jsPDF: parte el texto en líneas que caben en el ancho dado (mm)
      splitTextToSize(t, ancho){
        reg.anchos.push(ancho);
        const maxCar = Math.max(1, Math.floor(ancho / CAR_MM)), palabras = String(t).split(' '), lineas = [];
        let cur = '';
        palabras.forEach(p => { const prueba = cur ? cur + ' ' + p : p; if(prueba.length > maxCar && cur){ lineas.push(cur); cur = p; } else cur = prueba; });
        if(cur) lineas.push(cur);
        return lineas;
      },
      internal: { pageSize: { getWidth(){ return HOJA_MM; } } },
      autoTable(o){ reg.tablas.push({ head: o.head, body: o.body }); reg.inicios.push(o.startY); doc.lastAutoTable = { finalY: 40 + reg.tablas.length * 20 }; },
      save(n){ reg.guardados.push(n); },
      lastAutoTable: { finalY: 0 }
    };
    return doc;
  } };
  win.XLSX = { utils: {
    book_new(){ return { hojas: [] }; },
    aoa_to_sheet(aoa){ return aoa; },
    book_append_sheet(wb, ws, nombre){ wb.hojas.push({ nombre, filas: ws }); }
  }, writeFile(wb, nombre){ reg.hojas = wb.hojas.slice(); reg.guardados.push(nombre); } };
  return reg;
}
// Dispara PDF y Excel de Estado de potreros y devuelve lo que quedó de cada uno.
async function generarReportes(win, reg, esperaMs){
  const doc = win.document;
  reg.tablas.length = 0; reg.textos.length = 0; reg.guardados.length = 0; reg.hojas = [];
  reg.ys.length = 0; reg.anchos.length = 0; reg.inicios.length = 0;
  doc.getElementById('btn-exportar-pdf').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(esperaMs || 150);
  // posiciones y anchos del PDF (para el partido del rótulo SNIG); no entran en la comparación de salidas
  reg.pdfMeta = { ys: reg.ys.slice(), anchos: reg.anchos.slice(), inicios: reg.inicios.slice() };
  const pdf = { tablas: reg.tablas.slice(), textos: reg.textos.slice(), guardados: reg.guardados.slice() };
  reg.guardados.length = 0;
  doc.getElementById('btn-exportar-excel').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(150);
  const xls = { hojas: reg.hojas.slice(), guardados: reg.guardados.slice() };
  return { pdf, xls };
}
const SNIG_HOJA = 'Por propietario SNIG';
const ROTULO_SNIG = 'Por tipo de animal, según el SNIG y la última lectura del bastón. Solo informativo: el stock es el de la app. El stock de "Otros bovinos" no se puede comparar con las categorías del bastón.';
const SNIG_TITULO_PDF = ['Tipo de animal', 'Propietario (SNIG)', 'Animales'];
// Filas esperadas del reporte con padronSnig() y STOCK_A (las mismas cifras que la pestaña del Stock total).
// El orden de familias es el de la pestaña (Terneros/as antes que Vacas, Vaquillonas después).
function filasReporteSnig(est){
  const C = CAMPOS[est];
  return [
    ['Terneros/as', C.esperado, 2], ['Terneros/as', 'Sin SNIG', 1], ['Terneros/as', 'Total (stock de la app)', 3],
    ['Vacas', C.esperado, 6], ['Vacas', 'Fideicomiso', 4], ['Vacas', 'Sin SNIG', 10], ['Vacas', 'Total (stock de la app)', 20],
    ['Vaquillonas', 'Fideicomiso', 1], ['Vaquillonas', 'Sin SNIG', 0], ['Vaquillonas', 'Total (stock de la app)', 0],
    ['Solo en el SNIG, sin lectura (no entran en las categorías)', '', 2],
    ['Según el SNIG, en otro campo', '', 1],
  ];
}
async function probarReportesSnig(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== Reporte PDF/Excel con "Por propietario SNIG" (' + est + ') ===');
  const con = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST });
  if(con.errores.length){ chequear('carga sin errores', false, con.errores[0]); return; }
  ponerStock(con.win, STOCK_A);
  const regCon = stubReportes(con.win);
  const { pdf, xls } = await generarReportes(con.win, regCon);
  const tablaSnig = pdf.tablas[pdf.tablas.length - 1];
  chequear('PDF: la tabla "Por propietario SNIG" va al final',
    !!tablaSnig && JS(tablaSnig.head) === JS([SNIG_TITULO_PDF]), JS(pdf.tablas.map(t => t.head)));
  chequear('PDF: cifras iguales que el Stock total (propietario × categoría, Sin SNIG, solo-SNIG, otro campo)',
    !!tablaSnig && JS(tablaSnig.body) === JS(filasReporteSnig(est)), JS(tablaSnig && tablaSnig.body));
  chequear('PDF: rótulo de la tabla (solo informativo)', pdf.textos.some(t => t.indexOf('Por tipo de animal, según el SNIG y la última lectura del bastón') === 0));
  // 9/11/2026 (revisión): el rótulo largo se parte al ancho útil (210 mm menos 14 mm a cada lado) y la tabla va debajo
  const meta = regCon.pdfMeta;
  const i0 = pdf.textos.findIndex(t => t.indexOf('Por tipo de animal, según el SNIG') === 0);
  let nR = 0;
  for(let k = 1; k <= 10 && i0 >= 0 && !nR; k++){ if(pdf.textos.slice(i0, i0 + k).join(' ') === ROTULO_SNIG) nR = k; }
  chequear('PDF: el rótulo partido en 2 o más líneas, que juntas dan el texto completo', nR >= 2, JS(pdf.textos.slice(Math.max(0, i0), i0 + 4)));
  chequear('PDF: el ancho que se pide para partir el rótulo cabe en la hoja (182 mm)', meta.anchos.length === 1 && meta.anchos[0] === HOJA_MM - 28, JS(meta.anchos));
  chequear('PDF: la tabla SNIG empieza debajo de todas las líneas del rótulo',
    nR >= 2 && meta.inicios[meta.inicios.length - 1] >= meta.ys[i0] + nR * 4, JS([meta.inicios, meta.ys[i0], nR]));
  const hoja = xls.hojas[xls.hojas.length - 1];
  chequear('Excel: hoja nueva "' + SNIG_HOJA + '" al final', !!hoja && hoja.nombre === SNIG_HOJA, JS(xls.hojas.map(h => h.nombre)));
  chequear('Excel: la hoja trae el rótulo, un renglón vacío, el encabezado y las mismas filas del PDF',
    !!hoja && JS(hoja.filas.slice(2)) === JS([SNIG_TITULO_PDF].concat(filasReporteSnig(est))), JS(hoja && hoja.filas));
  const sinTablaSnig = pdf.tablas.slice(0, -1);

  // Sin señal: el reporte sale igual que con el flag apagado (sin la tabla ni la hoja), y no rompe.
  const caido = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST });
  ponerStock(caido.win, STOCK_A);
  RED.caida = true;
  const salida = await generarReportes(caido.win, stubReportes(caido.win));
  RED.caida = false;
  const apagado = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST, sinSnig: true });
  ponerStock(apagado.win, STOCK_A);
  const salidaApagado = await generarReportes(apagado.win, stubReportes(apagado.win));
  chequear('sin señal: PDF y Excel idénticos a los del flag apagado',
    JS(salida) === JS(salidaApagado), JS(salida).slice(0, 200) + ' vs ' + JS(salidaApagado).slice(0, 200));
  chequear('sin señal: no hay tabla ni hoja del SNIG',
    salida.pdf.tablas.every(t => JS(t.head) !== JS([SNIG_TITULO_PDF])) && salida.xls.hojas.every(h => h.nombre !== SNIG_HOJA));
  chequear('con señal: las tablas y hojas de siempre quedan iguales que con el flag apagado',
    JS(sinTablaSnig) === JS(salidaApagado.pdf.tablas) && JS(xls.hojas.filter(h => h.nombre !== SNIG_HOJA)) === JS(salidaApagado.xls.hojas),
    JS(sinTablaSnig).slice(0, 120));
}
async function probarPoneChicoReportes(archivo){
  console.log('\n=== Reportes de Estado de potreros (Pone Chico, flag apagado) ===');
  const { win, errores } = await levantar(archivo, padronSnig('pone_chico', CAMPOS.la_vuelta), { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  CONSULTAS.length = 0;
  const { pdf, xls } = await generarReportes(win, stubReportes(win));
  chequear('Pone Chico: ni tabla ni hoja "Por propietario SNIG"',
    pdf.tablas.every(t => JS(t.head) !== JS([SNIG_TITULO_PDF])) && xls.hojas.every(h => h.nombre !== SNIG_HOJA));
  chequear('Pone Chico: los reportes no piden el padrón (animales_caravana)', CONSULTAS.indexOf('animales_caravana') < 0, JS(CONSULTAS));
}

/* ---------- 11/2026 (a pedido de Pedro): comparar por FAMILIA de tipo de animal, no por nombre de categoría ----------
   Las categorías del stock vienen de ESPECIES (las mismas para La Vuelta y María Laura: los configs no las redefinen).
   Cada página se mira con su propio ESPECIES, así que se recorren las categorías de los dos campos. */
const FAMILIA_ESPERADA_ESPECIES = {
  'Terneros': 'Terneros/as', 'Terneras': 'Terneros/as',
  'Novillitos 1-2 años': 'Novillos', 'Novillos 2-3 años': 'Novillos', 'Novillos +3 años': 'Novillos',
  'Vaquillonas 1-2 años': 'Vaquillonas', 'Vaquillonas 2-3 años': 'Vaquillonas', 'Vaquillona de invernada': 'Vaquillonas',
  'Vacas': 'Vacas', 'Vacas de invernada': 'Vacas',
  'Toros': 'Toros',
  'Bueyes': 'Otras', 'Otros bovinos': 'Otras',
};
// Nombres REALES del padrón (valores que trae el bastón / el SNIG en la base de La Vuelta y María Laura).
// VINV: en el mapa de Excel de la app (CAT_EXCEL_COMPRA) VINV es "Vacas de invernada", por eso va con Vacas.
const FAMILIA_ESPERADA_PADRON = {
  'Ternero': 'Terneros/as', 'Ternera': 'Terneros/as', 'Ternero/a': 'Terneros/as', 'TERNERO': 'Terneros/as',
  'TERNERA': 'Terneros/as', 'TEROS/AS': 'Terneros/as',
  'Vaca': 'Vacas', 'VACA': 'Vacas', 'Vaca CUT': 'Vacas', 'Vaca de invernada': 'Vacas', 'VINV': 'Vacas',
  'Vaquillona': 'Vaquillonas', 'VAQ': 'Vaquillonas',
  'Novillito 1-2': 'Novillos', 'Novillo 2-3': 'Novillos', 'NOV12': 'Novillos',
  'Toro': 'Toros', 'TORO': 'Toros',
  // 11/2026 (revisión): el bastón escribe TORITO (y "torito/s"): es un toro joven, va con Toros, no con Otras
  'TORITO': 'Toros', 'torito/s': 'Toros',
  '': 'Sin categoría',
};
async function probarFamilias(archivo, est){
  console.log('\n=== familias de tipo de animal (' + archivo + ') ===');
  const { win, errores } = await levantar(archivo, padronDe(est, {}));
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const F = win.__familia;
  const padronMal = Object.entries(FAMILIA_ESPERADA_PADRON).filter(([n, f]) => F(n) !== f).map(([n, f]) => n + ' -> ' + F(n) + ' (esperaba ' + f + ')');
  if(F(null) !== 'Sin categoría') padronMal.push('null -> ' + F(null));
  chequear('nombres reales del padrón (' + Object.keys(FAMILIA_ESPERADA_PADRON).length + ' más el vacío) caen en la familia correcta', padronMal.length === 0, padronMal.join(' | '));
  const esp = win.__especies;
  const bovinos = Object.keys(esp.bovino), ovinos = Object.keys(esp.ovino).concat(Object.keys(esp.equino));
  chequear('las categorías bovinas de la app son las que la prueba conoce', JS(bovinos.slice().sort()) === JS(Object.keys(FAMILIA_ESPERADA_ESPECIES).sort()),
    JS(bovinos));
  const stockMal = bovinos.filter(c => F(c) !== FAMILIA_ESPERADA_ESPECIES[c]).map(c => c + ' -> ' + F(c));
  chequear('cada categoría bovina del stock cae en su familia', stockMal.length === 0, stockMal.join(' | '));
  chequear('ovinos y equinos caen en "Otras"', ovinos.every(c => F(c) === 'Otras'), ovinos.filter(c => F(c) !== 'Otras').join(' | '));
  console.log('  categorías del stock (' + est + ') con su familia:');
  bovinos.concat(ovinos).forEach(c => console.log('    ' + c + ' → ' + F(c)));
  console.log('  nombres del padrón con su familia:');
  Object.keys(FAMILIA_ESPERADA_PADRON).forEach(n => console.log('    ' + JS(n) + ' → ' + F(n)));
}

/* Datos reales: el padrón con nombres del bastón y el stock con nombres de la app. Cada familia suma bien y el total es el stock. */
async function probarDatosReales(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== datos reales: padrón del bastón contra stock de la app (' + est + ') ===');
  const filas = padronDe(est, {
    '90000001': { categoria: 'Vaca CUT', propietario_snig: C.snig },
    '90000002': { categoria: 'Vaca CUT', propietario_snig: C.snig },
    '90000003': { categoria: 'Vaca CUT', propietario_snig: C.snig },
    '90000004': { categoria: 'Vaquillona', propietario_snig: 'Pedro Lanfranco' },
    '90000005': { categoria: 'Vaquillona', propietario_snig: 'Pedro Lanfranco' },
    '90000006': { categoria: 'Ternero/a', propietario_snig: C.snig },
    '90000007': { categoria: 'TERNERA', propietario_snig: 'Pedro Lanfranco' },
    '90000008': { categoria: 'TERNERA', propietario_snig: 'Pedro Lanfranco' },
  });
  const { win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  ponerStock(win, { 'Vacas||Silvia Dutra': 4, 'Vaquillonas 2-3 años||Fideicomiso': 3, 'Terneros||Silvia Dutra': 2, 'Terneras||Pedro Lanfranco': 2 });
  const d = win.__resumenStock(filas);
  const fila = fam => d.filas.find(f => f.fam === fam);
  const cub = f => f.porDueno.reduce((s, [, n]) => s + n, 0);
  const t = fila('Terneros/as'), v = fila('Vacas'), q = fila('Vaquillonas');
  chequear('Terneros/as: total 4 (Terneros 2 + Terneras 2), SNIG 3, Sin SNIG 1', !!t && t.total === 4 && cub(t) === 3 && t.sinSnig === 1 && t.exceso === 0, JS(t));
  chequear('Vacas: total 4 (Vacas), SNIG 3 (Vaca CUT), Sin SNIG 1', !!v && v.total === 4 && cub(v) === 3 && v.sinSnig === 1 && v.exceso === 0, JS(v));
  chequear('Vaquillonas: total 3 (Vaquillonas 2-3 años), SNIG 2 (Vaquillona), Sin SNIG 1', !!q && q.total === 3 && cub(q) === 2 && q.sinSnig === 1 && q.exceso === 0, JS(q));
  const sumaTotales = d.filas.reduce((s, f) => s + f.total, 0);
  chequear('la suma de los totales de las familias = el stock de la app (11)', sumaTotales === 11, String(sumaTotales));
  chequear('ninguna familia del padrón queda como "sin stock" o "sin categoría" por nombre',
    d.sinComparable.length === 0, JS(d.sinComparable));
  const html = win.__htmlStock(d);
  chequear('la tabla muestra cada familia (Terneros/as, Vacas, Vaquillonas) y no "Categoría del padrón sin stock"',
    html.indexOf('>Terneros/as<') >= 0 && html.indexOf('>Vacas<') >= 0 && html.indexOf('>Vaquillonas<') >= 0 && html.indexOf('sin stock') < 0, html.slice(0, 200));
}

/* "Otros bovinos", bueyes, ovinos, equinos y las categorías vacías o no comparables NO se restan del stock de ninguna familia. */
async function probarOtrasNoSeRestan(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== "Otras" y "Sin categoría" no se restan (' + est + ') ===');
  const filas = padronDe(est, {
    '91000001': { categoria: 'Vacas', propietario_snig: C.snig },
    '91000002': { categoria: 'Bueyes', propietario_snig: C.snig },
    '91000003': { categoria: 'Bueyes', propietario_snig: C.snig },
    '91000004': { categoria: 'Bueyes', propietario_snig: C.snig },
    '91000005': { categoria: '', propietario_snig: C.snig },
  });
  const { win, errores } = await levantar(archivo, filas, { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  ponerStock(win, { 'Vacas||Silvia Dutra': 2, 'Otros bovinos||Silvia Dutra': 5, 'Bueyes||Pedro Lanfranco': 1 });
  const d = win.__resumenStock(filas);
  const v = d.filas.find(f => f.fam === 'Vacas');
  chequear('Vacas: stock 2, SNIG 1: Sin SNIG 1 (los Bueyes y el vacío no restan)', !!v && v.total === 2 && v.sinSnig === 1 && v.exceso === 0, JS(v));
  const o = d.filas.find(f => f.fam === 'Otras');
  chequear('Otras: total del stock 6 (Otros bovinos 5 + Bueyes 1), sin comparar', !!o && o.total === 6 && o.comparable === false, JS(o));
  chequear('Otras del padrón (3 bueyes) y Sin categoría (1) van aparte, sin restar',
    JS(d.sinComparable) === JS([{fam: 'Otras', porDueno: [[C.esperado, 3]]}, {fam: 'Sin categoría', porDueno: [[C.esperado, 1]]}]), JS(d.sinComparable));
  const html = win.__htmlStock(d);
  chequear('rótulo: el stock de "Otros bovinos" no se puede comparar con las categorías del bastón',
    html.indexOf('el stock de "Otros bovinos" no se puede comparar con las categorías del bastón') >= 0);
  chequear('la familia Otras no muestra "Sin SNIG"', html.split('Sin SNIG').length - 1 === 1, String(html.split('Sin SNIG').length - 1));
}

/* ---------- 9/11/2026 (revisión, punto 4): la consulta del SNIG colgada no deja el reporte esperando ---------- */
async function esperarQue(cond, maxMs){
  const t0 = Date.now();
  while(!cond() && Date.now() - t0 < maxMs) await esperar(50);
  return Date.now() - t0;
}
async function probarReporteSinRespuesta(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== Reporte con la consulta del SNIG que nunca contesta (' + est + ') ===');
  const { win, errores } = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST });
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  ponerStock(win, STOCK_A);
  const reg = stubReportes(win);
  const doc = win.document;
  RED.colgada = true;
  doc.getElementById('btn-exportar-pdf').dispatchEvent(new win.Event('click', { bubbles: true }));
  const tPdf = await esperarQue(() => reg.guardados.length >= 1, 15000);
  const pdfTablas = reg.tablas.slice(), pdfGuardados = reg.guardados.length;
  reg.guardados.length = 0;
  doc.getElementById('btn-exportar-excel').dispatchEvent(new win.Event('click', { bubbles: true }));
  const tXls = await esperarQue(() => reg.guardados.length >= 1, 15000);
  RED.colgada = false;
  const apagado = await levantar(archivo, padronSnig(est, C), { hoy: HOY_TEST, sinSnig: true });
  ponerStock(apagado.win, STOCK_A);
  const salida = await generarReportes(apagado.win, stubReportes(apagado.win));
  chequear('PDF sale aunque la consulta nunca vuelva (tardó ' + tPdf + ' ms, tope 8 s)', pdfGuardados === 1 && tPdf >= 7500 && tPdf < 12000,
    'tardó ' + tPdf + ' ms, guardados ' + pdfGuardados);
  chequear('PDF igual que con el flag apagado (sin la tabla SNIG)', JS(pdfTablas) === JS(salida.pdf.tablas), JS(pdfTablas).slice(0, 160));
  chequear('Excel sale también (tardó ' + tXls + ' ms) y sin la hoja SNIG',
    reg.guardados.length === 1 && tXls >= 7500 && tXls < 12000 && reg.hojas.every(h => h.nombre !== SNIG_HOJA),
    'tardó ' + tXls + ' ms, hojas ' + JS(reg.hojas.map(h => h.nombre)));
}

/* ---------- 9/11/2026 (revisión, punto 5): Eventos de manejo: la línea del SNIG sigue al valor cuando el código lo cambia ---------- */
async function probarEventosManejoSnig(archivo, est){
  const C = CAMPOS[est];
  console.log('\n=== Eventos de manejo: línea del SNIG al limpiar y al cargar el CSV (' + est + ') ===');
  const filas = padronDe(est, { '20000001': { en_snig: true, propietario_snig: C.snig }, '20000002': { en_snig: false } });
  const { win, errores } = await levantar(archivo, filas);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const ta = doc.getElementById('em-caravanas');
  win.abrirEventosManejo();
  await escribir(win, ta, '20000001');
  chequear('con una caravana escrita sale la línea del SNIG con "' + C.esperado + '"', (linea(ta) || '').indexOf(C.esperado) >= 0, linea(ta));
  win.abrirEventosManejo();
  await esperar(DEBOUNCE_ESPERA);
  chequear('al limpiar el formulario el valor queda vacío', ta.value === '', ta.value);
  chequear('y la línea del SNIG se borra', linea(ta) === '', linea(ta));

  const csv = doc.getElementById('em-csv');
  Object.defineProperty(csv, 'files', { value: [new win.File(['VID,EID\n20000001,\n'], 'caravanas.csv', { type: 'text/csv' })], configurable: true });
  csv.dispatchEvent(new win.Event('change', { bubbles: true }));
  await esperarQue(() => ta.value !== '', 3000);
  await esperar(DEBOUNCE_ESPERA);
  chequear('al cargar el CSV la caravana queda en el valor', ta.value === '20000001', JSON.stringify(ta.value));
  chequear('y la línea del SNIG dice "' + C.esperado + '" sin que la persona toque el campo', (linea(ta) || '').indexOf(C.esperado) >= 0, linea(ta));
}

/* ---------- 9/11/2026 (revisión, punto 1): las funciones que llama el código del SNIG existen en cada variante ----------
   Se toman las funciones de nombre SNIG del index.html generado, sus llamadas a funciones que la PLANTILLA define a nivel
   superior, y se mira en la página (typeof) que cada una sea 'function'. Las que son solo de PC (botón 🧾 y reportes)
   se esperan indefinidas fuera de PC: su código no existe en esas variantes y nada las llama allí. */
const SNIG_NOMBRE = /snig|padronParaStock|resumenPorPropietario|htmlPorPropietario|cargarPanelPropietario|normNombrePotrero|quitarAcentosSnig|familiaCategoria|FAMILIA|PADRON_|propietarioSnig|buscarCaravanasLote|cargarSnigEnDetalle|htmlSnigDetalle/i;
const SOLO_PC_SNIG = ['snigListaSinLectura', 'cargarSnigSinLectura', 'snigFiltrados', 'pintarSnigSinLectura', 'abrirSnigSinLectura', 'csvSnigSinLectura', 'snigParaReporte'];
const NO_SON_FUNCIONES = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'async', 'Promise', 'Set', 'Map', 'Number', 'String', 'Array', 'Object', 'Date', 'Boolean', 'Error', 'parseInt', 'parseFloat']);
function llamadasSnig(codigo, nombresPlantilla){
  const lineas = codigo.split('\n'), llamadas = new Set();
  for(let i = 0; i < lineas.length; i++){
    const m = lineas[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if(!m || !SNIG_NOMBRE.test(m[1])) continue;
    let prof = 0, j = i;
    const cuerpo = [];
    for(; j < lineas.length; j++){
      cuerpo.push(lineas[j]);
      for(const c of lineas[j]){ if(c === '{') prof++; else if(c === '}') prof--; }
      if(prof === 0 && cuerpo.join('').indexOf('{') >= 0) break;
    }
    for(const x of cuerpo.join('\n').matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)){
      if(!NO_SON_FUNCIONES.has(x[2]) && nombresPlantilla.has(x[2])) llamadas.add(x[2]);
    }
    i = j;
  }
  return llamadas;
}
const NOMBRES_PLANTILLA = (() => {
  const txt = fs.readFileSync(require('path').join(__dirname, '..', 'template', 'potreros.template.html'), 'utf-8');
  const s = new Set();
  for(const m of txt.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) s.add(m[1]);
  return s;
})();
async function probarFuncionesSnig(archivo){
  const { win, errores } = await levantar(archivo, []);
  console.log('\n=== funciones que llama el código del SNIG existen en la página (' + archivo + ') ===');
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const codigo = fs.readFileSync(archivo, 'utf-8');
  const llamadas = [...llamadasSnig(codigo, NOMBRES_PLANTILLA)].sort();
  const esPc = /(^|[\\/])[a-z-]+-pc[\\/]/.test(archivo);
  const malas = llamadas.filter(n => win.eval('typeof ' + n) !== 'function' && !(SOLO_PC_SNIG.includes(n) && !esPc));
  chequear('las ' + llamadas.length + ' funciones que llama el SNIG existen (sin contar las de PC fuera de PC)', malas.length === 0,
    'no existen: ' + JS(malas));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){
    console.error('uso: node tests/probar_propietario_snig.js la-vuelta-pc/index.html maria-laura-pc/index.html pone-chico-pc/index.html [la-vuelta-movil/index.html]');
    process.exit(2);
  }
  for(const a of archivos){
    await probarFuncionesSnig(a);
    if(/la-vuelta-movil-campo[\\/]/.test(a)){
      await probarCampoSinStock(a);
      // 9/11/2026 (revisión, punto 1): Ver por dueño con "Según el SNIG" en Campo (antes quedaba en "Cargando…")
      await probarVerPorDueno(a, 'la_vuelta');
    }
    else if(/maria-laura-movil-campo[\\/]/.test(a)){
      await probarVerPorDueno(a, 'maria_laura');
    }
    else if(/la-vuelta-movil[\\/]/.test(a)){
      await probarCacheMovil(a);
      await probarSinBotonMovil(a);
      await probarStockSnig(a, 'la_vuelta');
      await probarStockIgual(a, 'la_vuelta');
      await probarVerPorDueno(a, 'la_vuelta');
    }
    else if(/la-vuelta-pc[\\/]/.test(a)){
      await probarFamilias(a, 'la_vuelta');
      await probarDatosReales(a, 'la_vuelta');
      await probarOtrasNoSeRestan(a, 'la_vuelta');
      await probarStockSnig(a, 'la_vuelta');
      await probarStockIgual(a, 'la_vuelta');
      await probarStockSinSenal(a, 'la_vuelta');
      await probarCampo(a, 'la_vuelta');
      await probarFichaYQuienEs(a, 'la_vuelta');
      await probarLineas(a, 'la_vuelta');
      await probarGuardarMuerte(a, 'la_vuelta');
      await probarDuenoSugerido(a, 'la_vuelta');
      await probarDuenoSugeridoRevision(a, 'la_vuelta');
      await probarEventosManejoSnig(a, 'la_vuelta');
      await probarReporteSinRespuesta(a, 'la_vuelta');
      await probarEstadosSinLectura(a, 'la_vuelta');
      await probarModalSnig(a, 'la_vuelta');
      await probarListaVaciaYPaginada(a, 'la_vuelta');
      await probarVerPorDueno(a, 'la_vuelta');
      await probarReportesSnig(a, 'la_vuelta');
    }
    else if(/maria-laura-pc[\\/]/.test(a)){
      await probarFamilias(a, 'maria_laura');
      await probarDatosReales(a, 'maria_laura');
      await probarOtrasNoSeRestan(a, 'maria_laura');
      await probarStockSnig(a, 'maria_laura');
      await probarStockIgual(a, 'maria_laura');
      await probarStockSinSenal(a, 'maria_laura');
      await probarCampo(a, 'maria_laura');
      await probarFichaYQuienEs(a, 'maria_laura');
      await probarLineas(a, 'maria_laura');
      await probarGuardarMuerte(a, 'maria_laura');
      await probarDuenoSugerido(a, 'maria_laura');
      await probarDuenoSugeridoRevision(a, 'maria_laura');
      await probarEventosManejoSnig(a, 'maria_laura');
      await probarEstadosSinLectura(a, 'maria_laura');
      await probarModalSnig(a, 'maria_laura');
      await probarListaVaciaYPaginada(a, 'maria_laura');
      await probarVerPorDueno(a, 'maria_laura');
      await probarReportesSnig(a, 'maria_laura');
    }
    else if(/pone-chico-pc[\\/]/.test(a)){
      await probarPoneChico(a);
      await probarPoneChicoSinLineas(a);
      await probarPoneChicoDuenoIgual(a);
      await probarPoneChicoSinListado(a);
      await probarStockPoneChico(a);
      await probarVerPorDuenoPoneChico(a);
      await probarPoneChicoReportes(a);
    }
    else { chequear('archivo reconocido: ' + a, false, 'no es LV/ML/PC'); }
  }
  console.log('\n' + (fallas ? fallas + ' PROBLEMA(S)' : 'todo bien'));
  process.exit(fallas ? 1 : 0);
})();
