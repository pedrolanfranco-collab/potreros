/*
 * Auditoría de seguridad (30/9/2026), falla 10: HTML / datos inválidos que
 * llegan por eventos_sync (la clave de Supabase es pública y las políticas
 * dejan insertar a cualquiera, así que cualquier persona puede mandar un
 * evento a todos los celulares).
 *
 * Qué se verifica, en las 11 apps:
 *  1. Un potrero_creado con HTML en el nombre no inyecta elementos ni
 *     atributos en la lista lateral ni en el autocompletado.
 *  2. esc() cubre datos viejos ya guardados (nombre con HTML puesto directo
 *     en POTREROS_GEO, como si viniera de un localStorage anterior al arreglo).
 *  3. Coordenadas inválidas (NaN, fuera de rango, pocas) no crean potrero.
 *  4. Cantidades que no son número / absurdas descartan el evento entero.
 *  5. punto_creado con tipo desconocido no rompe el render (TIPOS_PUNTO[x].icono).
 *  6. Texto de un ingreso con HTML queda sin < > y no inyecta nada en el detalle.
 *  7. Un evento legítimo sigue aplicándose igual que antes (no se rompió nada).
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

// Servidor simulado: cualquier consulta encadenada devuelve las filas de la tabla.
function crearServidor(eventos){
  return {
    createClient(){
      return { from(tabla){
        // Respeta .gt('creado_en', x) como el servidor real: sin eso, la sincronización
        // automática del arranque y la explícita de la prueba aplicarían dos veces lo mismo.
        let desde = null;
        const q = new Proxy({}, {
          get(t, prop){
            if(prop === 'then') return res => Promise.resolve({
              data: tabla === 'eventos_sync' ? eventos.filter(r => !desde || r.creado_en > desde) : [], error: null }).then(res);
            if(prop === 'gt') return (col, val) => { if(col === 'creado_en') desde = val; return q; };
            return () => q;
          }
        });
        return q;
      } };
    }
  };
}

async function levantar(archivo, eventos){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: crearServidor(eventos).createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.__pwn = 0;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + ';window.__est = ()=>estado; window.__geo = ()=>POTREROS_GEO; window.__sync = sincronizar;' +
      'window.__lista = renderLista; window.__sug = renderSugerenciasBuscador; window.__detalle = renderDetalle;' +
      'window.__puntos = renderListaPuntos;');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

const COORDS_OK = [[-31.98, -56.34], [-31.98, -56.33], [-31.97, -56.33], [-31.97, -56.34]];
let n = 0;
function ev(tipo, potrero, detalle){
  n++;
  return { id: 'sec' + n, event_id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), tipo, potrero,
    dispositivo: 'atacante', creado_en: '2026-02-01T00:00:' + String(n % 60).padStart(2, '0') + '.000Z',
    fecha_cliente: '01/02/2026', detalle };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const tieneDueno = /maria[_-]laura|pone[_-]chico/.test(archivo);
  const { win: w0, errores: e0 } = await levantar(archivo, []);
  if(e0.length){ chequear('carga sin errores', false, e0[0]); return; }
  let potrero = Object.keys(w0.__est().potreros)[0];
  const sinPotreros = !potrero;
  if(sinPotreros) potrero = 'TEST';

  const nombreMalo = '<img src=x onerror="window.__pwn=1">';
  const nombreAttr = 'Zz" onmouseover="window.__pwn=2" x="';
  const eventos = [
    ev('potrero_creado', nombreMalo, { coords: COORDS_OK, area: 5 }),
    ev('potrero_creado', nombreAttr, { coords: COORDS_OK, area: 5 }),
    ev('potrero_creado', 'CoordsNaN', { coords: [[1, 'x'], [2, 3], [4, 5]], area: 1 }),
    ev('potrero_creado', 'CoordsFuera', { coords: [[999, 999], [2, 3], [4, 5]], area: 1 }),
    ev('potrero_creado', 'CoordsPocas', { coords: [[1, 2], [3, 4]], area: 1 }),
    ev('ingreso', potrero, { cantidad: 'muchas', categoria: 'Vacas', dueno: tieneDueno ? 'Pedro' : undefined }),
    ev('ingreso', potrero, { cantidad: 1e9, categoria: 'Vacas', dueno: tieneDueno ? 'Pedro' : undefined }),
    ev('punto_creado', null, { id: 'p1', tipo: 'zzz_no_existe', subtipo: 'x', lat: -31.9, lon: -56.3 }),
    ev('ingreso', potrero, { cantidad: 4, categoria: 'Vacas<img src=x onerror="window.__pwn=3">', dueno: tieneDueno ? 'Pedro' : undefined }),
    ev('ingreso', potrero, { cantidad: 7, categoria: 'Vacas', dueno: tieneDueno ? 'Pedro' : undefined }) // legítimo
  ];
  const { win, errores } = await levantar(archivo, eventos);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  if(sinPotreros) win.__est().potreros[potrero] = { animales: {}, historial: [], fechaIngreso: null, fechaSalida: null };
  const hayGeo = win.__geo().some(p => p.nombre === potrero);
  if(sinPotreros && !hayGeo) win.__geo().push({ nombre: potrero, coords: COORDS_OK, area: 1 });
  // La sincronización del arranque ya corrió (antes de existir este potrero): se reinicia para re-traer los eventos.
  if(sinPotreros) win.__est().ultimaSincronizacion = null;

  await win.__sync(false);
  await new Promise(r => setTimeout(r, 100));

  const nombres = win.__geo().map(p => p.nombre);
  chequear('ningún nombre de potrero conserva < > ni comillas dobles', nombres.every(x => !/[<>"]/.test(x)),
    nombres.filter(x => /[<>"]/.test(x)).join(' | '));
  chequear('coordenadas inválidas (NaN / fuera de rango / pocas) no crean potrero',
    !nombres.includes('CoordsNaN') && !nombres.includes('CoordsFuera') && !nombres.includes('CoordsPocas'));

  win.__lista('');
  win.__sug('');
  const doc = win.document;
  chequear('lista lateral: no se inyectó ningún <img>', !doc.querySelector('#lista-potreros img'));
  chequear('autocompletado: no se inyectó ningún <img> ni atributo onmouseover',
    !doc.querySelector('#buscador-sugerencias img') && !doc.querySelector('#buscador-sugerencias [onmouseover]'));

  // Datos viejos ya guardados (antes del arreglo): esc() tiene que frenarlo igual al pintar.
  const viejo = '<img src=x onerror="window.__pwn=4">';
  win.__geo().push({ nombre: viejo, coords: COORDS_OK, area: 1 });
  win.__est().potreros[viejo] = { animales: {}, historial: [], fechaIngreso: null, fechaSalida: null };
  win.__lista('');
  win.__sug('');
  chequear('esc(): un nombre viejo con HTML se ve como texto, no como elemento',
    !doc.querySelector('#lista-potreros img') && !doc.querySelector('#buscador-sugerencias img') &&
    doc.getElementById('lista-potreros').textContent.includes('<img src=x'));

  const clave = tieneDueno ? 'Vacas||Pedro' : 'Vacas||';
  const animales = win.__est().potreros[potrero].animales;
  chequear('eventos con cantidad no numérica o absurda se descartan; el legítimo se aplica (+7)',
    (animales[clave] || 0) === 7, 'Vacas=' + animales[clave]);

  chequear('punto_creado con tipo desconocido se descarta', !(win.__est().puntos || []).some(p => p.id === 'p1'));
  let rompe = null;
  try { win.__puntos(); } catch(e){ rompe = e.message; }
  chequear('renderListaPuntos no se rompe', !rompe, rompe);

  const hist = win.__est().potreros[potrero].historial.map(h => h.detalle).join(' | ');
  chequear('el historial del ingreso con HTML quedó sin < >', !/[<>]/.test(hist), hist);
  win.__detalle(potrero);
  chequear('detalle del potrero: no se inyectó ningún <img>', !doc.querySelector('#detalle img'));

  chequear('ningún script del atacante se ejecutó', win.__pwn === 0, 'window.__pwn=' + win.__pwn);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
