/*
 * Prueba: "🔎 Buscar caravana" y la caravana dentro de "+ Cargar tratamiento".
 *
 * 24/9/2026. El padron por animal lo publica la PC a 'animales_caravana'
 * (publicar_animales.py, carpeta del lector XRS2) desde la base que arma el
 * baston Tru-Test. La app SOLO LEE de ahi.
 *
 * Lo que se verifica, y por que importa:
 *  - normalizarCaravana: el baston da un EID de 15 digitos y el SNIG publica
 *    los 8 visuales. Si no coinciden, no hay cruce posible.
 *  - La ficha distingue APTO / NO APTO / CARENCIA DESCONOCIDA. Un animal en
 *    espera que se muestre como apto es un animal que se va a faena cuando
 *    no debia -- es el error que este modal existe para evitar.
 *  - Una caravana que no esta en el padron AVISA, no inventa un animal.
 *  - Sin señal avisa y no rompe.
 *  - 25/9/2026: "Cargar tratamiento" se divide en grupal (por lote, sin
 *    caravana, cantidad libre) e individual (un animal, cantidad fija en 1,
 *    caravana obligatoria salvo que se confirme explicitamente "este animal
 *    no tiene caravana" -- deja constancia en sin_caravana en vez de un
 *    campo vacio ambiguo). Disponible en los 3 establecimientos desde el
 *    principio -- no depende de tener padron cargado, ese dato solo cambia
 *    si "quien es" encuentra algo al tipear, no si se puede guardar.
 *  - "🔎 Buscar caravana" (el buscador aparte) sigue siendo solo de La
 *    Vuelta (CONFIG.caravanasHabilitado) -- busca contra el padron
 *    animales_caravana, que hoy solo tiene datos de La Vuelta. En Maria
 *    Laura/Pone Chico "quien es" (dentro del form) simplemente no
 *    encuentra nada, pero eso no impide cargar/guardar la caravana.
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

// Tres animales que cubren los tres estados posibles.
const PADRON = [
  { establecimiento:'la_vuelta', id8:'57179343', ide:'858000057179343', sexo:'HEMBRA',
    categoria:'Vaquillona', gen:'3', propietario:'PEDRO', potrero:'12',
    estado_carencia:'APTO', fecha_apto:null, dias_restantes:null,
    producto_carencia:null, proximo_tratamiento:'2026-10-08',
    ultimo_peso:292, peso_fecha:'2025-11-13', ultima_lectura:'2026-08-24' },
  { establecimiento:'la_vuelta', id8:'37620042', ide:'858000037620042', sexo:'MACHO',
    categoria:'Novillito 1-2', gen:'4', propietario:'SILVIA', potrero:'21',
    estado_carencia:'NO APTO', fecha_apto:'2026-12-31', dias_restantes:98,
    producto_carencia:'EON', proximo_tratamiento:'2026-11-02',
    ultimo_peso:340, peso_fecha:'2026-05-10', ultima_lectura:'2026-09-03' },
  { establecimiento:'la_vuelta', id8:'44444444', ide:'858000044444444', sexo:'HEMBRA',
    categoria:'Vaca', gen:'1', propietario:'FIDEICOMISO', potrero:'13',
    estado_carencia:'CARENCIA DESCONOCIDA', fecha_apto:null, dias_restantes:null,
    producto_carencia:'G0', proximo_tratamiento:null,
    ultimo_peso:null, peso_fecha:null, ultima_lectura:'2026-04-01' },
];

function crearServidor(opciones){
  const cfg = opciones || {};
  const filas = { sanidad_carga: [], sanidad_carga_maria_laura: [],
    sanidad_carga_pone_chico: [], eventos_sync: [], productos_catalogo: [],
    animales_caravana: PADRON.map(a => Object.assign({}, a)) };
  const consultas = [];
  return {
    filas, consultas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          insert(obj){
            (filas[tabla] = filas[tabla] || []).push(Object.assign({}, obj));
            return Promise.resolve({ error: null });
          },
          select(){ return q; },
          eq(col,val){ q._filtros.push(r=>r[col]===val); if(tabla==='animales_caravana' && col==='id8') consultas.push(val); return q; },
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
          gte(col,val){ q._filtros.push(r=>r[col]>=val); return q; },
          order(){ return q; }, limit(){ return q; },
          in(col,vals){ q._filtros.push(r=>vals.includes(r[col])); return q; },
          then(res){
            if(tabla==='animales_caravana' && cfg.sinSenal){
              return Promise.resolve(res({data:null, error:{message:'Failed to fetch'}}));
            }
            const data = (filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r)));
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
  const dom = new JSDOM(html, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s=>s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo +
      '\n;window.__est = function(){ return estado; };' +
      '\n;window.__cfg = CONFIG;' +
      '\n;window.__tablaSanidad = (typeof TABLA_SANIDAD!=="undefined") ? TABLA_SANIDAD : null;' +
      '\n;window.__normalizar = (typeof normalizarCaravana!=="undefined") ? normalizarCaravana : undefined;' +
      '\n;window.__potrerosGeo = POTREROS_GEO;');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r=>setTimeout(r,60));
  return { win, errores };
}

const esperar = (ms) => new Promise(r=>setTimeout(r,ms));

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  const habilitado = !!win.__cfg.caravanasHabilitado;
  const boton = doc.getElementById('btn-caravana');
  chequear('el boton existe en el HTML generado', !!boton);

  // ---------- "🔎 Buscar caravana" (el buscador aparte): solo La Vuelta ----------
  if(!habilitado){
    // Inerte, no ausente: el codigo se genera igual para los 3.
    chequear('sin el flag, el boton queda oculto', boton.style.display === 'none');
  } else {
    chequear('con el flag, el boton se muestra', boton.style.display !== 'none');

    // ---------- normalizacion: EID de 15 vs visual de 8 ----------
    const n = win.__normalizar;
    chequear('EID de 15 digitos -> los 8 visuales', n('858000057179343') === '57179343');
    chequear('visual de 8 queda igual', n('57179343') === '57179343');
    chequear('un numero corto se rellena con ceros', n('1234') === '00001234');
    chequear('texto sin digitos da null', n('abc') === null);

    // ---------- buscar: animal APTO ----------
    boton.dispatchEvent(new win.Event('click', {bubbles:true}));
    chequear('el modal se abre', doc.getElementById('modal-caravana').style.display === 'flex');
    doc.getElementById('cv-numero').value = '858000057179343';   // con el EID entero
    doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', {bubbles:true}));
    await esperar(40);
    let txt = doc.getElementById('cv-resultado').textContent;
    chequear('busca por los ultimos 8 digitos', servidor.consultas.includes('57179343'));
    chequear('APTO: lo dice', /APTO/.test(txt) && !/NO APTO/.test(txt));
    chequear('APTO: muestra la categoria', /Vaquillona/.test(txt));
    chequear('APTO: muestra el potrero', /12/.test(txt));
    chequear('APTO: muestra el peso', /292/.test(txt));

    // ---------- buscar: animal NO APTO ----------
    doc.getElementById('cv-numero').value = '37620042';
    doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', {bubbles:true}));
    await esperar(40);
    txt = doc.getElementById('cv-resultado').textContent;
    chequear('NO APTO: lo dice', /NO APTO/.test(txt));
    chequear('NO APTO: muestra hasta cuando', /2026-12-31/.test(txt));
    chequear('NO APTO: muestra los dias que faltan', /98/.test(txt));
    chequear('NO APTO: nombra el producto', /EON/.test(txt));

    // ---------- buscar: carencia desconocida ----------
    doc.getElementById('cv-numero').value = '44444444';
    doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', {bubbles:true}));
    await esperar(40);
    txt = doc.getElementById('cv-resultado').textContent;
    chequear('desconocida: no dice que este apto', !/✅/.test(txt));
    chequear('desconocida: avisa que no se sabe', /No se sabe si está apto/.test(txt));
    chequear('desconocida: nombra el producto sin plazo', /G0/.test(txt));

    // ---------- buscar: caravana que no existe ----------
    doc.getElementById('cv-numero').value = '99999999';
    doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', {bubbles:true}));
    await esperar(40);
    txt = doc.getElementById('cv-resultado').textContent;
    chequear('caravana desconocida: avisa y no inventa un animal',
      /no está en el padrón/.test(txt) && !/Vaquillona|Vaca|Novillito/.test(txt));

    doc.getElementById('caravana-cerrar').dispatchEvent(new win.Event('click', {bubbles:true}));
    chequear('la ✕ / Cerrar cierra el modal', doc.getElementById('modal-caravana').style.display === 'none');
  }

  // ---------- 25/9/2026: "Cargar tratamiento" grupal vs individual --
  // disponible en los 3 establecimientos, con o sin flag ----------
  const tabla = win.__tablaSanidad;
  chequear('"Cargar tratamiento (grupal)" tiene su nombre',
    doc.getElementById('btn-cargar-sanidad').textContent === '+ Cargar tratamiento (grupal)');
  chequear('"Cargar tratamiento individual" se muestra',
    doc.getElementById('btn-cargar-sanidad-individual').style.display !== 'none');

  // ---- grupal: la fila de caravana NO aparece, cantidad libre como siempre ----
  doc.getElementById('btn-cargar-sanidad').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(20);
  chequear('grupal: la fila de caravana queda oculta',
    doc.getElementById('sc-fila-caravana').style.display === 'none');
  chequear('grupal: la cantidad es editable', !doc.getElementById('sc-cantidad').readOnly);
  doc.getElementById('sc-cantidad').value = '70';
  doc.getElementById('sc-producto1-otro').value = 'FORCER';
  doc.getElementById('sc-dosis1').value = '20';
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(30);
  const porLote = (servidor.filas[tabla]||[])[0];
  chequear('grupal: una carga por lote guarda bien', !!porLote && porLote.cantidad === 70);
  chequear('grupal: la caravana va en null', porLote && porLote.caravana === null);
  chequear('grupal: sin_caravana va en null (ni se preguntó)', porLote && porLote.sin_caravana === null);

  // ---- individual: fila de caravana visible, cantidad fija en 1 ----
  doc.getElementById('btn-cargar-sanidad-individual').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(20);
  chequear('individual: la fila de caravana se muestra',
    doc.getElementById('sc-fila-caravana').style.display !== 'none');
  chequear('individual: la cantidad arranca en 1', doc.getElementById('sc-cantidad').value === '1');
  chequear('individual: la cantidad queda de solo lectura', doc.getElementById('sc-cantidad').readOnly);

  doc.getElementById('sc-caravana').value = '37620042';
  doc.getElementById('sc-caravana').dispatchEvent(new win.Event('change', {bubbles:true}));
  await esperar(40);
  const quien = doc.getElementById('sc-caravana-quien').textContent;
  if(habilitado){
    // Solo La Vuelta tiene ese animal en el padron de prueba.
    chequear('al tipear la caravana dice de quien es', /Novillito 1-2/.test(quien));
    chequear('y avisa si ese animal esta en carencia', /NO APTO/.test(quien));
  } else {
    // Maria Laura/Pone Chico no tienen padron propio -- "quien es" no
    // encuentra nada, pero eso no impide cargar la caravana (mas abajo).
    chequear('sin padron, "quien es" avisa que no esta (no rompe ni inventa)',
      /no está en el padrón/.test(quien));
  }

  // Sin caravana Y sin confirmar "no tiene" -> bloquea.
  doc.getElementById('sc-caravana').value = '';
  doc.getElementById('sc-caravana').dispatchEvent(new win.Event('change', {bubbles:true}));
  doc.getElementById('sc-producto1-otro').value = 'MEXIVER';
  doc.getElementById('sc-dosis1').value = '9';
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(30);
  chequear('individual sin caravana ni confirmacion no guarda', (servidor.filas[tabla]||[]).length === 1);

  doc.getElementById('sc-caravana').value = '37620042';
  doc.getElementById('sc-caravana').dispatchEvent(new win.Event('change', {bubbles:true}));
  await esperar(40);
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(30);
  const conCaravana = (servidor.filas[tabla]||[])[1];
  chequear('individual con caravana guarda', !!conCaravana);
  chequear('individual: cantidad queda en 1 aunque el campo estuviera bloqueado',
    conCaravana && conCaravana.cantidad === 1);
  chequear('la caravana viaja en el insert', conCaravana && conCaravana.caravana === '37620042');
  chequear('sin_caravana va en false (se cargo una real)', conCaravana && conCaravana.sin_caravana === false);

  // ---- "Este animal no tiene caravana": deja constancia y permite guardar ----
  doc.getElementById('btn-cargar-sanidad-individual').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(20);
  chequear('el campo se limpia al reabrir', doc.getElementById('sc-caravana').value === '');
  doc.getElementById('sc-sin-caravana').checked = true;
  doc.getElementById('sc-sin-caravana').dispatchEvent(new win.Event('change', {bubbles:true}));
  chequear('tildar "no tiene" bloquea el campo de caravana', doc.getElementById('sc-caravana').disabled);
  chequear('y confirma en el aviso', /no tiene caravana/.test(doc.getElementById('sc-caravana-quien').textContent));
  doc.getElementById('sc-producto1-otro').value = 'IVOMEC';
  doc.getElementById('sc-dosis1').value = '2';
  doc.getElementById('sc-guardar').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(30);
  const sinCaravana = (servidor.filas[tabla]||[])[2];
  chequear('"no tiene caravana" guarda igual', !!sinCaravana);
  chequear('la caravana queda en null', sinCaravana && sinCaravana.caravana === null);
  chequear('sin_caravana queda en true (constancia explicita)', sinCaravana && sinCaravana.sin_caravana === true);
}

async function probarSinSenal(archivo){
  console.log('\n=== ' + archivo + ' (sin señal) ===');
  const servidor = crearServidor({ sinSenal: true });
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  doc.getElementById('btn-caravana').dispatchEvent(new win.Event('click', {bubbles:true}));
  doc.getElementById('cv-numero').value = '57179343';
  doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', {bubbles:true}));
  await esperar(40);
  const txt = doc.getElementById('cv-resultado').textContent;
  chequear('sin señal avisa en vez de romper', /No se pudo consultar/.test(txt));
  chequear('y no muestra ningun animal', !/Vaquillona/.test(txt));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('uso: node probar_caravana.js <archivo.html>...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  const laVuelta = archivos.find(a => /la-vuelta-movil[\\/]/.test(a) || /la_vuelta_movil/.test(a));
  if(laVuelta) await probarSinSenal(laVuelta);
  console.log('\n' + (fallas ? fallas + ' PROBLEMA(S)' : 'todo bien'));
  process.exit(fallas ? 1 : 0);
})();
