/*
 * Prueba ad-hoc, especifica de Maria Laura: "Cerro" era un nombre
 * equivocado desde la carga inicial -- la tierra real es "Rincon", y
 * ademas faltaba agregar "Manantial" (Pedro, 10/9/2026). El renombre no es
 * solo cambiar un string en POTREROS_GEO: los eventos ya guardados en
 * Supabase y en localStorage de cada dispositivo dicen "Cerro" para
 * siempre, asi que hacen falta dos mecanismos:
 *
 *  A) Migracion local en cargarEstado(): un dispositivo que YA tiene datos
 *     guardados bajo "Cerro" los tiene que ver aparecer bajo "Rincon" en
 *     cuanto carga el codigo nuevo, sin perder animales ni historial.
 *  B) Alias en aplicarEventoRemoto(): un dispositivo SIN datos locales
 *     (celular nuevo, "Restablecer datos de fabrica") que resincroniza
 *     desde cero y recibe los eventos VIEJOS (que dicen "Cerro") tiene que
 *     terminar con esos animales bajo "Rincon" tambien -- si no, un
 *     dispositivo nuevo pierde en silencio todo lo que pasó bajo el
 *     nombre viejo.
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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
}

const STORAGE_KEY = 'maria_laura_potreros_v1';

async function levantar(archivo, seedLocalStorage){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient(){ return { from(){ const q = { select(){ return q; }, eq(){ return q; },
    in(){ return q; }, order(){ return q; }, gt(){ return q; }, insert(){ return Promise.resolve({error:null}); },
    then(res){ return Promise.resolve(res({data:[], error:null})); } }; return q; } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  if(seedLocalStorage) win.localStorage.setItem(STORAGE_KEY, JSON.stringify(seedLocalStorage));
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try {
    win.eval(codigo + ';window.__est = function(){ return estado; };window.__aplicarRemoto = aplicarEventoRemoto;window.__potrerosGeo = POTREROS_GEO;');
  } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');

  // Caso A: dispositivo que YA tenia datos guardados bajo "Cerro".
  const seedViejo = {
    potreros: {
      Cerro: {
        animales: { 'Vacas||Silvia': 7 },
        historial: [
          { id: 'h_1', fecha: '20/08/2026', tipo: 'ingreso', detalle: 'Carga inicial desde planilla: 8 Vacas (Silvia)' },
          { id: 'h_2', fecha: '25/08/2026', tipo: 'venta', detalle: 'venta: 1 Vacas de Silvia' }
        ],
        fechaIngreso: '2026-08-20', fechaSalida: null
      }
    },
    ugCoef: {}, puntos: [], transacciones: [], lluvias: [], config: {}, colaSync: [], colaSanidad: [],
    historialSanidad: [], ultimaSincronizacion: null
  };
  const { win: winA, errores: erroresA } = await levantar(archivo, seedViejo);
  if(erroresA.length){ chequear('A: carga sin errores', false, erroresA[0]); return; }
  const estA = winA.__est();
  chequear('A: "Rincon" existe con los animales que tenia "Cerro"',
    !!estA.potreros['Rincon'] && estA.potreros['Rincon'].animales['Vacas||Silvia'] === 7,
    JSON.stringify(estA.potreros['Rincon']));
  chequear('A: el historial viejo de "Cerro" viajo entero a "Rincon"',
    !!estA.potreros['Rincon'] && estA.potreros['Rincon'].historial.length === 2,
    JSON.stringify(estA.potreros['Rincon'] && estA.potreros['Rincon'].historial));
  chequear('A: no quedo un "Cerro" separado con datos',
    !estA.potreros['Cerro'], JSON.stringify(estA.potreros['Cerro']));
  chequear('A: "Manantial" existe y arranca vacio',
    !!estA.potreros['Manantial'] && Object.values(estA.potreros['Manantial'].animales).every(v=>!v),
    JSON.stringify(estA.potreros['Manantial']));

  // Caso B: dispositivo SIN datos locales (celular nuevo / restablecer de
  // fabrica) que resincroniza desde cero y recibe los eventos VIEJOS que
  // todavia dicen "Cerro" -- tienen que terminar en "Rincon".
  const { win: winB, errores: erroresB } = await levantar(archivo, null);
  if(erroresB.length){ chequear('B: carga sin errores', false, erroresB[0]); return; }
  const estB = winB.__est();
  // La carga inicial (CARGA_INICIAL_SEED) es local, no un evento sincronizado
  // -- cualquier dispositivo nuevo la aplica sola, igual en todos. Por eso
  // "Rincon" ya arranca con las 8 Vacas de la semilla (ahora bajo la clave
  // nueva), y "Cerro" no existe en absoluto (no esta en POTREROS_GEO).
  chequear('B (antes de sincronizar): "Rincon" ya trae la carga inicial (8), no existe "Cerro"',
    !!estB.potreros['Rincon'] && estB.potreros['Rincon'].animales['Vacas||Silvia']===8 && estB.potreros['Cerro']===undefined,
    JSON.stringify({rincon: estB.potreros['Rincon'], cerro: estB.potreros['Cerro']}));

  // El evento REAL que sí quedó sincronizado (la venta que bajó de 8 a 7)
  // todavía dice potrero:"Cerro" en Supabase para siempre.
  winB.__aplicarRemoto({
    tipo: 'venta', potrero: 'Cerro', dispositivo: 'disp_viejo',
    fecha_cliente: '25/08/2026', detalle: { categoria: 'Vacas', dueno: 'Silvia', cantidad: 1 }
  });
  chequear('B: la venta vieja con potrero:"Cerro" se aplico sobre "Rincon" (8-1=7)',
    estB.potreros['Rincon'].animales['Vacas||Silvia'] === 7,
    JSON.stringify(estB.potreros['Rincon'].animales));
  chequear('B: no se creo un "Cerro" nuevo con el evento viejo',
    !estB.potreros['Cerro'], JSON.stringify(estB.potreros['Cerro']));

  // Un movimiento viejo CON destino "Cerro" tambien tiene que redirigir.
  winB.__aplicarRemoto({
    tipo: 'movimiento', potrero: 'Tajamar', dispositivo: 'disp_viejo',
    fecha_cliente: '21/08/2026', detalle: { categoria: 'Vacas', dueno: 'Silvia', cantidad: 1, destino: 'Cerro' }
  });
  chequear('B: un movimiento viejo con destino:"Cerro" tambien redirige a "Rincon"',
    estB.potreros['Rincon'].animales['Vacas||Silvia'] === 8,
    JSON.stringify(estB.potreros['Rincon'].animales));

  // Confirma que los 5 potreros esperados existen y ninguno se llama "Cerro".
  const nombresGeo = winB.__potrerosGeo.map(p=>p.nombre).sort();
  chequear('POTREROS_GEO tiene los 5 potreros esperados, sin "Cerro"',
    JSON.stringify(nombresGeo) === JSON.stringify(['Casco','Manantial','Rincon','Tajamar','Uno']),
    JSON.stringify(nombresGeo));
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
