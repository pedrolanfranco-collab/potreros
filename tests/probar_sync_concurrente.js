/*
 * Prueba ad-hoc: sincronizar() no debe duplicar eventos si se llama dos
 * veces en simultaneo (pasa de verdad al abrir la app: se dispara desde
 * actualizarEstadoConexion() al cargar Y desde un setTimeout de 1.5s --
 * si la primera todavia no termino cuando arranca la segunda, sin una
 * bandera de reentrancia las dos parten del mismo estado.ultimaSincronizacion
 * y aplican los mismos eventos remotos dos veces).
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

// Servidor simulado con latencia de red real (setTimeout) para que dos
// llamadas a sincronizar() lanzadas casi juntas realmente se solapen -- un
// mock sin latencia resuelve tan rapido que nunca se solaparia.
function crearServidor(eventosSemilla, latenciaMs){
  const filas = { eventos_sync: eventosSemilla.slice() };
  return {
    createClient(){
      return { from(tabla){
        const q = {
          _filtros: [],
          select(){ return q; }, eq(col,val){ return q; }, // sin filtrar por establecimiento -- no importa para esta prueba
          gt(col,val){ q._filtros.push(r=>r[col]>val); return q; },
          order(){ return q; },
          then(res){
            return new Promise(resolve=>{
              setTimeout(()=>{
                const data = (filas[tabla]||[]).filter(r=>q._filtros.every(f=>f(r)));
                resolve(res({data, error:null}));
              }, latenciaMs);
            });
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
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: servidor.createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + ';window.__est = function(){ return estado; };window.__sync = sincronizar;'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  // Un solo evento remoto (otro dispositivo): +10 Vacas en el primer potrero con carga inicial.
  const eventos = [
    { id: 'e1', tipo: 'ingreso', dispositivo: 'otro_disp', creado_en: '2026-01-01T00:00:00.000Z',
      fecha_cliente: '01/01/2026', potrero: null, detalle: { cantidad: 10, categoria: 'Vacas' } }
  ];
  const servidor = crearServidor([], 0); // se corrige potrero abajo, tras conocer los potreros reales
  const { win, errores } = await levantar(archivo, servidor);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const tieneDueno = /maria[_-]laura|pone[_-]chico/.test(archivo);
  if(!Object.keys(win.__est().potreros).length){
    // Pone Chico arranca sin potreros -- crear uno minimo a mano, alcanza para la prueba.
    win.__est().potreros['TEST'] = { animales: {}, historial: [], fechaIngreso: null, fechaSalida: null };
  }
  const potrero = Object.keys(win.__est().potreros)[0];
  eventos[0].potrero = potrero;
  if(tieneDueno) eventos[0].detalle.dueno = 'Pedro';
  // 11/9/2026: las 6 apps ya usan clave compuesta "categoria||firma"; sin
  // "tieneDueno" (María Laura/Pone Chico) cae en la firma vacía.
  const claveVacas = tieneDueno ? 'Vacas||Pedro' : 'Vacas||';

  // Relanzar con el potrero real y latencia de red de 40ms -- simula el caso
  // real: actualizarEstadoConexion() dispara sincronizar() al cargar, y 1.5s
  // despues (aca, mucho antes para no esperar) se dispara de nuevo mientras
  // la primera sigue en vuelo.
  const servidor2 = crearServidor(eventos, 150);
  const { win: win2, errores: errores2 } = await levantar(archivo, servidor2);
  if(errores2.length){ chequear('carga sin errores (2)', false, errores2[0]); return; }
  if(!win2.__est().potreros[potrero]){
    win2.__est().potreros[potrero] = { animales: {}, historial: [], fechaIngreso: null, fechaSalida: null };
  }
  const antes = win2.__est().potreros[potrero].animales[claveVacas] || 0;

  // Dos sincronizar() lanzados casi juntos, sin esperar el primero.
  const p1 = win2.__sync(false);
  const p2 = win2.__sync(false);
  await Promise.all([p1, p2]);
  await new Promise(r=>setTimeout(r, 200));

  const despues = win2.__est().potreros[potrero].animales[claveVacas] || 0;
  chequear('el evento remoto se aplica UNA sola vez (no se duplica)',
    despues === antes + 10,
    `antes=${antes} despues=${despues} (si duplicó, despues=${antes+20})`);
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
