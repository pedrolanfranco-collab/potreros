/*
 * Prueba: fase reproductiva (tacto y DAO, sin IATF) en la PC de La Vuelta (CONFIG.reproduccion).
 *
 * 3/11/2026, a pedido de Pedro. La PC (repro.py, carpeta del lector XRS2) publica en
 * animales_caravana.repro / estado_repro / repro_fecha; la app SOLO LEE.
 *
 * Lo que se verifica:
 *  - El botón "🐄 Reproducción" está solo en la PC de La Vuelta; en las demás variantes no hay
 *    botón ni ventana, y la ficha de caravana no muestra nada reproductivo (la móvil de La Vuelta
 *    comparte el flag, pero no la pantalla).
 *  - La consulta pide solo lo que usa, por establecimiento, y pagina de a 1000.
 *  - Tactos y DAO: resumen por sesión con porcentajes; Cruces: DAO contra el último tacto posterior (el valor de control real: 44 ciclando ->
 *    20 grande + 10 media + 14 vacías).
 *  - Texto de afuera escapado; sin la columna (antes del ALTER TABLE) lo dice sin romperse.
 *  - La ficha de caravana muestra el estado y la línea de tiempo.
 *  - IATF NO entra (Pedro pidió solo tacto y DAO): aunque el padrón traiga eventos IATF, no hay
 *    pestaña, ni sesiones, ni renglones en la ficha, y un estado IATF_* se reemplaza por el último
 *    tacto o DAO.
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

async function levantar(archivo, servidor){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent)
    .filter(Boolean).join('\n');
  try {
    win.eval(codigo + '\n;window.__cfg = CONFIG;');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

const REPRO_LV = [];
function an(id8, repro, extra){ return Object.assign({ id8, categoria: 'Vaquillona', estado_vida: 'ACTIVO',
  estado_repro: null, repro_fecha: null, repro }, extra || {}); }
// 44 ciclando en el DAO -> 20 grande, 10 media, 14 vacías en el tacto final (valor de control)
for(let i = 0; i < 44; i++){
  const r = i < 20 ? 'PRENEZ_GRANDE' : i < 30 ? 'PRENEZ_MEDIA' : 'VACIA';
  REPRO_LV.push(an('LV' + String(i).padStart(3, '0'), [
    { f: '2025-10-26', t: 'DAO', e: '', r: 'CICLANDO', p: '', s: '969_PALPACION', o: '12' },
    { f: '2026-06-11', t: 'IATF', e: 'D0', r: '', p: 'BOVISAN T SE + BENZOATO HC', s: '1089_DIA_1_IATF', o: '8' },
    { f: '2026-06-20', t: 'IATF', e: 'IA', r: '', p: '', s: '1090_IATF', o: '' },
    { f: '2026-08-24', t: 'TACTO', e: '', r: r, p: '', s: '1116_TACTO', o: '12' }],
    { estado_repro: r, repro_fecha: '2026-08-24' }));
}
for(let i = 0; i < 14; i++)       // 14 en anestro superficial; 4 de ellos sin IA
  REPRO_LV.push(an('AN' + i, [
    { f: '2025-10-26', t: 'DAO', e: '', r: 'ANESTRO_SUP', p: '', s: '969_PALPACION', o: '' },
    { f: '2026-06-11', t: 'IATF', e: 'D0', r: '', p: 'BOVISAN T SE + BENZOATO HC', s: '1089_DIA_1_IATF', o: '8' }].concat(
      i < 10 ? [{ f: '2026-06-20', t: 'IATF', e: 'IA', r: '', p: '', s: '1090_IATF', o: '' }] : [])));
REPRO_LV.push(an('XSS1', [{ f: '2026-08-24', t: 'TACTO', e: '', r: 'VACIA', p: '', s: '<img src=x onerror="window.__inyectado=1">', o: '' }]));
REPRO_LV.push(an('RARO1', [{ f: '2026-08-24', t: 'TACTO', e: '', r: 'RARO', p: '', s: '1116_TACTO', o: '' }]));

function crearServidor(modo){
  const padron = [];
  for(const e of ['la_vuelta', 'maria_laura'])
    for(const a of REPRO_LV) padron.push(Object.assign({ establecimiento: e }, a, e === 'maria_laura' ? { id8: 'ml' + a.id8 } : {}));
  if(modo.muchos) for(let i = 0; i < 1200; i++) padron.push(an('M' + i, [{ f: '2026-09-01', t: 'TACTO', e: '', r: 'VACIA', p: '', s: 'MUCHOS', o: '' }], { establecimiento: 'la_vuelta' }));
  const filas = { animales_caravana: padron, sanidad_carga: [], eventos_sync: [], productos_catalogo: [] };
  const consultas = [];
  return {
    consultas, filas,
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [], _desde: 0, _hasta: 1e9, _cols: '*',
          insert(){ return Promise.resolve({ error: null }); },
          upsert(){ return Promise.resolve({ error: null }); },
          delete(){ return q; },
          select(c){ q._cols = c; return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          not(col, op, val){ q._not = col; q._filtros.push(r => r[col] != null); return q; },
          gt(){ return q; }, gte(){ return q; }, order(){ return q; }, limit(){ return q; }, in(){ return q; },
          range(a, b){ q._desde = a; q._hasta = b; return q; },
          then(res){
            if(tabla === 'animales_caravana' && q._not === 'repro'){
              consultas.push({ cols: q._cols, desde: q._desde });
              if(modo.sinColumna) return Promise.resolve(res({ data: null,
                error: { code: '42703', message: 'column animales_caravana.repro does not exist' } }));
            }
            const data = (filas[tabla] || []).filter(r => q._filtros.every(f => f(r))).slice(q._desde, q._hasta + 1);
            return Promise.resolve(res({ data, error: null }));
          }
        };
        return q;
      } };
    }
  };
}

const click = (win, id) => win.document.getElementById(id).dispatchEvent(new win.Event('click', { bubbles: true }));
const texto = (doc, id) => doc.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor({});
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const btn = doc.getElementById('btn-reproduccion');
  const esPcLv = win.__cfg.nombre === 'La Vuelta' && !!doc.getElementById('btn-verificar-stock');
  const ficha = win.fichaCaravanaHTML ? win.fichaCaravanaHTML(REPRO_LV[0]) : null;
  if(!esPcLv){
    chequear('sin el botón (no es la PC de La Vuelta)', !btn || btn.style.display === 'none');
    chequear('y la ventana no se ve', !doc.getElementById('modal-reproduccion') || doc.getElementById('modal-reproduccion').style.display === 'none');
    chequear('la ficha no muestra nada reproductivo', ficha === null || !/Reproducción/.test(ficha), String(ficha).slice(0, 80));
    return;
  }
  chequear('el botón está en Herramientas › Consultar',
    btn && btn.style.display === '' && btn.closest('.hg') && /Consultar/.test(btn.closest('.hg').textContent));
  chequear('la ficha muestra el estado y la línea de tiempo',
    /Reproducción<\/b> \(2\)/.test(ficha) && /Estado: <b>Preñez grande<\/b>/.test(ficha) && /969_PALPACION/.test(ficha) && /1116_TACTO/.test(ficha), ficha.slice(-400));
  chequear('la ficha no muestra IATF', !/IATF/.test(ficha) && !/BOVISAN/.test(ficha), ficha.slice(-400));
  const fichaIatf = win.fichaCaravanaHTML(an('EI', REPRO_LV[0].repro, { estado_repro: 'IATF_IA', repro_fecha: '2026-06-20' }));
  chequear('un estado IATF_* muestra el último tacto', /Estado: <b>Preñez grande<\/b> \(2026-08-24\)/.test(fichaIatf) && !/IATF/.test(fichaIatf), fichaIatf.slice(0, 300));
  chequear('un animal con solo IATF no agrega nada',
    !/Reproducción/.test(win.fichaCaravanaHTML(an('SOLO', [{ f: '2026-06-11', t: 'IATF', e: 'D0', r: '', p: 'X', s: 'S', o: '' }]))));
  chequear('la ficha de un animal sin datos no agrega nada', !/Reproducción/.test(win.fichaCaravanaHTML(an('SIN', null))));
  chequear('la ficha escapa el HTML de la sesión', !/<img src=x/.test(win.fichaCaravanaHTML(REPRO_LV[REPRO_LV.length - 2])));

  click(win, 'btn-reproduccion');
  await esperar(80);
  chequear('la ventana se abre', doc.getElementById('modal-reproduccion').style.display === 'flex');
  chequear('la consulta pide solo lo que usa y del primer tramo',
    servidor.consultas[0] && servidor.consultas[0].cols === 'id8,categoria,estado_vida,estado_repro,repro_fecha,repro' && servidor.consultas[0].desde === 0,
    JSON.stringify(servidor.consultas[0]));
  const opts = Array.from(doc.querySelectorAll('#repro-sesion option')).map(o => o.textContent);
  chequear('lista las sesiones de tacto y DAO, la más nueva arriba',
    opts.length >= 3 && /2026-08-24/.test(opts[0]) && opts.some(o => /DAO · 969_PALPACION · 58 animales/.test(o)), JSON.stringify(opts));
  const sel = doc.getElementById('repro-sesion');
  sel.value = Array.from(sel.options).find(o => /1116_TACTO/.test(o.textContent)).value;
  sel.dispatchEvent(new win.Event('change'));
  let r = texto(doc, 'repro-resumen');
  chequear('resumen de tacto: tactados, preñadas y vacías con %',
    /45 tactados/.test(r) && /preñadas 30 \(67%\)/.test(r) && /vacías 14 \(31%\)/.test(r) && /Preñez grande 20/.test(r), r);
  chequear('un valor desconocido se ve tal cual', /RARO/.test(r), r);
  sel.value = Array.from(sel.options).find(o => /969_PALPACION/.test(o.textContent)).value;
  sel.dispatchEvent(new win.Event('change'));
  r = texto(doc, 'repro-resumen');
  chequear('resumen de DAO: ciclando 44 (76%)', /58 con DAO/.test(r) && /ciclando 44 \(76%\)/.test(r) && /Anestro superficial 14/.test(r), r);
  chequear('una sesión con HTML no inyecta nada', doc.querySelectorAll('#modal-reproduccion img').length === 0 && win.__inyectado === undefined);

  chequear('sin pestaña ni lista de IATF',
    !doc.querySelector('[data-repro-tab="iatf"]') && !doc.getElementById('repro-tab-iatf') && !doc.getElementById('repro-iatf-sesion'));
  chequear('la ventana no nombra IATF', !/IATF/.test(doc.getElementById('modal-reproduccion').textContent));
  chequear('las sesiones de IATF no aparecen en la lista', !opts.some(o => /IATF/.test(o)), JSON.stringify(opts));

  doc.querySelector('[data-repro-tab="cruces"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  r = texto(doc, 'repro-cruces');
  chequear('Cruces: de 44 ciclando, 30 preñadas (20 grande, 10 media, 14 vacías)',
    /Ciclando 44 30 \(68%\)/.test(r) && /Preñez grande 20/.test(r) && /Preñez media 10/.test(r) && /Vacía 14/.test(r), r);
  chequear('Cruces: anestro superficial sin tacto posterior', /Anestro superficial 14 0 \(0%\) sin tacto posterior 14/.test(r), r);

  // sin la columna
  const s2 = crearServidor({ sinColumna: true });
  const o2 = await levantar(archivo, s2);
  click(o2.win, 'btn-reproduccion');
  await esperar(80);
  chequear('sin la columna lo dice y no se rompe',
    /No se pudo consultar/.test(o2.win.document.getElementById('repro-mensaje').textContent)
      && o2.win.document.getElementById('repro-cuerpo').style.display === 'none');

  // más de 1000 filas: pagina
  const s3 = crearServidor({ muchos: true });
  const o3 = await levantar(archivo, s3);
  click(o3.win, 'btn-reproduccion');
  await esperar(150);
  chequear('pagina de a 1000', s3.consultas.length >= 2 && s3.consultas[1].desde === 1000, JSON.stringify(s3.consultas));
  chequear('y no pierde animales', Array.from(o3.win.document.querySelectorAll('#repro-sesion option')).some(o => /MUCHOS · 1200 animales/.test(o.textContent)));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.log('uso: node tests/probar_reproduccion.js <index.html>...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log(fallas ? '\n' + fallas + ' FALLA(S)' : '\ntodo bien');
  process.exit(fallas ? 1 : 0);
})();
