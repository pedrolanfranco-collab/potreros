/*
 * Prueba: "⚠ Datos faltantes" de la PC (Herramientas › Consultar).
 *
 * 13/10/2026, a pedido de Pedro. Una lectura del bastón SIN categoría ya no tranca su
 * tratamiento: la PC (sanidad_puente.py, carpeta del lector XRS2) lo manda a Sanidad con
 * la categoría de la ficha del animal (o "Sin categoría") y publica en
 * animales_caravana.faltantes qué pasó con cada lectura. La app SOLO LEE esa lista.
 *
 * Lo que se verifica:
 *  - El botón está solo en la PC de La Vuelta (CONFIG.datosFaltantes) y muestra el número.
 *  - La ventana lista cada lectura (caravana, sesión corta, fecha, qué falta) con lo que
 *    pasó en Sanidad; las que necesitan algo de Pedro van marcadas.
 *  - Solo los últimos 60 días, la más nueva arriba, y solo del establecimiento.
 *  - Texto de afuera escapado: una sesión con HTML no inyecta nada.
 *  - Sin la columna (antes del ALTER TABLE) dice que no pudo, sin romperse.
 *  - El CSV trae una fila por lectura.
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
const diasAtras = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const HOY1 = diasAtras(1), HOY3 = diasAtras(3), VIEJA = diasAtras(70);
const PADRON = [
  { id8: '66047334', ide: '858000066047334', faltantes: [
    { f: HOY3, a: 'XRS2_3946_REFUGO_VENTA_2026-10-06', p: 'RICOVERM', k: null, falta: 'categoria', san: 'ficha', c: 'Terneras', m: '' }] },
  { id8: '61110983', ide: '858000061110983', faltantes: [
    { f: HOY3, a: 'XRS2_3946_REFUGO_VENTA_2026-10-06', p: 'RICOVERM', k: null, falta: 'categoria', san: 'sin', c: 'Sin categoría', m: '' }] },
  { id8: '37620127', ide: '858000037620127', faltantes: [
    { f: HOY1, a: 'XRS2_3946_LOTE_1_SET_2026-10-12', p: 'EON', k: null, falta: 'categoria', san: 'no',
      c: '', m: 'no pasó a Sanidad: falta confirmar la categoría \'Vaquillona\'' },
    { f: VIEJA, a: 'XRS2_3946_MUY_VIEJA_2026-08-01', p: '', k: 300, falta: 'categoria', san: '', c: '', m: '' }] },
  { id8: '50000001', ide: '', faltantes: [
    { f: HOY1, a: '<img src=x onerror="window.__inyectado=1">', p: '', k: 412, falta: 'categoria', san: '', c: '', m: '' }] },
  { id8: '70000001', ide: '858000070000001', faltantes: null },
];

function crearServidor(modo){
  const padron = [];
  for(const e of ['la_vuelta', 'maria_laura'])
    for(const a of PADRON) padron.push(Object.assign({ establecimiento: e, categoria: 'Vaca', potrero: '18',
      estado_carencia: 'APTO', estado_vida: 'ACTIVO' }, a, e === 'maria_laura' ? { id8: 'ml' + a.id8 } : {}));
  const filas = { animales_caravana: padron, sanidad_carga: [], eventos_sync: [], productos_catalogo: [] };
  const consultas = [];
  return {
    consultas,
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
            if(tabla === 'animales_caravana' && q._not === 'faltantes'){
              consultas.push(q._cols);
              if(modo.sinColumna) return Promise.resolve(res({ data: null,
                error: { code: '42703', message: 'column animales_caravana.faltantes does not exist' } }));
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

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const modo = {};
  const servidor = crearServidor(modo);
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const btn = doc.getElementById('btn-faltantes');
  // Por el establecimiento y la variante, no por el flag: una PC de La Vuelta sin el botón es una falla.
  const esPcLv = win.__cfg.nombre === 'La Vuelta' && !!doc.getElementById('btn-verificar-stock');
  if(!esPcLv){
    chequear('sin el botón (no es la PC de La Vuelta)', !btn || btn.style.display === 'none');
    chequear('y sin la ventana', !doc.getElementById('modal-faltantes') || doc.getElementById('modal-faltantes').style.display === 'none');
    return;
  }
  if(!btn){ chequear('existe el botón ⚠ Datos faltantes', false, 'no está'); return; }
  chequear('el botón está a la vista en Herramientas › Consultar',
    btn.style.display === '' && btn.closest('.hg') && /Consultar/.test(btn.closest('.hg').textContent));
  await esperar(4300);
  chequear('al rato del arranque el botón muestra cuántas hay (4, sin la de hace 70 días)',
    btn.textContent.trim() === '⚠ Datos faltantes (4)', btn.textContent);
  chequear('la consulta pide solo lo que usa', servidor.consultas[0] === 'id8,ide,faltantes', servidor.consultas[0]);

  click(win, 'btn-faltantes');
  await esperar(60);
  chequear('la ventana se abre con el total en el título',
    doc.getElementById('modal-faltantes').style.display === 'flex'
      && doc.getElementById('df-titulo').textContent === '⚠ Datos faltantes (4)', doc.getElementById('df-titulo').textContent);
  const filas = Array.from(doc.querySelectorAll('#df-tabla tbody tr'));
  const principales = filas.filter(tr => !tr.classList.contains('df-det'))
    .map(tr => Array.from(tr.cells).map(td => td.textContent.trim()));
  const detalles = filas.filter(tr => tr.classList.contains('df-det')).map(tr => tr.cells[1]);
  chequear('4 lecturas, cada una con su renglón de detalle', principales.length === 4 && detalles.length === 4, principales.length);
  chequear('la más nueva arriba', principales[0][2] === HOY1.slice(8, 10) + '/' + HOY1.slice(5, 7), JSON.stringify(principales));
  const fila = id => principales.findIndex(r => r[0] === id);
  const i = fila('66047334');
  chequear('caravana, sesión corta, fecha dd/mm y qué falta',
    i >= 0 && principales[i][1] === 'REFUGO_VENTA' && principales[i][2] === HOY3.slice(8, 10) + '/' + HOY3.slice(5, 7)
      && principales[i][3] === 'categoría', JSON.stringify(principales[i]));
  chequear('pasó con la ficha: lo dice y no va marcado',
    detalles[i].textContent === 'RICOVERM → pasó a Sanidad como Terneras (de la ficha)' && !detalles[i].classList.contains('df-ojo'),
    detalles[i].textContent);
  const j = fila('61110983');
  chequear('pasó como "Sin categoría": va marcado y dice dónde corregirla',
    /como "Sin categoría": corregila/.test(detalles[j].textContent) && detalles[j].classList.contains('df-ojo'), detalles[j].textContent);
  const k = fila('37620127');
  chequear('no pasó: va marcado con el motivo',
    /falta confirmar la categoría 'Vaquillona'/.test(detalles[k].textContent) && detalles[k].classList.contains('df-ojo'), detalles[k].textContent);
  const l = fila('50000001');
  chequear('una pesada sin producto: el peso, sin marca',
    detalles[l].textContent === 'pesada 412 kg, sin tratamiento' && !detalles[l].classList.contains('df-ojo'), detalles[l].textContent);
  chequear('lo de hace más de 60 días no está', !principales.some(r => /MUY_VIEJA/.test(r[1])));
  chequear('solo del establecimiento', !principales.some(r => /^ml/.test(r[0])));
  chequear('una sesión con HTML se ve como texto y no inyecta nada',
    doc.querySelectorAll('#df-tabla img').length === 0 && win.__inyectado === undefined && /img src=x/.test(principales[l][1]),
    principales[l][1]);

  // CSV
  let csv = null;
  win.Blob = class { constructor(partes){ csv = partes.join(''); } };
  chequear('el botón del CSV está a la vista', doc.getElementById('df-csv').style.display === '');
  click(win, 'df-csv');
  await esperar(20);
  const lineas = (csv || '').replace(/^﻿/, '').trim().split('\r\n');
  chequear('CSV: encabezado + una fila por lectura', lineas.length === 5 && /^caravana;eid;sesion;fecha;falta/.test(lineas[0]), lineas.length);
  chequear('CSV: la fila dice cómo pasó y con qué categoría',
    lineas.some(x => x.startsWith('66047334;858000066047334;XRS2_3946_REFUGO_VENTA_2026-10-06;' + HOY3 + ';categoria;RICOVERM;;paso con la ficha;Terneras;')),
    lineas.join(' | '));
  click(win, 'df-cerrar');
  chequear('Cerrar cierra', doc.getElementById('modal-faltantes').style.display === 'none');

  // Antes del ALTER TABLE: la columna no existe
  modo.sinColumna = true;
  click(win, 'btn-faltantes');
  await esperar(60);
  chequear('sin la columna: dice que no pudo consultar y no muestra tabla',
    /No se pudo consultar/.test(doc.getElementById('df-mensaje').textContent)
      && doc.getElementById('df-tabla-caja').style.display === 'none'
      && doc.getElementById('df-csv').style.display === 'none', doc.getElementById('df-mensaje').textContent);
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('uso: node probar_datos_faltantes.js <archivo.html>...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' PROBLEMA(S)' : 'todo bien'));
  process.exit(fallas ? 1 : 0);
})();
