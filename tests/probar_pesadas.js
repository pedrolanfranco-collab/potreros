/*
 * Prueba: gestion de pesadas -- historial por animal en la ficha de caravana y
 * resumen por lote ("⚖️ Pesadas").
 *
 * 2/10/2026. La PC arma las pesadas (animales.py) y las publica en
 * animales_caravana.pesadas (jsonb). La app SOLO LEE y no recalcula nada.
 *
 * Lo que se verifica, y por que importa:
 *  - La ficha muestra el historial y la ganancia, y explica POR QUE no hay
 *    ganancia cuando no la hay (una sola pesada / pesadas muy seguidas), en
 *    vez de callar.
 *  - El lote es la SESION del baston, no fecha+potrero: el 69% de las pesadas
 *    historicas tiene el potrero vacio.
 *  - Promedio / mayor / menor NO incluyen las pesadas sospechosas, y se avisa.
 *  - La proporcion se cuenta contra el stock de la app, y si no hay con que
 *    compararla dice "—" en vez de inventar un porcentaje.
 *  - La consulta pagina (PostgREST corta en 1000 filas sin avisar).
 *  - Gateado por CONFIG.pesadasHistorial: apagado, la ficha es la de siempre.
 *  - Todo lo que viene de Supabase se escapa.
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

/* ---------- datos de prueba ---------- */
const S1 = { f:'2026-03-02', a:'1043_VAQ_G4', o:'13' };
const S2 = { f:'2026-04-01', a:'1051_VAQ_GG', o:'EMBARCADER6' };   // potrero que no es de la app
function an(id8, categoria, pesadas, extra){
  return Object.assign({ establecimiento:'la_vuelta', id8, categoria, sexo:'HEMBRA',
    propietario:'PEDRO', potrero:'13', estado_carencia:'APTO', estado_vida:'ACTIVO',
    ultimo_peso:null, peso_fecha:null, pesadas, ganancia_diaria:null,
    pesadas_totales: pesadas ? pesadas.length : 0 }, extra || {});
}
const p = (S, kg, g, extra) => Object.assign({ f:S.f, p:kg, g:(g === undefined ? null : g), s:false, o:S.o, c:'Vaquillona', a:S.a }, extra || {});

// Los id8 reales empiezan con 9 para quedar DESPUES de los 1100 rellenos al
// ordenar por id8: la sesion S1 cruza la frontera de la pagina de 1000 filas.
const REALES = [
  // S1 (3 buenas: 300, 320, 280 -> promedio 300; una sospechosa de 1000 que NO entra)
  an('90000001', 'Vaquillona', [p(S1, 300, null), p(S2, 350, 0.8)], { ganancia_diaria: 0.8 }),
  an('90000002', 'Vaquillona', [p(S1, 320, 0.5)], { ganancia_diaria: 0.5 }),
  an('90000003', 'Vaquillona', [p(S1, 280, 0.7)], { ganancia_diaria: 0.7 }),
  an('90000004', 'Vaca',       [p(S1, 1000, null, { s:true, c:'Vaca' })]),
  // un animal con UNA sola pesada y uno sin pesadas
  an('90000005', 'Vaquillona', [p(S2, 410, null)]),
  an('90000006', 'Vaquillona', null),
  // texto hostil en la categoria
  an('90000007', '<img src=x onerror=alert(1)>', [p(S2, 390, null, { c:'<img src=x onerror=alert(1)>' })]),
  // dos pesadas muy seguidas: sin ganancia, y la ficha lo tiene que explicar
  an('90000008', 'Vaquillona', [p(S1, 301, null), p(S2, 305, null)]),
];

function crearServidor(opciones){
  const cfg = opciones || {};
  const filas = [];
  for(let i = 0; i < 1100; i++){
    filas.push(an(String(10000000 + i), 'Vaquillona', null));
  }
  for(const a of REALES) filas.push(a);
  // Maria Laura tambien trae los datos: con el flag apagado no se tienen que ver.
  for(const a of REALES) filas.push(Object.assign({}, a, { establecimiento:'maria_laura' }));
  const consultas = [];
  return {
    consultas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _orden: null, _rango: null,
          select(){ return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          order(col){ q._orden = col; return q; },
          limit(){ return q; },
          range(d, h){ q._rango = [d, h]; return q; },
          then(res){
            if(tabla === 'animales_caravana' && cfg.sinSenal){
              return Promise.resolve(res({ data:null, error:{ message:'Failed to fetch' } }));
            }
            let data = (tabla === 'animales_caravana' ? filas : []).filter(r => q._filtros.every(f => f(r)));
            if(q._orden) data = data.slice().sort((x, y) => String(x[q._orden]).localeCompare(String(y[q._orden])));
            if(q._rango){ consultas.push(q._rango.join('-')); data = data.slice(q._rango[0], q._rango[1] + 1); }
            return Promise.resolve(res({ data, error:null }));
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
      '\n;window.__cfg = CONFIG;');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r=>setTimeout(r,60));
  return { win, errores };
}

const esperar = (ms) => new Promise(r=>setTimeout(r,ms));
const click = (win, el) => el.dispatchEvent(new win.Event('click', {bubbles:true}));
const cambiar = (win, el, v) => { el.value = v; el.dispatchEvent(new win.Event('change', {bubbles:true})); };

async function buscarFicha(win, id8){
  const doc = win.document;
  click(win, doc.getElementById('btn-caravana'));
  doc.getElementById('cv-numero').value = id8;
  click(win, doc.getElementById('cv-buscar'));
  await esperar(40);
  return doc.getElementById('cv-resultado');
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const activo = !!win.__cfg.pesadasHistorial;
  const boton = doc.getElementById('btn-pesadas');
  const modal = doc.getElementById('modal-pesadas');

  if(!activo){
    // ---------- flag apagado: todo igual que antes ----------
    chequear('sin el flag no hay boton visible', !boton || boton.style.display === 'none');
    if(doc.getElementById('btn-caravana') && win.__cfg.caravanasHabilitado){
      const caja = await buscarFicha(win, '90000001');
      chequear('la ficha trae el animal', /Vaquillona/.test(caja.textContent));
      chequear('sin el flag la ficha NO muestra pesadas aunque la fila las traiga',
               !/Pesadas/.test(caja.textContent), caja.textContent);
    }
    return;
  }

  // ---------- el boton, solo donde existe el modal (PC y movil completo) ----------
  if(!modal){
    chequear('variante simple: sin boton ni modal de pesadas', !boton);
    return;
  }
  chequear('con el flag el boton se muestra', boton && boton.style.display !== 'none');

  // ---------- ficha: historial y ganancia ----------
  let caja = await buscarFicha(win, '90000001');
  let txt = caja.textContent;
  chequear('ficha: titulo de pesadas con la cantidad', /Pesadas\s*\(2\)/.test(txt), txt);
  chequear('ficha: ganancia promedio con coma y signo', /\+0,80 kg\/día/.test(txt), txt);
  chequear('ficha: lista las dos pesadas', /1043_VAQ_G4/.test(txt) && /1051_VAQ_GG/.test(txt), txt);
  chequear('ficha: muestra los kg sin decimales de mas', /300 kg/.test(txt) && !/300,0/.test(txt), txt);
  chequear('ficha: mas reciente primero', txt.indexOf('2026-04-01') < txt.indexOf('2026-03-02'), txt);

  caja = await buscarFicha(win, '90000005');
  txt = caja.textContent;
  chequear('una sola pesada: lo explica', /Una sola pesada válida/.test(txt), txt);

  caja = await buscarFicha(win, '90000008');
  txt = caja.textContent;
  chequear('pesadas muy seguidas: lo explica', /muy seguidas/.test(txt), txt);

  caja = await buscarFicha(win, '90000006');
  txt = caja.textContent;
  chequear('sin pesadas: no hay bloque ni "null"', !/Pesadas/.test(txt) && !/null|undefined/.test(txt), txt);

  caja = await buscarFicha(win, '90000007');
  chequear('texto hostil en la ficha: no inyecta elementos', !caja.querySelector('img'));
  click(win, doc.getElementById('caravana-cerrar'));

  // ---------- el stock que la app tiene hoy en el potrero 13 ----------
  const est = win.__est();
  est.potreros['13'].animales = { 'Vaquillona||': 12, 'Vaca||': 8 };

  // ---------- lote ----------
  servidor.consultas.length = 0;
  click(win, boton);
  await esperar(80);
  chequear('el modal se abre', modal.style.display === 'flex');
  chequear('pagina la consulta (1000 + resto)', servidor.consultas.length >= 2 && servidor.consultas[0] === '0-999', servidor.consultas.join(','));
  const ses = doc.getElementById('pe-sesion');
  const opciones = Array.from(ses.options).map(o => o.textContent);
  chequear('la sesion que cruza la pagina se arma completa', opciones.some(o => /1043_VAQ_G4/.test(o) && /5 animales/.test(o)), opciones.join(' | '));
  chequear('la mas reciente va primero', /1051_VAQ_GG/.test(opciones[0]), opciones.join(' | '));

  cambiar(win, ses, '2026-03-02|1043_VAQ_G4');
  await esperar(20);
  let r = doc.getElementById('pe-resumen').textContent;
  chequear('lote: 4 pesados (la sospechosa no cuenta)', /Animales pesados\s*4/.test(r), r);
  chequear('lote: promedio 300,3 kg', /Peso promedio\s*300,3 kg/.test(r), r);
  chequear('lote: mayor 320 con su caravana', /Mayor\s*320 kg · 90000002/.test(r), r);
  chequear('lote: menor 280 con su caravana', /Menor\s*280 kg · 90000003/.test(r), r);
  chequear('lote: ganancia promedio de los que tienen', /\+0,60 kg\/día \(2 animales\)/.test(r), r);
  chequear('lote: avisa de la pesada dudosa', /1 pesada dudosa/.test(r), r);
  chequear('lote: el potrero del baston coincide con el de la app y se sugiere',
           doc.getElementById('pe-potrero').value === '13', doc.getElementById('pe-potrero').value);
  chequear('proporcion contra el stock total del potrero: 4 de 20 (20%)', /4 de 20 \(20%\)/.test(r), r);

  cambiar(win, doc.getElementById('pe-categoria'), 'Vaquillona');
  r = doc.getElementById('pe-resumen').textContent;
  chequear('con categoria: 4 de 12 (33%)', /4 de 12 \(33%\)/.test(r), r);

  cambiar(win, doc.getElementById('pe-categoria'), '');
  cambiar(win, doc.getElementById('pe-potrero'), '');
  r = doc.getElementById('pe-resumen').textContent;
  chequear('sin potrero elegido: no inventa una proporcion', /elegí un potrero/.test(r) && !/%/.test(r), r);

  cambiar(win, ses, '2026-04-01|1051_VAQ_GG');
  await esperar(20);
  chequear('potrero del baston que no es de la app: no se sugiere nada', doc.getElementById('pe-potrero').value === '', doc.getElementById('pe-potrero').value);
  chequear('texto hostil en el lote: no inyecta elementos', !modal.querySelector('img'));
  cambiar(win, doc.getElementById('pe-potrero'), '13');
  cambiar(win, doc.getElementById('pe-categoria'), 'Vaca de invernada');
  r = doc.getElementById('pe-resumen').textContent;
  chequear('categoria que la app no tiene: nunca un 0% inventado', !/\b0%/.test(r), r);
  chequear('nada de "null"/"undefined" en el lote', !/null|undefined/.test(modal.textContent));

  click(win, doc.getElementById('pesadas-cerrar-x'));
  chequear('la X cierra el modal', modal.style.display === 'none');
}

async function probarSinSenal(archivo){
  console.log('\n=== ' + archivo + ' (sin señal) ===');
  const servidor = crearServidor({ sinSenal: true });
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  click(win, doc.getElementById('btn-pesadas'));
  await esperar(60);
  const txt = doc.getElementById('modal-pesadas').textContent;
  chequear('sin señal avisa en vez de romper', /No se pudo consultar/.test(txt), txt);
  chequear('y no deja el cuerpo a medias', doc.getElementById('pe-cuerpo').style.display === 'none');
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('uso: node probar_pesadas.js <archivo.html>...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  const conFlag = archivos.find(a => /la-vuelta-(pc|movil)[\\/]/.test(a));
  if(conFlag) await probarSinSenal(conFlag);
  console.log('\n' + (fallas ? fallas + ' PROBLEMA(S)' : 'todo bien'));
  process.exit(fallas ? 1 : 0);
})();
