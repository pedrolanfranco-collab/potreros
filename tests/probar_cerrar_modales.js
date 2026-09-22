/*
 * Prueba ad-hoc: botón de cerrar (✕) arriba a la derecha de cada modal
 * (14/9/2026, pedido de Pedro). El ✕ tiene que disparar el mismo click que
 * el botón "Cerrar"/"Cancelar" que ya existía en cada modal -- no una
 * lógica de cierre nueva -- para que modales con side-effects (como
 * modal-voz, que corta la grabación) no se desincronicen.
 *
 * Recorre todos los modales presentes en cada archivo (algunos son
 * PC-only, como modal-coef; el test tolera que un id no exista en una
 * variante) y para cada uno: lo abre a mano, clickea la ✕, confirma que
 * cierra igual que el botón "Cerrar" original.
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

function crearServidor(){
  const filas = [];
  return {
    filas,
    createClient(){
      return { from(){
        const q = {
          _filtros: [], select(){ return q; }, eq(){ return q; }, gt(){ return q; }, order(){ return q; },
          insert(obj){ filas.push(obj); return Promise.resolve({ error: null }); },
          then(res){ return Promise.resolve(res({ data: filas.slice(), error: null })); }
        };
        return q;
      } };
    }
  };
}

async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  win.supabase = { createClient: crearServidor().createClient };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo); } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 60));
  return { win, errores };
}

// [id del modal, id del boton X, id del boton "Cerrar/Cancelar" original]
// modal-usuario queda AFUERA de esta lista a propósito (18/9/2026): ahí la
// ✕ no dispara "Cancelar" como el resto, dispara "Guardar" -- se prueba
// aparte, más abajo.
const MODALES = [
  ['modal-herramientas', 'herramientas-cerrar-x', 'herramientas-cerrar'],
  ['modal-voz', 'voz-cerrar-x', 'voz-cerrar'],
  ['modal-alertas', 'alertas-cerrar-x', 'alertas-cerrar'],
  ['modal-desaparecidos', 'desaparecidos-cerrar-x', 'desaparecidos-cerrar'],
  ['modal-sanidad', 'sanidad-cerrar-x', 'sanidad-cerrar'],
  ['modal-lluvias', 'lluvias-cerrar-x', 'lluvias-cerrar'],
  ['modal-stock', 'stock-cerrar-x', 'stock-cerrar'],
  ['modal-coef', 'coef-cerrar-x', 'coef-cerrar'],
  ['modal-puntos', 'puntos-cerrar-x', 'puntos-cerrar'],
  ['modal-dibujar-potrero', 'dp-cerrar-x', 'dp-cancelar'],
];

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  const doc = win.document;
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }

  MODALES.forEach(([modalId, xId, cerrarId])=>{
    const modal = doc.getElementById(modalId);
    const x = doc.getElementById(xId);
    if(!modal || !x){
      console.log(`  · ${modalId} no está en esta variante, se salta.`);
      return;
    }
    modal.style.display = 'flex';
    x.dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear(`${modalId}: la ✕ cierra igual que "${cerrarId}"`, modal.style.display === 'none',
      'quedó en: ' + modal.style.display);
  });

  // modal-usuario: la ✕ apunta a "Guardar", no a "Cancelar" (18/9/2026).
  // Antes, cerrar con la ✕ sin cargar nombre dejaba la app preguntando
  // "¿Quién sos?" para siempre -- era el único modal donde cerrar con la ✕
  // no era inofensivo. Ahora la ✕ intenta guardar: si no hay nombre, avisa
  // y NO cierra (fuerza a cargar uno la primera vez); si hay nombre, guarda
  // y cierra, igual que tocar "Guardar" a mano.
  const modalUsuario = doc.getElementById('modal-usuario');
  const usuarioX = doc.getElementById('usuario-cerrar-x');
  const usuarioInput = doc.getElementById('usuario-nombre-input');
  const usuarioCancelar = doc.getElementById('usuario-cancelar');
  const toastEl = doc.getElementById('toast');
  if(modalUsuario && usuarioX && usuarioInput){
    usuarioInput.value = '';
    modalUsuario.style.display = 'flex';
    usuarioX.dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('modal-usuario: la ✕ sin nombre NO cierra (evita quedar preguntando para siempre)',
      modalUsuario.style.display === 'flex', 'quedó en: ' + modalUsuario.style.display);
    chequear('modal-usuario: la ✕ sin nombre avisa "Escribí un nombre"',
      toastEl && toastEl.textContent === 'Escribí un nombre', 'toast: ' + (toastEl && toastEl.textContent));

    usuarioInput.value = 'Pedro Test';
    usuarioX.dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('modal-usuario: la ✕ con nombre SÍ guarda y cierra',
      modalUsuario.style.display === 'none', 'quedó en: ' + modalUsuario.style.display);
    chequear('modal-usuario: el nombre quedó guardado en localStorage',
      win.localStorage.getItem('potreros_nombre_usuario') === 'Pedro Test',
      'guardado: ' + win.localStorage.getItem('potreros_nombre_usuario'));

    // Regresión: "Cancelar" (el botón de texto, no la ✕) sigue sin guardar.
    usuarioInput.value = 'Otro Nombre';
    modalUsuario.style.display = 'flex';
    usuarioCancelar.dispatchEvent(new win.Event('click', { bubbles: true }));
    chequear('modal-usuario: "Cancelar" (botón de texto) sigue sin guardar',
      win.localStorage.getItem('potreros_nombre_usuario') === 'Pedro Test',
      'guardado: ' + win.localStorage.getItem('potreros_nombre_usuario'));
  } else {
    console.log('  · modal-usuario no está en esta variante, se salta.');
  }
}

(async () => {
  const archivos = process.argv.slice(2);
  for(const a of archivos) await probarArchivo(a);
  console.log('\n' + (fallas ? fallas + ' verificacion(es) fallaron' : 'Todo OK'));
  process.exit(fallas ? 1 : 0);
})();
