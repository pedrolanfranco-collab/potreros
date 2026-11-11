/*
 * El botón redondo del micrófono (#btn-voz) flota abajo a la derecha. La barra
 * de abajo (#footer-tools, con "🛠 Herramientas") llega hasta esa misma
 * esquina y el micrófono tapaba un tercio del botón (11/11/2026: 58x43 px de
 * 154x46, igual en el celular a 375x812 y en la PC a 1366x768).
 *
 * ubicarBotonVoz() tiene que:
 *   - subir el micrófono 12 px por encima de la barra cuando la barra ocupa
 *     la esquina (celular y PC);
 *   - subirlo por encima del aviso rojo de "trabado" (#aviso-trabado) cuando
 *     está, y hacerlo solo, sin que nadie la llame;
 *   - dejarlo en su lugar de siempre (22 px) cuando la barra no llega a la
 *     esquina o está oculta.
 * Campo no tiene micrófono: ahí no tiene que existir ni el botón.
 *
 * jsdom no calcula posiciones: la prueba le dice a cada elemento dónde está.
 *
 * Uso: node tests/probar_boton_voz.js <index.html> [...]
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

async function levantar(archivo){
  const html = fs.readFileSync(archivo, 'utf-8').replace(/<script src="https?:\/\/[^"]*"><\/script>/g, '');
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push('jsdomError: ' + (e.stack || e.message)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
  const win = dom.window;
  stubLeaflet(win);
  // sin reconocimiento de voz la app deja el micrófono oculto: acá el navegador "lo tiene"
  win.SpeechRecognition = function(){ this.start = () => {}; this.stop = () => {}; };
  const q = { insert(){ return Promise.resolve({ error: null }); }, select(){ return q; }, eq(){ return q; }, gt(){ return q; },
    in(){ return q; }, order(){ return q; }, limit(){ return q; }, range(){ return q; },
    then(res){ return Promise.resolve(res({ data: [], error: null })); } };
  win.supabase = { createClient(){ return { from(){ return q; } }; } };
  Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + '\n;window.__ubicar = (typeof ubicarBotonVoz === "function") ? ubicarBotonVoz : null;'); }
  catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await new Promise(r => setTimeout(r, 30));
  return { win, errores };
}

function pantalla(win, ancho, alto){
  Object.defineProperty(win, 'innerWidth', { value: ancho, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: alto, configurable: true });
}
function ponerEn(el, izq, arriba, der, abajo){
  el.getBoundingClientRect = () => ({ left: izq, top: arriba, right: der, bottom: abajo, width: der - izq, height: abajo - arriba, x: izq, y: arriba });
}
const tic = () => new Promise(r => setTimeout(r, 20));

async function probarArchivo(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  if(errores.length){ chequear('carga sin errores', false, errores[0]); return; }
  const doc = win.document;
  const boton = doc.getElementById('btn-voz');

  // Campo (móvil simple) no tiene carga por voz. Se decide por la carpeta, no por un flag del config.
  if(/-movil-campo[\\/]/.test(archivo)){
    chequear('Campo no tiene el botón del micrófono', !boton);
    return;
  }

  chequear('el botón del micrófono existe', !!boton);
  chequear('existe ubicarBotonVoz()', typeof win.__ubicar === 'function');
  if(!boton || typeof win.__ubicar !== 'function') return;
  chequear('con reconocimiento de voz, el micrófono se muestra', boton.style.display === 'block', 'display=' + boton.style.display);

  const barra = doc.getElementById('footer-tools');
  chequear('existe la barra de abajo (#footer-tools)', !!barra);
  if(!barra) return;

  // 1) Celular 375x812: la barra ocupa todo el ancho, de y=727 a y=812 (medido en La Vuelta móvil v4.01)
  pantalla(win, 375, 812);
  ponerEn(barra, 0, 727, 375, 812);
  win.__ubicar();
  chequear('celular: el micrófono queda 12 px arriba de la barra (bottom 97px)', boton.style.bottom === '97px', 'bottom=' + boton.style.bottom);
  // el borde de abajo del micrófono (812 - 97 = 715) queda por encima del tope de la barra (727)
  chequear('celular: el micrófono ya no pisa la barra', 812 - parseInt(boton.style.bottom, 10) <= 727);

  // 2) La barra crece (más renglones de aviso): el micrófono la sigue
  ponerEn(barra, 0, 700, 375, 812);
  win.__ubicar();
  chequear('celular: si la barra es más alta, el micrófono sube con ella (bottom 124px)', boton.style.bottom === '124px', 'bottom=' + boton.style.bottom);
  ponerEn(barra, 0, 727, 375, 812);

  // 3) Aparece el aviso rojo de "trabado" encima de la barra: se acomoda solo, sin llamar a nadie
  const aviso = doc.createElement('div');
  aviso.id = 'aviso-trabado';
  ponerEn(aviso, 10, 600, 365, 719);
  barra.parentNode.insertBefore(aviso, barra);
  await tic();
  chequear('celular: con el aviso de "trabado", el micrófono sube solo por encima (bottom 224px)', boton.style.bottom === '224px', 'bottom=' + boton.style.bottom);
  aviso.remove();
  await tic();
  chequear('celular: al irse el aviso, el micrófono baja solo (bottom 97px)', boton.style.bottom === '97px', 'bottom=' + boton.style.bottom);

  // 4) PC 1366x768: la barra está al pie de la columna derecha, de x=987 a x=1366 y de y=683 a y=768
  //    (medido en La Vuelta PC v4.01: ahí el micrófono también tapaba el 35 % de Herramientas)
  pantalla(win, 1366, 768);
  ponerEn(barra, 987, 683, 1366, 768);
  win.dispatchEvent(new win.Event('resize'));
  chequear('PC: al cambiar el tamaño de la ventana, el micrófono queda 12 px arriba de la barra (bottom 97px)', boton.style.bottom === '97px', 'bottom=' + boton.style.bottom);

  // 4b) Una barra que no llega a la esquina del micrófono (termina en x=380) no lo mueve
  ponerEn(barra, 0, 690, 380, 768);
  win.dispatchEvent(new win.Event('resize'));
  chequear('barra lejos de la esquina: el micrófono queda en su lugar de siempre (bottom 22px)', boton.style.bottom === '22px', 'bottom=' + boton.style.bottom);

  // 5) Una barra oculta (0x0) no mueve nada
  pantalla(win, 375, 812);
  ponerEn(barra, 0, 0, 0, 0);
  win.__ubicar();
  chequear('barra oculta: el micrófono queda en 22px', boton.style.bottom === '22px', 'bottom=' + boton.style.bottom);
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('Uso: node tests/probar_boton_voz.js <index.html> [...]'); process.exit(2); }
  for(const a of archivos) await probarArchivo(a);
  console.log(fallas ? `\nHAY FALLAS: ${fallas}` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
