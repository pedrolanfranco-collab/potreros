/*
 * Prueba: la ficha de la caravana muestra el RODEO y la NOTA.
 *
 * 13/10/2026, a pedido de Pedro. El bastón anota un rodeo y una nota en cada
 * lectura; la PC (animales.py / publicar_animales.py, carpeta del lector XRS2)
 * publica en animales_caravana el de la ULTIMA lectura que los trae, con la
 * fecha de esa lectura (columnas rodeo, rodeo_fecha, nota, nota_fecha). La app
 * SOLO LEE: esto prueba que la ficha los pinta, y pinta bien.
 *
 * Lo que se verifica, y por que importa:
 *  - Aparecen con su fecha entre parentesis y justo debajo del potrero.
 *  - Un animal sin rodeo o sin nota NO muestra una fila vacia ni "null" /
 *    "undefined" (la mayoria de las lecturas no los traen).
 *  - Sin fecha, el dato se muestra igual y sin parentesis vacios.
 *  - Es un texto que viene de afuera: va escapado. Una nota con HTML no puede
 *    inyectar nada en la ficha.
 *  - Una tabla que todavia no tiene las columnas (antes del ALTER TABLE) deja
 *    la ficha como estaba.
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

// Cinco animales APTO (para que la ficha no dependa de la fecha de hoy), con
// las combinaciones de rodeo / nota que pueden llegar de la tabla.
const BASE = { estado_carencia: 'APTO', fecha_apto: null, producto_carencia: null,
  proximo_tratamiento: null, ultimo_peso: null, peso_fecha: null,
  ultima_lectura: '2026-10-13', sexo: 'HEMBRA', categoria: 'Vaca', gen: '7',
  propietario: 'FIDEICOMISO', potrero: '23' };
const PADRON = [
  Object.assign({}, BASE, { id8: '10000001', ide: '858000010000001',
    rodeo: 'COLA', rodeo_fecha: '2026-10-13', nota: '2 BOPRIVA', nota_fecha: '2025-10-23' }),
  Object.assign({}, BASE, { id8: '10000002', ide: '858000010000002',
    rodeo: 'M5', rodeo_fecha: '2026-09-01', nota: null, nota_fecha: null }),
  Object.assign({}, BASE, { id8: '10000003', ide: '858000010000003',
    rodeo: null, rodeo_fecha: null, nota: null, nota_fecha: null }),
  Object.assign({}, BASE, { id8: '10000004', ide: '858000010000004',
    rodeo: 'TILICO', rodeo_fecha: null, nota: 'FALLADA', nota_fecha: null }),
  Object.assign({}, BASE, { id8: '10000005', ide: '858000010000005',
    rodeo: null, rodeo_fecha: null, nota: '<img src=x onerror="window.__inyectado=1">', nota_fecha: '2026-10-01' }),
];
// Una tabla de antes del ALTER TABLE: sin las cuatro columnas.
const SIN_COLUMNAS = Object.assign({}, BASE, { id8: '10000006', ide: '858000010000006' });

function crearServidor(){
  const padron = [];
  for(const e of ['la_vuelta', 'maria_laura']){
    for(const a of PADRON.concat([SIN_COLUMNAS])) padron.push(Object.assign({}, a, { establecimiento: e }));
  }
  const filas = { animales_caravana: padron, sanidad_carga: [], eventos_sync: [],
    productos_catalogo: [] };
  return {
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          insert(){ return Promise.resolve({ error: null }); },
          select(){ return q; },
          eq(col, val){ q._filtros.push(r => r[col] === val); return q; },
          gt(){ return q; }, gte(){ return q; }, order(){ return q; }, limit(){ return q; },
          range(){ return q; }, in(){ return q; },
          then(res){
            const data = (filas[tabla] || []).filter(r => q._filtros.every(f => f(r)));
            return Promise.resolve(res({ data, error: null }));
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

async function buscar(win, id8){
  const doc = win.document;
  doc.getElementById('cv-numero').value = id8;
  doc.getElementById('cv-buscar').dispatchEvent(new win.Event('click', { bubbles: true }));
  await esperar(40);
  return doc.getElementById('cv-resultado');
}

// [etiqueta, valor] de cada fila de la tabla de la ficha, en orden
function filasFicha(caja){
  return Array.from(caja.querySelectorAll('table tr')).slice(0, 14).map(tr => {
    const td = tr.querySelectorAll('td');
    return [td[0] && td[0].textContent.trim(), td[1] && td[1].textContent.trim()];
  });
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const servidor = crearServidor();
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  if(!win.__cfg.caravanasHabilitado){
    chequear('sin padron publicado no hay buscador (nada que probar)',
      win.document.getElementById('btn-caravana').style.display === 'none');
    return;
  }
  const doc = win.document;
  doc.getElementById('btn-caravana').dispatchEvent(new win.Event('click', { bubbles: true }));

  let caja = await buscar(win, '10000001');
  let f = filasFicha(caja);
  const get = (k) => (f.find(x => x[0] === k) || [])[1];
  chequear('Rodeo con la fecha de la lectura entre parentesis', get('Rodeo') === 'COLA (2026-10-13)', JSON.stringify(f));
  chequear('Nota con la fecha de la lectura entre parentesis', get('Nota') === '2 BOPRIVA (2025-10-23)', JSON.stringify(f));
  const orden = f.map(x => x[0]);
  chequear('van justo debajo del potrero',
    orden.indexOf('Potrero') >= 0 && orden[orden.indexOf('Potrero') + 1] === 'Rodeo'
      && orden[orden.indexOf('Potrero') + 2] === 'Nota', orden.join(' | '));
  chequear('lo que ya habia sigue estando',
    get('Categoría') === 'Vaca' && get('Potrero') === '23' && get('Última lectura') === '2026-10-13', JSON.stringify(f));

  caja = await buscar(win, '10000002');
  f = filasFicha(caja);
  chequear('con rodeo y sin nota: muestra el rodeo y NO una fila de nota',
    get('Rodeo') === 'M5 (2026-09-01)' && get('Nota') === undefined, JSON.stringify(f));

  caja = await buscar(win, '10000003');
  f = filasFicha(caja);
  chequear('sin rodeo ni nota: ninguna de las dos filas', get('Rodeo') === undefined && get('Nota') === undefined, JSON.stringify(f));
  chequear('y no aparece "null" ni "undefined" en ningun lado',
    !/null|undefined/.test(caja.textContent), caja.textContent);

  caja = await buscar(win, '10000004');
  f = filasFicha(caja);
  chequear('sin fecha: se muestra igual y sin parentesis vacios',
    get('Rodeo') === 'TILICO' && get('Nota') === 'FALLADA', JSON.stringify(f));

  caja = await buscar(win, '10000005');
  f = filasFicha(caja);
  // El texto que viene de afuera entra por limpiarTextoRemoto() (saca < y >) y se
  // pinta con esc(): se ve como texto y no puede armar ningun elemento.
  chequear('una nota con HTML se muestra como texto, sin < ni >',
    /img src=x/.test(get('Nota') || '') && !/[<>]/.test(get('Nota') || ''), JSON.stringify(f));
  chequear('y no inyecta ningun elemento ni ejecuta nada',
    caja.querySelectorAll('img').length === 0 && win.__inyectado === undefined);

  caja = await buscar(win, '10000006');
  f = filasFicha(caja);
  chequear('una tabla sin las columnas nuevas deja la ficha como estaba',
    get('Rodeo') === undefined && get('Nota') === undefined && get('Potrero') === '23', JSON.stringify(f));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('uso: node probar_ficha_rodeo_nota.js <archivo.html>...'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' PROBLEMA(S)' : 'todo bien'));
  process.exit(fallas ? 1 : 0);
})();
