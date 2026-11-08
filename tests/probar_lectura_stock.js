/*
 * Prueba: "📋 Lecturas vs stock" (8/11/2026, a pedido de Pedro) en la PC de La Vuelta y María Laura
 * (CONFIG.lecturaStock). Lee sesiones_baston (la escribe el Lector; la app SOLO LEE) y compara cada
 * sesión con el stock en vivo del potrero. Datos inventados; nada se escribe en Supabase.
 *
 * Lo que se verifica: el botón solo está en las PC con el flag (no en Pone Chico ni en móviles); lista
 * las sesiones del establecimiento, la más nueva arriba; coincide; faltan N con sus caravanas; leyó de
 * más; sin comparar con motivo; potrero inexistente; mayúsculas del potrero; Ovejas y Caballos no
 * cuentan; texto de afuera escapado; error de la tabla sin romperse; pagina de a 1000.
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
    win.eval(codigo + '\n;window.__cfg = CONFIG;\n;window.__est = function(){ return estado; };');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

const click = (win, id) => win.document.getElementById(id).dispatchEvent(new win.Event('click', { bubbles: true }));
const texto = (doc, id) => doc.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ESTABLECIMIENTO_DE = archivo => /maria-laura/.test(archivo) ? 'maria_laura' : 'la_vuelta';
const POTRERO = { la_vuelta: '13', maria_laura: 'Casco' };
function elegir(win, valor){
  const sel = win.document.getElementById('lecturas-sesion');
  sel.value = valor;
  sel.dispatchEvent(new win.Event('change'));
}

// Sesiones inventadas, ya en el orden que devuelve la consulta (fecha descendente).
function sesion(est, s, extra){
  return Object.assign({ establecimiento: est, sesion: s, fecha: '2026-11-05', archivo: '1200_VAQ.csv',
    potrero: POTRERO[est], comparado: true, motivo: null, leidos: 20,
    por_categoria: { Vacas: 12, Vaquillona: 8 }, faltan: [] }, extra || {});
}
function sesionesDe(est){
  return [
    sesion(est, 'S1'),
    sesion(est, 'S2', { fecha: '2026-11-04', archivo: '1199_FALTAN.csv', leidos: 18,
      por_categoria: { Vacas: 12, Vaquillona: 6 },
      faltan: [{ id8: '90000001', c: 'Vaquillona' }, { id8: '90000002', c: 'Vaquillona' }] }),
    sesion(est, 'S3', { fecha: '2026-11-03', archivo: '1198_DE_MAS.csv', leidos: 22, por_categoria: { Vacas: 14, Vaquillona: 8 } }),
    sesion(est, 'S4', { fecha: '2026-11-02', archivo: '1197_SIN.csv', comparado: false, potrero: null,
      motivo: '<b>sin potrero</b>', leidos: 9, por_categoria: null, faltan: null }),
    sesion(est, 'S5', { fecha: '2026-11-01', archivo: '1196_NO.csv', potrero: 'NO EXISTE', leidos: 3 }),
    sesion(est, 'S6', { fecha: '2026-10-31', archivo: '1195_MAYUS.csv', potrero: POTRERO[est].toUpperCase() }),
    sesion(est, 'S7', { fecha: '2026-10-30', archivo: '<img src=x onerror="window.__inyectado=1">', leidos: 1,
      por_categoria: { '<img src=x>': 1 } })
  ];
}

function crearServidor(modo){
  const filas = { sesiones_baston: [], animales_caravana: [], sanidad_carga: [], eventos_sync: [], productos_catalogo: [] };
  filas.sesiones_baston.push(...sesionesDe(modo.est));
  // una sesion de OTRO campo, la mas nueva: no debe aparecer
  filas.sesiones_baston.unshift({ establecimiento: 'otro_campo', sesion: 'OTRA', fecha: '2026-11-06', archivo: 'x.csv',
    potrero: POTRERO[modo.est], comparado: true, motivo: null, leidos: 5, por_categoria: {}, faltan: [] });
  if(modo.muchos) for(let i = 0; i < 1200; i++)
    filas.sesiones_baston.push(sesion(modo.est, 'M' + String(i).padStart(4, '0'), { fecha: '2026-09-01', archivo: 'M.csv' }));
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
          gt(){ return q; }, gte(){ return q; }, order(){ return q; }, limit(){ return q; }, in(){ return q; },
          range(a, b){ q._desde = a; q._hasta = b; return q; },
          then(res){
            if(tabla === 'sesiones_baston'){
              consultas.push({ cols: q._cols, desde: q._desde });
              if(modo.sinTabla) return Promise.resolve(res({ data: null,
                error: { code: '42P01', message: 'relation public.sesiones_baston does not exist' } }));
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

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const est = ESTABLECIMIENTO_DE(archivo);
  const servidor = crearServidor({ est });
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const btn = doc.getElementById('btn-lecturas-stock');
  const modal = doc.getElementById('modal-lecturas-stock');
  if(!(win.__cfg.lecturaStock && modal)){
    chequear('sin el botón ni la ventana (no es PC con el flag)',
      (!btn || btn.style.display === 'none') && (!modal || modal.style.display === 'none'));
    chequear('no consulta nada', servidor.consultas.length === 0, JSON.stringify(servidor.consultas));
    return;
  }
  chequear('el botón está en Herramientas › Consultar', btn.style.display === '' && /Consultar/.test(btn.closest('.hg').textContent));

  // stock del potrero: vacas y vaquillonas cuentan; ovejas y caballos no
  const P = POTRERO[est];
  win.__est().potreros[P].animales = { 'Vacas||': 12, 'Vaquillona||': 8, 'Ovejas||': 30, 'Caballos||': 5 };

  click(win, 'btn-lecturas-stock');
  await esperar(80);
  chequear('la ventana se abre', modal.style.display === 'flex');
  chequear('la consulta pide las columnas y el primer tramo',
    servidor.consultas[0] && servidor.consultas[0].cols === 'sesion,fecha,archivo,potrero,comparado,motivo,leidos,por_categoria,faltan' && servidor.consultas[0].desde === 0,
    JSON.stringify(servidor.consultas[0]));
  const sel = doc.getElementById('lecturas-sesion');
  const opts = Array.from(sel.options).map(o => o.textContent);
  chequear('lista las sesiones del campo, la más nueva arriba, sin las de otro campo',
    opts.length === 7 && /2026-11-05 · 1200_VAQ · 20 leídos/.test(opts[0]) && !opts.some(o => /OTRA|2026-11-06/.test(o)), JSON.stringify(opts));

  const textos = [];
  const pintar = (id) => { elegir(win, id); const r = texto(doc, 'lecturas-resumen'); textos.push(r); return r; };
  let r = pintar('S1');
  chequear('sesión que coincide: leyó 20 de 20 y no cuenta ovejas ni caballos',
    /Leyó 20 de 20 en el potrero/.test(r) && /✅ coincide/.test(r) && !/Ovejas|Caballos/.test(r), r);

  r = pintar('S2');
  chequear('con faltantes: muestra faltan 2 y las caravanas',
    /Leyó 18 de 20/.test(r) && /⚠ faltan 2/.test(r) && /90000001/.test(r) && /90000002/.test(r), r);
  chequear('con faltantes: la diferencia de vaquillonas se ve (6 contra 8, -2)', /Vaquillona 6 8 -2/.test(r), r);

  r = pintar('S3');
  chequear('leyó de más: muestra "leyó 2 más" y no "faltan"',
    /Leyó 22 de 20/.test(r) && /⚠ leyó 2 más que el stock/.test(r) && !/faltan/.test(r), r);

  r = pintar('S4');
  chequear('sin comparar: dice el motivo y no compara', /No se pudo comparar: /.test(r) && !/Leyó/.test(r), r);
  chequear('sin comparar: el motivo no trae HTML', doc.getElementById('lecturas-resumen').querySelector('b') === null);

  r = pintar('S5');
  chequear('potrero inexistente: lo dice y no compara', /el potrero NO EXISTE no existe en la app/.test(r) && !/Leyó/.test(r), r);

  r = pintar('S6');
  chequear('potrero con otra mayúscula: compara igual', /Leyó 20 de 20/.test(r) && /✅ coincide/.test(r), r);

  pintar('S7');
  chequear('texto de afuera escapado: no inyecta ni crea elementos',
    doc.querySelectorAll('#modal-lecturas-stock img').length === 0 && win.__inyectado === undefined);
  chequear('ningún texto muestra "null" ni "undefined"', textos.every(t => !/null|undefined/.test(t)), textos.join(' | '));

  // sin la tabla (antes del CREATE TABLE)
  const s2 = crearServidor({ est, sinTabla: true });
  const o2 = await levantar(archivo, s2);
  click(o2.win, 'btn-lecturas-stock');
  await esperar(80);
  chequear('sin la tabla lo dice y no se rompe',
    /No se pudo consultar/.test(o2.win.document.getElementById('lecturas-mensaje').textContent)
      && o2.win.document.getElementById('lecturas-cuerpo').style.display === 'none');

  // más de 1000 filas: pagina
  const s3 = crearServidor({ est, muchos: true });
  const o3 = await levantar(archivo, s3);
  click(o3.win, 'btn-lecturas-stock');
  await esperar(150);
  chequear('pagina de a 1000', s3.consultas.length >= 2 && s3.consultas[1].desde === 1000, JSON.stringify(s3.consultas));
  chequear('y no pierde sesiones', Array.from(o3.win.document.querySelectorAll('#lecturas-sesion option')).some(o => o.value === 'M1199'));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.log('uso: node tests/probar_lectura_stock.js <index.html>...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log(fallas ? '\n' + fallas + ' FALLA(S)' : '\ntodo bien');
  process.exit(fallas ? 1 : 0);
})();
