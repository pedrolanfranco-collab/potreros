/*
 * PC nueva estilo FieldData, parte 1 (4/11/2026, a pedido de Pedro): menú fijo a la izquierda (#pc-rail) y
 * tarjetas de totales con Cabezas y Con animales. Cada sección del menú abre #pc-seccion con atajos que aprietan el
 * botón original (mismo id, misma acción); una sección con un solo botón lo abre directo y una sin botones para ese
 * campo no se ve. La móvil completa y Campo no tienen nada de esto.
 *
 * Uso: node tests/probar_pc_menu.js la-vuelta-pc/index.html maria-laura-pc/index.html pone-chico-pc/index.html
 *      (por cada "<prefijo>-pc" mira también "<prefijo>-movil" y "<prefijo>-movil-campo")
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fallas = 0;
function chequear(nombre, cond, detalle){
  console.log((cond ? '  OK  ' : '  MAL ') + nombre + (cond ? '' : ' — ' + (detalle || '')));
  if(!cond) fallas++;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

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
    getZoom(){ return 14; }, invalidateSize(){ return mapa; }, setMaxBounds(){ return mapa; },
    doubleClickZoom: { disable(){}, enable(){} } };
  win.L = { map(){ return mapa; }, tileLayer(){ const c = capa(); mapa._capas.add(c); return c; },
    polygon(){ return capa(); }, marker(){ return capa(); }, circleMarker(){ return capa(); },
    circle(){ return capa(); }, divIcon(){ return {}; }, latLng(a, b){ return { lat: a, lng: b }; },
    latLngBounds(){ return limites(); }, DomEvent: { stopPropagation(){} } };
  win.JSZip = function(){ return { file(){}, generateAsync(){ return Promise.resolve(new win.Blob([])); } }; };
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
  win.supabase = { createClient(){ return null; } };
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  win.alert = () => {}; win.confirm = () => true; win.prompt = () => null;
  win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
  win.HTMLElement.prototype.scrollIntoView = function(){};
  win.HTMLAnchorElement.prototype.click = function(){};
  const codigo = Array.from(win.document.querySelectorAll('script')).map(s => s.textContent).filter(Boolean).join('\n');
  try { win.eval(codigo + '\nwindow.__prueba = { geo: () => POTREROS_GEO, total: n => totalPotrero(n) };'); } catch(e){ errores.push('ERROR AL CARGAR: ' + e.stack); }
  await dormir(60);
  return { win, errores };
}

const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const visible = (el) => { for(let e = el; e && e.nodeType === 1; e = e.parentElement){ if(e.style.display === 'none') return false; } return true; };


async function probarPc(archivo){
  console.log('\n=== ' + archivo + ' ===');
  const { win, errores } = await levantar(archivo);
  chequear('carga sin errores', errores.length === 0, errores.join(' | '));
  if(errores.length) return;
  const doc = win.document;
  const rail = doc.getElementById('pc-rail');
  const panel = doc.getElementById('pc-seccion');
  chequear('existe el menú de la izquierda', !!rail);
  if(!rail) return;
  const item = sec => rail.querySelector(`[data-pc-seccion="${sec}"]`);
  chequear('12 secciones', rail.querySelectorAll('[data-pc-seccion]').length === 12);
  chequear('"🗺 Mapa" arranca marcado', item('mapa').classList.contains('activo'));

  // tarjetas nuevas: Cabezas = vacunos + ovinos + equinos; Con animales = "N de M"
  const num = id => doc.getElementById(id).textContent;
  const suma = ['res-vacunos', 'res-ovinos', 'res-equinos'].reduce((s, id) => s + Number(num(id)), 0);
  chequear('Cabezas = vacunos + ovinos + equinos', Number(num('res-cabezas')) === suma, num('res-cabezas') + ' vs ' + suma);
  const con = (() => { const t = win.__prueba; const g = t.geo(); return g.filter(p => t.total(p.nombre) > 0).length + ' de ' + g.length; })();
  chequear('Con animales = potreros con animales de todos', num('res-con-animales') === con, num('res-con-animales') + ' vs ' + con);

  // Hacienda: lista solo los botones visibles, con su texto y su emoji
  click(win, item('hacienda'));
  chequear('[hacienda] abre la ventana de sección', panel.style.display === 'flex');
  chequear('[hacienda] queda marcada en el menú', item('hacienda').classList.contains('activo') && !item('mapa').classList.contains('activo'));
  const atajos = Array.from(doc.querySelectorAll('#pc-seccion-lista [data-pc-ir]'));
  const visiblesOrig = ['btn-desaparecidos', 'btn-vecinos', 'btn-caravana', 'btn-pesadas', 'btn-alertas', 'btn-verificar-stock', 'btn-lecturas-stock', 'btn-faltantes', 'btn-snig-sin-lectura']
    .filter(id => doc.getElementById(id) && doc.getElementById(id).style.display !== 'none');
  chequear('[hacienda] un atajo por cada botón visible, en orden', JSON.stringify(atajos.map(b => b.getAttribute('data-pc-ir'))) === JSON.stringify(visiblesOrig),
    atajos.map(b => b.getAttribute('data-pc-ir')).join(','));
  chequear('[hacienda] el atajo copia el texto del original', atajos.every(b => b.textContent === doc.getElementById(b.getAttribute('data-pc-ir')).textContent.trim()));

  // el atajo aprieta el original y cierra la ventana
  let apretado = null;
  doc.getElementById('btn-desaparecidos').addEventListener('click', () => { apretado = 'btn-desaparecidos'; });
  click(win, atajos.find(b => b.getAttribute('data-pc-ir') === 'btn-desaparecidos'));
  chequear('el atajo aprieta el botón original', apretado === 'btn-desaparecidos');
  chequear('y cierra la ventana de sección', panel.style.display === 'none' && item('mapa').classList.contains('activo'));
  chequear('se abrió ❓ Desaparecidos de verdad', doc.getElementById('modal-desaparecidos') && doc.getElementById('modal-desaparecidos').style.display !== 'none');
  doc.getElementById('modal-desaparecidos').style.display = 'none';

  // un botón de un sub-menú escondido (Exportar) también se aprieta
  click(win, item('exportar'));
  let kmz = false;
  doc.getElementById('btn-exportar-kmz').addEventListener('click', () => { kmz = true; });
  click(win, doc.querySelector('#pc-seccion-lista [data-pc-ir="btn-exportar-kmz"]'));
  chequear('[exportar] aprieta un botón que vive en un sub-menú oculto', kmz);

  // sección de un solo botón: abre directo, sin ventana
  let stock = false;
  doc.getElementById('btn-stock').addEventListener('click', () => { stock = true; });
  click(win, item('stock'));
  chequear('[stock] un solo botón: lo abre directo', stock && panel.style.display === 'none');
  doc.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; });

  // DICOSE: se ve solo si el campo usa Movimientos DICOSE
  const guiasVisible = doc.getElementById('btn-guias').style.display !== 'none';
  chequear('[dicose] la sección se ve solo si el campo usa Movimientos DICOSE', (item('dicose').style.display !== 'none') === guiasVisible);
  const tareasVisible = doc.getElementById('btn-tareas').style.display !== 'none';
  chequear('[tareas] la sección sigue CONFIG.manejo', (item('tareas').style.display !== 'none') === tareasVisible);
  if(tareasVisible){click(win,item('tareas'));chequear('[tareas] el atajo abre Tareas directamente',panel.style.display==='none'&&doc.getElementById('modal-tareas').style.display==='flex');doc.querySelectorAll('.modal-overlay').forEach(m=>{m.style.display='none';});}
  const calendarioVisible = doc.getElementById('btn-calendario').style.display !== 'none';
  chequear('[calendario] la sección sigue CONFIG.manejo', (item('calendario').style.display !== 'none') === calendarioVisible);
  if(calendarioVisible){click(win,item('calendario'));chequear('[calendario] el atajo abre el calendario directamente',panel.style.display==='none'&&doc.getElementById('modal-calendario').style.display==='flex');doc.querySelectorAll('.modal-overlay').forEach(m=>{m.style.display='none';});}
  // Sanidad: con Insumos son 2 botones (ventana); sin Insumos, 1 (directo)
  const insumos = doc.getElementById('btn-insumos').style.display !== 'none';
  let sanidad = false;
  doc.getElementById('btn-sanidad').addEventListener('click', () => { sanidad = true; });
  click(win, item('sanidad'));
  if(insumos) chequear('[sanidad] con Insumos abre la ventana con los dos', panel.style.display === 'flex' && doc.querySelectorAll('#pc-seccion-lista [data-pc-ir]').length >= 2);
  else chequear('[sanidad] sin Insumos abre Sanidad directo', sanidad && panel.style.display === 'none');
  doc.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; });

  // cerrar: Esc, ✕ y Cerrar
  for(const [nombre, cerrar] of [['Esc', () => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }))],
                                 ['✕', () => click(win, doc.getElementById('pc-seccion-cerrar-x'))],
                                 ['Cerrar', () => click(win, doc.getElementById('pc-seccion-cerrar'))],
                                 ['🗺 Mapa', () => click(win, item('mapa'))]]){
    click(win, item('puntos'));
    const abierta = panel.style.display === 'flex';
    cerrar();
    chequear(`"${nombre}" cierra la ventana de sección`, abierta && panel.style.display === 'none' && item('mapa').classList.contains('activo'));
  }

  // 🛠 Herramientas sigue igual
  click(win, doc.getElementById('btn-herramientas'));
  chequear('🛠 Herramientas sigue abriendo su caja', doc.getElementById('modal-herramientas').style.display === 'flex');
}

async function probarMovil(archivo, etiqueta){
  if(!fs.existsSync(archivo)){ chequear('existe ' + archivo, false, 'no se encontró'); return; }
  const { win, errores } = await levantar(archivo);
  chequear(`${etiqueta}: carga sin errores`, errores.length === 0, errores.join(' | '));
  const doc = win.document;
  chequear(`${etiqueta}: no tiene el menú de la izquierda`, !doc.getElementById('pc-rail') && !doc.getElementById('pc-seccion'));
  chequear(`${etiqueta}: no tiene las tarjetas nuevas`, !doc.getElementById('res-cabezas') && !doc.getElementById('res-con-animales'));
}

(async () => {
  const archivos = process.argv.slice(2);
  if(!archivos.length){ console.error('Uso: node tests/probar_pc_menu.js <campo>-pc/index.html ...'); process.exit(2); }
  for(const a of archivos){
    await probarPc(a);
    const pref = a.replace(/-pc\/index\.html$/, '');
    await probarMovil(pref + '-movil/index.html', pref + '-movil');
    await probarMovil(pref + '-movil-campo/index.html', pref + '-movil-campo');
  }
  console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
